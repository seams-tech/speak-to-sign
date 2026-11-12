//! Intel's certificates and CRLs, for the quote check ([`crate::tdx_quote`]).
//!
//! Intel's SGX PKI is small and fixed: a root CA, two PCK CAs, the PCK
//! certificate of each platform and one TCB signing certificate. Each has a
//! P-256 key and an ECDSA signature with SHA-256. So this module is not a
//! general X.509 library. It reads the few fields that the quote check
//! needs, and it does these checks of one certificate against its issuer
//! ([`issued`]):
//!
//! - The signature of the issuer's key, over the exact signed bytes.
//! - The issuer name is the subject name of the issuer.
//! - The time of the check is inside the validity of the certificate.
//! - The issuer's CRL does not list the serial number. The CRL has the
//!   signature and the name of the issuer, and its next update is not in the
//!   past ([`Crl::checked`]).
//!
//! Not done, because Intel's PKI does not use them: other algorithms, name
//! constraints, policies, key usage, path lengths, and CRL extensions.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};

/// Intel's SGX root CA certificate, the trust anchor of each quote. From
/// `https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.cer`.
pub const INTEL_ROOT_CA_DER: &[u8] = include_bytes!("intel_sgx_root_ca.der");

const BOOLEAN: u8 = 0x01;
const INTEGER: u8 = 0x02;
const BIT_STRING: u8 = 0x03;
const OCTET_STRING: u8 = 0x04;
pub(crate) const OBJECT_IDENTIFIER: u8 = 0x06;
const UTC_TIME: u8 = 0x17;
const GENERALIZED_TIME: u8 = 0x18;
pub(crate) const SEQUENCE: u8 = 0x30;
/// `[0]`: the version of a certificate, and the extensions of a CRL.
const CONTEXT_0: u8 = 0xa0;
/// `[1]` and `[2]`, the unique identifiers of the issuer and the subject.
const ISSUER_UNIQUE_ID: u8 = 0x81;
const SUBJECT_UNIQUE_ID: u8 = 0x82;
/// `[3]`, the extensions of a certificate.
const EXTENSIONS: u8 = 0xa3;

/// The contents of an `AlgorithmIdentifier` for ecdsa-with-SHA256.
const ECDSA_SHA256: &[u8] = &[0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];
/// The contents of an `AlgorithmIdentifier` for a P-256 key: id-ecPublicKey
/// with prime256v1.
const P256_KEY: &[u8] =
    &[0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
/// basicConstraints, 2.5.29.19.
const BASIC_CONSTRAINTS: &[u8] = &[0x55, 0x1d, 0x13];

/// Takes one DER element from the front of `input`: its tag and its
/// contents. `None` if the bytes are not one element in DER: a tag of more
/// than one byte, an indefinite length, a length that is not in its
/// shortest form, or contents that end after the input.
pub(crate) fn element<'a>(input: &mut &'a [u8]) -> Option<(u8, &'a [u8])> {
    let (&tag, rest) = input.split_first()?;
    if tag & 0x1f == 0x1f {
        return None;
    }
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (usize::from(first), rest)
    } else {
        let (bytes, rest) = rest.split_at_checked(usize::from(first & 0x7f))?;
        if bytes.is_empty() || bytes.len() > 4 || bytes[0] == 0 {
            return None;
        }
        let length = bytes.iter().fold(0_u32, |length, &byte| length << 8 | u32::from(byte));
        if length < 0x80 {
            return None;
        }
        (usize::try_from(length).ok()?, rest)
    };
    let (value, rest) = rest.split_at_checked(length)?;
    *input = rest;
    Some((tag, value))
}

/// Takes one element with this tag, and gives its contents.
pub(crate) fn take<'a>(input: &mut &'a [u8], tag: u8) -> Option<&'a [u8]> {
    element(input).filter(|(found, _)| *found == tag).map(|(_, value)| value)
}

/// The contents of `input`, if it is one element with this tag and nothing
/// more.
pub(crate) fn only(mut input: &[u8], tag: u8) -> Option<&[u8]> {
    take(&mut input, tag).filter(|_| input.is_empty())
}

