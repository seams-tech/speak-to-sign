import { styleNonce } from '../config';
import type { VoiceCaptureEvent } from '../microphone';
import { useSystemVoiceMicrophone } from '../microphoneInput';
import type { VoiceCheckingStyle, VoiceLineStyle } from './ribbon';
import { ROW_EASE, ROW_IN_DELAY_MS, ROW_IN_MS, ROW_OUT_MS, ROW_STAGGER_MS } from './rowMotion';
import { VoiceVisual } from './visual';

const CSS = `
.seams-voiceid-activation-surface { width: min(100%, 26.25rem); margin: 0 auto; background: transparent; }
/* Inside an operation's card the card is the frame: the prompt fills it edge to edge. */
.seams-voiceid-activation-surface.seams-voiceid-in-card { width: 100%; }
.seams-voiceid-in-card .seams-voiceid-prompt {
  width: 100%;
  padding-top: 0.75rem;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.seams-voiceid-prompt {
  box-sizing: border-box;
  position: relative;
  width: min(100%, 26.25rem);
  margin: 0 auto;
  padding: 3.5rem 1.5rem 1.5rem;
  display: grid;
  /* Named rows. The context row is empty (0 high) unless the card shows the text that its sentence
     speaks for. A host that sets its own rows keeps these names. */
  grid-template-rows: [context] auto [title] auto [phrase] minmax(6rem, auto) [line] 5rem [status] minmax(3.375rem, auto) [action] minmax(5rem, auto);
  border: 1px solid var(--seams-colors-borderPrimary, #303b41);
  border-radius: var(--seams-shape-card, 16px);
  background: var(--seams-colors-colorBackground, #192024);
  color: var(--seams-colors-textPrimary, #eff2f3);
  /* While the card fills a taller frame (fillFrame), the spare height stays below the rows. */
  align-content: start;
  text-align: center;
  font-family: var(--seams-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  -webkit-font-smoothing: antialiased;
}
/* A card that comes back after a Wallet confirm shows its rows only when the frame has eased to
   its size (prompt.ts observeSize); until then they stay in the middle of the frame. */
.seams-voiceid-prompt[data-rows-held] > :not(.seams-voiceid-glow, .seams-voiceid-close, .seams-voiceid-progress-slot) {
  opacity: 0 !important;
  transition: none !important;
}
.seams-voiceid-prompt[data-frame-fill="center"] {
  align-content: center;
}
.seams-voiceid-prompt {
  transition: opacity 180ms var(--seams-ease-out, cubic-bezier(0.23, 1, 0.32, 1)), transform 180ms var(--seams-ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
@starting-style {
  .seams-voiceid-prompt { opacity: 0; transform: translateY(4px); }
  /* A card that continues another, or shows again after a Wallet confirm, has no entrance. */
  .seams-voiceid-prompt.seams-voiceid-entered { opacity: 1; transform: none; }
  /* The button it replaces was enabled a moment ago; this one dims from there. */
  .seams-voiceid-prompt.seams-voiceid-entered .seams-voiceid-primary:disabled { opacity: 1; }
}
/* A card that holds focus itself (until its first control is ready, or after a confirm). */
.seams-voiceid-prompt[tabindex="-1"]:focus { outline: none; }
/* Each line owns its row. The download overlays the rows line, status and action; an auto-placed
   line would move to new rows. */
.seams-voiceid-prompt > .seams-voiceid-context { grid-row: context; grid-column: 1; }
.seams-voiceid-prompt > h2 { grid-row: title; grid-column: 1; }
.seams-voiceid-prompt > .seams-voiceid-phrase { grid-row: phrase; grid-column: 1; }
.seams-voiceid-prompt > .seams-voiceid-ribbon { grid-row: line; grid-column: 1; }
.seams-voiceid-prompt > .seams-voiceid-status { grid-row: status; grid-column: 1; }
.seams-voiceid-progress-slot { grid-row: action; grid-column: 1; min-width: 0; align-self: center; }
.seams-voiceid-progress-slot:empty { visibility: hidden; }
.seams-voiceid-activation-surface .seams-voiceid-record-slot { transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1) 80ms, visibility 0s linear 0s; }
.seams-voiceid-activation-surface[data-preparation="loading"] .seams-voiceid-record-slot { opacity: 0; visibility: hidden; transition: none; }
@media (prefers-reduced-motion: reduce) {
  .seams-voiceid-prompt { transform: none; transition: opacity 150ms ease; }
  @starting-style { .seams-voiceid-prompt { transform: none; } }
  .seams-voiceid-ribbon { transition: none !important; }
}
.seams-voiceid-prompt h2 {
  font-size: 0.85rem;
  line-height: 1.4;
  font-weight: 500;
  color: var(--seams-colors-textSecondary, #9cabb3);
  margin: 0.5rem 0 1rem;
}
.seams-voiceid-prompt.seams-voiceid-management {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem 1.25rem 1.375rem;
  border-radius: var(--seams-shape-card, 1.5rem);
  text-align: start;
  font-size: 0.875rem;
  line-height: 1.5;
}
.seams-voiceid-management-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-inline-start: -0.5rem;
}
.seams-voiceid-management h2 {
  margin: 0;
  color: var(--seams-colors-textPrimary, #eff2f3);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.seams-voiceid-management .seams-voiceid-management-intro {
  margin: -0.125rem 0 0.25rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
}
.seams-voiceid-management button {
  appearance: none;
  margin: 0;
  color: var(--seams-colors-textPrimary, #eff2f3);
  font: inherit;
  transition: background-color 140ms ease;
}
.seams-voiceid-management button:disabled { opacity: 0.5; cursor: default; }
.seams-voiceid-management .seams-voiceid-management-back {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 0;
  border-radius: var(--seams-shape-control, 10px);
  background: transparent;
}
.seams-voiceid-management-enrollment {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.125rem 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 0.75rem;
  background: var(--seams-colors-surface, #202b31);
  color: var(--seams-colors-textSecondary, #9cabb3);
}
.seams-voiceid-management-summary { text-align: end; }
.seams-voiceid-management-value { color: var(--seams-colors-textPrimary, #eff2f3); font-weight: 500; }
.seams-voiceid-management-enrollment-detail:not(:empty)::before { content: ' · '; }
.seams-voiceid-management-enrollment[data-enrollment="adapted"] > .seams-voiceid-management-summary {
  grid-area: 2 / 1;
  text-align: start;
  font-size: 0.8125rem;
}
.seams-voiceid-management-enrollment > .seams-voiceid-management-reset { grid-area: 1 / 2 / 3; }
.seams-voiceid-management-enrollment[data-state] .seams-voiceid-management-value { display: none; }
.seams-voiceid-management-enrollment[data-state] .seams-voiceid-management-enrollment-detail::before { content: none; }
.seams-voiceid-management .seams-voiceid-management-reset {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--seams-colors-borderPrimary, #303b41);
  border-radius: var(--seams-shape-control, 10px);
  background: transparent;
  font-size: 0.8125rem;
  font-weight: 600;
}
.seams-voiceid-management .seams-voiceid-management-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  min-height: 44px;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--seams-colors-borderPrimary, #303b41);
  border-radius: 0.75rem;
  background: transparent;
  text-align: start;
}
.seams-voiceid-management-action > svg { color: var(--seams-colors-textSecondary, #9cabb3); }
.seams-voiceid-management-action-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  font-weight: 600;
}
.seams-voiceid-management-chip {
  padding: 0.125rem 0.5rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--seams-colors-textPrimary, #eff2f3), transparent 93%);
  font-size: 0.75rem;
  font-weight: 500;
}
.seams-voiceid-management-action-detail {
  display: block;
  margin-top: 0.125rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
  font-size: 0.8125rem;
}
.seams-voiceid-management .seams-voiceid-management-action[data-state="pending"] {
  opacity: 1;
  border-color: var(--seams-colors-borderHover, #46545b);
  background: var(--seams-colors-surface, #202b31);
}
.seams-voiceid-management-action[data-state="pending"] > svg { visibility: hidden; }
.seams-voiceid-management [data-state="pending"] .seams-voiceid-management-action-detail,
.seams-voiceid-management [data-state="pending"] .seams-voiceid-management-enrollment-detail {
  color: var(--seams-colors-textPrimary, #eff2f3);
}
.seams-voiceid-management [data-state="error"] .seams-voiceid-management-action-detail,
.seams-voiceid-management [data-state="error"] .seams-voiceid-management-enrollment-detail {
  color: var(--seams-colors-error, oklch(0.74 0.166 19));
}
.seams-voiceid-management .seams-voiceid-management-section {
  margin: 0.5rem 0 -0.25rem;
  padding-inline-start: 0.125rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
/* The status line is read by assistive technology; a message for a hidden row is also shown. */
.seams-voiceid-prompt.seams-voiceid-management > [role="status"] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.seams-voiceid-prompt.seams-voiceid-management > [role="status"][data-placement="dialog"] {
  position: relative;
  width: auto;
  height: auto;
  margin: 0;
  overflow: visible;
  clip-path: none;
  white-space: normal;
  color: var(--seams-colors-error, oklch(0.74 0.166 19));
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
[dir='rtl'] .seams-voiceid-management svg { transform: scaleX(-1); }
@media (hover: hover) {
  .seams-voiceid-management button:hover:not(:disabled) {
    background: var(--seams-colors-surface2, var(--seams-colors-surface, #202b31));
  }
}
.seams-voiceid-prompt .seams-voiceid-phrase {
  font-size: clamp(1.75rem, 6vw, 2.25rem);
  font-weight: 600;
  line-height: 1.17;
  letter-spacing: -0.035em;
  text-wrap: balance;
  max-width: 21rem;
  align-self: center;
  margin: 0 auto;
  transition: opacity 180ms var(--seams-ease-out, cubic-bezier(0.23, 1, 0.32, 1)), color 300ms ease;
}
.seams-voiceid-ribbon {
  display: block;
  width: 308px;
  max-width: 100%;
  height: 64px;
  margin: auto;
  overflow: visible;
}
.seams-voiceid-ribbon .seams-voiceid-ribbon-check { stroke: var(--seams-colors-colorBackground, #192024); }
/* The theme can colour the voice line (with its ring and its seal) and its three echo lines,
   and set their widths. With none of these values, the line has the card's text colour. */
.seams-voiceid-ribbon { color: var(--seams-colors-voiceLine, currentColor); }
.seams-voiceid-ribbon .seams-voiceid-ribbon-line { stroke-width: var(--seams-shape-voiceLineWidth, 1px); }
.seams-voiceid-ribbon .seams-voiceid-ribbon-echo {
  stroke-width: var(--seams-shape-voiceEchoWidth, 0.65px);
  color: var(--seams-colors-voiceEcho, var(--seams-colors-voiceLine, currentColor));
}
.seams-voiceid-ribbon .seams-voiceid-ribbon-echo[data-layer="2"] {
  color: var(--seams-colors-voiceEchoDeep, var(--seams-colors-voiceEcho, var(--seams-colors-voiceLine, currentColor)));
}
/* The pixel style (voiceLine: 'pixels'): dots in X blue tones by default, the lightest in the
   middle row. The theme colours the three bands: voiceEcho (the middle row), voiceLine (rows
   1 and 2 from it) and voiceEchoDeep (rows 3 and 4). */
.seams-voiceid-ribbon-pixel { fill: var(--seams-colors-voiceEchoDeep, #1a6fb0); }
.seams-voiceid-ribbon-pixel[data-band="1"] { fill: var(--seams-colors-voiceLine, #1d9bf0); }
.seams-voiceid-ribbon-pixel[data-band="0"] { fill: var(--seams-colors-voiceEcho, #8ecdf8); }
.seams-voiceid-prompt .seams-voiceid-phrase.seams-voiceid-success-headline {
  display: grid;
  align-content: end;
  font-size: 18px;
  letter-spacing: normal;
  line-height: 1.4;
}
.seams-voiceid-prompt .seams-voiceid-status.seams-voiceid-success-message { font-size: 0.8125rem; }
/* The glow is decorative and cannot intercept record, retry or cancel controls. */
.seams-voiceid-glow { position: absolute; inset: 0; pointer-events: none; border-radius: inherit; z-index: 0; }
.seams-voiceid-glow[hidden] { display: none; }
.seams-voiceid-beam { width: 100%; height: 100%; border-radius: inherit; }
.seams-voiceid-prompt > :not(.seams-voiceid-glow) { position: relative; z-index: 1; }
.seams-voiceid-prompt > .seams-voiceid-close { position: absolute; }
.seams-voiceid-prompt .seams-voiceid-status {
  font-size: 0.75rem;
  line-height: 1.5;
  min-height: 3.375rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
  margin: 0;
}
.seams-voiceid-prompt button {
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.seams-voiceid-prompt button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.seams-voiceid-prompt .seams-voiceid-close {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  width: 2.5rem;
  height: 2.5rem;
  background: transparent;
  border: 0;
  border-radius: var(--seams-shape-control, 10px);
  color: inherit;
  display: grid;
  place-items: center;
  color: var(--seams-colors-textSecondary, #9cabb3);
}
.seams-voiceid-prompt .seams-voiceid-close.seams-voiceid-back {
  right: auto;
  left: 0.75rem;
}
/* Minimize sits beside Close, in the trailing corner: one button width and a small gap in. */
.seams-voiceid-prompt .seams-voiceid-close.seams-voiceid-minimize { right: 3.375rem; }
.seams-voiceid-prompt .seams-voiceid-record-slot {
  grid-row: action;
  grid-column: 1;
  align-self: center;
  width: 100%;
  box-sizing: border-box;
}
.seams-voiceid-prompt .seams-voiceid-primary {
  width: 100%;
  min-height: var(--seams-shape-controlHeight, 44px);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  border: 0;
  border-radius: var(--seams-shape-control, 10px);
  /* The theme's main button. A page that sets no button colours keeps the ink button. */
  background: var(--seams-colors-buttonBackground, var(--seams-colors-textPrimary, #eff2f3));
  color: var(--seams-colors-textButton, var(--seams-colors-colorBackground, #192024));
}
.seams-voiceid-prompt .seams-voiceid-primary {
  transition: opacity 180ms ease, visibility 0s linear 0s;
}
.seams-voiceid-prompt .seams-voiceid-primary:disabled {
  opacity: 0.5;
  cursor: wait;
}
.seams-voiceid-prompt .seams-voiceid-record-slot { position: relative; }
/* The link sits under the button and never moves it. */
.seams-voiceid-prompt .seams-voiceid-microphone {
  position: absolute;
  top: 100%;
  left: 50%;
  translate: -50% 0;
  white-space: nowrap;
  transition: opacity 150ms ease, visibility 0s linear 0s;
  margin-top: 0.5rem;
  padding: 0.25rem;
  border: 0;
  background: transparent;
  color: var(--seams-colors-textSecondary, #9cabb3);
  font-size: 0.75rem;
}
.seams-voiceid-prompt button[hidden],
.seams-voiceid-prompt [hidden] {
  display: none !important;
}
/* The record button and the microphone link fade out in place and keep the row's layout. */
.seams-voiceid-activation-surface:not(.seams-voiceid-in-card) .seams-voiceid-record-slot > button[hidden] {
  display: block !important;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 150ms ease, visibility 0s linear 150ms;
}
.seams-voiceid-activation-surface:not(.seams-voiceid-in-card) .seams-voiceid-record-slot > .seams-voiceid-primary[hidden] {
  margin-inline: auto;
}
/* While VoiceID loads, its bar takes the answer line's place, its message the status line's,
   and its retry the record button's. */
.seams-voiceid-progress-slot:has(> .seams-voiceid-model-download),
.seams-voiceid-progress-slot > .seams-voiceid-model-download { display: contents; }
.seams-voiceid-model-download > * { position: relative; z-index: 1; grid-column: 1; align-self: center; }
.seams-voiceid-prompt > .seams-voiceid-status { transition: opacity 180ms ease; }
.seams-voiceid-prompt:has(.seams-voiceid-model-download:not([data-state="ready"])) > .seams-voiceid-ribbon,
.seams-voiceid-prompt:has(.seams-voiceid-model-download:not([data-state="ready"])) > .seams-voiceid-status {
  opacity: 0;
  visibility: hidden;
  transition: opacity 180ms ease, visibility 0s linear 180ms;
}
/* The download's rows fade in over the rows they replace, and fade out when VoiceID is ready. */
.seams-voiceid-model-download > * { transition: opacity 180ms ease 150ms; }
@starting-style { .seams-voiceid-model-download > * { opacity: 0; } }
/* Two texts in one place must not cross: the download's rows leave first, then the card's return. */
.seams-voiceid-model-download[data-state="ready"] > * { opacity: 0; transition-duration: 120ms; transition-delay: 0s; }
.seams-voiceid-prompt:has(.seams-voiceid-model-download[data-state="ready"]) > .seams-voiceid-ribbon {
  transition: opacity 180ms ease 120ms;
}
.seams-voiceid-prompt:has(.seams-voiceid-model-download[data-state="ready"]) > .seams-voiceid-status {
  transition: opacity 180ms ease 160ms;
}
.seams-voiceid-prompt:has(.seams-voiceid-model-download:not([data-state="ready"])) > .seams-voiceid-phrase { opacity: 0.35; }
.seams-voiceid-prompt:has(.seams-voiceid-model-download[data-state="failed"]) > .seams-voiceid-record-slot { display: none; }
.seams-voiceid-model-download progress {
  grid-row: line;
  justify-self: center;
  appearance: none;
  display: block;
  width: min(100%, 308px);
  height: 6px;
  border: 0;
  border-radius: 999px;
  overflow: hidden;
  background: var(--seams-colors-surface, #202b31);
  color: var(--seams-colors-textPrimary, #eff2f3);
}
.seams-voiceid-model-download progress::-webkit-progress-bar { background: var(--seams-colors-surface, #202b31); }
.seams-voiceid-model-download progress::-webkit-progress-value { background: var(--seams-colors-textPrimary, #eff2f3); border-radius: 999px; }
/* The bar stays full and still while the models start: the start blocks the main thread, and
   a looping animation would compete with it on a software-rendered page. */
.seams-voiceid-model-download progress::-moz-progress-bar { background: var(--seams-colors-textPrimary, #eff2f3); border-radius: 999px; }
.seams-voiceid-model-download p {
  grid-row: status;
  align-self: start;
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--seams-colors-textSecondary, #9cabb3);
  font-variant-numeric: tabular-nums;
}
.seams-voiceid-model-download button { grid-row: action; }
/* A phrase card shows its check and its result in the same card. */
.seams-voiceid-prompt > .seams-voiceid-status-line { grid-row: line; grid-column: 1; }
.seams-voiceid-status-line {
  transition: opacity 120ms ease;
  display: block;
  width: 308px;
  max-width: 100%;
  height: 64px;
  margin: auto;
  overflow: visible;
  opacity: 0;
  /* The theme can colour the check's line and the seal that it closes into (the disc behind the
     tick): voiceSeal, else the voice line's colour, else the card's text colour. */
  color: var(--seams-colors-voiceSeal, var(--seams-colors-voiceLine, var(--seams-colors-textPrimary, #eff2f3)));
}
.seams-voiceid-ribbon { transition: opacity 120ms ease; }
.seams-voiceid-prompt[data-phrase-line="status"] > .seams-voiceid-ribbon { opacity: 0; }
.seams-voiceid-prompt[data-phrase-line="status"] > .seams-voiceid-status-line { opacity: 1; }
.seams-voiceid-status-line rect {
  fill: var(--seams-colors-surface3, #2b363c);
  transition: fill 240ms ease, opacity 240ms ease;
}
.seams-voiceid-status-line rect[data-state="done"],
.seams-voiceid-status-line rect[data-state="run"] { fill: currentColor; }
.seams-voiceid-status-line rect[data-state="run"] { animation: seams-voiceid-segment-pulse 900ms ease-in-out infinite alternate; }
.seams-voiceid-status-line rect[data-state="fail"] { fill: var(--seams-colors-error, oklch(0.74 0.166 19)); }
.seams-voiceid-status-line rect[data-state="wait"] {
  fill: var(--seams-colors-info, oklch(0.7 0.13 255));
  animation: seams-voiceid-segment-pulse 1600ms ease-in-out infinite alternate;
}
.seams-voiceid-status-line rect[data-state="skip"] { opacity: 0.5; }
@keyframes seams-voiceid-segment-pulse { from { opacity: 0.35; } to { opacity: 1; } }
.seams-voiceid-status-bar,
.seams-voiceid-status-ring,
.seams-voiceid-status-seal,
.seams-voiceid-status-check { opacity: 0; transform-box: fill-box; transform-origin: center; }
.seams-voiceid-status-bar { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; }
.seams-voiceid-status-ring { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.seams-voiceid-status-seal { fill: currentColor; transform: scale(0); }
.seams-voiceid-status-check {
  fill: none;
  stroke: var(--seams-colors-colorBackground, #192024);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
}
.seams-voiceid-status-line[data-seal] rect { opacity: 0; }
.seams-voiceid-status-line[data-seal] > :not(rect) { opacity: 1; }
.seams-voiceid-prompt .seams-voiceid-phrase.seams-voiceid-phrase-dim { color: var(--seams-colors-textMuted, #6f7f87); }
.seams-voiceid-prompt[data-phrase-view] > h2 { min-height: 1.19rem; }
.seams-voiceid-prompt[data-phrase-view="check"] {
  grid-template-rows: [context] auto [title] auto [phrase] minmax(6rem, auto) [line] 5rem [status] minmax(3.375rem, auto) [action] 0;
}
.seams-voiceid-prompt[data-phrase-view="check"] .seams-voiceid-record-slot { display: none; }
/* A card that records by itself (autoStart) has no Record row: its rows sit in the middle. */
.seams-voiceid-prompt[data-auto-start] {
  grid-template-rows: [context] auto [title] auto [phrase] minmax(6rem, auto) [line] 5rem [status] minmax(3.375rem, auto) [action] 0;
}
.seams-voiceid-prompt[data-auto-start] > .seams-voiceid-record-slot { display: none; }
/* The result reads from the top as one group: the seal, the headline under it, the caption and
   the detail, then the button. Every row has its content's height, so the card has no empty
   band, and the line row glides to its new place (phraseCard.ts transition). An empty label
   takes no room. */
.seams-voiceid-prompt[data-phrase-view="result"] {
  grid-template-rows: [context] auto [title] auto [line] 4.5rem [phrase] auto [status] auto [action] auto;
}
.seams-voiceid-prompt[data-phrase-view="result"] > h2:empty { display: none; }
.seams-voiceid-prompt[data-phrase-view="result"] > .seams-voiceid-phrase { margin-top: 0.5rem; }
.seams-voiceid-prompt[data-phrase-view="result"] > .seams-voiceid-status { min-height: 0; margin-top: 0.375rem; }
.seams-voiceid-prompt[data-phrase-view="result"] > .seams-voiceid-record-slot { margin-top: 1.5rem; }
.seams-voiceid-prompt[data-phrase-view] .seams-voiceid-microphone { display: none; }
.seams-voiceid-prompt .seams-voiceid-close { transition: opacity 150ms ease, visibility 0s linear 0s; }
/* The check hides Back and Close, as the caller works; Minimize stays. */
.seams-voiceid-prompt[data-phrase-view="check"] .seams-voiceid-close:not(.seams-voiceid-minimize) {
  opacity: 0;
  visibility: hidden;
  transition: opacity 150ms ease, visibility 0s linear 150ms;
}
.seams-voiceid-status.seams-voiceid-two-lines > span { display: block; }
.seams-voiceid-status .seams-voiceid-caption {
  margin-bottom: 0.125rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--seams-colors-textPrimary, #eff2f3);
}
.seams-voiceid-status a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
/* A result's receipt (PhraseResultView.receipt): a quiet box between the caption and the detail,
   with a checked row for each check of the result, in the seal's colour. */
.seams-voiceid-status .seams-voiceid-receipt {
  margin: 0.625rem 0;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--seams-colors-borderPrimary, rgba(239, 242, 243, 0.16));
  border-radius: 0.875rem;
  text-align: left;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--seams-colors-textPrimary, #eff2f3);
}
.seams-voiceid-receipt-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
}
.seams-voiceid-receipt-source {
  font-size: 0.75rem;
  color: var(--seams-colors-textSecondary, #9aa4ab);
}
.seams-voiceid-receipt-rows {
  display: grid;
  grid-template-columns: 1rem auto minmax(0, 1fr);
  column-gap: 0.5rem;
  row-gap: 0.25rem;
  align-items: center;
}
.seams-voiceid-receipt-check {
  display: flex;
  color: var(--seams-colors-voiceSeal, var(--seams-colors-voiceLine, var(--seams-colors-textPrimary, #eff2f3)));
}
.seams-voiceid-receipt-check svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.seams-voiceid-receipt-label { color: var(--seams-colors-textSecondary, #9aa4ab); }
.seams-voiceid-receipt-value { overflow-wrap: anywhere; }
.seams-voiceid-receipt-foot {
  display: block;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--seams-colors-borderPrimary, rgba(239, 242, 243, 0.16));
  font-size: 0.75rem;
}
.seams-voiceid-heard-mark {
  background: none;
  color: var(--seams-colors-error, oklch(0.74 0.166 19));
  text-decoration: underline;
  text-decoration-thickness: 1.5px;
  text-underline-offset: 3px;
}
.seams-voiceid-prompt .seams-voiceid-primary:has(> .seams-voiceid-action-icon) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.seams-voiceid-action-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.seams-voiceid-prompt[data-phrase-view] .seams-voiceid-primary:disabled { cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .seams-voiceid-status-line rect { animation: none !important; transition: none; }
}
/* The note layout: a card with a context, in the shape of a form. The context (a note) sits
   in a soft box under its label, the sentence to read sits centred in a blue box under its own
   label, and one button right under it changes with the card: Record or the voice line while
   it records, the check, then the result's action. The status sits at the foot, under the
   button. */
.seams-voiceid-prompt[data-context] {
  grid-template-rows: [context] auto [title] auto [phrase] auto [line] 4.5rem [action] 0 [status] auto;
  text-align: start;
  /* The height of the button: 4.5rem as the voice line, with either line style, and 3.5rem as
     Record or a result's action. The microphone's circle follows it. */
  --seams-voiceid-button-height: 4.5rem;
  /* The fill of what the person says: a tint of the main button's colour (voiceFill). */
  --seams-voiceid-tint: 16%;
  --seams-voiceid-fill: var(--seams-colors-voiceFill, color-mix(in srgb, var(--seams-colors-buttonBackground, #1d9bf0) var(--seams-voiceid-tint), var(--seams-colors-colorBackground, #192024)));
}
/* A form is as wide as an app's dialog for a note: 560 px. */
.seams-voiceid-activation-surface:has(> .seams-voiceid-prompt[data-context]),
.seams-voiceid-prompt[data-context] {
  width: min(100%, 35rem);
}
[data-theme="light"] .seams-voiceid-prompt[data-context] { --seams-voiceid-tint: 14%; }
[data-theme="dark"] .seams-voiceid-prompt[data-context] { --seams-voiceid-tint: 24%; }
/* A button (Record, Try again, a result's action) takes the place of the voice line. */
.seams-voiceid-prompt[data-context]:not([data-phrase-view="check"]):has(> .seams-voiceid-record-slot > .seams-voiceid-primary:not([hidden])) {
  --seams-voiceid-button-height: 3.5rem;
  grid-template-rows: [context] auto [title] auto [phrase] auto [line] 0 [action] auto [status] auto;
}
/* A result's caption and detail read before its button. */
.seams-voiceid-prompt[data-context][data-phrase-view="result"]:not([data-phrase-view="check"]):has(> .seams-voiceid-record-slot > .seams-voiceid-primary:not([hidden])) {
  grid-template-rows: [context] auto [title] auto [phrase] auto [status] auto [line] 0 [action] auto;
}
.seams-voiceid-prompt[data-context]:not([data-phrase-view="check"]):has(> .seams-voiceid-record-slot > .seams-voiceid-primary:not([hidden])) > :is(.seams-voiceid-ribbon, .seams-voiceid-status-line) {
  visibility: hidden;
}
.seams-voiceid-prompt[data-context] > .seams-voiceid-glow { display: none; }
/* A line across the card under the context: above it is what the person posts, below it is
   the voice signature. */
.seams-voiceid-prompt .seams-voiceid-context {
  margin: 0 -1.5rem 1.25rem;
  padding: 0 1.5rem 1.25rem;
  border: 0;
  border-bottom: 1px solid var(--seams-colors-borderPrimary, #303b41);
}
.seams-voiceid-prompt .seams-voiceid-context-label {
  display: block;
  margin-bottom: 0.375rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
  font-size: 0.9375rem;
  line-height: 1.3;
}
.seams-voiceid-prompt .seams-voiceid-context > blockquote {
  max-height: 8.5rem;
  margin: 0;
  padding: 0.75rem 1rem;
  overflow-y: auto;
  border-radius: 1rem;
  background: var(--seams-colors-surface, #202b31);
  color: var(--seams-colors-textPrimary, #eff2f3);
  font-size: 1rem;
  line-height: 1.45;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
/* A result has no label: its empty title takes no room. */
.seams-voiceid-prompt[data-context] > h2:empty { display: none; }
.seams-voiceid-prompt[data-context] > h2 {
  margin: 0 0 0.625rem;
  color: var(--seams-colors-textPrimary, #eff2f3);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
}
.seams-voiceid-prompt[data-context] .seams-voiceid-phrase {
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  /* A thin gap to the button: the sentence and the voice belong together. */
  margin: 0 0 0.5rem;
  padding: 0.875rem 1.25rem;
  border-radius: 1rem;
  /* Blue, apart from the grey box of the context: this is what the person says. */
  background: var(--seams-voiceid-fill);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: normal;
  line-height: 1.35;
  text-align: center;
}
.seams-voiceid-prompt[data-context] .seams-voiceid-phrase.seams-voiceid-success-headline {
  display: block;
  padding: 0;
  background: none;
  font-size: 1.25rem;
  font-weight: 700;
}
/* The status sits at the foot of the card, under the button: "Listening", or the check. */
.seams-voiceid-prompt[data-context] .seams-voiceid-status {
  min-height: 1.125rem;
  margin: 0;
  padding: 0.625rem 0 0;
  text-align: center;
}
.seams-voiceid-prompt[data-context][data-phrase-view="result"] .seams-voiceid-status { padding: 0.25rem 0 0.75rem; }
/* Under the button, the check's caption and detail share one line at the size of "Listening",
   so the card keeps its height when the check starts. A long line ends with an ellipsis. */
.seams-voiceid-prompt[data-context]:not([data-phrase-view="result"]) .seams-voiceid-status.seams-voiceid-two-lines {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.seams-voiceid-prompt[data-context]:not([data-phrase-view="result"]) .seams-voiceid-status.seams-voiceid-two-lines > span {
  display: inline;
}
.seams-voiceid-prompt[data-context]:not([data-phrase-view="result"]) .seams-voiceid-status .seams-voiceid-caption {
  margin: 0;
  font-size: inherit;
}
.seams-voiceid-prompt[data-context]:not([data-phrase-view="result"]) .seams-voiceid-status .seams-voiceid-caption-detail:not(:empty)::before {
  content: ' · ';
}
/* A result's link, such as the transaction in a block explorer: short, in the main button's
   colour, underlined only on hover. */
.seams-voiceid-prompt[data-context] .seams-voiceid-status a {
  color: var(--seams-colors-buttonBackground, var(--seams-colors-textPrimary, #eff2f3));
  font-weight: 500;
  text-decoration: none;
}
.seams-voiceid-prompt[data-context] .seams-voiceid-status a:hover,
.seams-voiceid-prompt[data-context] .seams-voiceid-status a:focus-visible { text-decoration: underline; }
/* The voice line and the check, in the main button's colours, with either line style. The line
   keeps its drawing size; the taller button gives it room above and below. */
.seams-voiceid-prompt[data-context] > :is(.seams-voiceid-ribbon, .seams-voiceid-status-line) {
  box-sizing: border-box;
  width: 100%;
  height: 4.5rem;
  padding-block: 0.5rem;
  overflow: hidden;
  border-radius: 9999px;
  background: var(--seams-colors-buttonBackground, var(--seams-colors-textPrimary, #eff2f3));
  color: var(--seams-colors-textButton, var(--seams-colors-colorBackground, #192024));
}
.seams-voiceid-prompt[data-context] .seams-voiceid-ribbon .seams-voiceid-ribbon-echo { color: currentColor; }
.seams-voiceid-prompt[data-context] .seams-voiceid-status-line rect {
  fill: color-mix(in srgb, currentColor 35%, transparent);
}
.seams-voiceid-prompt[data-context] .seams-voiceid-status-line rect[data-state="done"],
.seams-voiceid-prompt[data-context] .seams-voiceid-status-line rect[data-state="run"] { fill: currentColor; }
.seams-voiceid-prompt[data-context] .seams-voiceid-status-check {
  stroke: var(--seams-colors-buttonBackground, var(--seams-colors-textPrimary, #eff2f3));
}
.seams-voiceid-prompt[data-context][data-voice-line="pixels"] {
  --seams-voiceid-pixel-background: var(--seams-colors-voicePixelBackground, var(--seams-colors-buttonBackground, var(--seams-colors-textPrimary, #eff2f3)));
  --seams-voiceid-pixel-ink: var(--seams-colors-textButton, var(--seams-colors-colorBackground, #192024));
}
.seams-voiceid-prompt[data-context][data-voice-line="pixels"] > :is(.seams-voiceid-ribbon, .seams-voiceid-status-line) {
  background: var(--seams-voiceid-pixel-background);
  color: var(--seams-voiceid-pixel-ink);
}
.seams-voiceid-prompt[data-context][data-voice-line="pixels"] .seams-voiceid-status-check {
  stroke: var(--seams-voiceid-pixel-background);
}
/* On the button, the dots are the button's text colour: full in the middle row, then mixed a
   little and more with the button's colour (white, light and light blue on X blue). */
.seams-voiceid-prompt[data-context] .seams-voiceid-ribbon-pixel[data-band="0"] { fill: var(--seams-voiceid-pixel-ink); }
.seams-voiceid-prompt[data-context] .seams-voiceid-ribbon-pixel[data-band="1"] {
  fill: color-mix(in srgb, var(--seams-voiceid-pixel-ink) 80%, var(--seams-voiceid-pixel-background));
}
.seams-voiceid-prompt[data-context] .seams-voiceid-ribbon-pixel[data-band="2"] {
  fill: color-mix(in srgb, var(--seams-voiceid-pixel-ink) 55%, var(--seams-voiceid-pixel-background));
}
/* The microphone at the left of the button, as on an app's own voice button: on Record, on the
   voice line while the card records, and on the check. A result's button has none. Its circle
   keeps the same gap to the button's top, left and bottom, so it follows the button's round end.
   The line leaves the icon its room. */
.seams-voiceid-prompt[data-context] > .seams-voiceid-line-icon {
  --seams-voiceid-icon-gap: 0.375rem;
  grid-row: line / span 2;
  grid-column: 1;
  align-self: center;
  justify-self: start;
  z-index: 2;
  display: grid;
  place-items: center;
  width: calc(var(--seams-voiceid-button-height) - 2 * var(--seams-voiceid-icon-gap));
  height: calc(var(--seams-voiceid-button-height) - 2 * var(--seams-voiceid-icon-gap));
  margin-inline-start: var(--seams-voiceid-icon-gap);
  border-radius: 50%;
  transition: width 180ms ease, height 180ms ease;
  background: var(--seams-colors-textButton, var(--seams-colors-colorBackground, #192024));
  color: var(--seams-colors-buttonBackground, var(--seams-colors-textPrimary, #eff2f3));
  pointer-events: none;
}
.seams-voiceid-line-icon > svg { grid-area: 1 / 1; width: 46%; height: 46%; }
/* The tick waits, undrawn, in the same place as the microphone (phraseCard.ts sealIcon). */
.seams-voiceid-line-icon-check { opacity: 0; }
.seams-voiceid-line-icon-check > path { stroke-dasharray: 1; stroke-dashoffset: 1; }
/* In a form card the check's line ends in the microphone's circle, not in a ring and a seal: the
   bar draws back into the circle from the right, and the circle's microphone turns into a tick. */
.seams-voiceid-status-line[data-seal="icon"] > :is(.seams-voiceid-status-ring, .seams-voiceid-status-seal, .seams-voiceid-status-check) { opacity: 0; }
.seams-voiceid-status-line[data-seal="icon"] > .seams-voiceid-status-bar { transform-origin: 0% 50%; }
.seams-voiceid-prompt[data-context][data-phrase-view="result"] > .seams-voiceid-line-icon { display: none; }
.seams-voiceid-prompt[data-context] > :is(.seams-voiceid-ribbon, .seams-voiceid-status-line) {
  box-sizing: border-box;
  padding-inline: calc(var(--seams-voiceid-button-height) + 0.25rem) 1rem;
}
/* The status line's own space below it is the gap above the button, in every view. */
.seams-voiceid-prompt[data-context] > .seams-voiceid-record-slot { margin-top: 0; }
.seams-voiceid-prompt[data-context] .seams-voiceid-primary {
  min-height: 3.5rem;
  border-radius: 9999px;
  font-size: 1.0625rem;
  font-weight: 700;
}
@media (hover: hover) and (pointer: fine) {
  .seams-voiceid-close:hover { background: var(--seams-colors-surface, #202b31); }
  .seams-voiceid-primary:hover:not(:disabled) { opacity: 0.9; }
}
`;
/** The documents that have the prompt's styles. */
const styled = new WeakSet<Document>();

