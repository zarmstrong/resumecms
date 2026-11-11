import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaPlayer } from './mediaPlayer.js';
import { parseMediaUrl } from './mediaUrl.js';

const SPOTIFY = '4uLU6hMCjMI75M1A2tKUQC';

test('a video plays 16:9 from the privacy-mode player, its button and frame named after the section', () => {
  const player = mediaPlayer(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s'), ' My talk ');
  assert.deepEqual(player, {
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=90',
    provider: 'YouTube',
    kind: 'video',
    height: null,
    playLabel: 'Play: My talk',
    frameTitle: 'My talk (YouTube)',
    allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
  });
  const vimeo = mediaPlayer(parseMediaUrl('https://vimeo.com/76979871'), '');
  assert.equal(vimeo.src, 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
  assert.equal(vimeo.playLabel, 'Play: the video on Vimeo');
  assert.equal(vimeo.frameTitle, 'Vimeo video');
});

test("audio is as tall as the provider's own player, and may use less", () => {
  const height = (url) => mediaPlayer(parseMediaUrl(url), 'x').height;
  assert.equal(height('https://soundcloud.com/forss/flickermood'), 166);
  assert.equal(height('https://soundcloud.com/forss/flickermood/s-AbC123'), 166);
  assert.equal(height('https://soundcloud.com/forss/sets/soulhack'), 450);
  assert.equal(height(`https://open.spotify.com/track/${SPOTIFY}`), 152);
  assert.equal(height(`https://open.spotify.com/episode/${SPOTIFY}`), 152);
  assert.equal(height(`https://open.spotify.com/album/${SPOTIFY}`), 352);
  assert.equal(height(`https://open.spotify.com/show/${SPOTIFY}`), 352);
  const audio = mediaPlayer(parseMediaUrl(`https://open.spotify.com/track/${SPOTIFY}`), '');
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.allow, 'autoplay; encrypted-media');
  assert.equal(audio.playLabel, 'Play: the recording on Spotify');
  assert.equal(audio.frameTitle, 'Spotify player');
});

test('nothing is drawn for what no provider plays', () => {
  assert.equal(mediaPlayer(null, 'x'), null);
  assert.equal(mediaPlayer({ provider: 'loom', mediaId: 'x', start: 0 }, 'x'), null);
  assert.equal(mediaPlayer({ provider: 'spotify', mediaId: SPOTIFY, start: 0, type: 'artist' }, 'x'), null);
});
