import type { PhraseReceipt, PhraseSegmentState, PhraseView } from './types';
import type { VoicePrompt } from './prompt';
import { ROW_EASE, ROW_IN_DELAY_MS, ROW_IN_MS, ROW_OUT_MS, ROW_STAGGER_MS } from './rowMotion';

// The phrase card keeps one card for the prompt, the check and the result. The ribbon row stays;
// the other rows fade out, the card takes its new size and the rows fade in again.
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const WIDTH = 308;
const MID = 32;
const SEGMENTS = 6;
const GAP = 8;
const RIBBON_MOVE_MS = 180;
const FLATTEN_MS = 200;
const OPEN_MS = 200;
const TRACK_MS = 240;
const FILL_STAGGER_MS = 70;
const BLOCKER_HOLD_MS = 240;
const DETAIL_ROTATE_MS = 1300;
const DETAIL_OUT_MS = 90;
const DETAIL_IN_MS = 160;
const GAP_CLOSE_MS = 240;
const RING_MS = 440;
const SEAL_MS = 320;
const CHECK_MS = 260;
/** A form card: the bar draws back into the microphone's circle, then the microphone goes. */
const RETRACT_MS = 360;
const ICON_SWAP_MS = 160;
const PULSE_MS = 320;
const RING_RADIUS = 21.5;
const SEAL_RADIUS = 22.5;
const CHECK_PATH = 'M161 26.8 151.4 36.3 147.1 32';
const EASE_IN_OUT = 'cubic-bezier(0.2, 0, 0, 1)';
const EASE_MOVE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const EASE_RING = 'cubic-bezier(0.65, 0, 0.35, 1)';
const EASE_SEAL = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
// A fingerprint: the passkey's mark on its approve button.
const PASSKEY_PATHS = [
  'M18.9 7a8 8 0 0 1 1.1 5v1a6 6 0 0 0 .8 3',
  'M8 11a4 4 0 0 1 8 0v1a10 10 0 0 0 2 6',
  'M12 11v2a14 14 0 0 0 2.5 8',
  'M8 15a18 18 0 0 0 1.8 6',
  'M4.9 19a22 22 0 0 1-.9-7v-1a8 8 0 0 1 12-6.95',
];

type Rows = Readonly<{
  label: string;
  head: string;
  headline: boolean;
  dim: boolean;
  caption: string;
  action: string;
}>;

export type PromptCopy = Readonly<{
  label: string;
  sentence: string;
  message: string;
  action: string;
}>;

/** What a card that takes another card's place shows at first: that card's rows. */
export type HandedOverRows = Readonly<{ label: string; message: string }>;

/** Draws the states of the phrase card. The surface owns the recording and the choices. */
export class PhraseCard {
  private readonly line: SVGSVGElement;
  private readonly segments: SVGRectElement[] = [];
  private readonly bar: SVGPathElement;
  private readonly ring: SVGCircleElement;
  private readonly seal: SVGCircleElement;
  private readonly check: SVGPathElement;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private rows: Rows;
  private states: PhraseSegmentState[] = [];
  private rendering: Promise<void> = Promise.resolve();
  private morph: Promise<void> | null = null;
  private rotation = 0;
  private version = 0;
  private disposed = false;

