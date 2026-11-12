//! A small verifier for an Intel TDX quote (DCAP).
//!
//! [`verify`] checks one quote of version 4 with a TD 1.0 report, against
//! Intel's collateral, at one time. It does the checks of `dcap-qvl` 0.7.1
//! for such a quote, in this order:
//!
//! 1. Intel's root CA certificate is the pinned one
//!    ([`crate::x509::INTEL_ROOT_CA_DER`]), and the root CA CRL is from it.
//! 2. The TCB info and the QE identity: the root issued their signer, the
//!    signer signed the exact JSON text, and the time is between `issueDate`
//!    and `nextUpdate`.
//! 3. The PCK certificate chain of the quote: the root issued the PCK CA,
//!    the PCK CA issued the PCK certificate, and no CRL lists them.
//! 4. The PCK key signed the QE report, the QE report binds the attestation
//!    key, and the QE report fits the QE identity.
//! 5. The attestation key signed the quote header and the TD report.
//! 6. The TCB status: the TCB level of the platform, of the TDX module and
//!    of the QE, from the TCB info and the QE identity. A revoked TCB fails.
//! 7. The TDX module identity and the TD attributes: no debug TD, no
//!    migration, no service TD.
//!
//! [`crate::x509`] has the certificate checks. The TCB rules are the ones of
//! `dcap-qvl` (MIT license, Phala Network), which follow Intel's QVL.
//! `tests/tdx_quote.rs` compares the results with `dcap-qvl` itself.
//!
//! Not supported: SGX quotes, quotes of version 5, TD 1.5 reports, and a
//! quote without its PCK certificate chain. [`verify`] refuses them.
use serde_json::Value;

use crate::digest::{from_hex, sha256};
use crate::x509::{self, Certificate, Crl, INTEL_ROOT_CA_DER};

/// Intel's collateral for one quote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Collateral {
    /// The CRL of the root CA, as DER.
    pub root_ca_crl: Vec<u8>,
    /// The CRL of the PCK CA of the platform, as DER.
    pub pck_crl: Vec<u8>,
    /// The exact text of the `tcbInfo` object, its signature (`r || s`) and
    /// the certificates of its signer, as PEM.
    pub tcb_info: String,
    pub tcb_info_signature: Vec<u8>,
    pub tcb_info_issuer_chain: String,
    /// The same for the `enclaveIdentity` object of the TDX QE.
    pub qe_identity: String,
    pub qe_identity_signature: Vec<u8>,
    pub qe_identity_issuer_chain: String,
}

/// The fields of a TD 1.0 report that the checks and the callers read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdReport {
    pub tee_tcb_svn: [u8; 16],
    pub mr_signer_seam: [u8; 48],
    pub seam_attributes: [u8; 8],
    pub td_attributes: [u8; 8],
    pub mr_td: [u8; 48],
    pub mr_config_id: [u8; 48],
    pub report_data: [u8; 64],
}

/// A quote that passed [`verify`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verified {
    /// The TCB status of the platform, the TDX module and the QE together,
    /// in Intel's words (`UpToDate`, `SWHardeningNeeded`, `OutOfDate`, ...).
    /// The caller decides which ones it accepts.
    pub tcb_status: String,
    pub report: TdReport,
}

/// The values of a PCK certificate that select and match the TCB info.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pck {
    pub fmspc: [u8; 6],
    pub cpu_svn: [u8; 16],
    pub pce_svn: u16,
}

const HEADER_LENGTH: usize = 48;
const TD_REPORT_LENGTH: usize = 584;
const QE_REPORT_LENGTH: usize = 384;
const QUOTE_VERSION: u16 = 4;
const KEY_TYPE_ECDSA_P256: u16 = 2;
const TEE_TYPE_TDX: u32 = 0x81;
const INTEL_QE_VENDOR_ID: [u8; 16] =
    [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
/// The certification data of a QE report, and of a PCK certificate chain.
const CERTIFICATION_QE_REPORT: u16 = 6;
const CERTIFICATION_PCK_CHAIN: u16 = 5;

/// The Intel SGX extension of a PCK certificate, 1.2.840.113741.1.13.1. The
/// OID of each of its values starts with these bytes.
const SGX_EXTENSION: &[u8] = &[0x2a, 0x86, 0x48, 0x86, 0xf8, 0x4d, 0x01, 0x0d, 0x01];

/// Takes `length` bytes from the front of `input`.
fn split<'a>(input: &mut &'a [u8], length: usize) -> Option<&'a [u8]> {
    let (head, rest) = input.split_at_checked(length)?;
    *input = rest;
    Some(head)
}

