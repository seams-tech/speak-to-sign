# Speak to Sign

Speak to Sign is a NEAR testnet vault that pays only when its owner says the
payment aloud. A verifier in a TEE hears the audio. It checks the speaker and
the words, and signs a verdict. The vault checks that verdict and pays in one
transaction. This repository holds the verifier, the vault, the speaker
service, the Gate 0 probes and the demo clients. It is for the NEAR hackathon.
Testnet only.

## Design in five lines

1. The Wallet records the owner, then calls the verifier over OutLayer's HTTPS API, with the audio in the request.
2. The verifier (`seams-v1.testnet/voice-verifier`, an OutLayer WASM worker) calls the Phala speaker service and NEAR AI Whisper at the same time.
3. It compares the speaker embedding with the owner's template (cutoff 0.45), checks the heard words against the text of the request, and marks the audio as used.
4. It returns a verdict signed with a project-bound ed25519 key.
5. The vault (`seams-wallet.testnet`) rebuilds the request from its own state, checks the signature against the key that it pinned at init, the nonce, the contact and the limits, and pays.

Design and record: `seams-monorepo/docs/refactor-210-voice-intents.md`,
Section 0 (Section 0 replaces the older on-chain flow in the rest of the
plan).

## Repository

| Folder            | What it is                                                             |
| ----------------- | ---------------------------------------------------------------------- |
| `voice-verifier/` | The OutLayer worker: `enroll` and `verify`. See its README.            |
| `voice-vault/`    | The vault contract: `transfer_with_verdict`, `authorize_enrollment`.   |
| `speaker-service/`| ReDimNet speaker embeddings in a Phala dstack CVM, signed replies.     |
| `demo/demo.py`    | The reference CLI client (macOS `say` in place of a microphone).       |
| `demo/web/`       | The demo page: real microphone, live stage times.                      |
| `gate0/`, `voice-probe/` | Gate 0 probes and the HTTPS latency probe.                      |

## Testnet facts

| Item                   | Value |
| ---------------------- | ----- |
| Verifier               | `seams-v1.testnet/voice-verifier`, version `1e79327b0afa2a0f026aee519bd0d1801272e21cb21205d31788e4d1452231f0` |
| HTTPS API              | `https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier` |
| `secrets_ref`          | `{"profile":"main","account_id":"cyan-loong.testnet"}` |
| Vault contract         | `seams-wallet.testnet` |
| Pinned verifier key    | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` |
| Demo owner             | `w3a-dev-1766307589.testnet` |
| Demo contact           | `seams-v1.testnet` |

## Run the demo page

You need Node 22 or later, an env file with `OUTLAYER_PAYMENT_KEY=...`, and
the owner's near-cli key file. The Phala speaker service must be running.

```sh
cd demo/web
node --env-file=../../.env server.mjs \
  --key-file ~/.near-credentials/testnet/w3a-dev-1766307589.testnet.json
# open http://127.0.0.1:8787/
```

- The server binds to `127.0.0.1` only. It refuses other `Host` headers.
- It keeps the payment key and the owner key. It never sends them to the page or prints them.
- Optional flags: `--port`, `--vault`, `--owner`, `--contact`, `--amount`, `--version-key`, `--url`.
- `GET /api/state` gives the vault state. `POST /api/enroll` and `POST /api/pay` take JSON and stream one JSON line for each stage.
- It does one enroll or pay at a time.

The page has two screens:

- **Pay by voice.** It shows the sentence "Send 0.1 NEAR to seams dash v1 dot testnet." Click Record and say it. Recording stops after 0.8 s of quiet, or at 8 s. The page shows the verify time, the speaker score, the heard text, "vault accepted", "settled", the time from the end of speech, and the nearblocks link. A refusal shows its reason: `speaker`, `words` or `audio_reused`.
- **Enroll voice.** Read three sentences. Then "Authorize and enroll" signs `authorize_enrollment` for those three recordings and calls `enroll`. A new template replaces the old one.

Demo controls on the pay screen:

- "Send the last recording again" shows the `audio_reused` refusal.
- "Tampered page" shows 0.1 NEAR but requests 0.5 NEAR. The verifier hears 0.1 and refuses with `words`.

Without a microphone, drive the server with macOS `say`:

```sh
node drive.mjs pay --voice Samantha --rate 197
node drive.mjs pay --voice Daniel --rate 203          # speaker refusal
node drive.mjs enroll --voice Samantha --rate 182
```

`say` rounds rates, and each recording works only once. So use a new rate
for each run. Tests of the Node port against `demo.py`: `node --test test.mjs`
(`python3 vectors.py > vectors.json` makes the vectors again).

## Reference CLI

`demo/demo.py` does the same flows from the terminal. It needs macOS `say`,
ffmpeg and PyNaCl.

```sh
python3 demo/demo.py enroll --env-file .env --vault seams-wallet.testnet \
  --owner w3a-dev-1766307589.testnet \
  --key-file ~/.near-credentials/testnet/w3a-dev-1766307589.testnet.json
