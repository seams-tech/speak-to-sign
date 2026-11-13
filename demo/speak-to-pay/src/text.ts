import type {
  SpeakToSignEnrollmentResult,
  SpeakToSignRefusalReason,
  SpeakToSignTransferTimes,
  SpeakToSignUnavailableReason,
} from '@seams/wallet';

type TransferRefusal = SpeakToSignRefusalReason;
type EnrollmentRefusal = Extract<SpeakToSignEnrollmentResult, { kind: 'refused' }>['reason'];

const TRANSFER_REFUSALS: Record<TransferRefusal, string> = {
  quality: 'The recording was too quiet, too short or too noisy.',
  speaker: 'The voice did not match the enrolled voice.',
  words: 'The words did not match the sentence.',
  audio_reused: 'The verifier already saw this audio.',
  audio_invalid: 'The verifier could not read the audio.',
  template_missing: 'The verifier has no voice template for you. Do step 1 first.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check did not answer.',
  storage: 'The verifier storage failed.',
  transcriber_unavailable: 'The transcription service did not answer.',
  transcriber_not_attested: 'The verifier could not check the TEE of the transcription service. Try again.',
  amount_not_speakable: 'The amount must be whole hundredths of NEAR, from 0.01 to 1,000,000.',
  receiver_not_speakable:
    'The receiver must be a named NEAR account that you can say, not an implicit (64-hex) account.',
  receiver_missing: 'The receiver account does not exist on NEAR testnet.',
  verdict_mismatch: 'The signed verdict did not match this payment, or it expired.',
  transaction_failed: 'NEAR ran the transfer, and it failed.',
  // The Seams co-signer checks the verdict again before it signs. This is its refusal.
  cosigner_refused: 'Seams did not accept the verdict, so nothing was signed.',
  summary_mismatch: 'The sentence does not give the main point of the note.',
  summary_check_unavailable: 'The summary check service did not answer.',
};

const ENROLLMENT_REFUSALS: Record<EnrollmentRefusal, string> = {
  quality: 'A recording was too quiet, too short or too noisy.',
  speaker: 'The three recordings do not sound like one speaker.',
  audio_reused: 'The verifier already saw this audio.',
  audio_invalid: 'The verifier could not read the audio.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check did not answer.',
  storage: 'The verifier storage failed.',
  template_exists: 'Another enrollment changed your template at the same time.',
  not_authorized: 'A full-access key of your account did not sign this enrollment.',
  authorization_unavailable: 'The verifier could not read your account key on NEAR.',
};

const UNAVAILABLE: Record<SpeakToSignUnavailableReason, string> = {
  flow_not_available: 'This Wallet cannot start the flow.',
  voiceid_unavailable: 'VoiceID is not on for this wallet. Do step 1 first.',
  verifier_unavailable: 'The Seams verify route did not answer.',
  not_submitted: 'The Wallet did not send the transaction. Nothing was paid.',
  submission_unknown: 'The transaction may have been sent. Check NearBlocks before you pay again.',
  summary_unavailable: 'Seams could not write the sentence to say. Try again.',
};

export function transferRefusalText(reason: TransferRefusal): string {
  return TRANSFER_REFUSALS[reason];
}

export function enrollmentRefusalText(reason: EnrollmentRefusal): string {
  return ENROLLMENT_REFUSALS[reason];
}

export function unavailableText(reason: SpeakToSignUnavailableReason): string {
  return UNAVAILABLE[reason];
}

export const STAGE_LABELS: ReadonlyArray<readonly [keyof SpeakToSignTransferTimes, string]> = [
  ['speechMs', 'Speech'],
  ['verifyMs', 'Verify'],
  ['transactionMs', 'Check, sign and send'],
  ['endOfSpeechToReceiptMs', 'End of speech to receipt'],
];

export function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Something failed without a message.';
}
