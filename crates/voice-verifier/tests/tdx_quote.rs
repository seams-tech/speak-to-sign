//! The TDX quote check of the worker (`src/tdx_quote.rs`) against
//! `dcap-qvl` 0.7.1 (a dev-dependency), on the two recorded NEAR AI quotes
//! and Intel's recorded collateral (`testdata/nearai_report_v1.json`,
//! `testdata/nearai_collateral_v1.json`). No network.
//!
//! Each test gives the same input to both and compares the decision. The
//! inputs are the recorded ones, and the recorded ones with a change: one
//! bit of the quote, one bit of the collateral, another time, and another
//! TCB info.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use dcap_qvl::QuoteCollateralV3;
use serde_json::{json, Value};

use seams_voice_verifier::host::Reply;
use seams_voice_verifier::nearai_attestation::{collateral, collateral_requests, parse_report, platform};
use seams_voice_verifier::tdx_quote::{self, Collateral, Quote};

/// One recorded quote with its collateral.
struct Case {
    quote: Vec<u8>,
    collateral: Collateral,
}

/// The gateway quote and the model quote, and the time of the recording in
/// seconds.
fn recorded() -> ([Case; 2], u64) {
    let report = parse_report(200, include_bytes!("../testdata/nearai_report_v1.json")).unwrap();
    let recorded: Value = serde_json::from_str(include_str!("../testdata/nearai_collateral_v1.json")).unwrap();
    let quotes = [report.gateway.quote, report.model.quote];
    let platforms = [platform(&quotes[0]).unwrap(), platform(&quotes[1]).unwrap()];
    let requests = collateral_requests(&platforms);
    let replies = requests
        .iter()
        .map(|request| {
            let reply = recorded["replies"].as_array().unwrap().iter().find(|reply| reply["url"] == request.url);
            let reply = reply.expect("the URL is in the recording");
            let pair = |pair: &Value| (pair[0].as_str().unwrap().to_string(), pair[1].as_str().unwrap().to_string());
            Ok(Reply {
                status: 200,
                headers: reply["headers"].as_array().unwrap().iter().map(pair).collect(),
                body: STANDARD.decode(reply["body_b64"].as_str().unwrap()).unwrap(),
            })
        })
        .collect();
    let mut collaterals = collateral(&platforms, &requests, replies).unwrap().into_iter();
    let cases = quotes.map(|quote| Case { quote, collateral: collaterals.next().unwrap() });
    (cases, recorded["checked_at_ms"].as_u64().unwrap() / 1000)
}

/// The same collateral for `dcap-qvl`.
fn reference(collateral: &Collateral) -> QuoteCollateralV3 {
    QuoteCollateralV3 {
        pck_crl_issuer_chain: String::new(),
        root_ca_crl: collateral.root_ca_crl.clone(),
        pck_crl: collateral.pck_crl.clone(),
        tcb_info_issuer_chain: collateral.tcb_info_issuer_chain.clone(),
        tcb_info: collateral.tcb_info.clone(),
        tcb_info_signature: collateral.tcb_info_signature.clone(),
        qe_identity_issuer_chain: collateral.qe_identity_issuer_chain.clone(),
        qe_identity: collateral.qe_identity.clone(),
        qe_identity_signature: collateral.qe_identity_signature.clone(),
        pck_certificate_chain: None,
    }
}

/// What the two verifiers decide for one input.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Decision {
    BothAccept,
    BothRefuse,
    /// The worker refuses an input that `dcap-qvl` accepts.
    OnlyDcapQvlAccepts,
}