/**
 * Adds the prompt's styles to the document one time: as a constructed stylesheet where the
 * browser has them, so a strict style policy needs no nonce, else as a style element with the
 * page's nonce.
 */
function ensureStyles(document: Document): void {
  if (styled.has(document)) return;
  styled.add(document);
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return;
  } catch {
    // An older browser: use a style element.
  }
  const style = document.createElement('style');
  const nonce = styleNonce();
  if (nonce) style.setAttribute('nonce', nonce);
  style.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

/** How the card shows a phrase: by default as it is, with a capital letter and a full stop. */
export type PhraseDisplay = (phrase: string) => string;

/** A new state of the card's rows. Rows that it leaves out keep their content. */
export type PromptChange = Readonly<{
  title?: string;
  phrase?: string;
  status?: string;
  /** The record button's label, and whether it shows. */
  action?: Readonly<{ label?: string; hidden?: boolean }>;
  /** Runs while the changing rows are out of sight, for state that goes with them. */
  apply?: () => void;
}>;

export class VoicePrompt {
  readonly element: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly phrase: HTMLParagraphElement;
  readonly status: HTMLParagraphElement;
  readonly record: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly progress: HTMLElement;
  /** The wave under the phrase. */
  readonly ribbon: SVGSVGElement;
  /** The row of the record button, which a phrase card reuses for its action. */
  readonly actionRow: HTMLElement;
  private readonly microphone: HTMLButtonElement;
  private microphoneRequested = false;
  private readonly visual: VoiceVisual;
  private disposed = false;
  private pendingChange: PromptChange | null = null;
  private changing: Promise<void> | null = null;
  /** The card has been laid out once, and has since been hidden (a Wallet confirm took its place). */
  private laidOut = false;
  private hidden = false;
  private readonly sizes = new ResizeObserver(this.observeSize.bind(this));
  /** A newer resize stops the one in progress, and takes over what waits for it to end. */
  private frameFill = 0;
  private readonly onFrameFitted: (() => void)[] = [];

