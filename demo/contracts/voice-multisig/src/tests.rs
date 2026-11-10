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
/// 0.01 NEAR.
const AMOUNT: u128 = ONE_HUNDREDTH_NEAR;
/// 0.05 NEAR, the cap of the test multisig.
const CAP: u128 = 5 * ONE_HUNDREDTH_NEAR;
const RECEIVER: &str = "grants.testnet";
const MULTISIG: &str = "team.testnet";
/// The proposer of most tests. It is not an admin.
const VISITOR: &str = "visitor";

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

fn new_with(admins: &[&str], key: &str, cap: u128) -> VoiceMultisig {
    context(multisig_id(), vec![]);
    VoiceMultisig::new(
        admins.iter().map(|admin| account(admin)).collect(),
        key.into(),
        U128(cap),
    )
}

/// Admins admin-a and admin-b; a cap of 0.05 NEAR.
fn contract() -> VoiceMultisig {
    new_with(
        &["admin-a", "admin-b"],
        &verifier_public_key(&verifier()),
        CAP,
    )
}

fn transfer(receiver: &str, amount: u128) -> ProposalV1 {
    ProposalV1::Transfer {
        receiver: SpokenAccount::new(receiver).unwrap(),
        amount: NearAmount::from_yocto(amount).unwrap(),
    }
}

fn commitment_of(proposal_id: u64, amount: u128) -> [u8; 32] {
    multisig_commitment(
        &NearAccount::new(MULTISIG).unwrap(),
        proposal_id,
        &transfer(RECEIVER, amount),
        &SALT,
    )
}

/// The commitment of 0.01 NEAR to grants.testnet.
fn commitment(proposal_id: u64) -> [u8; 32] {
    commitment_of(proposal_id, AMOUNT)
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
        r#"{{"kind":"seams_voice_signed_verdict_v2","renderer":"spoken-intent/1","verifier":"0.6.0","request_digest":{digest},"spoken_text_digest":"mXyNIbv5LxxXrBYm8D7wwAzrBHu_o3XI0GAGdf5GNys","audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","outcome":"{outcome}","reason":{reason},"policy_rule":{policy_rule},"expires_at_ms":{expires_at_ms},"speaker_score_milli":655,"word_margin_milli":142,"heard":"approve proposal one send zero point zero one near to grants dot testnet"}}"#
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

fn propose_with(
    contract: &mut VoiceMultisig,
    who: &str,
    proposal_id: u64,
    commitment: &[u8; 32],
) -> u64 {
    set_caller(who);
    let (json, signature) = approval(who, proposal_id, commitment);
    contract.propose(proposal_id, to_hex(commitment), json, signature)
}

fn propose_as(contract: &mut VoiceMultisig, who: &str, proposal_id: u64) -> u64 {
    propose_with(contract, who, proposal_id, &commitment(proposal_id))
}

fn approve_as(contract: &mut VoiceMultisig, who: &str, proposal_id: u64) -> u32 {
    set_caller(who);
    contract.approve(proposal_id)
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

/// Proposal 1 by the visitor, approved by both admins: ready to execute.
fn ready() -> VoiceMultisig {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    approve_as(&mut contract, "admin-a", 1);
    approve_as(&mut contract, "admin-b", 1);
    contract
}

// --- the full flow ---

#[test]
fn propose_approve_execute_sends_the_transfer() {
    let mut contract = contract();
    assert_eq!(contract.next_proposal_id(), 1);

    assert_eq!(propose_as(&mut contract, VISITOR, 1), 1);
    assert_eq!(contract.next_proposal_id(), 2);
    assert_eq!(
        get_logs(),
        vec![format!(
            r#"EVENT_JSON:{{"standard":"voice_multisig","version":"2.0.0","event":"proposed","data":[{{"proposal_id":1,"commitment_hex":"{}","proposer":"visitor.testnet"}}]}}"#,
            to_hex(&commitment(1))
        )]
    );

    assert_eq!(approve_as(&mut contract, "admin-a", 1), 1);
    assert_eq!(
        get_logs(),
        vec![
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"approved","data":[{"proposal_id":1,"admin":"admin-a.testnet","approvals":1}]}"#
        ]
    );
    assert_eq!(approve_as(&mut contract, "admin-b", 1), 2);
    assert_eq!(
        get_logs(),
        vec![
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"approved","data":[{"proposal_id":1,"admin":"admin-b.testnet","approvals":2}]}"#
        ]
    );

    execute_as(&mut contract, "admin-b", 1, AMOUNT, &SALT);
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
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"executed","data":[{"proposal_id":1,"receiver":"grants.testnet","amount_yocto":"10000000000000000000000"}]}"#
        ]
    );
    assert_eq!(
        serde_json::to_value(contract.get_proposal(1).unwrap()).unwrap(),
        json!({
            "id": 1,
            "commitment_hex": to_hex(&commitment(1)),
            "proposer": "visitor.testnet",
            "approvals": ["admin-a.testnet", "admin-b.testnet"],
            "status": "executed",
            "created_at_ms": NOW_MS,
            "receiver": "grants.testnet",
            "amount_yocto": "10000000000000000000000"
        })
    );
}

