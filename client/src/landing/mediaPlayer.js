import { MEDIA_PROVIDER_LABELS, embedUrl } from './mediaUrl.js';

// How a media section's clip (issue #121) is drawn, from the parsed link
// resolveLanding() sends: a video or an audio player, how tall the
// provider's audio player is (a video is 16:9), what the facade's button
// and the frame are called, and what the frame may use. The frame is
// only built once a visitor presses play, so nothing loads from the
// provider before that.

// The heights each provider's own embed code uses.
const AUDIO_HEIGHTS = {
  soundcloud: { track: 166, set: 450 },
  spotify: { track: 152, episode: 152, album: 352, playlist: 352, show: 352 },
};

// Only what the players need to play: autoplay (it's loaded by the click
// that asked for it), encrypted-media for the providers' protected
// streams, and fullscreen and picture-in-picture for video. Nothing else
// (no clipboard, camera, geolocation...).
const VIDEO_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
const AUDIO_ALLOW = 'autoplay; encrypted-media';

export function mediaPlayer(media, title) {
  const provider = MEDIA_PROVIDER_LABELS[media?.provider];
  const src = embedUrl(media);
  if (!provider || !src) return null;
  const video = media.provider === 'youtube' || media.provider === 'vimeo';
  const name = String(title || '').trim();
  const height = video
    ? null
    : media.provider === 'soundcloud'
      ? AUDIO_HEIGHTS.soundcloud[String(media.mediaId).split('/')[1] === 'sets' ? 'set' : 'track']
      : AUDIO_HEIGHTS.spotify[media.type];
  return {
    src,
    provider,
    kind: video ? 'video' : 'audio',
    height,
    // The button reads "Play: <title>", so a list of buttons can be told apart.
    playLabel: `Play: ${name || `the ${video ? 'video' : 'recording'} on ${provider}`}`,
    frameTitle: name ? `${name} (${provider})` : `${provider} ${video ? 'video' : 'player'}`,
    allow: video ? VIDEO_ALLOW : AUDIO_ALLOW,
  };
}
