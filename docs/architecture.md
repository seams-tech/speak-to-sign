# Voice intents: architecture diagrams

These diagrams show how the parts of Speak-to-Sign work together. The rules
and the formats are in [`voice-intents-spec.md`](voice-intents-spec.md).
GitHub draws the Mermaid blocks.

## 1. System

The owner's device records the voice. The verifier runs in an OutLayer TEE
and calls two services. The Wallet signs only with a valid verdict.

```mermaid
flowchart LR
  subgraph Device["Owner's device"]
    App["App page<br/>demo/frontend, examples/speak-to-pay"]
    Plugin["Speak-to-Sign flow<br/>a part of @seams/wallet"]
    Core["Seams Wallet core<br/>pins the verdict key"]
    Mic["VoiceID prompt<br/>records 16 kHz WAV"]
  end

  subgraph Seams["Seams servers"]
    Route["Verify route"]
    Cosigner["Co-signer<br/>checks the verdict again"]
  end

  subgraph OutLayer["OutLayer TEE"]
    Verifier["Verifier<br/>crates/voice-verifier"]
    Store[("Storage<br/>templates, used audio,<br/>multisig proposals")]
    Key["Verdict key<br/>ed25519, bound to the project"]
  end

  subgraph Phala["Phala dstack CVM"]
    Speaker["Speaker service<br/>ReDimNet B1"]
  end

  Whisper["NEAR AI Cloud<br/>Whisper large-v3"]
  Rpc["NEAR RPC<br/>access-key view"]
  Chain["NEAR testnet<br/>notes, multisig, transfers"]

  App --> Plugin
  Plugin -->|scoped operations| Core
  Core --> Mic
  Core -->|audio and typed request| Route
  Route -->|HTTPS call| Verifier
  Verifier -->|WAV and nonce| Speaker
  Verifier -->|WAV| Whisper
  Verifier -->|enroll only| Rpc
  Verifier --- Store
  Verifier --- Key
  Verifier -->|signed verdict| Route
  Route --> Core
  Core -->|signing request with verdict| Cosigner
  Core -->|one signed transaction| Chain
```

## 2. Crates and packages

`spoken-intent` is the one source of the sentence and the digests. Each
other part links it or ports it.

```mermaid
flowchart TB
  SI["crates/spoken-intent<br/>render, digests, transcript rules"]
  Vec["fixtures/spoken_intent_vectors_v1.json<br/>golden vectors"]
  VV["crates/voice-verifier<br/>enroll, verify"]
  SS["crates/speaker-service<br/>signed embeddings"]
  MS["demo/contracts/voice-multisig<br/>checks the verdict on chain"]
  CN["demo/contracts/community-notes"]
  WT["seams-wallet<br/>TypeScript port and verdict check"]
  PL["Speak-to-Sign flow<br/>in @seams/wallet (seams-wallet)"]
  FE["demo/frontend and examples/speak-to-pay"]

  SI --> Vec
  SI -->|links| VV
  SI -->|links| MS
  Vec -->|tests read| WT
  VV -->|signed verdict vectors| WT
  VV -->|HTTPS| SS
  PL -->|bound operations| WT
  FE --> PL
  MS -->|hide_note| CN
```

## 3. Enrollment

The owner records three clips. A full-access key of the owner signs the
enrollment, so only the owner can set the template.

```mermaid
sequenceDiagram
  actor Owner
  participant Wallet as Wallet core and plugin
  participant Route as Seams verify route
  participant Verifier as Verifier (OutLayer TEE)
  participant Speaker as Speaker service (Phala)
  participant Rpc as NEAR RPC

  Owner->>Wallet: Say three phrases
  Wallet->>Wallet: Compute the enrollment digest of the three clips
  Owner->>Wallet: Confirm the NEP-413 message
  Wallet->>Route: enroll input with three WAVs and the authorization
  Route->>Verifier: HTTPS call
  Verifier->>Verifier: Check the NEP-413 signature
  par Three embeddings
    Verifier->>Speaker: WAV and nonce, three times
    Speaker-->>Verifier: Signed embeddings
  and Access key
    Verifier->>Rpc: view_access_key of the owner
    Rpc-->>Verifier: Full-access key or not
  end
  Verifier->>Verifier: Every pair of embeddings reaches cosine 0.45
  Verifier->>Verifier: Store the unit mean as template v3
  Verifier-->>Wallet: seams_voice_enrollment_v3
```

