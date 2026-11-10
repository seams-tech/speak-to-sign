use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const NOW_MS: u64 = 1_762_700_000_000;
const TTL_MS: u64 = 120_000;
const SALT: [u8; 32] = [0x5a; 32];
/// 25 NEAR.
const AMOUNT: u128 = 25_000_000_000_000_000_000_000_000;
const RECEIVER: &str = "grants.testnet";
const MULTISIG: &str = "team.testnet";

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn multisig_id() -> AccountId {
    MULTISIG.parse().unwrap()
}

/// The verifier key of the tests.
fn verifier() -> SigningKey {
    SigningKey::from_bytes(&[0x2a; 32])
}

fn verifier_public_key(key: &SigningKey) -> String {
    format!(
        "ed25519:{}",
        near_sdk::bs58::encode(key.verifying_key().as_bytes()).into_string()
    )
}

fn context(predecessor: AccountId, promise_results: Vec<PromiseResult>) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(multisig_id())
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .block_timestamp(NOW_MS * 1_000_000)
            .build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        promise_results
    );
}

fn set_caller(name: &str) {
    context(account(name), vec![]);
}

/// alice, bob and carol; threshold 2.
fn contract() -> VoiceMultisig {
    context(multisig_id(), vec![]);
    VoiceMultisig::new(
        vec![account("alice"), account("bob"), account("carol")],
        2,
        verifier_public_key(&verifier()),
    )
}

fn transfer(receiver: &str, amount: u128) -> ProposalV1 {
    ProposalV1::Transfer {
        receiver: SpokenAccount::new(receiver).unwrap(),
        amount: NearAmount::from_yocto(amount).unwrap(),
    }
}

fn commitment(proposal_id: u64) -> [u8; 32] {
    multisig_commitment(
        &NearAccount::new(MULTISIG).unwrap(),
        proposal_id,
        &transfer(RECEIVER, AMOUNT),
        &SALT,
    )
}

fn digest(owner: &str, multisig: &str, proposal_id: u64, commitment: &[u8; 32]) -> [u8; 32] {
    multisig_approval_digest(
        Network::Testnet,
        &NearAccount::new(&format!("{owner}.testnet")).unwrap(),
        &NearAccount::new(multisig).unwrap(),
        proposal_id,
        commitment,
    )
}

/// The verdict JSON in the verifier's field order.
fn verdict(request_digest: Option<&[u8; 32]>, outcome: &str, expires_at_ms: u64) -> String {
    let digest = match request_digest {
        Some(bytes) => format!("\"{}\"", URL_SAFE_NO_PAD.encode(bytes)),
        None => "null".into(),
    };
    let reason = if outcome == "refuse" {
        "\"words\""
    } else {
        "null"
    };
    let policy_rule = if outcome == "step_up" {
        "\"stub_voice_amount_above_10_near\""
    } else {
        "null"
    };
    format!(
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.6.0","request_digest":{digest},"spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"{outcome}","reason":{reason},"policy_rule":{policy_rule},"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"approve proposal one send twenty five near to grants dot testnet"}}"#
    )
}

/// Standard base64 of the ed25519 signature of the verdict message.
fn sign(key: &SigningKey, verdict_json: &str) -> String {
    let mut preimage = VERDICT_DOMAIN.to_vec();
    preimage.extend_from_slice(verdict_json.as_bytes());
    let message = env::sha256_array(&preimage);
    STANDARD.encode(key.sign(&message).to_bytes())
}

/// A signed accept verdict of `owner` for proposal `proposal_id` of the
/// test multisig.
fn approval(owner: &str, proposal_id: u64, commitment: &[u8; 32]) -> (String, String) {
    signed(&digest(owner, MULTISIG, proposal_id, commitment), "accept")
}

fn signed(digest: &[u8; 32], outcome: &str) -> (String, String) {
    let json = verdict(Some(digest), outcome, NOW_MS + TTL_MS);
    let signature = sign(&verifier(), &json);
    (json, signature)
}