/// Gives the input to both verifiers. If both accept, their results are
/// the same. The worker never accepts an input that `dcap-qvl` refuses.
fn decide(quote: &[u8], collateral: &Collateral, now: u64, what: &str) -> Decision {
    let ours = tdx_quote::verify(quote, collateral, now);
    let theirs = dcap_qvl::verify::rustcrypto::verify(quote, &reference(collateral), now);
    match (ours, theirs) {
        (Ok(ours), Ok(theirs)) => {
            assert_eq!(ours.tcb_status, theirs.status, "{what}");
            let report = theirs.report.as_td10().unwrap();
            assert_eq!(ours.report.tee_tcb_svn, report.tee_tcb_svn, "{what}");
            assert_eq!(ours.report.mr_signer_seam, report.mr_signer_seam, "{what}");
            assert_eq!(ours.report.seam_attributes, report.seam_attributes, "{what}");
            assert_eq!(ours.report.td_attributes, report.td_attributes, "{what}");
            assert_eq!(ours.report.mr_td, report.mr_td, "{what}");
            assert_eq!(ours.report.mr_config_id, report.mr_config_id, "{what}");
            assert_eq!(ours.report.report_data, report.report_data, "{what}");
            Decision::BothAccept
        }
        (Err(_), Err(_)) => Decision::BothRefuse,
        (Err(_), Ok(_)) => Decision::OnlyDcapQvlAccepts,
        (Ok(ours), Err(theirs)) => panic!("{what}: the worker accepts ({ours:?}), dcap-qvl refuses: {theirs:#}"),
    }
}

#[test]
fn the_recorded_quotes_pass_with_the_same_result() {
    let (cases, now) = recorded();
    for case in &cases {
        assert_eq!(decide(&case.quote, &case.collateral, now, "recorded"), Decision::BothAccept);
        let verified = tdx_quote::verify(&case.quote, &case.collateral, now).unwrap();
        assert_eq!(verified.tcb_status, "UpToDate");
    }
    // The collateral of the other platform does not pass.
    assert_eq!(decide(&cases[0].quote, &cases[1].collateral, now, "other platform"), Decision::BothRefuse);
    assert_eq!(decide(&cases[1].quote, &cases[0].collateral, now, "other platform"), Decision::BothRefuse);
}

/// Each bit position that a test changes in a byte.
const MASKS: [u8; 3] = [0x01, 0x10, 0x80];

/// Counts of the decisions of a test, and the inputs that only `dcap-qvl`
/// accepts.
#[derive(Default)]
struct Tally {
    accept: usize,
    refuse: usize,
    only_dcap_qvl: Vec<String>,
}

impl Tally {
    fn add(&mut self, decision: Decision, what: String) {
        match decision {
            Decision::BothAccept => self.accept += 1,
            Decision::BothRefuse => self.refuse += 1,
            Decision::OnlyDcapQvlAccepts => self.only_dcap_qvl.push(what),
        }
    }
}

#[test]
fn a_changed_quote_gets_the_same_decision() {
    let (cases, now) = recorded();
    for (name, case) in ["gateway", "model"].into_iter().zip(&cases) {
        let mut tally = Tally::default();
        // Each byte before the certificate chain, and each seventh byte of
        // the chain (4,000 bytes of PEM).
        let type_of_certification = 48 + 584 + 4 + 64 + 64;
        let chain = type_of_certification + 6 + 384 + 64 + 2 + 32 + 6;
        for (count, index) in (0..chain).chain((chain..case.quote.len()).step_by(7)).enumerate() {
            let mask = MASKS[count % MASKS.len()];
            let mut quote = case.quote.clone();
            quote[index] ^= mask;
            let what = format!("{name} quote byte {index} mask {mask:#04x}");
            let decision = decide(&quote, &case.collateral, now, &what);
            // The worker is more strict in two places, which no signature
            // covers: the type of the certification data (`dcap-qvl` does
            // not read it), and the text around the certificates of the
            // chain.
            if decision == Decision::OnlyDcapQvlAccepts {
                let more_strict = index >= chain || (type_of_certification..type_of_certification + 2).contains(&index);
                assert!(more_strict, "{what}");
            }
            // No change before the chain passes: a signature or a hash
            // covers each of those bytes. In the chain, a change passes in
            // the root certificate, which both verifiers replace with
            // their own copy.
            if decision == Decision::BothAccept {
                assert!(index >= chain, "{what}");
            }
            tally.add(decision, what);
        }
        // A cut quote. The recorded quotes have zero bytes after their
        // signature data, which neither verifier needs.
        let length_of_data = u32::from_le_bytes(case.quote[632..636].try_into().unwrap()) as usize;
        let complete = 636 + length_of_data;
        assert!(complete < case.quote.len());
        for length in (0..case.quote.len()).step_by(97).chain([complete - 1, complete]) {
            let what = format!("{name} quote of {length} bytes");
            let expected = if length < complete { Decision::BothRefuse } else { Decision::BothAccept };
            assert_eq!(decide(&case.quote[..length], &case.collateral, now, &what), expected, "{what}");
        }
        eprintln!(
            "{name}: {} accepted by both, {} refused by both, {} refused by the worker only",
            tally.accept,
            tally.refuse,
            tally.only_dcap_qvl.len()
        );
        assert!(tally.refuse > 1_500, "{}", tally.refuse);
        assert!(tally.only_dcap_qvl.len() < 30, "{:?}", tally.only_dcap_qvl);
    }
}

