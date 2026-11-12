import type { VoiceActivityEvent } from '../microphone';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const WIDTH = 308;
const MID = 32;
const CENTRE = WIDTH / 2;
const TAU = Math.PI * 2;
// The ring is the auth menu's 45 px loading ring: its radius, arc and clocks.
const RING_RADIUS = 21.5;
const RING_ARC = 0.56;
const TURN_MS = 1800;
const ARC_CYCLE_MS = 1500;
const REDUCED_TURN_MS = 3200;
const REDUCED_ARC_CYCLE_MS = 2600;
// A silent line keeps a small travelling wave, so the card reads as live.
const IDLE_AMPLITUDE = 0.085;
const IDLE_PERIOD_MS = 2600;
// While the voice is checked, the middle of the line fades and each half is
// drawn round the ring: the left half into the top, the right half into the
// bottom. The bend is y = R·(4u³ − 3u⁴) over √12·R, whose curvature is 0 where
// it leaves the line and exactly the ring's where it joins it.
const CAPTURE_MS = 560;
const MIDDLE_FADE_MS = 180;
const BEND_WIDTH = Math.sqrt(12) * RING_RADIUS;
const BEND_START = CENTRE - BEND_WIDTH;
const BEND = tabulateBend();
const RING_ENTRY = BEND_START + BEND.length;
const HALF_ARC = (RING_ARC * TAU * RING_RADIUS) / 2;
// The two arcs then meet: the top arc closes this share of the gap by speeding
// up, the bottom arc the rest by slowing, so no end ever moves backward.
const JOIN_MS = 360;
const JOIN_LEAD_SHARE = 0.75;
// Signing checks with segments instead: the wave flattens, two gaps open at the
// thirds, and the three segments pulse in turn. They become the receipt's tracks.
const SPLIT_FLATTEN_MS = 200;
const SPLIT_OPEN_MS = 200;
const SEGMENT_GAP = 8;
const PULSE_MS = 900;
const PULSE_STAGGER_MS = 150;
const PULSE_FLOOR = 0.35;
const LINE_REST_OPACITY = 0.55;
// Success follows the auth menu's success ring: close, seal, check.
const SUCCESS_MS = 1140;
const SEAL_RADIUS = 22.5;
const CHECK_PATH = 'M161 26.8 151.4 36.3 147.1 32';
// The pixel style: columns of square dots that grow up and down from the middle row with the
// voice. Each step adds the level of that moment at the right end, and the columns move left.
const PIXEL_COLUMNS = 44;
/** The rows above the middle row, and the rows below it. */
const PIXEL_ROWS = 4;
const PIXEL_PITCH = 7;
/** Rows sit closer than columns, so the tallest column keeps a gap to the edge of a button. */
const PIXEL_ROW_PITCH = 6;
const PIXEL_SIZE = 4.5;
const PIXEL_STEP_MS = 70;
/** A column shows between this share of the level and all of it. */
const PIXEL_SPREAD = 0.3;
// While the card listens in silence, a small wave of one dot runs along the middle row.
const PIXEL_IDLE_LEVEL = 0.18;
const PIXEL_IDLE_SWING = 0.12;
const PIXEL_IDLE_PERIOD_MS = 2400;

const easeMove = cubicBezier(0.65, 0, 0.35, 1);
const easeArc = cubicBezier(0.4, 0, 0.2, 1);
const easeSeal = cubicBezier(0.34, 1.56, 0.64, 1);
const easeOut = cubicBezier(0.2, 0, 0, 1);

type RibbonPhase = 'idle' | 'listening' | 'processing';
/** How the line shows that the voice is being checked. */
export type VoiceCheckingStyle = 'ring' | 'segments';
/** How the card draws the voice while it listens: sine wave lines, or columns of pixels. */
export type VoiceLineStyle = 'wave' | 'pixels';
type Arc = Readonly<{ start: number; sweep: number }>;
type Stage =
  | Readonly<{ kind: 'line' }>
  | Readonly<{ kind: 'capture'; startedAt: number; amplitude: number }>
  | Readonly<{ kind: 'segments'; startedAt: number; amplitude: number }>
  | Readonly<{ kind: 'spin'; startedAt: number; base: number }>
  | Readonly<{ kind: 'success'; startedAt: number; from: Arc }>
  | Readonly<{ kind: 'sealed' }>;