fn array<const N: usize>(input: &mut &[u8]) -> Option<[u8; N]> {
    split(input, N)?.try_into().ok()
}

fn u16_le(input: &mut &[u8]) -> Option<u16> {
    array(input).map(u16::from_le_bytes)
}

/// A length of four bytes.
fn length(input: &mut &[u8]) -> Option<usize> {
    array(input).map(u32::from_le_bytes).and_then(|length| usize::try_from(length).ok())
}

/// The `N` bytes of `bytes` from `at`. The callers give a range inside a
/// report of a fixed length.
fn field<const N: usize>(bytes: &[u8], at: usize) -> [u8; N] {
    bytes[at..at + N].try_into().expect("the range has N bytes")
}

/// The parts of a quote. Each borrows from the bytes of the quote.
pub struct Quote<'a> {
    /// The header and the TD report: the bytes that the attestation key
    /// signs.
    signed: &'a [u8],
    pub report: TdReport,
    signature: [u8; 64],
    /// The attestation key, as `x || y`.
    attestation_key: &'a [u8],
    qe_report: &'a [u8],
    qe_report_signature: [u8; 64],
    qe_auth_data: &'a [u8],
    /// The PCK certificate chain, as PEM.
    pck_chain: &'a [u8],
}

impl<'a> Quote<'a> {
    /// Reads a TDX quote of version 4 with an ECDSA P-256 attestation key
    /// from Intel's QE, and with its PCK certificate chain.
    pub fn parse(quote: &'a [u8]) -> Result<Self, &'static str> {
        let header = quote.get(..HEADER_LENGTH).ok_or("malformed")?;
        if u16::from_le_bytes(field(header, 0)) != QUOTE_VERSION {
            return Err("version");
        }
        if u16::from_le_bytes(field(header, 2)) != KEY_TYPE_ECDSA_P256 {
            return Err("key_type");
        }
        if u32::from_le_bytes(field(header, 4)) != TEE_TYPE_TDX {
            return Err("not_tdx");
        }
        if field::<16>(header, 12) != INTEL_QE_VENDOR_ID {
            return Err("qe_vendor");
        }
        Self::body(quote).ok_or("malformed")
    }

    fn body(quote: &'a [u8]) -> Option<Self> {
        let mut input = quote;
        let signed = split(&mut input, HEADER_LENGTH + TD_REPORT_LENGTH)?;
        let report = &signed[HEADER_LENGTH..];
        let report = TdReport {
            tee_tcb_svn: field(report, 0),
            mr_signer_seam: field(report, 64),
            seam_attributes: field(report, 112),
            td_attributes: field(report, 120),
            mr_td: field(report, 136),
            mr_config_id: field(report, 184),
            report_data: field(report, 520),
        };
        let length_of_data = length(&mut input)?;
        let mut data = split(&mut input, length_of_data)?;
        let signature = array(&mut data)?;
        let attestation_key = split(&mut data, 64)?;
        if u16_le(&mut data)? != CERTIFICATION_QE_REPORT {
            return None;
        }
        let length_of_qe = length(&mut data)?;
        let mut qe = split(&mut data, length_of_qe)?;
        let qe_report = split(&mut qe, QE_REPORT_LENGTH)?;
        let qe_report_signature = array(&mut qe)?;
        let length_of_auth = u16_le(&mut qe)?;
        let qe_auth_data = split(&mut qe, usize::from(length_of_auth))?;
        if u16_le(&mut qe)? != CERTIFICATION_PCK_CHAIN {
            return None;
        }
        let length_of_chain = length(&mut qe)?;
        let pck_chain = split(&mut qe, length_of_chain)?;
        Some(Self {
            signed,
            report,
            signature,
            attestation_key,
            qe_report,
            qe_report_signature,
            qe_auth_data,
            pck_chain,
        })
    }

    /// The PCK certificate chain of the quote: the PCK certificate, then
    /// its CA. Each as DER.
    pub fn pck_certificates(&self) -> Result<Vec<Vec<u8>>, &'static str> {
        x509::pem_certificates(self.pck_chain).filter(|certificates| certificates.len() >= 2).ok_or("pck_chain")
    }