#[test]
fn changed_collateral_gets_the_same_decision() {
    let (cases, now) = recorded();
    let case = &cases[0];
    let mut tally = Tally::default();
    let mut check = |collateral: &Collateral, what: String| {
        tally.add(decide(&case.quote, collateral, now, &what), what);
    };
    type Bytes = fn(&mut Collateral) -> &mut Vec<u8>;
    let binary: [(&str, Bytes); 4] = [
        ("root_ca_crl", |collateral| &mut collateral.root_ca_crl),
        ("pck_crl", |collateral| &mut collateral.pck_crl),
        ("tcb_info_signature", |collateral| &mut collateral.tcb_info_signature),
        ("qe_identity_signature", |collateral| &mut collateral.qe_identity_signature),
    ];
    for (name, part) in binary {
        let length = part(&mut case.collateral.clone()).len();
        for index in (0..length).step_by(if length > 1_000 { 5 } else { 1 }) {
            let mut collateral = case.collateral.clone();
            let mask = MASKS[index % MASKS.len()];
            part(&mut collateral)[index] ^= mask;
            check(&collateral, format!("{name} byte {index} mask {mask:#04x}"));
        }
        for length in [0, 1, length / 2, length - 1] {
            let mut collateral = case.collateral.clone();
            part(&mut collateral).truncate(length);
            check(&collateral, format!("{name} of {length} bytes"));
        }
    }
    type Text = fn(&mut Collateral) -> &mut String;
    let texts: [(&str, Text); 4] = [
        ("tcb_info", |collateral| &mut collateral.tcb_info),
        ("qe_identity", |collateral| &mut collateral.qe_identity),
        ("tcb_info_issuer_chain", |collateral| &mut collateral.tcb_info_issuer_chain),
        ("qe_identity_issuer_chain", |collateral| &mut collateral.qe_identity_issuer_chain),
    ];
    for (name, part) in texts {
        let length = part(&mut case.collateral.clone()).len();
        for index in (0..length).step_by(if length > 1_000 { 7 } else { 1 }) {
            let mut collateral = case.collateral.clone();
            let text = part(&mut collateral);
            // Another ASCII character at this place.
            let other = if text.as_bytes()[index] == b'B' { "C" } else { "B" };
            text.replace_range(index..index + 1, other);
            check(&collateral, format!("{name} character {index}"));
        }
        let mut collateral = case.collateral.clone();
        part(&mut collateral).clear();
        check(&collateral, format!("{name} empty"));
    }
    eprintln!("{} accepted by both, {} refused by both", tally.accept, tally.refuse);
    assert!(tally.refuse > 2_000, "{}", tally.refuse);
    // The inputs that only `dcap-qvl` accepts are changes in the root
    // certificate of an issuer chain, or in the text between its
    // certificates. The worker reads that text more strictly.
    for what in &tally.only_dcap_qvl {
        assert!(what.contains("issuer_chain"), "{what}");
    }
}

/// The first and the last second at which `accepts` is true, around
/// `now`, where it is true.
fn accepted_seconds(now: u64, accepts: impl Fn(u64) -> bool) -> (u64, u64) {
    assert!(accepts(now));
    let (mut refused, mut first) = (0, now);
    while first - refused > 1 {
        let middle = refused + (first - refused) / 2;
        if accepts(middle) {
            first = middle;
        } else {
            refused = middle;
        }
    }
    let (mut last, mut refused) = (now, now + 100 * 365 * 86_400);
    assert!(!accepts(refused));
    while refused - last > 1 {
        let middle = last + (refused - last) / 2;
        if accepts(middle) {
            last = middle;
        } else {
            refused = middle;
        }
    }
    (first, last)
}

