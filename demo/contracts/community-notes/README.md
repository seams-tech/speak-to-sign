# Community notes contract

A NEAR contract for the Speak-to-Sign hackathon demo. An author adds a note to
a post. Other accounts rate the note. The Seams Wallet signs both calls from
the user's own account with 0 deposit and 30 Tgas, so the contract pays for
its storage from its own balance. Testnet only.

One moderator account, the voice multisig (`../voice-multisig/`), can hide a
harmful note. The contract then removes the note's text and summary, and the
note takes no more ratings.

The method names and JSON shapes are fixed. Seams Wallet core and the demo
page in `demo/frontend/` use them.

## Toolchain

| Item           | Version                                                    |
| -------------- | ---------------------------------------------------------- |
| Rust           | 1.97.0 (`rust-toolchain.toml`), target `wasm32-unknown-unknown` |
| near-sdk       | 5.30.1 (needs Rust 1.95 or later)                          |
| near-workspaces | 0.24.0, with the nearcore 2.14.0 sandbox (sandbox test only) |
| near CLI       | near-cli-rs 0.23.2 (deploy only)                           |
| Testnet        | protocol 88, nearcore 2.14.0 (checked on 9 Nov 2026)       |

`.cargo/config.toml` adds `--cfg near` to each WASM build. near-sdk 5.30 calls
the NEAR host functions (for example `panic_utf8`) only when this flag is set.
Without it, a failed call loses its message and traps with `unreachable`.
cargo-near 0.21 and later adds the flag itself; a plain `cargo build` does not.

## Interface

Ids are JSON numbers (u64). The author or rater is `predecessor_account_id`.
The change methods do not accept a deposit: a call with a deposit fails.

| Method       | Kind   | Arguments                                                   | Returns            |
| ------------ | ------ | ----------------------------------------------------------- | ------------------ |
| `add_note`   | change | `{"post_id": u64, "text": String, "summary": String}`        | `u64`, the note id |
| `rate_note`  | change | `{"note_id": u64, "rating": "helpful" \| "somewhat_helpful" \| "not_helpful"}` | nothing |
| `get_notes`  | view   | `{"post_id": u64}`                                           | `NoteView[]`, newest first, at most 50 |
| `get_note`   | view   | `{"note_id": u64}`                                           | `NoteView` or `null` |
| `get_rating` | view   | `{"note_id": u64, "account_id": AccountId}`                  | a rating or `null` |
| `hide_note`  | change | `{"note_id": u64, "proposal_id"?: u64}`                      | nothing |
| `set_moderator` | change, private | `{"account_id": AccountId}`                       | nothing |
| `get_moderator` | view | `{}`                                                        | `AccountId` or `null` |

Rules:

- `add_note`: note ids start at 1 and increase by 1 for each note, on all posts.
- `text` has 1 to 280 characters and `summary` has 1 to 120 characters. A character is one Unicode scalar value, not one byte.
- An empty value, or a value of only white space, fails.
- `rate_note`: each account has one rating for each note. A later call replaces the earlier rating.
- The author cannot rate their own note. An unknown note id fails.
- The views do not fail for an unknown id. They return `[]` or `null`.
- `set_moderator`: only the contract account can call it. A later call
  replaces the moderator. Until the first call, no account can hide a note.
- `hide_note`: only the moderator can call it. It empties `text` and
  `summary`, and `hidden` becomes `true`. The id, post, author, time and
  counts stay. A hidden note cannot be hidden again or rated. The original
  text stays in the `add_note` transaction on chain. `proposal_id` is the
  multisig proposal that decided it; it goes only into the event.
- The moderator is kept outside the contract state (its own storage key), so
  an upgrade of a deployed contract needs no state migration.

`NoteView`:

```json
{
  "id": 1,
  "post_id": 42,
  "author": "alice.testnet",
  "text": "The photo is from 2019, not from this week.",
  "summary": "Photo is from 2019",
  "created_at_ms": 1762700000000,
  "helpful": 2,
  "somewhat_helpful": 1,
  "not_helpful": 0,
  "status": "helpful",
  "hidden": false
}
```

`status` comes from the counts. `somewhat_helpful` has no effect on it.

| `status`             | Condition                                      |
| -------------------- | ---------------------------------------------- |
| `helpful`            | helpful >= 2 and helpful > not_helpful         |
| `not_helpful`        | not_helpful >= 2 and not_helpful > helpful     |
| `needs_more_ratings` | all other counts                               |

