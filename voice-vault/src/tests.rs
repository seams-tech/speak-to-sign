//! Unit tests with `testing_env`: the happy path on the shared signed vector,
//! and each refusal.

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use near_sdk::base64::Engine;
use near_sdk::json_types::{U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, Gas, NearToken};
use spoken_intent::{render, request_digest, spoken_text_digest, NearAmount, SpokenAccount, SpokenRequestV1};

use super::*;
use crate::state::DAY_NS;
use crate::verdict::verdict_message;

/// The shared vector, which `voice-verifier/tests/signed_vector.rs` writes
/// and checks with the verifier's own signing path.
const VECTOR: &str = include_str!("../../voice-verifier/testdata/signed_verdict_v1.json");
const T0: u64 = 1_000 * DAY_NS + 3_600 * 1_000_000_000;

fn vector() -> Value {
    serde_json::from_str(VECTOR).unwrap()
}
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

fn call(caller: &AccountId, deposit: NearToken, now: u64) {
    let context = VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(now)
        .build();
    testing_env!(context);
}

fn test_key() -> SigningKey {
    let seed: [u8; 32] = (0..32)
        .map(|i| u8::from_str_radix(&vector()["test_seed_hex"].as_str().unwrap()[i * 2..i * 2 + 2], 16).unwrap())
        .collect::<Vec<_>>()
        .try_into()
        .unwrap();
    SigningKey::from_bytes(&seed)
}

fn pinned_key() -> PublicKey {
    vector()["public_key"].as_str().unwrap().parse().unwrap()
}

/// A vault with 10 NEAR and `alice.testnet` active (contact delay 0).
fn setup_with(key: PublicKey, delay: Option<u64>) -> VoiceVault {
    // `testing_env!` keeps storage; start each vault from an empty trie.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    call(&id("deployer.testnet"), NearToken::from_yoctonear(0), T0);
    let mut contract = VoiceVault::new(key, delay).unwrap();
    call(&owner(), near(10).saturating_add(STORAGE_RESERVE), T0);
    contract.create_vault().unwrap();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    contract.add_contact(alice()).unwrap();
    contract
}

fn setup() -> VoiceVault {
    setup_with(pinned_key(), Some(0))
}

/// Signs verdict text with the vector's test key.
fn sign(text: &str) -> String {
    STANDARD.encode(test_key().sign(&verdict_message(text.as_bytes())).to_bytes())
}

/// An accept verdict for a transfer from this vault, as the verifier writes
/// it (field order matters only for the signed bytes).
fn verdict_for(receiver: &str, amount: NearToken, nonce: u64, audio_fill: u8) -> String {
    let account = |name: &str| SpokenAccount::new(name).unwrap();
    let request = SpokenRequestV1::VaultTransfer {
        network: NETWORK,
        vault: account("voicevault.testnet"),
        owner: account("owner.testnet"),
        receiver: account(receiver),
        amount: NearAmount::from_yocto(amount.as_yoctonear()).unwrap(),
        nonce,
    };
    let rendered = render(&request);
    format!(
        r#"{{"kind":"seams_voice_signed_verdict_v1","renderer":"spoken-intent/1","verifier":"0.2.0","request_digest":"{}","spoken_text_digest":"{}","audio_digest":"{}","outcome":"accept","reason":null,"speaker_score_milli":655,"word_margin_milli":142,"heard":"{}"}}"#,
        URL_SAFE_NO_PAD.encode(request_digest(&request)),
        URL_SAFE_NO_PAD.encode(spoken_text_digest(&rendered)),
        URL_SAFE_NO_PAD.encode([audio_fill; 32]),
        rendered.spoken_text,
    )
}

fn transfer(
    contract: &mut VoiceVault,
    receiver: AccountId,
    amount: NearToken,
    nonce: u64,
    text: &str,
    signature: &str,
) -> Result<(), VaultError> {
    call(&owner(), NearToken::from_yoctonear(0), T0 + 1);
    contract
        .transfer_with_verdict(receiver, U128(amount.as_yoctonear()), U64(nonce), text.to_string(), signature.to_string())
        .map(drop)
}