#[test]
fn the_same_seconds_are_accepted() {
    let (cases, now) = recorded();
    for case in &cases {
        let reference = reference(&case.collateral);
        let ours = accepted_seconds(now, |at| tdx_quote::verify(&case.quote, &case.collateral, at).is_ok());
        let theirs =
            accepted_seconds(now, |at| dcap_qvl::verify::rustcrypto::verify(&case.quote, &reference, at).is_ok());
        assert_eq!(ours, theirs);
        // The collateral of Intel is good for 30 days.
        assert!(ours.1 - ours.0 > 29 * 86_400 && ours.1 - ours.0 <= 30 * 86_400, "{ours:?}");
        // Samples on the two sides of each end, and far away.
        for at in [0, ours.0 - 86_400, ours.0 - 1, ours.0, ours.1, ours.1 + 1, ours.1 + 86_400, u64::from(u32::MAX)] {
            let expected = if (ours.0..=ours.1).contains(&at) { Decision::BothAccept } else { Decision::BothRefuse };
            assert_eq!(decide(&case.quote, &case.collateral, at, "time"), expected, "{at}");
        }
    }
}

/// A fixed sequence of numbers for the choices of a test.
struct Sequence(u64);

impl Sequence {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) as usize) % below
    }
}

const STATUSES: [&str; 10] = [
    "UpToDate",
    "OutOfDate",
    "ConfigurationNeeded",
    "Revoked",
    "OutOfDateConfigurationNeeded",
    "SWHardeningNeeded",
    "ConfigurationAndSWHardeningNeeded",
    // Statuses that Intel's QVL does not accept in a TCB info.
    "TDRelaunchAdvised",
    "TDRelaunchAdvisedConfigurationNeeded",
    // No status of Intel.
    "Unknown",
];

/// One change of a TCB info, chosen by `sequence`.
fn change_tcb_info(info: &mut Value, sequence: &mut Sequence) -> String {
    let levels = info["tcbLevels"].as_array().unwrap().len();
    let level = sequence.next(levels);
    let identities = info["tdxModuleIdentities"].as_array().map_or(0, Vec::len);
    match sequence.next(16) {
        0 | 1 => {
            let status = STATUSES[sequence.next(STATUSES.len())];
            info["tcbLevels"][level]["tcbStatus"] = json!(status);
            format!("level {level} status {status}")
        }
        2 | 3 => {
            let (kind, component) = (["sgxtcbcomponents", "tdxtcbcomponents"][sequence.next(2)], sequence.next(16));
            let svn = [0, 1, 2, 3, 4, 5, 8, 9, 13, 14, 255][sequence.next(11)];
            info["tcbLevels"][level]["tcb"][kind][component]["svn"] = json!(svn);
            format!("level {level} {kind} {component} svn {svn}")
        }
        4 => {
            let svn = [0, 5, 12, 13, 14, 65_535][sequence.next(6)];
            info["tcbLevels"][level]["tcb"]["pcesvn"] = json!(svn);
            format!("level {level} pcesvn {svn}")
        }
        5 => {
            info["tcbLevels"].as_array_mut().unwrap().reverse();
            "levels reversed".into()
        }
        6 => {
            let moved = info["tcbLevels"].as_array_mut().unwrap().remove(level);
            info["tcbLevels"].as_array_mut().unwrap().push(moved);
            format!("level {level} moved to the end")
        }
        7 => {
            // The same SVNs two times, with another status.
            let mut copy = info["tcbLevels"][level].clone();
            copy["tcbStatus"] = json!(STATUSES[sequence.next(7)]);
            let at = sequence.next(levels + 1);
            info["tcbLevels"].as_array_mut().unwrap().insert(at, copy);
            format!("level {level} copied to {at}")
        }
        8 => {
            info["tcbLevels"].as_array_mut().unwrap().remove(level);
            format!("level {level} removed")
        }
        9 | 10 if identities > 0 => {
            let identity = sequence.next(identities);
            let module_levels = info["tdxModuleIdentities"][identity]["tcbLevels"].as_array().unwrap().len();
            let module_level = sequence.next(module_levels);
            let target = &mut info["tdxModuleIdentities"][identity]["tcbLevels"][module_level];
            if sequence.next(2) == 0 {
                let status = STATUSES[sequence.next(STATUSES.len())];
                target["tcbStatus"] = json!(status);
                format!("module {identity} level {module_level} status {status}")
            } else {
                let svn = [0, 3, 9, 10, 13, 14, 255][sequence.next(7)];
                target["tcb"]["isvsvn"] = json!(svn);
                format!("module {identity} level {module_level} isvsvn {svn}")
            }
        }
        11 if identities > 0 => {
            let identity = sequence.next(identities);
            let id = ["TDX_01", "TDX_03", "tdx_03", "TDX_02", "TDX_1"][sequence.next(5)];
            info["tdxModuleIdentities"][identity]["id"] = json!(id);
            format!("module {identity} id {id}")
        }
        12 => {
            let target = match sequence.next(3) {
                0 => &mut info["tdxModule"],
                _ if identities > 0 => &mut info["tdxModuleIdentities"][sequence.next(identities)],
                _ => &mut info["tdxModule"],
            };
            let (key, value) = [
                ("mrsigner", "01".repeat(48)),
                ("mrsigner", "00".repeat(47)),
                ("attributes", "0100000000000000".to_string()),
                ("attributesMask", "0000000000000000".to_string()),
                ("attributesMask", "FFFFFFFFFFFFFF".to_string()),
            ][sequence.next(5)]
            .clone();
            target[key] = json!(value);
            format!("module {key} {value}")
        }
        13 => {
            let (key, value) = [
                ("fmspc", json!("000000000000")),
                ("fmspc", json!("70a06d070000")),
                ("id", json!("SGX")),
                ("version", json!(2)),
                ("version", json!(4)),
                ("tdxModuleIdentities", json!([])),
            ][sequence.next(6)]
            .clone();
            info[key] = value.clone();
            format!("{key} {value}")
        }
        _ => "no change".into(),
    }
}

