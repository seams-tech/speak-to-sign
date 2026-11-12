# Baseline and hackathon work: the first commit of each part

[`JUDGES.md`, "Scope of the hackathon work"](../JUDGES.md#scope-of-the-hackathon-work)
says what is hackathon work and what is the baseline. This page gives the
proof from the git history. Run the commands from the folder that holds the
clone (`git clone https://github.com/seams-tech/speak-to-sign`, a full clone
with no `--depth`).

The hackathon window runs from 2026-10-19 to 2026-11-14 (UTC). Seams Wallet
existed before the window; it is the baseline. All of this repository was
made in the window. The table gives the first commit of each part in UTC
author time.

For a part of this repository, the command prints its first commit. Define
this helper first:

```bash
first() { TZ=UTC git -C "$1" log --diff-filter=A --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- "$2" | head -1 | cut -c1-100; }
```

For a part of the Wallet, the dependency, the last column links the commit on
GitHub.

| Part | Where | First commit | Command or link |
| ---- | ----- | ------------ | ------- |
| **Baseline.** Seams Wallet with Router A/B threshold signing, ed25519-yao and threshold ECDSA. Parts are checked with Lean, Verus and TLA+. | `seams-wallet`: `crates/router-ab-*`, `crates/ed25519-yao`, `crates/*/formal-verification` | 2026-09-11 17:10, `cdb1c4a1` | [`cdb1c4a1`](https://github.com/seams-tech/seams-wallet/commit/cdb1c4a1) |
| **Baseline.** VoiceID UI scaffold: a voice assistant card with no speech check. | `seams-wallet`: `packages/wallet/src/react/components/VoiceAssistantCard.tsx` (removed later) | 2026-10-13 03:28, `21503882` | [`21503882`](https://github.com/seams-tech/seams-wallet/commit/21503882) |
| Window starts. The last earlier commit on `seams-wallet` `main` is `620794d9`. | | 2026-10-18 23:54 | [`620794d9`](https://github.com/seams-tech/seams-wallet/commit/620794d9) |
| VoiceID speech verification. | `seams-wallet`: commits that name VoiceID; `packages/voiceid` from 2026-10-26 | 2026-10-22 16:36, `9ace901f` | [`9ace901f`](https://github.com/seams-tech/seams-wallet/commit/9ace901f) |
| The `spoken-intent` crate. It moved here from `seams-wallet` `crates/spoken-intent` with its history. | `speak-to-sign`: `crates/spoken-intent/` (was `spoken-intent/`) | 2026-11-07 06:50, `923e576` | `first speak-to-sign spoken-intent` |
| The verifier, the speaker service and the Gate 0 probes. | `speak-to-sign`: `crates/voice-verifier/`, `crates/speaker-service/`, `research/gate0/` (was `voice-verifier/`, `speaker-service/`, `gate0/`, `voice-probe/`) | 2026-11-07 12:21, `6e5abf1` | `first speak-to-sign voice-verifier` |
| Speak-to-Sign in the Wallet. | `seams-wallet`: `packages/speak-to-sign` (later `packages/wallet-voice-sign/` here, and since refactor 232 a part of `@seams/wallet` again), `packages/wallet/src/core/transactionFeatures/` | 2026-11-07 12:20, `4b0d7981` | [`4b0d7981`](https://github.com/seams-tech/seams-wallet/commit/4b0d7981) |
| Spoken notes in the verifier (version 0.4.0). | `speak-to-sign`: `crates/voice-verifier/src` (was `voice-verifier/src`) | 2026-11-09 10:14, `ff1409b` | `TZ=UTC git -C speak-to-sign log -S community_note --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- voice-verifier/src \| head -1` |
| The community notes contract. | `speak-to-sign`: `demo/contracts/community-notes/` (was `community-notes/`, then `contracts/community-notes/`) | 2026-11-09 10:21, `7f0e014` | `first speak-to-sign community-notes` |
| Spoken notes in the Wallet. | `seams-wallet`: `packages/wallet/src` | 2026-11-09 10:25, `bec40080` | [`bec40080`](https://github.com/seams-tech/seams-wallet/commit/bec40080) |
| The demo page (named "Spoken Notes" at first). | `speak-to-sign`: `demo/frontend/` (was `demo/`; an earlier Python demo client is from 2026-11-07) | 2026-11-09 10:33, `e25f1ec` | `TZ=UTC git -C speak-to-sign log -1 --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' e25f1ec` |
| The Speak to pay example. | `speak-to-sign`: `examples/` | 2026-11-09 11:05, `2999fd6` | `first speak-to-sign examples` |
| The JEV prediction market for community notes: a parimutuel USDC market, the OutLayer resolver (JEV on NEAR AI), and the strip in the notes demo. | `speak-to-sign`: `demo/contracts/jev-prediction-market/`, `demo/frontend/src/market/` | 2026-11-09 15:11, `a6c2376` | `first speak-to-sign demo/contracts/jev-prediction-market` |

The diffs:

- This repository: every commit of the `dev` branch is in the window
  (<https://github.com/seams-tech/speak-to-sign/commits/dev>). The
  oldest commit:

  ```bash
  TZ=UTC git -C speak-to-sign log --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' | sort | head -1 | cut -c1-100
  ```

  Expected:

  ```text
  2026-11-07 06:50 UTC 923e576 Add the spoken-intent crate for Refactor 210 voice intents: one no_std 
  ```
- `seams-wallet`, all changes in the window up to 0.70.0, the version that
  the demo pins (2026-11-13):
  <https://github.com/seams-tech/seams-wallet/compare/620794d9187c005e266292aea4d5b61a31d4a4d9...35649a05b7378e674a3980966cb217fbddd31a6f>.
  Most of these 794 commits are general Wallet work. The Speak-to-Sign paths
  (`packages/voiceid`, `packages/wallet/src/core/transactionFeatures`, and
  `packages/speak-to-sign` and `crates/spoken-intent`, which later moved to
  this repository) are new files only: 58 files, 8,572 added lines at 0.70.0.
  Up to Wallet 0.59.0 (`b12cf643`, 2026-11-09), the same paths held 91
  files, 17,110 added lines.

