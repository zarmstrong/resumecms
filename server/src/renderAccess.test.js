import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_COOKIE, RENDER_LETTER_COOKIE, renderCookieValue, renderTarget } from './renderAccess.js';

const id = '3acde287-8bac-4b34-9408-82ee84488704';

test('a signed render cookie names its resume', () => {
  const value = renderCookieValue(id);
  assert.equal(renderTarget(`${RENDER_COOKIE}=${value}`), id);
  assert.equal(renderTarget(`resume_session=abc; ${RENDER_COOKIE}=${value}; other=1`), id);
});

test('anything else names no resume', () => {
  const value = renderCookieValue(id);
  const [, signature] = value.split('.');
  for (const header of [
    undefined,
    '',
    'resume_session=abc',
    `${RENDER_COOKIE}=`,
    `${RENDER_COOKIE}=${id}`,
    `${RENDER_COOKIE}=.${signature}`,
    `${RENDER_COOKIE}=other-id.${signature}`,
    `${RENDER_COOKIE}=${id}.${signature.slice(0, -1)}`,
    `${RENDER_COOKIE}=${id}.${signature}x`,
    `x${RENDER_COOKIE}=${value}`,
  ]) {
    assert.equal(renderTarget(header), null, String(header));
  }
});

test("a letter's render cookie names its letter, and the two kinds don't stand in for each other", () => {
  const letter = renderCookieValue(id, 'letter');
  assert.equal(renderTarget(`${RENDER_LETTER_COOKIE}=${letter}`, 'letter'), id);
  assert.equal(renderTarget(`${RENDER_LETTER_COOKIE}=${letter}`), null);
  assert.equal(renderTarget(`${RENDER_COOKIE}=${letter}`), null);
  assert.equal(renderTarget(`${RENDER_LETTER_COOKIE}=${renderCookieValue(id)}`, 'letter'), null);
  assert.equal(renderTarget(`${RENDER_COOKIE}=${renderCookieValue(id)}`, 'letter'), null);
});
