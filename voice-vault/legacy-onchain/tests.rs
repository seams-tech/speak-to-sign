//! Unit tests with `testing_env`: the refusal paths and one happy path.

use near_sdk::base64::engine::general_purpose::URL_SAFE_NO_PAD;
use near_sdk::base64::Engine;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::mock::MockAction;
use near_sdk::{
    test_vm_config, testing_env, AccountId, Gas, NearToken, PromiseResult, RuntimeFeesConfig,
};
use spoken_intent::{render, request_digest, NearAmount, SpokenAccount, SpokenRequestV1};

use super::*;
use crate::state::{PendingTransfer, CONTACT_DELAY_NS, DAY_NS};
use crate::verdict::VerifierReason;

const RELAY: &str = "relay.seams.example";
const T0: u64 = 1_000 * DAY_NS + 3_600 * 1_000_000_000;

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn vault_id() -> AccountId {
    id("voicevault.testnet")
}
fn owner() -> AccountId {
    id("owner.testnet")
}
fn alice() -> AccountId {
    id("alice.testnet")
}
fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

fn set_env(caller: &AccountId, deposit: NearToken, now: u64, results: Vec<PromiseResult>) {
    let context = VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(now)
        .build();
    testing_env!(context, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

fn call(caller: &AccountId, deposit: NearToken, now: u64) {
    set_env(caller, deposit, now, vec![]);
}

fn audio_digest() -> [u8; 32] {
    [7u8; 32]
}

fn audio() -> AudioRef {
    AudioRef {
        url: format!("https://{RELAY}/v1/blob/abc123"),
        digest: URL_SAFE_NO_PAD.encode(audio_digest()),
        bytes: 182_344,
    }
}

/// A vault with 10 NEAR and `alice.testnet` active.
fn setup() -> VoiceVault {
    // `testing_env!` keeps storage; start each vault from an empty trie.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    call(&id("deployer.testnet"), NearToken::from_yoctonear(0), T0);
    let mut contract = VoiceVault::new(
        id("outlayer.testnet"),
        "seams.testnet/voice-verifier".to_string(),
        "abc123def456".to_string(),
        URL_SAFE_NO_PAD.encode([9u8; 32]),
        RELAY.to_string(),
    )
    .unwrap();
    call(&owner(), near(10).saturating_add(STORAGE_RESERVE), T0);
    contract.create_vault().unwrap();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    contract.add_contact(alice()).unwrap();
    contract
}

fn active() -> u64 {
    T0 + CONTACT_DELAY_NS
}

fn request(contract: &mut VoiceVault, amount: NearToken, nonce: u64) -> Result<(), VaultError> {
    call(&owner(), MIN_EXECUTION_DEPOSIT, active());
    contract.request_transfer(alice(), U128(amount.as_yoctonear()), U64(nonce), audio()).map(drop)
}

fn pending(contract: &VoiceVault) -> PendingTransfer {
    contract.vaults.get(&owner()).unwrap().pending_transfer.clone().unwrap()
}

fn balance(contract: &VoiceVault) -> NearToken {
    contract.vaults.get(&owner()).unwrap().balance
}

fn verdict_for(p: &PendingTransfer) -> Value {
    json!({
        "kind": "seams_voice_verdict_v1",
        "renderer": "spoken-intent/1",
        "verifier": "0.1.0",
        "request_id": p.request_id.to_string(),
        "request_digest": URL_SAFE_NO_PAD.encode(p.request_digest),
        "spoken_text_digest": URL_SAFE_NO_PAD.encode(p.spoken_text_digest),
        "audio_digest": URL_SAFE_NO_PAD.encode(p.audio.digest),
        "template_epoch": p.template_epoch,
        "outcome": "accept",
        "reason": null,
        "speaker_score_milli": 612,
        "word_margin_milli": 214,
        "heard": "send two near to alice dot testnet",
    })
}

fn deliver(contract: &mut VoiceVault, result: PromiseResult) -> TransferOutcome {
    let p = pending(contract);
    set_env(&vault_id(), NearToken::from_yoctonear(0), active() + 10, vec![result]);
    contract.on_transfer_verdict(owner(), U64(p.request_id))
}

fn ok(value: Value) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&value).unwrap())
}

