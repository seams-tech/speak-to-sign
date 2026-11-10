//! Input JSON (the `input` of the HTTPS call). Unknown fields are refused.
use serde::Deserialize;

/// `enroll`: three inline WAVs of the owner and the owner's authorization.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrollInput {
    pub op: String,
    /// The account whose voice this is.
    pub owner: String,
    /// Exactly three 16 kHz mono PCM16 WAVs, standard base64.
    pub audio_wav_b64: Vec<String>,
    /// Required for a NEAR owner. An application owner (`app:<id>`) must
    /// not have one: the caller of the worker is the authority for it.
    #[serde(default)]
    pub authorization: Option<EnrollAuthorization>,
}

/// A NEP-413 signature of the enrollment message by a key of the owner.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrollAuthorization {
    /// `ed25519:<base58>`. It must be a full-access key of the owner.
    pub public_key: String,
    /// Standard base64 of the 64-byte ed25519 signature.
    pub signature_b64: String,
    /// Standard base64 of the 32-byte NEP-413 nonce.
    pub nonce_b64: String,
}

/// `verify`: the owner, one typed request, the known accounts and one WAV.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyInput {
    pub op: String,
    /// The account that pays. The text does not say it.
    pub owner: String,
    pub request: RequestInput,
    /// Accounts that the owner knows, for the account names and the
    /// confusion set. At most 32. The receiver is added if it is missing.
    pub contacts: Vec<String>,
    /// One 16 kHz mono PCM16 WAV, standard base64.
    pub audio_wav_b64: String,
}

/// `select`: the owner, 2 to 16 candidate requests, the known accounts and
/// one WAV. The verdict is for the one request whose sentence the owner
/// said.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectInput {
    pub op: String,
    pub owner: String,
    /// The candidates. No multisig kind. Each one must have its own
    /// sentence.
    pub requests: Vec<RequestInput>,
    /// As in [`VerifyInput`].
    pub contacts: Vec<String>,
    /// One 16 kHz mono PCM16 WAV, standard base64.
    pub audio_wav_b64: String,
}

/// `transcribe`: the owner and one WAV. No request: the output is a signed
/// transcript of what the owner said.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscribeInput {
    pub op: String,
    pub owner: String,
    /// One 16 kHz mono PCM16 WAV, standard base64.
    pub audio_wav_b64: String,
}

/// `detect`: the owner, the intents that the application offers, and one
/// WAV. The output is a signed proposal of one intent.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DetectInput {
    pub op: String,
    pub owner: String,
    /// 1 to 16 intents.
    pub intents: Vec<crate::intent::IntentSpec>,
    /// One 16 kHz mono PCM16 WAV, standard base64.
    pub audio_wav_b64: String,
}