python3 demo/demo.py pay --env-file .env --vault seams-wallet.testnet \
  --owner w3a-dev-1766307589.testnet \
  --key-file ~/.near-credentials/testnet/w3a-dev-1766307589.testnet.json \
  --amount 0.1 --contact seams-v1.testnet --rate 190
```

## Demo script (about 5 minutes)

Before the demo: start the Phala speaker service and the page server. The
vault has some NEAR and the active contact `seams-v1.testnet`. Enroll the
presenter's voice on the Enroll screen (about 15 s), and do one test payment.

1. **0:00** Open the vault on nearblocks (link at the foot of the page). Show the contact, the limits and the pinned verifier key.
2. **0:30** Pay by voice. Say "Send 0.1 NEAR to seams dash v1 dot testnet." The stage times fill in: verify (about 5 s), speaker score, heard text, vault accepted (about 2–3 s later). The target is at most 10 s from the end of speech to "vault accepted".
3. **1:15** Open the transaction. It is one transaction: `transfer_with_verdict`, then the transfer, then the callback. Show the `transfer_sent` event with the audio digest, and the verdict's `heard` field.
4. **2:00** Click "Send the last recording again". The verifier refuses with `audio_reused`. A recording can pay only once.
5. **2:30** Tampered page: tick the switch. The page still shows 0.1 NEAR, but it requests 0.5 NEAR. Say the sentence. The verifier refuses with `words`, so nothing is sent.
6. **3:15** Wrong speaker: a teammate says the sentence. The verifier refuses with `speaker`.
7. **3:45** Verdict replay: the vault refuses a used verdict with "nonce is not the next nonce" (recorded in the evidence).
8. **4:15** One slide: what each check shows and what it does not show (the trust limits below).

The spoken multisig of plan Section 5 is not in this build.

## Trust limits

- **OutLayer.** The TEE run of pinned code, its storage of the template and the used audio, its signing key, and the NEAR AI secret. If OutLayer's TEE or governance fails, the verdict means nothing.
- **Project owner.** The owner of the OutLayer project can deploy a new version that signs with the same project-bound key. The vault pins the key, not the code.
- **NEAR AI.** The gateway gives the transcript without a signature. A false transcript could pass the words check.
- **Phala.** The speaker service key comes from Phala's dstack KMS, per app ID. The Phala app owner can change the service code and keep the same key.
- **Voice clones.** A good clone that a compromised device plays can pass. This build has no liveness check and no fresh words.
- **This demo server.** It holds the owner key and the payment key, as a Wallet would. It is a local demo, not a release Wallet.

## Evidence

All in `seams-monorepo/docs/evidence/refactor-210-gate0/`:

- `README.md`: Gate 0 results, HTTPS latency, the end-to-end runs and the refusal table.
- `https-latency-speaker.jsonl`, `https-latency-tiny.jsonl`: 20-run latency records.
- `phala-speaker-attestation.json`: the speaker service attestation.

Demo page runs (2026-11-07, verifier `1e79327b…`):

| Run | Result |
| --- | ------ |
| `drive.mjs`, Samantha | Paid: [32BuritN…](https://testnet.nearblocks.io/txns/32BuritNjkBSNSYpoY2nApiS6cyWvqmqgeMsvJqk7n2X). Verify 5.9 s, speaker 823, vault accepted 2.1 s after send. |
| Same clip again | `audio_reused` |
| Daniel voice | `speaker`, score 88 |
| Page in headless Chrome, fake microphone (48 kHz → 16 kHz) | Paid: [DWQJUnC4…](https://testnet.nearblocks.io/txns/DWQJUnC4UnKHsBDA28HL6x4pWYpsJzbkR3UKGy2zXRWF). Speaker 661, 8.0 s from recording stop to vault accepted. |
| Page, tampered switch | `words` (heard "send zero point one near …") |
| Page, send again | `audio_reused` |
| `drive.mjs enroll` | Authorize [7SDkJFJB…](https://testnet.nearblocks.io/txns/7SDkJFJB3JaA6MRK4wgpABqfGzZdptxJ4rZpNSXPiaE9), enroll accepted, agreement 765, template epoch 2. |
