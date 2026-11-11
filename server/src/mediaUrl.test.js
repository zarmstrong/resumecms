import test from 'node:test';
import assert from 'node:assert/strict';
import { embedUrl, parseMediaUrl, readStart } from './mediaUrl.js';
import { EMBED_CASES, PARSE_CASES, START_CASES } from './mediaUrl.cases.js';

test('reads each provider\'s links, and nothing else', () => {
  for (const [input, expected] of PARSE_CASES) assert.deepEqual(parseMediaUrl(input), expected, JSON.stringify(input));
});

test('reads start times as YouTube and Vimeo write them', () => {
  for (const [input, expected] of START_CASES) assert.equal(readStart(input), expected, JSON.stringify(input));
});

test("builds each provider's player address, in its privacy mode", () => {
  for (const [media, expected] of EMBED_CASES) assert.equal(embedUrl(media), expected, JSON.stringify(media));
});

test('every link it reads embeds from the provider, never from where the link pointed', () => {
  const players = ['https://www.youtube-nocookie.com/', 'https://player.vimeo.com/', 'https://w.soundcloud.com/', 'https://open.spotify.com/embed/'];
  for (const [input, expected] of PARSE_CASES) {
    if (!expected) continue;
    const src = embedUrl(parseMediaUrl(input));
    assert.ok(players.some((player) => src.startsWith(player)), `${input} → ${src}`);
  }
});
