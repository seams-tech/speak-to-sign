//! Generates and checks `fixtures/spoken_intent_vectors_v1.json`.
//!
//! Run with `UPDATE_SPOKEN_INTENT_VECTORS=1` to write the file. Without it,
//! the test fails if the committed file differs from the generator.

use std::fs;
use std::num::NonZeroU8;
use std::path::PathBuf;

use serde_json::{json, Value};
use spoken_intent::{
    confusion_set, normalize, normalize_punctuated, parse_transfer, phonetic_key, render,
    request_digest, spoken_text_digest, ChallengeWord, NearAmount, Network, ParseResult,
    ProposalV1, SpokenAccount, SpokenRequestV1, SpokenToken, CHALLENGE_WORDS, PUNCTUATED_ALIASES,
    RENDERER_VERSION,
};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const HUNDREDTH: u128 = ONE_NEAR / 100;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("spoken_intent_vectors_v1.json")
}

fn account(id: &str) -> SpokenAccount {
    SpokenAccount::new(id).expect("speakable account")
}

fn near(hundredths: u64) -> NearAmount {
    NearAmount::from_hundredths(hundredths).expect("speakable amount")
}

fn word(word: &str) -> ChallengeWord {
    let index = CHALLENGE_WORDS
        .iter()
        .position(|candidate| *candidate == word)
        .expect("challenge word");
    ChallengeWord::from_index(index as u8).expect("index below 64")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn text(tokens: &[SpokenToken]) -> String {
    tokens
        .iter()
        .map(SpokenToken::as_str)
        .collect::<Vec<_>>()
        .join(" ")
}

fn contacts() -> Vec<SpokenAccount> {
    ["alice.testnet", "bob.testnet", "bob-1.testnet"]
        .into_iter()
        .map(account)
        .collect()
}

fn transfer(network: Network, receiver: &str, hundredths: u64, nonce: u64) -> SpokenRequestV1 {
    SpokenRequestV1::VaultTransfer {
        network,
        vault: account("voice-vault.testnet"),
        owner: account("owner.testnet"),
        receiver: account(receiver),
        amount: near(hundredths),
        nonce,
    }
}

fn approval(proposal_id: u64, proposal: ProposalV1, words: [&str; 2]) -> SpokenRequestV1 {
    SpokenRequestV1::MultisigApproval {
        network: Network::Testnet,
        multisig: account("payroll-multisig.testnet"),
        proposal_id,
        proposal,
        challenge: [word(words[0]), word(words[1])],
    }
}

fn request_cases() -> Vec<(&'static str, SpokenRequestV1)> {
    let mut sequential_hash = [0u8; 32];
    for (index, byte) in sequential_hash.iter_mut().enumerate() {
        *byte = index as u8;
    }
    vec![
        (
            "vault_transfer_25",
            transfer(Network::Testnet, "alice.testnet", 2_500, 1),
        ),
        (
            "vault_transfer_2_5",
            transfer(Network::Testnet, "bob-1.testnet", 250, 2),
        ),
        (
            "vault_transfer_1250",
            transfer(Network::Testnet, "alice.testnet", 125_000, 3),
        ),
        (
            "vault_transfer_0_25",
            transfer(Network::Testnet, "bob.testnet", 25, 4),
        ),
        (
            "vault_transfer_0_05",
            transfer(Network::Testnet, "bob.testnet", 5, 5),
        ),
        (
            "vault_transfer_0_01",
            transfer(Network::Testnet, "alice.testnet", 1, 6),
        ),
        (
            "vault_transfer_13_30",
            transfer(Network::Testnet, "alice.testnet", 1_330, 7),
        ),
        (
            "vault_transfer_105",
            transfer(Network::Testnet, "alice.testnet", 10_500, 8),
        ),
        (
            "vault_transfer_max",
            transfer(Network::Testnet, "alice.testnet", 100_000_000, 9),
        ),
        (
            "vault_transfer_999999_99",
            transfer(Network::Testnet, "alice.testnet", 99_999_999, 10),
        ),
        (
            "vault_transfer_underscore_digits",
            transfer(Network::Testnet, "pay_roll2.testnet", 1_000, 11),
        ),
        (
            "vault_transfer_mainnet",
            transfer(Network::Mainnet, "alice.near", 2_500, 1),
        ),
        (
            "multisig_transfer_42",
            approval(
                42,
                ProposalV1::Transfer {
                    receiver: account("payroll.testnet"),
                    amount: near(1_000),
                },
                ["river", "lantern"],
            ),
        ),
        (
            "multisig_add_member",
            approval(
                7,
                ProposalV1::AddMember {
                    member: account("carol.testnet"),
                },
                ["tiger", "piano"],
            ),
        ),
        (
            "multisig_remove_member",
            approval(
                1_001,
                ProposalV1::RemoveMember {
                    member: account("bob.testnet"),
                },
                ["orchard", "river"],
            ),
        ),
        (
            "multisig_set_threshold",
            approval(
                0,
                ProposalV1::SetThreshold {
                    threshold: NonZeroU8::new(2).expect("nonzero"),
                },
                ["umbrella", "volcano"],
            ),
        ),
        (
            "multisig_set_verifier_version",
            approval(
                999,
                ProposalV1::SetVerifierVersion {
                    version_hash: sequential_hash,
                },
                ["compass", "meadow"],
            ),
        ),
        (
            "multisig_set_verifier_version_zero",
            approval(
                u64::MAX,
                ProposalV1::SetVerifierVersion {
                    version_hash: [0u8; 32],
                },
                ["river", "river"],
            ),
        ),
    ]
}

fn request_vectors() -> Value {
    let contacts = contacts();
    let cases = request_cases()
        .into_iter()
        .map(|(name, request)| {
            let bytes = borsh::to_vec(&request).expect("borsh");
            let decoded: SpokenRequestV1 = borsh::from_slice(&bytes).expect("borsh round trip");
            assert_eq!(decoded, request, "{name}");
            let rendered = render(&request);
            let confusions: Vec<String> = confusion_set(&request, &contacts)
                .iter()
                .map(|tokens| text(tokens))
                .collect();
            assert!(!confusions.contains(&rendered.spoken_text), "{name}");
            json!({
                "name": name,
                "borsh_hex": hex(&bytes),
                "display_text": rendered.display_text,
                "spoken_text": rendered.spoken_text,
                "request_digest_hex": hex(&request_digest(&request)),
                "spoken_text_digest_hex": hex(&spoken_text_digest(&rendered)),
                "confusion_set": confusions,
            })
        })
        .collect::<Vec<_>>();
    Value::Array(cases)
}

fn unsupported_amount_vectors() -> Value {
    let cases: Vec<(&str, u128)> = vec![
        ("zero", 0),
        ("one_yocto", 1),
        ("one_thousandth", ONE_NEAR / 1_000),
        ("hundredth_plus_one_yocto", HUNDREDTH + 1),
        ("above_max", 1_000_000 * ONE_NEAR + HUNDREDTH),
        ("ten_million", 10_000_000 * ONE_NEAR),
        ("u128_max", u128::MAX),
    ];
    Value::Array(
        cases
            .into_iter()
            .map(|(name, amount_yocto)| {
                let reason = NearAmount::from_yocto(amount_yocto).expect_err(name);
                json!({
                    "name": name,
                    "amount_yocto": amount_yocto.to_string(),
                    "reason": format!("{reason:?}"),
                })
            })
            .collect(),
    )
}

fn unsupported_account_vectors() -> Value {
    let implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    let cases = vec![
        ("implicit_hex", implicit.to_string()),
        ("eth_implicit", format!("0x{}", "ab".repeat(20))),
        ("ox_prefix", "0xalice.testnet".to_string()),
        ("uppercase", "Alice.testnet".to_string()),
        ("too_short", "a".to_string()),
        ("too_long", format!("{}.testnet", "a".repeat(57))),
        ("empty_part", "alice..testnet".to_string()),
        ("leading_dash", "-alice.testnet".to_string()),
        ("trailing_dash", "alice.testnet-".to_string()),
        ("double_separator", "alice-_bob.testnet".to_string()),
        ("space", "alice bob.testnet".to_string()),
        ("non_ascii", "alic\u{e9}.testnet".to_string()),
    ];
    Value::Array(
        cases
            .into_iter()
            .map(|(name, account_id)| {
                let reason = SpokenAccount::new(&account_id).expect_err(name);
                json!({
                    "name": name,
                    "account_id": account_id,
                    "reason": format!("{reason:?}"),
                })
            })
            .collect(),
    )
}

fn borsh_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}

