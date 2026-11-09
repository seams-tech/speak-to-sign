//! WAV input, the canonical WAV and the energy gate.
//!
//! The client sends a 16 kHz mono PCM16 WAV inline. The verifier decodes it
//! and writes it again with a plain 44-byte header: the canonical WAV. The
//! speaker service and NEAR AI get the canonical WAV, and the audio digest in
//! the verdict is its SHA-256. So a header change does not make a new digest.
use crate::config::{
    GATE_FRAME, GATE_LEVEL_RMS, GATE_MAX_CLIPPED_PERMILLE, GATE_MIN_VOICED_MS, MAX_SAMPLES, SAMPLE_RATE,
};

/// Reads a RIFF WAV: PCM (or WAVE_FORMAT_EXTENSIBLE with PCM), 16 kHz, mono,
/// 16-bit, 1 to [`MAX_SAMPLES`] samples. Other chunks (`LIST`) are skipped.
pub fn decode_wav(bytes: &[u8]) -> Result<Vec<i16>, &'static str> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not_wav");
    }
    let mut at = 12;
    let mut format_ok = false;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]) as usize;
        let body_start = at + 8;
        let body_end = body_start.checked_add(size).ok_or("bad_wav_chunk")?;
        if id == b"data" {
            if !format_ok {
                return Err("wav_data_before_fmt");
            }
            // Some writers set a data size past the end; take what is there.
            let data = &bytes[body_start..body_end.min(bytes.len())];
            let samples = data.len() / 2;
            if samples == 0 || samples > MAX_SAMPLES {
                return Err("wav_length");
            }
            return Ok(data.chunks_exact(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]])).collect());
        }
        if body_end > bytes.len() {
            return Err("bad_wav_chunk");
        }
        if id == b"fmt " {
            let fmt = &bytes[body_start..body_end];
            if fmt.len() < 16 {
                return Err("bad_wav_fmt");
            }
            let tag = u16::from_le_bytes([fmt[0], fmt[1]]);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
            let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
            // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID starts with the tag.
            let pcm = tag == 1 || (tag == 0xFFFE && fmt.len() >= 26 && fmt[24..26] == [1, 0]);
            if !pcm || channels != 1 || rate != SAMPLE_RATE || bits != 16 {
                return Err("wav_not_16k_mono_pcm16");
            }
            format_ok = true;
        }
        // Chunks are padded to an even size.
        at = body_end + (size & 1);
    }
    Err("wav_no_data")
}

/// PCM16 samples to the canonical WAV: a 44-byte header at [`SAMPLE_RATE`].
pub fn wav_bytes(pcm: &[i16]) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + pcm.len() * 2);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes()); // byte rate
    wav.extend_from_slice(&2u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in pcm {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

/// The energy gate measurements.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GateReport {
    /// Milliseconds in 32 ms frames with RMS at or above the level.
    pub voiced_ms: u32,
    /// Samples at full scale, in thousandths.
    pub clipped_permille: u32,
}

impl GateReport {
    /// The gate passes with enough voiced audio and little clipping.
    pub fn passes(&self) -> bool {
        self.voiced_ms >= GATE_MIN_VOICED_MS && self.clipped_permille <= GATE_MAX_CLIPPED_PERMILLE
    }
}

/// A simple speech-activity gate. It does not tell speech from other sound;
/// the speaker and word checks do that.
pub fn energy_gate(pcm: &[i16]) -> GateReport {
    let mut voiced_samples: u64 = 0;
    for frame in pcm.chunks(GATE_FRAME) {
        let energy: f32 = frame
            .iter()
            .map(|sample| {
                let value = f32::from(*sample) / 32_768.0;
                value * value
            })
            .sum();
        let rms = (energy / frame.len() as f32).sqrt();
        if rms >= GATE_LEVEL_RMS {
            voiced_samples += frame.len() as u64;
        }
    }
    let clipped = pcm.iter().filter(|sample| **sample == i16::MAX || **sample == i16::MIN).count() as u64;
    let clipped_permille = if pcm.is_empty() { 0 } else { (clipped * 1_000 / pcm.len() as u64) as u32 };
    GateReport { voiced_ms: (voiced_samples * 1_000 / u64::from(SAMPLE_RATE)) as u32, clipped_permille }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(ms: usize, amplitude: f32) -> Vec<i16> {
        (0..ms * SAMPLE_RATE as usize / 1_000).map(|i| ((i as f32 * 0.1).sin() * amplitude * 32_767.0) as i16).collect()
    }

    #[test]
    fn wav_round_trip_and_extra_chunks() {
        let pcm = tone(100, 0.1);
        assert_eq!(decode_wav(&wav_bytes(&pcm)).unwrap(), pcm);
        // ffmpeg adds a LIST chunk before data; an odd chunk is padded.
        let plain = wav_bytes(&pcm);
        let mut with_list = plain[..36].to_vec();
        with_list.extend_from_slice(b"LIST");
        with_list.extend_from_slice(&3u32.to_le_bytes());
        with_list.extend_from_slice(b"abc\0");
        with_list.extend_from_slice(&plain[36..]);
        assert_eq!(decode_wav(&with_list).unwrap(), pcm);
        // The canonical WAV is the same for both.
        assert_eq!(wav_bytes(&decode_wav(&with_list).unwrap()), plain);
    }

    #[test]
    fn wav_refusals() {
        let wav = wav_bytes(&tone(10, 0.1));
        assert_eq!(decode_wav(b"nope"), Err("not_wav"));
        let mut stereo = wav.clone();
        stereo[22] = 2;
        assert_eq!(decode_wav(&stereo), Err("wav_not_16k_mono_pcm16"));
        let mut rate = wav.clone();
        rate[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        assert_eq!(decode_wav(&rate), Err("wav_not_16k_mono_pcm16"));
        assert_eq!(decode_wav(&wav_bytes(&[])), Err("wav_length"));
        assert_eq!(decode_wav(&wav_bytes(&vec![0; MAX_SAMPLES + 1])), Err("wav_length"));
        assert_eq!(decode_wav(&wav[..36]), Err("wav_no_data"));
    }

    #[test]
    fn energy_gate_rules() {
        assert!(energy_gate(&tone(1_000, 0.1)).passes());
        assert!(!energy_gate(&vec![0; 3 * SAMPLE_RATE as usize]).passes());
        assert!(!energy_gate(&tone(3_000, 0.004)).passes());
        assert!(!energy_gate(&tone(500, 0.1)).passes());
        let mut clipped = tone(1_000, 0.1);
        for sample in clipped.iter_mut().step_by(50) {
            *sample = i16::MIN;
        }
        assert_eq!(energy_gate(&clipped).clipped_permille, 20);
        assert!(!energy_gate(&clipped).passes());
    }
}