fn transfers() -> Vec<(AccountId, NearToken)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((receiver.clone(), deposit)),
                _ => None,
            })
        })
        .collect()
}

#[test]
fn happy_path_pays_on_matching_accept() {
    let mut contract = setup();
    request(&mut contract, near(2), 0).unwrap();

    // The OutLayer call: pinned project and version, the deposit, input from state.
    let receipts = get_created_receipts();
    let call = receipts.iter().find(|r| r.receiver_id == id("outlayer.testnet")).unwrap();
    let MockAction::FunctionCallWeight { method_name, args, attached_deposit, prepaid_gas, .. } = &call.actions[0]
    else {
        panic!("expected a function call");
    };
    assert_eq!(method_name, b"request_execution");
    assert_eq!(*attached_deposit, MIN_EXECUTION_DEPOSIT);
    assert_eq!(*prepaid_gas, REQUEST_EXECUTION_GAS);
    let args: Value = serde_json::from_slice(args).unwrap();
    assert_eq!(args["source"]["Project"]["project_id"], "seams.testnet/voice-verifier");
    assert_eq!(args["source"]["Project"]["version_key"], "abc123def456");
    assert_eq!(args["payer_account_id"], "owner.testnet");
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(input["subject"], "owner.testnet");
    assert_eq!(input["request_id"], "0");
    assert_eq!(input["contacts"], json!(["alice.testnet"]));
    assert_eq!(input["audio"]["url"], audio().url);
    let request_bytes = URL_SAFE_NO_PAD.decode(input["request"].as_str().unwrap()).unwrap();
    let request: SpokenRequestV1 = near_sdk::borsh::from_slice(&request_bytes).unwrap();
    let expected = SpokenRequestV1::VaultTransfer {
        network: NETWORK,
        vault: SpokenAccount::new("voicevault.testnet").unwrap(),
        owner: SpokenAccount::new("owner.testnet").unwrap(),
        receiver: SpokenAccount::new("alice.testnet").unwrap(),
        amount: NearAmount::from_yocto(near(2).as_yoctonear()).unwrap(),
        nonce: 0,
    };
    assert_eq!(request, expected);
    assert_eq!(render(&request).spoken_text, "send two near to alice dot testnet");
    assert_eq!(pending(&contract).request_digest, request_digest(&expected));
    assert_eq!(balance(&contract), near(8));

    let verdict = verdict_for(&pending(&contract));
    let outcome = deliver(&mut contract, ok(verdict));
    assert_eq!(outcome, TransferOutcome { request_id: U64(0), sent: true, reason: None });
    assert_eq!(transfers(), vec![(alice(), near(2))]);
    let vault = contract.vaults.get(&owner()).unwrap();
    assert!(vault.pending_transfer.is_none());
    assert_eq!(vault.balance, near(8));
    assert_eq!(vault.next_nonce, 1);
}

/// Every refusal deletes the pending record, returns the reservation and
/// the daily allowance, keeps the nonce used and sends nothing.
fn assert_refused(build: impl Fn(&PendingTransfer) -> PromiseResult, reason: &str) {
    let mut contract = setup();
    request(&mut contract, near(2), 0).unwrap();
    let result = build(&pending(&contract));
    let outcome = deliver(&mut contract, result);
    assert!(!outcome.sent, "{reason}");
    assert_eq!(outcome.reason.as_deref(), Some(reason));
    assert!(transfers().is_empty(), "{reason}");
    let vault = contract.vaults.get(&owner()).unwrap();
    assert!(vault.pending_transfer.is_none());
    assert_eq!(vault.balance, near(10));
    assert_eq!(vault.spent.amount, NearToken::from_yoctonear(0));
    assert_eq!(vault.next_nonce, 1);
}