/// True if `signature` (`r || s`) is the ECDSA signature of the P-256 key
/// `public_key` (an uncompressed point of 65 bytes) over SHA-256 of
/// `message`.
pub fn verify(public_key: &[u8], message: &[u8], signature: &[u8; 64]) -> bool {
    if public_key.len() != 65 || public_key[0] != 0x04 {
        return false;
    }
    match (VerifyingKey::from_sec1_bytes(public_key), Signature::from_slice(signature)) {
        (Ok(key), Ok(signature)) => key.verify(message, &signature).is_ok(),
        _ => false,
    }
}

/// The outer part of a certificate or a CRL: the signed bytes, the
/// contents of the signed part, and the signature as `r || s`.
fn signed(der: &[u8]) -> Option<(&[u8], &[u8], [u8; 64])> {
    let mut outer = only(der, SEQUENCE)?;
    let start = outer;
    let contents = take(&mut outer, SEQUENCE)?;
    let signed = &start[..start.len() - outer.len()];
    if take(&mut outer, SEQUENCE)? != ECDSA_SHA256 {
        return None;
    }
    let (&unused_bits, signature) = take(&mut outer, BIT_STRING)?.split_first()?;
    if unused_bits != 0 || !outer.is_empty() {
        return None;
    }
    // `SEQUENCE { INTEGER r, INTEGER s }`, to 32 bytes for each number.
    let mut numbers = only(signature, SEQUENCE)?;
    let mut raw = [0_u8; 64];
    for half in raw.chunks_mut(32) {
        let number = take(&mut numbers, INTEGER)?;
        let digits = match number {
            [0, rest @ ..] if !rest.is_empty() => rest,
            _ => number,
        };
        if digits.is_empty() || digits.len() > 32 || number[0] & 0x80 != 0 {
            return None;
        }
        half[32 - digits.len()..].copy_from_slice(digits);
    }
    numbers.is_empty().then_some((signed, contents, raw))
}

/// Seconds since the UNIX epoch of a UTC date and time. `None` for a value
/// out of range or a year before 1970. The day is not checked against the
/// length of its month.
fn unix_seconds(year: u64, month: u64, day: u64, hour: u64, minute: u64, second: u64) -> Option<u64> {
    if year < 1970 || !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 59
    {
        return None;
    }
    // Days from the civil date, with the year from March.
    let (year, month) = if month > 2 { (year, month - 3) } else { (year - 1, month + 9) };
    let (era, year_of_era) = (year / 400, year % 400);
    let day_of_year = (153 * month + 2) / 5 + day - 1;
    let days = era * 146_097 + year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60 + second)
}

/// The number of a field of ASCII digits.
fn digits(field: &[u8]) -> Option<u64> {
    field.iter().try_fold(0_u64, |number, &byte| byte.is_ascii_digit().then(|| number * 10 + u64::from(byte - b'0')))
}

/// A `Time` of a certificate or a CRL: `YYMMDDHHMMSSZ` or
/// `YYYYMMDDHHMMSSZ`.
fn time((tag, value): (u8, &[u8])) -> Option<u64> {
    let (year, rest) = match (tag, value.len()) {
        (UTC_TIME, 13) => {
            let year = digits(&value[..2])?;
            (if year < 50 { 2000 + year } else { 1900 + year }, &value[2..])
        }
        (GENERALIZED_TIME, 15) => (digits(&value[..4])?, &value[4..]),
        _ => return None,
    };
    if rest[10] != b'Z' {
        return None;
    }
    let field = |at: usize| digits(&rest[at..at + 2]);
    unix_seconds(year, field(0)?, field(2)?, field(4)?, field(6)?, field(8)?)
}

/// A time of Intel's JSON: `YYYY-MM-DDTHH:MM:SSZ`.
pub fn json_time(text: &str) -> Option<u64> {
    let text = text.as_bytes();
    if text.len() != 20 || [text[4], text[7], text[10], text[13], text[16], text[19]] != *b"--T::Z" {
        return None;
    }
    let field = |at: usize, length: usize| digits(&text[at..at + length]);
    unix_seconds(field(0, 4)?, field(5, 2)?, field(8, 2)?, field(11, 2)?, field(14, 2)?, field(17, 2)?)
}

