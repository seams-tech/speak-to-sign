# Voice confirmation for a Web2 application

A small web page and a small server. A user enrolls a voice, then confirms
one of three actions of an order by voice. No wallet, no chain, no account
of the user on NEAR.

- `index.html` records the voice with `record.js`, a plain recorder of this
  example. The capture library of this repository is `@seams/voice-capture`.
  It is not on this branch yet; the page will use it after the merge.
- `server.mjs` holds the OutLayer payment key. It calls the Speak-to-Sign
  verifier and checks each signed verdict with `@seams/voice-verdict`. It
  has no dependency.

The user is the application owner `app:<user id>`. The server sends the
three possible actions to the operation `select`. The verifier signs a
verdict for the one sentence that the user said. The server accepts the
action only if the verdict passes these checks:

1. The pinned verifier key signed it.
2. Its request digest is the digest of the selected action, which the server
   computed from its own data (the owner, the context and the SHA-256 of the
   order).
3. Its audio digest is the digest of the recording that the server sent.
4. It is not expired, and the server did not accept it before.

## Look at the page with no account

```sh
(cd ../../packages/voice-verdict && pnpm install && pnpm build)
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
3. A verifier version with the operation `select` and application owners
   (source version 0.8.0 of `crates/voice-verifier` or later). Build it with
   `crates/voice-verifier/build.sh --docker` and compare its SHA-256 with
   the version key that you call.

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

- This example was run only with the fake verifier. No verifier version with
  `select` is on OutLayer yet.
- The microphone path of the page was not run in a test. `record.js` has no
  speech detection and no quality check: the verifier refuses bad audio with
  the reason `quality`, and that recording is then used up.
- The page has no login. A real application takes the user id from its
  session, not from a text field.
- The voice proves that the enrolled person said the sentence. It does not
  prove that the voice was live: a good voice clone can pass.