## 4. Verification

One recording, one typed request, one signed verdict. The two service calls
run at the same time, and the storage calls run while they are in flight.

```mermaid
sequenceDiagram
  actor Owner
  participant Wallet as Wallet core and plugin
  participant Route as Seams verify route
  participant Verifier as Verifier (OutLayer TEE)
  participant Speaker as Speaker service (Phala)
  participant Whisper as NEAR AI Whisper
  participant Cosigner as Seams co-signer
  participant Chain as NEAR testnet

  Wallet->>Owner: Show the sentence
  Owner->>Wallet: Say the sentence
  Wallet->>Wallet: Seal the WAV to the verifier's audio key
  Wallet->>Route: verify input with the request and the sealed WAV
  Route->>Verifier: HTTPS call
  Verifier->>Verifier: Render the request and compute the digests
  Verifier->>Verifier: Open the sealed WAV, decode it and run the energy gate
  par Speaker
    Verifier->>Speaker: Canonical WAV and nonce
    Speaker-->>Verifier: Signed embedding
  and Words
    Verifier->>Whisper: Canonical WAV
    Whisper-->>Verifier: Transcript
  end
  Note over Verifier: During the calls, read the template and write the used-audio mark
  Verifier->>Verifier: Speaker check, cosine 0.45 or more
  Verifier->>Verifier: Word check against the rendered words
  Verifier->>Verifier: Policy step
  Verifier->>Verifier: Sign the verdict, expiry 120 s
  Verifier-->>Wallet: Verdict and signature
  Wallet->>Wallet: Check the key, the digests and the expiry
  alt accept
    Wallet->>Cosigner: Signing request with the verdict
    Cosigner-->>Wallet: Co-signature
    Wallet->>Chain: One transaction from the owner
  else step_up
    Wallet->>Owner: Ask for a passkey approval
  else refuse
    Wallet->>Owner: Show the reason and the heard words
  end
```

## 5. Decision in the verifier

Each check can refuse. The policy step can only make the decision stricter.

```mermaid
flowchart TD
  In["verify input"] --> Req{"Request is speakable?"}
  Req -- no --> Unsupported["refuse: unsupported"]
  Req -- yes --> Wav{"WAV is valid?"}
  Wav -- no --> AudioInvalid["refuse: audio_invalid"]
  Wav -- yes --> Gate{"Energy gate passes?"}
  Gate -- no --> Quality["refuse: quality"]
  Gate -- yes --> Tpl{"Owner has a template?"}
  Tpl -- no --> Missing["refuse: template_missing"]
  Tpl -- yes --> Used{"Audio is new?"}
  Used -- no --> Reused["refuse: audio_reused"]
  Used -- yes --> Spk{"Cosine is 0.45 or more?"}
  Spk -- no --> SpeakerR["refuse: speaker"]
  Spk -- yes --> Words{"Heard words equal the sentence?"}
  Words -- no --> WordsR["refuse: words"]
  Words -- yes --> Pol{"Transfer above 10 NEAR?"}
  Pol -- yes --> StepUp["step_up: passkey needed"]
  Pol -- no --> Accept["accept"]
```

Every result, also a refusal, is a signed verdict.

## 6. What a verdict binds

The verdict connects four things: the request, the words, the audio and the
time. The checker builds the request digest itself and compares.

