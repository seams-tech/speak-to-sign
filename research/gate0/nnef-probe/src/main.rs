//! Usage: gate0-nnef-probe <model.nnef.tar> <samples>
use std::time::Instant;
use tract_nnef::prelude::*;
use tract_onnx_opl::WithOnnx;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let samples: usize = args[2].parse()?;
    let started = Instant::now();
    let model = tract_nnef::nnef().with_onnx().model_for_path(&args[1])?.into_optimized()?.into_runnable()?;
    let load_ms = started.elapsed().as_millis();
    let audio: Vec<f32> = (0..samples).map(|i| ((i as f32) * 0.0864).sin() * 0.1).collect();
    let input = tract_ndarray::Array2::from_shape_vec((1, samples), audio)?;
    let run_started = Instant::now();
    let outputs = model.run(tvec!(Tensor::from(input).into()))?;
    let sum: f32 = outputs[0].to_plain_array_view::<f32>()?.iter().sum();
    println!("nnef: load_ms={load_ms} run_ms={} shape={:?} sum={sum:.4}", run_started.elapsed().as_millis(), outputs[0].shape());
    Ok(())
}