fn propose_as(contract: &mut VoiceMultisig, who: &str, proposal_id: u64) -> u64 {
    set_caller(who);
    let (json, signature) = approval(who, proposal_id, &commitment(proposal_id));
    contract.propose(
        proposal_id,
        to_hex(&commitment(proposal_id)),
        json,
        signature,
    )
}

fn confirm_as(contract: &mut VoiceMultisig, who: &str, proposal_id: u64) -> u32 {
    set_caller(who);
    let (json, signature) = approval(who, proposal_id, &commitment(proposal_id));
    contract.confirm(proposal_id, json, signature)
}

fn execute_as(
    contract: &mut VoiceMultisig,
    who: &str,
    proposal_id: u64,
    amount: u128,
    salt: &[u8; 32],
) {
    set_caller(who);
    // The promise is scheduled when it is dropped.
    drop(contract.execute(
        proposal_id,
        RECEIVER.parse().unwrap(),
        U128(amount),
        to_hex(salt),
    ));
}

/// Runs the callback as the runtime does after the transfer.
fn finish_transfer(contract: &mut VoiceMultisig, proposal_id: u64, result: PromiseResult) -> bool {
    context(multisig_id(), vec![result]);
    contract.on_transfer(proposal_id, RECEIVER.parse().unwrap(), U128(AMOUNT))
}

/// Proposal 1 by alice, confirmed by bob: ready to execute.
fn ready() -> VoiceMultisig {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    confirm_as(&mut contract, "bob", 1);
    contract
}

// --- the full flow ---

#[test]
fn propose_confirm_execute_sends_the_transfer() {
    let mut contract = contract();
    assert_eq!(contract.next_proposal_id(), 1);

    assert_eq!(propose_as(&mut contract, "alice", 1), 1);
    assert_eq!(contract.next_proposal_id(), 2);
    assert_eq!(
        get_logs(),
        vec![format!(
            r#"EVENT_JSON:{{"standard":"voice_multisig","version":"1.0.0","event":"proposed","data":[{{"proposal_id":1,"commitment_hex":"{}","proposer":"alice.testnet"}}]}}"#,
            to_hex(&commitment(1))
        )]
    );

    assert_eq!(confirm_as(&mut contract, "bob", 1), 2);
    assert_eq!(
        get_logs(),
        vec![
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"confirmed","data":[{"proposal_id":1,"member":"bob.testnet","confirmations":2}]}"#
        ]
    );

    execute_as(&mut contract, "bob", 1, AMOUNT, &SALT);
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2, "the transfer and the callback");
    assert_eq!(receipts[0].receiver_id.as_str(), RECEIVER);
    assert!(matches!(
        receipts[0].actions.as_slice(),
        [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == AMOUNT
    ));
    assert_eq!(receipts[1].receiver_id, multisig_id());
    let view = contract.get_proposal(1).unwrap();
    assert_eq!(view.status, Status::Executed);
    assert_eq!(view.receiver, None, "hidden until the transfer arrives");

    assert!(finish_transfer(
        &mut contract,
        1,
        PromiseResult::Successful(vec![])
    ));
    assert_eq!(
        get_logs(),
        vec![
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"executed","data":[{"proposal_id":1,"receiver":"grants.testnet","amount_yocto":"25000000000000000000000000"}]}"#
        ]
    );
    assert_eq!(
        serde_json::to_value(contract.get_proposal(1).unwrap()).unwrap(),
        json!({
            "id": 1,
            "commitment_hex": to_hex(&commitment(1)),
            "proposer": "alice.testnet",
            "confirmations": ["alice.testnet", "bob.testnet"],
            "status": "executed",
            "receiver": "grants.testnet",
            "amount_yocto": "25000000000000000000000000"
        })
    );
}

#[test]
fn a_failed_transfer_opens_the_proposal_again() {
    let mut contract = ready();
    execute_as(&mut contract, "alice", 1, AMOUNT, &SALT);
    assert!(!finish_transfer(&mut contract, 1, PromiseResult::Failed));
    assert_eq!(
        get_logs(),
        vec![
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"execute_failed","data":[{"proposal_id":1}]}"#
        ]
    );
    let view = contract.get_proposal(1).unwrap();
    assert_eq!(view.status, Status::Open);
    assert_eq!(view.receiver, None);
    assert_eq!(view.amount_yocto, None);

    // A member can try again.
    execute_as(&mut contract, "bob", 1, AMOUNT, &SALT);
    assert!(finish_transfer(
        &mut contract,
        1,
        PromiseResult::Successful(vec![])
    ));
    assert_eq!(contract.get_proposal(1).unwrap().status, Status::Executed);
}

