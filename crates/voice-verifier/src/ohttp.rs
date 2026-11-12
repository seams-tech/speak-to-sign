//! Oblivious HTTP (RFC 9458) for one request to NEAR AI, with the request in
//! Binary HTTP (RFC 9292, known-length form).
//!
//! The worker seals the whole HTTP request (the audio, the headers and the
//! API key) to an OHTTP key configuration: HPKE base mode with
//! DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305. Only the
//! holder of the private key opens it. The response is sealed with a key
//! that comes from the same HPKE context, so a response that opens was
//! written by the holder of the private key, for this request.
//!
//! The NEAR AI gateway derives its OHTTP key inside its TDX VM, and its
//! attested ed25519 key signs the key configuration (see
//! `nearai_attestation`). So TLS terminators and the host of the VM carry
//! only ciphertext.
use chacha20poly1305::aead::{AeadInOut, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305 as ResponseAead, Key, Nonce, Tag};
use hkdf::Hkdf;
use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem as KemTrait, OpModeS, Serializable};
use sha2::{Digest, Sha256};

type Kem = X25519HkdfSha256;

/// HPKE identifiers (RFC 9180, section 7).
pub const KEM_X25519_HKDF_SHA256: u16 = 0x0020;
pub const KDF_HKDF_SHA256: u16 = 0x0001;
pub const AEAD_CHACHA20_POLY1305: u16 = 0x0003;

/// The bytes of an X25519 key and of an encapsulated key.
const KEY_BYTES: usize = 32;
/// `max(Nn, Nk)` of ChaCha20-Poly1305: the response nonce and the exported
/// secret.
const RESPONSE_NONCE_BYTES: usize = 32;
const AEAD_KEY_BYTES: usize = 32;
const AEAD_NONCE_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

/// The `info` prefix of a request and the export label of a response
/// (RFC 9458, sections 4.3 and 4.4).
const REQUEST_LABEL: &[u8] = b"message/bhttp request";
const RESPONSE_LABEL: &[u8] = b"message/bhttp response";

/// One OHTTP key configuration that the worker can seal to: an X25519 key
/// with the suite HKDF-SHA256 and ChaCha20-Poly1305.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyConfig {
    pub key_id: u8,
    pub public_key: [u8; KEY_BYTES],
}

impl KeyConfig {
    /// Reads one key configuration (RFC 9458, section 3):
    /// `key_id (1) || kem_id (2) || public key || suites length (2) ||
    /// (kdf_id (2) || aead_id (2))...`. Accepts it only if the KEM is
    /// X25519 and one suite is HKDF-SHA256 with ChaCha20-Poly1305, and no
    /// byte follows.
    pub fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        let (key_id, rest) = bytes.split_first().ok_or("short")?;
        let (kem, rest) = take_u16(rest)?;
        if kem != KEM_X25519_HKDF_SHA256 {
            return Err("kem");
        }
        let (public_key, rest) = take(rest, KEY_BYTES)?;
        let (suites_length, suites) = take_u16(rest)?;
        let suites_length = usize::from(suites_length);
        if suites.len() != suites_length || suites_length == 0 || suites_length % 4 != 0 {
            return Err("suites");
        }
        let has_suite = suites.chunks_exact(4).any(|suite| {
            u16::from_be_bytes([suite[0], suite[1]]) == KDF_HKDF_SHA256
                && u16::from_be_bytes([suite[2], suite[3]]) == AEAD_CHACHA20_POLY1305
        });
        if !has_suite {
            return Err("no_chacha20_poly1305_suite");
        }
        Ok(Self { key_id: *key_id, public_key: public_key.try_into().map_err(|_| "short")? })
    }

    /// The request header: `key_id || kem_id || kdf_id || aead_id`.
    fn header(&self) -> [u8; 7] {
        let mut header = [0u8; 7];
        header[0] = self.key_id;
        header[1..3].copy_from_slice(&KEM_X25519_HKDF_SHA256.to_be_bytes());
        header[3..5].copy_from_slice(&KDF_HKDF_SHA256.to_be_bytes());
        header[5..7].copy_from_slice(&AEAD_CHACHA20_POLY1305.to_be_bytes());
        header
    }
}

/// A sealed request, and what opens its response.
pub struct SealedRequest {
    /// `header || enc || ciphertext`: the body of the POST, with the
    /// content type `message/ohttp-req`.
    pub body: Vec<u8>,
    pub opener: ResponseOpener,
}

/// Opens the response of one sealed request.
pub struct ResponseOpener {
    enc: [u8; KEY_BYTES],
    secret: [u8; RESPONSE_NONCE_BYTES],
}