/// The fields of a certificate that the quote check reads. Each borrows
/// from the DER of the certificate.
pub struct Certificate<'a> {
    /// The signed bytes: `TBSCertificate` with its header.
    signed: &'a [u8],
    signature: [u8; 64],
    /// The contents of the serial number.
    serial: &'a [u8],
    /// The contents of the issuer `Name`.
    pub issuer: &'a [u8],
    /// The contents of the subject `Name`.
    subject: &'a [u8],
    not_before: u64,
    not_after: u64,
    /// The P-256 key, as an uncompressed point of 65 bytes.
    pub public_key: &'a [u8],
    /// The contents of the `SEQUENCE OF Extension`; empty if the
    /// certificate has no extensions.
    extensions: &'a [u8],
}

impl<'a> Certificate<'a> {
    /// Reads `Certificate` and `TBSCertificate` of RFC 5280. `None` if the
    /// bytes are not such a certificate with a P-256 key and an ECDSA
    /// signature with SHA-256.
    pub fn parse(der: &'a [u8]) -> Option<Self> {
        let (signed, mut tbs, signature) = signed(der)?;
        let (mut tag, mut serial) = element(&mut tbs)?;
        if tag == CONTEXT_0 {
            (tag, serial) = element(&mut tbs)?;
        }
        if tag != INTEGER || take(&mut tbs, SEQUENCE)? != ECDSA_SHA256 {
            return None;
        }
        let issuer = take(&mut tbs, SEQUENCE)?;
        let mut validity = take(&mut tbs, SEQUENCE)?;
        let not_before = time(element(&mut validity)?)?;
        let not_after = time(element(&mut validity)?)?;
        let subject = take(&mut tbs, SEQUENCE)?;
        let mut key = take(&mut tbs, SEQUENCE)?;
        if !validity.is_empty() || take(&mut key, SEQUENCE)? != P256_KEY {
            return None;
        }
        let (&unused_bits, public_key) = take(&mut key, BIT_STRING)?.split_first()?;
        if unused_bits != 0 || public_key.len() != 65 || !key.is_empty() {
            return None;
        }
        let mut extensions: &[u8] = &[];
        // The optional fields, in their order.
        let mut last = 0;
        while !tbs.is_empty() {
            let (tag, value) = element(&mut tbs)?;
            if tag <= last {
                return None;
            }
            match tag {
                ISSUER_UNIQUE_ID | SUBJECT_UNIQUE_ID => {}
                EXTENSIONS => extensions = only(value, SEQUENCE)?,
                _ => return None,
            }
            last = tag;
        }
        let certificate =
            Self { signed, signature, serial, issuer, subject, not_before, not_after, public_key, extensions };
        // A broken extension makes the whole certificate unreadable.
        certificate.each_extension(|_, _| {})?;
        Some(certificate)
    }

    /// Calls `visit` with the identifier and the contents of the value of
    /// each extension. `None` if an extension is not readable.
    fn each_extension(&self, mut visit: impl FnMut(&'a [u8], &'a [u8])) -> Option<()> {
        let mut extensions = self.extensions;
        while !extensions.is_empty() {
            let mut extension = take(&mut extensions, SEQUENCE)?;
            let id = take(&mut extension, OBJECT_IDENTIFIER)?;
            let (mut tag, mut value) = element(&mut extension)?;
            // `critical`, which has a default.
            if tag == BOOLEAN {
                (tag, value) = element(&mut extension)?;
            }
            if tag != OCTET_STRING || !extension.is_empty() {
                return None;
            }
            visit(id, value);
        }
        Some(())
    }