fn with(p: &PendingTransfer, field: &str, value: Value) -> PromiseResult {
    let mut verdict = verdict_for(p);
    verdict[field] = value;
    ok(verdict)
}

#[test]
fn null_promise_error_and_garbage_are_refusals() {
    assert_refused(|_| ok(Value::Null), "no_verdict");
    assert_refused(|_| PromiseResult::Failed, "promise_error");
    assert_refused(|_| PromiseResult::Successful(b"not json".to_vec()), "malformed_verdict");
    assert_refused(|_| ok(json!("accept")), "malformed_verdict");
    assert_refused(|_| ok(json!({ "outcome": "accept" })), "malformed_verdict");
}

#[test]
fn malformed_verdicts_are_refusals() {
    assert_refused(|p| with(p, "kind", json!("seams_voice_verdict_v2")), "malformed_verdict");
    assert_refused(|p| with(p, "renderer", json!("spoken-intent/2")), "malformed_verdict");
    assert_refused(|p| with(p, "reason", json!("words")), "malformed_verdict");
    assert_refused(|p| with(p, "outcome", json!("maybe")), "malformed_verdict");
    assert_refused(|p| with(p, "request_id", json!(0)), "malformed_verdict");
    assert_refused(|p| with(p, "request_id", json!("00")), "malformed_verdict");
    assert_refused(|p| with(p, "audio_digest", json!("AAAA")), "malformed_verdict");
    assert_refused(|p| with(p, "extra", json!(1)), "malformed_verdict");
    assert_refused(|p| with(p, "outcome", json!("refuse")), "malformed_verdict");
}

#[test]
fn mismatched_verdicts_are_refusals() {
    let other = URL_SAFE_NO_PAD.encode([1u8; 32]);
    assert_refused(|p| with(p, "request_id", json!("1")), "verdict_mismatch");
    assert_refused(|p| with(p, "request_digest", json!(other)), "verdict_mismatch");
    assert_refused(|p| with(p, "spoken_text_digest", json!(other)), "verdict_mismatch");
    assert_refused(|p| with(p, "audio_digest", json!(other)), "verdict_mismatch");
    assert_refused(|p| with(p, "template_epoch", json!(2)), "verdict_mismatch");
}

#[test]
fn one_wire_shape() {
    // Every field must be present, also when null.
    for field in ["heard", "speaker_score_milli", "word_margin_milli", "reason", "request_digest"] {
        assert_refused(
            |p| {
                let mut verdict = verdict_for(p);
                verdict.as_object_mut().unwrap().remove(field);
                ok(verdict)
            },
            "malformed_verdict",
        );
    }
    // An accept must name every binding field.
    for field in ["request_id", "request_digest", "spoken_text_digest", "audio_digest", "template_epoch"] {
        assert_refused(|p| with(p, field, Value::Null), "malformed_verdict");
    }
    // A refusal may leave a binding field null; a present one must be well
    // formed and must match.
    let refusal = |p: &PendingTransfer, field: &str, value: Value| {
        let mut verdict = verdict_for(p);
        verdict["outcome"] = json!("refuse");
        verdict["reason"] = json!("transcriber_unavailable");
        verdict[field] = value;
        ok(verdict)
    };
    for field in ["request_id", "request_digest", "spoken_text_digest", "audio_digest", "template_epoch"] {
        assert_refused(|p| refusal(p, field, Value::Null), "transcriber_unavailable");
    }
    assert_refused(|p| refusal(p, "audio_digest", json!("AAAA")), "malformed_verdict");
    assert_refused(|p| refusal(p, "request_id", json!("1")), "verdict_mismatch");
    assert_refused(|p| refusal(p, "reason", json!("aurora_down")), "malformed_verdict");
}

/// The verdict vector that the verifier's tests also read.
const VERDICT_VECTORS: &str = include_str!("../../voice-verifier/testdata/verdict_vectors.json");