    /// The TCB values of the PCK certificate of the quote. No check of the
    /// certificate.
    pub fn pck(&self) -> Result<Pck, &'static str> {
        let certificates = self.pck_certificates()?;
        pck(&Certificate::parse(&certificates[0]).ok_or("pck_certificate")?).ok_or("pck_extension")
    }

    /// The QE report of the quote.
    pub fn qe_report(&self) -> &'a [u8] {
        self.qe_report
    }
}

/// The value (its tag and its contents) with the OID `SGX_EXTENSION`, then
/// `last`, in a `SEQUENCE OF SEQUENCE { OID, value }`.
fn sgx_value<'a>(mut entries: &'a [u8], last: &[u8]) -> Option<(u8, &'a [u8])> {
    while !entries.is_empty() {
        let mut entry = x509::take(&mut entries, x509::SEQUENCE)?;
        let id = x509::take(&mut entry, x509::OBJECT_IDENTIFIER)?;
        let value = x509::element(&mut entry)?;
        if id.strip_prefix(SGX_EXTENSION) == Some(last) {
            return Some(value);
        }
    }
    None
}

/// The FMSPC and the TCB values of a PCK certificate, from its Intel SGX
/// extension.
fn pck(certificate: &Certificate) -> Option<Pck> {
    let entries = x509::only(certificate.extension(SGX_EXTENSION)?, x509::SEQUENCE)?;
    let (_, fmspc) = sgx_value(entries, &[4])?;
    let (tag, tcb) = sgx_value(entries, &[2])?;
    if tag != x509::SEQUENCE {
        return None;
    }
    let (_, cpu_svn) = sgx_value(tcb, &[2, 18])?;
    let pce_svn = match *sgx_value(tcb, &[2, 17])?.1 {
        [low] => u16::from(low),
        [high, low] => u16::from_be_bytes([high, low]),
        _ => return None,
    };
    Some(Pck { fmspc: fmspc.try_into().ok()?, cpu_svn: cpu_svn.try_into().ok()?, pce_svn })
}

fn contains(bytes: &[u8], word: &[u8]) -> bool {
    bytes.windows(word.len()).any(|window| window == word)
}

/// The platform of a quote, before any check: the FMSPC, and the PCK CA
/// (`processor` or `platform`). They select the collateral to ask Intel
/// for. [`verify`] reads them again.
///
/// The CA comes from a word of the issuer name of the PCK certificate, as
/// in `dcap-qvl`: Intel's two names are "Intel SGX PCK Processor CA" and
/// "Intel SGX PCK Platform CA".
pub fn platform(quote: &[u8]) -> Result<([u8; 6], &'static str), &'static str> {
    let certificates = Quote::parse(quote)?.pck_certificates()?;
    let leaf = Certificate::parse(&certificates[0]).ok_or("pck_certificate")?;
    let fmspc = pck(&leaf).ok_or("pck_extension")?.fmspc;
    if contains(leaf.issuer, b"Processor") {
        Ok((fmspc, "processor"))
    } else if contains(leaf.issuer, b"Platform") {
        Ok((fmspc, "platform"))
    } else {
        Err("pck_ca")
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

fn number(value: &Value, key: &str) -> Option<u64> {
    value.get(key)?.as_u64()
}

fn list<'a>(value: &'a Value, key: &str) -> Option<&'a [Value]> {
    value.get(key)?.as_array().map(Vec::as_slice)
}

fn hex_field<const N: usize>(value: &Value, key: &str) -> Option<[u8; N]> {
    from_hex(text(value, key)?)
}

/// True if each bit of `found` that `mask` selects is the bit of
/// `expected`.
fn masked_eq(found: &[u8], expected: &[u8], mask: &[u8]) -> bool {
    found.iter().zip(expected).zip(mask).all(|((found, expected), mask)| found & mask == expected & mask)
}

/// True if `found` is the hex value `key` of `structure`, on the bits of
/// the hex mask `mask_key`.
fn fits<const N: usize>(structure: &Value, found: [u8; N], key: &str, mask_key: &str) -> bool {
    hex_field::<N>(structure, key)
        .zip(hex_field::<N>(structure, mask_key))
        .is_some_and(|(expected, mask)| masked_eq(&found, &expected, &mask))
}

/// A JSON that Intel signed (the TCB info or the QE identity), after these
/// checks: the root issued the signer, the signer signed the exact text,
/// and `now` is between the issue date and the next update.
fn signed_json(
    text_of_json: &str,
    signature: &[u8],
    issuer_chain: &str,
    root: &Certificate,
    root_crl: &Crl,
    now: u64,
) -> Result<Value, &'static str> {
    let certificates = x509::pem_certificates(issuer_chain.as_bytes()).ok_or("issuer_chain")?;
    let signer = Certificate::parse(&certificates[0]).ok_or("issuer_chain")?;
    x509::issued(&signer, root, root_crl, now)?;
    let signature: &[u8; 64] = signature.try_into().map_err(|_| "signature")?;
    if !signer.signed_message(text_of_json.as_bytes(), signature) {
        return Err("signature");
    }
    let value: Value = serde_json::from_slice(text_of_json.as_bytes()).map_err(|_| "malformed")?;
    let time = |key| text(&value, key).and_then(x509::json_time).ok_or("malformed");
    if now < time("issueDate")? {
        return Err("not_yet_valid");
    }
    if now > time("nextUpdate")? {
        return Err("expired");
    }
    Ok(value)
}

