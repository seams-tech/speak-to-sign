// "Set up your voice": one step for the visitor. The setup card runs it from its button; a note or
// a rating runs it first when the voice is not set up yet. The page keeps a mark per account in
// localStorage, because the Wallet does not say whether the verifier has a template.

import { useEffect, useState } from 'react';
import type { SetupOutcome, SignerSetup, SignerStatus } from './notesSigner';

/**
 * A window event after a setup step changes the Wallet (the voice set up). The Speak-to-Sign page
 * and the notes app both show the steps, so each one reads the state again.
 */
export const SETUP_CHANGED = 'speak-to-sign:setup-changed';

/** The two parts of "Set up your voice". */
export type VoicePhase = 'voice' | 'enroll';

function enrolledKey(account: string) {
  return `spoken-notes:enrolled:${account}`;
}

export function readEnrolled(account: string | undefined): boolean {
  if (!account) return false;
  try {
    return localStorage.getItem(enrolledKey(account)) === '1';
  } catch {
    return false;
  }
}

function markEnrolled(account: string) {
  try {
    localStorage.setItem(enrolledKey(account), '1');
  } catch {
    // The step shows as done for this visit only.
  }
}

/** True when the voice of `account` is set up: VoiceID is on and the verifier has the voice. */
export function voiceIsSetUp(status: SignerStatus | null, account: string | undefined): boolean {
  return !!status?.voiceReady && readEnrolled(account);
}

/** `readEnrolled`, kept current when a setup step changes the Wallet. */
export function useEnrolled(account: string | undefined): boolean {
  const [enrolled, setEnrolled] = useState(() => readEnrolled(account));
  useEffect(() => {
    setEnrolled(readEnrolled(account));
    const onChange = () => setEnrolled(readEnrolled(account));
    window.addEventListener(SETUP_CHANGED, onChange);
    return () => window.removeEventListener(SETUP_CHANGED, onChange);
  }, [account]);
  return enrolled;
}

/**
 * One step and one set of recordings for the visitor: turn VoiceID back on if it was turned off,
 * then enroll. For a wallet without VoiceID, the enrollment turns it on, and the Wallet uses the
 * same three recordings for VoiceID and the verifier.
 */
export async function setUpVoice(
  signer: SignerSetup,
  account: string,
  onPhase: (phase: VoicePhase) => void = () => undefined,
): Promise<SetupOutcome> {
  try {
    onPhase('voice');
    const voice = await signer.enableVoice();
    if (voice.kind !== 'done') return voice;
    onPhase('enroll');
    const enrollment = await signer.enroll();
    if (enrollment.kind !== 'done') return enrollment;
    markEnrolled(account);
    return { kind: 'done', message: `Your voice is set up. ${enrollment.message}` };
  } finally {
    window.dispatchEvent(new Event(SETUP_CHANGED));
  }
}