#[test]
fn the_proposer_can_execute() {
    let mut contract = ready();
    execute_as(&mut contract, VISITOR, 1, AMOUNT, &SALT);
    assert_eq!(contract.get_proposal(1).unwrap().status, Status::Executed);
}

#[test]
fn a_failed_transfer_opens_the_proposal_again() {
    let mut contract = ready();
    execute_as(&mut contract, "admin-b", 1, AMOUNT, &SALT);
    assert!(!finish_transfer(&mut contract, 1, PromiseResult::Failed));
    assert_eq!(
        get_logs(),
        vec![
            r#"EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"execute_failed","data":[{"proposal_id":1}]}"#
        ]
    );
    let view = contract.get_proposal(1).unwrap();
    assert_eq!(view.status, Status::Open);
    assert_eq!(view.receiver, None);
    assert_eq!(view.amount_yocto, None);
    assert_eq!(
        view.approvals,
        vec![account("admin-a"), account("admin-b")],
        "the approvals stay"
    );

    // The proposer can try again without new approvals.
    execute_as(&mut contract, VISITOR, 1, AMOUNT, &SALT);
    assert!(finish_transfer(
        &mut contract,
        1,
        PromiseResult::Successful(vec![])
    ));
    assert_eq!(contract.get_proposal(1).unwrap().status, Status::Executed);
}

#[test]
fn one_admin_approves_and_executes() {
    let mut contract = new_with(&["admin-a"], &verifier_public_key(&verifier()), CAP);
    propose_as(&mut contract, VISITOR, 1);
    assert_eq!(approve_as(&mut contract, "admin-a", 1), 1);
    execute_as(&mut contract, "admin-a", 1, AMOUNT, &SALT);
    assert_eq!(contract.get_proposal(1).unwrap().status, Status::Executed);
}

#[test]
fn a_verdict_that_expires_at_the_block_time_passes() {
    let mut contract = contract();
    set_caller(VISITOR);
    let json = verdict(
        Some(&digest(VISITOR, MULTISIG, 1, &commitment(1))),
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
    set_caller(VISITOR);
    let (json, _) = approval(VISITOR, 1, &commitment(1));
    let (_, other_signature) = approval("guest", 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)), json, other_signature);
}

#[test]
#[should_panic(expected = "the verdict signature does not match the verifier key")]
fn a_changed_verdict_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = approval(VISITOR, 1, &commitment(1));
    let changed = json.replace("\"speaker_score_milli\":655", "\"speaker_score_milli\":999");
    contract.propose(1, to_hex(&commitment(1)), changed, signature);
}

#[test]
#[should_panic(expected = "the verdict signature does not match the verifier key")]
fn a_verdict_of_another_key_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let json = verdict(
        Some(&digest(VISITOR, MULTISIG, 1, &commitment(1))),
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
    set_caller(VISITOR);
    let (json, _) = approval(VISITOR, 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)), json, STANDARD.encode([1u8; 63]));
}

#[test]
#[should_panic(expected = "signature_b64 must be standard base64 of 64 bytes")]
fn a_base64url_signature_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = approval(VISITOR, 1, &commitment(1));
    let base64url = URL_SAFE_NO_PAD.encode(STANDARD.decode(signature).unwrap());
    // Make sure the text differs from standard base64.
    let base64url = format!("{base64url}-_");
    contract.propose(1, to_hex(&commitment(1)), json, base64url);
}