#[test]
fn a_threshold_of_one_executes_after_the_proposal() {
    context(multisig_id(), vec![]);
    let mut contract = VoiceMultisig::new(
        vec![account("alice"), account("bob")],
        1,
        verifier_public_key(&verifier()),
    );
    propose_as(&mut contract, "alice", 1);
    execute_as(&mut contract, "alice", 1, AMOUNT, &SALT);
    assert_eq!(contract.get_proposal(1).unwrap().status, Status::Executed);
}

#[test]
fn a_verdict_that_expires_at_the_block_time_passes() {
    let mut contract = contract();
    set_caller("alice");
    let json = verdict(
        Some(&digest("alice", MULTISIG, 1, &commitment(1))),
        "accept",
        NOW_MS,
    );
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

// --- the verdict ---

#[test]
#[should_panic(expected = "the verdict signature does not match the verifier key")]
fn a_wrong_signature_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, _) = approval("alice", 1, &commitment(1));
    let (_, other_signature) = approval("bob", 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)), json, other_signature);
}

#[test]
#[should_panic(expected = "the verdict signature does not match the verifier key")]
fn a_changed_verdict_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, signature) = approval("alice", 1, &commitment(1));
    let changed = json.replace("\"speaker_score_milli\":655", "\"speaker_score_milli\":999");
    contract.propose(1, to_hex(&commitment(1)), changed, signature);
}

#[test]
#[should_panic(expected = "the verdict signature does not match the verifier key")]
fn a_verdict_of_another_key_fails() {
    let mut contract = contract();
    set_caller("alice");
    let json = verdict(
        Some(&digest("alice", MULTISIG, 1, &commitment(1))),
        "accept",
        NOW_MS + TTL_MS,
    );
    let signature = sign(&SigningKey::from_bytes(&[0x07; 32]), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "signature_b64 must be standard base64 of 64 bytes")]
fn a_short_signature_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, _) = approval("alice", 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)), json, STANDARD.encode([1u8; 63]));
}

#[test]
#[should_panic(expected = "signature_b64 must be standard base64 of 64 bytes")]
fn a_base64url_signature_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, signature) = approval("alice", 1, &commitment(1));
    let base64url = URL_SAFE_NO_PAD.encode(STANDARD.decode(signature).unwrap());
    // Make sure the text differs from standard base64.
    let base64url = format!("{base64url}-_");
    contract.propose(1, to_hex(&commitment(1)), json, base64url);
}

#[test]
#[should_panic(expected = "the verdict outcome must be accept")]
fn a_refuse_verdict_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, signature) = signed(&digest("alice", MULTISIG, 1, &commitment(1)), "refuse");
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict outcome must be accept")]
fn a_step_up_verdict_fails() {
    let mut contract = ready();
    set_caller("carol");
    let (json, signature) = signed(&digest("carol", MULTISIG, 1, &commitment(1)), "step_up");
    contract.confirm(1, json, signature);
}