/// The platform TCB status of each verifier, for a TCB info that replaces
/// the signed one after its signature check. `dcap-qvl` has a feature for
/// this; the worker has the function `tcb_status`.
#[test]
fn another_tcb_info_gets_the_same_status() {
    let (cases, now) = recorded();
    for (name, case) in ["gateway", "model"].into_iter().zip(&cases) {
        let reference = reference(&case.collateral);
        let quote = Quote::parse(&case.quote).unwrap();
        let pck = quote.pck().unwrap();
        let signed: Value = serde_json::from_str(&case.collateral.tcb_info).unwrap();
        let mut sequence = Sequence(0x5eed + case.quote.len() as u64 + u64::from(pck.fmspc[0]));
        let (mut same_status, mut both_refuse, mut statuses) = (0, 0, std::collections::BTreeSet::new());
        for round in 0..700 {
            let mut info = signed.clone();
            let changes: Vec<String> =
                (0..1 + round % 3).map(|_| change_tcb_info(&mut info, &mut sequence)).collect();
            let what = format!("{name}: {}", changes.join(", "));
            let ours = tdx_quote::tcb_status(&info, &pck, &quote.report);
            // `dcap-qvl` reads the TCB info into its types. It fails on a
            // value that its types do not have, such as an unknown status.
            let Ok(typed) = serde_json::from_value::<dcap_qvl::TcbInfo>(info) else {
                assert!(what.contains("Unknown") || what.contains("svn 65535"), "{what}");
                continue;
            };
            let theirs = dcap_qvl::verify::rustcrypto::dangerous_verify_with_tcb_override(
                &case.quote,
                &reference,
                now,
                move |_| typed,
            );
            match (ours, theirs) {
                (Ok(ours), Ok(theirs)) => {
                    assert_eq!(ours, theirs.platform_status.status.to_string(), "{what}");
                    statuses.insert(ours);
                    same_status += 1;
                }
                // `dcap-qvl` refuses a revoked TCB inside its check; the
                // worker does it in `verify`.
                (Ok(ours), Err(theirs)) => {
                    assert!(ours == "Revoked" && format!("{theirs:#}").contains("Revoked"), "{what}: {ours}, {theirs:#}");
                    statuses.insert(ours);
                    same_status += 1;
                }
                (Err(_), Err(_)) => both_refuse += 1,
                (Err(ours), Ok(theirs)) => {
                    panic!("{what}: the worker refuses ({ours}), dcap-qvl gives {}", theirs.platform_status.status)
                }
            }
        }
        eprintln!("{name}: {same_status} with the same status, {both_refuse} refused by both, {statuses:?}");
        assert!(same_status > 200 && both_refuse > 50, "{same_status} {both_refuse}");
        assert!(statuses.len() >= 5, "{statuses:?}");
    }
}