fn vault_transfer_bytes(network: u8, receiver: &str, amount_yocto: u128) -> Vec<u8> {
    let mut out = vec![0, network];
    borsh_string(&mut out, "voice-vault.testnet");
    borsh_string(&mut out, "owner.testnet");
    borsh_string(&mut out, receiver);
    out.extend_from_slice(&amount_yocto.to_le_bytes());
    out.extend_from_slice(&1u64.to_le_bytes());
    out
}

fn threshold_bytes(threshold: u8, challenge: [u8; 2]) -> Vec<u8> {
    let mut out = vec![1, 0];
    borsh_string(&mut out, "payroll-multisig.testnet");
    out.extend_from_slice(&0u64.to_le_bytes());
    out.extend_from_slice(&[3, threshold]);
    out.extend_from_slice(&challenge);
    out
}

fn invalid_borsh_vectors() -> Value {
    // The hand encoders must match the derived layout on valid input.
    assert_eq!(
        vault_transfer_bytes(0, "alice.testnet", 25 * ONE_NEAR),
        borsh::to_vec(&transfer(Network::Testnet, "alice.testnet", 2_500, 1)).expect("borsh"),
    );
    assert_eq!(
        threshold_bytes(2, [0, 1]),
        borsh::to_vec(&approval(
            0,
            ProposalV1::SetThreshold {
                threshold: NonZeroU8::new(2).expect("nonzero")
            },
            ["river", "lantern"],
        ))
        .expect("borsh"),
    );
    let mut trailing = vault_transfer_bytes(0, "alice.testnet", 25 * ONE_NEAR);
    trailing.push(0);
    let cases = vec![
        (
            "amount_one_thousandth",
            vault_transfer_bytes(0, "alice.testnet", ONE_NEAR / 1_000),
        ),
        ("amount_zero", vault_transfer_bytes(0, "alice.testnet", 0)),
        (
            "receiver_implicit",
            vault_transfer_bytes(
                0,
                "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de",
                25 * ONE_NEAR,
            ),
        ),
        (
            "receiver_uppercase",
            vault_transfer_bytes(0, "Alice.testnet", 25 * ONE_NEAR),
        ),
        (
            "unknown_network",
            vault_transfer_bytes(2, "alice.testnet", 25 * ONE_NEAR),
        ),
        ("trailing_byte", trailing),
        ("threshold_zero", threshold_bytes(0, [0, 1])),
        ("challenge_index_64", threshold_bytes(2, [0, 64])),
        ("unknown_request_kind", vec![2, 0]),
    ];
    Value::Array(
        cases
            .into_iter()
            .map(|(name, bytes)| {
                assert!(
                    borsh::from_slice::<SpokenRequestV1>(&bytes).is_err(),
                    "{name}"
                );
                json!({ "name": name, "borsh_hex": hex(&bytes) })
            })
            .collect(),
    )
}