/// Seals `request` (a Binary HTTP message) to `config`. `seed` is 32 random
/// bytes of the host: the ephemeral X25519 key comes from them.
pub fn seal_request(config: &KeyConfig, request: &[u8], seed: &[u8; 32]) -> Result<SealedRequest, &'static str> {
    let header = config.header();
    let mut info = Vec::with_capacity(REQUEST_LABEL.len() + 1 + header.len());
    info.extend_from_slice(REQUEST_LABEL);
    info.push(0);
    info.extend_from_slice(&header);
    let public_key = <Kem as KemTrait>::PublicKey::from_bytes(&config.public_key).map_err(|_| "public_key")?;
    let (encapped, mut context) = hpke::setup_sender_with_rng::<ChaCha20Poly1305, HkdfSha256, Kem>(
        &OpModeS::Base,
        &public_key,
        &info,
        &mut SeedRng::new(seed),
    )
    .map_err(|_| "seal")?;
    let ciphertext = context.seal(request, b"").map_err(|_| "seal")?;
    let mut secret = [0u8; RESPONSE_NONCE_BYTES];
    context.export(RESPONSE_LABEL, &mut secret).map_err(|_| "export")?;
    let enc: [u8; KEY_BYTES] = encapped.to_bytes().into();
    let mut body = Vec::with_capacity(header.len() + KEY_BYTES + ciphertext.len());
    body.extend_from_slice(&header);
    body.extend_from_slice(&enc);
    body.extend_from_slice(&ciphertext);
    Ok(SealedRequest { body, opener: ResponseOpener { enc, secret } })
}

impl ResponseOpener {
    /// Opens `response_nonce || ciphertext` (RFC 9458, section 4.4). `None`
    /// if it is short or was not sealed for this request.
    pub fn open(&self, sealed: &[u8]) -> Option<Vec<u8>> {
        if sealed.len() < RESPONSE_NONCE_BYTES + TAG_BYTES {
            return None;
        }
        let (response_nonce, ciphertext) = sealed.split_at(RESPONSE_NONCE_BYTES);
        let (aead, nonce) = response_aead(&self.enc, &self.secret, response_nonce);
        let (body, tag) = ciphertext.split_at(ciphertext.len() - TAG_BYTES);
        let mut plaintext = body.to_vec();
        let tag = Tag::try_from(tag).ok()?;
        aead.decrypt_inout_detached(&nonce, b"", plaintext.as_mut_slice().into(), &tag).ok()?;
        Some(plaintext)
    }
}

/// The AEAD key and nonce of a response (RFC 9458, section 4.4):
/// `prk = Extract(enc || response_nonce, secret)`, then `Expand(prk, "key")`
/// and `Expand(prk, "nonce")`.
fn response_aead(
    enc: &[u8; KEY_BYTES],
    secret: &[u8; RESPONSE_NONCE_BYTES],
    response_nonce: &[u8],
) -> (ResponseAead, Nonce) {
    let mut salt = [0u8; KEY_BYTES + RESPONSE_NONCE_BYTES];
    salt[..KEY_BYTES].copy_from_slice(enc);
    salt[KEY_BYTES..].copy_from_slice(response_nonce);
    let prk = Hkdf::<sha2_11::Sha256>::new(Some(&salt), secret);
    let mut key = [0u8; AEAD_KEY_BYTES];
    let mut nonce = [0u8; AEAD_NONCE_BYTES];
    prk.expand(b"key", &mut key).expect("32 bytes is a valid length");
    prk.expand(b"nonce", &mut nonce).expect("12 bytes is a valid length");
    (ResponseAead::new(&Key::from(key)), Nonce::from(nonce))
}

/// The gateway side of one exchange, as the NEAR AI gateway runs it: it
/// opens a sealed request with its private key and seals the response. The
/// tests of this crate use it as the fake gateway.
pub mod gateway {
    use super::*;
    use hpke::OpModeR;

    /// A gateway key: the private key, and the key configuration of it.
    pub struct GatewayKey {
        private: <Kem as KemTrait>::PrivateKey,
        pub config: KeyConfig,
    }

    impl GatewayKey {
        /// The key that `seed` derives (HPKE `DeriveKeyPair`).
        pub fn derive(seed: &[u8], key_id: u8) -> Self {
            let (private, public) = Kem::derive_keypair(seed);
            Self { private, config: KeyConfig { key_id, public_key: public.to_bytes().into() } }
        }