  constructor(
    document: Document,
    label: string,
    phrase: string,
    checking: VoiceCheckingStyle = 'ring',
    /** The text to show for a phrase, such as the phrase with its commas. */
    private readonly display: PhraseDisplay = (spoken) => spoken,
  ) {
    ensureStyles(document);
    this.element = document.createElement('section');
    // A wallet surface always hosts the card. Without its own seams-wallet-ui class the
    // card keeps that surface's theme instead of resetting to the default tokens.
    this.element.className = 'seams-voiceid-prompt';
    this.element.setAttribute('aria-label', label);
    this.title = document.createElement('h2');
    this.title.textContent = 'Read aloud';
    this.phrase = document.createElement('p');
    this.phrase.className = 'seams-voiceid-phrase';
    this.phrase.dataset.voiceidPhrase = '';
    this.phrase.setAttribute('aria-live', 'polite');
    this.setPhrase(phrase);
    this.visual = new VoiceVisual(document, this.element, checking);
    this.status = document.createElement('p');
    this.status.className = 'seams-voiceid-status';
    this.status.setAttribute('role', 'status');
    this.record = document.createElement('button');
    this.record.type = 'button';
    this.record.className = 'seams-voiceid-primary';
    this.record.textContent = 'Record';
    this.cancel = cornerButton(document, 'Cancel', CLOSE_PATH);
    this.progress = document.createElement('div');
    this.progress.className = 'seams-voiceid-progress-slot';
    const slot = document.createElement('div');
    slot.className = 'seams-voiceid-record-slot';
    this.actionRow = slot;
    this.ribbon = this.visual.element;
    this.microphone = document.createElement('button');
    this.microphone.type = 'button';
    this.microphone.className = 'seams-voiceid-microphone';
    this.microphone.textContent = 'Use system microphone';
    this.microphone.hidden = true;
    this.microphone.addEventListener('click', this.changeMicrophone);
    slot.append(this.record, this.microphone);
    this.element.append(
      this.visual.glow,
      this.cancel,
      this.title,
      this.phrase,
      this.visual.element,
      this.status,
      slot,
      this.progress,
    );
    this.sizes.observe(this.element);
  }