    /// The contents of the value of the extension `oid` (the contents of
    /// the OID). `None` if the certificate does not have it exactly once.
    pub fn extension(&self, oid: &[u8]) -> Option<&'a [u8]> {
        let (mut found, mut count) = (None, 0);
        self.each_extension(|id, value| {
            if id == oid {
                found = Some(value);
                count += 1;
            }
        })?;
        found.filter(|_| count == 1)
    }

    /// True if basicConstraints says that the certificate is a CA.
    fn is_ca(&self) -> bool {
        let constraints = self.extension(BASIC_CONSTRAINTS).and_then(|value| only(value, SEQUENCE));
        constraints.is_some_and(|mut constraints| take(&mut constraints, BOOLEAN) == Some(&[0xff]))
    }

    /// True if the key of the certificate signed `message` (`r || s`).
    pub fn signed_message(&self, message: &[u8], signature: &[u8; 64]) -> bool {
        verify(self.public_key, message, signature)
    }
}

/// A CRL with the checks of [`Crl::checked`].
pub struct Crl<'a> {
    /// The contents of the list of revoked certificates; empty if the CRL
    /// has none.
    revoked: &'a [u8],
}

impl<'a> Crl<'a> {
    /// Reads the `CertificateList` of RFC 5280 and checks it: `issuer`
    /// signed it, it has the name of `issuer`, and its next update is not
    /// before `now` (seconds since the UNIX epoch).
    pub fn checked(der: &'a [u8], issuer: &Certificate, now: u64) -> Result<Self, &'static str> {
        let (revoked, next_update) = Self::read(der, issuer).ok_or("crl")?;
        if now > next_update {
            return Err("crl_expired");
        }
        Ok(Self { revoked })
    }

    /// The list of revoked certificates and the next update. `None` if the
    /// CRL is not readable or is not from `issuer`.
    fn read(der: &'a [u8], issuer: &Certificate) -> Option<(&'a [u8], u64)> {
        let (signed, mut tbs, signature) = signed(der)?;
        let (mut tag, mut value) = element(&mut tbs)?;
        // The version.
        if tag == INTEGER {
            (tag, value) = element(&mut tbs)?;
        }
        if tag != SEQUENCE || value != ECDSA_SHA256 || take(&mut tbs, SEQUENCE)? != issuer.subject {
            return None;
        }
        // This update, then the next update.
        time(element(&mut tbs)?)?;
        let next_update = time(element(&mut tbs)?)?;
        let mut revoked: &[u8] = &[];
        // The optional fields, in their order.
        let mut last = 0;
        while !tbs.is_empty() {
            let (tag, value) = element(&mut tbs)?;
            if tag <= last {
                return None;
            }
            match tag {
                SEQUENCE => revoked = value,
                CONTEXT_0 => {}
                _ => return None,
            }
            last = tag;
        }
        issuer.signed_message(signed, &signature).then_some((revoked, next_update))
    }

    /// True if the CRL lists `certificate`. `None` if the list is not
    /// readable.
    fn revokes(&self, certificate: &Certificate) -> Option<bool> {
        let mut revoked = self.revoked;
        while !revoked.is_empty() {
            let mut entry = take(&mut revoked, SEQUENCE)?;
            if take(&mut entry, INTEGER)? == certificate.serial {
                return Some(true);
            }
        }
        Some(false)
    }
}

/// Checks that `issuer` issued `certificate`, at `now` (seconds since the
/// UNIX epoch): the name, the signature, the validity, and the CRL of the
/// issuer. See the module text.
pub fn issued(certificate: &Certificate, issuer: &Certificate, crl: &Crl, now: u64) -> Result<(), &'static str> {
    if certificate.issuer != issuer.subject || !issuer.signed_message(certificate.signed, &certificate.signature) {
        return Err("not_from_issuer");
    }
    if now < certificate.not_before || now > certificate.not_after {
        return Err("expired");
    }
    match crl.revokes(certificate) {
        Some(false) => Ok(()),
        _ => Err("revoked"),
    }
}

/// Like [`issued`], for a certificate that issues other certificates.
pub fn issued_ca(certificate: &Certificate, issuer: &Certificate, crl: &Crl, now: u64) -> Result<(), &'static str> {
    if !certificate.is_ca() {
        return Err("not_a_ca");
    }
    issued(certificate, issuer, crl, now)
}

