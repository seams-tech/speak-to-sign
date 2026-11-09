import type { MediaKind } from '../data/posts';

const LABELS: Record<MediaKind, string> = {
  pentagon: 'Drawing of the fake picture: a gray smoke cloud next to a large five-sided building. The real picture was made by AI.',
};

/** A drawn picture for a post, in place of a photo. 16:9, with rounded corners like media on the original site. */
export function Media({ kind, caption }: { kind: MediaKind; caption?: string }) {
  return (
    <figure className="media" role="img" aria-label={LABELS[kind]}>
      {kind === 'pentagon' && <PentagonScene />}
      {caption && <figcaption className="media-caption">{caption}</figcaption>}
    </figure>
  );
}

const VIEW = { viewBox: '0 0 640 360', preserveAspectRatio: 'xMidYMid slice' } as const;

/** The five corners of a flat pentagon seen at an angle, as an SVG points string. */
function pentagon(cx: number, cy: number, rx: number, ry: number): string {
  return Array.from({ length: 5 }, (_, i) => {
    const angle = ((-90 + i * 72) * Math.PI) / 180;
    return `${(cx + rx * Math.cos(angle)).toFixed(1)},${(cy + ry * Math.sin(angle)).toFixed(1)}`;
  }).join(' ');
}

/** A drawing, not the fake AI picture: smoke beside a large five-sided building. */
function PentagonScene() {
  const cx = 360;
  const cy = 268;
  return (
    <svg {...VIEW} aria-hidden="true">
      <defs>
        <linearGradient id="pg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#aebccb" />
          <stop offset="1" stopColor="#dfe5ea" />
        </linearGradient>
        <linearGradient id="pg-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8aa070" />
          <stop offset="1" stopColor="#5f7a4a" />
        </linearGradient>
        <filter id="pg-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect width="640" height="360" fill="url(#pg-sky)" />
      <rect y="226" width="640" height="134" fill="url(#pg-ground)" />
      <path d="M0 330 L640 300" stroke="#c9c4bb" strokeWidth="10" />
      <g filter="url(#pg-blur)" opacity="0.92">
        <circle cx="236" cy="18" r="70" fill="#cbd2d9" />
        <circle cx="150" cy="34" r="72" fill="#b8c0c9" />
        <circle cx="214" cy="70" r="66" fill="#9ca3af" />
        <circle cx="164" cy="104" r="60" fill="#858c97" />
        <circle cx="200" cy="140" r="52" fill="#6b7280" />
        <circle cx="176" cy="176" r="44" fill="#565d69" />
        <circle cx="192" cy="208" r="36" fill="#454b55" />
        <circle cx="180" cy="236" r="30" fill="#3a3f47" />
      </g>
      <polygon points={pentagon(cx, cy + 16, 196, 66)} fill="#8f8a82" />
      <polygon points={pentagon(cx, cy, 196, 66)} fill="#d8d3ca" stroke="#b9b3a8" strokeWidth="2" />
      <polygon points={pentagon(cx, cy, 150, 50)} fill="none" stroke="#c4beb3" strokeWidth="2" />
      <polygon points={pentagon(cx, cy, 104, 35)} fill="none" stroke="#c4beb3" strokeWidth="2" />
      <polygon points={pentagon(cx, cy, 62, 21)} fill="#7f9a62" stroke="#b9b3a8" strokeWidth="2" />
    </svg>
  );
}