/// The status of a platform TCB level with the status of one of its
/// components (the TDX module, or the QE), as Intel's QVL joins them.
fn converge<'a>(status: &'a str, component: &str) -> &'a str {
    match (component, status) {
        ("Revoked", _) => "Revoked",
        ("OutOfDate", "UpToDate" | "SWHardeningNeeded") => "OutOfDate",
        ("OutOfDate", "ConfigurationNeeded" | "ConfigurationAndSWHardeningNeeded") => "OutOfDateConfigurationNeeded",
        _ => status,
    }
}

/// The TCB statuses that Intel's QVL accepts in each structure.
const TCB_INFO_STATUSES: [&str; 7] = [
    "UpToDate",
    "OutOfDate",
    "ConfigurationNeeded",
    "Revoked",
    "OutOfDateConfigurationNeeded",
    "SWHardeningNeeded",
    "ConfigurationAndSWHardeningNeeded",
];
const TDX_MODULE_STATUSES: [&str; 3] = ["UpToDate", "OutOfDate", "Revoked"];
const QE_IDENTITY_STATUSES: [&str; 5] =
    ["UpToDate", "OutOfDate", "ConfigurationNeeded", "Revoked", "OutOfDateConfigurationNeeded"];

/// The `tcbStatus` of a TCB level, if it is one of `known`.
fn status_of<'a>(level: &'a Value, known: &[&str]) -> Option<&'a str> {
    text(level, "tcbStatus").filter(|status| known.contains(status))
}

/// The SVNs of a platform TCB level, in the order of `dcap-qvl`: the SGX
/// components, the PCE SVN, the TDX components.
type LevelSvns = ([u8; 16], u64, [u8; 16]);

/// The 16 SVNs of `sgxtcbcomponents` or `tdxtcbcomponents`.
fn svns(tcb: &Value, key: &str) -> Option<[u8; 16]> {
    let components = list(tcb, key)?;
    let mut svns = [0; 16];
    if components.len() != svns.len() {
        return None;
    }
    for (svn, component) in svns.iter_mut().zip(components) {
        *svn = number(component, "svn")?.try_into().ok()?;
    }
    Some(svns)
}

/// The TDX module identity for the module version of a TD (`tee_tcb_svn[1]`).
/// No identity for version 0. An error if the TCB info does not have the
/// identity of the version.
fn module_identity<'a>(tcb_info: &'a Value, tee_tcb_svn: &[u8; 16]) -> Result<Option<&'a Value>, &'static str> {
    if tee_tcb_svn[1] == 0 {
        return Ok(None);
    }
    let wanted = format!("TDX_{:02X}", tee_tcb_svn[1]);
    list(tcb_info, "tdxModuleIdentities")
        .unwrap_or_default()
        .iter()
        .find(|identity| text(identity, "id").is_some_and(|id| id.eq_ignore_ascii_case(&wanted)))
        .map(Some)
        .ok_or("no_module_identity")
}