```mermaid
flowchart LR
  subgraph Request["Typed request"]
    F["network, owner,<br/>receiver and amount,<br/>or note hash, or commitment"]
  end
  subgraph Voice["Recording"]
    W["Canonical WAV"]
  end

  F -->|"borsh, SHA-256"| RD["request_digest"]
  F -->|render| ST["spoken_text"]
  ST -->|SHA-256| TD["spoken_text_digest"]
  W -->|SHA-256| AD["audio_digest"]
  W -->|ReDimNet| SC["speaker_score_milli"]
  W -->|Whisper| HD["heard"]

  RD --> V["verdict_json<br/>13 fields, outcome, expires_at_ms"]
  TD --> V
  AD --> V
  SC --> V
  HD --> V
  V -->|"SHA-256 with domain, ed25519"| SIG["signature_b64"]
  SIG --> CHK{"Checker:<br/>pinned key, accept,<br/>not expired,<br/>same request_digest"}
  CHK -->|Wallet core and co-signer| TX["One signed transaction"]
  CHK -->|Voice multisig contract| PR["Stored proposal"]
```

## 7. Voice multisig demo

The contract checks the verdict on chain. The chain holds only the
commitment until `execute`.

```mermaid
sequenceDiagram
  actor Visitor
  participant Page as Demo page
  participant Api as Pages functions
  participant Verifier as Verifier (OutLayer TEE)
  participant Wallet as Seams Wallet
  participant Multisig as Voice multisig contract
  participant Target as Receiver or notes contract

  Visitor->>Page: Say "approve proposal 1, hide note 42"
  Page->>Api: /api/voice-verify with the request and the WAV
  Api->>Verifier: HTTPS call
  Verifier->>Verifier: Draw the salt, check the voice and the words
  Verifier->>Verifier: Store the proposal and the salt
  Verifier-->>Page: Verdict, commitment and salt
  Page->>Wallet: Sign propose
  Wallet->>Multisig: propose with the commitment and the verdict
  Multisig->>Multisig: Check the signature, the expiry and the request digest
  Page->>Api: /api/multisig/approve with the opening
  Api->>Multisig: approve from admin A
  Api->>Multisig: approve from admin B
  Api->>Multisig: execute with the opening
  Multisig->>Multisig: Check the opening against the commitment
  Multisig->>Target: Transfer the NEAR, or call hide_note
  Page->>Visitor: Show the three approvals and the receipt
```

## 8. Trust boundaries

Each box is a party that the design trusts for one thing.

```mermaid
flowchart TB
  subgraph Pinned["Pinned by the Wallet and the contract"]
    VK["Verdict key of the OutLayer project"]
  end
  subgraph PinnedV["Pinned by the verifier"]
    SK["Speaker service key<br/>from the TDX attestation"]
    MD["ReDimNet B1 model digest"]
  end
  subgraph Unsigned["Not signed, trusted as given"]
    TR["NEAR AI transcript"]
    AK["NEAR RPC access-key view"]
  end
  subgraph Open["Not covered"]
    CL["Voice clone on a compromised device<br/>no liveness check"]
    PO["Project owner can deploy new code<br/>with the same key"]
  end

  SK --> VK
  MD --> VK
  TR --> VK
  AK --> VK
  CL -.-> VK
  PO -.-> VK
```

## 9. Confidential audio

A recording is sealed on the owner's device and opened only inside a TEE.
The servers between them carry ciphertext. Verifier 0.12.0 and later; the
rules are in section 5.1 of the specification.

