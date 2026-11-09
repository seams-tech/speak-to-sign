//! A fake `outlayer.testnet` for the sandbox test. `request_execution` returns a scripted
//! answer at once, the way the real OutLayer returns the worker's JSON output. Anyone can set
//! the script. Never deploy it to testnet.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::{env, near};

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    /// Return `answer` (JSON text).
    #[default]
    Answer,
    /// Fail the call, like a run that OutLayer cannot start.
    Fail,
}

#[near(contract_state)]
#[derive(Default)]
pub struct FakeOutlayer {
    mode: Mode,
    /// The JSON that `request_execution` returns. Empty: `null`, a failed run.
    answer: String,
    calls: u32,
    /// The arguments and the deposit of the last call, as JSON text.
    last_request: String,
}

#[near]
impl FakeOutlayer {
    /// Sets the answer of the next calls. `null` is the answer of a failed run.
    pub fn set_answer(&mut self, answer: Value) {
        self.mode = Mode::Answer;
        self.answer = answer.to_string();
    }

    /// Makes the next calls fail.
    pub fn set_failure(&mut self) {
        self.mode = Mode::Fail;
    }

    #[payable]
    pub fn request_execution(
        &mut self,
        source: Value,
        input_data: String,
        resource_limits: Value,
        response_format: String,
        secrets_ref: Option<Value>,
    ) -> Value {
        self.calls += 1;
        self.last_request = json!({
            "caller": env::predecessor_account_id(),
            "deposit": U128(env::attached_deposit().as_yoctonear()),
            "source": source,
            "input": serde_json::from_str::<Value>(&input_data).unwrap_or(Value::String(input_data)),
            "resource_limits": resource_limits,
            "response_format": response_format,
            "secrets_ref": secrets_ref,
        })
        .to_string();
        if self.mode == Mode::Fail {
            env::panic_str("scripted resolver failure");
        }
        serde_json::from_str(&self.answer).unwrap_or(Value::Null)
    }

    pub fn get_calls(&self) -> u32 {
        self.calls
    }

    pub fn get_last_request(&self) -> Value {
        serde_json::from_str(&self.last_request).unwrap_or(Value::Null)
    }
}