/// The DER of each certificate of a PEM text, in its order: one to five
/// certificates. The text has only certificates, with white space or NUL
/// bytes around them (a quote ends its chain with a NUL byte).
pub fn pem_certificates(text: &[u8]) -> Option<Vec<Vec<u8>>> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let between = |char: char| char.is_ascii_whitespace() || char == '\0';
    let mut rest = std::str::from_utf8(text).ok()?.trim_matches(between);
    let mut certificates = Vec::new();
    while !rest.is_empty() {
        let body = rest.strip_prefix(BEGIN)?;
        let end = body.find(END)?;
        let encoded: String = body[..end].chars().filter(|char| !char.is_ascii_whitespace()).collect();
        certificates.push(STANDARD.decode(encoded).ok()?);
        rest = body[end + END.len()..].trim_start_matches(between);
    }
    (1..=5).contains(&certificates.len()).then_some(certificates)
}

#[cfg(test)]
mod tests {
    use der::{Decode, Encode};

    use super::*;
    use crate::nearai_attestation::{parse_report, percent_decode};
    use crate::tdx_quote::Quote;

    /// The time of the recorded collateral, in seconds.
    const RECORDED_AT: u64 = 1_794_499_907;

    /// The PCK certificate chain of the recorded gateway quote: the PCK
    /// certificate, the Platform CA and the root.
    fn recorded_chain() -> Vec<Vec<u8>> {
        let report = parse_report(200, include_bytes!("../testdata/nearai_report_v1.json")).unwrap();
        Quote::parse(&report.gateway.quote).unwrap().pck_certificates().unwrap()
    }

    /// The body of the recorded reply whose URL has `word`.
    fn recorded_reply(word: &str) -> Vec<u8> {
        let recorded: serde_json::Value =
            serde_json::from_str(include_str!("../testdata/nearai_collateral_v1.json")).unwrap();
        let replies = recorded["replies"].as_array().unwrap();
        let reply = replies.iter().find(|reply| reply["url"].as_str().unwrap().contains(word)).unwrap();
        STANDARD.decode(reply["body_b64"].as_str().unwrap()).unwrap()
    }

    /// The TCB signing certificate, from a header of the recorded TCB info.
    fn recorded_tcb_signer() -> Vec<u8> {
        let recorded: serde_json::Value =
            serde_json::from_str(include_str!("../testdata/nearai_collateral_v1.json")).unwrap();
        let headers = recorded["replies"].as_array().unwrap().iter().flat_map(|reply| reply["headers"].as_array().unwrap());
        let mut chains = headers.filter(|pair| pair[0] == "TCB-Info-Issuer-Chain").map(|pair| pair[1].as_str().unwrap());
        let chain = percent_decode(chains.next().unwrap()).unwrap();
        pem_certificates(chain.as_bytes()).unwrap().remove(0)
    }

    /// The contents of the serial numbers of a CRL, as this module reads
    /// them.
    fn revoked_serials(crl: &Crl) -> Vec<Vec<u8>> {
        let mut revoked = crl.revoked;
        let mut serials = Vec::new();
        while !revoked.is_empty() {
            let mut entry = take(&mut revoked, SEQUENCE).unwrap();
            serials.push(take(&mut entry, INTEGER).unwrap().to_vec());
        }
        serials
    }

    fn without_leading_zeros(bytes: &[u8]) -> &[u8] {
        &bytes[bytes.iter().take_while(|&&byte| byte == 0).count()..]
    }

