# Speak to pay

An example web page for Seams Speak-to-Sign. Pay a named NEAR testnet account
with your voice. You read one sentence, for example "Send 1 NEAR to
seams-v1.testnet." An attested verifier checks your voice and your words. Then
your Seams Wallet pays from your own account, with no confirm. Testnet only. Do
not use real funds.

The page has four steps:

0. Sign in to your Seams Wallet with a passkey, or create a wallet.
1. Set up your voice: read three short phrases and confirm one signed message. The same
   recordings turn on VoiceID on this device and enroll your voice with the verifier.
2. Check that your NEAR account has testnet NEAR.
3. Type an amount and a receiver, then click **Pay by voice** and read the sentence.

## 1. Set up a Seams project

The Seams Wallet accepts sign-in only from the origins of your project.

1. In the Seams Console of the staging deployment, create a project with a
   NEAR testnet environment.
2. Add the origins of this page to the environment:
   - `http://localhost:5280` for `pnpm dev`.
   - Your Cloudflare Pages origin, for example `https://speak-to-sign.pages.dev`,
     and your custom domain if you add one.
3. Copy the publishable key of the environment. A publishable key is public,
   but it works only from the origins of step 2.

A wallet belongs to one project. If you used Speak-to-Sign in another project,
create a new wallet here and enroll your voice again.

## 2. Run it locally

You need Node 22 or later and pnpm 10.

```bash
cd demo/speak-to-pay
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
3. Change `name` in `wrangler.toml` to your own Pages project, and add its
   origin to the Seams project. The name in this repository,
   `speak-to-sign`, is the live demo site. A deploy from here to that project
   would replace the whole site with this page.
4. Run `pnpm run deploy`. It builds `dist/` and uploads it to the Pages project
   of `wrangler.toml`. Wrangler asks to create the project if it does not
   exist.

## Settings

| Variable                            | Default                               | Meaning                                                 |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `VITE_SEAMS_PUBLISHABLE_KEY`        | none, required                        | The publishable key of your Seams project environment.  |
| `VITE_SEAMS_PROJECT_ENVIRONMENT_ID` | empty                                 | Optional cross-check of the key's environment.          |
| `VITE_SEAMS_WALLET_ORIGIN`          | `https://staging.sign.seams.sh`       | The hosted Seams Wallet.                                |
| `VITE_SEAMS_RELAYER_URL`            | `https://staging.api.wallet.seams.sh` | The Seams Gateway, which also serves the verify route.  |
| `VITE_NEAR_RPC_URL`                 | `https://test.rpc.fastnear.com`       | NEAR testnet RPC for the balance check.                 |

Only the Seams staging deployment serves the Speak-to-Sign verify route.

SDK 0.60.0 derives the passkey RP ID and the Router A/B signing worker from the
Wallet origin, so `src/config.ts` sets neither.

## How the code works

| File                     | What it does                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `src/config.ts`          | `seamsTestnetConfig` with the VoiceID auth method and `spoken` in `approvals`.      |
| `src/main.tsx`           | The page and `SeamsWebProvider`.                                                    |
| `src/PaymentFlow.tsx`    | Sign-in (`HostedSeamsAuthMenu`), VoiceID, enrollment, balance and the spoken payment. |
| `src/results.tsx`        | The result of an enrollment and of a spoken payment.                                |
| `src/hooks.ts`           | The Wallet connection, a reloadable load, and one owner action at a time.           |
| `src/components.tsx`     | The step card, the notices, the buttons and the facts.                              |
| `src/chain.ts`           | The balance read from NEAR RPC and the amount check.                                |
| `src/text.ts`            | The text for each refusal and unavailable reason.                                   |

The two calls that matter:

```ts
await seams.near.spoken.enroll({ walletSession });
await seams.near.spoken.transfer({ walletSession, receiver: 'seams-v1.testnet', amount: '1' });
```

`transfer` returns `approved`, `refused`, `cancelled` or `unavailable`.
An `approved` result has the transaction hash and the times of each stage.
`seams.near.spoken` exists when the configuration has
`approvals: [spoken({ network: 'testnet' })]`.

## Versions

Keep `@seams/wallet` and `@seams/voiceid` at one version, and at the version
that the Wallet origin runs (0.70.6 here). Speak-to-Sign is a part of
`@seams/wallet`: it has no package of its own. The Wallet refuses an app whose
Wallet protocol is another one, and the page then asks you to upgrade.

## What to know

- A payment above 10 NEAR asks you to confirm again. This is a stub rule of
  the verifier.
- Your audio leaves the browser. It goes to the Seams Gateway, the verifier on
  OutLayer, the speaker service on Phala and NEAR AI. Your voice template stays
  in the verifier's storage.
- The verifier accepts a receiver name that sounds alike, and an account name
  said without "dash", "dot" or "testnet" ("seams v one"). Read the account on
  the screen before you speak.