#[test]
#[should_panic(expected = "the verdict outcome must be accept")]
fn a_refuse_verdict_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = signed(&digest(VISITOR, MULTISIG, 1, &commitment(1)), "refuse");
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict outcome must be accept")]
fn a_step_up_verdict_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = signed(&digest(VISITOR, MULTISIG, 1, &commitment(1)), "step_up");
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict has expired")]
fn an_expired_verdict_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let json = verdict(
        Some(&digest(VISITOR, MULTISIG, 1, &commitment(1))),
        "accept",
        NOW_MS - 1,
    );
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_of_another_account_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = approval("guest", 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_commitment_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let other = multisig_commitment(
        &NearAccount::new(MULTISIG).unwrap(),
        1,
        &transfer("attacker.testnet", AMOUNT),
        &SALT,
    );
    let (json, signature) = approval(VISITOR, 1, &other);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_proposal_id_fails() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    set_caller(VISITOR);
    // A verdict for proposal 1 with the commitment of proposal 2.
    let (json, signature) = approval(VISITOR, 1, &commitment(2));
    contract.propose(2, to_hex(&commitment(2)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn a_verdict_for_another_multisig_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = signed(
        &digest(VISITOR, "other.testnet", 1, &commitment(1)),
        "accept",
    );
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict is for another request")]
fn an_accept_verdict_without_a_digest_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let json = verdict(None, "accept", NOW_MS + TTL_MS);
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "the verdict kind must be seams_voice_signed_verdict_v2")]
fn a_verdict_of_another_kind_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, _) = approval(VISITOR, 1, &commitment(1));
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
    set_caller(VISITOR);
    let (json, _) = approval(VISITOR, 1, &commitment(1));
    let json = json.replace(r#","heard":"#, r#","extra":1,"heard":"#);
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "verdict_json is not a verdict: missing field `heard`")]
fn a_verdict_without_a_field_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, _) = approval(VISITOR, 1, &commitment(1));
    let start = json.find(r#","heard":"#).unwrap();
    let json = format!("{}}}", &json[..start]);
    let signature = sign(&verifier(), &json);
    contract.propose(1, to_hex(&commitment(1)), json, signature);
}

#[test]
#[should_panic(expected = "verdict_json is not a verdict: missing field `request_digest`")]
fn a_verdict_without_the_digest_field_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
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
    let mut contract = new_with(
        &["admin-a", "admin-b"],
        vectors["public_key"].as_str().unwrap(),
        CAP,
    );
    set_caller(VISITOR);
    contract.propose(
        1,
        to_hex(&commitment(1)),
        accept["verdict_json"].as_str().unwrap().into(),
        accept["signature_b64"].as_str().unwrap().into(),
    );
}

// --- propose ---

#[test]
fn any_account_that_is_not_an_admin_can_propose() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    propose_as(&mut contract, "guest", 2);
    assert_eq!(contract.get_proposal(1).unwrap().proposer, account(VISITOR));
    assert_eq!(contract.get_proposal(2).unwrap().proposer, account("guest"));
}

#[test]
#[should_panic(expected = "an admin cannot propose")]
fn an_admin_cannot_propose() {
    let mut contract = contract();
    propose_as(&mut contract, "admin-a", 1);
}

#[test]
#[should_panic(expected = "proposal_id must be next_proposal_id, 1")]
fn propose_with_another_id_fails() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 2);
}

#[test]
#[should_panic(expected = "proposal_id must be next_proposal_id, 2")]
fn propose_with_a_used_id_fails() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    propose_as(&mut contract, "guest", 1);
}

#[test]
#[should_panic(expected = "commitment_hex must be 64 lowercase hex characters")]
fn an_uppercase_commitment_fails() {
    let mut contract = contract();
    set_caller(VISITOR);
    let (json, signature) = approval(VISITOR, 1, &commitment(1));
    contract.propose(1, to_hex(&commitment(1)).to_uppercase(), json, signature);
}

// --- approve ---

#[test]
#[should_panic(expected = "the caller is not an admin")]
fn a_stranger_cannot_approve() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    approve_as(&mut contract, "mallory", 1);
}

