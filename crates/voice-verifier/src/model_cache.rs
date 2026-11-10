//! The speaker model of the `local-speaker` worker, kept between runs.
//!
//! The model does not fit in the WASM, so the worker gets it at run time. A
//! download on each run costs seconds. So the worker keeps the bytes in its
//! OutLayer storage, in chunks, and downloads the file only if the storage
//! does not hold the whole model.
//!
//! The storage is not trusted for the model: every run checks the SHA-256 of
//! the assembled bytes against the pinned digest, and bytes with another
//! digest count as "not stored". The same check applies to a download.
use crate::config::{REDIMNET_SHA256_HEX, SPEAKER_MODEL};
use crate::digest::{hex, sha256};

/// The size of one stored chunk.
pub const CHUNK_BYTES: usize = 1 << 20;

/// Where the model bytes are kept between runs.
pub trait ModelStore {
    fn get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String>;
    fn set(&mut self, key: &str, value: &[u8]) -> Result<(), String>;
}

/// Model bytes whose SHA-256 is the pinned digest. Only [`pinned`] makes
/// one.
pub struct PinnedModel(Vec<u8>);

impl PinnedModel {
    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

/// Takes the bytes only if their SHA-256 is the pinned digest.
pub fn pinned(bytes: Vec<u8>) -> Result<PinnedModel, String> {
    if hex(&sha256(&bytes)) != REDIMNET_SHA256_HEX {
        return Err("model_not_pinned".to_string());
    }
    Ok(PinnedModel(bytes))
}

/// The storage key of chunk `index`. The key names the digest, so another
/// model has other keys.
pub fn chunk_key(index: usize) -> String {
    format!("model:v1:{REDIMNET_SHA256_HEX}:{index}")
}

/// The number of chunks of the pinned model.
fn chunk_count() -> usize {
    SPEAKER_MODEL.bytes.div_ceil(CHUNK_BYTES)
}

/// The model from the store, or `None` if the store does not hold exactly
/// the pinned bytes. A storage error is "not stored".
fn stored(store: &mut dyn ModelStore) -> Option<PinnedModel> {
    let mut bytes = Vec::with_capacity(SPEAKER_MODEL.bytes);
    for index in 0..chunk_count() {
        let chunk = store.get(&chunk_key(index)).ok()??;
        if bytes.len() + chunk.len() > SPEAKER_MODEL.bytes {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() != SPEAKER_MODEL.bytes {
        return None;
    }
    pinned(bytes).ok()
}

/// The pinned model, and `true` if it came from the store. On a miss,
/// `fetch` downloads the file, and the bytes go into the store for the next
/// run. A failed write does not fail the run: the next run downloads again.
pub fn load(
    store: &mut dyn ModelStore,
    fetch: impl FnOnce() -> Result<Vec<u8>, String>,
) -> Result<(PinnedModel, bool), String> {
    if let Some(model) = stored(store) {
        return Ok((model, true));
    }
    let model = pinned(fetch()?)?;
    for (index, chunk) in model.bytes().chunks(CHUNK_BYTES).enumerate() {
        if store.set(&chunk_key(index), chunk).is_err() {
            break;
        }
    }
    Ok((model, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Store {
        records: HashMap<String, Vec<u8>>,
        fail_set_at: Option<usize>,
        sets: usize,
        gets: usize,
    }

    impl ModelStore for Store {
        fn get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
            self.gets += 1;
            Ok(self.records.get(key).cloned())
        }
        fn set(&mut self, key: &str, value: &[u8]) -> Result<(), String> {
            if self.fail_set_at == Some(self.sets) {
                return Err("value too large".into());
            }
            self.sets += 1;
            self.records.insert(key.to_string(), value.to_vec());
            Ok(())
        }
    }

    /// The real model, if `SEAMS_REDIMNET_PATH` names the file. The digest
    /// is pinned, so no other bytes can stand in for it.
    fn model_file() -> Option<Vec<u8>> {
        let Ok(path) = std::env::var("SEAMS_REDIMNET_PATH") else {
            eprintln!("skipped: set SEAMS_REDIMNET_PATH to redimnet-b1.onnx");
            return None;
        };
        Some(std::fs::read(path).unwrap())
    }

    #[test]
    fn other_bytes_are_refused_and_not_stored() {
        assert_eq!(pinned(b"not the model".to_vec()).err().as_deref(), Some("model_not_pinned"));
        let mut store = Store::default();
        let result = load(&mut store, || Ok(vec![0u8; SPEAKER_MODEL.bytes]));
        assert_eq!(result.err().as_deref(), Some("model_not_pinned"));
        assert!(store.records.is_empty());
        // The first missing chunk ends the read.
        assert_eq!(store.gets, 1);
        let failed = load(&mut store, || Err("model fetch: status_503".to_string()));
        assert_eq!(failed.err().as_deref(), Some("model fetch: status_503"));
    }

    #[test]
    fn keys_name_the_digest_and_the_chunk() {
        assert_eq!(chunk_key(3), format!("model:v1:{REDIMNET_SHA256_HEX}:3"));
        assert_eq!(chunk_count(), 9);
    }

    #[test]
    fn the_first_run_downloads_and_the_next_run_reads_the_store() {
        let Some(file) = model_file() else { return };
        let mut store = Store::default();
        let (model, cached) = load(&mut store, || Ok(file.clone())).unwrap();
        assert!(!cached);
        assert_eq!(model.bytes(), &file[..]);
        assert_eq!(store.records.len(), 9);
        assert!(store.records.values().all(|chunk| chunk.len() <= CHUNK_BYTES));

        let (model, cached) = load(&mut store, || panic!("no download with a full store")).unwrap();
        assert!(cached);
        assert_eq!(model.bytes(), &file[..]);

        // A changed chunk, a missing chunk and a longer chunk are each "not stored".
        for damage in 0..3 {
            let mut damaged = Store { records: store.records.clone(), ..Store::default() };
            let key = chunk_key(4);
            match damage {
                0 => damaged.records.get_mut(&key).unwrap()[7] ^= 1,
                1 => drop(damaged.records.remove(&key)),
                _ => damaged.records.get_mut(&key).unwrap().push(0),
            }
            let (_, cached) = load(&mut damaged, || Ok(file.clone())).unwrap();
            assert!(!cached, "damage {damage}");
            // The download repaired the store.
            assert!(load(&mut damaged, || panic!("repaired")).unwrap().1);
        }
    }

    #[test]
    fn a_store_that_refuses_a_write_does_not_fail_the_run() {
        let Some(file) = model_file() else { return };
        let mut store = Store { fail_set_at: Some(2), ..Store::default() };
        let (_, cached) = load(&mut store, || Ok(file.clone())).unwrap();
        assert!(!cached);
        assert_eq!(store.records.len(), 2);
        // The next run finds a part of the model, and downloads again.
        let (_, cached) = load(&mut store, || Ok(file.clone())).unwrap();
        assert!(!cached);
    }
}