        /// The configuration bytes (RFC 9458, section 3) with the one suite
        /// HKDF-SHA256 and ChaCha20-Poly1305.
        pub fn config_bytes(&self) -> Vec<u8> {
            let mut bytes = vec![self.config.key_id];
            bytes.extend_from_slice(&KEM_X25519_HKDF_SHA256.to_be_bytes());
            bytes.extend_from_slice(&self.config.public_key);
            bytes.extend_from_slice(&4u16.to_be_bytes());
            bytes.extend_from_slice(&KDF_HKDF_SHA256.to_be_bytes());
            bytes.extend_from_slice(&AEAD_CHACHA20_POLY1305.to_be_bytes());
            bytes
        }

        /// Opens a sealed request: the request, and what seals its response.
        /// `None` if it was not sealed to this key with the suite.
        pub fn open(&self, sealed: &[u8]) -> Option<(Vec<u8>, Responder)> {
            if sealed.len() < 7 + KEY_BYTES || sealed[..7] != self.config.header() {
                return None;
            }
            let (header, rest) = sealed.split_at(7);
            let (enc, ciphertext) = rest.split_at(KEY_BYTES);
            let mut info = REQUEST_LABEL.to_vec();
            info.push(0);
            info.extend_from_slice(header);
            let encapped = <Kem as KemTrait>::EncappedKey::from_bytes(enc).ok()?;
            let mut context = hpke::setup_receiver::<ChaCha20Poly1305, HkdfSha256, Kem>(
                &OpModeR::Base,
                &self.private,
                &encapped,
                &info,
            )
            .ok()?;
            let request = context.open(ciphertext, b"").ok()?;
            let mut secret = [0u8; RESPONSE_NONCE_BYTES];
            context.export(RESPONSE_LABEL, &mut secret).ok()?;
            Some((request, Responder { enc: enc.try_into().ok()?, secret }))
        }
    }

    /// Seals the response of one opened request.
    pub struct Responder {
        enc: [u8; KEY_BYTES],
        secret: [u8; RESPONSE_NONCE_BYTES],
    }

    impl Responder {
        /// `response_nonce || ciphertext || tag`.
        pub fn seal(&self, response: &[u8], response_nonce: &[u8; RESPONSE_NONCE_BYTES]) -> Vec<u8> {
            let (aead, nonce) = response_aead(&self.enc, &self.secret, response_nonce);
            let mut body = response.to_vec();
            let tag = aead.encrypt_inout_detached(&nonce, b"", body.as_mut_slice().into()).expect("a short response");
            [response_nonce.as_slice(), &body, &tag].concat()
        }
    }

    /// A Binary HTTP response in the known-length form, with no header
    /// field and no trailer.
    pub fn bhttp_response_bytes(status: u16, content: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(content.len() + 8);
        put_varint(&mut out, 1);
        put_varint(&mut out, u64::from(status));
        put_varint(&mut out, 0);
        put_bytes(&mut out, content);
        put_varint(&mut out, 0);
        out
    }
}

/// The random source of HPKE: SHA-256 in counter mode over the host's seed.
/// The X25519 key generation reads 32 bytes once.
struct SeedRng {
    seed: [u8; 32],
    counter: u64,
}

impl SeedRng {
    fn new(seed: &[u8; 32]) -> Self {
        Self { seed: *seed, counter: 0 }
    }
}

impl rand_core::TryRng for SeedRng {
    type Error = core::convert::Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        let mut bytes = [0u8; 4];
        self.try_fill_bytes(&mut bytes)?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        let mut bytes = [0u8; 8];
        self.try_fill_bytes(&mut bytes)?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
        for chunk in dst.chunks_mut(32) {
            let mut hasher = Sha256::new();
            hasher.update(b"seams:ohttp-seed:v1");
            hasher.update(self.seed);
            hasher.update(self.counter.to_be_bytes());
            self.counter += 1;
            chunk.copy_from_slice(&hasher.finalize()[..chunk.len()]);
        }
        Ok(())
    }
}

impl rand_core::TryCryptoRng for SeedRng {}

/// A Binary HTTP request in the known-length form (RFC 9292, section 3):
/// the control data, the header fields, the content and no trailer.
/// Header names must be lowercase.
pub fn bhttp_request(method: &str, authority: &str, path: &str, headers: &[(String, String)], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 512);
    put_varint(&mut out, 0);
    for part in [method.as_bytes(), b"https", authority.as_bytes(), path.as_bytes()] {
        put_bytes(&mut out, part);
    }
    let mut fields = Vec::new();
    for (name, value) in headers {
        put_bytes(&mut fields, name.to_ascii_lowercase().as_bytes());
        put_bytes(&mut fields, value.as_bytes());
    }
    put_bytes(&mut out, &fields);
    put_bytes(&mut out, body);
    put_varint(&mut out, 0);
    out
}

