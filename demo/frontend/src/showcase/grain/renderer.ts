// From packages/grain-field-ts in seams-monorepo (commit 3407f157).
import { GRAIN_FIELD_GRID_SIZE, type GrainFieldSource } from './fields';

/* One WebGL context draws every grain field on the page. Browsers cap live
   WebGL contexts (Chrome at 16) and drop the oldest past the cap, so each
   field owns a plain 2D canvas and the shared context renders into it through
   drawImage. A 2D canvas also keeps its last frame while its field is paused
   or while the context is lost. */

/* The motion and grain of every field on the site. */
export type GrainStyle = {
  /* how far the flow moves a field, in heights of its short side */
  distortion: number;
  /* film grain amplitude */
  grain: number;
  /* 1 is the base pace */
  speed: number;
};

export const DEFAULT_GRAIN_STYLE: GrainStyle = { distortion: 0.75, grain: 0.08, speed: 1.9 };

export type GrainFieldHandle = {
  setPlaying(playing: boolean): void;
  setSize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
};

type View = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  source: GrainFieldSource;
  seed: number;
  playing: boolean;
  visible: boolean;
  /* device pixels */
  width: number;
  height: number;
  /* seconds of motion so far; a paused field resumes where it stopped */
  clock: number;
  /* scales the style's distortion for this field alone */
  flow: number;
  /* scales the style's speed for this field alone */
  pace: number;
  /* needs a frame even while paused: new, resized or restored */
  stale: boolean;
};

type Gpu = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  cover: WebGLUniformLocation | null;
  seed: WebGLUniformLocation | null;
  distortion: WebGLUniformLocation | null;
  grain: WebGLUniformLocation | null;
  textures: Map<string, WebGLTexture>;
};

/* the fields move slowly, so 30 frames a second is smooth and halves the work */
const FRAME_MS = 1000 / 30;
const MAX_STEP_S = 0.1;
const MAX_SIDE = 2048;

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uField;
uniform vec2 uResolution;
/* the part of the field on screen: below 1 on an axis that the field crops */
uniform vec2 uCover;
uniform float uTime;
uniform float uSeed;
uniform float uDistortion;
uniform float uGrain;
varying vec2 vUv;

const float GRID = ${GRAIN_FIELD_GRID_SIZE.toFixed(1)};

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/* Cubic B-spline over the grid in four bilinear taps. uv is in field space
   with y up; the grid's rows run top to bottom. */
vec3 field(vec2 uv) {
  uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  uv.y = 1.0 - uv.y;
  vec2 st = uv * GRID - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 p0 = (i - 0.5 + w1 / g0) / GRID;
  vec2 p1 = (i + 1.5 + w3 / g1) / GRID;
  vec3 c00 = texture2D(uField, p0).rgb;
  vec3 c10 = texture2D(uField, vec2(p1.x, p0.y)).rgb;
  vec3 c01 = texture2D(uField, vec2(p0.x, p1.y)).rgb;
  vec3 c11 = texture2D(uField, p1).rgb;
  return g0.y * (g0.x * c00 + g1.x * c10) + g1.y * (g0.x * c01 + g1.x * c11);
}

