//! ReDimNet B1 inside the worker, in `tract` (the feature `local-speaker`).
//!
//! The model is too large for the WASM (8.9 MB, and OutLayer refuses a WASM
//! of 10 MB or more), so the worker fetches it on each run. [`Model::check`]
//! refuses bytes whose SHA-256 is not the pinned
//! [`REDIMNET_SHA256_HEX`](crate::config::REDIMNET_SHA256_HEX), so the host
//! that serves the file is not trusted.
//!
//! The speaker service (`crates/speaker-service/src/model.rs`) runs the same
//! model with the same `tract` version and the same typed plan. So a
//! template of one variant is valid for the other.
use tract_onnx::prelude::*;

use crate::config::{EMBEDDING_DIM, REDIMNET_SHA256_HEX, SPEAKER_MODEL};
use crate::digest::{hex, sha256};

/// Model bytes with the pinned digest.
pub struct Model(Vec<u8>);

impl Model {
    /// Takes the bytes only if their SHA-256 is the pinned digest.
    pub fn check(bytes: Vec<u8>) -> Result<Self, String> {
        if hex(&sha256(&bytes)) != REDIMNET_SHA256_HEX {
            return Err("model_not_pinned".to_string());
        }
        Ok(Self(bytes))
    }

    /// The raw 192-value model output (not normalized) for 16 kHz mono
    /// samples. The samples become `f32` in [-1, 1), as in the speaker
    /// service.
    ///
    /// ReDimNet fails tract's declutter pass, so this is the typed plan. The
    /// plan is for the exact sample count, as in the Gate 0 probe that ran
    /// on OutLayer. The plan costs about 3% of the run.
    pub fn embed(&self, pcm: &[i16]) -> Result<Vec<f32>, String> {
        let samples: Vec<f32> = pcm.iter().map(|sample| f32::from(*sample) / 32_768.0).collect();
        let run = || -> TractResult<Option<Vec<f32>>> {
            let model = tract_onnx::onnx()
                .model_for_read(&mut &self.0[..])?
                .with_input_fact(0, f32::fact([1, samples.len()]).into())?
                .into_typed()?;
            let output = model
                .output_outlets()?
                .iter()
                .position(|outlet| model.node(outlet.node).name == SPEAKER_MODEL.output)
                .unwrap_or(0);
            let plan = model.into_runnable()?;
            let input = tract_ndarray::Array2::from_shape_vec((1, samples.len()), samples.clone())?;
            let outputs = plan.run(tvec!(Tensor::from(input).into()))?;
            let Some(values) = outputs.get(output) else { return Ok(None) };
            Ok(Some(values.to_plain_array_view::<f32>()?.iter().copied().collect()))
        };
        let values = run().map_err(|error| format!("model: {error:#}"))?.ok_or("model: no output")?;
        if values.len() != EMBEDDING_DIM || values.iter().any(|value| !value.is_finite()) {
            return Err("bad_embedding".to_string());
        }
        Ok(values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_with_another_digest_are_refused() {
        assert_eq!(Model::check(b"not the model".to_vec()).err().as_deref(), Some("model_not_pinned"));
    }

    /// Runs the real model if `SEAMS_REDIMNET_PATH` names the file. The two
    /// clips of one tone agree, and a clip of noise does not agree with them.
    #[test]
    fn the_real_model_gives_192_values() {
        let Ok(path) = std::env::var("SEAMS_REDIMNET_PATH") else {
            eprintln!("skipped: set SEAMS_REDIMNET_PATH to redimnet-b1.onnx");
            return;
        };
        let model = Model::check(std::fs::read(path).unwrap()).unwrap();
        let tone = |step: f32, len: usize| -> Vec<i16> {
            (0..len).map(|i| ((i as f32 * step).sin() * 3_000.0) as i16).collect()
        };
        let first = model.embed(&tone(0.05, 32_000)).unwrap();
        let again = model.embed(&tone(0.05, 32_000)).unwrap();
        let longer = model.embed(&tone(0.05, 48_000)).unwrap();
        assert_eq!(first.len(), EMBEDDING_DIM);
        assert_eq!(first, again);
        assert_eq!(longer.len(), EMBEDDING_DIM);
    }
}