/// The TCB status of a TD on a platform, from a TCB info whose signature
/// is checked: the status of the platform TCB level, joined with the status
/// of the TDX module. It also checks the signer and the attributes of the
/// TDX module.
pub fn tcb_status(tcb_info: &Value, pck: &Pck, report: &TdReport) -> Result<String, &'static str> {
    if hex_field::<6>(tcb_info, "fmspc") != Some(pck.fmspc) {
        return Err("fmspc");
    }
    if text(tcb_info, "id") != Some("TDX") || number(tcb_info, "version").is_none_or(|version| version < 3) {
        return Err("not_tdx");
    }
    let svn = &report.tee_tcb_svn;

    // The platform TCB level: the highest level whose SVNs the platform
    // meets. `dcap-qvl` sorts the levels from the highest and takes the
    // first one; this is the same level. With a TDX module version above 0,
    // the first two TDX SVNs belong to the module, not to the level.
    let skip = if svn[1] > 0 { 2 } else { 0 };
    let mut best: Option<(LevelSvns, &Value)> = None;
    for level in list(tcb_info, "tcbLevels").ok_or("malformed")? {
        let tcb = level.get("tcb").ok_or("malformed")?;
        let sgx = svns(tcb, "sgxtcbcomponents").ok_or("malformed")?;
        let tdx = svns(tcb, "tdxtcbcomponents").ok_or("malformed")?;
        let pce = number(tcb, "pcesvn").filter(|&pce| pce <= u64::from(u16::MAX)).ok_or("malformed")?;
        let met = pck.cpu_svn.iter().zip(&sgx).all(|(have, needs)| have >= needs)
            && u64::from(pck.pce_svn) >= pce
            && svn.iter().zip(&tdx).skip(skip).all(|(have, needs)| have >= needs);
        let key = (sgx, pce, tdx);
        if met && best.as_ref().is_none_or(|(highest, _)| key > *highest) {
            best = Some((key, level));
        }
    }
    let (_, level) = best.ok_or("no_tcb_level")?;
    let mut status = status_of(level, &TCB_INFO_STATUSES).ok_or("tcb_status")?;

    // The TCB level of the TDX module: the first one that the module SVN
    // (`tee_tcb_svn[0]`) meets.
    let identity = module_identity(tcb_info, svn)?;
    if let Some(identity) = identity {
        let mut module_level = None;
        for level in list(identity, "tcbLevels").ok_or("malformed")? {
            let needs = level.get("tcb").and_then(|tcb| number(tcb, "isvsvn")).ok_or("malformed")?;
            if module_level.is_none() && u64::from(svn[0]) >= needs {
                module_level = Some(level);
            }
        }
        let module_status =
            status_of(module_level.ok_or("module_svn")?, &TDX_MODULE_STATUSES).ok_or("module_status")?;
        status = converge(status, module_status);
    }

    // The signer and the attributes of the TDX module: the ones of the
    // identity of its version, or else the ones of `tdxModule`.
    let read = |module: &Value| -> Option<([u8; 48], [u8; 8], [u8; 8])> {
        Some((hex_field(module, "mrsigner")?, hex_field(module, "attributes")?, hex_field(module, "attributesMask")?))
    };
    let base = read(tcb_info.get("tdxModule").ok_or("no_tdx_module")?).ok_or("malformed")?;
    let (mrsigner, attributes, mask) = match identity {
        Some(identity) => read(identity).ok_or("malformed")?,
        None => base,
    };
    if report.mr_signer_seam != mrsigner {
        return Err("module_signer");
    }
    // The bits of the mask are the expected ones, and no other bit is set.
    let outside_mask = report.seam_attributes.iter().zip(&mask).any(|(found, mask)| found & !mask != 0);
    if outside_mask || !masked_eq(&report.seam_attributes, &attributes, &mask) {
        return Err("module_attributes");
    }
    Ok(status.to_string())
}

