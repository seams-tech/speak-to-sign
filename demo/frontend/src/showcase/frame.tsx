import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconLock, IconMicrophone, IconPlayerRecordFilled, IconX } from '@tabler/icons-react';

/** A screen drawn at a fixed size and scaled to the width of its box. */
export function ScaledScreen({ width = 1280, height = 800, children }: { width?: number; height?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const update = () => setScale(box.clientWidth / width);
    const observer = new ResizeObserver(update);
    observer.observe(box);
    update();
    return () => observer.disconnect();
  }, [width]);
  return (
    <div className="ss-scaled" ref={ref} style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="ss-scaled-inner" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** A screen drawn at a fixed size, scaled to fit inside its box both ways, and centred. */
export function FitScreen({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const update = () => setScale(Math.min(box.clientWidth / width, box.clientHeight / height));
    const observer = new ResizeObserver(update);
    observer.observe(box);
    update();
    return () => observer.disconnect();
  }, [width, height]);
  return (
    <div className="ss-fit" ref={ref}>
      <div className="ss-fit-inner" style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** A light browser window: three dots, an address bar and, in the big window, a close button. */
export function BrowserChrome({ url, onClose, children }: { url: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="ss-browser">
      <div className="ss-browser-bar">
        <span className="ss-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="ss-url" aria-hidden="true">
          <IconLock size={11} stroke={2} />
          {url}
        </span>
        {onClose && (
          <button type="button" className="ss-browser-close" onClick={onClose} aria-label="Close">
            <IconX size={16} stroke={2.2} aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True when the reader asks for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * A hand-drawn border around an example screen, so the screen reads as a sketch of an idea
 * and not as the real site. Two strokes go through a noise displacement whose seed steps a few
 * times a second, so the line "boils" like a drawing. Still when the reader asks for less motion.
 */
export function DrawnFrame({ tag, tone = 'example', children }: { tag: string; tone?: 'example' | 'live'; children: ReactNode }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const still = useReducedMotion();
  return (
    <figure className={`ss-drawn ss-drawn-${tone}`}>
      <svg className="ss-drawn-lines" aria-hidden="true" focusable="false">
        <defs>
          <Wobble id={`${id}a`} seed={2} scale={4.5} still={still} />
          <Wobble id={`${id}b`} seed={7} scale={6} still={still} />
        </defs>
        <rect className="ss-drawn-stroke" filter={`url(#${id}a)`} />
        <rect className="ss-drawn-stroke ss-drawn-stroke-2" filter={`url(#${id}b)`} />
      </svg>
      <figcaption className="ss-drawn-tag">
        <svg aria-hidden="true" focusable="false">
          <defs>
            <Wobble id={`${id}t`} seed={4} scale={2.5} still={still} />
          </defs>
          <rect filter={`url(#${id}t)`} />
        </svg>
        {tone === 'live' && <span className="ss-live-dot" aria-hidden="true" />}
        {tag}
      </figcaption>
      <div className="ss-drawn-body">{children}</div>
    </figure>
  );
}

function Wobble({ id, seed, scale, still }: { id: string; seed: number; scale: number; still: boolean }) {
  const seeds = [seed, seed + 11, seed + 23, seed + 37].join(';');
  return (
    <filter id={id} x="-4%" y="-4%" width="108%" height="108%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed={seed}>
        {!still && <animate attributeName="seed" values={seeds} dur="0.84s" calcMode="discrete" repeatCount="indefinite" />}
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

const BARS = [5, 9, 14, 20, 12, 24, 30, 18, 11, 22, 28, 16, 9, 14, 26, 32, 20, 12, 7, 16, 24, 18, 10, 5];

/** Sound bars that move while someone speaks. Still when the reader asks for less motion. */
export function Waveform({ small = false }: { small?: boolean }) {
  return (
    <span className={`ss-wave ${small ? 'ss-wave-small' : ''}`} aria-hidden="true">
      {BARS.map((height, index) => (
        <i key={index} style={{ height: small ? height * 0.55 : height, animationDelay: `${(index % 8) * 0.09}s` }} />
      ))}
    </span>
  );
}

/** The Seams Wallet voice card, as the Wallet draws it over an app. */
export function WalletVoiceCard({ say, compact = false }: { say: string; compact?: boolean }) {
  return (
    <div className={`sw-card ${compact ? 'sw-card-compact' : ''}`}>
      <div className="sw-origin">
        <IconLock size={12} stroke={2} aria-hidden="true" />
        staging.sign.seams.sh
      </div>
      <div className="sw-title">
        <span className="sw-mic" aria-hidden="true">
          <IconMicrophone size={compact ? 15 : 17} stroke={2} />
        </span>
        <span>
          <b>Say this to sign</b>
          <span className="sw-sub">Speak-to-Sign · VoiceID</span>
        </span>
      </div>
      <p className="sw-say">“{say}”</p>
      <Waveform small={compact} />
      <span className="sw-btn">
        <IconPlayerRecordFilled size={compact ? 11 : 13} aria-hidden="true" /> Recording
      </span>
      <p className="sw-foot">
        Secured by <b>seams</b>
      </p>
    </div>
  );
}
