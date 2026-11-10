import type { InferenceSession } from 'onnxruntime-web';
import { assetUrl, captureConfig } from './config';

/** One file under the asset folder, with the exact bytes that the page accepts. */
export type ModelAsset = Readonly<{
  fileName: string;
  sha256: string;
  bytes: number;
  /** The name in messages for the person. A function reads the settings when it is needed. */
  label: string | (() => string);
}>;
export type VoiceAssetProgress =
  { kind: 'checking_cache' } | { kind: 'downloading'; received: number } | { kind: 'ready' };
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

export class VoiceAssetLoadError extends Error {
  constructor(
    readonly kind: 'connection' | 'unavailable' | 'integrity' | 'initialization',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VoiceAssetLoadError';
  }
}

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(captureConfig().cacheName);
  } catch {
    return null;
  }
}

class BrowserInferenceAsset {
  private pending: Promise<ArrayBuffer> | null = null;
  private progress: VoiceAssetProgress = { kind: 'checking_cache' };
  private readonly listeners = new Set<(progress: VoiceAssetProgress) => void>();

  constructor(private readonly asset: ModelAsset) {}

  get size(): number {
    return this.asset.bytes;
  }

  async download(onProgress?: (progress: VoiceAssetProgress) => void): Promise<ArrayBuffer> {
    if (onProgress) {
      this.listeners.add(onProgress);
      onProgress(this.progress);
    }
    try {
      if (!this.pending) this.pending = this.bytes().catch(this.failed);
      const bytes = await this.pending;
      this.publish({ kind: 'ready' });
      return bytes;
    } finally {
      if (onProgress) this.listeners.delete(onProgress);
    }
  }

  private readonly failed = (error: unknown): never => {
    this.pending = null;
    this.progress = { kind: 'checking_cache' };
    throw error;
  };

  private publish(progress: VoiceAssetProgress): void {
    this.progress = progress;
    for (const listener of this.listeners) listener(progress);
  }

  private async valid(bytes: ArrayBuffer): Promise<boolean> {
    if (bytes.byteLength !== this.asset.bytes) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    return hex === this.asset.sha256;
  }

  private async bytes(): Promise<ArrayBuffer> {
    const { fileName, sha256 } = this.asset;
    this.publish({ kind: 'checking_cache' });
    const cache = await openModelCache();
    const cacheKey = new URL(`${fileName}?sha256=${sha256}`, assetUrl('')).href;
    try {
      const response = await cache?.match(cacheKey);
      if (response) {
        const bytes = await response.arrayBuffer();
        if (await this.valid(bytes)) return bytes;
        await cache?.delete(cacheKey);
      }
    } catch {
      // Cache access can fail in restricted browser storage.
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await this.fetchBytes();
    } catch (error) {
      if (!(error instanceof VoiceAssetLoadError) || error.kind !== 'connection') throw error;
      // Retry only the download. The caller never repeats what it did with the model.
      bytes = await this.fetchBytes();
    }
    if (cache) {
      try {
        await cache.put(
          cacheKey,
          new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }),
        );
      } catch {
        // Inference remains available for this session if storage is full.
      }
    }
    return bytes;
  }

  private async fetchBytes(): Promise<ArrayBuffer> {
    const { fileName } = this.asset;
    const label = typeof this.asset.label === 'function' ? this.asset.label() : this.asset.label;
    const controller = new AbortController();
    let idle = setTimeout(abortDownload.bind(null, controller), DOWNLOAD_IDLE_TIMEOUT_MS);
    this.publish({ kind: 'downloading', received: 0 });
    try {
      const response = await fetch(assetUrl(fileName), {
        credentials: 'omit',
        cache: 'reload',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const transient = [408, 429, 500, 502, 503, 504].includes(response.status);
        throw new VoiceAssetLoadError(
          transient ? 'connection' : 'unavailable',
          transient
            ? `${label} download was interrupted. Check your connection and retry.`
            : `${label} is unavailable from ${captureConfig().site}. ${captureConfig().recoveryHint}`,
        );
      }
      const reader = response.body.getReader();
      const bytes = new Uint8Array(this.asset.bytes);
      let received = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          clearTimeout(idle);
          idle = setTimeout(abortDownload.bind(null, controller), DOWNLOAD_IDLE_TIMEOUT_MS);
          if (received + chunk.value.length > bytes.length)
            throw new VoiceAssetLoadError('integrity', `${label} size is invalid. Retry loading.`);
          bytes.set(chunk.value, received);
          received += chunk.value.length;
          this.publish({ kind: 'downloading', received });
        }
      } finally {
        await reader.cancel().catch(ignoreCancelledDownload);
        reader.releaseLock();
      }
      if (received !== bytes.length || !(await this.valid(bytes.buffer)))
        throw new VoiceAssetLoadError(
          'integrity',
          `${label} integrity check failed. Retry loading.`,
        );
      return bytes.buffer;
    } catch (error) {
      if (error instanceof VoiceAssetLoadError) throw error;
      throw new VoiceAssetLoadError(
        'connection',
        `${label} download was interrupted. Check your connection and retry.`,
        { cause: error },
      );
    } finally {
      clearTimeout(idle);
      controller.abort();
    }
  }
}

function abortDownload(controller: AbortController): void {
  controller.abort();
}

function ignoreCancelledDownload(): void {}

// These bytes match the pinned onnxruntime-web dependency. `./hosting` copies the file.
export const voiceInferenceEngine = new BrowserInferenceAsset({
  fileName: 'ort-wasm-simd-threaded.wasm',
  sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
  bytes: 14_239_897,
  label: () => `${captureConfig().label} engine`,
});

export class BrowserInferenceModel {
  readonly asset: BrowserInferenceAsset;
  private session: Promise<InferenceSession> | null = null;

  constructor(asset: ModelAsset) {
    this.asset = new BrowserInferenceAsset(asset);
  }

  prepare(): Promise<InferenceSession> {
    if (!this.session) this.session = this.load().catch(this.failed);
    return this.session;
  }

  private readonly failed = (error: unknown): never => {
    this.session = null;
    throw error;
  };

  private async load(): Promise<InferenceSession> {
    try {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = assetUrl('').href;
      ort.env.wasm.wasmBinary = await voiceInferenceEngine.download();
      const bytes = await this.asset.download();
      return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    } catch (error) {
      if (error instanceof VoiceAssetLoadError) throw error;
      const { label, recoveryHint } = captureConfig();
      // A page shows only a retry message; keep the engine's reason visible to integrators.
      console.error(`[${label}] inference engine could not start`, error);
      throw new VoiceAssetLoadError(
        'initialization',
        `${label} could not start. Retry loading. If it still fails, ${recoveryHint.charAt(0).toLowerCase()}${recoveryHint.slice(1)}`,
        { cause: error },
      );
    }
  }
}