/// The typed request, by `kind`.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RequestInput {
    /// A native NEAR transfer from the owner's account.
    Transfer {
        receiver: String,
        /// Decimal yoctoNEAR (a JSON string: it does not fit a JSON number).
        amount_yocto: String,
    },
    /// A community note on a post. The owner says only the summary.
    CommunityNote {
        /// The notes contract.
        contract: String,
        post_id: u64,
        /// SHA-256 of the UTF-8 note text, 64 lowercase hex characters.
        note_sha256_hex: String,
        summary: String,
    },
    /// A rating of a community note.
    NoteRating {
        /// The notes contract.
        contract: String,
        note_id: u64,
        rating: RatingInput,
    },
    /// An approval to merge the head commit of a pull request into its
    /// base. The owner says the pull request number and the base.
    MergeApproval {
        /// The merge approvals contract.
        contract: String,
        /// SHA-256 of the UTF-8 repository name, 64 lowercase hex characters.
        repo_sha256_hex: String,
        /// 1 or more.
        pull_request: u64,
        /// 1 to 32 ASCII lowercase letters.
        base: String,
        /// The head commit id, 40 lowercase hex characters.
        head_commit_hex: String,
    },
    /// A bet on one outcome of a prediction market, paid in USDC. The owner
    /// says the amount, the outcome and the market id. The market contract
    /// checks the verdict of this request before it takes the bet.
    MarketBet {
        /// The market contract.
        market: String,
        /// The token contract of the stake.
        token: String,
        /// 1 or more.
        market_id: u64,
        outcome: OutcomeInput,
        /// Decimal base units of the token, 10^-6 USDC (a JSON string, as
        /// `amount_yocto`).
        amount_units: String,
    },
    /// Any NEAR transaction from the owner's account. The owner says only
    /// the summary; the verdict binds the receiver and the actions.
    Transaction {
        /// The receiver of the transaction.
        receiver: String,
        /// SHA-256 of the Borsh of the transaction's actions, 64 lowercase
        /// hex characters.
        actions_sha256_hex: String,
        summary: String,
    },
    /// A NEP-413 message. The owner says only the summary.
    SignedMessage {
        /// The 32 bytes that the key signs, 64 lowercase hex characters.
        payload_sha256_hex: String,
        summary: String,
    },
    /// A confirmation of any payload for an application owner (`app:<id>`).
    /// The owner says only the summary; the verdict binds the context and
    /// the SHA-256 of the payload.
    Confirmation {
        /// The action, as the application names it: 1 to 64 characters of
        /// `a-z`, `0-9`, `.`, `_`, `-`, `:` and `/`.
        context: String,
        /// SHA-256 of the payload bytes, 64 lowercase hex characters.
        payload_sha256_hex: String,
        summary: String,
    },
    /// A new multisig transfer, said by its proposer. The verifier draws the
    /// salt and keeps the proposal; the contract gets only its commitment.
    MultisigPropose {
        /// The multisig contract.
        multisig: String,
        /// The id that the contract gives the proposal next.
        proposal_id: u64,
        receiver: String,
        /// Decimal yoctoNEAR (a JSON string: it does not fit a JSON number).
        amount_yocto: String,
    },
    /// A new multisig proposal to hide a community note, said by its
    /// proposer: "approve proposal N hide note M". The multisig is the
    /// moderator of a notes contract. Like `multisig_propose`, the verifier
    /// draws the salt and keeps the proposal.
    MultisigHideNote {
        /// The multisig contract.
        multisig: String,
        /// The id that the contract gives the proposal next.
        proposal_id: u64,
        /// The id of the note to hide.
        note_id: u64,
    },
    /// A confirmation of a stored multisig proposal. The member says the
    /// proposal from memory: the input names only its commitment.
    MultisigConfirm {
        /// The multisig contract.
        multisig: String,
        proposal_id: u64,
        /// The commitment that the contract holds, 64 lowercase hex
        /// characters.
        commitment_hex: String,
    },
}

impl RequestInput {
    /// `true` for the multisig kinds, whose request needs the worker's
    /// storage and randomness.
    pub fn is_multisig(&self) -> bool {
        matches!(self, Self::MultisigPropose { .. } | Self::MultisigHideNote { .. } | Self::MultisigConfirm { .. })
    }
}

/// The outcome of a `market_bet` request.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeInput {
    Yes,
    No,
}

/// The rating of a `note_rating` request.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RatingInput {
    Helpful,
    SomewhatHelpful,
    NotHelpful,
}