    #[test]
    fn the_fields_are_the_ones_that_x509_cert_reads() {
        let mut certificates = recorded_chain();
        assert_eq!(certificates.len(), 3);
        assert_eq!(certificates[2], INTEL_ROOT_CA_DER);
        certificates.push(recorded_tcb_signer());
        for der in &certificates {
            let found = Certificate::parse(der).unwrap();
            let expected = x509_cert::Certificate::from_der(der).unwrap();
            let tbs = expected.tbs_certificate();
            assert_eq!(found.signed, tbs.to_der().unwrap());
            assert_eq!(only(&tbs.issuer().to_der().unwrap(), SEQUENCE), Some(found.issuer));
            assert_eq!(only(&tbs.subject().to_der().unwrap(), SEQUENCE), Some(found.subject));
            assert_eq!(without_leading_zeros(found.serial), without_leading_zeros(tbs.serial_number().as_bytes()));
            assert_eq!(found.not_before, tbs.validity().not_before.to_unix_duration().as_secs());
            assert_eq!(found.not_after, tbs.validity().not_after.to_unix_duration().as_secs());
            assert_eq!(found.public_key, tbs.subject_public_key_info().subject_public_key.raw_bytes());
            let extensions = tbs.extensions().unwrap();
            assert!(extensions.len() >= 4);
            for extension in extensions {
                assert_eq!(found.extension(extension.extn_id.as_bytes()), Some(extension.extn_value.as_bytes()));
            }
            assert_eq!(found.extension(&[0x2a, 0x03]), None);
        }
    }

    #[test]
    fn the_real_chain_passes_and_each_other_pairing_fails() {
        let chain = recorded_chain();
        let [leaf, ca, root] = [0, 1, 2].map(|index| Certificate::parse(&chain[index]).unwrap());
        let (root_crl_der, pck_crl_der) = (recorded_reply("IntelSGXRootCA.der"), recorded_reply("pckcrl"));
        let root_crl = Crl::checked(&root_crl_der, &root, RECORDED_AT).unwrap();
        let pck_crl = Crl::checked(&pck_crl_der, &ca, RECORDED_AT).unwrap();

        assert_eq!(issued(&root, &root, &root_crl, RECORDED_AT), Ok(()));
        assert_eq!(issued_ca(&ca, &root, &root_crl, RECORDED_AT), Ok(()));
        assert_eq!(issued(&leaf, &ca, &pck_crl, RECORDED_AT), Ok(()));
        // The PCK certificate is not a CA, and it is not from the root.
        assert_eq!(issued_ca(&leaf, &ca, &pck_crl, RECORDED_AT), Err("not_a_ca"));
        assert_eq!(issued(&leaf, &root, &root_crl, RECORDED_AT), Err("not_from_issuer"));
        assert_eq!(issued(&ca, &leaf, &pck_crl, RECORDED_AT), Err("not_from_issuer"));
        // A CRL is only good with the certificate of its issuer.
        assert_eq!(Crl::checked(&pck_crl_der, &root, RECORDED_AT).err(), Some("crl"));
        assert_eq!(Crl::checked(&root_crl_der, &ca, RECORDED_AT).err(), Some("crl"));
        assert_eq!(Crl::checked(&pck_crl_der[1..], &ca, RECORDED_AT).err(), Some("crl"));

        // The right name with another key: the signature fails.
        let other_key = Certificate { public_key: leaf.public_key, ..Certificate::parse(&chain[1]).unwrap() };
        assert_eq!(issued(&leaf, &other_key, &pck_crl, RECORDED_AT), Err("not_from_issuer"));
        // The right key with another name.
        let other_name = Certificate { subject: root.subject, ..Certificate::parse(&chain[1]).unwrap() };
        assert_eq!(issued(&leaf, &other_name, &pck_crl, RECORDED_AT), Err("not_from_issuer"));
        // One changed byte in the signed part.
        let mut changed = chain[0].clone();
        changed[100] ^= 1;
        if let Some(changed) = Certificate::parse(&changed) {
            assert_eq!(issued(&changed, &ca, &pck_crl, RECORDED_AT), Err("not_from_issuer"));
        }
    }

