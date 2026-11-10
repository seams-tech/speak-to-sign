//! `verify` of the multisig kinds: a proposal said by its proposer, then
//! confirmations said from memory by other members.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use spoken_intent::{
    multisig_approval_digest, multisig_commitment, NearAccount, NearAmount, Network, ProposalV1, SpokenAccount,
};

use seams_voice_verifier::digest::{b64u, hex};
use seams_voice_verifier::output::Verdict;

use crate::fake::{call, checked_verdict, clip, embedding, enroll_input_as, enrolled, outcome_name, Fake, OWNER};

const MULTISIG: &str = "team.seams-v1.testnet";
const BOB: &str = "bob.testnet";
const CAROL: &str = "carol.testnet";
/// 25 NEAR.
const AMOUNT: &str = "25000000000000000000000000";
const SAID: &str = "Approve proposal 7: send 25 NEAR to grants.testnet.";
/// The fake host draws this salt.
const SALT: [u8; 32] = [0x5a; 32];

fn propose_input(wav: &[u8], receiver: &str) -> Value {
    json!({
        "op": "verify",
        "owner": OWNER,
        "request": {
            "kind": "multisig_propose",
            "multisig": MULTISIG,
            "proposal_id": 7,
            "receiver": receiver,
            "amount_yocto": AMOUNT,
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

fn confirm_input(owner: &str, wav: &[u8], proposal_id: u64, commitment_hex: &str) -> Value {
    json!({
        "op": "verify",
        "owner": owner,
        "request": {
            "kind": "multisig_confirm",
            "multisig": MULTISIG,
            "proposal_id": proposal_id,
            "commitment_hex": commitment_hex,
        },
        "contacts": [],
        "audio_wav_b64": STANDARD.encode(wav),
    })
}

fn commitment(receiver: &str) -> [u8; 32] {
    let proposal = ProposalV1::Transfer {
        receiver: SpokenAccount::new(receiver).unwrap(),
        amount: NearAmount::from_yocto(AMOUNT.parse().unwrap()).unwrap(),
    };
    multisig_commitment(&NearAccount::new(MULTISIG).unwrap(), 7, &proposal, &SALT)
}

fn digest(owner: &str, commitment: &[u8; 32]) -> String {
    let owner = NearAccount::new(owner).unwrap();
    b64u(&multisig_approval_digest(Network::Testnet, &owner, &NearAccount::new(MULTISIG).unwrap(), 7, commitment))
}

/// Enrolls `owner` with three clips near `axis`. The clips differ from
/// every clip of `enrolled()`.
fn enroll(fake: &mut Fake, owner: &str, axis: usize) {
    fake.accounts.push(owner.into());
    let first = 2.0 + axis as f32 * 0.03;
    let clips = [clip(first), clip(first + 0.01), clip(first + 0.02)];
    for (index, wav) in clips.iter().enumerate() {
        fake.voice(wav, embedding(axis, 0.1 * index as f32));
    }
    let out = call(fake, enroll_input_as(owner, &clips));
    assert_eq!(out["outcome"], "accept", "{out}");
}

/// Says `transcript` with a new clip whose voice is near `axis`.
fn say(fake: &mut Fake, input: impl FnOnce(&[u8]) -> Value, axis: usize, step: f32, transcript: &str) -> (Value, Verdict) {
    let wav = clip(step);
    fake.voice(&wav, embedding(axis, 0.05));
    fake.transcript = Some(transcript.into());
    let out = call(fake, input(&wav));
    let verdict = checked_verdict(&out);
    (out, verdict)
}

/// The owner proposes 25 NEAR to grants.testnet; Bob (axis 10) and Carol
/// (axis 20) are enrolled.
fn proposed() -> (Fake, String) {
    let mut fake = enrolled();
    enroll(&mut fake, BOB, 10);
    enroll(&mut fake, CAROL, 20);
    let (out, verdict) = say(&mut fake, |wav| propose_input(wav, "grants.testnet"), 0, 0.31, SAID);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    (fake, hex(&commitment("grants.testnet")))
}

#[test]
fn a_proposal_and_a_recalled_confirmation_are_accepted() {
    let mut fake = enrolled();
    enroll(&mut fake, BOB, 10);
    let (out, verdict) = say(&mut fake, |wav| propose_input(wav, "grants.testnet"), 0, 0.31, SAID);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    let commitment = commitment("grants.testnet");
    assert_eq!(verdict.request_digest, Some(digest(OWNER, &commitment)));
    assert!(verdict.spoken_text_digest.is_some());
    assert_eq!(out["multisig"], json!({ "commitment": b64u(&commitment), "salt": b64u(&SALT) }));

    let commitment_hex = hex(&commitment);
    let (out, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &commitment_hex), 10, 0.32, SAID);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert_eq!(verdict.request_digest, Some(digest(BOB, &commitment)));
    assert!(out.get("multisig").is_none(), "{out}");
    let voices_key = format!("msig1:{MULTISIG}:{}:voices", b64u(&commitment));
    let voices: Vec<String> = serde_json::from_slice(&fake.storage[&voices_key]).unwrap();
    assert_eq!(voices, [OWNER, BOB]);
}

#[test]
fn a_wrong_recall_shows_nothing_of_the_proposal() {
    let (mut fake, commitment_hex) = proposed();
    let (out, verdict) = say(
        &mut fake,
        |wav| confirm_input(BOB, wav, 7, &commitment_hex),
        10,
        0.32,
        "Approve proposal 7: send 250 NEAR to grants.testnet.",
    );
    assert_eq!(outcome_name(&verdict), "words", "{out}");
    assert_eq!(verdict.heard.as_deref(), Some("approve proposal seven send two hundred fifty near to grants dot testnet"));
    assert_eq!(verdict.spoken_text_digest, None);
    assert_eq!(verdict.word_margin_milli, None);
    assert!(out.get("multisig").is_none(), "{out}");
}

#[test]
fn three_wrong_recalls_use_up_the_member() {
    let (mut fake, commitment_hex) = proposed();
    for (index, guess) in ["25 NEAR to grant.testnet", "2.5 NEAR to grants.testnet", "25 NEAR to carol.testnet"]
        .iter()
        .enumerate()
    {
        let said = format!("Approve proposal 7: send {guess}.");
        let step = 0.4 + index as f32 * 0.01;
        let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &commitment_hex), 10, step, &said);
        assert_eq!(outcome_name(&verdict), "words", "{guess}");
    }
    let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &commitment_hex), 10, 0.45, SAID);
    assert_eq!(outcome_name(&verdict), "attempts_exhausted");
    // Another member keeps their own tries.
    let (_, verdict) = say(&mut fake, |wav| confirm_input(CAROL, wav, 7, &commitment_hex), 20, 0.46, SAID);
    assert_eq!(outcome_name(&verdict), "accept");
}