```mermaid
flowchart TB
  subgraph Device["Owner's device (browser)"]
    REC["(1) Record<br/>one WAV, 16 kHz, at most 8 s"]
    SEAL["(2) Seal<br/>HPKE to the pinned audio key"]
  end
  subgraph Carriers["Carriers: sealed audio only"]
    ROUTE["(3) Seams verify route<br/>checks the session and the owner"]
    COORD["(4) OutLayer coordinator<br/>queues the call, stores its input"]
  end
  subgraph Worker["OutLayer worker (Intel TDX TEE)"]
    KEY["Audio key<br/>made in the keystore TEE"]
    OPEN["(5) Verifier opens the WAV<br/>and checks voice and words"]
    TPL[("Voice template<br/>192 numbers, keystore-encrypted")]
    MARK[("Used-audio mark<br/>SHA-256 of the WAV")]
  end
  subgraph Services["Model services (each in a TEE)"]
    SPK["(6a) Speaker service on Phala<br/>makes a signed embedding"]
    STT["(6b) NEAR AI Whisper<br/>makes the transcript"]
  end
  VERDICT["(7) Signed verdict<br/>back to the Wallet, no audio"]

  REC --> SEAL
  SEAL -- "sealed WAV" --> ROUTE
  ROUTE --> COORD
  COORD -- "sealed WAV" --> OPEN
  KEY -.-> OPEN
  TPL <--> OPEN
  MARK --- OPEN
  OPEN <-- "WAV over TLS, embedding back" --> SPK
  OPEN <-- "WAV over TLS, text back" --> STT
  SPK ~~~ VERDICT
  OPEN --> VERDICT

  classDef plain fill:#FAECE7,stroke:#993C1D,color:#4A1B0C
  classDef sealed fill:#E1F5EE,stroke:#0F6E56,color:#04342C
  classDef store fill:#F1EFE8,stroke:#5F5E5A,color:#2C2C2A
  class REC,SEAL,OPEN,SPK,STT plain
  class ROUTE,COORD sealed
  class KEY,TPL,MARK,VERDICT store
```

Orange boxes hold the plain recording. Green boxes hold only the sealed
recording. Grey boxes hold no audio.

| Step | Place | Form of the recording |
| --- | --- | --- |
| 1. Record | The VoiceID surface of the Wallet, in the browser | Plain, in memory |
| 2. Seal | Wallet core, with `sealAudio` of `@seams/voice-verdict` | Plain in, sealed out |
| 3. Seams verify route | The Seams server | Sealed |
| 4. OutLayer coordinator | OutLayer's API and its call record | Sealed |
| 5. Verifier | The OutLayer worker, inside its TEE | Plain, only for this run |
| 6a. Speaker service | A Phala dstack confidential VM (Intel TDX) | Plain, sent over TLS |
| 6b. NEAR AI Whisper | NEAR AI Cloud | Plain, sent over TLS |
| 7. Verdict | Back through the same servers | No audio |

What is kept after a run:

- **The voice template.** One embedding of 192 numbers for each owner, made
  from three enrollment recordings. It is in the worker storage under
  `template:v3:<owner>`, encrypted by the OutLayer keystore.
- **The used-audio mark.** The SHA-256 of each recording that the verifier
  saw, so that no recording passes twice.
- **No audio.** The verifier keeps no recording. It compares the embedding of
  a request with the template and then drops it.

Who holds which key:

- **The audio key.** An X25519 key pair. The OutLayer keystore made the
  private key inside its TEE as the secret `PROTECTED_AUDIO_KEY`, and gives it
  only to a run of this project. The Wallet pins the public key in its code.
- **The seal.** HPKE base mode with X25519, HKDF-SHA256 and
  ChaCha20-Poly1305. Each recording has a new ephemeral key. The operation
  and the owner are in the `aad`, so a sealed recording opens only for that
  owner's `verify` or `enroll`.

Limits:

- **The two model services see the recording.** The verifier pins the key of
  the Phala service from its TDX attestation. NEAR AI Cloud states that its
  inference runs in a TEE; the verifier does not check an attestation of
  NEAR AI.
- **The request is not secret.** The Wallet sends the request fields in plain
  text, and the verdict names the heard words.
- **The project owner.** A new verifier version of the same OutLayer project
  gets the audio key. The OutLayer access rule "One build only" limits the
  key to one WASM hash; it is not set.
- **The released Wallet.** Wallet core seals on `dev` of `seams-wallet`.
  `@seams/wallet` 0.66.0 on npm sends a plain WAV.
