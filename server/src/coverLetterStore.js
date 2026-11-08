import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { httpError } from './httpError.js';
import { letterPdfPathFor, writePdfAtomically } from './pdfPaths.js';
import {
  DEFAULT_TITLE,
  assertCoverLetterData,
  copyTitle,
  initialCoverLetterData,
  letterPdfKey,
  letterToday,
  validateTitle,
} from './coverLetterFields.js';

// One resume's cover letters (issue #71), composed into that resume's
// scoped store by resumeStore.js, so the REST routes and MCP tools reach
// them like the rest of its content. Every query is scoped by resume_id,
// the way `blocks` queries are: a letter of another resume is "not found".
//
// A letter is a private working document. There's no draft/published split
// and it never goes into published_resume, so nothing here calls
// touchDraft(): editing one doesn't change what the public site shows.
//
// Its PDF is rendered on demand (coverLetterPdf) on the store's single PDF
// queue, and kept, with letterPdfKey() of what it was rendered from in
// `pdf_key`, until the letter or its resume's header or look changes.
//
// `getSetting` is the resume's own (header, site). `withPdfLock`,
// `renderLetterPdf(letterId)` (already bounded by the render timeout),
// `waitForPdf(work, late, what)` (the resume store's settleWithin, with
// its wait) and `mergeShallow` are the resume store's.
export function createCoverLetterStore({ db, resumeId, getSetting, withPdfLock, renderLetterPdf, waitForPdf, mergeShallow, pdfDir }) {
  function rowToLetter(row) {
    return {
      id: row.id,
      resumeId: row.resume_id,
      title: row.title,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function letterRow(id) {
    if (typeof id !== 'string') return undefined;
    return db.prepare('SELECT * FROM cover_letters WHERE id = ? AND resume_id = ?').get(id, resumeId);
  }

  function existingLetterRow(id) {
    const row = letterRow(id);
    if (!row) throw httpError(404, 'Cover letter not found');
    return row;
  }

  function assertKnownFields(input, allowed, label) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, `${label} must be an object`);
    const unknown = Object.keys(input).find((key) => !allowed.includes(key));
    if (unknown) throw httpError(400, `Unknown cover letter field: ${unknown}`);
    return input;
  }

  // Oldest first, so a new one goes to the end of the list.
  function listCoverLetters() {
    return db
      .prepare('SELECT * FROM cover_letters WHERE resume_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(resumeId)
      .map(rowToLetter);
  }

  function getCoverLetter(id) {
    return rowToLetter(existingLetterRow(id));
  }

  // { title?, data? } for a new letter (data defaults to an empty one with
  // a salutation and closing to start from), or { title?, copyFrom } for a
  // copy of another letter of this resume.
  function createCoverLetter(input = {}) {
    const { title, data, copyFrom } = assertKnownFields(input ?? {}, ['title', 'data', 'copyFrom'], 'cover letter');
    let cleanTitle;
    let cleanData;
    if (copyFrom != null) {
      if (data != null) throw httpError(400, 'Send data or copyFrom, not both');
      const source = letterRow(copyFrom);
      if (!source) throw httpError(400, 'copyFrom does not reference a cover letter of this resume');
      cleanTitle = title == null ? copyTitle(source.title) : validateTitle(title);
      cleanData = JSON.parse(source.data);
    } else {
      cleanTitle = title == null ? DEFAULT_TITLE : validateTitle(title);
      cleanData = data == null ? initialCoverLetterData() : assertCoverLetterData(data);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO cover_letters (id, resume_id, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, resumeId, cleanTitle, JSON.stringify(cleanData), now, now);
    return getCoverLetter(id);
  }

  // `patch` may carry `title` and `data`. `data` replaces the stored object
  // whole; a null or absent one leaves it unchanged. With `mergeData` (an
  // option, so a REST body can't switch it on; the MCP tool does) it's
  // shallow-merged instead, like a block's (see mergeShallow). Either way
  // the result is what's checked.
  function updateCoverLetter(id, patch = {}, { mergeData = false } = {}) {
    patch = assertKnownFields(patch ?? {}, ['title', 'data'], 'patch');
    const existing = existingLetterRow(id);
    const title = patch.title == null ? existing.title : validateTitle(patch.title);
    let data = null;
    if (patch.data != null) {
      data = mergeData ? mergeShallow(JSON.parse(existing.data), patch.data, 'data') : patch.data;
      assertCoverLetterData(data);
    }
    db.prepare(
      `UPDATE cover_letters SET title = ?, data = COALESCE(?, data), updated_at = ?
       WHERE id = ? AND resume_id = ?`
    ).run(title, data === null ? null : JSON.stringify(data), new Date().toISOString(), id, resumeId);
    return getCoverLetter(id);
  }

  // Its PDF goes with it, straight away like a resume's (see deleteResume):
  // a render of it still queued or running finds the letter gone and
  // writes nothing.
  function deleteCoverLetter(id) {
    const changes = typeof id === 'string' ? db.prepare('DELETE FROM cover_letters WHERE id = ? AND resume_id = ?').run(id, resumeId).changes : 0;
    if (changes === 0) throw httpError(404, 'Cover letter not found');
    removeLetterPdf(pdfDir, id);
    return { deleted: id };
  }

  // The letter's PDF, rendered now unless the one on disk was rendered from
  // exactly what it would show (letterPdfKey). Resolves with { path, name,
  // company }: the file, the name it's signed with and who it's for (for
  // the download's name). Everything happens on the PDF queue, so it never
  // renders beside a publish, and two downloads of one letter render once.
  // The render reads the letter when it runs, so an edit landing meanwhile
  // can only leave the key older than the file: the next download renders
  // again, never the reverse.
  //
  // A download that waits longer than the store's PDF wait (a render stuck
  // behind a hung one) is a 503 to try again; the render carries on, so
  // the retry finds its file and key and is served at once. A request
  // while the letter's render is still queued joins it instead of queueing
  // another (it reads the letter when it starts, so it's as fresh), which
  // keeps the editor's retries from stacking renders up behind a hung
  // Chromium: at most one running and one queued per letter.
  const queuedRenders = new Map();
  function coverLetterPdf(id) {
    existingLetterRow(id);
    let render = queuedRenders.get(id);
    if (!render) {
      render = queueRender(id);
      queuedRenders.set(id, render);
      // Dropped when it settles, in case it never started (a 404 before).
      render.then(
        () => queuedRenders.get(id) === render && queuedRenders.delete(id),
        () => queuedRenders.get(id) === render && queuedRenders.delete(id)
      );
    }
    return waitForPdf(
      render,
      () => {
        throw httpError(503, 'The PDF is still rendering behind another one. Try again in a moment.');
      },
      `PDF render for cover letter ${id}`
    );
  }

  function queueRender(id) {
    const render = withPdfLock(async () => {
      // Running now: a later request queues its own, which will see any
      // edit made from here on.
      if (queuedRenders.get(id) === render) queuedRenders.delete(id);
      const row = existingLetterRow(id);
      const content = renderContent(row);
      const key = letterPdfKey({ ...content, data: content.letter.data });
      const filePath = letterPdfPathFor(pdfDir, id);
      const file = { path: filePath, name: content.letter.data.signature || content.header?.name || null, company: content.letter.data.company || null };
      if (row.pdf_key === key && fs.existsSync(filePath)) return file;
      let pdf;
      try {
        pdf = await renderLetterPdf(id);
      } catch (cause) {
        const err = httpError(500, "The cover letter's PDF render failed");
        err.cause = cause;
        throw err;
      }
      if (!letterRow(id)) throw httpError(404, 'Cover letter not found');
      writePdfAtomically(filePath, pdf);
      db.prepare('UPDATE cover_letters SET pdf_key = ? WHERE id = ? AND resume_id = ?').run(key, id, resumeId);
      return file;
    });
    return render;
  }

  // What /print/letter renders (via /api/public/letter): the letter, its
  // resume's draft header and site settings (a letter has no published
  // version, so it matches the resume as it's being edited), and the date
  // a letter without one shows.
  function renderContent(row) {
    return { letter: rowToLetter(row), header: getSetting('header'), site: getSetting('site'), today: letterToday() };
  }

  return {
    listCoverLetters,
    getCoverLetter,
    createCoverLetter,
    updateCoverLetter,
    deleteCoverLetter,
    coverLetterPdf,
    coverLetterRenderContent: (id) => renderContent(existingLetterRow(id)),
  };
}

// Failing to remove the file only leaves an unreachable one, so it's logged
// rather than failing a delete that has already happened.
export function removeLetterPdf(pdfDir, letterId) {
  try {
    fs.rmSync(letterPdfPathFor(pdfDir, letterId), { force: true });
  } catch (err) {
    console.error(`Could not remove the PDF of deleted cover letter ${letterId}:`, err);
  }
}