void main() {
  /* p spans 1 on the short side, so the flow is round on any shape */
  vec2 aspect = uResolution / min(uResolution.x, uResolution.y);
  vec2 p = (vUv - 0.5) * aspect;
  vec2 b = p * 0.8 + uSeed;
  float t = uTime;
  vec2 warp = vec2(
    noise(b + vec2(0.0, 0.12 * t)),
    noise(b + vec2(5.2, 1.3) - vec2(0.1 * t, 0.0))
  );
  vec2 flow = vec2(
    noise(1.3 * b + 1.2 * warp + vec2(1.7, 9.2) + 0.08 * t),
    noise(1.3 * b + 1.2 * warp + vec2(8.3, 2.8) - 0.07 * t)
  );
  vec3 color = field(0.5 + (p + flow * uDistortion) / aspect * uCover);
  /* the grain stays fixed to the screen while the field flows under it */
  color += (hash12(gl_FragCoord.xy) - 0.5) * uGrain;
  gl_FragColor = vec4(color, 1.0);
}
`;

const views = new Set<View>();
/* undefined: not created yet; null: WebGL is unavailable on this device */
let gpu: Gpu | null | undefined;
let request = 0;
let lastFrame = 0;
let reducedMotion: MediaQueryList | null = null;
let style = DEFAULT_GRAIN_STYLE;

/* each field flows on its own patch of noise, so two fields never move alike */
function noiseSeed(key: string): number {
  let seed = 0;
  for (const char of key) seed = (seed * 31 + char.charCodeAt(0)) % 997;
  return seed / 9.97;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function onContextLost(): void {
  /* the next draw builds a fresh context; until then each field keeps its
     last frame */
  gpu = undefined;
  for (const view of views) view.stale = true;
  schedule();
}

function createGpu(): Gpu | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    /* a software renderer would cost more CPU than the photographs saved */
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  /* one triangle that covers the viewport */
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  canvas.addEventListener('webglcontextlost', onContextLost);
  return {
    canvas,
    gl,
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    cover: gl.getUniformLocation(program, 'uCover'),
    seed: gl.getUniformLocation(program, 'uSeed'),
    distortion: gl.getUniformLocation(program, 'uDistortion'),
    grain: gl.getUniformLocation(program, 'uGrain'),
    textures: new Map(),
  };
}

function fieldTexture({ gl, textures }: Gpu, { key, grid }: GrainFieldSource): WebGLTexture | null {
  const cached = textures.get(key);
  if (cached) return cached;
  const texture = gl.createTexture();
  if (!texture) return null;
  const size = GRAIN_FIELD_GRID_SIZE;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, grid);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  textures.set(key, texture);
  return texture;
}

/* Without WebGL: the grid itself, smoothed by the 2D canvas, with no grain
   and no motion. */
function paintStill(view: View, context: CanvasRenderingContext2D): void {
  const size = GRAIN_FIELD_GRID_SIZE;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return;
  const { grid } = view.source;
  const image = tileContext.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    image.data.set(grid.subarray(i * 3, i * 3 + 3), i * 4);
    image.data[i * 4 + 3] = 255;
  }
  tileContext.putImageData(image, 0, 0);
  const { width, height } = view;
  const side = Math.max(width, height);
  context.imageSmoothingQuality = 'high';
  if (view.source.fit === 'stretch') context.drawImage(tile, 0, 0, width, height);
  else context.drawImage(tile, (width - side) / 2, (height - side) / 2, side, side);
}

function draw(view: View): void {
  view.stale = false;
  view.context ??= view.canvas.getContext('2d');
  const { context, width, height } = view;
  if (!context) return;
  if (view.canvas.width !== width || view.canvas.height !== height) {
    view.canvas.width = width;
    view.canvas.height = height;
  }
  if (gpu === undefined) gpu = createGpu();
  const texture = gpu && fieldTexture(gpu, view.source);
  if (!gpu || !texture) {
    paintStill(view, context);
    return;
  }
  const { canvas, gl } = gpu;
  if (canvas.width < width || canvas.height < height) {
    canvas.width = Math.max(canvas.width, width);
    canvas.height = Math.max(canvas.height, height);
  }
  gl.viewport(0, 0, width, height);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const side = Math.max(width, height);
  const cover = view.source.fit === 'cover';
  gl.uniform2f(gpu.resolution, width, height);
  gl.uniform2f(gpu.cover, cover ? width / side : 1, cover ? height / side : 1);
  gl.uniform1f(gpu.time, view.clock);
  gl.uniform1f(gpu.seed, view.seed);
  gl.uniform1f(gpu.distortion, style.distortion * view.flow);
  gl.uniform1f(gpu.grain, style.grain);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  /* the viewport sits at the bottom left of the shared canvas; copy it out
     before this task ends, while the drawing buffer still holds it */
  context.drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, width, height);
}

function animates(view: View): boolean {
  return (
    view.playing &&
    view.visible &&
    !reducedMotion?.matches &&
    document.visibilityState === 'visible'
  );
}

function tick(now: number): void {
  request = 0;
  const due = now - lastFrame >= FRAME_MS - 1;
  const step = Math.min((now - lastFrame) / 1000, MAX_STEP_S);
  let moving = false;
  if (due) lastFrame = now;
  for (const view of views) {
    if (!view.visible || view.width === 0 || view.height === 0) continue;
    const animate = animates(view);
    moving ||= animate;
    if (animate && due) {
      view.clock += step * style.speed * view.pace;
      draw(view);
    } else if (view.stale) {
      draw(view);
    }
  }
  if (moving && gpu) schedule();
}

function schedule(): void {
  if (request === 0) request = requestAnimationFrame(tick);
}

function watchEnvironment(): void {
  if (reducedMotion) return;
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
}

/* The gradient lab tunes the style live; the site keeps the default. */
export function setGrainStyle(next: GrainStyle): void {
  style = next;
  for (const view of views) view.stale = true;
  schedule();
}

function deviceSide(side: number): number {
  return Math.min(Math.max(Math.round(side), 0), MAX_SIDE);
}

export function addGrainField(
  canvas: HTMLCanvasElement,
  source: GrainFieldSource,
  flow = 1,
  pace = 1,
): GrainFieldHandle {
  watchEnvironment();
  const view: View = {
    canvas,
    context: null,
    source,
    seed: noiseSeed(source.key),
    playing: false,
    visible: false,
    width: 0,
    height: 0,
    clock: 0,
    flow,
    pace,
    stale: true,
  };
  views.add(view);
  return {
    setPlaying(playing) {
      view.playing = playing;
      schedule();
    },
    setSize(width, height) {
      const deviceWidth = deviceSide(width);
      const deviceHeight = deviceSide(height);
      if (deviceWidth === view.width && deviceHeight === view.height) return;
      view.width = deviceWidth;
      view.height = deviceHeight;
      view.stale = true;
      schedule();
    },
    setVisible(visible) {
      view.visible = visible;
      schedule();
    },
    dispose() {
      views.delete(view);
    },
  };
}
