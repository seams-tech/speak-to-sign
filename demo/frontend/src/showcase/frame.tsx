import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconLock, IconMicrophone } from '@tabler/icons-react';

/** A screen drawn at a fixed size (1280 × 800) and scaled to the width of its box. */
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
    <div className="sc-scaled" ref={ref} style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="sc-scaled-inner" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** A browser window around a screen: three dots and an address bar. */
export function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="sc-window">
      <div className="sc-window-bar" aria-hidden="true">
        <span className="sc-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="sc-url">
          <IconLock size={12} stroke={2} />
          {url}
        </span>
      </div>
      {children}
    </div>
  );
}

const BARS = [6, 10, 16, 22, 14, 26, 32, 20, 12, 24, 30, 18, 10, 16, 28, 34, 22, 14, 8, 18, 26, 20, 12, 6];

/** Sound bars that move while someone speaks. Still when the reader asks for less motion. */
export function Waveform({ small = false }: { small?: boolean }) {
  return (
    <span className={`sc-wave ${small ? 'sc-wave-small' : ''}`} aria-hidden="true">
      {BARS.map((height, index) => (
        <i key={index} style={{ height: small ? height * 0.6 : height, animationDelay: `${(index % 8) * 0.09}s` }} />
      ))}
    </span>
  );
}

/** The Seams Wallet voice card, drawn over a concept screen. */
export function VoiceOverlay({ say }: { say: string }) {
  return (
    <div className="vo">
      <div className="vo-head">
        <span className="vo-mic">
          <IconMicrophone size={18} stroke={2} />
        </span>
        <span>
          <b>Seams Wallet</b>
          <span className="vo-sub">Read this aloud</span>
        </span>
      </div>
      <p className="vo-say">“{say}”</p>
      <Waveform small />
      <p className="vo-foot">Same speaker · words match · signs this one request</p>
    </div>
  );
}
