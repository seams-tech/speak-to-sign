// Dev only (`pnpm dev`): a preview of the Seams Wallet's voice card on this page. The real card
// runs in the Wallet frame, on the Wallet's origin, so it shows a new card only after the Wallet
// ships it. This preview opens the card of @seams/voice-capture (a dev dependency, which can be
// newer than the Wallet's) in the page, with the demo's Wallet theme. "New style" turns the theme's voice card keys on and off
// (voiceLine, voiceEcho, voiceEchoDeep, voiceBeam, voiceLineWidth, voiceEchoWidth). It records
// with the real microphone and signs nothing.

import { configureVoiceCapture } from '@seams/voice-capture';
import { openPhraseCard, type PhraseSurface } from '@seams/voice-capture/card';
import type { ThemeName } from '../showcase/theme';
import { walletThemeVars } from '../seams/walletTheme';
import './cardPreview.css';

/** The theme's keys for the voice card: "New style" adds or removes them. */
const isVoiceKey = (name: string) => /^--seams-(colors|shape)-voice/.test(name);

const SENTENCE = 'this technical claim has no proof yet';

// The card's level detector loads one asset (its audio worklet). The dev server serves the
// package's asset folder from node_modules.
configureVoiceCapture({ assetBase: new URL('/node_modules/@seams/voice-capture/dist/assets/', location.origin).href });

function pageTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function openPreview(newStyle: { on: boolean }) {
  const overlay = document.createElement('div');
  overlay.className = 'card-preview';
  const toggle = document.createElement('label');
  toggle.className = 'card-preview-toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = newStyle.on;
  toggle.append(box, ' New style');
  const host = document.createElement('div');
  host.className = 'card-preview-host';
  const theme = pageTheme();
  host.dataset.theme = theme;
  const vars = walletThemeVars(theme);
  const paint = () => {
    for (const [name, value] of Object.entries(vars)) {
      if (!isVoiceKey(name) || newStyle.on) host.style.setProperty(name, value);
      else host.style.removeProperty(name);
    }
  };
  paint();
  box.addEventListener('change', () => {
    newStyle.on = box.checked;
    paint();
  });
  overlay.append(toggle, host);
  document.body.append(overlay);

  const stop = new AbortController();
  let surface: PhraseSurface | null = null;
  const close = () => {
    stop.abort();
    surface?.close();
    overlay.remove();
  };
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  surface = openPhraseCard({
    sentence: SENTENCE,
    signal: stop.signal,
    detector: 'level',
    autoStart: true,
    frame: { parent: host, controls: 'back_and_close' },
  });
  void (async () => {
    try {
      const recording = await surface.record();
      console.debug('[card preview] recording', recording.kind);
      if (recording.kind !== 'recorded') return;
      await surface.show({
        kind: 'result',
        label: '',
        headline: 'Recorded',
        caption: SENTENCE,
        detail: 'This preview signs nothing.',
        action: { label: 'Done' },
        line: 'seal',
      });
    } catch (cause) {
      console.debug('[card preview] stopped', cause);
    } finally {
      close();
    }
  })();
}

const newStyle = { on: true };
const button = document.createElement('button');
button.type = 'button';
button.className = 'card-preview-button';
button.textContent = 'Preview voice card';
button.addEventListener('click', () => openPreview(newStyle));
document.body.append(button);
