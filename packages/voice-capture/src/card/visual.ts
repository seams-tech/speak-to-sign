import { createElement, render, type ComponentType } from 'preact';
import { VoiceBeam, type VoiceBeamProps } from 'voice-glow';
import { styleNonce } from '../config';
import type { VoiceActivityEvent } from '../microphone';
import { VoiceRibbon, type VoiceCheckingStyle } from './ribbon';

// The build maps VoiceBeam's React imports to Preact.
const VoiceBeamView = VoiceBeam as unknown as ComponentType<VoiceBeamProps>;

type VisualPhase = 'idle' | 'listening' | 'processing';

/** Shared by enrollment, unlock and signing. The recorder remains the only audio owner. */
export class VoiceVisual {
  readonly element: SVGSVGElement;
  readonly glow: HTMLDivElement;
  private readonly ribbon: VoiceRibbon;
  private readonly prompt: HTMLElement;
  private readonly themeObserver: MutationObserver;
  private phase: VisualPhase = 'idle';
  private disposed = false;

  constructor(document: Document, prompt: HTMLElement, checking: VoiceCheckingStyle) {
    this.prompt = prompt;
    this.ribbon = new VoiceRibbon(document, checking);
    this.element = this.ribbon.element;
    this.glow = document.createElement('div');
    this.glow.className = 'seams-voiceid-glow';
    this.glow.setAttribute('aria-hidden', 'true');
    // Mount off-document so the page's style nonce can be applied before styles connect.
    this.render();
    const nonce = styleNonce();
    if (nonce) for (const style of this.glow.querySelectorAll('style')) style.nonce = nonce;
    this.themeObserver = new MutationObserver(this.render);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  }

  listen(): void { this.setPhase('listening'); }
  add(event: VoiceActivityEvent): void { this.ribbon.add(event); }
  checking(): void { this.setPhase('processing'); }
  accept(): void { this.setPhase('idle'); }
  /** The glow keeps working while the line rests flat, for a status line that takes its place. */
  flatten(): void {
    if (this.disposed) return;
    this.phase = 'processing';
    this.ribbon.setPhase('idle');
    this.render();
  }
  ready(): void { this.setPhase('idle'); }

  /** The glow settles while the ribbon closes into the success seal; resolves when the check is drawn. */
  succeed(begin: () => void): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.phase = 'idle';
    this.render();
    return this.ribbon.succeed(begin);
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.themeObserver.disconnect();
    this.ribbon.dispose();
    render(null, this.glow);
  }

  private setPhase(phase: VisualPhase): void {
    if (this.disposed) return;
    this.phase = phase;
    this.ribbon.setPhase(phase);
    this.render();
  }

  private readonly render = (): void => {
    if (this.disposed) return;
    const theme = this.prompt.closest('[data-theme]')?.getAttribute('data-theme')
      ?? this.prompt.ownerDocument.documentElement.getAttribute('data-theme');
    render(createElement(VoiceBeamView, {
      className: 'seams-voiceid-beam',
      theme: theme === 'light' ? 'light' : 'dark',
      level: this.ribbon.readLevel,
      processing: this.phase === 'processing',
      active: this.phase !== 'idle',
      staticColors: true,
      colorVariant: 'ocean',
      borderRadius: Number.parseFloat(getComputedStyle(this.prompt).borderRadius) || 16,
      children: null,
    }), this.glow);
  };
}
