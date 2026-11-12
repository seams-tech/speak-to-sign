# Demo contracts

| Folder | Contract | Testnet account |
| ------ | -------- | --------------- |
| [`community-notes/`](community-notes/) | community notes and ratings, with 0 deposit | [`notes.seams-v1.testnet`](https://testnet.nearblocks.io/address/notes.seams-v1.testnet/contract) |
| [`voice-multisig/`](voice-multisig/) | a NEAR transfer or the hide of a note, proposed and approved by voice (version 3.0.0, 2 of 2 signers); the older account `multisig.seams-v1.testnet` (2.x, admins approved by key) was deleted on 2026-11-12 | [`voice-multisig.seams-v1.testnet`](https://testnet.nearblocks.io/address/voice-multisig.seams-v1.testnet/contract) |
| [`jev-prediction-market/`](jev-prediction-market/) | a market on a note, resolved by an OutLayer AI call | [`pm-notes.seams-v1.testnet`](https://testnet.nearblocks.io/address/pm-notes.seams-v1.testnet/contract) |
| [`faucet/`](faucet/) | testnet USDC and NEAR for a new account, once | [`seams-faucet.testnet`](https://testnet.nearblocks.io/address/seams-faucet.testnet/contract) |

## Reproducible build

`./reproducible.sh` builds each contract byte for byte the same on any
computer. It uses NEAR's standard build, `cargo near build reproducible-wasm`
(NEP-330). It needs Docker, git and cargo-near 0.22.0.

```bash
./reproducible.sh build community-notes   # build the committed HEAD
./reproducible.sh check community-notes   # build the recorded commit again and compare
```

With no contract name, the script does all four. On a Mac with Apple silicon,
Docker runs the x86_64 image under emulation, and one contract takes 1 to
2.5 minutes. To install cargo-near, see
<https://github.com/near/cargo-near#installation>.

`build` writes two files:

- `<contract>/res/<name>.wasm`, the WASM to deploy.
- `<contract>/reproducible.sha256`, the commit of the build and the SHA-256 of
  the WASM. Commit this file after the build.

`check` reads `reproducible.sha256`, builds that commit again in a fresh
clone, and compares the SHA-256. It fails if the bytes are different. If the
contract source changed after the recorded commit, it prints a note. CI runs
the check for each contract on each push (`.github/workflows/test.yml`).

These things make the bytes the same:

- `[package.metadata.near.reproducible_build]` in each `Cargo.toml` pins the
  Docker image `sourcescan/cargo-near:0.22.0-rust-1.97.0` by its digest. The
  image holds Rust 1.97.0, cargo-near 0.22.0 and `wasm-opt`.
- `Cargo.lock` pins the crates. The build uses `--locked`.
- The build uses a fresh clone of the commit. Files that are not committed do
  not change it. In the container, the clone is always at `/home/near/code`,
  so the folder of the clone and the home folder do not change the bytes.

The build writes the image, the build command, the contract folder and the
commit into the contract metadata. A deployed contract returns it from the
view method `contract_source_metadata`. So NearBlocks (SourceScan) can build
the same commit again and compare the code hash.

The commit is part of the WASM. Two commits give two hashes, also when the
contract source is the same. So the record names its commit. A deploy must
use the WASM of a recorded commit, and that commit must stay in the history
of the repository: merge a branch with a merge commit, not with a squash or a
rebase.

### The deployed code

From 2026-11-11, the four older testnet contracts ran the builds of commit
`777b844`, with no init call (the state stayed). One of them,
`multisig.seams-v1.testnet`, was deleted on 2026-11-12; the other three
still run these builds. SourceScan built each one
again and got the same code hash, so NearBlocks shows each one as verified on
its contract page. Since 2026-11-12, the new account
`voice-multisig.seams-v1.testnet` runs the build of commit `99231f6`
(version 3.0.0). SourceScan verified it in the same way.

| Contract                    | Code hash (base58)                             | Redeploy transaction                           |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `notes.seams-v1.testnet`    | `mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko` | `9d5SW81rQ2BQXrvqA5z78gYYxdEhP8JVVj4pu3tFFAEW` |
| `multisig.seams-v1.testnet` (deleted on 2026-11-12) | `B38YGRGymzWML2WoNz2TLqLe5z1vmKc1wjcHYRCEUahh` | `Exeu3mx8x1VZdheteCWAVvduEZo3H6FSeNLqsfusDD7t` |
| `voice-multisig.seams-v1.testnet` (commit `99231f6`, 2026-11-12, deploy with `new`) | `CkYrt1XM3NDsdd7B8PVx2eyUh36nM3nQtmvbta8eQTnA` | `FUAfW1AeZMMarjVThdDtmdXAhPw1ghZt2U6FSMF83rxs` |
| `pm-notes.seams-v1.testnet` | `7qA3mFHgGa31dsUJ3BjdCuh8yHS8jnnS79aMNPmSnQ9Z` | `88qJEJPcSpay99MSV4ZVecp88XasDfD3zSv27Cgk6Zx6` |
| `seams-faucet.testnet`      | `6d8BGwTR88jjFFaYEfhnTnLaQet2FmRE3d5DvYxefR2z` | `7uczvTN3tAhD4sw3G7VwFWL1xJXH1gkaLMjXjyrwVq4k` |

After a new deploy, ask SourceScan to verify the contract. The "Verify" page
of NearBlocks sends the same request. It takes 1 to 2 minutes:

```bash
curl -s -X POST https://api-v2.sourcescan.dev/api/verify/rust -H 'Content-Type: application/json' -d '{"accountId":"notes.seams-v1.testnet","networkId":"testnet"}'
```

It answers `{"message":"Contract verified successfully","checksum":"<code hash>"}`.
If SourceScan already verified the deployed code, it answers
`{"message":"Code hash didn't change"}`. Send one request at a time. Two requests at the same time can fail with a
nonce error of the SourceScan signer.

`./build.sh` in each contract folder is a fast local build for the sandbox
tests. It does not use Docker, and its bytes depend on the computer. Do not
deploy its WASM.

## Tests

CI (`.github/workflows/test.yml`) runs each of these on each push and pull
request.

| Test               | Command (in the contract folder)                |
| ------------------ | ----------------------------------------------- |
| Unit tests         | `cargo test -p <package>`                       |
| Sandbox tests      | `./build.sh && cargo test -p <package>-sandbox` |
| Reproducible build | `../reproducible.sh check <contract>`           |