#[test]
fn shared_verdict_vectors() {
    let file: Value = serde_json::from_str(VERDICT_VECTORS).unwrap();
    let spec = &file["request"];
    let cases = file["verdicts"].as_array().unwrap();
    assert_eq!(cases.len(), 13);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut contract = setup();
        assert_eq!(vault_id(), spec["vault"].as_str().unwrap());
        assert_eq!(owner(), spec["owner"].as_str().unwrap());
        assert_eq!(alice(), spec["receiver"].as_str().unwrap());
        let amount = NearToken::from_yoctonear(spec["amount_yocto"].as_str().unwrap().parse().unwrap());
        assert_eq!(audio_digest(), [spec["audio_digest_fill_byte"].as_u64().unwrap() as u8; 32]);
        request(&mut contract, amount, spec["nonce"].as_u64().unwrap()).unwrap();

        // The vector's binding fields are this vault's pending request.
        let p = pending(&contract);
        assert_eq!(file["request_id"], p.request_id.to_string());
        assert_eq!(file["request_digest"], URL_SAFE_NO_PAD.encode(p.request_digest));
        assert_eq!(file["spoken_text_digest"], URL_SAFE_NO_PAD.encode(p.spoken_text_digest));
        assert_eq!(file["audio_digest"], URL_SAFE_NO_PAD.encode(p.audio.digest));
        assert_eq!(file["template_epoch"], p.template_epoch);

        let outcome = deliver(&mut contract, ok(case["verdict"].clone()));
        assert_eq!(outcome.reason.as_deref(), case["vault_reason"].as_str(), "{name}");
        assert_eq!(outcome.sent, case["vault_reason"].is_null(), "{name}");
        let vault = contract.vaults.get(&owner()).unwrap();
        assert!(vault.pending_transfer.is_none(), "{name}");
        let expected_balance = if outcome.sent { near(10).saturating_sub(amount) } else { near(10) };
        assert_eq!(vault.balance, expected_balance, "{name}");
    }
    // Each reason of the vault's list has one vector, and no other reason is valid.
    let mut names: Vec<&str> = cases.iter().filter_map(|case| case["vault_reason"].as_str()).collect();
    names.sort_unstable();
    let mut listed: Vec<&str> = [
        VerifierReason::Quality,
        VerifierReason::Speaker,
        VerifierReason::Words,
        VerifierReason::AudioReused,
        VerifierReason::AudioUnavailable,
        VerifierReason::AudioInvalid,
        VerifierReason::TemplateMissing,
        VerifierReason::Unsupported,
        VerifierReason::ModelUnavailable,
        VerifierReason::Storage,
        VerifierReason::TemplateExists,
        VerifierReason::TranscriberUnavailable,
    ]
    .iter()
    .map(|reason| reason.as_str())
    .collect();
    listed.sort_unstable();
    assert_eq!(names, listed);
}

#[test]
fn verifier_refusal_is_a_refusal() {
    assert_refused(
        |p| {
            let mut verdict = verdict_for(p);
            verdict["outcome"] = json!("refuse");
            verdict["reason"] = json!("words");
            ok(verdict)
        },
        "words",
    );
}

#[test]
fn removed_contact_is_not_paid() {
    let mut contract = setup();
    request(&mut contract, near(2), 0).unwrap();
    contract.remove_contact(alice()).unwrap();
    let verdict = verdict_for(&pending(&contract));
    let outcome = deliver(&mut contract, ok(verdict));
    assert_eq!(outcome.reason.as_deref(), Some("contact_removed"));
    assert!(transfers().is_empty());
    assert_eq!(balance(&contract), near(10));
}

#[test]
fn stale_callback_after_cancel_pays_nothing() {
    let mut contract = setup();
    request(&mut contract, near(2), 0).unwrap();
    let p = pending(&contract);
    call(&owner(), NearToken::from_yoctonear(0), active() + 60 * 1_000_000_000);
    assert_eq!(contract.cancel_stale_transfer(), Err(VaultError::TransferNotStale));
    call(&owner(), NearToken::from_yoctonear(0), active() + STALE_TRANSFER_NS);
    contract.cancel_stale_transfer().unwrap();
    assert_eq!(balance(&contract), near(10));
    set_env(&vault_id(), NearToken::from_yoctonear(0), active() + STALE_TRANSFER_NS, vec![ok(verdict_for(&p))]);
    let outcome = contract.on_transfer_verdict(owner(), U64(p.request_id));
    assert_eq!(outcome.reason.as_deref(), Some("no_pending_request"));
    assert!(transfers().is_empty());
    assert_eq!(balance(&contract), near(10));
}

