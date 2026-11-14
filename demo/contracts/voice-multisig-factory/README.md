# Voice multisig factory

The factory creates a voice multisig (`../voice-multisig/`) for a visitor of
the demo page `/multisig/`. The demo multisig has two fixed signers, so a
visitor cannot propose or approve there. With the factory, a visitor creates
a 2 of 2 multisig with one other person, and both try it by voice. Testnet
only.

The factory is not on testnet yet. "Deploy to testnet" gives the steps.

## Design

- **Global code.** The voice-multisig WASM is on chain one time, as global
  code under its code hash (NEP-591). Each multisig account uses that code
  and holds no code of its own. A normal deploy of the 214 KB code costs
  about 2.15 NEAR of storage for each account. An account that uses the
  global code needs 271 bytes after `new`, about 0.003 NEAR.
- **One receipt.** `create` makes the account `m<N>.<factory>` with four
  actions in one receipt: create the account, send it the attached NEAR, use
  the global code, and call `new` with the signers, the threshold and the
  verifier key. All four happen or none does. So no account can call `new`
  with other signers between the deploy and the init.
- **No key, no code change.** The new account has no access key, and it uses
  the global code by its hash. So no key can deploy other code to it, and
  the code under a hash cannot change. The signers and the threshold are
  fixed at `new`, as for each voice multisig.
- **The names.** The factory counts the names that it gave. A name is not
  used again, also after a creation that failed. Only the factory account
  can create its subaccounts, so each account `m<N>.<factory>` is a multisig
  of the factory. The demo page uses this rule: it shows the demo multisig
  or an account `m<N>.<factory>`, and no other contract.
- **The NEAR.** The factory sends all of the attached NEAR to the new
  multisig, and keeps none. The least amount is 0.05 NEAR. If the creation
  fails (for example, `new` refuses the signers), no account exists, and the
  factory sends the NEAR back to the caller.
- **The caller is a signer.** `create` refuses a caller who is not one of
  the signers.
- **No list.** The factory keeps no list of the multisigs. Each `created`
  event names one. So the storage of the factory does not grow.

The full-access key of the factory account can deploy other factory code.
That does not change a multisig that exists: it has no key, and its code is
the global code.

## Interface

The caller is `predecessor_account_id`.

| Method       | Kind             | Arguments | Returns |
| ------------ | ---------------- | --------- | ------- |
| `new`        | init, private    | `{"code_hash": "<base58 of 32 bytes>", "verifier_public_key": "ed25519:<base58>"}` | — |
| `create`     | change, payable  | `{"signers": AccountId[], "threshold": u32}` | the account of the multisig, or `null` if the creation failed |
| `on_create`  | callback         | private | the account, or `null` |
| `get_config` | view             | `{}` | `{"code_hash", "verifier_public_key", "names"}` |

Rules:

- `new`: only the factory account can call it. `code_hash` is the code hash
  of the global voice-multisig code: the SHA-256 of the WASM, in base58. No
  method changes it later.
- `create`: the attached NEAR is at least 0.05 NEAR. The caller is one of
  `signers`. The multisig's own `new` checks the signers and the threshold
  (1 to 10 distinct signers, a threshold from 1 to their number). Attach 100
  Tgas: the factory gives 10 Tgas to `new` and 10 Tgas to its callback.

## Events

Each creation logs one NEP-297 event, standard `voice_multisig_factory`,
version `1.0.0`:

```text
EVENT_JSON:{"standard":"voice_multisig_factory","version":"1.0.0","event":"created","data":[{"account":"m1.voice-multisig-factory.seams-v1.testnet","creator":"alice.testnet","signers":["alice.testnet","bob.testnet"],"threshold":2}]}
EVENT_JSON:{"standard":"voice_multisig_factory","version":"1.0.0","event":"create_failed","data":[{"account":"m2.voice-multisig-factory.seams-v1.testnet","creator":"alice.testnet"}]}
```