/// Decimal `u128` with no sign and no leading zero.
pub fn parse_yocto(text: &str) -> Option<u128> {
    let value: u128 = text.parse().ok()?;
    (value.to_string() == text).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_fields_are_refused() {
        let authorization = json!({ "public_key": "k", "signature_b64": "s", "nonce_b64": "n" });
        let value = json!({ "op": "enroll", "owner": "o", "audio_wav_b64": [], "authorization": authorization });
        assert!(serde_json::from_value::<EnrollInput>(value.clone()).is_ok());
        let mut extra = value.clone();
        extra["extra"] = json!(1);
        assert!(serde_json::from_value::<EnrollInput>(extra).is_err());
        // An application owner sends no authorization.
        let app = json!({ "op": "enroll", "owner": "app:u", "audio_wav_b64": [] });
        assert!(serde_json::from_value::<EnrollInput>(app).unwrap().authorization.is_none());
        let mut inner = value;
        inner["authorization"]["extra"] = json!(1);
        assert!(serde_json::from_value::<EnrollInput>(inner).is_err());
    }

    #[test]
    fn the_request_is_tagged_by_kind() {
        let request = json!({ "kind": "transfer", "receiver": "a.testnet", "amount_yocto": "1" });
        let parsed: RequestInput = serde_json::from_value(request.clone()).unwrap();
        assert!(matches!(parsed, RequestInput::Transfer { ref receiver, .. } if receiver == "a.testnet"));
        let mut extra = request.clone();
        extra["nonce"] = json!(1);
        assert!(serde_json::from_value::<RequestInput>(extra).is_err());
        let mut unknown = request;
        unknown["kind"] = json!("vault_transfer");
        assert!(serde_json::from_value::<RequestInput>(unknown).is_err());

        let note = json!({
            "kind": "community_note",
            "contract": "notes.testnet",
            "post_id": 7,
            "note_sha256_hex": "00",
            "summary": "The bridge stays open",
        });
        assert!(matches!(
            serde_json::from_value::<RequestInput>(note).unwrap(),
            RequestInput::CommunityNote { post_id: 7, .. }
        ));
        let transaction = json!({
            "kind": "transaction",
            "receiver": "guest-book.testnet",
            "actions_sha256_hex": "00",
            "summary": "Sign the guest book",
        });
        assert!(matches!(
            serde_json::from_value::<RequestInput>(transaction.clone()).unwrap(),
            RequestInput::Transaction { .. }
        ));
        let mut with_actions = transaction;
        with_actions["actions"] = json!([]);
        assert!(serde_json::from_value::<RequestInput>(with_actions).is_err());
        let confirmation =
            json!({ "kind": "confirmation", "context": "shop.example/login", "payload_sha256_hex": "00", "summary": "Log in" });
        assert!(matches!(
            serde_json::from_value::<RequestInput>(confirmation).unwrap(),
            RequestInput::Confirmation { .. }
        ));
        let message = json!({ "kind": "signed_message", "payload_sha256_hex": "00", "summary": "Log in" });
        assert!(matches!(
            serde_json::from_value::<RequestInput>(message).unwrap(),
            RequestInput::SignedMessage { .. }
        ));
        let rating = json!({ "kind": "note_rating", "contract": "notes.testnet", "note_id": 1, "rating": "somewhat_helpful" });
        assert!(matches!(
            serde_json::from_value::<RequestInput>(rating.clone()).unwrap(),
            RequestInput::NoteRating { rating: RatingInput::SomewhatHelpful, .. }
        ));
        let mut unknown_rating = rating;
        unknown_rating["rating"] = json!("great");
        assert!(serde_json::from_value::<RequestInput>(unknown_rating).is_err());

        let merge = json!({
            "kind": "merge_approval",
            "contract": "merges.testnet",
            "repo_sha256_hex": "00",
            "pull_request": 42,
            "base": "main",
            "head_commit_hex": "00",
        });
        assert!(matches!(
            serde_json::from_value::<RequestInput>(merge.clone()).unwrap(),
            RequestInput::MergeApproval { pull_request: 42, ref base, .. } if base == "main"
        ));
        let mut negative = merge;
        negative["pull_request"] = json!(-1);
        assert!(serde_json::from_value::<RequestInput>(negative).is_err());
    }

    #[test]
    fn yocto_text() {
        assert_eq!(parse_yocto("2000000000000000000000000"), Some(2 * 10u128.pow(24)));
        assert_eq!(parse_yocto("0"), Some(0));
        assert_eq!(parse_yocto("01"), None);
        assert_eq!(parse_yocto("+1"), None);
        assert_eq!(parse_yocto("1e24"), None);
    }
}
