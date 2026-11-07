import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_LIMITS,
  emptyLanding,
  initialLanding,
  isSafeUrl,
  mergeLandingPatch,
  resolveLanding,
  validateLanding,
} from './landingFields.js';

const known = (...ids) => ({ knownResumeIds: new Set(ids) });
const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('validateLanding fills missing fields and returns only known ones', () => {
  assert.deepEqual(validateLanding({}, known()), emptyLanding());
  const out = validateLanding({ headline: 'Jo', links: [{ label: 'gh', url: 'https://github.com/jo' }] }, known());
  assert.equal(out.headline, 'Jo');
  assert.deepEqual(out.links, [{ label: 'gh', url: 'https://github.com/jo' }]);
});

test('validateLanding rejects unknown keys, wrong types and oversized values', () => {
  assert.equal(status(() => validateLanding(null, known())), 400);
  assert.equal(status(() => validateLanding([], known())), 400);
  assert.equal(status(() => validateLanding({ headlines: 'x' }, known())), 400);
  assert.equal(status(() => validateLanding({ headline: 5 }, known())), 400);
  assert.equal(status(() => validateLanding({ headline: 'x'.repeat(LANDING_LIMITS.headline + 1) }, known())), 400);
  assert.equal(status(() => validateLanding({ links: {} }, known())), 400);
  assert.equal(status(() => validateLanding({ links: [{ label: 'a', url: 'https://a', extra: 1 }] }, known())), 400);
  assert.equal(status(() => validateLanding({ links: [{ type: 'myspace', label: 'a', url: 'https://a' }] }, known())), 400);
  const tooMany = Array.from({ length: LANDING_LIMITS.links + 1 }, () => ({ label: 'a', url: 'https://a' }));
  assert.equal(status(() => validateLanding({ links: tooMany }, known())), 400);
  assert.equal(status(() => validateLanding({ photo: 'gravatar' }, known())), 400);
});

test('link URLs may not use a script-running scheme, however it is spelled', () => {
  for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', 'data:text/html,<script>x</script>', 'vbscript:x', 'tel:123']) {
    assert.equal(isSafeUrl(url), false, url);
    assert.equal(status(() => validateLanding({ links: [{ label: 'a', url }] }, known())), 400, url);
  }
  // A half-typed or relative URL resolves against the page, like an href.
  for (const url of ['', 'h', 'https:', 'https://example.com', 'mailto:me@example.com', 'example.com/me', '//example.com']) {
    assert.equal(isSafeUrl(url), true, url);
  }
  // One the parser rejects (half typed) saves, but is never shown.
  for (const url of ['https://', 'http://[']) {
    const draft = validateLanding({ links: [{ label: 'x', url }] }, known());
    assert.equal(draft.links[0].url, url);
    assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).links, []);
  }
});

test('photoUrl must be an inline JPEG, PNG or WebP image', () => {
  assert.equal(validateLanding({ photoUrl: 'data:image/jpeg;base64,/9j/4AAQ==' }, known()).photoUrl, 'data:image/jpeg;base64,/9j/4AAQ==');
  for (const photoUrl of [
    'https://tracker.example/pixel.gif',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,abc"onerror="x',
    'javascript:alert(1)',
  ]) {
    assert.equal(status(() => validateLanding({ photoUrl }, known())), 400, photoUrl);
  }
  const huge = `data:image/jpeg;base64,${'A'.repeat(LANDING_LIMITS.photoUrl)}`;
  assert.equal(status(() => validateLanding({ photoUrl: huge }, known())), 400);
});

test('a new card must name an existing resume; one already in the draft may outlive it', () => {
  assert.deepEqual(validateLanding({ resumes: [{ resumeId: 'a' }] }, known('a')).resumes, [{ resumeId: 'a', label: '', blurb: '' }]);
  assert.equal(status(() => validateLanding({ resumes: [{ resumeId: 'gone' }] }, known('a'))), 400);
  const kept = validateLanding({ resumes: [{ resumeId: 'gone' }] }, { knownResumeIds: new Set(['a']), previousResumeIds: new Set(['gone']) });
  assert.equal(kept.resumes[0].resumeId, 'gone');
  assert.equal(status(() => validateLanding({ resumes: [{ resumeId: 'a' }, { resumeId: 'a' }] }, known('a'))), 400);
  assert.equal(status(() => validateLanding({ resumes: [{ label: 'x' }] }, known('a'))), 400);
});

test('mergeLandingPatch replaces fields, resets null ones, and ignores __proto__', () => {
  const current = { ...emptyLanding(), headline: 'A', intro: 'B' };
  const merged = mergeLandingPatch(current, JSON.parse('{"headline":"C","intro":null,"__proto__":{"polluted":true}}'));
  assert.equal(merged.headline, 'C');
  assert.equal('intro' in merged, false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(validateLanding(merged, known()).intro, '');
});

test('initialLanding takes only what the landing page allows from the published header', () => {
  const draft = initialLanding('main', {
    name: 'Jo',
    title: 'Engineer',
    photoUrl: 'data:image/jpeg;base64,AAAA',
    links: [
      { type: 'github', label: 'gh', url: 'https://github.com/jo', note: 'dropped' },
      { label: 'bad', url: 'javascript:alert(1)' },
      { label: 'empty', url: '' },
      'not a link',
    ],
  });
  assert.equal(draft.headline, 'Jo');
  assert.equal(draft.subheadline, 'Engineer');
  assert.deepEqual(draft.links, [{ type: 'github', label: 'gh', url: 'https://github.com/jo' }]);
  assert.deepEqual(draft.resumes, [{ resumeId: 'main', label: '', blurb: '' }]);
  // It's a valid draft as it stands.
  assert.deepEqual(validateLanding(draft, known('main')), draft);
  assert.deepEqual(initialLanding('main', null).resumes.length, 1);
});

test('resolveLanding shows only available resumes, without ids or internal names', () => {
  const landing = {
    ...emptyLanding(),
    photo: 'resume',
    links: [{ label: '', url: 'https://a.example' }, { label: 'no url', url: '' }],
    resumes: [
      { resumeId: 'main', label: '', blurb: 'Hi' },
      { resumeId: 'private', label: 'Secret', blurb: '' },
      { resumeId: 'sales', label: 'Sales', blurb: '' },
    ],
  };
  const context = {
    photoUrl: 'data:image/jpeg;base64,AAAA',
    site: { title: 'T' },
    resumes: new Map([
      ['main', { href: '/resume', title: 'Engineer' }],
      ['sales', { href: '/r/sales', title: '' }],
    ]),
  };
  const out = resolveLanding(landing, context);
  assert.deepEqual(out.resumes, [
    { label: 'Engineer', blurb: 'Hi', href: '/resume' },
    { label: 'Sales', blurb: '', href: '/r/sales' },
  ]);
  assert.equal(JSON.stringify(out).includes('private'), false);
  assert.deepEqual(out.links, [{ label: 'https://a.example', url: 'https://a.example' }]);
  assert.equal(out.photoUrl, context.photoUrl);
  assert.equal(resolveLanding({ ...landing, photo: 'none' }, context).photoUrl, '');
  assert.equal(resolveLanding({ ...landing, photo: 'custom', photoUrl: 'data:image/png;base64,BB' }, context).photoUrl, 'data:image/png;base64,BB');
});