#[test]
fn failed_payout_returns_funds() {
    let mut contract = setup();
    request(&mut contract, near(2), 0).unwrap();
    let verdict = verdict_for(&pending(&contract));
    assert!(deliver(&mut contract, ok(verdict)).sent);
    assert_eq!(balance(&contract), near(8));
    set_env(&vault_id(), NearToken::from_yoctonear(0), active() + 20, vec![PromiseResult::Failed]);
    assert!(!contract.on_payout_settled(owner(), U128(near(2).as_yoctonear()), Some(U64(active() / DAY_NS))));
    let vault = contract.vaults.get(&owner()).unwrap();
    assert_eq!(vault.balance, near(10));
    assert_eq!(vault.spent.amount, NearToken::from_yoctonear(0));
}

#[test]
fn sound_alike_and_unspeakable_contacts_are_refused() {
    let mut contract = setup();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    assert_eq!(contract.add_contact(id("alicia.testnet")), Err(VaultError::SoundsLikeContact));
    assert_eq!(contract.add_contact(id("alise.testnet")), Err(VaultError::SoundsLikeContact));
    assert_eq!(contract.add_contact(alice()), Err(VaultError::ContactExists));
    assert_eq!(contract.add_contact(owner()), Err(VaultError::BadContact));
    let implicit = id(&"a".repeat(64));
    assert_eq!(contract.add_contact(implicit), Err(VaultError::AccountNotSpeakable));
    assert!(contract.add_contact(id("payroll.testnet")).is_ok());
}

#[test]
fn contact_in_its_delay_cannot_receive() {
    let mut contract = setup();
    call(&owner(), MIN_EXECUTION_DEPOSIT, active() - 1);
    let result = contract.request_transfer(alice(), U128(near(1).as_yoctonear()), U64(0), audio());
    assert_eq!(result.err(), Some(VaultError::ContactNotActive));
    call(&owner(), MIN_EXECUTION_DEPOSIT, active());
    let result = contract.request_transfer(id("bob.testnet"), U128(near(1).as_yoctonear()), U64(0), audio());
    assert_eq!(result.err(), Some(VaultError::NotAContact));
}

#[test]
fn limits_nonce_and_pending_slot() {
    let mut contract = setup();
    assert_eq!(request(&mut contract, near(6), 0), Err(VaultError::OverTransferLimit));
    assert_eq!(request(&mut contract, NearToken::from_millinear(1), 0), Err(VaultError::AmountNotSpeakable));
    assert_eq!(request(&mut contract, near(1), 1), Err(VaultError::BadNonce));
    request(&mut contract, near(5), 0).unwrap();
    assert_eq!(request(&mut contract, near(1), 1), Err(VaultError::TransferPending));
    let verdict = verdict_for(&pending(&contract));
    assert!(deliver(&mut contract, ok(verdict)).sent);
    assert_eq!(request(&mut contract, near(1), 0), Err(VaultError::BadNonce));

    // A raise to (16, 100) waits for its delay; until then (5, 20) holds.
    call(&owner(), near(20), active());
    contract.deposit().unwrap();
    let effective_at = contract
        .set_limits(U128(near(16).as_yoctonear()), U128(near(100).as_yoctonear()))
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(request(&mut contract, near(6), 1), Err(VaultError::OverTransferLimit));
    for nonce in 1..=3 {
        request(&mut contract, near(5), nonce).unwrap();
        let verdict = verdict_for(&pending(&contract));
        assert!(deliver(&mut contract, ok(verdict)).sent);
    }
    assert_eq!(request(&mut contract, NearToken::from_millinear(10), 4), Err(VaultError::OverDailyLimit));
    call(&owner(), MIN_EXECUTION_DEPOSIT, effective_at);
    let raised = contract.request_transfer(alice(), U128(near(6).as_yoctonear()), U64(4), audio());
    assert!(raised.is_ok());
    drop(raised);

    // A lower limit applies at once.
    call(&owner(), NearToken::from_yoctonear(0), effective_at);
    assert_eq!(contract.set_limits(U128(near(1).as_yoctonear()), U128(near(2).as_yoctonear())), Ok(None));
    assert_eq!(contract.set_limits(U128(near(3).as_yoctonear()), U128(near(2).as_yoctonear())), Err(VaultError::InvalidLimits));
}

