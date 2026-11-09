import type { MediaKind } from '../data/posts';

const LABELS: Record<MediaKind, string> = {
  thumbnails:
    'Drawing of the claim: a terminal window that says it found 145,763 deleted photos in PhotoData/Thumbnails. It is not the original video.',
};

/**
 * A drawn picture for a post, in place of a photo. 16:9, with rounded corners like media on the
 * original site. `compact`: a low banner with the whole drawing in its middle (the post page, so
 * the notes and the write button show without a scroll).
 */
export function Media({ kind, caption, compact = false }: { kind: MediaKind; caption?: string; compact?: boolean }) {
  return (
    <figure className={`media ${compact ? 'media-compact' : ''}`} role="img" aria-label={LABELS[kind]}>
      {kind === 'thumbnails' && <ThumbnailsScene fit={compact ? 'meet' : 'slice'} />}
      {caption && <figcaption className="media-caption">{caption}</figcaption>}
    </figure>
  );
}

const VIEW_BOX = '0 0 640 360';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** A drawing of what the post claims: a terminal that "found" the deleted photos. */
function ThumbnailsScene({ fit }: { fit: 'meet' | 'slice' }) {
  const lines: Array<[string, string]> = [
    ['#8b949e', '> find my deleted iPhone photos'],
    ['#c9d1d9', 'Scanning PhotoData/Thumbnails …'],
    ['#c9d1d9', '2023  ████████████████'],
    ['#c9d1d9', '2024  ██████████████████████'],
    ['#c9d1d9', '2025  ███████████████████'],
    ['#7ee787', 'Found 145,763 photos'],
  ];
  return (
    <svg viewBox={VIEW_BOX} preserveAspectRatio={`xMidYMid ${fit}`} aria-hidden="true">
      <rect width="640" height="360" fill="#1f2937" />
      <rect x="40" y="30" width="560" height="300" rx="12" fill="#0d1117" stroke="#30363d" strokeWidth="2" />
      <rect x="40" y="30" width="560" height="36" rx="12" fill="#161b22" />
      <rect x="40" y="54" width="560" height="12" fill="#161b22" />
      <circle cx="66" cy="48" r="7" fill="#ff5f57" />
      <circle cx="90" cy="48" r="7" fill="#febc2e" />
      <circle cx="114" cy="48" r="7" fill="#28c840" />
      {lines.map(([color, text], index) => (
        <text key={text} x="68" y={112 + index * 36} fill={color} fontFamily={MONO} fontSize="22">
          {text}
        </text>
      ))}
    </svg>
  );
}
