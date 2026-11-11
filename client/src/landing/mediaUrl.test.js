import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { embedUrl, parseMediaUrl, readStart } from './mediaUrl.js';
// The server's copy, which this one mirrors, and the cases both must pass.
// Node builtins only, so they load without the server's dependencies.
import * as server from '../../../server/src/mediaUrl.js';
import { EMBED_CASES, PARSE_CASES, START_CASES } from '../../../server/src/mediaUrl.cases.js';

test('reads the shared links exactly as the server does', () => {
  for (const [input, expected] of PARSE_CASES) {
    assert.deepEqual(parseMediaUrl(input), expected, JSON.stringify(input));
    assert.deepEqual(server.parseMediaUrl(input), expected, JSON.stringify(input));
  }
});

test('reads start times exactly as the server does', () => {
  for (const [input, expected] of START_CASES) {
    assert.equal(readStart(input), expected, JSON.stringify(input));
    assert.equal(server.readStart(input), expected, JSON.stringify(input));
  }
});

test('builds the same player addresses as the server', () => {
  for (const [media, expected] of EMBED_CASES) {
    assert.equal(embedUrl(media), expected, JSON.stringify(media));
    assert.equal(server.embedUrl(media), expected, JSON.stringify(media));
  }
});

test('is a copy of the server module below its header', () => {
  const body = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^(\/\/.*\n)+\n/, '');
  assert.equal(body('./mediaUrl.js'), body('../../../server/src/mediaUrl.js'));
});
