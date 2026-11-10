//! The binding check and a DCAP verifier together: `dcap-qvl` checks that each
//! real quote of the fixtures chains to Intel's root, with the collateral that
//! Intel PCS gave on 2026-11-10 (stored next to the fixture), and that the
//! quote that it checked is the one that binds the record.
use voice_verdict::{check_attestation_binding, parse_attestation_record, Binding};

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/voice-verdict/tests/fixtures"
);
/// 2026-11-10T18:36:00Z: after the issue date of the stored TCB info
/// (17:27:12Z) and before its next update (2026-12-10).
const CHECKED_AT: u64 = 1_794_335_760;

fn check(name: &str, wasm_hash: &str) -> (Vec<u8>, dcap_qvl::QuoteCollateralV3) {
    let read = |file: String| std::fs::read_to_string(format!("{FIXTURES}/{file}")).unwrap();
    let fixture: serde_json::Value = serde_json::from_str(&read(format!("{name}.json"))).unwrap();
    let collateral = serde_json::from_str(&read(format!("{name}.collateral.json"))).unwrap();
    let record = parse_attestation_record(&fixture["record"].to_string()).unwrap();
    let output = fixture["output"].to_string();
    let bound = check_attestation_binding(&record, &Binding::new(&output, &[wasm_hash])).unwrap();

    let verified = dcap_qvl::verify::verify(&bound.quote, &collateral, CHECKED_AT).unwrap();
    assert_eq!(verified.status, "UpToDate", "{name}");
    assert!(verified.advisory_ids.is_empty(), "{name}");
    let dcap_qvl::quote::Report::TD10(report) = verified.report else {
        panic!("{name}: not a TD 1.0 report");
    };
    // The report that Intel's chain covers is the report that binds the record.
    assert_eq!(
        report.report_data[..32],
        voice_verdict::attestation::task_hash(&record),
        "{name}"
    );
    assert_eq!(report.mr_td, bound.measurements.mrtd, "{name}");
    assert_eq!(report.rt_mr3, bound.measurements.rtmr3, "{name}");
    (bound.quote, collateral)
}

#[test]
fn the_real_quotes_chain_to_intel_and_bind_their_records() {
    check(
        "outlayer_attestation_testnet",
        "96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5",
    );
    let (quote, collateral) = check(
        "outlayer_attestation_0_11_0",
        "d2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8",
    );

    // A changed byte in the TD report (report data) breaks the quote signature.
    let mut changed = quote.clone();
    changed[48 + 520] ^= 1;
    assert!(dcap_qvl::verify::verify(&changed, &collateral, CHECKED_AT).is_err());
    // After the expiry of the stored TCB info, the collateral is too old.
    assert!(dcap_qvl::verify::verify(&quote, &collateral, CHECKED_AT + 40 * 86_400).is_err());
}
