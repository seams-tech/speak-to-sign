//! Gate 0 probe contract. `probe` calls `request_execution` on OutLayer for
//! the probe project; `on_result` logs the block span and what OutLayer
//! returned (a JSON value, `null` for a failed run, or a promise error).
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseError};

const PROJECT: &str = "w3a-dev-1766307589.testnet/seams-gate0-probe";

#[near(contract_state)]
#[derive(Default)]
pub struct Probe {}

#[near]
impl Probe {
    #[payable]
    pub fn probe(
        &mut self,
        input: String,
        version_key: Option<String>,
        max_instructions: Option<u64>,
        max_seconds: Option<u64>,
        max_memory_mb: Option<u32>,
    ) -> Promise {
        let args = json!({
            "source": { "Project": { "project_id": PROJECT, "version_key": version_key } },
            "input_data": input,
            "resource_limits": {
                "max_instructions": max_instructions.unwrap_or(1_000_000_000),
                "max_memory_mb": max_memory_mb.unwrap_or(128),
                "max_execution_seconds": max_seconds.unwrap_or(60),
            },
            "response_format": "Json",
        });
        let outlayer: AccountId = "outlayer.testnet".parse().unwrap();
        Promise::new(outlayer)
            .function_call(
                "request_execution".to_string(),
                serde_json::to_vec(&args).unwrap(),
                env::attached_deposit(),
                Gas::from_tgas(200),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_result".to_string(),
                serde_json::to_vec(&json!({ "started_block": env::block_height() })).unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(30),
            ))
    }

    /// Never panics: a callback that panics loses the result.
    #[private]
    pub fn on_result(&mut self, started_block: u64, #[callback_result] result: Result<Value, PromiseError>) -> Value {
        let ended_block = env::block_height();
        let result = match result {
            Ok(Value::Null) => json!({ "outcome": "null" }),
            Ok(value) => json!({ "outcome": "value", "bytes": value.to_string().len(), "value": value }),
            Err(_) => json!({ "outcome": "promise_error" }),
        };
        let record = json!({
            "started_block": started_block,
            "ended_block": ended_block,
            "blocks": ended_block - started_block,
            "result": result,
        });
        env::log_str(&record.to_string());
        record
    }
}
