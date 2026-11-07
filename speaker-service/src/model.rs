//! ReDimNet B1 in `tract`: one typed plan for any length, built once at start.
use std::sync::Arc;

use anyhow::{bail, Context};
use tract_onnx::prelude::*;

use crate::{sha256, EMBEDDING_DIM, MODEL_SHA256};

/// The runnable plan. `TypedSimplePlan` is `Send + Sync`, so the server shares
/// one plan between the blocking workers.
pub struct Model {
    plan: Arc<TypedRunnableModel>,
    output: usize,
}

impl Model {
    /// Reads the model, refuses it unless its SHA-256 is [`MODEL_SHA256`], and
    /// builds the typed plan with a symbolic sample count `S`.
    ///
    /// ReDimNet fails tract's declutter pass, so this is the typed plan
    /// (`into_typed`), as in the gate0 probe with `PROBE_PLAN=typed`.
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let bytes = std::fs::read(path).with_context(|| format!("read {path}"))?;
        let actual = hex::encode(sha256(&bytes));
        if actual != MODEL_SHA256 {
            bail!("model digest {actual} is not the pinned {MODEL_SHA256}");
        }
        let mut model = tract_onnx::onnx().model_for_read(&mut &bytes[..])?;
        let samples = model.symbols.sym("S");
        model.set_input_fact(0, f32::fact([TDim::from(1), samples.into()]).into())?;
        let typed = model.into_typed()?;
        let output = typed
            .output_outlets()?
            .iter()
            .position(|outlet| typed.node(outlet.node).name == "embedding")
            .unwrap_or(0);
        let plan = typed.into_runnable()?;
        Ok(Model { plan, output })
    }

    /// The raw 192-value model output (not normalized) for samples in [-1, 1).
    pub fn embed(&self, samples: &[f32]) -> anyhow::Result<Vec<f32>> {
        let input = tract_ndarray::Array2::from_shape_vec((1, samples.len()), samples.to_vec())?;
        let outputs = self.plan.run(tvec!(Tensor::from(input).into()))?;
        let output = outputs.get(self.output).context("no output")?;
        let values: Vec<f32> = output.to_plain_array_view::<f32>()?.iter().copied().collect();
        if values.len() != EMBEDDING_DIM {
            bail!("output has {} values, not {EMBEDDING_DIM}", values.len());
        }
        if values.iter().any(|value| !value.is_finite()) {
            bail!("output is not finite");
        }
        Ok(values)
    }
}
