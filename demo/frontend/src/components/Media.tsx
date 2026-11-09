import type { MediaKind } from '../data/posts';

const LABELS: Record<MediaKind, string> = {
  bridge: 'Illustration: a suspension bridge at dusk behind a closed road barrier',
  heat: 'Illustration: a red sky over the city, with 41°C',
  panda: 'Illustration: two red panda cubs on a branch',
};

/** A drawn picture for a post, in place of a photo. 16:9, with rounded corners like media on the original site. */
export function Media({ kind, domain }: { kind: MediaKind; domain?: string }) {
  return (
    <figure className="media" role="img" aria-label={LABELS[kind]}>
      {kind === 'bridge' && <BridgeScene />}
      {kind === 'heat' && <HeatScene />}
      {kind === 'panda' && <PandaScene />}
      {domain && <figcaption className="media-domain">{domain}</figcaption>}
    </figure>
  );
}

const VIEW = { viewBox: '0 0 640 360', preserveAspectRatio: 'xMidYMid slice' } as const;

/** Points on the main cable between the towers, for the vertical hangers. */
function hangers(): [number, number][] {
  const curve = (t: number, a: number, b: number, c: number) => (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c;
  const points: [number, number][] = [];
  for (let i = 1; i < 16; i += 1) {
    const t = i / 16;
    points.push([curve(t, 197, 327, 457), curve(t, 112, 236, 112)]);
  }
  return points;
}

function BridgeScene() {
  return (
    <svg {...VIEW} aria-hidden="true">
      <defs>
        <linearGradient id="bridge-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f3b5c" />
          <stop offset="0.45" stopColor="#c86b5a" />
          <stop offset="0.7" stopColor="#f4a76b" />
        </linearGradient>
        <linearGradient id="bridge-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b5a78" />
          <stop offset="1" stopColor="#14263a" />
        </linearGradient>
        <pattern id="bridge-stripes" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="14" height="28" fill="#e11d48" />
          <rect x="14" width="14" height="28" fill="#fff" />
        </pattern>
      </defs>
      <rect width="640" height="360" fill="url(#bridge-sky)" />
      <circle cx="510" cy="222" r="30" fill="#ffd8a8" opacity="0.95" />
      <rect y="246" width="640" height="114" fill="url(#bridge-water)" />
      <g stroke="#ffd8a8" strokeLinecap="round" opacity="0.55">
        <path d="M482 262h56" strokeWidth="3" />
        <path d="M492 276h36" strokeWidth="2.5" />
        <path d="M499 290h22" strokeWidth="2" />
      </g>
      <g fill="#0f1f2e">
        <rect x="190" y="104" width="14" height="150" />
        <rect x="450" y="104" width="14" height="150" />
        <rect x="186" y="150" width="22" height="5" />
        <rect x="446" y="150" width="22" height="5" />
        <rect x="-10" y="232" width="660" height="9" />
      </g>
      <g stroke="#0f1f2e" fill="none" strokeWidth="3">
        <path d="M-10 214 Q100 168 197 112 Q327 236 457 112 Q560 168 650 214" />
      </g>
      <g stroke="#0f1f2e" strokeWidth="1.6">
        {hangers().map(([x, y]) => (
          <line key={x} x1={x} y1={y} x2={x} y2={232} />
        ))}
      </g>
      <g>
        <rect x="56" y="300" width="8" height="60" fill="#e5e7eb" />
        <rect x="234" y="300" width="8" height="60" fill="#e5e7eb" />
        <rect x="40" y="282" width="218" height="30" rx="4" fill="url(#bridge-stripes)" stroke="#fff" strokeWidth="2" />
        <rect x="92" y="236" width="114" height="34" rx="5" fill="#e11d48" />
        <text x="149" y="259" textAnchor="middle" fill="#fff" fontSize="17" fontWeight="800" letterSpacing="2" fontFamily="var(--font)">
          CLOSED
        </text>
      </g>
    </svg>
  );
}

function HeatScene() {
  return (
    <svg {...VIEW} aria-hidden="true">
      <defs>
        <linearGradient id="heat-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fcd34d" />
          <stop offset="0.5" stopColor="#f97316" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
        <radialGradient id="heat-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fffbeb" />
          <stop offset="0.45" stopColor="#fef3c7" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="640" height="360" fill="url(#heat-sky)" />
      <circle cx="488" cy="100" r="128" fill="url(#heat-sun)" />
      <circle cx="488" cy="100" r="46" fill="#fffbeb" />
      <g fill="none" stroke="#fff7ed" strokeWidth="3" strokeLinecap="round" opacity="0.4">
        <path d="M380 196c20-10 40 10 60 0s40 10 60 0 40 10 60 0 40 10 60 0" />
        <path d="M410 216c20-10 40 10 60 0s40 10 60 0 40 10 60 0" />
      </g>
      <text x="48" y="178" fill="#fff" fontSize="104" fontWeight="800" fontFamily="var(--font)" letterSpacing="-3">
        41°C
      </text>
      <text x="54" y="214" fill="#fff7ed" fontSize="15" fontWeight="700" fontFamily="var(--font)" letterSpacing="3">
        SATURDAY · RECORD HIGH
      </text>
      <path
        fill="#7f1d1d"
        d="M0 360V300h34v-24h30v16h22v-36h40v44h18v-26h36v18h26v-48h44v58h20v-24h32v14h30v-44h46v54h22v-30h38v22h24v-40h40v50h18v-18h36v34h84V360Z"
      />
      <g fill="#fcd34d" opacity="0.8">
        <rect x="98" y="268" width="6" height="6" />
        <rect x="112" y="282" width="6" height="6" />
        <rect x="218" y="258" width="6" height="6" />
        <rect x="232" y="274" width="6" height="6" />
        <rect x="346" y="262" width="6" height="6" />
        <rect x="360" y="280" width="6" height="6" />
        <rect x="476" y="268" width="6" height="6" />
        <rect x="490" y="284" width="6" height="6" />
      </g>
    </svg>
  );
}

function PandaFace({ x, y, scale, tilt }: { x: number; y: number; scale: number; tilt: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale})`}>
      <ellipse cx="0" cy="78" rx="52" ry="44" fill="#7c2d12" />
      <ellipse cx="-52" cy="-44" rx="22" ry="26" fill="#fef3c7" />
      <ellipse cx="52" cy="-44" rx="22" ry="26" fill="#fef3c7" />
      <ellipse cx="-50" cy="-40" rx="13" ry="17" fill="#7c2d12" />
      <ellipse cx="50" cy="-40" rx="13" ry="17" fill="#7c2d12" />
      <ellipse cx="0" cy="0" rx="66" ry="54" fill="#c2410c" />
      <ellipse cx="-40" cy="16" rx="17" ry="13" fill="#fff7ed" />
      <ellipse cx="40" cy="16" rx="17" ry="13" fill="#fff7ed" />
      <ellipse cx="-24" cy="-20" rx="10" ry="7" fill="#fff7ed" />
      <ellipse cx="24" cy="-20" rx="10" ry="7" fill="#fff7ed" />
      <ellipse cx="0" cy="24" rx="30" ry="22" fill="#fff7ed" />
      <g stroke="#7c2d12" strokeWidth="6" strokeLinecap="round">
        <path d="M-24 2l-6 22" />
        <path d="M24 2l6 22" />
      </g>
      <circle cx="-24" cy="-4" r="7.5" fill="#1c1917" />
      <circle cx="24" cy="-4" r="7.5" fill="#1c1917" />
      <circle cx="-21.5" cy="-6.5" r="2.4" fill="#fff" />
      <circle cx="26.5" cy="-6.5" r="2.4" fill="#fff" />
      <ellipse cx="0" cy="15" rx="9" ry="6" fill="#1c1917" />
      <path d="M-8 25q8 7 16 0" stroke="#1c1917" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  );
}

function PandaScene() {
  return (
    <svg {...VIEW} aria-hidden="true">
      <defs>
        <linearGradient id="panda-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecfccb" />
          <stop offset="1" stopColor="#84cc16" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#panda-bg)" />
      <g fill="#4d7c0f" opacity="0.55">
        <rect x="40" y="0" width="18" height="360" rx="6" />
        <rect x="92" y="0" width="12" height="360" rx="5" />
        <rect x="560" y="0" width="18" height="360" rx="6" />
        <rect x="604" y="0" width="12" height="360" rx="5" />
      </g>
      <g stroke="#ecfccb" strokeWidth="3" opacity="0.6">
        <path d="M40 90h18M40 190h18M92 140h12M92 250h12M560 120h18M560 230h18M604 70h12M604 180h12" />
      </g>
      <g fill="#65a30d">
        <ellipse cx="78" cy="96" rx="34" ry="9" transform="rotate(-24 78 96)" />
        <ellipse cx="124" cy="150" rx="30" ry="8" transform="rotate(18 124 150)" />
        <ellipse cx="530" cy="130" rx="34" ry="9" transform="rotate(24 530 130)" />
        <ellipse cx="584" cy="208" rx="30" ry="8" transform="rotate(-18 584 208)" />
      </g>
      <PandaFace x={250} y={176} scale={0.92} tilt={-6} />
      <PandaFace x={398} y={168} scale={1} tilt={5} />
      <path d="M-10 292C150 270 470 270 650 300" stroke="#78350f" strokeWidth="26" fill="none" strokeLinecap="round" />
      <path d="M-10 286C150 264 470 264 650 294" stroke="#92400e" strokeWidth="6" fill="none" opacity="0.6" />
    </svg>
  );
}