#[test]
#[should_panic(expected = "the verdict has expired")]
fn an_expired_verdict_fails() {
    let mut contract = contract();
    set_caller("alice");
    let json = verdict(
        Some(&digest("alice", MULTISIG, 1, &commitment(1))),
        "accept",
        NOW_MS - 1,
    );
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_of_another_member_fails() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    set_caller("bob");
    let (json, signature) = approval("alice", 1, &commitment(1));
    contract.confirm(1, json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_propose_verdict_for_another_commitment_fails() {
    let mut contract = contract();
    set_caller("alice");
    let other = multisig_commitment(
        &NearAccount::new(MULTISIG).unwrap(),
        1,
        &transfer(RECEIVER, AMOUNT * 2),
        &SALT,
    );
    let (json, signature) = approval("alice", 1, &other);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_confirm_verdict_for_another_commitment_fails() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    set_caller("bob");
    let other = multisig_commitment(
        &NearAccount::new(MULTISIG).unwrap(),
        1,
        &transfer("attacker.testnet", AMOUNT),
        &SALT,
    );
    let (json, signature) = approval("bob", 1, &other);
    contract.confirm(1, json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_proposal_id_fails() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    propose_as(&mut contract, "alice", 2);
    set_caller("bob");
    // A verdict for proposal 1 with the commitment of proposal 2.
    let (json, signature) = approval("bob", 1, &commitment(2));
    contract.confirm(2, json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_multisig_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, signature) = signed(
        &digest("alice", "other.testnet", 1, &commitment(1)),
        "accept",
    );
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn an_accept_verdict_without_a_digest_fails() {
    let mut contract = contract();
    set_caller("alice");
    let json = verdict(None, "accept", NOW_MS + TTL_MS);
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict kind must be seams_voice_signed_verdict_v2")]
fn a_verdict_of_another_kind_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, _) = approval("alice", 1, &commitment(1));
    let json = json.replace(
        "seams_voice_signed_verdict_v2",
        "seams_voice_signed_verdict_v1",
    );
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "verdict_json is not a verdict: unknown field `extra`")]
fn a_verdict_with_an_unknown_field_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, _) = approval("alice", 1, &commitment(1));
    let json = json.replace(r#","heard":"#, r#","extra":1,"heard":"#);
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "verdict_json is not a verdict: missing field `heard`")]
fn a_verdict_without_a_field_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, _) = approval("alice", 1, &commitment(1));
    let start = json.find(r#","heard":"#).unwrap();
    let json = format!("{}}}", &json[..start]);
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "verdict_json is not a verdict: missing field `request_digest`")]
fn a_verdict_without_the_digest_field_fails() {
    let mut contract = contract();
    set_caller("alice");
    let json = verdict(None, "accept", NOW_MS + TTL_MS).replace(r#""request_digest":null,"#, "");
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

/// The shared verdict vector of the verifier: the contract reads its
/// signature and format, and refuses it because it is a transfer verdict.
#[test]
#[should_panic(expected = "the verdict is for another request")]
fn the_verifier_vector_passes_the_signature_check() {
    let vectors: Value = serde_json::from_str(include_str!(
        "../../../../crates/voice-verifier/testdata/signed_verdict_v2.json"
    ))
    .unwrap();
    let accept = &vectors["verdicts"][0];
    assert_eq!(accept["outcome"], "accept");
    context(multisig_id(), vec![]);
    let mut contract = VoiceMultisig::new(
        vec![account("alice"), account("bob")],
        2,
        vectors["public_key"].as_str().unwrap().into(),
    );
    set_caller("alice");
    contract.propose(
        1,
        to_hex(&commitment(1)),
        accept["verdict_json"].as_str().unwrap().into(),
        accept["signature_b64"].as_str().unwrap().into(),
    );
}

// --- propose and confirm ---

#[test]
#[should_panic(expected = "the caller is not a member")]
fn a_non_member_cannot_propose() {
    let mut contract = contract();
    propose_as(&mut contract, "mallory", 1);
}

#[test]
#[should_panic(expected = "the caller is not a member")]
fn a_non_member_cannot_confirm() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    confirm_as(&mut contract, "mallory", 1);
}

#[test]
#[should_panic(expected = "proposal_id must be next_proposal_id, 1")]
fn propose_with_another_id_fails() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 2);
}

#[test]
#[should_panic(expected = "proposal_id must be next_proposal_id, 2")]
fn propose_with_a_used_id_fails() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    propose_as(&mut contract, "bob", 1);
}

#[test]
#[should_panic(expected = "commitment_hex must be 64 lowercase hex characters")]
fn an_uppercase_commitment_fails() {
    let mut contract = contract();
    set_caller("alice");
    let (json, signature) = approval("alice", 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)).to_uppercase(), json, signature);
}

#[test]
#[should_panic(expected = "this member already confirmed the proposal")]
fn a_second_confirm_by_one_member_fails() {
    let mut contract = ready();
    confirm_as(&mut contract, "bob", 1);
}

