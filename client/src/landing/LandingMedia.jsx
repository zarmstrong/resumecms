import { useEffect, useRef, useState } from 'react';
import { mediaPlayer } from './mediaPlayer.js';
import { textParagraphs } from './resolveLanding.js';

// A media section (issue #121): one clip, as resolveLanding() gives it
// ({ media, caption, transcript, poster? }, the parsed link and never the
// link itself). Until a visitor presses play it's a facade drawn from this
// site alone (the poster, or a plain panel, and a "Play: <title>" button),
// so nothing is requested from the provider, not even a thumbnail; the
// press swaps in the provider's player (mediaPlayer.js: its privacy-mode
// address, a title, a minimal `allow`, no more referrer than the origin)
// and moves focus to it. The editor's preview draws the same facade. The
// caption and the transcript are plain text, the transcript under a
// <details>. Keyed by the player's address, so a changed link starts over
// at the facade.
export function LandingMedia({ section }) {
  const player = mediaPlayer(section.media, section.title);
  if (!player) return null;
  return <MediaClip key={player.src} player={player} section={section} />;
}

function MediaClip({ player, section }) {
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef(null);

  useEffect(() => {
    if (playing) frameRef.current?.focus();
  }, [playing]);

  const size = player.kind === 'audio' ? { height: player.height } : undefined;
  return (
    <div className={`l-media l-media-${player.kind}`}>
      {playing ? (
        <iframe
          ref={frameRef}
          className="l-media-frame"
          src={player.src}
          title={player.frameTitle}
          allow={player.allow}
          allowFullScreen={player.kind === 'video'}
          referrerPolicy="strict-origin-when-cross-origin"
          style={size}
        />
      ) : (
        <div className={`l-media-facade${section.poster ? ' l-media-with-poster' : ''}`} style={size}>
          {section.poster && (
            <img
              className="l-media-poster"
              src={section.poster.src}
              alt={section.poster.alt}
              width={section.poster.width}
              height={section.poster.height}
              loading="lazy"
              decoding="async"
            />
          )}
          <button type="button" className="l-media-play" onClick={() => setPlaying(true)}>
            <svg className="l-media-play-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span className="l-media-play-label">{player.playLabel}</span>
          </button>
          <span className="l-media-note">Plays from {player.provider}</span>
        </div>
      )}
      {section.caption && <p className="l-media-caption">{section.caption}</p>}
      {section.transcript.trim() && (
        <details className="l-media-transcript">
          <summary className="l-media-transcript-toggle">Transcript</summary>
          {textParagraphs(section.transcript).map((paragraph, i) => (
            <p key={i} className="l-media-transcript-text">
              {paragraph}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
