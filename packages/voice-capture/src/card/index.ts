// The phrase card: one surface that shows a sentence, records it, and shows a check and a
// result. The building blocks are exported for a host that makes its own surfaces.

export {
  openPhraseCard,
  type PhraseCardContext,
  type PhraseCardControl,
  type PhraseCardControls,
  type PhraseCardFrame,
  type PhraseCardInput,
} from './surface';
export type {
  PhraseCheckView,
  PhraseChoice,
  PhraseRecording,
  PhraseResultView,
  PhraseSegmentState,
  PhraseSurface,
  PhraseText,
  PhraseView,
} from './types';
export { leaveSurface, VoicePrompt, type PhraseDisplay, type PromptChange } from './prompt';
export { PhraseCard, type HandedOverRows, type PromptCopy } from './phraseCard';
export { VoiceRibbon, type VoiceCheckingStyle } from './ribbon';
export { VoiceVisual } from './visual';
