# Voice confirmation for a Web2 application

A small web page and a small server. A user enrolls a voice, then confirms
one of three actions of an order by voice. No wallet, no chain, no account
of the user on NEAR.

- `index.html` records the voice with `@seams/speak-to-sign/browser`
  (`recordSentence`, which uses `@seams/voice-capture`). It has no bundler:
  an import map names the capture library.
- `server.mjs` holds the OutLayer payment key and uses
  `@seams/speak-to-sign/server`. It has no dependency of its own.

The user is the application owner `app:<user id>`. The server sends the
three possible actions to the operation `select`. The verifier signs a
verdict for the one sentence that the user said. The server accepts the
action only if `select` of `@seams/speak-to-sign/server` returns `ok`. That
means these checks passed:

1. The pinned verifier key signed it.
2. Its request digest is the digest of the selected action, which the server
   computed from its own data (the owner, the context and the SHA-256 of the
   order).
3. Its audio digest is the digest of the recording that the server sent.
4. It is not expired, and the server did not accept it before.

## Look at the page with no account

Build the three packages one time:

```sh
(cd ../../packages/voice-verdict && pnpm install && pnpm build)
```

```sh
(cd ../../packages/voice-capture && pnpm install && pnpm build)
```

```sh
(cd ../../packages/speak-to-sign && pnpm install && pnpm build)
```

```sh
FAKE_VERIFIER=1 node server.mjs
```

Open `http://localhost:8787`. The fake verifier checks no voice: you select
the sentence that it hears. It shows the page and the checks of the server.

## Run it with the verifier

You need your own accounts. The library is open source, and each developer
pays for its own runs:

1. An OutLayer payment key (`https://outlayer.ai`).
2. A NEAR AI Cloud API key, stored as the OutLayer secret `NEAR_AI_API_KEY`
   in a secrets profile of your account.
3. A verifier version with the operation `select` and application owners:
   version 0.10.0, `9b0609fa1e46e5d8b6b00f96b10b375c248e8cf200ccea8e1adbbc8ea52d44eb`,
   in the project `seams-v1.testnet/voice-verifier` on testnet. To check it,
   build it with `crates/voice-verifier/build.sh --docker` and compare the
   SHA-256.

Your payment key gives you your own storage cell and your own verdict key.
So you have your own users, and no other developer can enroll a voice for
them.

Set these values, then run `node server.mjs`:

| Name | Value |
| --- | --- |
| `OUTLAYER_BASE_URL` | `https://testnet-api.outlayer.ai` |
| `OUTLAYER_PROJECT` | The project of the verifier, `owner/project` |
| `OUTLAYER_PAYMENT_KEY` | Your payment key. Keep it on the server |
| `OUTLAYER_VERSION_KEY` | The SHA-256 of the verifier WASM that you checked |
| `OUTLAYER_SECRETS_PROFILE` | The secrets profile with `NEAR_AI_API_KEY` |
| `OUTLAYER_SECRETS_ACCOUNT_ID` | The account of that secrets profile |
| `VERIFIER_PUBLIC_KEY` | The verdict key of your payment key, `ed25519:...` |

To get `VERIFIER_PUBLIC_KEY`: enroll one user. The reply of `/api/enroll`
has `verifierPublicKey`. Pin that value. Do not read the key from a reply
that you check.

## Limits

- The same calls and checks ran against verifier 0.8.0 on OutLayer testnet
  from a script, with a synthetic voice: `enroll`, `select`, the verdict
  check with the audio digest, and the TDX quote check. The page and this
  server ran only with the fake verifier.
- The sentences have no numbers. The speech-to-text model writes "forty
  dollars" as "40", and the word check then refuses the sentence.
- The page loads the capture library and asks for the microphone. No test
  recorded a real voice through the page.
- Set `CHECK_TDX_QUOTE=1` to make each confirmation also need the TDX quote
  of its call (it needs `OUTLAYER_VERSION_KEY`).
- The page has no login. A real application takes the user id from its
  session, not from a text field.
- The voice proves that the enrolled person said the sentence. It does not
  prove that the voice was live: a good voice clone can pass.
