import type { SpeakToSignHostOperations, SpeakToSignPrompt } from '@seams/wallet/speak-to-sign-host';

type PromptRequest = Parameters<SpeakToSignHostOperations['openPrompt']>[0];
type Clip = Awaited<ReturnType<SpeakToSignPrompt['record']>>;

/** VoiceID could not load or record on this Wallet host. */
type VoiceIdUnavailable = Readonly<{
  kind: 'unavailable';
  reason: 'voiceid_unavailable';
  detail: string;
}>;

/**
 * Opens the VoiceID prompt of one sentence, runs `use` with it, then closes it. The card stays
 * open while `use` runs, so a flow that keeps the card for its next steps runs them in `use`.
 */
export async function withPrompt<T>(
  operations: SpeakToSignHostOperations,
  request: PromptRequest,
  use: (prompt: SpeakToSignPrompt) => Promise<T>,
): Promise<T | VoiceIdUnavailable> {
  const opened = await operations.openPrompt(request);
  if (opened.kind === 'unavailable') return voiceIdUnavailable(opened.detail);
  try {
    return await use(opened.prompt);
  } finally {
    opened.prompt.close();
  }
}

/** Records one clip of the sentence. A recording that VoiceID cannot make is unavailable too. */
export async function recordClip(
  prompt: SpeakToSignPrompt,
): Promise<Exclude<Clip, { kind: 'unavailable' }> | VoiceIdUnavailable> {
  const clip = await prompt.record();
  return clip.kind === 'unavailable' ? voiceIdUnavailable(clip.detail) : clip;
}

function voiceIdUnavailable(detail: string): VoiceIdUnavailable {
  return { kind: 'unavailable', reason: 'voiceid_unavailable', detail };
}