    #[test]
    fn the_validity_of_a_certificate_and_of_a_crl() {
        let chain = recorded_chain();
        let [leaf, ca, root] = [0, 1, 2].map(|index| Certificate::parse(&chain[index]).unwrap());
        let pck_crl_der = recorded_reply("pckcrl");
        let pck_crl = Crl::checked(&pck_crl_der, &ca, RECORDED_AT).unwrap();
        assert_eq!(issued(&leaf, &ca, &pck_crl, leaf.not_before), Ok(()));
        assert_eq!(issued(&leaf, &ca, &pck_crl, leaf.not_before - 1), Err("expired"));
        assert_eq!(issued(&leaf, &ca, &pck_crl, leaf.not_after), Ok(()));
        assert_eq!(issued(&leaf, &ca, &pck_crl, leaf.not_after + 1), Err("expired"));

        for (der, issuer) in [(&pck_crl_der, &ca), (&recorded_reply("IntelSGXRootCA.der"), &root)] {
            let expected = x509_cert::crl::CertificateList::<x509_cert::certificate::Rfc5280>::from_der(der).unwrap();
            let next_update = expected.tbs_cert_list.next_update.unwrap().to_unix_duration().as_secs();
            assert!(RECORDED_AT < next_update);
            assert!(Crl::checked(der, issuer, next_update).is_ok());
            assert_eq!(Crl::checked(der, issuer, next_update + 1).err(), Some("crl_expired"));
        }
    }

    #[test]
    fn a_certificate_on_the_crl_is_revoked() {
        let chain = recorded_chain();
        let [leaf, ca] = [0, 1].map(|index| Certificate::parse(&chain[index]).unwrap());
        let pck_crl_der = recorded_reply("pckcrl");
        let pck_crl = Crl::checked(&pck_crl_der, &ca, RECORDED_AT).unwrap();

        // The list is the one that `x509-cert` reads.
        let expected =
            x509_cert::crl::CertificateList::<x509_cert::certificate::Rfc5280>::from_der(&pck_crl_der).unwrap();
        let expected: Vec<Vec<u8>> = expected
            .tbs_cert_list
            .revoked_certificates
            .unwrap()
            .iter()
            .map(|revoked| without_leading_zeros(revoked.serial_number.as_bytes()).to_vec())
            .collect();
        let serials = revoked_serials(&pck_crl);
        assert!(serials.len() > 10, "{}", serials.len());
        assert_eq!(serials.iter().map(|serial| without_leading_zeros(serial).to_vec()).collect::<Vec<_>>(), expected);

        // The PCK certificate with each serial number of the list. `issued`
        // checks the signature first, so the test asks the CRL itself, and
        // then `issued` for the real certificate.
        assert_eq!(pck_crl.revokes(&leaf), Some(false));
        for serial in &serials {
            let revoked = Certificate { serial, ..Certificate::parse(&chain[0]).unwrap() };
            assert_eq!(pck_crl.revokes(&revoked), Some(true));
        }
        // A serial number that is a part of a listed one is not listed.
        let part = Certificate { serial: &serials[0][1..], ..Certificate::parse(&chain[0]).unwrap() };
        assert_eq!(pck_crl.revokes(&part), Some(false));
        // A list with the real serial number: `issued` refuses.
        let list = [&[0x30, leaf.serial.len() as u8 + 2, INTEGER, leaf.serial.len() as u8][..], leaf.serial].concat();
        let listing = Crl { revoked: &list };
        assert_eq!(issued(&leaf, &ca, &listing, RECORDED_AT), Err("revoked"));
        // A list that is not readable also refuses.
        assert_eq!(issued(&leaf, &ca, &Crl { revoked: &[0x30] }, RECORDED_AT), Err("revoked"));
    }