type CaptureStage = Extract<Stage, { kind: 'capture' }>;
type SegmentsStage = Extract<Stage, { kind: 'segments' }>;
type SpinStage = Extract<Stage, { kind: 'spin' }>;
type SuccessStage = Extract<Stage, { kind: 'success' }>;

/** Visual feedback from recorder activity. Never opens or retains an audio stream. */
export class VoiceRibbon {
  readonly element: SVGSVGElement;
  private readonly lines: SVGPathElement[] = [];
  private readonly ripple: SVGCircleElement;
  private readonly track: SVGCircleElement;
  private readonly middle: SVGPathElement;
  private readonly top: SVGPathElement;
  private readonly bottom: SVGPathElement;
  private readonly seal: SVGCircleElement;
  private readonly check: SVGPathElement;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private phase: RibbonPhase = 'idle';
  private stage: Stage = { kind: 'line' };
  private settleSuccess: (() => void) | null = null;
  private successBegun: (() => void) | null = null;
  private frame = 0;
  private previousTime = 0;
  private position = 0;
  private target = 0;
  private level = 0;
  private stopped = false;
  private lineStyle: VoiceLineStyle = 'wave';
  /** The pixel style's dots by column, top row first. Made when the style is first chosen. */
  private pixels: Readonly<{ group: SVGGElement; columns: SVGRectElement[][] }> | null = null;
  /** The level of each column, the newest at the right end. */
  private readonly pixelLevels: number[] = new Array<number>(PIXEL_COLUMNS).fill(0);
  /** The rows that each column shows now, above and below the middle row. */
  private readonly pixelHeights: number[] = new Array<number>(PIXEL_COLUMNS).fill(-1);
  private pixelClock = 0;

  constructor(
    document: Document,
    private readonly checking: VoiceCheckingStyle = 'ring',
  ) {
    this.element = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.element.classList.add('seams-voiceid-ribbon');
    this.element.setAttribute('viewBox', `0 0 ${WIDTH} 64`);
    this.element.setAttribute('aria-hidden', 'true');
    this.ripple = this.append(document, 'circle', '1.5');
    this.track = this.append(document, 'circle', '2');
    this.middle = this.append(document, 'path', '1');
    this.top = this.append(document, 'path', '2');
    this.bottom = this.append(document, 'path', '2');
    this.seal = this.append(document, 'circle', '0');
    this.seal.setAttribute('fill', 'currentColor');
    this.seal.setAttribute('stroke', 'none');
    this.check = this.append(document, 'path', '2.6');
    this.check.classList.add('seams-voiceid-ribbon-check');
    this.check.setAttribute('d', CHECK_PATH);
    this.check.setAttribute('stroke-linejoin', 'round');
    this.check.setAttribute('pathLength', '1');
    this.check.setAttribute('stroke-dasharray', '1');
    for (const ring of [this.ripple, this.track, this.seal]) {
      ring.setAttribute('cx', String(CENTRE));
      ring.setAttribute('cy', String(MID));
    }
    this.track.setAttribute('r', String(RING_RADIUS));
    // A receipt that follows takes these segments over as its progress tracks.
    if (checking === 'segments') {
      this.element.dataset.seamsProgressLine = '';
      for (const [index, segment] of [this.top, this.middle, this.bottom].entries())
        segment.dataset.seamsProgressSegment = String(index);
    }
    // The listening line stays the last path, above the ring parts it replaces.
    // The theme can set the colours and the widths of these lines (prompt.ts: voiceLine,
    // voiceEcho, voiceEchoDeep, voiceLineWidth, voiceEchoWidth).
    for (let layer = 3; layer >= 0; layer -= 1) {
      const line = this.append(document, 'path', layer === 0 ? '1' : '0.65');
      line.classList.add(layer === 0 ? 'seams-voiceid-ribbon-line' : 'seams-voiceid-ribbon-echo');
      if (layer > 0) line.dataset.layer = String(layer);
      this.lines.push(line);
    }
    this.paint(performance.now());
  }

  readonly readLevel = (): number => this.level;

  /** Draws the voice as wave lines (the default) or as columns of pixels. */
  setLineStyle(style: VoiceLineStyle): void {
    this.lineStyle = style;
    this.element.dataset.lineStyle = style;
    if (style === 'pixels' && !this.pixels) this.pixels = this.makePixels();
    this.pixelHeights.fill(-1);
    this.paint(performance.now());
    this.wake();
  }