/// The TCB status of the QE, from a QE identity whose signature is checked
/// and from the QE report of the quote. It also checks that the QE is
/// Intel's TDX QE: its signer, its product, its attributes, and no debug
/// enclave.
pub fn qe_tcb_status(identity: &Value, qe_report: &[u8]) -> Result<String, &'static str> {
    if qe_report.len() != QE_REPORT_LENGTH {
        return Err("malformed");
    }
    let version = number(identity, "version");
    if text(identity, "id") != Some("TD_QE") || (version != Some(2) && version != Some(3)) {
        return Err("not_td_qe");
    }
    if hex_field::<32>(identity, "mrsigner") != Some(field(qe_report, 128)) {
        return Err("mrsigner");
    }
    let attributes: [u8; 16] = field(qe_report, 48);
    if attributes[0] & 0x02 != 0 {
        return Err("debug");
    }
    if number(identity, "isvprodid") != Some(u64::from(u16::from_le_bytes(field(qe_report, 256)))) {
        return Err("isvprodid");
    }
    if !fits(identity, field::<4>(qe_report, 16), "miscselect", "miscselectMask") {
        return Err("miscselect");
    }
    if !fits(identity, attributes, "attributes", "attributesMask") {
        return Err("attributes");
    }
    // The first TCB level that the SVN of the QE meets.
    let isv_svn = u64::from(u16::from_le_bytes(field(qe_report, 258)));
    let mut found = None;
    for level in list(identity, "tcbLevels").ok_or("malformed")? {
        let needs = level.get("tcb").and_then(|tcb| number(tcb, "isvsvn")).ok_or("malformed")?;
        if found.is_none() && isv_svn >= needs {
            found = Some(level);
        }
    }
    status_of(found.ok_or("isvsvn")?, &QE_IDENTITY_STATUSES).map(str::to_string).ok_or("tcb_status")
}

/// The bits `first..=last` of a `u64`.
const fn bits(first: u32, last: u32) -> u64 {
    (u64::MAX << first) & !(u64::MAX << last << 1)
}

/// The TD attributes that must be zero (Intel TDX Module ABI specification
/// 348551-008US, table 3.23).
const TD_ATTRIBUTES_RESERVED: u64 = bits(1, 3) | bits(7, 15) | bits(23, 26) | bits(32, 61);

/// Refuses a TD that the host can read or move: a debug TD, a TD with
/// profiling, with migration or with a service TD, and a TD without
/// SEPT_VE_DISABLE.
fn check_td_attributes(td_attributes: [u8; 8]) -> Result<(), &'static str> {
    let attributes = u64::from_le_bytes(td_attributes);
    let bit = |bit: u32| attributes & bits(bit, bit) != 0;
    if bit(0) {
        Err("debug_td")
    } else if attributes & bits(4, 6) != 0 {
        Err("td_profiling")
    } else if attributes & TD_ATTRIBUTES_RESERVED != 0 {
        Err("td_attributes_reserved")
    } else if bit(29) {
        Err("td_migratable")
    } else if bit(17) {
        Err("td_service_td")
    } else if !bit(28) {
        Err("td_sept_ve_disable")
    } else {
        Ok(())
    }
}

/// An error with the part of the check that it comes from.
fn at(part: &'static str) -> impl Fn(&'static str) -> String {
    move |error| format!("{part}: {error}")
}