fn signed(contract: &mut VoiceVault, receiver: &str, amount: NearToken, nonce: u64, fill: u8) -> Result<(), VaultError> {
    let text = verdict_for(receiver, amount, nonce, fill);
    let signature = sign(&text);
    transfer(contract, id(receiver), amount, nonce, &text, &signature)
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

fn view(contract: &VoiceVault) -> VaultView {
    contract.get_vault(owner()).unwrap()
}

#[test]
fn shared_vector_pays_in_one_call() {
    let file = vector();
    let mut contract = setup();
    assert_eq!(contract.get_verifier().verifier_public_key, file["public_key"].as_str().unwrap());
    // The vault's own digests of the vector request equal the verifier's.
    let text = file["verdict_json"].as_str().unwrap();
    assert_eq!(text, verdict_for("alice.testnet", near(2), 0, 7), "same bytes as the verifier signs");
    assert_eq!(hex(&verdict_message(text.as_bytes())), file["message_sha256_hex"].as_str().unwrap());

    let before = view(&contract).balance.0;
    transfer(&mut contract, alice(), near(2), 0, text, file["signature_b64"].as_str().unwrap()).unwrap();
    assert_eq!(transfers(), [(alice(), near(2))]);
    let after = view(&contract);
    assert_eq!(after.next_nonce, U64(1));
    assert_eq!(after.spent_today, U128(near(2).as_yoctonear()));
    let fee = before - near(2).as_yoctonear() - after.balance.0;
    assert!(fee > 0 && fee < NearToken::from_millinear(2).as_yoctonear(), "storage fee {fee}");
    assert!(contract.is_audio_used(file["audio_digest"].as_str().unwrap().to_string()));
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn bad_signature() {
    let file = vector();
    let text = file["verdict_json"].as_str().unwrap();
    let good = file["signature_b64"].as_str().unwrap();
    let mut contract = setup();
    // Another byte in the signature.
    let mut bytes = STANDARD.decode(good).unwrap();
    bytes[5] ^= 1;
    assert_eq!(transfer(&mut contract, alice(), near(2), 0, text, &STANDARD.encode(&bytes)), Err(VaultError::BadSignature));
    // Not base64, or not 64 bytes.
    assert_eq!(transfer(&mut contract, alice(), near(2), 0, text, "!!"), Err(VaultError::BadSignature));
    assert_eq!(transfer(&mut contract, alice(), near(2), 0, text, &STANDARD.encode([1u8; 63])), Err(VaultError::BadSignature));
    // A changed verdict under the old signature.
    let changed = text.replace("655", "999");
    assert_eq!(transfer(&mut contract, alice(), near(2), 0, &changed, good), Err(VaultError::BadSignature));
    // A vault that pins another key.
    let other = SigningKey::from_bytes(&[9; 32]).verifying_key().to_bytes();
    let other_key = PublicKey::from_parts(near_sdk::CurveType::ED25519, other.to_vec()).unwrap();
    let mut contract = setup_with(other_key, Some(0));
    assert_eq!(transfer(&mut contract, alice(), near(2), 0, text, good), Err(VaultError::BadSignature));
    assert!(transfers().is_empty());
    assert_eq!(view(&contract).next_nonce, U64(0));
}

#[test]
fn wrong_digest() {
    let file = vector();
    let text = file["verdict_json"].as_str().unwrap();
    let good = file["signature_b64"].as_str().unwrap();
    let mut contract = setup();
    // A valid verdict for 2 NEAR, sent with another amount.
    assert_eq!(transfer(&mut contract, alice(), near(1), 0, text, good), Err(VaultError::VerdictMismatch));
    // A valid verdict for another vault.
    let mut contract = setup();
    let other_vault = text.replace(
        file["request_digest"].as_str().unwrap(),
        &URL_SAFE_NO_PAD.encode([3u8; 32]),
    );
    assert_eq!(
        transfer(&mut contract, alice(), near(2), 0, &other_vault, &sign(&other_vault)),
        Err(VaultError::VerdictMismatch)
    );
    assert!(transfers().is_empty());
}

#[test]
fn replayed_nonce() {
    let file = vector();
    let text = file["verdict_json"].as_str().unwrap();
    let good = file["signature_b64"].as_str().unwrap();
    let mut contract = setup();
    transfer(&mut contract, alice(), near(2), 0, text, good).unwrap();
    assert_eq!(transfer(&mut contract, alice(), near(2), 0, text, good), Err(VaultError::BadNonce));
    // A verdict for a future nonce is refused too.
    assert_eq!(signed(&mut contract, "alice.testnet", near(1), 5, 8), Err(VaultError::BadNonce));
}

#[test]
fn replayed_audio() {
    let mut contract = setup();
    signed(&mut contract, "alice.testnet", near(1), 0, 8).unwrap();
    // A new nonce with the same recording.
    assert_eq!(signed(&mut contract, "alice.testnet", near(1), 1, 8), Err(VaultError::AudioReused));
    // Another recording pays.
    signed(&mut contract, "alice.testnet", near(1), 1, 9).unwrap();
    assert_eq!(view(&contract).next_nonce, U64(2));
}

#[test]
fn non_contact() {
    let mut contract = setup();
    assert_eq!(signed(&mut contract, "bob.testnet", near(1), 0, 8), Err(VaultError::NotAContact));
    // A contact in its delay (default 120 s).
    let mut contract = setup_with(pinned_key(), None);
    assert_eq!(contract.get_verifier().contact_delay_seconds, U64(120));
    assert_eq!(signed(&mut contract, "alice.testnet", near(1), 0, 8), Err(VaultError::ContactNotActive));
    assert!(transfers().is_empty());
}

#[test]
fn over_limit() {
    let mut contract = setup();
    // Default limits: 5 NEAR per transfer, 20 NEAR per day.
    assert_eq!(signed(&mut contract, "alice.testnet", near(6), 0, 8), Err(VaultError::OverTransferLimit));
    call(&owner(), NearToken::from_yoctonear(0), T0);
    contract.set_limits(U128(near(5).as_yoctonear()), U128(near(6).as_yoctonear())).unwrap();
    signed(&mut contract, "alice.testnet", near(5), 0, 8).unwrap();
    assert_eq!(signed(&mut contract, "alice.testnet", near(2), 1, 9), Err(VaultError::OverDailyLimit));
    assert_eq!(view(&contract).next_nonce, U64(1));
}

#[test]
fn malformed_verdict() {
    let base = verdict_for("alice.testnet", near(2), 0, 7);
    let cases = [
        // An unknown field.
        (base.replace(r#""heard":"#, r#""extra":1,"heard":"#), VaultError::MalformedVerdict),
        // A missing field.
        (base.replace(r#""word_margin_milli":142,"#, ""), VaultError::MalformedVerdict),
        // Another kind or renderer.
        (base.replace("seams_voice_signed_verdict_v1", "seams_voice_verdict_v1"), VaultError::MalformedVerdict),
        (base.replace("spoken-intent/1", "spoken-intent/2"), VaultError::MalformedVerdict),
        // Accept with a reason; a digest that is null or not canonical.
        (base.replace(r#""reason":null"#, r#""reason":"words""#), VaultError::MalformedVerdict),
        (base.replace(r#""audio_digest":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc""#, r#""audio_digest":null"#), VaultError::MalformedVerdict),
        (base.replace("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwd"), VaultError::MalformedVerdict),
        // Not JSON; a JSON array.
        ("not json".to_string(), VaultError::MalformedVerdict),
        ("[]".to_string(), VaultError::MalformedVerdict),
        // A refusal, signed by the verifier.
        (base.replace(r#""outcome":"accept","reason":null"#, r#""outcome":"refuse","reason":"speaker""#), VaultError::VerdictRefused),
    ];
    let mut contract = setup();
    for (text, error) in cases {
        assert_ne!(text, base);
        assert_eq!(transfer(&mut contract, alice(), near(2), 0, &text, &sign(&text)), Err(error), "{text}");
    }
    assert!(transfers().is_empty());
    assert_eq!(view(&contract).next_nonce, U64(0));
}

#[test]
fn init_checks() {
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    call(&id("deployer.testnet"), NearToken::from_yoctonear(0), T0);
    let secp = PublicKey::from_parts(near_sdk::CurveType::SECP256K1, vec![1; 64]).unwrap();
    assert!(matches!(VoiceVault::new(secp, Some(0)), Err(VaultError::BadConfig)));
    assert!(matches!(VoiceVault::new(pinned_key(), Some(MAX_CONTACT_DELAY_SECONDS + 1)), Err(VaultError::BadConfig)));
    // The init arguments as JSON, as `near contract deploy ... with-init-call new` sends them.
    let args = json!({ "verifier_public_key": vector()["public_key"], "contact_delay_seconds": 0 });
    let key: PublicKey = serde_json::from_value(args["verifier_public_key"].clone()).unwrap();
    assert!(VoiceVault::new(key, args["contact_delay_seconds"].as_u64()).is_ok());
}

const ENROLLMENT_VECTOR: &str = include_str!("../../voice-verifier/testdata/enrollment_digest_v1.json");

fn digest32(text: &str) -> [u8; 32] {
    URL_SAFE_NO_PAD.decode(text).unwrap().try_into().unwrap()
}

#[test]
fn enrollment_digest_shared_vector() {
    let file: Value = serde_json::from_str(ENROLLMENT_VECTOR).unwrap();
    assert_eq!(file["domain"].as_str().unwrap().as_bytes(), enrollment::ENROLLMENT_DOMAIN);
    let digests: Vec<[u8; 32]> =
        file["audio_digests"].as_array().unwrap().iter().map(|d| digest32(d.as_str().unwrap())).collect();
    let digest = enrollment::enrollment_digest(&id(file["vault"].as_str().unwrap()), &id(file["owner"].as_str().unwrap()), &digests);
    assert_eq!(URL_SAFE_NO_PAD.encode(digest), file["enrollment_digest"].as_str().unwrap());
    // The vault stores and returns it as given.
    let mut contract = setup();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    let expires = contract.authorize_enrollment(file["enrollment_digest"].as_str().unwrap().to_string()).unwrap();
    assert_eq!(expires, U64(T0 + enrollment::ENROLLMENT_TTL_NS));
    assert_eq!(
        contract.get_pending_enrollment(owner()),
        Some(PendingEnrollmentView {
            enrollment_digest: file["enrollment_digest"].as_str().unwrap().to_string(),
            expires_at_ns: expires
        })
    );
}

#[test]
fn enrollment_authorization_expires() {
    let mut contract = setup();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    let expires = contract.authorize_enrollment(URL_SAFE_NO_PAD.encode([1u8; 32])).unwrap().0;
    assert_eq!(expires - T0, 600 * 1_000_000_000);
    call(&owner(), NearToken::from_yoctonear(0), expires - 1);
    assert!(contract.get_pending_enrollment(owner()).is_some());
    call(&owner(), NearToken::from_yoctonear(0), expires);
    assert_eq!(contract.get_pending_enrollment(owner()), None);
    // Another owner never had one.
    assert_eq!(contract.get_pending_enrollment(alice()), None);
}

#[test]
fn enrollment_authorization_is_replaced() {
    let mut contract = setup();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    contract.authorize_enrollment(URL_SAFE_NO_PAD.encode([1u8; 32])).unwrap();
    // Later, a new authorization: new digest and new expiry.
    let later = T0 + 300 * 1_000_000_000;
    call(&owner(), NearToken::from_yoctonear(0), later);
    let expires = contract.authorize_enrollment(URL_SAFE_NO_PAD.encode([2u8; 32])).unwrap();
    assert_eq!(expires, U64(later + enrollment::ENROLLMENT_TTL_NS));
    let pending = contract.get_pending_enrollment(owner()).unwrap();
    assert_eq!(pending.enrollment_digest, URL_SAFE_NO_PAD.encode([2u8; 32]));
    // The first expiry has passed for the old digest, not for the new one.
    call(&owner(), NearToken::from_yoctonear(0), T0 + enrollment::ENROLLMENT_TTL_NS);
    assert_eq!(contract.get_pending_enrollment(owner()).unwrap().enrollment_digest, URL_SAFE_NO_PAD.encode([2u8; 32]));
}

#[test]
fn enrollment_authorization_refusals() {
    let mut contract = setup();
    // Only an owner with a vault.
    call(&alice(), NearToken::from_yoctonear(0), T0);
    assert_eq!(contract.authorize_enrollment(URL_SAFE_NO_PAD.encode([1u8; 32])), Err(VaultError::NoVault));
    assert_eq!(contract.get_pending_enrollment(alice()), None);
    // Not 32 bytes, not canonical, not base64url.
    call(&owner(), NearToken::from_yoctonear(0), T0);
    for bad in [URL_SAFE_NO_PAD.encode([1u8; 31]), STANDARD.encode([1u8; 32]), "!!".to_string()] {
        assert_eq!(contract.authorize_enrollment(bad.clone()), Err(VaultError::BadEnrollmentDigest), "{bad}");
    }
    assert_eq!(contract.get_pending_enrollment(owner()), None);
}

#[test]
fn withdrawal_waits_and_pays_the_owner() {
    let mut contract = setup();
    call(&owner(), NearToken::from_yoctonear(0), T0);
    let ready = contract.request_withdrawal(U128(near(3).as_yoctonear())).unwrap();
    assert_eq!(view(&contract).balance, U128(near(7).as_yoctonear()));
    assert_eq!(contract.complete_withdrawal().map(drop), Err(VaultError::WithdrawalNotReady));
    call(&owner(), NearToken::from_yoctonear(0), ready.0);
    contract.complete_withdrawal().unwrap().detach();
    assert_eq!(transfers(), [(owner(), near(3))]);
}