#[test]
fn a_stranger_cannot_use_up_a_members_tries() {
    let (mut fake, commitment_hex) = proposed();
    // Bob's account, Carol's voice: the speaker check refuses first.
    for step in [0.5, 0.51, 0.52, 0.53] {
        let (_, verdict) =
            say(&mut fake, |wav| confirm_input(BOB, wav, 7, &commitment_hex), 20, step, "Approve proposal 7.");
        assert_eq!(outcome_name(&verdict), "speaker");
    }
    let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &commitment_hex), 10, 0.54, SAID);
    assert_eq!(outcome_name(&verdict), "accept");
}

#[test]
fn one_voice_cannot_confirm_for_two_members() {
    let mut fake = enrolled();
    // Bob enrolled with the owner's voice (axis 0).
    enroll(&mut fake, BOB, 0);
    let (_, verdict) = say(&mut fake, |wav| propose_input(wav, "grants.testnet"), 0, 0.31, SAID);
    assert_eq!(outcome_name(&verdict), "accept");
    let commitment_hex = hex(&commitment("grants.testnet"));
    let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &commitment_hex), 0, 0.32, SAID);
    assert_eq!(outcome_name(&verdict), "same_speaker");
}

#[test]
fn a_confirmation_needs_a_stored_proposal_with_its_id() {
    let (mut fake, commitment_hex) = proposed();
    let other = hex(&[0x11; 32]);
    let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &other), 10, 0.6, SAID);
    assert_eq!(outcome_name(&verdict), "proposal_missing");
    let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 8, &commitment_hex), 10, 0.61, SAID);
    assert_eq!(outcome_name(&verdict), "proposal_missing");
    let upper = commitment_hex.to_uppercase();
    let (_, verdict) = say(&mut fake, |wav| confirm_input(BOB, wav, 7, &upper), 10, 0.62, SAID);
    assert_eq!(outcome_name(&verdict), "unsupported");
}

#[test]
fn proposals_that_are_not_speakable_are_unsupported() {
    let mut fake = enrolled();
    for (receiver, amount, id) in [
        ("98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de", AMOUNT, 7),
        ("grants.testnet", "1000000000000000000000", 7),
        ("grants.testnet", "0", 7),
        ("grants.testnet", AMOUNT, 0),
    ] {
        let wav = clip(0.7 + id as f32 * 0.001 + amount.len() as f32 * 0.0001);
        let mut input = propose_input(&wav, receiver);
        input["request"]["amount_yocto"] = json!(amount);
        input["request"]["proposal_id"] = json!(id);
        fake.transcript = Some(SAID.into());
        let verdict = checked_verdict(&call(&mut fake, input));
        assert_eq!(outcome_name(&verdict), "unsupported", "{receiver} {amount} {id}");
    }
}

#[test]
fn the_longest_receiver_fits_the_output() {
    // A 64-character named account: the longest verdict of a proposal.
    let receiver = format!("{}.testnet", "a".repeat(56));
    let mut fake = enrolled();
    let said = format!("Approve proposal 7: send 25 NEAR to {receiver}.");
    // `call` checks that the output stays below the size limit.
    let (out, verdict) = say(&mut fake, |wav| propose_input(wav, &receiver), 0, 0.8, &said);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert!(out["multisig"]["salt"].is_string(), "{out}");
}

#[test]
fn a_proposal_can_say_point_for_dot_and_leave_out_dash() {
    let mut fake = enrolled();
    let receiver = "seams-grants.testnet";
    let said = "approve proposal seven send twenty five near to seams grants point testnet";
    let (out, verdict) = say(&mut fake, |wav| propose_input(wav, receiver), 0, 0.9, said);
    assert_eq!(outcome_name(&verdict), "accept", "{out}");
    assert_eq!(verdict.heard.as_deref(), Some("approve proposal seven send twenty five near to seams dash grants dot testnet"));
}

#[test]
fn a_confirmation_refusal_does_not_write_the_receiver() {
    let (mut fake, commitment_hex) = proposed();
    // The receiver words are one edit from "grants": a contact match would
    // write "grants" into `heard`.
    let (out, verdict) = say(
        &mut fake,
        |wav| confirm_input(BOB, wav, 7, &commitment_hex),
        10,
        0.91,
        "approve proposal seven send two hundred fifty near to grand dot testnet",
    );
    assert_eq!(outcome_name(&verdict), "words", "{out}");
    assert_eq!(verdict.heard.as_deref(), Some("approve proposal seven send two hundred fifty near to grand dot testnet"));
}
