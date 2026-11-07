//! Seal and open 8 s of PCM16 audio (256,000 bytes); print sizes and checks.
use gate0_hpke_probe::{generate_keypair, open, seal};
use std::time::Instant;

fn main() {
    let (private_key, public_key) = generate_keypair();
    let audio: Vec<u8> = (0..256_000u32).map(|index| (index.wrapping_mul(2_654_435_761) >> 24) as u8).collect();
    let aad = b"seams:voice-audio:v1|voice-vault.testnet|owner.testnet";
    let started = Instant::now();
    let (encapped, ciphertext) = seal(&public_key, aad, &audio).expect("seal");
    let seal_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let opened = open(&private_key, &encapped, aad, &ciphertext).expect("open");
    let open_ms = started.elapsed().as_millis();
    let wrong_aad = open(&private_key, &encapped, b"seams:voice-audio:v1|other.testnet|owner.testnet", &ciphertext).is_err();
    let mut tampered = ciphertext.clone();
    tampered[1000] ^= 1;
    let tamper_rejected = open(&private_key, &encapped, aad, &tampered).is_err();
    println!(
        "hpke: plaintext={} encapped={} ciphertext={} roundtrip={} wrong_aad_rejected={wrong_aad} tamper_rejected={tamper_rejected} seal_ms={seal_ms} open_ms={open_ms}",
        audio.len(), encapped.len(), ciphertext.len(), opened == audio
    );
}
