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

```bash
./build.sh
```

`./build.sh` writes `res/speak_to_sign_faucet.wasm` (156,586 bytes, SHA-256
`c963c346736b5c67fa0f611c5042170d82f7779faabdfecedba3b79dda1bc619`).

## Testnet

| Item | Value |
| ---- | ----- |
| Account | `seams-faucet.testnet`, made by the NEAR testnet faucet service with 10 NEAR, transaction `ETpvp7TtdGZ8MzTZ1V4Wp3GgUc8gYNbvvhjyY4i4FwgU`. Its full-access key is in the local legacy keychain (`~/.near-credentials/testnet/`). |
| Deploy and `new` | transaction `3WSFKnoEs8YtKr9bbjqBwSbd6zLx7im3cnkwFAyzg72A`: owner `seams-faucet.testnet`, token testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, 0.2 NEAR and 2 USDC for each account |
| USDC registration of the faucet | transaction `3ZrCs6REMC9RhzAGig1doCoyhtoEZBXqKjkadXTgAvk7` |
| `drip` key | `ed25519:2WVRyde9Adz9f28ZjA4KzfdSk166Hz4e4r3oAii7GHqM`, function-call access to `drip` on `seams-faucet.testnet`, allowance 1 NEAR, transaction `Bx4eZEE9EcsreukRcz1GP2nqchMFVW9s11jp8w8HZ9Bp`. The secret is in `demo/frontend/.dev.vars` (not in git). |
| Empty-faucet test | transaction `FdrcGFHZv9zV24AiwgHV69ZV38hTZDop4ECHtos5X6ms`: the USDC receipt failed as one unit ("not enough balance"), `on_drip` returned `false`, no NEAR left the faucet, and the account could try again. |

About 8.38 NEAR is free after the contract's storage: about 40 drips at
0.2 NEAR. The faucet needs USDC from its owner: 2 USDC for each account (for
example 40 USDC for 20 accounts), sent to `seams-faucet.testnet`.

To top up NEAR or change the amounts:

```bash
near contract call-function as-transaction seams-faucet.testnet set_amounts json-args '{"near_amount":"200000000000000000000000","token_amount":"2000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as seams-faucet.testnet network-config testnet sign-with-legacy-keychain send
```