const NORMALIZE_CASES: [&str; 22] = [
    "send twenty five near to alice dot testnet",
    "Send 25 NEAR to alice.testnet.",
    "Send 2.5 NEAR to bob-1.testnet",
    "send 1,250 near to alice dot testnet",
    "send 1250 near to alice dot testnet",
    "send one thousand two hundred and fifty near to alice dot testnet",
    "send a hundred near to alice dot testnet",
    "send a thousand near to alice dot testnet",
    "send twenty-five near to alice dot testnet",
    "send 0.25 NEAR to bob.testnet",
    "Send zero point two five NEAR to bob dot testnet!",
    "send 1,000,000 near to alice.testnet",
    "send twenty five near to pay_roll2.testnet",
    "don't send 25 NEAR to alice.testnet",
    "Don\u{2019}t send 25 NEAR to alice.testnet",
    "send 25 near to alice and bob",
    "approve proposal 42 send 10 NEAR to payroll.testnet river lantern",
    "send $25 to alice.testnet",
    "send 25 n\u{e9}ar to alice.testnet",
    "send 1,25 near to alice.testnet",
    "send 99999999999999999999 near to alice.testnet",
    " ... ",
];

fn normalize_vectors() -> Value {
    Value::Array(
        NORMALIZE_CASES
            .iter()
            .map(|transcript| {
                let tokens = normalize(transcript).map(|tokens| text(&tokens));
                json!({ "transcript": transcript, "tokens": tokens })
            })
            .collect(),
    )
}

