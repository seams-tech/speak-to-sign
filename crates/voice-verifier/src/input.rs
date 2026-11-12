//! Input JSON (the `input` of the HTTPS call). Unknown fields are refused.
//!
//! Each input has a `parse` from the JSON value of the call. The parsers
//! are written by hand: the derive of `serde` for these types was 56 KB of
//! the WASM (36 KB for [`RequestInput`] alone), and OutLayer loads the WASM
//! on each call. A parser returns `None` for every input that it does not
//! take, and the operation refuses it as `unsupported`.
use serde_json::{Map, Value};

use crate::intent::{IntentSpec, SlotType};

/// The fields of one JSON object. A parser takes each field that it knows,
/// and [`Fields::end`] refuses the object if a field is left.
struct Fields(Map<String, Value>);

impl Fields {
    fn of(value: Value) -> Option<Self> {
        match value {
            Value::Object(map) => Some(Self(map)),
            _ => None,
        }
    }

    /// A required string.
    fn text(&mut self, name: &str) -> Option<String> {
        text(self.0.remove(name)?)
    }

    /// A required whole number of 0 or more.
    fn number(&mut self, name: &str) -> Option<u64> {
        self.0.remove(name)?.as_u64()
    }

    /// A field that can be absent or `null`: `Some(None)` then, and `None`
    /// if the field is there and `read` does not take it.
    fn optional<T>(&mut self, name: &str, read: fn(Value) -> Option<T>) -> Option<Option<T>> {
        match self.0.remove(name) {
            None | Some(Value::Null) => Some(None),
            Some(value) => read(value).map(Some),
        }
    }

    /// `value`, if the parser took every field.
    fn end<T>(self, value: T) -> Option<T> {
        self.0.is_empty().then_some(value)
    }
}

fn text(value: Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text),
        _ => None,
    }
}

fn texts(value: Value) -> Option<Vec<String>> {
    match value {
        Value::Array(items) => items.into_iter().map(text).collect(),
        _ => None,
    }
}

/// `enroll`: three inline WAVs of the owner and the owner's authorization.
#[derive(Debug)]
pub struct EnrollInput {
    pub op: String,
    /// The account whose voice this is.
    pub owner: String,
    /// Exactly three 16 kHz mono PCM16 WAVs, standard base64. Either this
    /// field or `audio_sealed_b64`, not both.
    pub audio_wav_b64: Option<Vec<String>>,
    /// The same three WAVs, each sealed to the audio key with the `aad` of
    /// `enroll` and the owner (see [`crate::envelope`]), standard base64.
    pub audio_sealed_b64: Option<Vec<String>>,
    /// Required for a NEAR owner. An application owner (`app:<id>`) must
    /// not have one: the caller of the worker is the authority for it.
    pub authorization: Option<EnrollAuthorization>,
}

impl EnrollInput {
    pub fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let input = Self {
            op: fields.text("op")?,
            owner: fields.text("owner")?,
            audio_wav_b64: fields.optional("audio_wav_b64", texts)?,
            audio_sealed_b64: fields.optional("audio_sealed_b64", texts)?,
            authorization: fields.optional("authorization", EnrollAuthorization::parse)?,
        };
        fields.end(input)
    }
}

/// A NEP-413 signature of the enrollment message by a key of the owner.
#[derive(Debug)]
pub struct EnrollAuthorization {
    /// `ed25519:<base58>`. It must be a full-access key of the owner.
    pub public_key: String,
    /// Standard base64 of the 64-byte ed25519 signature.
    pub signature_b64: String,
    /// Standard base64 of the 32-byte NEP-413 nonce.
    pub nonce_b64: String,
}

impl EnrollAuthorization {
    fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let authorization = Self {
            public_key: fields.text("public_key")?,
            signature_b64: fields.text("signature_b64")?,
            nonce_b64: fields.text("nonce_b64")?,
        };
        fields.end(authorization)
    }
}

/// `verify`: the owner, one typed request, the known accounts and one WAV.
#[derive(Debug)]
pub struct VerifyInput {
    pub op: String,
    /// The account that pays. The text does not say it.
    pub owner: String,
    pub request: RequestInput,
    /// Accounts that the owner knows, for the account names and the
    /// confusion set. At most 32. The receiver is added if it is missing.
    pub contacts: Vec<String>,
    /// One 16 kHz mono PCM16 WAV, standard base64. Either this field or
    /// `audio_sealed_b64`, not both.
    pub audio_wav_b64: Option<String>,
    /// The same WAV, sealed to the audio key with the `aad` of `verify` and
    /// the owner (see [`crate::envelope`]), standard base64.
    pub audio_sealed_b64: Option<String>,
}