  private makePixels(): Readonly<{ group: SVGGElement; columns: SVGRectElement[][] }> {
    const document = this.element.ownerDocument;
    const group = document.createElementNS(SVG_NAMESPACE, 'g');
    group.classList.add('seams-voiceid-ribbon-pixels');
    group.setAttribute('opacity', '0');
    const left = (WIDTH - ((PIXEL_COLUMNS - 1) * PIXEL_PITCH + PIXEL_SIZE)) / 2;
    const columns: SVGRectElement[][] = [];
    for (let column = 0; column < PIXEL_COLUMNS; column += 1) {
      const dots: SVGRectElement[] = [];
      for (let row = -PIXEL_ROWS; row <= PIXEL_ROWS; row += 1) {
        const dot = document.createElementNS(SVG_NAMESPACE, 'rect');
        dot.classList.add('seams-voiceid-ribbon-pixel');
        // The theme colours the dots by their distance from the middle row: 0, 1-2, 3-4.
        const distance = Math.abs(row);
        dot.dataset.band = distance === 0 ? '0' : distance <= 2 ? '1' : '2';
        dot.setAttribute('x', (left + column * PIXEL_PITCH).toFixed(2));
        dot.setAttribute('y', (MID - PIXEL_SIZE / 2 + row * PIXEL_ROW_PITCH).toFixed(2));
        dot.setAttribute('width', String(PIXEL_SIZE));
        dot.setAttribute('height', String(PIXEL_SIZE));
        dot.setAttribute('rx', '1');
        dot.setAttribute('opacity', '0');
        group.append(dot);
        dots.push(dot);
      }
      columns.push(dots);
    }
    this.element.prepend(group);
    return { group, columns };
  }

  /** The voice line's width now: 1, or the theme's `voiceLineWidth`. */
  private lineWidth(): number {
    const line = this.lines[this.lines.length - 1];
    const width = line ? Number.parseFloat(getComputedStyle(line).strokeWidth) : Number.NaN;
    return Number.isFinite(width) && width > 0 ? width : 1;
  }

  setPhase(phase: RibbonPhase): void {
    if (phase === 'processing' && this.stage.kind === 'line') {
      const amplitude = Math.max(this.level, this.idleAmplitude(performance.now()));
      const kind = this.checking === 'segments' ? 'segments' : 'capture';
      this.stage = { kind, startedAt: performance.now(), amplitude };
    } else if (phase !== 'processing') {
      this.stage = { kind: 'line' };
      this.settle();
    }
    this.phase = phase;
    this.target = 0;
    this.element.dataset.phase = phase;
    this.wake();
  }

  /**
   * Closes the ring into the success seal; resolves when the check is drawn.
   * `begin` runs once the formed ring starts to close, after any capture in flight.
   */
  succeed(begin: () => void): Promise<void> {
    if (this.stopped || this.stage.kind === 'sealed') return Promise.resolve();
    if (this.stage.kind === 'line') this.setPhase('processing');
    const settled = new Promise<void>(this.awaitSuccess);
    this.successBegun = begin;
    // A capture still in flight hands over to the spinner first, then succeeds.
    if (this.stage.kind === 'spin') this.beginSuccess(performance.now());
    this.wake();
    return settled;
  }

  add(event: VoiceActivityEvent): void {
    if (this.phase !== 'listening' || this.stopped) return;
    const signal = Math.max(0, event.rms - 0.003);
    this.target = Math.pow(signal / (signal + 0.055), 0.65) * (event.speech ? 1 : 0.15);
    this.element.dataset.speech = String(event.speech);
    this.wake();
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.level = 0;
    this.target = 0;
    this.settle();
  }

  private readonly awaitSuccess = (resolve: () => void): void => {
    this.settle();
    this.settleSuccess = resolve;
  };

  private settle(): void {
    const settle = this.settleSuccess;
    this.settleSuccess = null;
    this.successBegun = null;
    settle?.();
  }

