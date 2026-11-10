//! A real attestation of one verifier call on OutLayer testnet: the fixture
//! of the TypeScript package (see its comment). The same cases as
//! `packages/voice-verdict/tests/attestation.test.ts`.
use serde_json::{Map, Value};
use voice_verdict::attestation::{parse_tdx_quote, task_hash, NOT_CHECKED};
use voice_verdict::{
    check_attestation_binding, parse_attestation_record, AttestationRecord, AttestationRefusal,
    Binding,
};

const FIXTURE: &str = include_str!(
    "../../../packages/voice-verdict/tests/fixtures/outlayer_attestation_testnet.json"
);
/// Verifier 0.5.2, the active version on testnet at the time.
const WASM_0_5_2: &str = "96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5";
const ACCEPTED: &[&str] = &[WASM_0_5_2];

struct Fixture {
    record: AttestationRecord,
    record_value: Value,
    output: Map<String, Value>,
    input_json: String,
}

fn fixture() -> Fixture {
    let value: Value = serde_json::from_str(FIXTURE).unwrap();
    let record_value = value["record"].clone();
    Fixture {
        record: parse_attestation_record(&record_value.to_string()).unwrap(),
        record_value,
        output: value["output"].as_object().unwrap().clone(),
        input_json: value["input"].to_string(),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn output_json(output: &Map<String, Value>) -> String {
    Value::Object(output.clone()).to_string()
}

#[test]
fn the_quote_commits_to_the_record_and_the_record_to_the_output_and_the_wasm() {
    let fixture = fixture();
    let output = output_json(&fixture.output);
    let bound = check_attestation_binding(
        &fixture.record,
        &Binding::new(&output, ACCEPTED)
            .input(&fixture.input_json)
            .project("seams-v1.testnet/voice-verifier")
            .caller("cyan-loong.testnet"),
    )
    .unwrap();
    assert_eq!(bound.wasm_hash, WASM_0_5_2);
    assert_eq!(bound.quote.len(), 5006);
    // RTMR3 is the `worker_measurement` of the record.
    assert_eq!(
        hex(&bound.measurements.rtmr3),
        fixture.record_value["worker_measurement"].as_str().unwrap()
    );
    assert_eq!(NOT_CHECKED, ["quote_signature", "measurements_approved"]);

    // The view arguments of the worker contract hold the five measurements.
    let args: Value = serde_json::from_str(&bound.measurements.view_args()).unwrap();
    let measurements = args["measurements"].as_object().unwrap();
    assert_eq!(measurements.len(), 5);
    assert_eq!(
        measurements["mrtd"].as_str().unwrap(),
        hex(&bound.measurements.mrtd)
    );
    for value in measurements.values() {
        let text = value.as_str().unwrap();
        assert_eq!(text.len(), 96);
        assert!(text
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
    }

    // The key order and the spaces of the output text do not matter.
    let reversed: String = {
        let pairs: Vec<String> = fixture
            .output
            .iter()
            .rev()
            .map(|(key, value)| format!("{} : {value}", Value::String(key.clone())))
            .collect();
        format!("{{ {} }}", pairs.join(" , "))
    };
    assert!(check_attestation_binding(&fixture.record, &Binding::new(&reversed, ACCEPTED)).is_ok());
}

#[test]
fn the_task_hash_is_the_first_32_bytes_of_the_report_data() {
    use base64::Engine;
    let fixture = fixture();
    let quote = base64::engine::general_purpose::STANDARD
        .decode(&fixture.record.tdx_quote)
        .unwrap();
    let parsed = parse_tdx_quote(&quote).unwrap();
    assert_eq!(parsed.version, 4);
    assert_eq!(parsed.report_data[..32], task_hash(&fixture.record));
    assert!(parsed.report_data[32..].iter().all(|byte| *byte == 0));
}

#[test]
fn each_changed_link_is_refused() {
    let fixture = fixture();
    let output = output_json(&fixture.output);
    let code = |record: &AttestationRecord, binding: &Binding| match check_attestation_binding(
        record, binding,
    ) {
        Ok(_) => "ok",
        Err(refusal) => refusal.code(),
    };
    let good = Binding::new(&output, ACCEPTED);

    let mut changed_output = fixture.output.clone();
    changed_output.insert("reason".into(), "words".into());
    let changed_output = output_json(&changed_output);
    assert_eq!(
        code(&fixture.record, &Binding::new(&changed_output, ACCEPTED)),
        "output_mismatch"
    );
    assert_eq!(
        code(&fixture.record, &good.input(r#"{"op":"verify"}"#)),
        "input_mismatch"
    );
    // The input hash is over the text as it was sent: a space changes it.
    assert_eq!(
        code(&fixture.record, &good.input(r#"{"op": "probe"}"#)),
        "input_mismatch"
    );
    let zero = "00".repeat(32);
    assert_eq!(
        code(&fixture.record, &Binding::new(&output, &[zero.as_str()])),
        "wasm_not_accepted"
    );
    assert_eq!(
        check_attestation_binding(&fixture.record, &Binding::new(&output, &[])),
        Err(AttestationRefusal::WasmNotAccepted(Some(WASM_0_5_2.into())))
    );
    assert_eq!(
        code(
            &fixture.record,
            &good.project("other.testnet/voice-verifier")
        ),
        "project_mismatch"
    );
    assert_eq!(
        code(&fixture.record, &good.caller("other.testnet")),
        "caller_mismatch"
    );

    // A record that names another WASM, another caller or another time does
    // not match the quote.
    let changed = |field: &str, value: Value| {
        let mut record = fixture.record_value.clone();
        record[field] = value;
        parse_attestation_record(&record.to_string()).unwrap()
    };
    let timestamp = fixture.record.timestamp;
    let task_id = fixture.record.task_id;
    for (field, value) in [
        ("wasm_hash", Value::from(zero.clone())),
        ("caller_account_id", "other.testnet".into()),
        ("project_id", "other.testnet/voice-verifier".into()),
        ("timestamp", (timestamp + 1).into()),
        ("task_id", (task_id + 1).into()),
        ("input_hash", zero.clone().into()),
    ] {
        let record = changed(field, value);
        assert_eq!(
            code(
                &record,
                &Binding::new(&output, &[zero.as_str(), WASM_0_5_2])
            ),
            "task_hash_mismatch",
            "{field}"
        );
    }
    // A changed output hash needs a changed output, and then the quote does
    // not match.
    let forged = changed("output_hash", format!("{:0<64}", "6b1d9c2e").into());
    assert_eq!(
        code(&forged, &Binding::new(&changed_output, ACCEPTED)),
        "task_hash_mismatch"
    );

    assert_eq!(
        code(&changed("tdx_quote", "AAAA".into()), &good),
        "malformed"
    );
    assert_eq!(
        code(&changed("tdx_quote", "not base64".into()), &good),
        "malformed"
    );
    assert_eq!(
        code(&changed("task_type", "compile".into()), &good),
        "malformed"
    );
    assert_eq!(
        code(&changed("timestamp", 1_700_000_000.into()), &good),
        "malformed"
    );
    assert_eq!(
        code(&changed("output_hash", "AB".into()), &good),
        "malformed"
    );
    assert_eq!(
        code(&fixture.record, &Binding::new("not json", ACCEPTED)),
        "malformed"
    );
    assert!(matches!(
        parse_attestation_record(r#"{"task_type":"execute"}"#),
        Err(AttestationRefusal::Malformed(_))
    ));
}

/// A call of 0.11.0 with an input whose keys are not in sorted order, and
/// with a `secrets_ref`.
const FIXTURE_0_11_0: &str =
    include_str!("../../../packages/voice-verdict/tests/fixtures/outlayer_attestation_0_11_0.json");
const WASM_0_11_0: &str = "d2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8";

#[test]
fn the_input_hash_keeps_the_key_order_that_was_sent() {
    let value: Value = serde_json::from_str(FIXTURE_0_11_0).unwrap();
    let record = parse_attestation_record(&value["record"].to_string()).unwrap();
    assert_eq!(
        record.secrets_ref.as_deref(),
        Some("cyan-loong.testnet/main")
    );
    let output = value["output"].to_string();
    // `serde_json` with no `preserve_order` writes the keys sorted. So write
    // the input in the order of the file, as `JSON.stringify` does.
    let input = r#"{"zeta":1,"op":"probe","alpha":"b"}"#;
    let sorted = r#"{"alpha":"b","op":"probe","zeta":1}"#;
    let binding = Binding::new(&output, &[WASM_0_11_0])
        .project("seams-v1.testnet/voice-verifier")
        .caller("cyan-loong.testnet");
    let bound = check_attestation_binding(&record, &binding.input(input)).unwrap();
    assert_eq!(bound.wasm_hash, WASM_0_11_0);
    assert_eq!(
        check_attestation_binding(&record, &binding.input(sorted)),
        Err(AttestationRefusal::InputMismatch)
    );
}
