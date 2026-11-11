// A fake Wallet core for the flows of the host plugin (host API 12). It records each recording,
// view and core call in order. Core opens the card, builds the verifier input, checks the
// request and signs: the Wallet tests that side in seams-wallet (tests/unit/speakToSign*).

import type {
  SpeakToSignClipHandle,
  SpeakToSignEnrollmentReply,
  SpeakToSignHostApproval,
  SpeakToSignHostEnrollment,
  SpeakToSignRecording,
  SpeakToSignRequestView,
  SpeakToSignSigning,
  SpeakToSignSurface,
  SpeakToSignVerifyReply,
} from '@seams/wallet/speak-to-sign-host';

type PhraseView = Parameters<SpeakToSignSurface['show']>[0];
type PhraseChoice = Awaited<ReturnType<SpeakToSignSurface['show']>>;

/** A handle of a recording. Core keeps the audio, so the plugin sees no bytes. */
export function clip(): SpeakToSignClipHandle {
  return { kind: 'captured', speechMs: 2_000, endOfSpeechAt: 0 };
}

/** The verifier output. The plugin hands it to core unread, so any value stands for one. */
export function verifierOutput(output: unknown = { verdict: 'opaque' }): SpeakToSignVerifyReply {
  return { kind: 'output', output };
}

/** The Seams verify route did not answer usefully. */
export function routeFailure(code: string): SpeakToSignVerifyReply {
  return { kind: 'failed', code };
}

/** The texts of a transfer of 25 NEAR, as core gives them. */
export const TRANSFER_VIEW: SpeakToSignRequestView = {
  kind: 'account_transfer',
  form: 'send',
  displayText: 'Send 25 NEAR to alice.testnet',
  spokenText: 'send twenty five near to alice dot testnet',
  counterparty: 'alice.testnet',
  amount: '25',
  summary: null,
};

export type FakeHostOptions = {
  /** Each recording, in order. The default is a new handle. */
  clips?: readonly SpeakToSignRecording[];
  /** The owner's answers to result views, in order. The default closes the card. */
  choices?: readonly PhraseChoice[];
  /** The reply of the verify route to each call. The default is `verifierOutput()`. */
  reply?: SpeakToSignVerifyReply;
  /** What core did for each `sign`, in order. The default sends it on the voice alone. */
  outcomes?: readonly SpeakToSignSigning[];
  /** What core answers to `enrollClips`. The default is `reply`. */
  enrollment?: SpeakToSignEnrollmentReply;
};

export type FakeHost = {
  /** The input of `approve` for a request with these texts. */
  approval(request?: SpeakToSignRequestView): SpeakToSignHostApproval;
  /** The input of `enroll`. `clips` are the samples of a VoiceID enrollment, or null. */
  enrollmentInput(clips?: readonly SpeakToSignClipHandle[] | null): SpeakToSignHostEnrollment;
  /**
   * What happened, in order: `record` (or `record <index>` in an enrollment),
   * `show: <check caption or result headline>`, `verify`, `sign`, `enroll` and `authorized`.
   */
  events: string[];
  /** Each view, as `check:<caption>` or `result:<label>:<headline>:<action label>`. */
  views: string[];
  /** The caption of each result view, in order. */
  captions: unknown[];
  /** The handle of each `verify` call. */
  verified: SpeakToSignClipHandle[];
  /** The verifier output of each `sign` call. */
  signed: unknown[];
  /** The handles of each `enrollClips` call. */
  enrolled: Array<readonly SpeakToSignClipHandle[]>;
};

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const clips = [...(options.clips ?? [])];
  const choices = [...(options.choices ?? [])];
  const outcomes = [...(options.outcomes ?? [])];
  const show = async (view: PhraseView): Promise<PhraseChoice> => {
    host.events.push(`show: ${view.kind === 'check' ? view.caption : view.headline}`);
    host.views.push(viewName(view));
    if (view.kind === 'result') host.captions.push(view.caption);
    return view.kind === 'check' ? 'replaced' : (choices.shift() ?? 'closed');
  };
  const base = {
    walletId: 'wallet:owner' as never,
    network: 'testnet',
    signal: new AbortController().signal,
    ownerAccountId: 'owner.testnet',
  } as const;
  const host: FakeHost = {
    events: [],
    views: [],
    captions: [],
    verified: [],
    signed: [],
    enrolled: [],
    approval: (request = TRANSFER_VIEW) => ({
      ...base,
      request,
      surface: { show },
      operations: {
        async record() {
          host.events.push('record');
          return clips.shift() ?? clip();
        },
        async verify(handle) {
          host.events.push('verify');
          host.verified.push(handle);
          return options.reply ?? verifierOutput();
        },
        async sign(output, hooks) {
          host.events.push('sign');
          host.signed.push(output);
          const signing: SpeakToSignSigning =
            outcomes.shift() ?? { kind: 'executed', transactionHash: 'tx-hash', approval: 'voice' };
          if (signing.kind === 'executed' && signing.approval === 'voice_and_passkey') {
            if (!(await hooks.approveStepUp('A voice payment above 10 NEAR needs a passkey.'))) {
              return { kind: 'cancelled' };
            }
            hooks.broadcasting();
          } else if (signing.kind === 'executed' || signing.kind.startsWith('signed')) {
            hooks.accepted();
          }
          // Core tells the card when a block holds a plain transfer, before the outcome.
          if (signing.kind === 'executed' && request.kind === 'account_transfer') {
            hooks.included(signing.transactionHash);
          }
          return signing;
        },
      },
    }),
    enrollmentInput: (adopted = null) => ({
      ...base,
      phraseCount: 3,
      clips: adopted,
      operations: {
        async record(index) {
          host.events.push(`record ${index}`);
          return clips.shift() ?? clip();
        },
        show,
        async enrollClips(handles, onAuthorized) {
          host.events.push('enroll');
          host.enrolled.push(handles);
          const reply = options.enrollment ?? options.reply ?? verifierOutput();
          if (reply.kind === 'not_signed') return reply;
          host.events.push('authorized');
          onAuthorized();
          return reply;
        },
      },
    }),
  };
  return host;
}

function viewName(view: PhraseView): string {
  return view.kind === 'check'
    ? `check:${view.caption}`
    : `result:${view.label}:${view.headline}:${view.action.label}`;
}