impl VerifyInput {
    pub fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let input = Self {
            op: fields.text("op")?,
            owner: fields.text("owner")?,
            request: RequestInput::parse(fields.0.remove("request")?)?,
            contacts: texts(fields.0.remove("contacts")?)?,
            audio_wav_b64: fields.optional("audio_wav_b64", text)?,
            audio_sealed_b64: fields.optional("audio_sealed_b64", text)?,
        };
        fields.end(input)
    }
}

/// `select`: the owner, 2 to 16 candidate requests, the known accounts and
/// one WAV. The verdict is for the one request whose sentence the owner
/// said.
#[derive(Debug)]
pub struct SelectInput {
    pub op: String,
    pub owner: String,
    /// The candidates. No multisig kind. Each one must have its own
    /// sentence.
    pub requests: Vec<RequestInput>,
    /// As in [`VerifyInput`].
    pub contacts: Vec<String>,
    /// One 16 kHz mono PCM16 WAV, standard base64. Either this field or
    /// `audio_sealed_b64`, not both.
    pub audio_wav_b64: Option<String>,
    /// The same WAV, sealed as in [`VerifyInput`], with this operation in
    /// the `aad`.
    pub audio_sealed_b64: Option<String>,
}

impl SelectInput {
    pub fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let requests = match fields.0.remove("requests")? {
            Value::Array(items) => items.into_iter().map(RequestInput::parse).collect::<Option<Vec<_>>>()?,
            _ => return None,
        };
        let input = Self {
            op: fields.text("op")?,
            owner: fields.text("owner")?,
            requests,
            contacts: texts(fields.0.remove("contacts")?)?,
            audio_wav_b64: fields.optional("audio_wav_b64", text)?,
            audio_sealed_b64: fields.optional("audio_sealed_b64", text)?,
        };
        fields.end(input)
    }
}

/// `transcribe`: the owner and one WAV. No request: the output is a signed
/// transcript of what the owner said.
#[derive(Debug)]
pub struct TranscribeInput {
    pub op: String,
    pub owner: String,
    /// One 16 kHz mono PCM16 WAV, standard base64. Either this field or
    /// `audio_sealed_b64`, not both.
    pub audio_wav_b64: Option<String>,
    /// The same WAV, sealed as in [`VerifyInput`], with this operation in
    /// the `aad`.
    pub audio_sealed_b64: Option<String>,
}

impl TranscribeInput {
    pub fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let input = Self {
            op: fields.text("op")?,
            owner: fields.text("owner")?,
            audio_wav_b64: fields.optional("audio_wav_b64", text)?,
            audio_sealed_b64: fields.optional("audio_sealed_b64", text)?,
        };
        fields.end(input)
    }
}

/// `detect`: the owner, the intents that the application offers, and one
/// WAV. The output is a signed proposal of one intent.
#[derive(Debug)]
pub struct DetectInput {
    pub op: String,
    pub owner: String,
    /// 1 to 16 intents.
    pub intents: Vec<IntentSpec>,
    /// One 16 kHz mono PCM16 WAV, standard base64. Either this field or
    /// `audio_sealed_b64`, not both.
    pub audio_wav_b64: Option<String>,
    /// The same WAV, sealed as in [`VerifyInput`], with this operation in
    /// the `aad`.
    pub audio_sealed_b64: Option<String>,
}

impl DetectInput {
    pub fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let input = Self {
            op: fields.text("op")?,
            owner: fields.text("owner")?,
            intents: match fields.0.remove("intents")? {
                Value::Array(items) => items.into_iter().map(intent).collect::<Option<Vec<_>>>()?,
                _ => return None,
            },
            audio_wav_b64: fields.optional("audio_wav_b64", text)?,
            audio_sealed_b64: fields.optional("audio_sealed_b64", text)?,
        };
        fields.end(input)
    }
}