/// The status and the content of a Binary HTTP response in the
/// known-length form (RFC 9292, section 3). Informational responses are
/// skipped. A message may end after any section (section 3.8), and zero
/// bytes of padding may follow it.
pub fn bhttp_response(message: &[u8]) -> Result<(u16, Vec<u8>), &'static str> {
    let (framing, mut rest) = take_varint(message)?;
    if framing != 1 {
        return Err("not_a_known_length_response");
    }
    let status = loop {
        let (status, after) = take_varint(rest)?;
        let (_, after) = take_length_prefixed(after)?;
        rest = after;
        match status {
            100..=199 => continue,
            200..=599 => break status as u16,
            _ => return Err("status"),
        }
    };
    if rest.is_empty() {
        return Ok((status, Vec::new()));
    }
    let (content, rest) = take_length_prefixed(rest)?;
    if !rest.is_empty() {
        let (_, padding) = take_length_prefixed(rest)?;
        if padding.iter().any(|byte| *byte != 0) {
            return Err("trailing_bytes");
        }
    }
    Ok((status, content.to_vec()))
}

/// A QUIC variable-length integer (RFC 9000, section 16).
fn put_varint(out: &mut Vec<u8>, value: u64) {
    if value < 1 << 6 {
        out.push(value as u8);
    } else if value < 1 << 14 {
        out.extend_from_slice(&((value as u16) | 0x4000).to_be_bytes());
    } else if value < 1 << 30 {
        out.extend_from_slice(&((value as u32) | 0x8000_0000).to_be_bytes());
    } else {
        out.extend_from_slice(&(value | 0xc000_0000_0000_0000).to_be_bytes());
    }
}

fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    put_varint(out, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

fn take_varint(bytes: &[u8]) -> Result<(u64, &[u8]), &'static str> {
    let first = *bytes.first().ok_or("short")?;
    let length = 1usize << (first >> 6);
    let (head, rest) = take(bytes, length)?;
    let mut value = u64::from(first & 0x3f);
    for byte in &head[1..] {
        value = (value << 8) | u64::from(*byte);
    }
    Ok((value, rest))
}

fn take_length_prefixed(bytes: &[u8]) -> Result<(&[u8], &[u8]), &'static str> {
    let (length, rest) = take_varint(bytes)?;
    take(rest, usize::try_from(length).map_err(|_| "length")?)
}

fn take(bytes: &[u8], length: usize) -> Result<(&[u8], &[u8]), &'static str> {
    if bytes.len() < length {
        return Err("short");
    }
    Ok(bytes.split_at(length))
}

fn take_u16(bytes: &[u8]) -> Result<(u16, &[u8]), &'static str> {
    let (head, rest) = take(bytes, 2)?;
    Ok((u16::from_be_bytes([head[0], head[1]]), rest))
}

#[cfg(test)]
mod tests {
    use super::gateway::{bhttp_response_bytes, GatewayKey};
    use super::*;
    use crate::digest::{from_hex, from_hex_bytes};

    /// The key configuration of the NEAR AI gateway on 2026-11-12.
    const GATEWAY_KEY_CONFIG: &str =
        "010020e4e354364111f2295e2d2ed97ce1103c9fdcb261459ec626d9bd8a6e15f0d11600080001000100010003";

    fn unhex(text: &str) -> Vec<u8> {
        from_hex_bytes(text).unwrap()
    }

    #[test]
    fn reads_the_gateway_key_configuration() {
        let config = KeyConfig::parse(&unhex(GATEWAY_KEY_CONFIG)).unwrap();
        assert_eq!(config.key_id, 1);
        assert_eq!(
            config.public_key,
            from_hex::<32>("e4e354364111f2295e2d2ed97ce1103c9fdcb261459ec626d9bd8a6e15f0d116").unwrap()
        );
    }

    #[test]
    fn refuses_other_key_configurations() {
        let good = unhex(GATEWAY_KEY_CONFIG);
        // Only AES-128-GCM.
        let mut aes_only = good[..35].to_vec();
        aes_only.extend_from_slice(&[0, 4, 0, 1, 0, 1]);
        assert_eq!(KeyConfig::parse(&aes_only), Err("no_chacha20_poly1305_suite"));
        // Another KEM (P-256).
        let mut p256 = good.clone();
        p256[2] = 0x10;
        assert_eq!(KeyConfig::parse(&p256), Err("kem"));
        // A byte more, a byte less.
        let mut longer = good.clone();
        longer.push(0);
        assert_eq!(KeyConfig::parse(&longer), Err("suites"));
        assert_eq!(KeyConfig::parse(&good[..good.len() - 1]), Err("suites"));
        assert_eq!(KeyConfig::parse(&[]), Err("short"));
    }

