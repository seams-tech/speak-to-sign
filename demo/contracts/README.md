# Demo contracts

| Folder                                             | Contract                                            | Testnet account               |
| -------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| [`community-notes/`](community-notes/)             | community notes and ratings, with 0 deposit         | `notes.seams-v1.testnet`      |
| [`voice-multisig/`](voice-multisig/)               | a NEAR transfer that a voice verdict proposes      | `multisig.seams-v1.testnet`   |
| [`jev-prediction-market/`](jev-prediction-market/) | a market on a note, resolved by an OutLayer AI call | `pm-notes.seams-v1.testnet`   |
| [`faucet/`](faucet/)                               | testnet USDC and NEAR for a new account, once       | `seams-faucet.testnet`        |

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
