// The settings of the host page. The package has no fixed asset path and no storage of its own,
// so a wallet, or any other page, can give its own.

/** The microphone that the person chose: the system default, or one exact device. */
export type VoiceMicrophonePreference =
  | { readonly kind: 'system_default'; readonly deviceId?: never }
  | { readonly kind: 'device'; readonly deviceId: string };

/** Where the page keeps the chosen microphone. `read` returns what `save` got, or anything else. */
export type VoiceMicrophonePreferenceStore = Readonly<{
  read(): Promise<unknown>;
  save(preference: VoiceMicrophonePreference): Promise<void>;
}>;

export type VoiceCaptureConfig = Readonly<{
  /**
   * The folder URL that serves the files of `@seams/voice-capture/hosting`: the speech detection
   * model, the audio worklet and the model engine. A relative URL is read against the page.
   */
  assetBase: string | URL;
  /** Keeps the chosen microphone between visits. Default: it lasts until the page reloads. */
  microphonePreference?: VoiceMicrophonePreferenceStore;
  /** The product name in messages for the person, such as "VoiceID". */
  label?: string;
  /** The place that the person must keep open, such as "the Wallet". */
  place?: string;
  /** The last sentence of a message about a file that cannot load. */
  recoveryHint?: string;
  /** The name of the browser cache that keeps the model files. */
  cacheName?: string;
}>;

type ResolvedConfig = Required<Omit<VoiceCaptureConfig, 'assetBase' | 'microphonePreference'>> &
  Readonly<{ assetBase: URL | null; microphonePreference: VoiceMicrophonePreferenceStore | null }>;

const DEFAULTS: ResolvedConfig = {
  assetBase: null,
  microphonePreference: null,
  label: 'Voice capture',
  place: 'this page',
  recoveryHint: 'Reload the page and try again.',
  cacheName: 'seams-voice-capture-models-v1',
};

let current: ResolvedConfig = DEFAULTS;

/** Sets where the assets are and how the page names itself. Call it once, before a recording. */
export function configureVoiceCapture(config: VoiceCaptureConfig): void {
  // A page gives a relative folder; a test or a worker gives an absolute URL.
  const base = new URL(config.assetBase, globalThis.document?.baseURI);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  current = {
    assetBase: base,
    microphonePreference: config.microphonePreference ?? null,
    label: config.label ?? DEFAULTS.label,
    place: config.place ?? DEFAULTS.place,
    recoveryHint: config.recoveryHint ?? DEFAULTS.recoveryHint,
    cacheName: config.cacheName ?? DEFAULTS.cacheName,
  };
}

export function captureConfig(): ResolvedConfig {
  return current;
}

/** The URL of one asset file. It throws before `configureVoiceCapture` set the folder. */
export function assetUrl(fileName: string): URL {
  if (!current.assetBase) {
    throw new Error('Call configureVoiceCapture({ assetBase }) before you load a voice asset.');
  }
  return new URL(fileName, current.assetBase);
}
