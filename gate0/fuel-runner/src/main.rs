//! Run a wasm32-wasip2 command component with fuel metering, as the OutLayer
//! worker does (`worker/src/executor/wasi_p2.rs`: `consume_fuel(true)`,
//! `store.set_fuel(max_instructions)`, `fuel_consumed = max - get_fuel()`).
//!
//! Usage: gate0-fuel-runner <component.wasm> <preopen-host-dir> [-- guest args...]
//! Environment: FUEL (default 500e9, the live testnet `MAX_INSTRUCTIONS`),
//! MEMORY_MB (default 4096, the contract's `MAX_MEMORY_MB`), and every
//! `PROBE_*` variable is passed to the guest.

use std::time::Instant;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, ResourceLimiter, Store};
use wasmtime_wasi::bindings::sync::Command;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtx, WasiCtxBuilder, WasiView};

struct Host {
    ctx: WasiCtx,
    table: ResourceTable,
    memory_limit: usize,
    peak_memory: usize,
}

impl WasiView for Host {
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.ctx
    }
}

impl ResourceLimiter for Host {
    fn memory_growing(&mut self, _current: usize, desired: usize, _maximum: Option<usize>) -> anyhow::Result<bool> {
        if desired > self.memory_limit {
            return Ok(false);
        }
        self.peak_memory = self.peak_memory.max(desired);
        Ok(true)
    }
    fn table_growing(&mut self, _current: usize, _desired: usize, _maximum: Option<usize>) -> anyhow::Result<bool> {
        Ok(true)
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        anyhow::bail!("usage: {} <component.wasm> <preopen-dir> [-- guest args...]", args[0]);
    }
    let guest_args: Vec<String> = match args.iter().position(|arg| arg == "--") {
        Some(index) => args[index + 1..].to_vec(),
        None => Vec::new(),
    };
    let fuel: u64 = std::env::var("FUEL").map(|value| value.parse()).unwrap_or(Ok(500_000_000_000))?;
    let memory_mb: usize = std::env::var("MEMORY_MB").map(|value| value.parse()).unwrap_or(Ok(4096))?;

    let mut config = Config::new();
    config.wasm_component_model(true);
    config.consume_fuel(true);
    let engine = Engine::new(&config)?;

    let compile_started = Instant::now();
    let component = Component::from_file(&engine, &args[1])?;
    let compile_ms = compile_started.elapsed().as_millis();

    let mut linker: Linker<Host> = Linker::new(&engine);
    wasmtime_wasi::add_to_linker_sync(&mut linker)?;

    let mut builder = WasiCtxBuilder::new();
    builder.inherit_stdout().inherit_stderr();
    let mut argv = vec!["guest".to_string()];
    argv.extend(guest_args);
    builder.args(&argv);
    for (key, value) in std::env::vars().filter(|(key, _)| key.starts_with("PROBE_")) {
        builder.env(&key, &value);
    }
    builder.preopened_dir(&args[2], &args[2], DirPerms::all(), FilePerms::all())?;

    let host = Host {
        ctx: builder.build(),
        table: ResourceTable::new(),
        memory_limit: memory_mb * 1024 * 1024,
        peak_memory: 0,
    };
    let mut store = Store::new(&engine, host);
    store.limiter(|host| host);
    store.set_fuel(fuel)?;

    let run_started = Instant::now();
    let command = Command::instantiate(&mut store, &component, &linker)?;
    let result = command.wasi_cli_run().call_run(&mut store);
    let run_ms = run_started.elapsed().as_millis();
    let consumed = fuel - store.get_fuel().unwrap_or(0);
    let peak_mb = store.data().peak_memory as f64 / (1024.0 * 1024.0);
    let outcome = match &result {
        Ok(Ok(())) => "ok".to_string(),
        Ok(Err(())) => "guest-exit-error".to_string(),
        Err(error) => format!("trap: {error:#}"),
    };
    println!(
        "fuel: instructions={consumed} run_ms={run_ms} compile_ms={compile_ms} peak_memory_mb={peak_mb:.1} outcome={outcome}"
    );
    Ok(())
}