const PARSE_CASES: [&str; 18] = [
    "send twenty five near to alice dot testnet",
    "Send 2.5 NEAR to bob-1.testnet",
    "send one thousand two hundred fifty near to alice dot testnet",
    "send zero point zero five near to bob dot testnet",
    "send one million near to alice dot testnet",
    "do not send twenty five near to alice dot testnet",
    "don't send twenty five near to alice dot testnet",
    "send twenty five near to alice dot testnet and send one hundred near to bob dot testnet",
    "send twenty five near to alicia dot testnet",
    "send twenty five near to bob",
    "send twenty five near",
    "pay twenty five near to alice dot testnet",
    "send near to alice dot testnet",
    "send two point five zero near to bob dot testnet",
    "send twelve hundred near to alice dot testnet",
    "send zero near to alice dot testnet",
    "send one million point zero one near to alice dot testnet",
    "send zero point zero zero one near to alice dot testnet",
];

fn parse_vectors() -> Value {
    let contacts = contacts();
    let contact_ids: Vec<&str> = contacts.iter().map(SpokenAccount::as_str).collect();
    Value::Array(
        PARSE_CASES
            .iter()
            .map(|transcript| {
                let tokens = normalize(transcript).expect("normalizable transcript");
                let result = match parse_transfer(&tokens, &contacts) {
                    ParseResult::Transfer(parsed) => json!({
                        "receiver": parsed.receiver.as_str(),
                        "amount_yocto": parsed.amount.yocto().to_string(),
                    }),
                    ParseResult::Refused(reason) => json!({ "refused": format!("{reason:?}") }),
                };
                json!({
                    "transcript": transcript,
                    "contacts": contact_ids,
                    "result": result,
                })
            })
            .collect(),
    )
}

/// Whisper-style transcripts, with the contacts of a vault that holds no two
/// confusable keys.
const PUNCTUATED_CASES: [&str; 16] = [
    "Send 25 NEAR to alice.testnet.",
    " Send 1,250 nir to Alice.Testnet!",
    "Send 2.5 neer to bob-1.testnet",
    "Send 8888 near to alice.testnut.",
    "Send 0.05 NEAR to bob dot testnet",
    "Send 25 NEAR to alicia.testnet.",
    "Send 25 NEAR to a.testnet",
    "Send 25 NIA to alice.testnet.",
    "Don't send 25 NEAR to alice.testnet.",
    "Send 25 NEAR to alice.testnet and send 100 NEAR to bob.testnet.",
    "Approved Proposal 42 send 10 NEAR to payroll.testnet river lantern.",
    "Approve proposal 999 set verifier version 10374 compass meadow.",
    "Approve proposal 999 set verifier version 115-54 compass meadow.",
    "Approve proposal 999 set verifier version 1,037,465 compass meadow",
    "Approved proposal 7 add member pay_roll2.testnet tiger piano",
    "send $25 to alice.testnet",
];