  constructor(
    private readonly prompt: VoicePrompt,
    private readonly copy: PromptCopy,
    handedOver: HandedOverRows | null = null,
  ) {
    const document = prompt.element.ownerDocument;
    this.line = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.line.classList.add('seams-voiceid-status-line');
    this.line.setAttribute('viewBox', `0 0 ${WIDTH} 64`);
    this.line.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < SEGMENTS; index += 1) {
      const segment = document.createElementNS(SVG_NAMESPACE, 'rect');
      segment.setAttribute('rx', '1.5');
      this.line.append(segment);
      this.segments.push(segment);
    }
    this.bar = document.createElementNS(SVG_NAMESPACE, 'path');
    this.bar.classList.add('seams-voiceid-status-bar');
    this.bar.setAttribute('d', `M1.5 ${MID}H${WIDTH - 1.5}`);
    this.ring = document.createElementNS(SVG_NAMESPACE, 'circle');
    this.ring.classList.add('seams-voiceid-status-ring');
    this.ring.setAttribute('r', String(RING_RADIUS));
    this.seal = document.createElementNS(SVG_NAMESPACE, 'circle');
    this.seal.classList.add('seams-voiceid-status-seal');
    this.seal.setAttribute('r', String(SEAL_RADIUS));
    for (const circle of [this.ring, this.seal]) {
      circle.setAttribute('cx', String(WIDTH / 2));
      circle.setAttribute('cy', String(MID));
    }
    this.check = document.createElementNS(SVG_NAMESPACE, 'path');
    this.check.classList.add('seams-voiceid-status-check');
    this.check.setAttribute('d', CHECK_PATH);
    this.check.setAttribute('pathLength', '1');
    this.line.append(this.bar, this.ring, this.seal, this.check);
    prompt.ribbon.after(this.line);
    this.rows = handedOver
      ? {
          ...this.promptRows(),
          label: handedOver.label,
          caption: `handed-over:${handedOver.message}`,
          action: '',
        }
      : this.promptRows();
    this.layoutSegments(0, 3);
  }

  /** The sentence with Record, after a check or a result. The wave comes back. */
  showPrompt(): Promise<void> {
    const version = this.begin();
    return this.queue(async () => {
      if (this.stale(version)) return;
      const element = this.prompt.element;
      element.removeAttribute('aria-busy');
      await this.transition(this.promptRows(), version, () => {
        delete element.dataset.phraseView;
        delete element.dataset.phraseLine;
        this.writeCaption(this.copy.message, []);
        this.writeAction({ label: this.copy.action });
        this.resetLine();
        this.prompt.ready(this.copy.message);
      });
      if (!this.stale(version)) this.prompt.record.focus();
    });
  }

  /** The end of speech: the wave flattens and opens into segments, the first one filled. */
  beginCheck(): void {
    if (this.disposed || this.morph) return;
    this.prompt.flattenLine();
    this.morph = this.openSegments();
  }

  show(view: PhraseView): Promise<void> {
    const version = this.begin();
    return this.queue(async () => {
      if (this.stale(version)) return;
      const element = this.prompt.element;
      this.prompt.flattenLine();
      this.morph ??= this.openSegments();
      if (view.kind === 'check') {
        element.setAttribute('aria-busy', 'true');
        const detail = view.details[0] ?? '';
        const rows = {
          label: view.label,
          head: this.copy.sentence,
          headline: false,
          dim: true,
          caption: `check:${view.caption}:${detail}`,
          action: '',
        };
        await this.transition(rows, version, () => {
          element.dataset.phraseView = 'check';
          this.writeCaption(view.caption, [detail]);
        });
        await this.morph;
        if (this.stale(version)) return;
        await this.setSegments(view.segments);
        if (!this.stale(version)) this.rotateDetails(view.details, version);
        return;
      }
      element.removeAttribute('aria-busy');
      await this.morph;
      if (this.stale(version)) return;
      if (view.line === 'seal') await this.sealLine(version);
      else await this.setSegments(view.line);
      if (this.stale(version)) return;
      this.prompt.quietLine();
      const rows = {
        label: view.label,
        head: view.headline,
        headline: true,
        dim: false,
        caption: `result:${JSON.stringify([view.caption, view.receipt ?? null, view.detail, view.link ?? null])}`,
        action: `result:${view.action.icon ?? ''}:${view.action.label}`,
      };
      await this.transition(rows, version, () => {
        element.dataset.phraseView = 'result';
        this.writeCaption(this.markedText(view.caption), this.detailNodes(view), view.receipt);
        this.writeAction(view.action);
        this.prompt.record.hidden = false;
      });
      if (this.stale(version)) return;
      this.prompt.record.disabled = view.action.busy === true;
      if (!view.action.busy) this.prompt.record.focus();
    });
  }

  /** The line stays in the card, which fades out as a whole when its surface closes. */
  dispose(): void {
    this.disposed = true;
    this.version += 1;
    window.clearInterval(this.rotation);
  }

  /** A newer state supersedes any state still on its way in. */
  private begin(): number {
    window.clearInterval(this.rotation);
    this.version += 1;
    return this.version;
  }

  private stale(version: number): boolean {
    return this.disposed || version !== this.version;
  }

  private queue(step: () => Promise<void>): Promise<void> {
    this.rendering = this.rendering.then(step, step);
    return this.rendering;
  }

  private promptRows(): Rows {
    return {
      label: this.copy.label,
      head: this.copy.sentence,
      headline: false,
      dim: false,
      caption: `prompt:${this.copy.message}`,
      action: `prompt:${this.copy.action}`,
    };
  }

  /**
   * Rows whose content changes fade out together; `apply` then writes the new state, the card
   * takes its new height, the ribbon row glides to its new place, and the new rows fade in one
   * after another.
   */
  private async transition(next: Rows, version: number, apply: () => void): Promise<void> {
    const prompt = this.prompt;
    const rows = [
      ['label', prompt.title],
      ['head', prompt.phrase],
      ['caption', prompt.status],
      ['action', prompt.actionRow],
    ] as const;
    const changed = rows
      .filter(
        ([key]) =>
          this.rows[key] !== next[key] || (key === 'head' && this.rows.headline !== next.headline),
      )
      .map(([, element]) => element);
    prompt.phrase.classList.toggle('seams-voiceid-phrase-dim', next.dim);
    if (changed.length > 0 && !this.motion.matches) {
      await Promise.all(changed.map((element) => fade(element, ROW_OUT_MS)));
    }
    if (this.stale(version)) return;
    const ribbonTop = prompt.ribbon.getBoundingClientRect().top;
    const heightBefore = prompt.element.getBoundingClientRect().height;
    prompt.title.textContent = next.label;
    prompt.phrase.textContent = next.head;
    prompt.phrase.classList.toggle('seams-voiceid-success-headline', next.headline);
    apply();
    this.rows = next;
    // A shorter card keeps filling the frame while the parent eases it, so no edge jumps.
    prompt.fillFrame(heightBefore);
    const moved = ribbonTop - prompt.ribbon.getBoundingClientRect().top;
    if (Math.abs(moved) > 0.5 && !this.motion.matches) {
      for (const element of [prompt.ribbon, this.line]) {
        element.animate([{ transform: `translateY(${moved}px)` }, { transform: 'none' }], {
          duration: RIBBON_MOVE_MS,
          easing: EASE_MOVE,
        });
      }
    }
    for (const [index, element] of changed.entries()) {
      fadeIn(element, this.motion.matches, ROW_IN_DELAY_MS + index * ROW_STAGGER_MS);
    }
  }

  private markedText(text: Extract<PhraseView, { kind: 'result' }>['caption']): (string | Node)[] {
    if (typeof text === 'string') return [text];
    const document = this.prompt.element.ownerDocument;
    return text.map((part) => {
      if (typeof part === 'string') return part;
      const mark = document.createElement('mark');
      mark.className = 'seams-voiceid-heard-mark';
      mark.textContent = part.mark;
      return mark;
    });
  }

  private detailNodes(view: Extract<PhraseView, { kind: 'result' }>): (string | Node)[] {
    if (!view.link) return [view.detail];
    return [view.detail, ' ', this.linkNode(view.link)];
  }

  /** A link that opens in a new tab, such as a transaction or an attestation. */
  private linkNode(link: Readonly<{ text: string; href: string }>): HTMLAnchorElement {
    const anchor = this.prompt.element.ownerDocument.createElement('a');
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.text;
    return anchor;
  }

  /**
   * The receipt box: its title and source on one line, a checked row for each check, and its
   * link at the end.
   */
  private receiptNode(receipt: PhraseReceipt): HTMLElement {
    const document = this.prompt.element.ownerDocument;
    const element = (tag: string, className: string, ...children: (string | Node)[]) => {
      const node = document.createElement(tag);
      node.className = className;
      node.append(...children);
      return node;
    };
    const head = element('span', 'seams-voiceid-receipt-head', element('b', '', receipt.title));
    if (receipt.source) head.append(element('span', 'seams-voiceid-receipt-source', receipt.source));
    const rows = element(
      'span',
      'seams-voiceid-receipt-rows',
      ...receipt.rows.flatMap((row) => [
        element('span', 'seams-voiceid-receipt-check', checkIcon(document)),
        element('span', 'seams-voiceid-receipt-label', row.label),
        element('span', 'seams-voiceid-receipt-value', row.value),
      ]),
    );
    const box = element('span', 'seams-voiceid-receipt', head, rows);
    if (receipt.link) box.append(element('span', 'seams-voiceid-receipt-foot', this.linkNode(receipt.link)));
    return box;
  }

  /**
   * One line for the prompt; a caption and a detail line for the check and the result, with the
   * result's receipt between them.
   */
  private writeCaption(
    first: string | readonly (string | Node)[],
    second: readonly (string | Node)[],
    receipt?: PhraseReceipt,
  ): void {
    const status = this.prompt.status;
    status.classList.toggle('seams-voiceid-has-receipt', receipt !== undefined);
    if (typeof first === 'string' && second.length === 0 && !receipt) {
      status.classList.remove('seams-voiceid-two-lines');
      status.textContent = first;
      return;
    }
    const document = status.ownerDocument;
    const one = document.createElement('span');
    one.className = 'seams-voiceid-caption';
    one.append(...(typeof first === 'string' ? [first] : first));
    const two = document.createElement('span');
    two.className = 'seams-voiceid-caption-detail';
    two.append(...second);
    status.replaceChildren(...(receipt ? [one, this.receiptNode(receipt), two] : [one, two]));
    status.classList.add('seams-voiceid-two-lines');
  }

  private writeAction(action: Extract<PhraseView, { kind: 'result' }>['action']): void {
    const button = this.prompt.record;
    button.replaceChildren();
    if (action.icon === 'passkey') button.append(passkeyIcon(button.ownerDocument));
    button.append(action.label);
  }

  /** Changes the second caption line every 1.3 s and stays on the last line. */
  private rotateDetails(details: readonly string[], version: number): void {
    if (details.length < 2) return;
    let index = 0;
    this.rotation = window.setInterval(() => {
      index += 1;
      if (index >= details.length - 1 || this.stale(version)) window.clearInterval(this.rotation);
      if (index < details.length && !this.stale(version))
        void this.swapDetail(details[index], version);
    }, DETAIL_ROTATE_MS);
  }

  private async swapDetail(text: string, version: number): Promise<void> {
    const detail = this.prompt.status.querySelector<HTMLElement>('.seams-voiceid-caption-detail');
    if (!detail) return;
    if (!this.motion.matches) await fade(detail, DETAIL_OUT_MS);
    if (this.stale(version)) return;
    detail.textContent = text;
    detail.getAnimations().forEach((animation) => animation.cancel());
    detail.animate(
      [
        { opacity: 0, transform: this.motion.matches ? 'none' : 'translateY(2px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: DETAIL_IN_MS, easing: EASE_IN_OUT, fill: 'both' },
    );
  }

  /** The flat line opens into six segments; the first stays filled, the rest turn to track. */
  private async openSegments(): Promise<void> {
    await wait(this.motion.matches ? 0 : FLATTEN_MS);
    if (this.disposed) return;
    this.states = Array.from({ length: SEGMENTS }, () => 'done');
    this.paintStates();
    this.prompt.element.dataset.phraseLine = 'status';
    await this.tween(this.motion.matches ? 0 : OPEN_MS, (progress) =>
      this.layoutSegments(GAP * progress, 1 + 2 * progress),
    );
    if (this.disposed) return;
    this.states = this.states.map((_, index) => (index === 0 ? 'done' : 'idle'));
    this.paintStates();
    await wait(this.motion.matches ? 0 : TRACK_MS);
  }

  /**
   * Segments that finish fill one after another, 70 ms apart, and stop at a failed or held
   * segment, which then shows its colour. Resolves when the result may follow.
   */
  private async setSegments(next: readonly PhraseSegmentState[]): Promise<void> {
    const filling = next
      .map((state, index) => (state === 'done' && this.states[index] === 'run' ? index : -1))
      .filter((index) => index >= 0);
    const target = [...next];
    // Everything except the fill and its blockers changes at once.
    this.states = target.map((state, index) =>
      filling.includes(index)
        ? 'run'
        : state === 'fail' || state === 'wait' || state === 'skip'
          ? (this.states[index] ?? 'idle')
          : state,
    );
    this.paintStates();
    for (const index of filling) {
      await wait(this.motion.matches ? 0 : FILL_STAGGER_MS);
      if (this.disposed) return;
      this.states[index] = 'done';
      this.paintStates();
    }
    const blocked = target.some((state) => state === 'fail' || state === 'wait');
    this.states = target;
    this.paintStates();
    if (blocked) await wait(this.motion.matches ? 0 : BLOCKER_HOLD_MS);
  }

  /**
   * The segments fill and the gaps close. Then the line shrinks as the ring draws, and the seal
   * and its check come; in a form card, the line ends in the microphone's circle instead.
   */
  private async sealLine(version: number): Promise<void> {
    await this.setSegments(Array.from({ length: SEGMENTS }, () => 'done'));
    if (this.stale(version)) return;
    const reduced = this.motion.matches;
    await this.tween(reduced ? 0 : GAP_CLOSE_MS, (progress) =>
      this.layoutSegments(GAP * (1 - progress), 3),
    );
    if (this.stale(version)) return;
    const icon = this.lineIcon();
    if (icon) {
      await this.sealIcon(version, icon, reduced);
      return;
    }
    this.line.dataset.seal = '';
    const circumference = 2 * Math.PI * RING_RADIUS;
    this.ring.style.strokeDasharray = String(circumference);
    const timing = (duration: number, easing: string): KeyframeAnimationOptions => ({
      duration: reduced ? 0 : duration,
      easing,
      fill: 'forwards',
    });
    this.bar.animate(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      timing(RING_MS, EASE_RING),
    );
    await this.ring.animate(
      [{ strokeDashoffset: circumference }, { strokeDashoffset: 0 }],
      timing(RING_MS, EASE_RING),
    ).finished;
    if (this.stale(version)) return;
    this.seal.animate(
      [{ transform: 'scale(0)' }, { transform: 'scale(1)' }],
      timing(SEAL_MS, EASE_SEAL),
    );
    await wait(reduced ? 0 : SEAL_MS - 100);
    if (this.stale(version)) return;
    await this.check.animate(
      [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
      timing(CHECK_MS, EASE_IN_OUT),
    ).finished;
  }

  /**
   * A form card's success: the solid bar draws back to the left into the microphone's circle,
   * the microphone goes, and a tick draws in its place in the button's colour, with one small
   * pulse of the circle. The pill then becomes the result's button.
   */
  private async sealIcon(version: number, icon: HTMLElement, reduced: boolean): Promise<void> {
    this.line.dataset.seal = 'icon';
    const timing = (duration: number, easing: string): KeyframeAnimationOptions => ({
      duration: reduced ? 0 : duration,
      easing,
      fill: 'forwards',
    });
    // The bar's left end moves to the centre of the circle while the bar shrinks, so the bar ends
    // in the circle, behind it. The move is in the line's own units.
    const bar = this.bar.getBoundingClientRect();
    const circle = icon.getBoundingClientRect();
    const scale = this.bar.getScreenCTM()?.a || 1;
    const shift = (circle.left + circle.width / 2 - bar.left) / scale;
    await this.bar.animate(
      [{ transform: 'translateX(0) scaleX(1)' }, { transform: `translateX(${shift}px) scaleX(0)` }],
      timing(RETRACT_MS, EASE_RING),
    ).finished;
    if (this.stale(version)) return;
    const { microphone, check, tick } = lineIconParts(icon);
    microphone?.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.6)' },
      ],
      timing(ICON_SWAP_MS, EASE_IN_OUT),
    );
    check?.animate([{ opacity: 0 }, { opacity: 1 }], timing(ICON_SWAP_MS, EASE_IN_OUT));
    icon.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }],
      timing(PULSE_MS, EASE_MOVE),
    );
    await tick?.animate(
      [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
      timing(CHECK_MS, EASE_IN_OUT),
    ).finished;
  }

  /** The microphone's circle of a form card, or null for another card. */
  private lineIcon(): HTMLElement | null {
    return this.prompt.element.querySelector<HTMLElement>(':scope > .seams-voiceid-line-icon');
  }

  private resetLine(): void {
    this.morph = null;
    this.states = [];
    delete this.line.dataset.seal;
    const icon = this.lineIcon();
    const iconParts = icon ? Object.values(lineIconParts(icon)) : [];
    for (const part of [this.bar, this.ring, this.seal, this.check, icon, ...iconParts]) {
      part?.getAnimations().forEach((animation) => animation.cancel());
    }
    this.layoutSegments(0, 3);
    this.paintStates();
  }

  private paintStates(): void {
    for (const [index, segment] of this.segments.entries()) {
      const state = this.states[index];
      if (state) segment.dataset.state = state;
      else delete segment.dataset.state;
    }
  }

  private layoutSegments(gap: number, height: number): void {
    const width = (WIDTH - (SEGMENTS - 1) * gap) / SEGMENTS;
    for (const [index, segment] of this.segments.entries()) {
      segment.setAttribute('x', (index * (width + gap)).toFixed(2));
      segment.setAttribute('width', width.toFixed(2));
      segment.setAttribute('y', (MID - height / 2).toFixed(2));
      segment.setAttribute('height', height.toFixed(2));
    }
  }

  private tween(duration: number, frame: (progress: number) => void): Promise<void> {
    if (duration <= 0) {
      frame(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (time: number): void => {
        if (this.disposed) return resolve();
        const progress = Math.min(1, (time - start) / duration);
        frame(1 - Math.pow(1 - progress, 3));
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
}

function passkeyIcon(document: Document): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('seams-voiceid-action-icon');
  for (const d of PASSKEY_PATHS) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', d);
    icon.append(path);
  }
  return icon;
}

/** The check mark of a receipt row, in the seal's colour. */
function checkIcon(document: Document): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '15');
  icon.setAttribute('height', '15');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', 'M5 12l5 5L20 7');
  icon.append(path);
  return icon;
}

/** Fades out from where the element is, so a row that is still arriving never flashes. */
function fade(element: Element, duration: number): Promise<unknown> {
  const from = Number(getComputedStyle(element).opacity);
  return element.animate([{ opacity: from }, { opacity: 0 }], {
    duration: duration * from,
    easing: 'ease-in',
    fill: 'forwards',
  }).finished;
}

function fadeIn(element: Element, reduced: boolean, delay: number): void {
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate(
    [
      { opacity: 0, transform: reduced ? 'none' : 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ],
    {
      delay: reduced ? 0 : delay,
      duration: reduced ? 150 : ROW_IN_MS,
      easing: ROW_EASE,
      fill: 'both',
    },
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The parts of a form card's microphone circle that the success animation moves. */
function lineIconParts(icon: HTMLElement): {
  microphone: SVGSVGElement | null;
  check: SVGSVGElement | null;
  tick: SVGPathElement | null;
} {
  const check = icon.querySelector<SVGSVGElement>('.seams-voiceid-line-icon-check');
  return {
    microphone: icon.querySelector<SVGSVGElement>('.seams-voiceid-line-icon-microphone'),
    check,
    tick: check?.querySelector<SVGPathElement>('path') ?? null,
  };
}