#[test]
#[should_panic(expected = "the caller is not an admin")]
fn the_proposer_cannot_approve() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    approve_as(&mut contract, VISITOR, 1);
}

#[test]
#[should_panic(expected = "this admin already approved the proposal")]
fn a_second_approve_by_one_admin_fails() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    approve_as(&mut contract, "admin-a", 1);
    approve_as(&mut contract, "admin-a", 1);
}

#[test]
#[should_panic(expected = "no proposal has this id")]
fn approve_of_an_unknown_proposal_fails() {
    let mut contract = contract();
    approve_as(&mut contract, "admin-a", 1);
}

#[test]
#[should_panic(expected = "the proposal is already executed")]
fn approve_after_execute_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "admin-b", 1, AMOUNT, &SALT);
    approve_as(&mut contract, "admin-a", 1);
}

// --- execute ---

#[test]
#[should_panic(expected = "the proposal has 0 of 2 admin approvals")]
fn execute_with_no_approvals_fails() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    execute_as(&mut contract, VISITOR, 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "the proposal has 1 of 2 admin approvals")]
fn execute_before_all_approvals_fails() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    approve_as(&mut contract, "admin-a", 1);
    execute_as(&mut contract, "admin-a", 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "only the proposer or an admin can execute the proposal")]
fn execute_by_a_stranger_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "mallory", 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "no proposal has this id")]
fn execute_of_an_unknown_proposal_fails() {
    let mut contract = contract();
    execute_as(&mut contract, "admin-a", 1, AMOUNT, &SALT);
}

#[test]
fn execute_at_the_cap_passes() {
    let mut contract = contract();
    propose_with(&mut contract, VISITOR, 1, &commitment_of(1, CAP));
    approve_as(&mut contract, "admin-a", 1);
    approve_as(&mut contract, "admin-b", 1);
    execute_as(&mut contract, "admin-b", 1, CAP, &SALT);
    assert!(matches!(
        get_created_receipts()[0].actions.as_slice(),
        [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == CAP
    ));
}

#[test]
#[should_panic(expected = "amount_yocto is above max_amount_yocto")]
fn execute_above_the_cap_fails() {
    let above = CAP + ONE_HUNDREDTH_NEAR;
    let mut contract = contract();
    propose_with(&mut contract, VISITOR, 1, &commitment_of(1, above));
    approve_as(&mut contract, "admin-a", 1);
    approve_as(&mut contract, "admin-b", 1);
    execute_as(&mut contract, "admin-b", 1, above, &SALT);
}

#[test]
#[should_panic(expected = "receiver, amount_yocto and salt_hex do not match the commitment")]
fn execute_with_a_wrong_salt_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "admin-b", 1, AMOUNT, &[0x5b; 32]);
}

#[test]
#[should_panic(expected = "receiver, amount_yocto and salt_hex do not match the commitment")]
fn execute_with_a_wrong_amount_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "admin-b", 1, AMOUNT * 2, &SALT);
}

#[test]
#[should_panic(expected = "receiver, amount_yocto and salt_hex do not match the commitment")]
fn execute_with_a_wrong_receiver_fails() {
    let mut contract = ready();
    set_caller("admin-b");
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
    execute_as(&mut contract, "admin-b", 1, AMOUNT + 1, &SALT);
}

#[test]
#[should_panic(expected = "receiver must be a named account that the grammar can speak")]
fn execute_to_an_implicit_account_fails() {
    let mut contract = ready();
    set_caller("admin-b");
    let implicit: AccountId = "a".repeat(64).parse().unwrap();
    drop(contract.execute(1, implicit, U128(AMOUNT), to_hex(&SALT)));
}

#[test]
#[should_panic(expected = "salt_hex must be 64 lowercase hex characters")]
fn execute_with_a_short_salt_fails() {
    let mut contract = ready();
    set_caller("admin-b");
    drop(contract.execute(1, RECEIVER.parse().unwrap(), U128(AMOUNT), "5a".into()));
}

#[test]
#[should_panic(expected = "the proposal is already executed")]
fn a_second_execute_fails_while_the_first_is_in_flight() {
    let mut contract = ready();
    execute_as(&mut contract, "admin-b", 1, AMOUNT, &SALT);
    execute_as(&mut contract, VISITOR, 1, AMOUNT, &SALT);
}

