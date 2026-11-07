//! Input JSON (the `input` of the HTTPS call). Unknown fields are refused.
use serde::Deserialize;

/// `enroll`: three inline WAVs of the owner, for one vault.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrollInput {
    pub op: String,
    /// The vault contract account.
    pub vault: String,
    /// The vault owner.
    pub owner: String,
    /// Exactly three 16 kHz mono PCM16 WAVs, standard base64.
    pub audio_wav_b64: Vec<String>,
}

/// `verify`: the request fields that the vault checks, the vault's contacts
/// and one inline WAV.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyInput {
    pub op: String,
    pub vault: String,
    pub owner: String,
    pub receiver: String,
    /// Decimal yoctoNEAR (a JSON string: it does not fit a JSON number).
    pub amount_yocto: String,
    pub nonce: u64,
    /// The vault's contacts, for the account names and the confusion set.
    /// At most 32. The receiver is added if it is not in the list.
    pub contacts: Vec<String>,
    /// One 16 kHz mono PCM16 WAV, standard base64.
    pub audio_wav_b64: String,
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
        let value = json!({ "op": "enroll", "vault": "v", "owner": "o", "audio_wav_b64": [], "extra": 1 });
        assert!(serde_json::from_value::<EnrollInput>(value).is_err());
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