  /** Draws the voice as wave lines (the default) or as columns of pixels. */
  useVoiceLine(style: VoiceLineStyle): void {
    this.element.dataset.voiceLine = style;
    this.visual.setLineStyle(style);
  }

  /**
   * Shows the text that the sentence speaks for, such as the note that a spoken summary signs,
   * above the sentence. It stays for the check and the result.
   */
  showContext(label: string, text: string): void {
    const document = this.element.ownerDocument;
    const context = document.createElement('figure');
    context.className = 'seams-voiceid-context';
    const caption = document.createElement('figcaption');
    caption.className = 'seams-voiceid-context-label';
    caption.textContent = label;
    const body = document.createElement('blockquote');
    body.textContent = text;
    context.append(caption, body);
    this.title.before(context);
    this.element.append(microphoneIcon(document));
    this.element.dataset.context = '';
  }

  /**
   * In an app's dialog with a step before this card, Back in the leading corner returns to that
   * step. With `close`, Close stays in the trailing corner and ends the whole dialog; without it,
   * Back takes Close's place. Each one ends the card as cancelled. The result is the Back control.
   */
  showBack(close: boolean): HTMLButtonElement {
    if (close) {
      this.cancel.setAttribute('aria-label', 'Close');
      const back = cornerButton(this.element.ownerDocument, 'Back', BACK_PATH);
      back.classList.add('seams-voiceid-back');
      this.cancel.before(back);
      return back;
    }
    this.cancel.classList.add('seams-voiceid-back');
    this.cancel.setAttribute('aria-label', 'Back');
    this.cancel.querySelector('path')?.setAttribute('d', BACK_PATH);
    return this.cancel;
  }

