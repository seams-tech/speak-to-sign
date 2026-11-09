import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import type { MediaKind } from '../data/posts';

const LABELS: Record<MediaKind, string> = {
  thumbnails:
    'Drawing of the claim: a terminal window that says it found 145,763 deleted photos in PhotoData/Thumbnails. It is not the original video.',
};

/** The time that the drawing plays: one terminal line after the other, then a pause, then again. */
const LINE_STEP_S = 0.5;
const LINE_COUNT = 6;
const PLAY_S = LINE_STEP_S * LINE_COUNT + 0.6;
const LOOP_MS = (PLAY_S + 2.4) * 1000;

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * A drawn post video, in place of the original video. It plays by itself in a loop, as a muted
 * video does on the original site: the terminal lines come one after the other with a progress
 * bar, the last frame stays for a moment, then it starts again. No play button, so nothing asks
 * for a click. Still (the last frame) when the reader asks for less motion. 16:9 with rounded
 * corners. `compact`: a low banner with the whole drawing in its middle (the post page, so the
 * notes and the write button show without a scroll).
 */
export function Media({ kind, caption, compact = false }: { kind: MediaKind; caption?: string; compact?: boolean }) {
  const still = useReducedMotion();
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (still) return;
    const timer = window.setInterval(() => setRun((count) => count + 1), LOOP_MS);
    return () => window.clearInterval(timer);
  }, [still]);

  return (
    <figure className={`media media-video ${compact ? 'media-compact' : ''} ${still ? '' : 'media-playing'}`}>
      {kind === 'thumbnails' && <ThumbnailsScene key={`scene-${run}`} fit={compact ? 'meet' : 'slice'} label={LABELS[kind]} />}
      {!still && <span key={`bar-${run}`} className="media-progress" style={{ animationDuration: `${PLAY_S}s` }} aria-hidden="true" />}
      {caption && <figcaption className="media-caption">{caption}</figcaption>}
    </figure>
  );
}

/** A small still of the drawn video, as in a quoted post. */
export function MediaThumb({ kind }: { kind: MediaKind }) {
  return (
    <span className="media-thumb" aria-hidden="true">
      {kind === 'thumbnails' && <ThumbnailsScene fit="slice" label={LABELS[kind]} />}
      <span className="media-thumb-play">
        <IconPlayerPlayFilled size={14} />
      </span>
    </span>
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
