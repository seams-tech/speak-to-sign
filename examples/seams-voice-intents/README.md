# Seams Voice Intents

An example web page for Seams Speak-to-Sign. Pay a named NEAR testnet account
with your voice. You read one sentence, for example "Send 1 NEAR to
seams-v1.testnet." An attested verifier checks your voice and your words. Then
your Seams Wallet pays from your own account, with no confirm. Testnet only. Do
not use real funds.

The page has five steps:

0. Sign in to your Seams Wallet with a passkey, or create a wallet.
1. Turn on VoiceID for the wallet.
2. Enroll your voice with the verifier (three short phrases and one signed message).
3. Check that your NEAR account has testnet NEAR.
4. Type an amount and a receiver, then click **Pay by voice** and read the sentence.

## 1. Set up a Seams project

The Seams Wallet accepts sign-in only from the origins of your project.

1. In the Seams Console of the staging deployment, create a project with a
   NEAR testnet environment.
2. Add the origins of this page to the environment:
   - `http://localhost:5280` for `pnpm dev`.
   - Your Cloudflare Pages origin, for example `https://seams-voice-intents.pages.dev`,
     and your custom domain if you add one.
3. Copy the publishable key of the environment. A publishable key is public,
   but it works only from the origins of step 2.

A wallet belongs to one project. If you used Speak to Sign in another project,
create a new wallet here and enroll your voice again.

## 2. Run it locally

You need Node 22 or later and pnpm 10.

```bash
cd examples/seams-voice-intents
pnpm install
cp .env.example .env.local   # then set VITE_SEAMS_PUBLISHABLE_KEY
pnpm dev                     # http://localhost:5280
```

The port is fixed, because the project must allow the exact origin.

## 3. Deploy to Cloudflare Pages

The `VITE_*` settings are read at build time.

1. Copy `.env.example` to `.env.production.local` and set the publishable key
   of the project that allows your Pages origin.
2. Log in once with `pnpm exec wrangler login`.
3. Run `pnpm run deploy`. It builds `dist/` and uploads it to the Pages project
   `seams-voice-intents` (`wrangler.toml`). Wrangler asks to create the project if it
   does not exist.

If you use another project name, change `name` in `wrangler.toml`, and add the
new origin to the Seams project.

## Settings

| Variable                            | Default                               | Meaning                                                 |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `VITE_SEAMS_PUBLISHABLE_KEY`        | none, required                        | The publishable key of your Seams project environment.  |
| `VITE_SEAMS_PROJECT_ENVIRONMENT_ID` | empty                                 | Optional cross-check of the key's environment.          |
| `VITE_SEAMS_WALLET_ORIGIN`          | `https://staging.sign.seams.sh`       | The hosted Seams Wallet.                                |
| `VITE_SEAMS_RELAYER_URL`            | `https://staging.api.wallet.seams.sh` | The Seams Gateway, which also serves the verify route.  |
| `VITE_SEAMS_RP_ID`                  | `staging.sign.seams.sh`               | The passkey RP ID: the Wallet host or a parent domain.  |
| `VITE_SEAMS_SIGNING_WORKER_ID`      | `router-ab-signing-worker-staging`    | The Router A/B signing worker that registration needs.  |
| `VITE_NEAR_RPC_URL`                 | `https://test.rpc.fastnear.com`       | NEAR testnet RPC for the balance check.                 |

Only the Seams staging deployment serves the Speak-to-Sign verify route.

`seamsTestnetConfig` keeps the SDK's default passkey RP ID, `example.localhost`,
and the default turns Router A/B normal signing off. Then "Create wallet with
passkey" fails with "Something went wrong.". So `src/config.ts` sets both, as the
staging console does.

## How the code works

| File                     | What it does                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `src/config.ts`          | `seamsTestnetConfig` with the VoiceID auth method and the `speakToSign` feature.    |
| `src/main.tsx`           | The page and `SeamsWebProvider`.                                                    |
| `src/PaymentFlow.tsx`    | Sign-in (`HostedSeamsAuthMenu`), VoiceID, enrollment, balance and the spoken payment. |
| `src/chain.ts`           | The balance read from NEAR RPC and the amount check.                                |
| `src/text.ts`            | The text for each refusal and unavailable reason.                                   |

The two calls that matter:

```ts
await seams.speakToSign.enroll({ walletId });
await seams.speakToSign.requestTransfer({ walletId, receiver: 'seams-v1.testnet', amount: '1' });
```

`requestTransfer` returns `sent`, `refused`, `cancelled` or `unavailable`.
A `sent` result has the transaction hash and the times of each stage.

## Versions

Keep `@seams/wallet`, `@seams/voiceid` and `@seams/speak-to-sign` at one
version, and at the version that the Wallet origin runs. The Wallet refuses an
app whose Wallet protocol is too old, and the page then asks you to upgrade.

## What to know

- A payment above 10 NEAR asks you to confirm again. This is a stub rule of
  the verifier.
- Your audio leaves the browser. It goes to the Seams Gateway, the verifier on
  OutLayer, the speaker service on Phala and NEAR AI. Your voice template stays
  in the verifier's storage.
- The verifier accepts a receiver name that sounds alike, and an account name
  said without "dash", "dot" or "testnet" ("seams v one"). Read the account on
  the screen before you speak.
