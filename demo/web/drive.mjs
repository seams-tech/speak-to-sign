#!/usr/bin/env node
// Drives the running demo server without a microphone: makes 16 kHz mono
// WAVs with macOS `say` and ffmpeg, posts them, and prints each stage event.
//
//   node drive.mjs [pay|enroll] [--voice Samantha] [--rate 197] [--say "text"] [--port 8787]
//
// `say` rounds rates, and the verifier refuses a recording it has seen, so
// each run needs a rate that gives a new clip.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENROLL_PHRASES = [
  "My voice is my signature for this vault.",
  "I send money only when I say so.",
  "Seams, please learn how I sound today.",
];
const argv = process.argv.slice(2);
const mode = argv[0] === "enroll" || argv[0] === "pay" ? argv.shift() : "pay";
const options = { voice: "Samantha", rate: "197", say: "Send 0.1 NEAR to seams dash v1 dot testnet.", port: "8787" };
for (let i = 0; i < argv.length; i += 2) options[argv[i].replace(/^--/, "")] = argv[i + 1];

function sayWav(text) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "s2s-drive-"));
  const aiff = path.join(folder, "say.aiff");
  const wav = path.join(folder, "say.wav");
  execFileSync("say", ["-v", options.voice, "-r", String(options.rate), "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
    "-map_metadata", "-1", "-fflags", "+bitexact", wav]);
  const bytes = fs.readFileSync(wav);
  fs.rmSync(folder, { recursive: true });
  console.log(`speech  ${options.voice} rate ${options.rate}: "${text}" (${bytes.length} bytes)`);
  return bytes.toString("base64");
}

const body = mode === "enroll" ? { wavs_b64: ENROLL_PHRASES.map(sayWav) } : { wav_b64: sayWav(options.say) };
const started = performance.now();
const response = await fetch(`http://127.0.0.1:${options.port}/api/${mode}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}
let buffer = "";
let last = null;
for await (const chunk of response.body) {
  buffer += Buffer.from(chunk).toString();
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!line.trim()) continue;
    last = JSON.parse(line);
    console.log(`${String(Math.round(performance.now() - started)).padStart(6)} ms  ${line}`);
  }
}
process.exit(last && last.stage === "done" ? 0 : 1);