    #[test]
    fn times() {
        assert_eq!(unix_seconds(1970, 1, 1, 0, 0, 0), Some(0));
        assert_eq!(json_time("2026-11-12T15:22:22Z"), Some(1_794_496_942));
        assert_eq!(json_time("2000-02-29T23:59:59Z"), Some(951_868_799));
        assert_eq!(json_time("2000-03-01T00:00:00Z"), Some(951_868_800));
        assert_eq!(time((UTC_TIME, b"261112152222Z")), Some(1_794_496_942));
        assert_eq!(time((GENERALIZED_TIME, b"20491231235959Z")), Some(2_524_607_999));
        // A UTC time has years from 1950 to 2049.
        assert_eq!(time((UTC_TIME, b"700101000000Z")), Some(0));
        assert_eq!(time((UTC_TIME, b"491231235959Z")), Some(2_524_607_999));
        for text in ["2026-11-12T15:22:22", "2026-11-12 15:22:22Z", "2026-13-12T15:22:22Z", "2026-11-12T24:00:00Z"] {
            assert_eq!(json_time(text), None, "{text}");
        }
        assert_eq!(json_time("2026-11-12T15:22:22+00:00"), None);
        assert_eq!(json_time("1969-12-31T23:59:59Z"), None);
        assert_eq!(time((UTC_TIME, b"2611121522Z")), None);
        assert_eq!(time((UTC_TIME, b"261112152222+")), None);
        assert_eq!(time((GENERALIZED_TIME, b"2026111215222 Z")), None);
    }

    #[test]
    fn elements() {
        let mut input: &[u8] = &[0x04, 0x02, 0xaa, 0xbb, 0x05, 0x00];
        assert_eq!(element(&mut input), Some((0x04, &[0xaa, 0xbb][..])));
        assert_eq!(element(&mut input), Some((0x05, &[][..])));
        assert_eq!(element(&mut input), None);
        let long = [&[0x04, 0x81, 0x80][..], &[7; 0x80]].concat();
        assert_eq!(only(&long, 0x04), Some(&[7; 0x80][..]));
        // Not DER: a long form for a short length, a leading zero, an
        // indefinite length, a tag of more than one byte, cut contents.
        for bytes in [
            &[0x04, 0x81, 0x01, 0xaa][..],
            &[0x04, 0x82, 0x00, 0x80],
            &[0x04, 0x80, 0xaa, 0x00, 0x00],
            &[0x1f, 0x01, 0xaa],
            &[0x04, 0x02, 0xaa],
            &[0x04],
        ] {
            assert_eq!(element(&mut &bytes[..]), None, "{bytes:02x?}");
        }
        assert_eq!(only(&[0x04, 0x00, 0x00], 0x04), None);
    }

    #[test]
    fn the_root_certificate() {
        let root = Certificate::parse(INTEL_ROOT_CA_DER).unwrap();
        // The root signs itself and is a CA.
        assert!(root.signed_message(root.signed, &root.signature));
        assert_eq!(root.issuer, root.subject);
        assert!(root.is_ca());
        assert!(root.not_before < 1_794_496_942 && 1_794_496_942 < root.not_after);
        // Another message, or another signature, does not pass.
        assert!(!root.signed_message(&root.signed[1..], &root.signature));
        let mut signature = root.signature;
        signature[63] ^= 1;
        assert!(!root.signed_message(root.signed, &signature));
        assert!(!verify(&root.public_key[1..], root.signed, &root.signature));
    }

    #[test]
    fn pem() {
        let one = "-----BEGIN CERTIFICATE-----\nAAEC\nAw==\n-----END CERTIFICATE-----\n";
        assert_eq!(pem_certificates(one.as_bytes()), Some(vec![vec![0, 1, 2, 3]]));
        assert_eq!(pem_certificates(one.repeat(5).as_bytes()).map(|found| found.len()), Some(5));
        assert_eq!(pem_certificates(one.repeat(6).as_bytes()), None);
        assert_eq!(pem_certificates(b""), None);
        assert_eq!(pem_certificates(b"-----BEGIN CERTIFICATE-----\nAAEC"), None);
        assert_eq!(pem_certificates(b"-----BEGIN CERTIFICATE-----\n!!\n-----END CERTIFICATE-----"), None);
        // Other text before, between or after the certificates.
        assert_eq!(pem_certificates(format!(" \n{one}\n{one}\0").as_bytes()).map(|found| found.len()), Some(2));
        assert_eq!(pem_certificates(format!("x{one}").as_bytes()), None);
        assert_eq!(pem_certificates(format!("{one}x").as_bytes()), None);
        assert_eq!(pem_certificates(format!("{one}-----BEGIN CERTIFICAT-----\nAAEC\n{}", &one[28..]).as_bytes()), None);
    }
}