/// Checks `quote` with `collateral` at `now` (seconds since the UNIX
/// epoch). See the module text. The error is a short text for a log.
pub fn verify(quote: &[u8], collateral: &Collateral, now: u64) -> Result<Verified, String> {
    let quote = Quote::parse(quote)?;

    let root = Certificate::parse(INTEL_ROOT_CA_DER).ok_or("root")?;
    let root_crl = Crl::checked(&collateral.root_ca_crl, &root, now).map_err(at("root_crl"))?;
    x509::issued(&root, &root, &root_crl, now).map_err(at("root"))?;

    let tcb_info = signed_json(
        &collateral.tcb_info,
        &collateral.tcb_info_signature,
        &collateral.tcb_info_issuer_chain,
        &root,
        &root_crl,
        now,
    )
    .map_err(at("tcb_info"))?;
    let qe_identity = signed_json(
        &collateral.qe_identity,
        &collateral.qe_identity_signature,
        &collateral.qe_identity_issuer_chain,
        &root,
        &root_crl,
        now,
    )
    .map_err(at("qe_identity"))?;

    let certificates = quote.pck_certificates()?;
    let leaf = Certificate::parse(&certificates[0]).ok_or("pck_certificate")?;
    let ca = Certificate::parse(&certificates[1]).ok_or("pck_ca_certificate")?;
    x509::issued_ca(&ca, &root, &root_crl, now).map_err(at("pck_ca"))?;
    let pck_crl = Crl::checked(&collateral.pck_crl, &ca, now).map_err(at("pck_crl"))?;
    x509::issued(&leaf, &ca, &pck_crl, now).map_err(at("pck"))?;

    if !leaf.signed_message(quote.qe_report, &quote.qe_report_signature) {
        return Err("qe_report_signature".into());
    }
    // The QE report binds the attestation key: its report data starts with
    // SHA-256(attestation key || QE authentication data).
    if quote.qe_auth_data.len() != 32 {
        return Err("qe_auth_data".into());
    }
    let bound = sha256(&[quote.attestation_key, quote.qe_auth_data].concat());
    if field::<32>(quote.qe_report, 320) != bound {
        return Err("qe_report_data".into());
    }
    let qe_status = qe_tcb_status(&qe_identity, quote.qe_report).map_err(at("qe"))?;

    let mut attestation_key = [0x04; 65];
    attestation_key[1..].copy_from_slice(quote.attestation_key);
    if !x509::verify(&attestation_key, quote.signed, &quote.signature) {
        return Err("signature".into());
    }

    let pck = pck(&leaf).ok_or("pck_extension")?;
    let platform_status = tcb_status(&tcb_info, &pck, &quote.report).map_err(at("tcb"))?;
    let tcb_status = converge(&platform_status, &qe_status);
    // A revoked TCB means that keys of the platform are not secret.
    if tcb_status == "Revoked" {
        return Err("tcb: revoked".into());
    }
    check_td_attributes(quote.report.td_attributes)?;
    Ok(Verified { tcb_status: tcb_status.to_string(), report: quote.report })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_statuses_join_as_in_intels_qvl() {
        for (platform, component, expected) in [
            ("UpToDate", "OutOfDate", "OutOfDate"),
            ("SWHardeningNeeded", "OutOfDate", "OutOfDate"),
            ("ConfigurationAndSWHardeningNeeded", "OutOfDate", "OutOfDateConfigurationNeeded"),
            ("ConfigurationNeeded", "OutOfDate", "OutOfDateConfigurationNeeded"),
            ("OutOfDateConfigurationNeeded", "OutOfDate", "OutOfDateConfigurationNeeded"),
            ("OutOfDate", "OutOfDate", "OutOfDate"),
            ("ConfigurationNeeded", "Revoked", "Revoked"),
            ("UpToDate", "ConfigurationNeeded", "UpToDate"),
            ("UpToDate", "OutOfDateConfigurationNeeded", "UpToDate"),
            ("SWHardeningNeeded", "UpToDate", "SWHardeningNeeded"),
        ] {
            assert_eq!(converge(platform, component), expected, "{platform} with {component}");
        }
    }

    #[test]
    fn the_td_attributes() {
        let check = |attributes: u64| check_td_attributes(attributes.to_le_bytes());
        let good = 1 << 28;
        assert_eq!(check(good), Ok(()));
        assert_eq!(check(0), Err("td_sept_ve_disable"));
        assert_eq!(check(good | 1), Err("debug_td"));
        assert_eq!(check(good | 1 << 4), Err("td_profiling"));
        assert_eq!(check(good | 1 << 17), Err("td_service_td"));
        assert_eq!(check(good | 1 << 29), Err("td_migratable"));
        // Each reserved bit fails; each other bit above the first byte, but
        // the two above, passes.
        assert_eq!(TD_ATTRIBUTES_RESERVED, 0x3fff_ffff_0780_ff8e);
        for bit in 1..64 {
            let expected = match bit {
                1..=3 | 7..=15 | 23..=26 | 32..=61 => Err("td_attributes_reserved"),
                4..=6 => Err("td_profiling"),
                17 => Err("td_service_td"),
                29 => Err("td_migratable"),
                _ => Ok(()),
            };
            assert_eq!(check(good | 1 << bit), expected, "bit {bit}");
        }
    }

    #[test]
    fn a_short_or_other_quote_is_refused() {
        let mut quote = vec![0; 700];
        assert_eq!(Quote::parse(&quote[..40]).err(), Some("malformed"));
        assert_eq!(Quote::parse(&quote).err(), Some("version"));
        quote[0] = 5;
        assert_eq!(Quote::parse(&quote).err(), Some("version"));
        quote[0] = 4;
        assert_eq!(Quote::parse(&quote).err(), Some("key_type"));
        quote[2] = 2;
        assert_eq!(Quote::parse(&quote).err(), Some("not_tdx"));
        quote[4] = 0x81;
        assert_eq!(Quote::parse(&quote).err(), Some("qe_vendor"));
        quote[12..28].copy_from_slice(&INTEL_QE_VENDOR_ID);
        assert_eq!(Quote::parse(&quote).err(), Some("malformed"));
    }
}
