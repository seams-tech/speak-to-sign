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
    pub authorization: EnrollAuthorization,
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