  /**
   * Minimize in the trailing corner, beside Close. It stays in the check, where Close is hidden,
   * so the person can hide the card while the check goes on. The result is the control.
   */
  showMinimize(): HTMLButtonElement {
    const minimize = cornerButton(this.element.ownerDocument, 'Minimize', MINIMIZE_PATH);
    minimize.classList.add('seams-voiceid-minimize');
    this.cancel.before(minimize);
    return minimize;
  }

  /**
   * Moves the rows to a new state. The rows whose content changes fade out together, take their
   * new content and fade in one after another; the other rows stay still. A change that comes
   * during a fade joins it, so no state in between is drawn.
   */
  change(next: PromptChange): Promise<void> {
    this.pendingChange = mergeChange(this.pendingChange, next);
    this.changing ??= this.drainChanges().finally(this.changesDrained);
    return this.changing;
  }

  private readonly changesDrained = (): void => {
    this.changing = null;
  };

  private async drainChanges(): Promise<void> {
    let faded: HTMLElement[] = [];
    while (this.pendingChange && !this.disposed) {
      const next: PromptChange = this.pendingChange;
      this.pendingChange = null;
      const leaving = this.changingRows(next).filter((row) => !faded.includes(row));
      if (leaving.length > 0 && !reducedMotion()) {
        await Promise.all(leaving.map(fadeRowOut));
        faded = this.rowOrder([...faded, ...leaving]);
        if (this.pendingChange) {
          // A newer state came during the fade: write only the newest one.
          this.pendingChange = mergeChange(next, this.pendingChange);
          continue;
        }
      } else {
        faded = this.rowOrder([...faded, ...leaving]);
      }
      if (this.disposed) return;
      this.writeChange(next);
      fadeRowsIn(faded);
      faded = [];
    }
  }