/// One intent of `detect`. The slots can be absent: no slots.
fn intent(value: Value) -> Option<IntentSpec> {
    let mut fields = Fields::of(value)?;
    let slots = match fields.0.remove("slots") {
        None => Map::new(),
        Some(Value::Object(slots)) => slots,
        Some(_) => return None,
    };
    let slot = |(name, kind): (String, Value)| match kind.as_str()? {
        "text" => Some((name, SlotType::Text)),
        "number" => Some((name, SlotType::Number)),
        _ => None,
    };
    let spec = IntentSpec {
        name: fields.text("name")?,
        description: fields.text("description")?,
        slots: slots.into_iter().map(slot).collect::<Option<_>>()?,
    };
    fields.end(spec)
}

/// The typed request, by `kind`: the snake case of the name, for example
/// `community_note`.
#[derive(Debug)]
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
        /// The note, 1 to [`MAX_NOTE_CHARS`](crate::config::MAX_NOTE_CHARS)
        /// characters. The request binds its SHA-256, and the worker checks
        /// that the summary gives its main point.
        note_text: String,
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
    pub fn parse(value: Value) -> Option<Self> {
        let mut fields = Fields::of(value)?;
        let kind = fields.text("kind")?;
        let request = match kind.as_str() {
            "transfer" => {
                Self::Transfer { receiver: fields.text("receiver")?, amount_yocto: fields.text("amount_yocto")? }
            }
            "community_note" => Self::CommunityNote {
                contract: fields.text("contract")?,
                post_id: fields.number("post_id")?,
                note_text: fields.text("note_text")?,
                summary: fields.text("summary")?,
            },
            "note_rating" => Self::NoteRating {
                contract: fields.text("contract")?,
                note_id: fields.number("note_id")?,
                rating: RatingInput::parse(&fields.text("rating")?)?,
            },
            "merge_approval" => Self::MergeApproval {
                contract: fields.text("contract")?,
                repo_sha256_hex: fields.text("repo_sha256_hex")?,
                pull_request: fields.number("pull_request")?,
                base: fields.text("base")?,
                head_commit_hex: fields.text("head_commit_hex")?,
            },
            "market_bet" => Self::MarketBet {
                market: fields.text("market")?,
                token: fields.text("token")?,
                market_id: fields.number("market_id")?,
                outcome: OutcomeInput::parse(&fields.text("outcome")?)?,
                amount_units: fields.text("amount_units")?,
            },
            "transaction" => Self::Transaction {
                receiver: fields.text("receiver")?,
                actions_sha256_hex: fields.text("actions_sha256_hex")?,
                summary: fields.text("summary")?,
            },
            "signed_message" => Self::SignedMessage {
                payload_sha256_hex: fields.text("payload_sha256_hex")?,
                summary: fields.text("summary")?,
            },
            "confirmation" => Self::Confirmation {
                context: fields.text("context")?,
                payload_sha256_hex: fields.text("payload_sha256_hex")?,
                summary: fields.text("summary")?,
            },
            "multisig_propose" => Self::MultisigPropose {
                multisig: fields.text("multisig")?,
                proposal_id: fields.number("proposal_id")?,
                receiver: fields.text("receiver")?,
                amount_yocto: fields.text("amount_yocto")?,
            },
            "multisig_hide_note" => Self::MultisigHideNote {
                multisig: fields.text("multisig")?,
                proposal_id: fields.number("proposal_id")?,
                note_id: fields.number("note_id")?,
            },
            "multisig_confirm" => Self::MultisigConfirm {
                multisig: fields.text("multisig")?,
                proposal_id: fields.number("proposal_id")?,
                commitment_hex: fields.text("commitment_hex")?,
            },
            _ => return None,
        };
        fields.end(request)
    }

    /// `true` for the multisig kinds, whose request needs the worker's
    /// storage and randomness.
    pub fn is_multisig(&self) -> bool {
        matches!(self, Self::MultisigPropose { .. } | Self::MultisigHideNote { .. } | Self::MultisigConfirm { .. })
    }

    /// The note and its summary, for a community note: the summary check
    /// reads both.
    pub fn note_summary(&self) -> Option<(&str, &str)> {
        match self {
            Self::CommunityNote { note_text, summary, .. } => Some((note_text, summary)),
            _ => None,
        }
    }
}

/// The outcome of a `market_bet` request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeInput {
    Yes,
    No,
}

impl OutcomeInput {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "yes" => Some(Self::Yes),
            "no" => Some(Self::No),
            _ => None,
        }
    }
}

