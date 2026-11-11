//! `audio_key`: the X25519 public key that a Wallet seals audio to, signed
//! by the verdict key. The Wallet already pins the verdict key, so a server
//! between them cannot put its own key in this answer.
use crate::config::AUDIO_KEY_ENV;
use crate::envelope::{audio_key_message, AudioKey};
use crate::host::Host;
use crate::output::{short, sign_message, AudioKeyOutput, Reason};

pub(super) fn audio_key(host: &mut dyn Host) -> AudioKeyOutput {
    let Some(key) = host.secret(AUDIO_KEY_ENV).and_then(|text| AudioKey::from_secret(&text)) else {
        return AudioKeyOutput::refused(Reason::Unsupported, "audio_key: missing".into());
    };
    let public_key = key.public_key();
    match sign_message(host, &audio_key_message(&public_key)) {
        Ok((signature_b64, verdict_key)) => AudioKeyOutput::accepted(&public_key, signature_b64, verdict_key),
        Err(error) => AudioKeyOutput::refused(Reason::Unsupported, short(&format!("sign: {error}"))),
    }
}