  /** The rows whose visible content `next` changes, top to bottom. */
  private changingRows(next: PromptChange): HTMLElement[] {
    const rows: HTMLElement[] = [];
    if (next.title !== undefined && next.title !== this.title.textContent) rows.push(this.title);
    if (next.phrase !== undefined && next.phrase !== this.phrase.dataset.voiceidPhrase)
      rows.push(this.phrase);
    if (next.status !== undefined && next.status !== this.status.textContent)
      rows.push(this.status);
    const action = next.action;
    if (
      action &&
      ((action.label !== undefined && action.label !== this.record.textContent) ||
        (action.hidden !== undefined && action.hidden !== this.record.hidden))
    )
      rows.push(this.actionRow);
    return rows;
  }

  private rowOrder(rows: readonly HTMLElement[]): HTMLElement[] {
    const order = [this.title, this.phrase, this.status, this.actionRow];
    return order.filter((row) => rows.includes(row));
  }

  private writeChange(next: PromptChange): void {
    if (next.title !== undefined) this.title.textContent = next.title;
    if (next.phrase !== undefined) this.setPhrase(next.phrase);
    if (next.status !== undefined) this.status.textContent = next.status;
    if (next.action?.label !== undefined) this.record.textContent = next.action.label;
    if (next.action?.hidden !== undefined) this.record.hidden = next.action.hidden;
    next.apply?.();
  }

  /** The card is ready to record again, through a change of its rows. */
  readyChange(message: string, next: Omit<PromptChange, 'status'> = {}): Promise<void> {
    return this.change({
      ...next,
      status: message,
      action: { ...next.action, hidden: false },
      apply: () => {
        next.apply?.();
        this.unlockLayout();
        this.visual.ready();
        this.element.dataset.capture = 'ready';
        this.record.disabled = false;
        this.microphone.hidden = !this.microphoneRequested;
      },
    });
  }

  /** Starts without an entrance, because it takes another card's place. */
  skipEntrance(): void {
    this.element.classList.add('seams-voiceid-entered');
  }