  private append<K extends 'path' | 'circle'>(
    document: Document,
    tag: K,
    strokeWidth: string,
  ): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NAMESPACE, tag);
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', strokeWidth);
    element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('vector-effect', 'non-scaling-stroke');
    element.setAttribute('opacity', '0');
    this.element.append(element);
    return element;
  }

  private wake(): void {
    if (!this.stopped && this.frame === 0) {
      this.previousTime = performance.now();
      this.frame = requestAnimationFrame(this.draw);
    }
  }

  private readonly draw = (time: number): void => {
    this.frame = 0;
    if (this.stopped) return;
    const dt = Math.min(50, Math.max(0, time - this.previousTime));
    this.previousTime = time;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / (this.target > this.level ? 55 : 200)));
    if (!this.motion.matches) this.position += dt * (0.0012 + this.level * 0.003);
    if (this.lineStyle === 'pixels') this.stepPixels(dt);
    this.paint(time);
    // A ribbon that has left the document stops drawing; a later phase or activity wakes it.
    const resting =
      !this.element.isConnected ||
      this.stage.kind === 'sealed' ||
      (this.stage.kind === 'line' &&
        this.phase === 'idle' &&
        this.level <= 0.001 &&
        this.pixelLevels.every((level) => level <= 0.001));
    if (!resting) this.frame = requestAnimationFrame(this.draw);
  };

  private idleAmplitude(time: number): number {
    if (this.phase !== 'listening' || this.motion.matches) return 0;
    return IDLE_AMPLITUDE * (0.72 + 0.28 * Math.sin((time / IDLE_PERIOD_MS) * TAU));
  }

  /** Adds the level of each step at the right end; the older columns move left. */
  private stepPixels(dt: number): void {
    this.pixelClock += dt;
    while (this.pixelClock >= PIXEL_STEP_MS) {
      this.pixelClock -= PIXEL_STEP_MS;
      this.pixelLevels.shift();
      // Neighbouring columns differ, as the bars of a recorder do.
      this.pixelLevels.push(this.level * (PIXEL_SPREAD + (1 - PIXEL_SPREAD) * Math.random()));
    }
  }

  private paint(time: number): void {
    for (const part of [this.ripple, this.track, this.middle, this.top, this.bottom, this.seal, this.check])
      part.setAttribute('opacity', '0');
    for (const line of this.lines) line.setAttribute('opacity', '0');
    this.pixels?.group.setAttribute('opacity', '0');
    switch (this.stage.kind) {
      case 'line':
        if (this.lineStyle === 'pixels') this.paintPixels(time);
        else this.paintLine(Math.max(this.level, this.idleAmplitude(time)));
        return;
      case 'capture':
        this.paintCapture(time, this.stage);
        return;
      case 'segments':
        this.paintSegments(time, this.stage);
        return;
      case 'spin':
        this.paintArc(this.spinnerArc(time, this.stage), 1);
        return;
      case 'success':
        this.paintSuccess(time, this.stage);
        return;
      case 'sealed':
        this.paintSeal({ start: 0, sweep: TAU }, 1, 1);
        return;
    }
  }

  private paintLine(amplitude: number): void {
    for (let index = 0; index < this.lines.length; index += 1) {
      const layer = 3 - index;
      this.lines[index].setAttribute('d', this.linePath(layer, amplitude, 0, WIDTH, 1));
      this.lines[index].setAttribute('opacity', String(layer === 0 ? LINE_REST_OPACITY + amplitude * 0.4 : 0.1 + amplitude * 0.1));
    }
  }

  /** Each column shows the middle dot and as many rows above and below it as its level. */
  private paintPixels(time: number): void {
    if (!this.pixels) return;
    this.pixels.group.setAttribute('opacity', '1');
    const live = this.phase === 'listening' && !this.motion.matches;
    for (const [column, dots] of this.pixels.columns.entries()) {
      let level = this.pixelLevels[column] ?? 0;
      if (live) {
        const wave = Math.sin((time / PIXEL_IDLE_PERIOD_MS) * TAU - column * 0.55);
        level = Math.max(level, PIXEL_IDLE_LEVEL + PIXEL_IDLE_SWING * wave);
      }
      const height = Math.min(PIXEL_ROWS, Math.round(level * PIXEL_ROWS * 1.3));
      if (height === this.pixelHeights[column]) continue;
      this.pixelHeights[column] = height;
      for (const [index, dot] of dots.entries()) {
        dot.setAttribute('opacity', Math.abs(index - PIXEL_ROWS) <= height ? '1' : '0');
      }
    }
  }

  private paintSegments(time: number, stage: SegmentsStage): void {
    const elapsed = time - stage.startedAt;
    if (!this.motion.matches && elapsed < SPLIT_FLATTEN_MS) {
      this.paintLine(stage.amplitude * (1 - easeOut(elapsed / SPLIT_FLATTEN_MS)));
      return;
    }
    const split = elapsed - SPLIT_FLATTEN_MS;
    const gap = SEGMENT_GAP * (this.motion.matches ? 1 : easeOut(clamp01(split / SPLIT_OPEN_MS)));
    const width = (WIDTH - 2 * gap) / 3;
    for (const [index, segment] of [this.top, this.middle, this.bottom].entries()) {
      const start = index * (width + gap);
      segment.setAttribute('d', `M${start.toFixed(2)} ${MID}H${(start + width).toFixed(2)}`);
      segment.setAttribute('stroke-width', String(this.lineWidth()));
      segment.setAttribute('opacity', this.segmentOpacity(split, index));
    }
  }

  /** Each segment brightens one beat after the one before it, from the resting line's opacity. */
  private segmentOpacity(split: number, index: number): string {
    if (this.motion.matches) return '0.8';
    const beat = 0.5 + 0.5 * Math.cos((TAU * (split - index * PULSE_STAGGER_MS)) / PULSE_MS);
    const pulse = PULSE_FLOOR + (1 - PULSE_FLOOR) * beat;
    return lerp(LINE_REST_OPACITY, pulse, easeOut(clamp01(split / SPLIT_OPEN_MS))).toFixed(3);
  }

  private paintCapture(time: number, stage: CaptureStage): void {
    const elapsed = this.motion.matches ? CAPTURE_MS + JOIN_MS : time - stage.startedAt;
    if (elapsed >= CAPTURE_MS) {
      this.paintJoin(time, Math.min(elapsed - CAPTURE_MS, JOIN_MS));
      return;
    }
    const amplitude = stage.amplitude;
    const progress = elapsed / CAPTURE_MS;
    const waveScale = 1 - easeOut(clamp01(elapsed / 150));
    const settled = easeMove(clamp01(progress / 0.6));
    // The halves start at rest and slow into orbit at the spinner's speed.
    const exitSpeed = turnSpeed(false) * RING_RADIUS * CAPTURE_MS;
    const tail = hermite(progress, RING_ENTRY, exitSpeed);
    const head = BEND_START + hermite(progress, RING_ENTRY + HALF_ARC - BEND_START, exitSpeed);
    const lineOpacity = LINE_REST_OPACITY + amplitude * 0.4;
    for (const [half, turned] of [[this.top, false], [this.bottom, true]] as const) {
      half.setAttribute('d', this.halfPath(tail, head, turned, amplitude, waveScale));
      half.setAttribute('stroke-width', lerp(this.lineWidth(), Math.max(2, this.lineWidth()), settled).toFixed(2));
      half.setAttribute('opacity', lerp(lineOpacity, 1, settled).toFixed(3));
    }
    this.middle.setAttribute('d', this.linePath(0, amplitude, BEND_START, WIDTH - BEND_START, waveScale));
    this.middle.setAttribute('opacity', (lineOpacity * (1 - easeOut(clamp01(elapsed / MIDDLE_FADE_MS)))).toFixed(3));
    for (let index = 0; index < 3; index += 1) {
      const layer = 3 - index;
      this.lines[index].setAttribute('d', this.linePath(layer, amplitude, 0, WIDTH, waveScale));
      this.lines[index].setAttribute('opacity', ((0.1 + amplitude * 0.1) * (1 - clamp01(elapsed / 200))).toFixed(3));
    }
    this.track.setAttribute('opacity', (0.1 * clamp01((progress - 0.4) / 0.6)).toFixed(3));
  }

  private paintJoin(time: number, elapsed: number): void {
    const joined = (1 - Math.cos((Math.PI * elapsed) / JOIN_MS)) / 2;
    const base = -Math.PI / 2 + turnSpeed(false) * elapsed;
    const sweep = HALF_ARC / RING_RADIUS;
    const gap = Math.PI - sweep;
    const lead = this.motion.matches ? -Math.PI / 2 : base + JOIN_LEAD_SHARE * gap * joined;
    if (this.motion.matches || elapsed >= JOIN_MS) {
      // The joined arc is the spinner's own 56% arc at this angle and speed.
      this.stage = { kind: 'spin', startedAt: time, base: lead - TAU * 0.14 };
      if (this.settleSuccess) this.beginSuccess(time);
      this.paint(time);
      return;
    }
    this.track.setAttribute('opacity', '0.1');
    for (const [half, start] of [
      [this.top, lead],
      [this.bottom, base + Math.PI - (1 - JOIN_LEAD_SHARE) * gap * joined],
    ] as const) {
      half.setAttribute('d', arcPath({ start, sweep }));
      half.setAttribute('stroke-width', '2');
      half.setAttribute('opacity', '1');
    }
  }

  /** The auth menu ring's arc: it grows and shrinks on its own clock while the ring turns. */
  private spinnerArc(time: number, stage: SpinStage): Arc {
    const elapsed = time - stage.startedAt;
    const cycle = this.motion.matches ? REDUCED_ARC_CYCLE_MS : ARC_CYCLE_MS;
    const phase = ((elapsed + cycle / 2) % cycle) / cycle;
    const growing = phase < 0.5;
    const eased = easeArc(growing ? phase / 0.5 : (phase - 0.5) / 0.5);
    const dash = growing ? lerp(1, 56, eased) : lerp(56, 1, eased);
    const offset = growing ? lerp(0, -14, eased) : lerp(-14, -99, eased);
    const base = stage.base + turnSpeed(this.motion.matches) * elapsed;
    return { start: base - (TAU * offset) / 100, sweep: (TAU * dash) / 100 };
  }

  private beginSuccess(time: number): void {
    if (this.stage.kind !== 'spin') return;
    this.stage = { kind: 'success', startedAt: time, from: this.spinnerArc(time, this.stage) };
    const begun = this.successBegun;
    this.successBegun = null;
    begun?.();
  }

  private paintSuccess(time: number, stage: SuccessStage): void {
    const elapsed = time - stage.startedAt;
    if (elapsed >= SUCCESS_MS) {
      this.stage = { kind: 'sealed' };
      this.settle();
      this.paint(time);
      return;
    }
    // The ring keeps its turning speed and slows to a stop while it closes.
    const turned = clamp01(elapsed / 650);
    const spin = this.motion.matches ? 0 : turnSpeed(false) * 650 * (turned - (turned * turned) / 2);
    const closed = easeMove(clamp01((elapsed - 150) / 500));
    this.paintSeal(
      { start: stage.from.start + spin, sweep: lerp(stage.from.sweep, TAU, closed) },
      easeSeal(clamp01((elapsed - 600) / 420)),
      easeMove(clamp01((elapsed - 820) / 320)),
    );
    const ripple = clamp01((elapsed - 700) / 700);
    if (!this.motion.matches && ripple > 0 && ripple < 1) {
      const spread = easeOut(ripple);
      this.ripple.setAttribute('r', lerp(SEAL_RADIUS, 34, spread).toFixed(2));
      this.ripple.setAttribute('opacity', ((1 - spread) * 0.45).toFixed(3));
    }
  }

  private paintSeal(arc: Arc, seal: number, check: number): void {
    this.paintArc(arc, 1);
    this.seal.setAttribute('r', (SEAL_RADIUS * Math.max(0, seal)).toFixed(2));
    this.seal.setAttribute('opacity', seal > 0 ? '1' : '0');
    this.check.setAttribute('stroke-dashoffset', (1 - check).toFixed(3));
    this.check.setAttribute('opacity', check > 0 ? '1' : '0');
  }

  private paintArc(arc: Arc, trackOpacity: number): void {
    this.track.setAttribute('opacity', String(0.1 * trackOpacity));
    this.top.setAttribute('d', arcPath(arc));
    this.top.setAttribute('stroke-width', '2');
    this.top.setAttribute('opacity', '1');
  }

  private displacement(layer: number, amplitude: number, x: number): number {
    const u = x / WIDTH;
    const taper = Math.pow(Math.sin(Math.PI * u), 1.7);
    if (this.motion.matches) return amplitude * 5 * taper;
    const wave = Math.sin(u * Math.PI * 4 - this.position + layer * 0.5) * 0.7
      + Math.sin(u * Math.PI * 7 + this.position * 0.7 + layer) * 0.3;
    return amplitude * (26 - layer * 4) * taper * wave;
  }

  private linePath(layer: number, amplitude: number, from: number, to: number, waveScale: number): string {
    let path = '';
    const steps = Math.max(2, Math.ceil((to - from) / 2));
    for (let step = 0; step <= steps; step += 1) {
      const x = from + ((to - from) * step) / steps;
      const y = MID + this.displacement(layer, amplitude, x) * waveScale;
      path += `${step === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    }
    return path;
  }

  /** The stroke between two distances on a half's capture track. */
  private halfPath(from: number, to: number, turned: boolean, amplitude: number, waveScale: number): string {
    let path = '';
    const steps = Math.max(2, Math.ceil((to - from) / 1.5));
    for (let step = 0; step <= steps; step += 1) {
      const point = trackPoint(from + ((to - from) * step) / steps);
      const x = turned ? WIDTH - point.x : point.x;
      let y = turned ? 2 * MID - point.y : point.y;
      // On the line, the half keeps the line's offset, so the first frame matches.
      if (point.onLine) y += this.displacement(0, amplitude, x) * waveScale;
      path += `${step === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    }
    return path;
  }
}

