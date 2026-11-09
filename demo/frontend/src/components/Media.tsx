import { useState, type MouseEvent } from 'react';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import type { MediaKind } from '../data/posts';

const LABELS: Record<MediaKind, string> = {
  thumbnails:
    'Drawing of the claim: a terminal window that says it found 145,763 deleted photos in PhotoData/Thumbnails. It is not the original video.',
};

/** The time that the drawing plays: one terminal line after the other. */
const LINE_STEP_S = 0.5;
const LINE_COUNT = 6;
const PLAY_S = LINE_STEP_S * LINE_COUNT + 0.6;

/**
 * A drawn post video, in place of the original video: a poster frame with a play button, like a
 * video post on the original site. Play shows the terminal lines one after the other, with a
 * progress bar, then the poster comes back. 16:9 with rounded corners. `compact`: a low banner
 * with the whole drawing in its middle (the post page, so the notes and the write button show
 * without a scroll).
 */
export function Media({ kind, caption, compact = false }: { kind: MediaKind; caption?: string; compact?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);

  const play = (event: MouseEvent) => {
    // On the timeline, a click on the post opens the post page. The play button only plays.
    event.stopPropagation();
    setRun((count) => count + 1);
    setPlaying(true);
  };

  return (
    <figure className={`media media-video ${compact ? 'media-compact' : ''} ${playing ? 'media-playing' : ''}`}>
      {kind === 'thumbnails' && <ThumbnailsScene key={run} fit={compact ? 'meet' : 'slice'} label={LABELS[kind]} />}
      {playing ? (
        <span
          key={run}
          className="media-progress"
          style={{ animationDuration: `${PLAY_S}s` }}
          onAnimationEnd={() => setPlaying(false)}
          aria-hidden="true"
        />
      ) : (
        <button type="button" className="media-play" onClick={play} aria-label="Play the drawing of the claim">
          <IconPlayerPlayFilled size={compact ? 24 : 28} aria-hidden="true" />
        </button>
      )}
      {caption && <figcaption className="media-caption">{caption}</figcaption>}
    </figure>
  );
}

const VIEW_BOX = '0 0 640 360';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** A drawing of what the post claims: a terminal that "found" the deleted photos. */
function ThumbnailsScene({ fit, label }: { fit: 'meet' | 'slice'; label: string }) {
  const lines: Array<[string, string]> = [
    ['#8b949e', '> find my deleted iPhone photos'],
    ['#c9d1d9', 'Scanning PhotoData/Thumbnails …'],
    ['#c9d1d9', '2023  ████████████████'],
    ['#c9d1d9', '2024  ██████████████████████'],
    ['#c9d1d9', '2025  ███████████████████'],
    ['#7ee787', 'Found 145,763 photos'],
  ];
  return (
    <svg viewBox={VIEW_BOX} preserveAspectRatio={`xMidYMid ${fit}`} role="img" aria-label={label}>
      <rect width="640" height="360" fill="#1f2937" />
      <rect x="40" y="30" width="560" height="300" rx="12" fill="#0d1117" stroke="#30363d" strokeWidth="2" />
      <rect x="40" y="30" width="560" height="36" rx="12" fill="#161b22" />
      <rect x="40" y="54" width="560" height="12" fill="#161b22" />
      <circle cx="66" cy="48" r="7" fill="#ff5f57" />
      <circle cx="90" cy="48" r="7" fill="#febc2e" />
      <circle cx="114" cy="48" r="7" fill="#28c840" />
      {lines.map(([color, text], index) => (
        <text
          key={text}
          className="media-line"
          style={{ animationDelay: `${0.3 + index * LINE_STEP_S}s` }}
          x="68"
          y={112 + index * 36}
          fill={color}
          fontFamily={MONO}
          fontSize="22"
        >
          {text}
        </text>
      ))}
    </svg>
  );
}