  /**
   * In the Wallet iframe the parent eases the frame to every new card size. While the frame is
   * taller than the card, the card fills it, so its edge follows the frame and never jumps; the
   * surface around it keeps the card's own height, which is what the parent hears.
   */
  fillFrame(
    fromCssPx: number = window.innerHeight,
    rows: 'top' | 'center' = 'top',
    onFitted?: () => void,
  ): void {
    if (onFitted) this.onFrameFitted.push(onFitted);
    const surface = this.element.closest<HTMLElement>('.seams-voiceid-hugged');
    if (!surface || this.disposed) {
      this.frameFitted();
      return;
    }
    const fill = ++this.frameFill;
    // A resize that replaces one with centred rows keeps them centred, or they would jump.
    const centred = rows === 'center' || this.element.dataset.frameFill === 'center';
    this.element.style.minHeight = '';
    surface.style.height = '';
    delete this.element.dataset.frameFill;
    const own = this.element.getBoundingClientRect().height;
    if (fromCssPx <= own + 1) {
      this.frameFitted();
      return;
    }
    surface.style.height = `${own}px`;
    if (centred) this.element.dataset.frameFill = 'center';
    let height = fromCssPx;
    this.element.style.minHeight = `${height}px`;
    let fitted = 0;
    const began = performance.now();
    const step = (): void => {
      if (fill !== this.frameFill || this.disposed) return;
      height = Math.min(height, Math.max(window.innerHeight, own));
      this.element.style.minHeight = `${height}px`;
      fitted = window.innerHeight <= own + 1 ? fitted + 1 : 0;
      if (fitted < 2 && performance.now() - began < FRAME_FILL_LIMIT_MS) {
        requestAnimationFrame(step);
        return;
      }
      this.element.style.minHeight = '';
      surface.style.height = '';
      delete this.element.dataset.frameFill;
      this.frameFitted();
    };
    requestAnimationFrame(step);
  }

  private readonly releaseRows = (): void => {
    delete this.element.dataset.rowsHeld;
    fadeRowsIn(this.rows());
  };

  private frameFitted(): void {
    for (const fitted of this.onFrameFitted.splice(0)) fitted();
  }

  /** The card's rows, top to bottom: everything but its glow, its close button and its download. */
  private rows(): Element[] {
    return [...this.element.children].filter(
      (row) =>
        !row.matches('.seams-voiceid-glow, .seams-voiceid-close, .seams-voiceid-progress-slot'),
    );
  }

  /** A Wallet confirm hid the card (wallet-service.css); when it shows again, its rows come back. */
  private observeSize(entries: ResizeObserverEntry[]): void {
    const box = entries.at(-1)?.contentRect;
    if (!box || this.disposed) return;
    if (box.height === 0) {
      if (!this.laidOut) return;
      this.hidden = true;
      this.skipEntrance();
      return;
    }
    if (!this.laidOut) {
      this.laidOut = true;
      if (!this.element.classList.contains('seams-voiceid-entered')) fadeRowsIn(this.rows());
      return;
    }
    if (!this.hidden) return;
    this.hidden = false;
    // The chrome is back at once; the rows wait until the frame has eased to the card's size,
    // because the card follows the parent's ease a frame late and moving rows would show it.
    this.element.dataset.rowsHeld = '';
    this.fillFrame(window.innerHeight, 'center', this.releaseRows);
    const focused = this.element.ownerDocument.activeElement;
    if (!focused || focused === this.element.ownerDocument.body) {
      this.element.tabIndex = -1;
      this.element.focus({ preventScroll: true });
    }
  }

  setPhrase(phrase: string): void {
    const displayPhrase = this.display(phrase);
    this.phrase.textContent = displayPhrase.charAt(0).toUpperCase() + displayPhrase.slice(1) + '.';
    this.phrase.dataset.voiceidPhrase = phrase;
  }

  readonly capture = (event: VoiceCaptureEvent): void => {
    if (this.disposed) return;
    switch (event.kind) {
      case 'opening':
        this.microphoneRequested = true;
        this.microphone.hidden = true;
        return;
      case 'listening':
        this.microphone.hidden = true;
        this.element.dataset.capture = 'listening';
        void this.change({ status: 'Listening', action: { hidden: true } });
        this.visual.listen();
        return;
      case 'activity':
        this.visual.add(event);
        return;
      case 'measured': {
        const quality = event.quality;
        if (quality.noise === 'high')
          this.status.textContent = 'Background noise is high. Move closer to the microphone.';
        return;
      }
      case 'processing':
        this.element.dataset.capture = 'processing';
        this.lockLayout();
        this.visual.checking();
        void this.change({ status: 'Checking your voice…' });
        return;
      default:
        return assertNever(event);
    }
  };

  /**
   * This card replaces `previous` in the same surface. It skips the entrance and starts with the
   * rows that `previous` shows, so the swap does not show; the caller then changes the rows.
   */
  continueFrom(previous: Element): void {
    this.skipEntrance();
    this.element.tabIndex = -1;
    const title = previous.querySelector(':scope > h2')?.textContent;
    const status = previous.querySelector(':scope > .seams-voiceid-status')?.textContent;
    const button = previous.querySelector<HTMLButtonElement>(
      ':scope > .seams-voiceid-record-slot > .seams-voiceid-primary',
    );
    if (title !== undefined && title !== null) this.title.textContent = title;
    if (status !== undefined && status !== null) this.status.textContent = status;
    if (button) {
      this.record.textContent = button.textContent;
      this.record.hidden = button.hidden;
    }
    // A row of `previous` that is still fading in goes on from there, once this card is placed.
    const pairs: [Element | null, Element][] = [
      [previous.querySelector(':scope > h2'), this.title],
      [previous.querySelector(':scope > .seams-voiceid-phrase'), this.phrase],
      [previous.querySelector(':scope > .seams-voiceid-status'), this.status],
      [previous.querySelector(':scope > .seams-voiceid-record-slot'), this.actionRow],
    ];
    const fading = pairs.flatMap(([old, row]) => {
      const opacity = old ? Number(getComputedStyle(old).opacity) : 1;
      return opacity < 0.99 ? [{ row, opacity }] : [];
    });
    if (fading.length > 0) queueMicrotask(() => fading.forEach(continueFade));
  }

  /** Settle the visual when an enrollment sample is accepted. */
  accepted(): void {
    this.visual.accept();
  }

  /** The wave rests flat while the glow keeps working. */
  flattenLine(): void {
    this.visual.flatten();
  }

  /** The glow settles. */
  quietLine(): void {
    this.visual.ready();
  }

  /**
   * Plays the unlock success in place and resolves when the check is drawn. Once
   * the ring has formed it glides to the middle of `area` (the card by default).
   */
  async succeed(
    headline: string,
    message: string,
    area: SuccessArea = this.element.getBoundingClientRect(),
  ): Promise<void> {
    if (this.disposed) return;
    this.element.dataset.capture = 'succeeded';
    this.record.hidden = true;
    this.microphone.hidden = true;
    await this.visual.succeed(this.beginSuccess.bind(this, headline, message, area));
  }

  ready(message: string): void {
    this.unlockLayout();
    this.visual.ready();
    this.element.dataset.capture = 'ready';
    this.status.textContent = message;
    this.record.hidden = false;
    this.record.disabled = false;
    this.microphone.hidden = !this.microphoneRequested;
  }

  private readonly changeMicrophone = (): void => {
    void this.useSystemMicrophone();
  };

  private async useSystemMicrophone(): Promise<void> {
    this.record.disabled = true;
    this.microphone.disabled = true;
    await useSystemVoiceMicrophone();
    if (this.disposed) return;
    this.status.textContent = 'The next recording will use your system microphone.';
    this.record.disabled = false;
    this.microphone.disabled = false;
    this.microphone.hidden = true;
    this.record.focus();
  }

  dispose(): void {
    this.disposed = true;
    this.sizes.disconnect();
    this.microphone.removeEventListener('click', this.changeMicrophone);
    this.visual.stop();
  }

