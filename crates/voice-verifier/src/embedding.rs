//! Speaker embeddings and the enrollment rule. The math follows the Wallet
//! (`voiceid/src/browser/model.ts` and `enrollment.ts`).
use crate::config::{EMBEDDING_DIM, SPEAKER_CUTOFF_MILLI};

/// A unit-length 192-value ReDimNet embedding.
#[derive(Clone, Debug, PartialEq)]
pub struct Embedding(Vec<f32>);

impl Embedding {
    /// Normalizes a raw model output. Refuses a wrong size, a value that is
    /// not finite, or a vector with no signal.
    pub fn from_raw(values: &[f32]) -> Option<Self> {
        if values.len() != EMBEDDING_DIM || !values.iter().all(|value| value.is_finite()) {
            return None;
        }
        let squared = squared_norm(values);
        if squared < 1e-12 {
            return None;
        }
        let norm = squared.sqrt();
        Some(Self(values.iter().map(|value| (f64::from(*value) / norm) as f32).collect()))
    }

    /// Takes stored values as they are. Refuses a wrong size, a value that is
    /// not finite, or a vector that is not unit length.
    pub fn from_unit(values: Vec<f32>) -> Option<Self> {
        if values.len() != EMBEDDING_DIM
            || !values.iter().all(|value| value.is_finite())
            || (squared_norm(&values) - 1.0).abs() > 1e-3
        {
            return None;
        }
        Some(Self(values))
    }

    /// The values.
    pub fn values(&self) -> &[f32] {
        &self.0
    }
}

fn squared_norm(values: &[f32]) -> f64 {
    values.iter().map(|value| f64::from(*value) * f64::from(*value)).sum()
}

/// Little-endian `f32` values, 4 bytes each.
pub fn f32_values(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect()
}

/// The cosine of two unit embeddings in thousandths, rounded down.
pub fn similarity_milli(left: &Embedding, right: &Embedding) -> i32 {
    let score: f64 = left.0.iter().zip(&right.0).map(|(a, b)| f64::from(*a) * f64::from(*b)).sum();
    (score * 1_000.0).floor() as i32
}

/// The speaker check passes at or above the cutoff.
pub fn speaker_passes(score_milli: i32) -> bool {
    score_milli >= SPEAKER_CUTOFF_MILLI
}

/// The result of the enrollment rule.
#[derive(Debug, PartialEq)]
pub enum Agreement {
    /// Every pair agrees. The template is the unit mean.
    Agreed { template: Embedding, agreement_milli: i32 },
    /// Some pair is below the cutoff.
    Disagreed { agreement_milli: i32 },
}

/// The enrollment rule: every pair of samples must reach the speaker
/// cutoff, as in the Wallet. `agreement_milli` is the lowest pairwise score.
pub fn agreement(samples: &[Embedding]) -> Agreement {
    let mut agreement_milli = i32::MAX;
    for (index, left) in samples.iter().enumerate() {
        for right in &samples[index + 1..] {
            agreement_milli = agreement_milli.min(similarity_milli(left, right));
        }
    }
    if samples.len() < 2 || !speaker_passes(agreement_milli) {
        return Agreement::Disagreed { agreement_milli: agreement_milli.min(1_000) };
    }
    let mut mean = vec![0f32; EMBEDDING_DIM];
    for sample in samples {
        for (slot, value) in mean.iter_mut().zip(&sample.0) {
            *slot += value / samples.len() as f32;
        }
    }
    match Embedding::from_raw(&mean) {
        Some(template) => Agreement::Agreed { template, agreement_milli },
        None => Agreement::Disagreed { agreement_milli },
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A unit vector along `axis`, turned toward `axis + 1` by `angle`.
    pub(crate) fn embedding(axis: usize, angle: f32) -> Embedding {
        let mut values = vec![0f32; EMBEDDING_DIM];
        values[axis] = angle.cos();
        values[(axis + 1) % EMBEDDING_DIM] = angle.sin();
        Embedding::from_raw(&values).unwrap()
    }

    #[test]
    fn normalization_and_refusals() {
        let embedding = Embedding::from_raw(&[2.0; EMBEDDING_DIM]).unwrap();
        let norm: f32 = embedding.values().iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
        assert!(Embedding::from_raw(&[1.0; 191]).is_none());
        assert!(Embedding::from_raw(&[0.0; EMBEDDING_DIM]).is_none());
        let mut bad = [1.0; EMBEDDING_DIM];
        bad[3] = f32::NAN;
        assert!(Embedding::from_raw(&bad).is_none());
    }

    #[test]
    fn similarity_rounds_down_and_cutoff_is_inclusive() {
        let a = embedding(0, 0.0);
        assert!(similarity_milli(&a, &a) >= 999);
        // cos(1.1) = 0.4536
        assert_eq!(similarity_milli(&a, &embedding(0, 1.1)), 453);
        assert!(speaker_passes(450));
        assert!(!speaker_passes(449));
        let opposite = Embedding::from_raw(&a.values().iter().map(|v| -v).collect::<Vec<_>>()).unwrap();
        assert!(similarity_milli(&a, &opposite) <= -999);
    }

    #[test]
    fn enrollment_agrees_and_makes_a_unit_mean() {
        let samples = [embedding(0, 0.0), embedding(0, 0.2), embedding(0, 0.4)];
        let Agreement::Agreed { template, agreement_milli } = agreement(&samples) else { panic!() };
        // Lowest pair is 0.0 and 0.4: cos(0.4) = 0.921.
        assert_eq!(agreement_milli, 921);
        assert!(similarity_milli(&template, &embedding(0, 0.2)) >= 999);
    }

    #[test]
    fn enrollment_refuses_a_different_sample() {
        let samples = [embedding(0, 0.0), embedding(0, 0.1), embedding(5, 0.0)];
        assert_eq!(agreement(&samples), Agreement::Disagreed { agreement_milli: 0 });
        assert!(matches!(agreement(&samples[..1]), Agreement::Disagreed { .. }));
    }
}
