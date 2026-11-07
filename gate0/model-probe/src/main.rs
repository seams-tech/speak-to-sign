//! Gate 0 probe: load one VoiceID ONNX model with tract and run it on
//! synthetic 16 kHz audio of a fixed length.
//!
//! Usage: gate0-model-probe <redimnet|aurora|citrinet|silero> <model.onnx|embedded> <seconds> <load|run>
//!
//! `load` stops after the optimized plan is built, so that a fuel runner can
//! subtract load cost from a full run. Every result line starts with `probe:`.

use std::time::Instant;
use tract_onnx::prelude::*;

const SAMPLE_RATE: usize = 16_000;
const SILERO_FRAME: usize = 512;
const SILERO_CONTEXT: usize = 64;

fn main() {
    if let Err(error) = run() {
        // Print the whole chain: unsupported operators appear here.
        println!("probe: error {error:?}");
        std::process::exit(2);
    }
}

fn run() -> TractResult<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        anyhow::bail!("usage: {} <model> <path|embedded> <seconds> <load|run>", args[0]);
    }
    let model_name = args[1].as_str();
    let seconds: f32 = args[3].parse()?;
    let run_model = match args[4].as_str() {
        "load" => false,
        "run" => true,
        other => anyhow::bail!("unknown mode {other}"),
    };
    // PROBE_INPUT: raw little-endian f32 mono 16 kHz audio. It replaces the
    // synthetic audio, and its length replaces <seconds>.
    let file_audio = match std::env::var("PROBE_INPUT") {
        Ok(path) => Some(read_f32(&path)?),
        Err(_) => None,
    };
    let samples = match &file_audio {
        Some(audio) => audio.len(),
        None => (seconds * SAMPLE_RATE as f32) as usize,
    };

    let started = Instant::now();
    let bytes = model_bytes(model_name, &args[2])?;
    println!("probe: model={model_name} bytes={} samples={samples}", bytes.len());

    let parsed = tract_onnx::onnx().model_for_read(&mut bytes.as_slice())?;
    println!("probe: parsed_ms={}", started.elapsed().as_millis());
    for (index, input) in parsed.input_outlets()?.iter().enumerate() {
        println!("probe: input[{index}] {} {:?}", parsed.node(input.node).name, parsed.outlet_fact(*input)?);
    }

    let with_facts = match model_name {
        "silero" => parsed
            .with_input_fact(0, f32::fact([1, SILERO_FRAME + SILERO_CONTEXT]).into())?
            .with_input_fact(1, f32::fact([2, 1, 128]).into())?
            .with_input_fact(2, InferenceFact::from(tensor0(16_000i64)))?,
        _ => parsed.with_input_fact(0, f32::fact([1, samples]).into())?,
    };
    // PROBE_PLAN=typed skips tract's declutter and optimizer passes, to work
    // around a pass that rejects a model.
    let plan_mode = std::env::var("PROBE_PLAN").unwrap_or_else(|_| "optimized".into());
    let typed = match plan_mode.as_str() {
        "typed" => with_facts.into_typed()?,
        "decluttered" => with_facts.into_typed()?.into_decluttered()?,
        "optimized" => with_facts.into_optimized()?,
        other => anyhow::bail!("unknown PROBE_PLAN {other}"),
    };
    let plan = typed.into_runnable()?;
    println!("probe: plan={plan_mode} optimized_ms={}", started.elapsed().as_millis());
    if !run_model {
        return Ok(());
    }

    let audio = file_audio.unwrap_or_else(|| synthetic_audio(samples));
    let run_started = Instant::now();
    match model_name {
        "silero" => {
            let mut state = Tensor::zero::<f32>(&[2, 1, 128])?;
            let mut context = vec![0f32; SILERO_CONTEXT];
            let mut last = 0f32;
            let frames = samples / SILERO_FRAME;
            for frame in audio.chunks_exact(SILERO_FRAME) {
                let mut window = Vec::with_capacity(SILERO_FRAME + SILERO_CONTEXT);
                window.extend_from_slice(&context);
                window.extend_from_slice(frame);
                context.copy_from_slice(&frame[SILERO_FRAME - SILERO_CONTEXT..]);
                let input = tract_ndarray::Array2::from_shape_vec((1, window.len()), window)?;
                let outputs = plan.run(tvec!(
                    Tensor::from(input).into(),
                    state.clone().into(),
                    tensor0(16_000i64).into()
                ))?;
                last = *outputs[0].to_plain_array_view::<f32>()?.iter().next().unwrap_or(&0.0);
                state = outputs[1].clone().into_tensor();
            }
            println!("probe: silero_frames={frames} last_probability={last:.4}");
        }
        _ => {
            // PROBE_DUMP_DIR: write the input and the first output as raw
            // little-endian f32, to compare with ONNX Runtime.
            let dump_dir = std::env::var("PROBE_DUMP_DIR").ok();
            if let Some(dir) = &dump_dir {
                write_f32(&format!("{dir}/{model_name}-input.f32"), &audio)?;
            }
            let input = tract_ndarray::Array2::from_shape_vec((1, samples), audio)?;
            let outputs = plan.run(tvec!(Tensor::from(input).into()))?;
            for (index, output) in outputs.iter().enumerate() {
                let values = output.to_plain_array_view::<f32>()?;
                let sum: f32 = values.iter().sum();
                println!("probe: output[{index}] shape={:?} sum={sum:.4}", output.shape());
                if let (Some(dir), 0) = (&dump_dir, index) {
                    let flat: Vec<f32> = values.iter().copied().collect();
                    write_f32(&format!("{dir}/{model_name}-tract-output.f32"), &flat)?;
                }
            }
        }
    }
    println!("probe: run_ms={} total_ms={}", run_started.elapsed().as_millis(), started.elapsed().as_millis());
    Ok(())
}

fn read_f32(path: &str) -> TractResult<Vec<f32>> {
    let bytes = std::fs::read(path)?;
    Ok(bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect())
}

fn write_f32(path: &str, values: &[f32]) -> TractResult<()> {
    let bytes: Vec<u8> = values.iter().flat_map(|value| value.to_le_bytes()).collect();
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Deterministic noise plus a 220 Hz tone at a speech-like level. Compute cost
/// depends on the input length, not on its content.
fn synthetic_audio(samples: usize) -> Vec<f32> {
    let mut seed: u32 = 0x1234_5678;
    (0..samples)
        .map(|index| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let noise = (seed as f32 / u32::MAX as f32 - 0.5) * 0.05;
            let tone = (index as f32 * 220.0 * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * 0.1;
            noise + tone
        })
        .collect()
}

#[cfg(not(feature = "embed"))]
fn model_bytes(_name: &str, path: &str) -> TractResult<Vec<u8>> {
    Ok(std::fs::read(path)?)
}

#[cfg(feature = "embed")]
fn model_bytes(name: &str, path: &str) -> TractResult<Vec<u8>> {
    if path != "embedded" {
        return Ok(std::fs::read(path)?);
    }
    let bytes: &'static [u8] = match name {
        "redimnet" => include_bytes!(concat!(env!("VOICEID_ASSETS"), "/redimnet-b1.onnx")),
        "aurora" => include_bytes!(concat!(env!("VOICEID_ASSETS"), "/aurora-int8.onnx")),
        "citrinet" => include_bytes!(concat!(env!("VOICEID_ASSETS"), "/citrinet-int8.onnx")),
        "silero" => include_bytes!(concat!(env!("VOICEID_ASSETS"), "/silero-vad.onnx")),
        other => anyhow::bail!("unknown model {other}"),
    };
    Ok(bytes.to_vec())
}