/// The rating of a `note_rating` request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RatingInput {
    Helpful,
    SomewhatHelpful,
    NotHelpful,
}

impl RatingInput {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "helpful" => Some(Self::Helpful),
            "somewhat_helpful" => Some(Self::SomewhatHelpful),
            "not_helpful" => Some(Self::NotHelpful),
            _ => None,
        }
    }
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
        assert!(EnrollInput::parse(value.clone()).is_some());
        let mut extra = value.clone();
        extra["extra"] = json!(1);
        assert!(EnrollInput::parse(extra).is_none());
        // An application owner sends no authorization.
        let app = json!({ "op": "enroll", "owner": "app:u", "audio_wav_b64": [] });
        assert!(EnrollInput::parse(app).unwrap().authorization.is_none());
        let mut inner = value;
        inner["authorization"]["extra"] = json!(1);
        assert!(EnrollInput::parse(inner).is_none());
    }

    #[test]
    fn the_request_is_tagged_by_kind() {
        let request = json!({ "kind": "transfer", "receiver": "a.testnet", "amount_yocto": "1" });
        let parsed = RequestInput::parse(request.clone()).unwrap();
        assert!(matches!(parsed, RequestInput::Transfer { ref receiver, .. } if receiver == "a.testnet"));
        let mut extra = request.clone();
        extra["nonce"] = json!(1);
        assert!(RequestInput::parse(extra).is_none());
        let mut unknown = request;
        unknown["kind"] = json!("vault_transfer");
        assert!(RequestInput::parse(unknown).is_none());

        let note = json!({
            "kind": "community_note",
            "contract": "notes.testnet",
            "post_id": 7,
            "note_text": "One lane closes for two weeks.",
            "summary": "The bridge stays open",
        });
        let note = RequestInput::parse(note).unwrap();
        assert!(matches!(note, RequestInput::CommunityNote { post_id: 7, .. }));
        assert_eq!(note.note_summary(), Some(("One lane closes for two weeks.", "The bridge stays open")));
        let transaction = json!({
            "kind": "transaction",
            "receiver": "guest-book.testnet",
            "actions_sha256_hex": "00",
            "summary": "Sign the guest book",
        });
        assert!(matches!(RequestInput::parse(transaction.clone()).unwrap(), RequestInput::Transaction { .. }));
        let mut with_actions = transaction;
        with_actions["actions"] = json!([]);
        assert!(RequestInput::parse(with_actions).is_none());
        let confirmation = json!({ "kind": "confirmation", "context": "shop.example/login", "payload_sha256_hex": "00", "summary": "Log in" });
        assert!(matches!(RequestInput::parse(confirmation).unwrap(), RequestInput::Confirmation { .. }));
        let message = json!({ "kind": "signed_message", "payload_sha256_hex": "00", "summary": "Log in" });
        assert!(matches!(RequestInput::parse(message).unwrap(), RequestInput::SignedMessage { .. }));
        let rating =
            json!({ "kind": "note_rating", "contract": "notes.testnet", "note_id": 1, "rating": "somewhat_helpful" });
        assert!(matches!(
            RequestInput::parse(rating.clone()).unwrap(),
            RequestInput::NoteRating { rating: RatingInput::SomewhatHelpful, .. }
        ));
        let mut unknown_rating = rating;
        unknown_rating["rating"] = json!("great");
        assert!(RequestInput::parse(unknown_rating).is_none());

        let merge = json!({
            "kind": "merge_approval",
            "contract": "merges.testnet",
            "repo_sha256_hex": "00",
            "pull_request": 42,
            "base": "main",
            "head_commit_hex": "00",
        });
        assert!(matches!(
            RequestInput::parse(merge.clone()).unwrap(),
            RequestInput::MergeApproval { pull_request: 42, ref base, .. } if base == "main"
        ));
        let mut negative = merge;
        negative["pull_request"] = json!(-1);
        assert!(RequestInput::parse(negative).is_none());
    }

    #[test]
    fn each_field_has_one_form() {
        let input = json!({
            "op": "verify",
            "owner": "o.testnet",
            "request": { "kind": "market_bet", "market": "m.testnet", "token": "u.testnet", "market_id": 9, "outcome": "yes", "amount_units": "5" },
            "contacts": ["a.testnet"],
            "audio_wav_b64": "AAAA",
        });
        let parsed = VerifyInput::parse(input.clone()).unwrap();
        assert!(matches!(parsed.request, RequestInput::MarketBet { market_id: 9, outcome: OutcomeInput::Yes, .. }));
        assert_eq!(parsed.audio_sealed_b64, None);
        let changed = |path: &[&str], value: Value| {
            let mut input = input.clone();
            let (last, parents) = path.split_last().unwrap();
            let object = parents.iter().fold(&mut input, |at, key| &mut at[*key]).as_object_mut().unwrap();
            if value == json!("absent") {
                object.remove(*last);
            } else {
                object.insert((*last).to_string(), value);
            }
            VerifyInput::parse(input).is_some()
        };
        // An absent field and `null` are the same for an optional field only.
        assert!(changed(&["audio_sealed_b64"], json!(null)));
        assert!(changed(&["audio_wav_b64"], json!("absent")));
        assert!(!changed(&["contacts"], json!("absent")));
        assert!(!changed(&["owner"], json!(null)));
        // The types are exact.
        assert!(!changed(&["contacts"], json!(["a.testnet", 1])));
        assert!(!changed(&["audio_wav_b64"], json!(["AAAA"])));
        assert!(!changed(&["request", "market_id"], json!("9")));
        assert!(!changed(&["request", "market_id"], json!(9.5)));
        assert!(!changed(&["request", "market_id"], json!(-9)));
        assert!(changed(&["request", "market_id"], json!(u64::MAX)));
        assert!(!changed(&["request", "outcome"], json!("maybe")));
        assert!(!changed(&["request", "outcome"], json!({ "yes": null })));
        assert!(!changed(&["request", "kind"], json!("absent")));
        assert!(!changed(&["request", "token"], json!("absent")));
        assert!(!changed(&["request", "receiver"], json!("a.testnet")));
        // An object only: the fields have no order.
        assert!(!changed(&["request"], json!(["transfer", "a.testnet", "1"])));
        assert!(VerifyInput::parse(json!(["verify", "o.testnet"])).is_none());
    }

    #[test]
    fn the_other_operations() {
        let request = json!({ "kind": "transfer", "receiver": "a.testnet", "amount_yocto": "1" });
        let select = json!({ "op": "select", "owner": "o", "requests": [request, request], "contacts": [], "audio_sealed_b64": "AAAA" });
        assert_eq!(SelectInput::parse(select.clone()).unwrap().requests.len(), 2);
        let mut bad = select;
        bad["requests"][1]["extra"] = json!(1);
        assert!(SelectInput::parse(bad).is_none());

        let transcribe = json!({ "op": "transcribe", "owner": "o", "audio_wav_b64": "AAAA" });
        assert!(TranscribeInput::parse(transcribe.clone()).is_some());
        let mut bad = transcribe;
        bad["request"] = request;
        assert!(TranscribeInput::parse(bad).is_none());

        let intents =
            json!([{ "name": "a", "description": "b", "slots": { "s": "text" } }, { "name": "c", "description": "d" }]);
        let detect = json!({ "op": "detect", "owner": "o", "intents": intents, "audio_wav_b64": "AAAA" });
        assert_eq!(DetectInput::parse(detect.clone()).unwrap().intents.len(), 2);
        // The same list as the `serde` types of the intents read.
        let parsed = DetectInput::parse(detect.clone()).unwrap().intents;
        assert_eq!(parsed, serde_json::from_value::<Vec<IntentSpec>>(intents).unwrap());
        for (path, value) in [
            (["slots", "s"], json!("date")),
            (["slots", "extra"], json!(1)),
            (["name", ""], json!(1)),
            (["extra", ""], json!(1)),
            (["slots", ""], json!(null)),
            (["slots", ""], json!([])),
        ] {
            let mut bad = detect.clone();
            match path {
                [field, ""] => bad["intents"][0][field] = value,
                [field, inner] => bad["intents"][0][field][inner] = value,
            }
            assert!(DetectInput::parse(bad.clone()).is_none(), "{bad}");
            assert!(serde_json::from_value::<Vec<IntentSpec>>(bad["intents"].clone()).is_err(), "{bad}");
        }
        // `serde` also takes a slot type as a map, `{"text": null}`. The
        // parser takes only the name.
        let mut map_form = detect;
        map_form["intents"][0]["slots"]["s"] = json!({ "text": null });
        assert!(DetectInput::parse(map_form).is_none());
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