#[test]
#[should_panic(expected = "this member already confirmed the proposal")]
fn the_proposer_cannot_confirm_again() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    confirm_as(&mut contract, "alice", 1);
}

#[test]
#[should_panic(expected = "no proposal has this id")]
fn confirm_of_an_unknown_proposal_fails() {
    let mut contract = contract();
    confirm_as(&mut contract, "bob", 1);
}

#[test]
#[should_panic(expected = "the proposal is already executed")]
fn confirm_after_execute_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "bob", 1, AMOUNT, &SALT);
    confirm_as(&mut contract, "carol", 1);
}

#[test]
fn a_confirm_above_the_threshold_counts() {
    let mut contract = ready();
    assert_eq!(confirm_as(&mut contract, "carol", 1), 3);
    assert_eq!(
        contract.get_proposal(1).unwrap().confirmations,
        vec![account("alice"), account("bob"), account("carol")]
    );
}

// --- execute ---

#[test]
#[should_panic(expected = "the proposal has 1 of 2 confirmations")]
fn execute_before_the_threshold_fails() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    execute_as(&mut contract, "alice", 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "receiver, amount_yocto and salt_hex do not match the commitment")]
fn execute_with_a_wrong_salt_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "bob", 1, AMOUNT, &[0x5b; 32]);
}

#[test]
#[should_panic(expected = "receiver, amount_yocto and salt_hex do not match the commitment")]
fn execute_with_a_wrong_amount_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "bob", 1, AMOUNT * 2, &SALT);
}

#[test]
#[should_panic(expected = "receiver, amount_yocto and salt_hex do not match the commitment")]
fn execute_with_a_wrong_receiver_fails() {
    let mut contract = ready();
    set_caller("bob");
    drop(contract.execute(
        1,
        "attacker.testnet".parse().unwrap(),
        U128(AMOUNT),
        to_hex(&SALT),
    ));
}

#[test]
#[should_panic(
    expected = "amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR"
)]
fn execute_with_an_unspeakable_amount_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "bob", 1, AMOUNT + 1, &SALT);
}

#[test]
#[should_panic(expected = "receiver must be a named account that the grammar can speak")]
fn execute_to_an_implicit_account_fails() {
    let mut contract = ready();
    set_caller("bob");
    let implicit: AccountId = "a".repeat(64).parse().unwrap();
    drop(contract.execute(1, implicit, U128(AMOUNT), to_hex(&SALT)));
}

#[test]
#[should_panic(expected = "salt_hex must be 64 lowercase hex characters")]
fn execute_with_a_short_salt_fails() {
    let mut contract = ready();
    set_caller("bob");
    drop(contract.execute(1, RECEIVER.parse().unwrap(), U128(AMOUNT), "5a".into()));
}

#[test]
#[should_panic(expected = "only a member who confirmed the proposal can execute it")]
fn execute_by_a_member_who_did_not_confirm_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "carol", 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "the caller is not a member")]
fn execute_by_a_non_member_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "mallory", 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "the proposal is already executed")]
fn a_second_execute_fails_while_the_first_is_in_flight() {
    let mut contract = ready();
    execute_as(&mut contract, "bob", 1, AMOUNT, &SALT);
    execute_as(&mut contract, "alice", 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "the proposal is already executed")]
fn execute_after_a_successful_transfer_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "bob", 1, AMOUNT, &SALT);
    finish_transfer(&mut contract, 1, PromiseResult::Successful(vec![]));
    execute_as(&mut contract, "bob", 1, AMOUNT, &SALT);
}

// --- new ---

fn new_with(members: &[&str], threshold: u8, key: &str) -> VoiceMultisig {
    context(multisig_id(), vec![]);
    VoiceMultisig::new(
        members.iter().map(|m| account(m)).collect(),
        threshold,
        key.into(),
    )
}

#[test]
#[should_panic(expected = "members must have 2 to 10 accounts")]
fn one_member_fails() {
    new_with(&["alice"], 1, &verifier_public_key(&verifier()));
}