  /** The ribbon turns into the ring and the copy may change, so the card's rows hold their size. */
  private lockLayout(): void {
    for (const part of [this.element, this.phrase, this.status])
      part.style.minHeight = `${part.getBoundingClientRect().height}px`;
    this.element.style.height = this.element.style.minHeight;
  }

  /**
   * The ring has formed: the reading copy fades where it is, only the ring glides
   * to the middle of the free space, and the success copy arrives in place around
   * it, headline first. The rows keep their locked size throughout.
   */
  private async beginSuccess(headline: string, message: string, area: SuccessArea): Promise<void> {
    if (this.disposed) return;
    const ring = this.visual.element.getBoundingClientRect();
    const lift = (area.top + area.bottom - ring.top - ring.bottom) / 2;
    this.visual.element.animate([{ translate: '0 0' }, { translate: `0 ${lift}px` }], {
      duration: 600,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards',
    });
    await Promise.all([this.title, this.phrase, this.status].map(fadeOut));
    if (this.disposed) return;
    this.phrase.textContent = headline;
    this.phrase.classList.add('seams-voiceid-success-headline');
    this.status.textContent = message;
    this.status.classList.add('seams-voiceid-success-message');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [index, part] of [this.phrase, this.status].entries()) {
      part.style.translate = `0 ${lift}px`;
      fadeIn(part, reduced, SUCCESS_COPY_DELAY_MS - FADE_OUT_MS + index * SUCCESS_COPY_STAGGER_MS);
    }
  }

  private unlockLayout(): void {
    for (const part of [this.element, this.phrase, this.status]) part.style.minHeight = '';
    this.element.style.height = '';
  }
}

type SuccessArea = Readonly<{ top: number; bottom: number }>;

// After the ring forms, the old copy leaves together and the new copy arrives 40 ms apart.
const FADE_OUT_MS = 150;
const SUCCESS_COPY_DELAY_MS = 450;
const SUCCESS_COPY_STAGGER_MS = 40;

function fadeOut(element: HTMLElement): Promise<unknown> {
  return element.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: FADE_OUT_MS,
    easing: 'ease-in',
    fill: 'forwards',
  }).finished;
}

function fadeIn(element: HTMLElement, reduced: boolean, delay: number): void {
  element.animate(
    [
      { opacity: 0, transform: reduced ? 'none' : 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ],
    { delay, duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' },
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected capture event: ${String(value)}`);
}

const ROW_MOTION = 'seams-voiceid-row';
/** A frame that never reaches the card's size stops being followed after this time. */
const FRAME_FILL_LIMIT_MS = 800;

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function mergeChange(previous: PromptChange | null, next: PromptChange): PromptChange {
  if (!previous) return next;
  const applies = [previous.apply, next.apply].filter((apply) => apply !== undefined);
  return {
    ...previous,
    ...next,
    action: previous.action || next.action ? { ...previous.action, ...next.action } : undefined,
    apply: applies.length === 0 ? undefined : () => applies.forEach(run),
  };
}

function run(apply: () => void): void {
  apply();
}

function cancelRowMotion(row: Element): void {
  for (const animation of row.getAnimations()) if (animation.id === ROW_MOTION) animation.cancel();
}

/** Fades a row out from where it is; it stays out until it fades in again. */
function fadeRowOut(row: HTMLElement): Promise<unknown> {
  const from = Number(getComputedStyle(row).opacity);
  cancelRowMotion(row);
  const animation = row.animate([{ opacity: from }, { opacity: 0 }], {
    duration: ROW_OUT_MS * from,
    easing: 'ease-in',
    fill: 'forwards',
    id: ROW_MOTION,
  });
  return animation.finished.catch(ignoreCancel);
}

/** Rows arrive one after another, each to the opacity that the card's styles give it. */
function fadeRowsIn(rows: readonly Element[]): void {
  const reduced = reducedMotion();
  for (const [index, row] of rows.entries()) {
    cancelRowMotion(row);
    const to = Number(getComputedStyle(row).opacity);
    if (to === 0) continue;
    row.animate(
      [
        { opacity: 0, transform: reduced ? 'none' : 'translateY(4px)' },
        { opacity: to, transform: 'none' },
      ],
      {
        delay: reduced ? 0 : ROW_IN_DELAY_MS + index * ROW_STAGGER_MS,
        duration: reduced ? 150 : ROW_IN_MS,
        easing: ROW_EASE,
        fill: 'backwards',
        id: ROW_MOTION,
      },
    );
  }
}

function ignoreCancel(): void {}

function continueFade({ row, opacity }: Readonly<{ row: Element; opacity: number }>): void {
  row.animate([{ opacity }, { opacity: 1 }], {
    duration: ROW_IN_MS * (1 - opacity),
    easing: ROW_EASE,
    id: ROW_MOTION,
  });
}

/**
 * A closed card fades out where it is, then goes. It leaves the layout at once, so a card or a
 * confirm that comes next takes its place, and the frame never shows empty before it closes.
 */
export function leaveSurface(element: HTMLElement): void {
  if (!element.isConnected || reducedMotion()) {
    element.remove();
    return;
  }
  // It is no longer an open surface: the host's cancel and the frame's styles skip it.
  element.inert = true;
  element.classList.remove('seams-auth-method-activation-surface');
  delete element.dataset.seamsVoiceidHandoff;
  const box = element.getBoundingClientRect();
  element.style.position = 'fixed';
  element.style.top = `${box.top}px`;
  element.style.left = `${box.left}px`;
  element.style.width = `${box.width}px`;
  element.style.margin = '0';
  element.style.pointerEvents = 'none';
  const from = Number(getComputedStyle(element).opacity);
  element
    .animate([{ opacity: from }, { opacity: 0 }], {
      duration: ROW_OUT_MS * from,
      easing: 'ease-in',
      fill: 'forwards',
    })
    .finished.catch(ignoreCancel)
    .finally(() => element.remove());
}

const CLOSE_PATH = 'M6 6l12 12M18 6L6 18';
const BACK_PATH = 'm15 18-6-6 6-6';
const MINIMIZE_PATH = 'M6 12h12';
/** A microphone: its head, its stand and its foot. */
const MICROPHONE_PATHS = ['M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z', 'M5 10a7 7 0 0 0 14 0', 'M8 21h8', 'M12 17v4'];

/** The tick that takes the microphone's place when a form card's check passes. */
const ICON_CHECK_PATH = 'M5 12.5l4.5 4.5L19 7.5';

/**
 * The microphone at the left of a form card's button, in its own circle, and the tick that
 * takes its place when the check passes (phraseCard.ts sealIcon).
 */
function microphoneIcon(document: Document): HTMLSpanElement {
  const circle = document.createElement('span');
  circle.className = 'seams-voiceid-line-icon';
  circle.setAttribute('aria-hidden', 'true');
  const icon = lineIconSvg(document, 'seams-voiceid-line-icon-microphone');
  for (const d of MICROPHONE_PATHS) icon.append(lineIconPath(document, d, '1.8'));
  const check = lineIconSvg(document, 'seams-voiceid-line-icon-check');
  const tick = lineIconPath(document, ICON_CHECK_PATH, '2.6');
  tick.setAttribute('pathLength', '1');
  check.append(tick);
  circle.append(icon, check);
  return circle;
}

function lineIconSvg(document: Document, className: string): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('class', className);
  return icon;
}

function lineIconPath(document: Document, d: string, width: string): SVGPathElement {
  const part = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  part.setAttribute('d', d);
  part.setAttribute('fill', 'none');
  part.setAttribute('stroke', 'currentColor');
  part.setAttribute('stroke-width', width);
  part.setAttribute('stroke-linecap', 'round');
  part.setAttribute('stroke-linejoin', 'round');
  return part;
}

/** A control in a corner of the card, with an icon and no text. */
function cornerButton(document: Document, label: string, path: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'seams-voiceid-close';
  button.setAttribute('aria-label', label);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '20');
  icon.setAttribute('height', '20');
  icon.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.75');
  line.setAttribute('stroke-linecap', 'round');
  icon.append(line);
  button.append(icon);
  return button;
}
