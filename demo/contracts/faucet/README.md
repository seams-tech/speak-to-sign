# Speak-to-Sign testnet faucet

A small NEAR contract for the demo's setup card. One `drip` call is one
transaction for a new account:

1. The faucet registers the account with testnet USDC (`storage_deposit`,
   0.00125 NEAR) and sends it USDC (`ft_transfer`). Both are actions of one
   receipt, so both happen or neither does.
2. The callback `on_drip` checks that receipt. If it failed (for example, the
   faucet has no USDC left), the account is free to try again and gets no NEAR.
   Otherwise the faucet sends it NEAR for gas.

Each account gets the faucet once; the contract keeps the list
(`has_claimed`). Only the owner calls `drip` and `set_amounts`. On testnet the
owner is the faucet account itself, and the demo's Pages Function
(`demo/frontend/functions/api/faucet.ts`) holds a function-call key that can
call `drip` and nothing else.

| Method | Who | What |
| ------ | --- | ---- |
| `new({ owner, token, near_amount, token_amount })` | init | yoctoNEAR and token base units for each account |
| `drip({ account_id })` | owner | USDC, then NEAR, once for each account |
| `set_amounts({ near_amount, token_amount })` | owner | the amounts for the next drips |
| `has_claimed({ account_id })` | view | |
| `get_config()` | view | owner, token, amounts, `drips` done, `free_near` left |

## Build and test

```bash
cargo test
```

### Reproducible build

This build gives the WASM to deploy. It gives the same bytes on any computer
(see [`../README.md`](../README.md#reproducible-build)). It needs Docker,
git and cargo-near 0.22.0.

```bash
../reproducible.sh build faucet   # writes res/speak_to_sign_faucet.wasm and reproducible.sha256
../reproducible.sh check faucet   # builds the recorded commit again and compares
```

The build of 11 Nov 2026 gave:

| Item               | Value |
| ------------------ | ----- |
| Commit             | `777b84429096604e77e217480e9f89a398f5da13` |
| Size               | 130,317 bytes |
| SHA-256            | `538b75805d96ab6487489574e1d2b901af7052a9764ecfe44cbcfe5ee0fc78b3` |
| Code hash (base58) | `6d8BGwTR88jjFFaYEfhnTnLaQet2FmRE3d5DvYxefR2z` |

`reproducible.sha256` holds the same commit and SHA-256.

The deployed code (`c963c346…c619`) is not this build. It came from the local
build below.

### Local build

```bash
./build.sh
```

`./build.sh` writes `res/speak_to_sign_faucet.wasm` with the local toolchain
(156,586 bytes, SHA-256
`c963c346736b5c67fa0f611c5042170d82f7779faabdfecedba3b79dda1bc619`). Its
bytes depend on the computer, because the WASM holds the local source paths
of panic locations.

## Testnet

| Item | Value |
| ---- | ----- |
| Account | `seams-faucet.testnet`, made by the NEAR testnet faucet service with 10 NEAR, transaction `ETpvp7TtdGZ8MzTZ1V4Wp3GgUc8gYNbvvhjyY4i4FwgU`. Its full-access key is in the local legacy keychain (`~/.near-credentials/testnet/`). |
| Deploy and `new` | transaction `3WSFKnoEs8YtKr9bbjqBwSbd6zLx7im3cnkwFAyzg72A`: owner `seams-faucet.testnet`, token testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, 0.2 NEAR and 2 USDC for each account |
| USDC registration of the faucet | transaction `3ZrCs6REMC9RhzAGig1doCoyhtoEZBXqKjkadXTgAvk7` |
| `drip` key | `ed25519:2WVRyde9Adz9f28ZjA4KzfdSk166Hz4e4r3oAii7GHqM`, function-call access to `drip` on `seams-faucet.testnet`, allowance 1 NEAR, transaction `Bx4eZEE9EcsreukRcz1GP2nqchMFVW9s11jp8w8HZ9Bp`. The secret is in `demo/frontend/.dev.vars` (not in git). |
| Empty-faucet test | transaction `FdrcGFHZv9zV24AiwgHV69ZV38hTZDop4ECHtos5X6ms`: the USDC receipt failed as one unit ("not enough balance"), `on_drip` returned `false`, no NEAR left the faucet, and the account could try again. |
| Funding | 500 USDC from the project owner (10 Nov 2026). |
| First real drip | transaction `tNMCqaLzpsMmFbpAf362Dg34G4sWuybYkt7XpbUVTWp`, through the page's `/api/faucet`, to a new account `seams-faucet-check.testnet`: it was registered with USDC and got 2 USDC and 0.2 NEAR (10.0 → 10.2); the faucet went from 500 to 498 USDC; a second claim answered "This account already got testnet NEAR and USDC from the faucet." |

About 8.38 NEAR was free after the contract's storage: about 40 drips at
0.2 NEAR. Then NEAR runs out before USDC does (500 USDC is 250 drips): top up
the account's NEAR to serve more accounts.

To top up NEAR or change the amounts:

```bash
near contract call-function as-transaction seams-faucet.testnet set_amounts json-args '{"near_amount":"200000000000000000000000","token_amount":"2000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as seams-faucet.testnet network-config testnet sign-with-legacy-keychain send
```
