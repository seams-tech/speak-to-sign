# @seams/voice-verdict

Speak-to-Sign with no Seams Wallet and no chain. The package has no
dependency. It runs in a browser, in Node.js 20 or later, in Deno, in Bun and
in a Cloudflare Worker.

| Part | Import | Job |
| --- | --- | --- |
| Verdict check | `checkVerdict` | Checks a signed verdict against the key that you pin |
| Request | `confirmationRequest` | Builds a request for any payload, and its digest |
| Client | `callVerifier` | Calls the verifier (an OutLayer worker) from your server |
| TDX quote | `checkAttestationBinding` | Checks that a TDX quote of OutLayer binds the verifier output to a WASM hash |

A complete application is in
[`examples/voice-confirm`](../../examples/voice-confirm).

A verdict is the answer of the Speak-to-Sign verifier to one question: did
the enrolled owner say the sentence of this request? The verifier signs the
verdict with ed25519. This package checks the signature and reads the
verdict.

The package is not on npm yet. Build it from this folder:

```sh
pnpm install
pnpm build
pnpm test
```

## Example

This example is complete. It checks the `accept` vector of
`crates/voice-verifier/testdata/signed_verdict_v2.json`. The key is the test
key of that file.

```ts
import { checkVerdict, requestDigest } from '@seams/voice-verdict';

// 1. The verifier key that you pin. Do not take it from the reply that you check.
const VERIFIER_KEY = 'ed25519:2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ';

// 2. The request that you built yourself, as Borsh of a `SpokenRequestV1`.
//    Here: owner.testnet sends 2 NEAR to alice.testnet on testnet.
const requestBorsh = Uint8Array.from(
  '02000d0000006f776e65722e746573746e65740d000000616c6963652e746573746e657400000042db999d3784a7010000000000'
    .match(/../g)!
    .map((byte) => Number.parseInt(byte, 16)),
);

// 3. The reply of the verifier (`verdict_json` and `signature_b64` of the verify output).
const verdictJson =
  '{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.8.0",' +
  '"request_digest":"uZOKUB3jJyRz6iwZ1QlcKFcBr-80sXinJ3qOIddBKws",' +
  '"spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys",' +
  '"audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"accept","reason":null,' +
  '"policy_rule":null,"expires_at_ms":1762700120000,"speaker_score_milli":655,' +
  '"word_margin_milli":142,"heard":"send two near to alice dot testnet"}';
const signatureB64 = 'xyQ8inRlFw7gnOCuyNiabKMjyO9DX2x4v91x+82sFX6Lzvt5SvrNojR2haMBJfD6R4IPE5Zyr5vMyL8h15fnDg==';

const result = await checkVerdict({
  verdictJson,
  signatureB64,
  publicKey: VERIFIER_KEY,
  requestDigest: await requestDigest(requestBorsh),
  // The vector has a fixed expiry. In your code, leave `nowMs` out: the default is `Date.now()`.
  nowMs: 1762700000000,
});

if (result.ok) {
  console.log('confirmed by voice:', result.verdict.heard);
} else {
  console.log('not confirmed:', result.refusal.code);
}
```

## What `checkVerdict` checks

The checks run in this order. The first check that fails gives the refusal.

| Order | Check | Refusal `code` |
| --- | --- | --- |
| 1 | The key is 32 bytes (`ed25519:<base58>`, hex or bytes). | `bad_public_key` |
| 2 | The signature is standard base64 of 64 bytes. | `bad_signature_encoding` |
| 3 | The key signed `SHA-256("seams:outlayer:voice-verdict:v2" \|\| verdictJson)`. | `bad_signature` |
| 4 | The text is JSON with exactly the 13 fields. | `malformed` |
| 5 | `kind` is `seams_voice_signed_verdict_v2`. | `wrong_kind` |
| 6 | `outcome` is not `refuse`. The refusal has the verifier's `reason`. | `refused` |
| 7 | `outcome` is not `step_up`, or `acceptStepUp` is `true`. | `step_up` |
| 8 | `expires_at_ms` is not before `nowMs`. | `expired` |
| 9 | `request_digest` is `requestDigest`, if you give one. | `request_mismatch` |
| 10 | `audio_digest` is `audioDigest`, if you give one. | `audio_mismatch` |

`checkVerdict` does not throw for a bad verdict. It throws only if the
runtime has no Ed25519 in Web Crypto.

## Rules for the caller

- Pass `verdictJson` exactly as the verifier gave it. Do not parse it and
  write it again: the signature is over the bytes.
- Pin the verifier key in your code or your configuration. The key in the
  verify output is not proof.
- Always pass `requestDigest`. Without it, a verdict for any request passes.
- A verdict has no nonce. It passes again until it expires (120 s). If your
  action must run one time, store the `audio_digest` of each verdict that
  you used, until its expiry.
- On `step_up`, the voice and the words passed, and a policy rule asks for a
  second approval. Pass `acceptStepUp: true` only if you get that approval.

## A request for any payload

`confirmationRequest` builds `SpokenRequestV1::Confirmation` (Borsh tag 10)
for an application owner. The verdict binds the owner, the context and the
SHA-256 of the payload. The owner says the summary.