### Events

Each change call logs one NEP-297 event. `data` is an array with one object.

```text
EVENT_JSON:{"standard":"community_notes","version":"1.1.0","event":"note_added","data":[{"note_id":1,"post_id":42,"author":"alice.testnet"}]}
EVENT_JSON:{"standard":"community_notes","version":"1.1.0","event":"note_rated","data":[{"note_id":1,"account_id":"bob.testnet","rating":"helpful","previous_rating":null,"status":"needs_more_ratings"}]}
EVENT_JSON:{"standard":"community_notes","version":"1.1.0","event":"note_hidden","data":[{"note_id":7,"post_id":900,"moderator":"multisig.seams-v1.testnet","proposal_id":3}]}
```

Version 1.1.0 adds `note_hidden`. Version 1.0.0 had the first two events
with the same data. `note_hidden` has no `proposal_id` when the call gave
none.

`previous_rating` is the rating that the call replaced, or `null`. `status`
is the status of the note after the call.

### Failure messages

| Call        | Message                                              |
| ----------- | ---------------------------------------------------- |
| `add_note`  | `text must not be empty`, `summary must not be empty` |
| `add_note`  | `text has 281 characters; the maximum is 280`        |
| `add_note`  | `summary has 121 characters; the maximum is 120`     |
| `rate_note` | `the author cannot rate their own note`              |
| `rate_note` | `note 99 does not exist`                             |
| `rate_note` | an unknown rating fails in argument parsing (`unknown variant`) |
| `rate_note` | `this note is hidden`                                |
| `hide_note` | `only the moderator can hide a note`                 |
| `hide_note` | `this note is already hidden`, `note 99 does not exist` |
| `set_moderator` | `Method set_moderator is private`                |
| both        | a deposit fails (`Method add_note doesn't accept deposit`, and the same for `rate_note`) |

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`):

| Call                                          | Gas burnt  |
| --------------------------------------------- | ---------- |
| `add_note`, largest note (400 characters of 4 bytes) | 2.26 Tgas |
| `add_note`, short note                        | 2.15 Tgas  |
| `rate_note`, first rating or a replacement    | 2.04 to 2.22 Tgas |

The Wallet attaches 30 Tgas. Each call uses less than 10 Tgas.

| Item            | Storage        | Cost at 10^19 yoctoNEAR a byte |
| --------------- | -------------- | ------------------------------ |
| Contract code   | 169,267 bytes  | 1.69 NEAR                      |
| Largest note    | 1,919 bytes    | 0.019 NEAR                     |
| One rating      | 97 bytes       | 0.001 NEAR                     |

The contract balance pays for all storage. If the balance is too low, a
change call fails with `LackBalanceForState` and the state does not change.
To continue, send more NEAR to the contract account.

`get_notes` with 50 of the largest notes returns 90,443 bytes of JSON. The
sandbox test checks that this view runs within the view gas limit.

## Build

### Reproducible build

This build gives the WASM to deploy. It gives the same bytes on any computer
(see [`../README.md`](../README.md#reproducible-build)). It needs Docker,
git and cargo-near 0.22.0.

```bash
../reproducible.sh build community-notes   # writes res/community_notes.wasm and reproducible.sha256
../reproducible.sh check community-notes   # builds the recorded commit again and compares
```

The build of 11 Nov 2026 gave:

| Item               | Value |
| ------------------ | ----- |
| Commit             | `777b84429096604e77e217480e9f89a398f5da13` |
| Size               | 146,408 bytes |
| SHA-256            | `0b821a5c459d31b7aed4b6459b3aa572189c927411878665d8eae633d51f7f80` |
| Code hash (base58) | `mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko` |

`reproducible.sha256` holds the same commit and SHA-256.

The deployed code is this build, since the redeploy of 2026-11-11 (see
"Testnet deployment"). SourceScan built the commit again and got the same
code hash, so NearBlocks shows the code as verified: the "Contract" tab of
<https://testnet.nearblocks.io/address/notes.seams-v1.testnet>.

### Local build

```bash
./build.sh
```

The script builds `res/community_notes.wasm` with the local toolchain, and
prints its size and SHA-256. It is fast, and the sandbox tests use it. Its
bytes depend on the computer, because the WASM holds the local source paths
of panic locations. The build of 9 Nov 2026 gave:

| Item    | Value                                                              |
| ------- | ------------------------------------------------------------------ |
| Size    | 169,267 bytes                                                      |
| SHA-256 | `472d1eaa420b22d71439bf2db341a45d59ba9aa63b094e758e9a3af3a561a253` |

## Test

Unit tests, for every rule above:

```bash
cargo test -p community-notes
```

Sandbox tests. They deploy `res/community_notes.wasm` to a local nearcore
sandbox and call it as the Wallet does (30 Tgas, 0 deposit). The first run
downloads the sandbox binary.

```bash
./build.sh && cargo test -p community-notes-sandbox -- --nocapture
```

## Testnet deployment

Deployed on 9 Nov 2026 from commit `7f0e014`.

| Item                | Value                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Contract account    | `notes.seams-v1.testnet` (created by `seams-v1.testnet` with 5 NEAR)   |
| Code hash (base58)  | `mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko` since the redeploy of 2026-11-11, the reproducible build of commit `777b844` (see "Reproducible build"). Earlier code: `GUxwJuESkn4FAZcW5oacs15zPzBfh1qSPHpVauyqkewP` (the upgrade of 2026-11-11), and first `5nqrLnLpoZrtxbMQQKFB9CoowyEXJ9notqsHe51dBjPY`, the local build of 9 Nov 2026 (see "Local build") |
| Create account      | transaction `GxZNoaKqZnoR9kmoFK2PVJqYqDaPUDBrScd1Eks7h9fa`             |
| Deploy              | transaction `7eVv1CLTX5MTaanpJvJVHj2PXNv23aztqQHqmJyCc5a4`             |
| Smoke test          | `add_note` from `seams-v1.testnet`, transaction `4QQh3AXaz64BhGqhCjd72qGYt2iFuNB8LGfn4HtdQowM`, 2.2 Tgas |
| Upgrade (2026-11-11) | Code of `dev` 01dde86 with the moderator and `hide_note` (177,329 bytes, SHA-256 `e6093bb1…26be` in this build folder), no init call, the notes stay: transaction `EbvY3JzUmc4S6cDCfVr1bgbF55CLTexKGwAVqh2H9spr`. `set_moderator` to `multisig.seams-v1.testnet`: transaction `BKXvKf4YrNwhDA1uQZF6ez7p3H3fzw57ivQuH1Mxh3mr` |
| Redeploy (2026-11-11) | The reproducible build of commit `777b844` (146,408 bytes, SHA-256 `0b821a5c…7f80`). Its contract source is the same as in `dev` 01dde86. No init call; note 1 and the moderator stay: transaction `9d5SW81rQ2BQXrvqA5z78gYYxdEhP8JVVj4pu3tFFAEW` |

The smoke test added note 1 on post 9999, which is not a demo post. The
first demo note gets id 2. `get_notes({"post_id":9999})` returns note 1 with
all ten `NoteView` fields.

## Deploy to testnet

The commands use `notes.seams-v1.testnet`. For a new deployment, replace it
with a new account name. They sign with the key in `~/.near-credentials/testnet/`.

1. Create the contract account with 5 NEAR from `seams-v1.testnet`. The key of the new account goes to `~/.near-credentials/testnet/`.

   ```bash
   near account create-account fund-myself notes.seams-v1.testnet '5 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

2. Deploy the WASM of the reproducible build (`../reproducible.sh build
   community-notes`). No init call is necessary.

   ```bash
   near contract deploy notes.seams-v1.testnet use-file res/community_notes.wasm without-init-call network-config testnet sign-with-legacy-keychain send
   ```

3. Read the notes of a post.

   ```bash
   near contract call-function as-read-only notes.seams-v1.testnet get_notes json-args '{"post_id":1}' network-config testnet now
   ```

4. Add a note from the CLI, for a test without the Wallet.

   ```bash
   near contract call-function as-transaction notes.seams-v1.testnet add_note json-args '{"post_id":1,"text":"The photo is from 2019.","summary":"Photo is from 2019"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as YOUR_ACCOUNT.testnet network-config testnet sign-with-legacy-keychain send
   ```

## Limits

- Any account can add notes and rate notes. Each call uses the contract balance for storage, so many calls can use up the balance. This is acceptable for a demo on testnet.
- The contract has no owner, no delete, and no upgrade method. The full access key of the contract account can deploy new code.
- `get_notes` reads at most the newest 50 notes of a post. It has no pages.