#[test]
#[should_panic(expected = "members must have 2 to 10 accounts")]
fn eleven_members_fail() {
    let names: Vec<String> = (0..11).map(|n| format!("m{n}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    new_with(&names, 2, &verifier_public_key(&verifier()));
}

#[test]
fn ten_members_pass() {
    let names: Vec<String> = (0..10).map(|n| format!("m{n}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let contract = new_with(&names, 10, &verifier_public_key(&verifier()));
    assert_eq!(contract.get_config().threshold, 10);
}

#[test]
#[should_panic(expected = "members must be distinct")]
fn a_repeated_member_fails() {
    new_with(
        &["alice", "bob", "alice"],
        2,
        &verifier_public_key(&verifier()),
    );
}

#[test]
#[should_panic(expected = "threshold must be 1 to the number of members")]
fn threshold_0_fails() {
    new_with(&["alice", "bob"], 0, &verifier_public_key(&verifier()));
}

#[test]
#[should_panic(expected = "threshold must be 1 to the number of members")]
fn a_threshold_above_the_member_count_fails() {
    new_with(&["alice", "bob"], 3, &verifier_public_key(&verifier()));
}

#[test]
#[should_panic(expected = "verifier_public_key must be ed25519:<base58 of 32 bytes>")]
fn a_secp256k1_verifier_key_fails() {
    let key = verifier_public_key(&verifier()).replace("ed25519:", "secp256k1:");
    new_with(&["alice", "bob"], 2, &key);
}

#[test]
#[should_panic(expected = "verifier_public_key must be ed25519:<base58 of 32 bytes>")]
fn a_short_verifier_key_fails() {
    let key = format!(
        "ed25519:{}",
        near_sdk::bs58::encode([1u8; 31]).into_string()
    );
    new_with(&["alice", "bob"], 2, &key);
}

// --- views ---

#[test]
fn get_config_returns_the_members_threshold_and_key() {
    let contract = contract();
    assert_eq!(
        serde_json::to_value(contract.get_config()).unwrap(),
        json!({
            "members": ["alice.testnet", "bob.testnet", "carol.testnet"],
            "threshold": 2,
            "verifier_public_key": verifier_public_key(&verifier())
        })
    );
}

#[test]
fn an_open_proposal_has_no_receiver_or_amount() {
    let mut contract = contract();
    propose_as(&mut contract, "alice", 1);
    assert_eq!(
        serde_json::to_value(contract.get_proposal(1).unwrap()).unwrap(),
        json!({
            "id": 1,
            "commitment_hex": to_hex(&commitment(1)),
            "proposer": "alice.testnet",
            "confirmations": ["alice.testnet"],
            "status": "open"
        })
    );
    assert_eq!(contract.get_proposal(0), None);
    assert_eq!(contract.get_proposal(2), None);
}

#[test]
fn get_proposals_is_newest_first_and_pages() {
    let mut contract = contract();
    assert_eq!(contract.get_proposals(None, None), vec![]);
    for id in 1..=55 {
        propose_as(&mut contract, "alice", id);
    }
    let ids = |list: Vec<ProposalView>| list.iter().map(|p| p.id).collect::<Vec<u64>>();
    let all = ids(contract.get_proposals(None, None));
    assert_eq!(all.len(), 50);
    assert_eq!((all[0], all[49]), (55, 6));
    assert_eq!(
        ids(contract.get_proposals(Some(0), Some(3))),
        vec![55, 54, 53]
    );
    assert_eq!(
        ids(contract.get_proposals(Some(52), Some(10))),
        vec![3, 2, 1]
    );
    assert_eq!(
        ids(contract.get_proposals(Some(55), None)),
        Vec::<u64>::new()
    );
    assert_eq!(
        ids(contract.get_proposals(Some(1000), None)),
        Vec::<u64>::new()
    );
    assert_eq!(contract.get_proposals(None, Some(500)).len(), 50);
}

#[test]
fn hex_round_trips() {
    let bytes: [u8; 32] = core::array::from_fn(|i| (i * 8) as u8);
    assert_eq!(from_hex32(&to_hex(&bytes)), Some(bytes));
    assert_eq!(from_hex32(&"g".repeat(64)), None);
    assert_eq!(from_hex32(&"0".repeat(63)), None);
}
