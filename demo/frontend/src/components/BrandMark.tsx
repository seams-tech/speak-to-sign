/**
 * The Speak-to-Sign mark: a speech bubble in the text colour with sound bars. The bars are white,
 * or `--brand-mark-bars` where the bubble is light (a dark theme).
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3C8.8 3 3 8.3 3 14.8c0 3.6 1.8 6.8 4.6 9L6.4 29l5.6-2.9c1.3.4 2.6.5 4 .5 7.2 0 13-5.3 13-11.8S23.2 3 16 3Z"
        fill="currentColor"
      />
      <g className="brand-mark-bars" stroke="var(--brand-mark-bars, #fff)" strokeWidth="2.4" strokeLinecap="round">
        <path d="M10.5 13v3.6" />
        <path d="M14.2 10.4v8.8" />
        <path d="M17.9 12v5.6" />
        <path d="M21.6 13.6v2.4" />
      </g>
    </svg>
  );
}
