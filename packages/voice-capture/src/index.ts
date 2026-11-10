// Records one spoken sentence in the browser. The package has no user interface and no
// dependency on a wallet: a page sets the asset folder, records, and gets 16 kHz samples.

export {
  configureVoiceCapture,
  type VoiceCaptureConfig,
  type VoiceMicrophonePreference,
  type VoiceMicrophonePreferenceStore,
} from './config';
export {
  recordVoice,
  requireVoiceForeground,
  requireVoiceUserAction,
  voiceQualityMessage,
  InsufficientVoiceAudioError,
  type VoiceActivityEvent,
  type VoiceCaptureEvent,
  type VoiceCaptureObserver,
  type VoiceCaptureQuality,
  type VoiceRecordingOptions,
  type VoiceRecordingResult,
} from './microphone';
export {
  openVoiceMicrophone,
  rememberVoiceMicrophone,
  useSystemVoiceMicrophone,
  VoiceMicrophoneInterruptedError,
  type VoiceMicrophone,
} from './microphoneInput';
export { endPauseMs, expectedSpeechMs } from './speechPause';
export {
  createVoiceActivity,
  levelDetector,
  voiceActivityModel,
  type SpeechDetector,
} from './voiceActivity';
export {
  BrowserInferenceModel,
  VoiceAssetLoadError,
  voiceInferenceEngine,
  type ModelAsset,
  type VoiceAssetProgress,
} from './inference';
export { MAX_SAMPLES, pcm16Wav, SAMPLE_RATE } from './wav';