#[test]
#[should_panic(expected = "the proposal is already executed")]
fn execute_after_a_successful_transfer_fails() {
    let mut contract = ready();
    execute_as(&mut contract, "admin-b", 1, AMOUNT, &SALT);
    finish_transfer(&mut contract, 1, PromiseResult::Successful(vec![]));
    execute_as(&mut contract, "admin-b", 1, AMOUNT, &SALT);
}

// --- new ---

#[test]
#[should_panic(expected = "admins must have 1 to 10 accounts")]
fn no_admins_fail() {
    new_with(&[], &verifier_public_key(&verifier()), CAP);
}

#[test]
#[should_panic(expected = "admins must have 1 to 10 accounts")]
fn eleven_admins_fail() {
    let names: Vec<String> = (0..11).map(|n| format!("admin-{n}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    new_with(&names, &verifier_public_key(&verifier()), CAP);
}

#[test]
fn ten_admins_pass() {
    let names: Vec<String> = (0..10).map(|n| format!("admin-{n}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let contract = new_with(&names, &verifier_public_key(&verifier()), CAP);
    assert_eq!(contract.get_config().admins.len(), 10);
}

#[test]
#[should_panic(expected = "admins must be distinct")]
fn a_repeated_admin_fails() {
    new_with(
        &["admin-a", "admin-b", "admin-a"],
        &verifier_public_key(&verifier()),
        CAP,
    );
}

#[test]
#[should_panic(expected = "verifier_public_key must be ed25519:<base58 of 32 bytes>")]
fn a_secp256k1_verifier_key_fails() {
    let key = verifier_public_key(&verifier()).replace("ed25519:", "secp256k1:");
    new_with(&["admin-a"], &key, CAP);
}

#[test]
#[should_panic(expected = "verifier_public_key must be ed25519:<base58 of 32 bytes>")]
fn a_short_verifier_key_fails() {
    let key = format!(
        "ed25519:{}",
        near_sdk::bs58::encode([1u8; 31]).into_string()
    );
    new_with(&["admin-a"], &key, CAP);
}

#[test]
#[should_panic(expected = "max_amount_yocto must be a multiple of 0.01 NEAR, at least 0.01 NEAR")]
fn a_cap_of_0_fails() {
    new_with(&["admin-a"], &verifier_public_key(&verifier()), 0);
}

#[test]
#[should_panic(expected = "max_amount_yocto must be a multiple of 0.01 NEAR, at least 0.01 NEAR")]
fn a_cap_that_is_not_a_multiple_of_0_01_near_fails() {
    new_with(
        &["admin-a"],
        &verifier_public_key(&verifier()),
        ONE_HUNDREDTH_NEAR + ONE_HUNDREDTH_NEAR / 2,
    );
}

#[test]
fn a_cap_of_0_01_near_passes() {
    let contract = new_with(
        &["admin-a"],
        &verifier_public_key(&verifier()),
        ONE_HUNDREDTH_NEAR,
    );
    assert_eq!(
        contract.get_config().max_amount_yocto,
        U128(ONE_HUNDREDTH_NEAR)
    );
}

// --- views ---

#[test]
fn get_config_returns_the_admins_key_and_cap() {
    let contract = contract();
    assert_eq!(
        serde_json::to_value(contract.get_config()).unwrap(),
        json!({
            "admins": ["admin-a.testnet", "admin-b.testnet"],
            "verifier_public_key": verifier_public_key(&verifier()),
            "max_amount_yocto": "50000000000000000000000"
        })
    );
}

#[test]
fn an_open_proposal_has_no_receiver_or_amount() {
    let mut contract = contract();
    propose_as(&mut contract, VISITOR, 1);
    assert_eq!(
        serde_json::to_value(contract.get_proposal(1).unwrap()).unwrap(),
        json!({
            "id": 1,
            "commitment_hex": to_hex(&commitment(1)),
            "proposer": "visitor.testnet",
            "approvals": [],
            "status": "open",
            "created_at_ms": NOW_MS
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
        propose_as(&mut contract, VISITOR, id);
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
