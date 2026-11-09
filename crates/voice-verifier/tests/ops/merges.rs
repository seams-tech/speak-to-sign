//! `verify` of a merge approval.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use seams_voice_verifier::digest::{b64u, from_hex};

use crate::fake::{clip, spoken, OWNER};

const MERGES_CONTRACT: &str = "merges.seams-v1.testnet";

fn merge_input(wav: &[u8], pull_request: u64, base: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "merge_approval",
            "contract": MERGES_CONTRACT,
            "repo_sha256_hex": "cd".repeat(32),
            "pull_request": pull_request,
            "base": base,
            "head_commit_hex": "0123456789abcdef0123456789abcdef01234567",
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

#[test]
fn verify_accepts_a_spoken_merge_approval_with_exact_words() {
    use spoken_intent::{request_digest, NearAccount, Network, SpokenBranch, SpokenRequestV1};
    let wav = clip(0.03);
    let (result, verdict) = spoken(merge_input(&wav, 42, "main"), "Merge pull request 42 into main.");
    assert_eq!(result, "accept");
    assert_eq!(verdict.heard.as_deref(), Some("merge pull request forty two into main"));
    assert_eq!(verdict.policy_rule, None);
    let request = SpokenRequestV1::MergeApproval {
        network: Network::Testnet,
        owner: NearAccount::new(OWNER).unwrap(),
        contract: NearAccount::new(MERGES_CONTRACT).unwrap(),
        repo_sha256: [0xcd; 32],
        pull_request: 42,
        base: SpokenBranch::new("main").unwrap(),
        head_commit: from_hex::<20>("0123456789abcdef0123456789abcdef01234567").unwrap(),
    };
    assert_eq!(verdict.request_digest, Some(b64u(&request_digest(&request))));

    // Another number, another base, a negation or another verb: no
    // forgiveness.
    for transcript in [
        "merge pull request 43 into main",
        "merge pull request 42 into master",
        "Merge pull request 4 into main.",
        "Do not merge pull request 42 into main.",
        "Close pull request 42 into main.",
        "Merge pull request 42.",
    ] {
        assert_eq!(spoken(merge_input(&wav, 42, "main"), transcript).0, "words", "{transcript}");
    }
    assert_eq!(spoken(merge_input(&wav, 1_001, "develop"), "Merge pull request 1001 into develop.").0, "accept");
}

#[test]
fn merge_inputs_that_are_not_speakable_are_unsupported() {
    let wav = clip(0.03);
    let said = "Merge pull request 42 into main.";
    assert_eq!(spoken(merge_input(&wav, 0, "main"), "Merge pull request 0 into main.").0, "unsupported");
    for base in ["", "Main", "release2", "feature/x", "two words", &"a".repeat(33)] {
        assert_eq!(spoken(merge_input(&wav, 42, base), said).0, "unsupported", "{base}");
    }
    for (field, value) in [
        ("repo_sha256_hex", "CD".repeat(32)),
        ("repo_sha256_hex", "cd".repeat(31)),
        ("repo_sha256_hex", "zz".repeat(32)),
        ("head_commit_hex", "0123456789ABCDEF0123456789ABCDEF01234567".to_string()),
        ("head_commit_hex", "ab".repeat(32)),
        ("head_commit_hex", "ab".repeat(19)),
        ("contract", "Not An Account".to_string()),
    ] {
        let mut input = merge_input(&wav, 42, "main");
        input["request"][field] = json!(value);
        assert_eq!(spoken(input, said).0, "unsupported", "{field}: {value}");
    }
    let mut extra = merge_input(&wav, 42, "main");
    extra["request"]["deposit"] = json!("1");
    assert_eq!(spoken(extra, said).0, "unsupported");
}