    #[test]
    fn a_request_opens_at_the_gateway_and_its_response_opens_here() {
        let key = GatewayKey::derive(b"a fixed test key of the gateway", 7);
        assert_eq!(KeyConfig::parse(&key.config_bytes()), Ok(key.config.clone()));
        let sealed = seal_request(&key.config, b"the request", &[9u8; 32]).unwrap();
        assert_eq!(&sealed.body[..7], &[7, 0, 0x20, 0, 1, 0, 3]);
        let (request, responder) = key.open(&sealed.body).unwrap();
        assert_eq!(request, b"the request");
        let response = responder.seal(b"the response", &[5u8; 32]);
        assert_eq!(sealed.opener.open(&response).unwrap(), b"the response");
        // Another gateway key does not open the request.
        assert!(GatewayKey::derive(b"another key", 7).open(&sealed.body).is_none());

        // A changed byte, a response for another request, a short one.
        let mut changed = response.clone();
        changed[40] ^= 1;
        assert!(sealed.opener.open(&changed).is_none());
        let other = seal_request(&key.config, b"the request", &[8u8; 32]).unwrap();
        assert!(other.opener.open(&response).is_none());
        assert!(sealed.opener.open(&response[..47]).is_none());
    }

    #[test]
    fn another_seed_gives_another_ephemeral_key() {
        let config = GatewayKey::derive(b"a fixed test key of the gateway", 1).config;
        let one = seal_request(&config, b"x", &[1u8; 32]).unwrap();
        let two = seal_request(&config, b"x", &[2u8; 32]).unwrap();
        assert_ne!(one.body[7..39], two.body[7..39]);
    }

    #[test]
    fn varints_round_trip() {
        for value in [0u64, 63, 64, 16_383, 16_384, 1_073_741_823, 1_073_741_824] {
            let mut out = Vec::new();
            put_varint(&mut out, value);
            assert_eq!(take_varint(&out).unwrap(), (value, &[][..]));
        }
        // RFC 9000, appendix A.1.
        assert_eq!(take_varint(&[0x40, 0x25]).unwrap().0, 37);
        assert_eq!(take_varint(&[0x9d, 0x7f, 0x3e, 0x7d]).unwrap().0, 494_878_333);
    }

    #[test]
    fn a_request_has_the_known_length_layout() {
        let message =
            bhttp_request("POST", "cloud-api.near.ai", "/v1/x", &[("Content-Type".into(), "text/plain".into())], b"hi");
        let mut expected = vec![0, 4];
        expected.extend_from_slice(b"POST");
        expected.push(5);
        expected.extend_from_slice(b"https");
        expected.push(17);
        expected.extend_from_slice(b"cloud-api.near.ai");
        expected.push(5);
        expected.extend_from_slice(b"/v1/x");
        expected.push(24);
        expected.push(12);
        expected.extend_from_slice(b"content-type");
        expected.push(10);
        expected.extend_from_slice(b"text/plain");
        expected.extend_from_slice(&[2, b'h', b'i', 0]);
        assert_eq!(message, expected);
    }

    #[test]
    fn reads_responses() {
        // Status 200, one header, content, empty trailer.
        let mut message = vec![1, 0x40, 200, 6, 1, b'a', 3, b'x', b'y', b'z'];
        message.extend_from_slice(&[4, b'{', b'}', b'\n', b' ', 0]);
        assert_eq!(bhttp_response(&message).unwrap(), (200, b"{}\n ".to_vec()));
        // An informational response first; padding after the trailer.
        let mut with_100 = vec![1, 0x40, 100, 0];
        with_100.extend_from_slice(&message[1..]);
        with_100.extend_from_slice(&[0, 0, 0]);
        assert_eq!(bhttp_response(&with_100).unwrap(), (200, b"{}\n ".to_vec()));
        // The encoder of the fake gateway.
        assert_eq!(bhttp_response(&bhttp_response_bytes(200, b"{}")).unwrap(), (200, b"{}".to_vec()));
        // Truncated after the header section: no content.
        assert_eq!(bhttp_response(&[1, 0x41, 0xf4, 0]).unwrap(), (500, Vec::new()));
        // A request, a cut message, bytes after the trailer.
        assert_eq!(bhttp_response(&[0, 0]), Err("not_a_known_length_response"));
        assert_eq!(bhttp_response(&[1, 0x40, 200, 6, 1]), Err("short"));
        let mut extra = message.clone();
        extra.push(7);
        assert_eq!(bhttp_response(&extra), Err("trailing_bytes"));
    }
}