function turnSpeed(reduced: boolean): number {
  return TAU / (reduced ? REDUCED_TURN_MS : TURN_MS);
}

/** A point at a distance along the left half's track: line, bend, then the ring clockwise from the top. */
function trackPoint(distance: number): Readonly<{ x: number; y: number; onLine: boolean }> {
  if (distance <= BEND_START) return { x: distance, y: MID, onLine: true };
  if (distance < RING_ENTRY) {
    const along = distance - BEND_START;
    let low = 0;
    let high = BEND.lengths.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (BEND.lengths[middle] < along) low = middle;
      else high = middle;
    }
    const fraction = (along - BEND.lengths[low]) / (BEND.lengths[high] - BEND.lengths[low] || 1);
    return {
      x: lerp(BEND.points[low][0], BEND.points[high][0], fraction),
      y: lerp(BEND.points[low][1], BEND.points[high][1], fraction),
      onLine: false,
    };
  }
  const angle = -Math.PI / 2 + (distance - RING_ENTRY) / RING_RADIUS;
  return { x: CENTRE + RING_RADIUS * Math.cos(angle), y: MID + RING_RADIUS * Math.sin(angle), onLine: false };
}

function tabulateBend(): Readonly<{ points: readonly (readonly [number, number])[]; lengths: readonly number[]; length: number }> {
  const points: (readonly [number, number])[] = [[BEND_START, MID]];
  const lengths = [0];
  let length = 0;
  for (let step = 1; step <= 240; step += 1) {
    const u = step / 240;
    const point = [BEND_START + BEND_WIDTH * u, MID - RING_RADIUS * (4 * u ** 3 - 3 * u ** 4)] as const;
    const previous = points[points.length - 1];
    length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    points.push(point);
    lengths.push(length);
  }
  return { points, lengths, length };
}