```ts
import { callVerifier, checkVerdict, confirmationRequest } from '@seams/voice-verdict';

const login = await confirmationRequest({
  owner: 'app:user-42', // "app:" and your id of the user
  context: 'shop.example/login', // your name of the action
  payload: new TextEncoder().encode(sessionChallenge), // any bytes
  summary: 'Log in to the example shop', // the sentence that the user says
});

const output = await callVerifier(config, {
  op: 'verify',
  owner: login.owner,
  request: login.request,
  contacts: [],
  audio_wav_b64: audio,
});

const result = await checkVerdict({
  verdictJson: output.verdict_json,
  signatureB64: output.signature_b64 ?? '',
  publicKey: PINNED_VERIFIER_KEY,
  requestDigest: login.digest,
});
```

- `op: 'select'` takes `requests` (2 to 16 of them) in place of `request`.
  The output has `selected`, the index of the request that the user said.
  Check the verdict with the digest of that request.
- `op: 'enroll'` takes `{ owner, audio_wav_b64: [three WAVs] }`. An
  application owner needs no signature: your payment key is the authority.
  The reply has `verifier_public_key`, the key that you pin.
- `config` has your OutLayer payment key. Call the verifier from a server.

## A signed transcript

`op: 'transcribe'` takes `{ owner, audio_wav_b64 }` and no request. The
verifier checks the speaker and signs what the speech-to-text model heard.

```ts
const output = await callVerifier(config, { op: 'transcribe', owner: 'app:user-42', audio_wav_b64: audio });
const result = await checkTranscript({
  transcriptJson: output.transcript_json,
  signatureB64: output.signature_b64 ?? '',
  publicKey: PINNED_VERIFIER_KEY,
  owner: 'app:user-42',
});
if (result.ok) console.log(result.transcript.text); // "book a table for two at 8 o'clock please"
```

A transcript is weaker than a verdict. The verifier expected no sentence, so
it made no word check. A wrong word of the model is a wrong word of the
text. Use a transcript for a search, a note or a command with no value. For
an action with value, show the sentence and use `verify` or `select`.

## Audio

`audioDigest(wav)` gives the audio digest of a verdict for a WAV that you
sent. The verifier writes the WAV again with a plain 44-byte header before
it hashes it, so the digest is not the SHA-256 of your bytes. `audioDigest`
does the same. Pass its result to `checkVerdict` as `audioDigest`.

This package records no audio. Record the sentence with
`@seams/voice-capture` (`recordVoice`, then `pcm16Wav`), and send the WAV to
your server as standard base64. The verifier takes a 16 kHz mono PCM16 WAV of
at most 8 s.

## The TDX quote of a call (optional)

OutLayer makes a TDX quote for each call. The quote commits to the SHA-256
of the WASM that ran, of the input and of the output. So a third party can
check that one exact build of the verifier gave one exact verdict, with no
trust in the verdict key.

```ts
import {
  callVerifierWithAttestation,
  checkAttestationBinding,
  fetchAttestation,
  measurementsApproved,
  WORKER_CONTRACT,
} from '@seams/voice-verdict';

const call = await callVerifierWithAttestation(config, input);
const record = await fetchAttestation(config.baseUrl, call.attestationUrl!);

const bound = await checkAttestationBinding({
  record,
  output: call.output, // it holds verdict_json, so the quote covers the verdict
  acceptedWasmHashes: [MY_VERIFIER_WASM_SHA256], // from your own build of the source
  projectId: config.project,
});
if (!bound.ok) throw new Error(bound.refusal.code);

const approved = await measurementsApproved({
  rpcUrl: 'https://test.rpc.fastnear.com/',
  contract: WORKER_CONTRACT.testnet,
  measurements: bound.measurements,
});
```

`checkAttestationBinding` checks these links:

1. The first 32 bytes of the quote's report data are the task hash of the
   record (the WASM hash, the input hash, the output hash, the caller, the
   project and the time).
2. The output hash of the record is the hash of the output that you hold.
3. The WASM hash of the record is one that you accept.
4. If you give them: the input, the project and the caller.

Two checks are not in this package. The result names them in `notChecked`:

- **The signature of the quote.** A DCAP verifier must check the chain of
  the quote to Intel, with Intel's collateral. Pass `bound.quote` to one, or
  run `outlayer-verify call <call id>` (github.com/out-layer/outlayer-verify).
  Without this check, the quote is only a claim.
- **The measurements.** `measurementsApproved` asks the OutLayer contract on
  NEAR if it approves the five measurements. It trusts the RPC for the view.

To get the WASM hash that you accept, build the verifier from its source
(`crates/voice-verifier/build.sh --docker`). The build is reproducible.

Keep the output of a call as you received it, if a third party must check
it later. OutLayer stores only the hashes.

## Other functions

- `requestDigest(requestBorsh)`: the request digest of `spoken-intent`,
  `SHA-256("seams:spoken-intent:request:v1" || borsh)`. It rejects tag 1 (a
  multisig approval), which has its own digest.
- `verdictMessage(verdictJson)`: the 32 bytes that the verifier key signs.
- `parseVerdict(verdictJson)`: reads the 13 fields with no signature check.
- `parsePublicKey(key)`: the 32 bytes of a key text.

## What a verdict proves

A valid verdict proves that the holder of the verifier key signed this
result for this request digest. The verdict holds no TDX quote: the quote of
the call is a second, optional proof (see above). Neither proves that the
voice was live: a good voice clone can pass. The transcript comes from
NEAR AI with no signature, so the quote covers the verifier and not the
speech-to-text model. The plan for
these limits is in [`docs/standalone-library.md`](../../docs/standalone-library.md).

The Rust crate with the same check is in
[`crates/voice-verdict`](../../crates/voice-verdict).