fn punctuated_vectors() -> Value {
    let contacts = contacts();
    Value::Array(
        PUNCTUATED_CASES
            .iter()
            .map(|transcript| {
                let result = match normalize_punctuated(transcript, &contacts) {
                    Ok(tokens) => json!({ "tokens": text(&tokens) }),
                    Err(reason) => json!({ "refused": format!("{reason:?}") }),
                };
                json!({ "transcript": transcript, "result": result })
            })
            .collect(),
    )
}

const PHONETIC_ACCOUNTS: [&str; 16] = [
    "alice.testnet",
    "alicia.testnet",
    "bob.testnet",
    "rob.testnet",
    "jon.testnet",
    "john.testnet",
    "payroll.testnet",
    "payrolls.testnet",
    "philip.testnet",
    "filip.testnet",
    "kathy.testnet",
    "cathy.testnet",
    "bob-1.testnet",
    "bob1.testnet",
    "bob2.testnet",
    "alice.near",
];

const CONFUSABLE_PAIRS: [(&str, &str); 12] = [
    ("alice.testnet", "alicia.testnet"),
    ("bob.testnet", "rob.testnet"),
    ("jon.testnet", "john.testnet"),
    ("payroll.testnet", "payrolls.testnet"),
    ("philip.testnet", "filip.testnet"),
    ("kathy.testnet", "cathy.testnet"),
    ("ann.testnet", "anne.testnet"),
    ("alice.testnet", "bob.testnet"),
    ("bob1.testnet", "bob2.testnet"),
    ("bob-1.testnet", "bob1.testnet"),
    ("alice.testnet", "alice.near"),
    ("carol.testnet", "payroll.testnet"),
];

fn phonetic_vectors() -> (Value, Value) {
    let keys = PHONETIC_ACCOUNTS
        .iter()
        .map(|id| json!({ "account_id": id, "key": phonetic_key(&account(id)).as_str() }))
        .collect();
    let pairs = CONFUSABLE_PAIRS
        .iter()
        .map(|(left, right)| {
            let confusable =
                phonetic_key(&account(left)).is_confusable_with(&phonetic_key(&account(right)));
            json!({ "a": left, "b": right, "confusable": confusable })
        })
        .collect();
    (Value::Array(keys), Value::Array(pairs))
}

fn generated_vectors_json() -> String {
    let (phonetic_keys, confusable_pairs) = phonetic_vectors();
    let fixture = json!({
        "renderer": RENDERER_VERSION,
        "request_digest_domain": String::from_utf8(spoken_intent::REQUEST_DIGEST_DOMAIN.to_vec()).expect("ascii"),
        "spoken_text_digest_domain": String::from_utf8(spoken_intent::SPOKEN_TEXT_DIGEST_DOMAIN.to_vec()).expect("ascii"),
        "challenge_words": CHALLENGE_WORDS.as_slice(),
        "confusion_contacts": contacts().iter().map(SpokenAccount::as_str).collect::<Vec<_>>(),
        "requests": request_vectors(),
        "unsupported_amounts": unsupported_amount_vectors(),
        "unsupported_accounts": unsupported_account_vectors(),
        "invalid_borsh": invalid_borsh_vectors(),
        "normalize": normalize_vectors(),
        "parse_transfer": parse_vectors(),
        "punctuated_aliases": PUNCTUATED_ALIASES.as_slice(),
        "normalize_punctuated": punctuated_vectors(),
        "phonetic_keys": phonetic_keys,
        "confusable_pairs": confusable_pairs,
    });
    format!(
        "{}\n",
        serde_json::to_string_pretty(&fixture).expect("json")
    )
}

#[test]
fn committed_spoken_intent_vectors_match_generator() {
    let path = fixture_path();
    let generated = generated_vectors_json();
    if std::env::var_os("UPDATE_SPOKEN_INTENT_VECTORS").is_some() {
        fs::create_dir_all(path.parent().expect("fixture parent")).expect("create fixture dir");
        fs::write(&path, &generated).expect("write spoken-intent vectors");
    }
    let committed = fs::read_to_string(&path).expect("committed spoken-intent vectors");
    assert_eq!(committed, generated);
}