#[test]
fn bad_audio_gas_and_deposit_are_refused() {
    let mut contract = setup();
    let send = |contract: &mut VoiceVault, audio: AudioRef| {
        call(&owner(), MIN_EXECUTION_DEPOSIT, active());
        contract.request_transfer(alice(), U128(near(1).as_yoctonear()), U64(0), audio).err()
    };
    for url in [
        format!("https://{RELAY}.evil.example/x"),
        format!("https://{RELAY}:8443/x"),
        format!("http://{RELAY}/x"),
        format!("https://{RELAY}/x?y=\"z\""),
        format!("https://{RELAY}/"),
    ] {
        assert_eq!(send(&mut contract, AudioRef { url, ..audio() }), Some(VaultError::BadAudioUrl));
    }
    let digest = URL_SAFE_NO_PAD.encode([1u8; 31]);
    assert_eq!(send(&mut contract, AudioRef { digest, ..audio() }), Some(VaultError::BadAudioDigest));
    assert_eq!(send(&mut contract, AudioRef { bytes: MAX_AUDIO_BYTES + 1, ..audio() }), Some(VaultError::BadAudioSize));

    call(&owner(), NearToken::from_millinear(9), active());
    let result = contract.request_transfer(alice(), U128(near(1).as_yoctonear()), U64(0), audio());
    assert_eq!(result.err(), Some(VaultError::ExecutionDepositTooLow));
    let context = VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(owner())
        .attached_deposit(MIN_EXECUTION_DEPOSIT)
        .prepaid_gas(Gas::from_tgas(250))
        .block_timestamp(active())
        .build();
    testing_env!(context);
    let result = contract.request_transfer(alice(), U128(near(1).as_yoctonear()), U64(0), audio());
    assert_eq!(result.err(), Some(VaultError::NotEnoughGas));
    assert!(contract.vaults.get(&owner()).unwrap().pending_transfer.is_none());
}

#[test]
fn withdrawal_waits_for_its_delay() {
    let mut contract = setup();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    assert_eq!(contract.request_withdrawal(U128(near(11).as_yoctonear())), Err(VaultError::InsufficientBalance));
    let ready = contract.request_withdrawal(U128(near(4).as_yoctonear())).unwrap().0;
    assert_eq!(balance(&contract), near(6));
    call(&owner(), NearToken::from_yoctonear(0), ready - 1);
    assert_eq!(contract.complete_withdrawal().err(), Some(VaultError::WithdrawalNotReady));
    call(&owner(), NearToken::from_yoctonear(0), ready);
    drop(contract.complete_withdrawal().unwrap());
    assert_eq!(transfers(), vec![(owner(), near(4))]);
    assert_eq!(balance(&contract), near(6));
}

#[test]
fn other_accounts_have_no_vault() {
    let mut contract = setup();
    call(&alice(), MIN_EXECUTION_DEPOSIT, active());
    let result = contract.request_transfer(alice(), U128(near(1).as_yoctonear()), U64(0), audio());
    assert_eq!(result.err(), Some(VaultError::NoVault));
    call(&alice(), NearToken::from_yoctonear(0), active());
    assert_eq!(contract.request_withdrawal(U128(1)), Err(VaultError::NoVault));
}