## Failure messages

| Message | Method |
| ------- | ------ |
| `code_hash must be base58 of 32 bytes` | `new` |
| `Method new is private` | `new` |
| `The contract has already been initialized` | `new` |
| `attach at least 0.05 NEAR: it pays for the storage of the multisig` | `create` |
| `the caller must be one of the signers` | `create` |
| `the factory account is too long for a subaccount` | `create` |
| `Method on_create is private` | `on_create` |

A creation that fails in the new account (for example, `new` refuses a
threshold of 3 for 2 signers) is not a failed transaction: `create` returns
`null` and logs `create_failed`.

## Gas and cost

Measured in the nearcore 2.14.0 sandbox
(`../voice-multisig/sandbox/tests/sandbox.rs`).

| Item | Value |
| ---- | ----- |
| `new` of the factory | 1.57 Tgas |
| `create`, with the multisig's `new` and the callback | 13.9 Tgas |
| Storage of a new multisig | 271 bytes |
| Global deploy of the multisig code | 0.0001 NEAR for each byte, burnt one time: 10 times the storage price |

The global deploy of the local build (258,967 bytes) burnt 25.92 NEAR in the
sandbox. The reproducible build is smaller.

## Build and test

```bash
./build.sh                                  # the fast local build, for the sandbox test
../reproducible.sh build voice-multisig-factory   # the WASM to deploy
cargo test
```

The 9 unit tests cover each rule of `new`, `create` and `on_create`: the
four actions of the creation in one receipt, the next name, the least
deposit, a caller who is not a signer, the `created` event, and the NEAR
that goes back after a failure.

The sandbox test is in the multisig's sandbox crate, because it needs both
WASM files:

```bash
./build.sh && (cd ../voice-multisig && ./build.sh && ../community-notes/build.sh && cargo test -p voice-multisig-sandbox -- --nocapture)
```

The test `the_factory_creates_a_multisig_in_the_sandbox` publishes the
multisig WASM as global code, and the factory creates a 2 of 2 multisig. It
checks that the multisig uses the global code hash, holds all of the
attached NEAR, has no access key and refuses a second `new`. A full proposal
then runs on the multisig: two voice verdicts and an `execute` that sends
0.1 NEAR. The test also checks the failures on the real runtime: a caller
who is not a signer, a small deposit, and a creation that `new` refuses,
after which the caller has the NEAR back and the next multisig gets the next
name.

## Deploy to testnet

Each step waits for the owner's go-ahead.

1. Make the reproducible builds of the multisig and of the factory from a
   commit on `dev` (cargo-near 0.22.0, Docker), commit both
   `reproducible.sha256` files, and push `dev`:

   ```bash
   ../reproducible.sh build voice-multisig voice-multisig-factory
   ```

2. Publish the multisig WASM as global code under its hash. Any account can
   sign this transaction. The chain burns 0.0001 NEAR for each byte of the
   WASM, about 21.5 NEAR:

   ```bash
   near contract deploy-as-global use-file ../voice-multisig/res/voice_multisig.wasm as-global-hash seams-faucet.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. Create the factory account. 3 NEAR covers the factory code (about 1.6
   NEAR):

   ```bash
   near account create-account fund-myself voice-multisig-factory.seams-v1.testnet '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

4. Deploy the factory with the code hash of step 2 (the SHA-256 of the
   multisig WASM, in base58) and the verifier key:

   ```bash
   near contract deploy voice-multisig-factory.seams-v1.testnet use-file res/voice_multisig_factory.wasm with-init-call new json-args '{"code_hash":"<code hash>","verifier_public_key":"ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

5. Read the config:

   ```bash
   near contract call-function as-read-only voice-multisig-factory.seams-v1.testnet get_config json-args '{}' network-config testnet now
   ```

The demo page reads `get_config` of the factory account
(`VITE_MULTISIG_FACTORY`). It shows the "Create your own multisig" form only
when that call answers.
