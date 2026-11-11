// The landing page's media links (issue #121): parseMediaUrl(), readStart()
// and embedUrl(), which the editor's preview resolves a draft with and the
// page builds its player from. A copy of server/src/mediaUrl.js, which
// documents the rules; the two are kept in step by the cases in
// server/src/mediaUrl.cases.js, which mediaUrl.test.js runs through both.

export const MEDIA_PROVIDERS = ['youtube', 'vimeo', 'soundcloud', 'spotify'];
export const MEDIA_PROVIDER_LABELS = { youtube: 'YouTube', vimeo: 'Vimeo', soundcloud: 'SoundCloud', spotify: 'Spotify' };
export const SPOTIFY_TYPES = ['track', 'album', 'playlist', 'episode', 'show'];

const HOSTS = new Map([
  ['youtube.com', 'youtube'],
  ['www.youtube.com', 'youtube'],
  ['m.youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['youtube-nocookie.com', 'youtube'],
  ['www.youtube-nocookie.com', 'youtube'],
  ['vimeo.com', 'vimeo'],
  ['www.vimeo.com', 'vimeo'],
  ['player.vimeo.com', 'vimeo'],
  ['soundcloud.com', 'soundcloud'],
  ['www.soundcloud.com', 'soundcloud'],
  ['m.soundcloud.com', 'soundcloud'],
  ['open.spotify.com', 'spotify'],
]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PATHS = ['embed', 'shorts', 'live', 'v'];
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,32}$/i;
const SOUNDCLOUD_NAME = /^[A-Za-z0-9_-]{1,100}$/;
const SOUNDCLOUD_SECRET = /^s-[A-Za-z0-9]{1,40}$/;
// A profile's own pages, and the site's, which aren't one clip.
const SOUNDCLOUD_TABS = ['tracks', 'albums', 'likes', 'reposts', 'popular-tracks', 'followers', 'following', 'comments', 'spotlight'];
const SOUNDCLOUD_PAGES = ['discover', 'search', 'stream', 'you', 'charts', 'upload', 'settings', 'messages', 'notifications', 'pages', 'people', 'tags', 'mobile'];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_LOCALE = /^intl-[a-z]{2}(?:-[a-z]{2})?$/i;
// Ten hours; a later start is a typo, read as the beginning.
const MAX_START = 36_000;

// A start time as YouTube and Vimeo write it: `90`, `90s`, `1m30s`,
// `1h2m3s`. Anything else is 0.
export function readStart(text) {
  if (typeof text !== 'string') return 0;
  let seconds = null;
  if (/^\d{1,6}$/.test(text)) seconds = Number(text);
  else {
    const match = text.match(/^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/);
    if (match && (match[1] || match[2] || match[3])) {
      seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    }
  }
  return seconds !== null && seconds <= MAX_START ? seconds : 0;
}

// `t` or `start` in the query, else `t` after the #.
function startOf(url) {
  const hash = new URLSearchParams(url.hash.slice(1));
  return readStart(url.searchParams.get('t') ?? url.searchParams.get('start') ?? hash.get('t') ?? '');
}

function youtube(url, parts) {
  let id = null;
  if (url.hostname === 'youtu.be') id = parts.length === 1 ? parts[0] : null;
  else if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v');
  else if (parts.length === 2 && YOUTUBE_PATHS.includes(parts[0])) id = parts[1];
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { provider: 'youtube', mediaId: id, start: startOf(url) };
}

function vimeo(url, parts) {
  let id = null;
  let hash = url.searchParams.get('h') ?? '';
  if (url.hostname === 'player.vimeo.com') {
    if (parts.length === 2 && parts[0] === 'video') id = parts[1];
  } else if (parts.length === 1) {
    id = parts[0];
  } else if (parts.length === 2 && VIMEO_ID.test(parts[0])) {
    // An unlisted video's link: vimeo.com/<id>/<hash>.
    id = parts[0];
    hash = parts[1];
  } else if (parts.length === 3 && parts[0] === 'channels') {
    id = parts[2];
  } else if (parts.length === 4 && ((parts[0] === 'groups' && parts[2] === 'videos') || (['album', 'showcase'].includes(parts[0]) && parts[2] === 'video'))) {
    id = parts[3];
  }
  if (!id || !VIMEO_ID.test(id) || (hash && !VIMEO_HASH.test(hash))) return null;
  return { provider: 'vimeo', mediaId: id, start: startOf(url), ...(hash ? { hash } : {}) };
}

// <user>/<track> or <user>/sets/<playlist>, either with a private link's
// secret after it.
function soundcloud(url, parts) {
  if (!parts.every((part) => SOUNDCLOUD_NAME.test(part)) || SOUNDCLOUD_PAGES.includes(parts[0])) return null;
  const set = parts[1] === 'sets';
  const length = set ? 3 : 2;
  if (parts.length !== length && !(parts.length === length + 1 && SOUNDCLOUD_SECRET.test(parts[length]))) return null;
  if (!set && SOUNDCLOUD_TABS.includes(parts[1])) return null;
  return { provider: 'soundcloud', mediaId: parts.join('/'), start: 0 };
}

// [intl-<lang>/]<type>/<id>, or the player's own embed/<type>/<id>.
function spotify(url, parts) {
  const rest = parts[0] === 'embed' || SPOTIFY_LOCALE.test(parts[0] ?? '') ? parts.slice(1) : parts;
  if (rest.length !== 2 || !SPOTIFY_TYPES.includes(rest[0]) || !SPOTIFY_ID.test(rest[1])) return null;
  return { provider: 'spotify', mediaId: rest[1], start: 0, type: rest[0] };
}

const PARSERS = { youtube, vimeo, soundcloud, spotify };

export function parseMediaUrl(text) {
  if (typeof text !== 'string') return null;
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const provider = HOSTS.get(url.hostname);
  if (!provider) return null;
  return PARSERS[provider](url, url.pathname.split('/').filter(Boolean));
}

export function embedUrl(media) {
  const id = encodeURIComponent(media?.mediaId ?? '');
  const start = Number.isInteger(media?.start) && media.start > 0 ? media.start : 0;
  switch (media?.provider) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start ? `&start=${start}` : ''}`;
    case 'vimeo': {
      const hash = media.hash ? `h=${encodeURIComponent(media.hash)}&` : '';
      return `https://player.vimeo.com/video/${id}?${hash}dnt=1&autoplay=1${start ? `#t=${start}s` : ''}`;
    }
    case 'soundcloud': {
      const path = String(media.mediaId).split('/').map(encodeURIComponent).join('/');
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${path}`)}&auto_play=true`;
    }
    case 'spotify':
      return SPOTIFY_TYPES.includes(media.type) ? `https://open.spotify.com/embed/${media.type}/${id}` : '';
    default:
      return '';
  }
}
