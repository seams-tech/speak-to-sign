//! Usage: gate0-nnef-convert <model.onnx> <out.nnef.tar> <samples> <typed|optimized>
use tract_onnx::prelude::*;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let samples: usize = args[3].parse()?;
    let model = tract_onnx::onnx()
        .model_for_path(&args[1])?
        .with_input_fact(0, f32::fact([1, samples]).into())?;
    // `optimized` plans hold target-specific kernels and cannot be written;
    // write the decluttered plan when it works, else the typed plan.
    let typed = match args[4].as_str() {
        "typed" => model.into_typed()?,
        _ => model.into_typed()?.into_decluttered()?,
    };
    use tract_onnx_opl::WithOnnx;
    let nnef = tract_nnef::nnef().with_onnx();
    nnef.write_to_tar(&typed, std::fs::File::create(&args[2])?)?;
    println!("wrote {}", args[2]);
    Ok(())
}