function arcPath(arc: Arc): string {
  const steps = Math.max(2, Math.ceil((80 * arc.sweep) / TAU));
  let path = '';
  for (let step = 0; step <= steps; step += 1) {
    const angle = arc.start + (arc.sweep * step) / steps;
    const x = CENTRE + RING_RADIUS * Math.cos(angle);
    const y = MID + RING_RADIUS * Math.sin(angle);
    path += `${step === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return path;
}

/** Distance covered from rest to an exit speed (cubic Hermite in normalised time). */
function hermite(progress: number, distance: number, exitSpeed: number): number {
  const square = progress * progress;
  return distance * (3 * square - 2 * square * progress) + exitSpeed * (square * progress - square);
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (t: number, p1: number, p2: number): number =>
    ((1 - 3 * p2 + 3 * p1) * t + (3 * p2 - 6 * p1)) * t * t + 3 * p1 * t;
  const slope = (t: number, p1: number, p2: number): number =>
    3 * (1 - 3 * p2 + 3 * p1) * t * t + 2 * (3 * p2 - 6 * p1) * t + 3 * p1;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const gradient = slope(t, x1, x2);
      if (gradient === 0) break;
      t -= (at(t, x1, x2) - x) / gradient;
    }
    return at(clamp01(t), y1, y2);
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
