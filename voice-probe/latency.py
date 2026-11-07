#!/usr/bin/env python3
"""Refactor 210, task E: latency of the HTTPS verify path (plan 7.5, 11.5).

Without --run, this prints the plan and does nothing else: no network, no
env file read, no WAV made.

With --run, for each of N runs:
  1. POST the voice-probe worker synchronously over the OutLayer HTTPS API
     (X-Payment-Key from the env file), with a 3-4 s synthetic WAV.
  2. Send one 0.001 NEAR self-transfer from the NEAR account with the near
     CLI, then ask FastNEAR RPC for the transaction status (EXECUTED, then
     FINAL).
It records the client wall time, OutLayer time_ms and instructions, the
guest stage timings, and the chain times, then prints p50 and p95.

"End of speech to receipt" = OutLayer client wall time + time from the
transfer start until all its receipts executed. The real flow adds confirm
and upload time (about 1 s) that this script does not model.

The payment key is never printed and never written to the records.
"""
import argparse
import base64
import datetime
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-probe"
DEFAULT_RPC = "https://test.rpc.fastnear.com"
DEFAULT_ACCOUNT = "seams-wallet.testnet"
DEFAULT_PHRASE = "Send two NEAR to alice dot testnet"
DEFAULT_EXPECTED = "Send two NEAR to alice.testnet"
DEFAULT_CONTACTS = ["alice.testnet"]
DEFAULT_VOICES = ["Samantha", "Daniel", "Karen", "Moira"]
WAV_DIR = os.path.join(HERE, "target", "latency-wavs")
RECORD_DIR = os.path.join(HERE, "target", "latency")
PAYMENT_KEY_NAME = "OUTLAYER_PAYMENT_KEY"
TX_HASH = re.compile(r"(?:Transaction ID:\s*|/txns?/|/transactions/)([1-9A-HJ-NP-Za-km-z]{43,44})")
GUEST_STAGES = ["decode", "redimnet_fetch", "redimnet_load", "redimnet_run", "transcribe", "words", "sign"]


# ---------------------------------------------------------------------------
# Pure helpers (see test_latency.py)

def read_env_value(path, name):
    """Returns the value of `name` in a KEY=VALUE file, or None. Reads only
    that one name; never returns or prints anything else."""
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            key, sep, value = line.partition("=")
            if sep and key.strip() == name:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                return value or None
    return None


def percentile(values, fraction):
    """Nearest-rank percentile; None for an empty list."""
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    rank = max(1, math.ceil(fraction * len(values)))
    return values[rank - 1]


def find_key(value, name):
    """The first value of `name` anywhere in nested dicts and lists."""
    if isinstance(value, dict):
        if name in value:
            return value[name]
        children = value.values()
    elif isinstance(value, list):
        children = value
    else:
        return None
    for child in children:
        found = find_key(child, name)
        if found is not None:
            return found
    return None


def worker_output(response):
    """The worker's JSON output from an OutLayer HTTPS reply: `output` as an
    object, or as a JSON string."""
    output = find_key(response, "output")
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except ValueError:
            return None
    return output if isinstance(output, dict) else None


def parse_tx_hash(cli_text):
    match = TX_HASH.search(cli_text)
    return match.group(1) if match else None


def call_body(wav_bytes, expected, contacts, version_key, limits):
    body = {
        "input": {
            "op": "verify_latency",
            "audio_wav_b64": base64.b64encode(wav_bytes).decode("ascii"),
            "expected": expected,
            "contacts": contacts,
        },
        "async": False,
        "secrets_ref": {"profile": "main", "account_id": "cyan-loong.testnet"},
        "resource_limits": limits,
    }
    if version_key:
        body["version_key"] = version_key
    return body


def summarize(records):
    """Rows of (measure, n, p50, p95, max) in ms or instructions."""
    measures = [("client_wall_ms", lambda r: r.get("client_wall_ms")),
                ("outlayer_time_ms", lambda r: r.get("time_ms")),
                ("instructions", lambda r: r.get("instructions")),
                ("guest_total_ms", lambda r: (r.get("guest") or {}).get("total_ms"))]
    for stage in GUEST_STAGES:
        measures.append((f"guest.{stage}_ms", lambda r, s=stage: ((r.get("guest") or {}).get("ms") or {}).get(s)))
    measures += [("chain_receipt_ms", lambda r: r.get("chain_receipt_ms")),
                 ("chain_final_ms", lambda r: r.get("chain_final_ms")),
                 ("end_of_speech_to_receipt_ms", lambda r: r.get("end_to_receipt_ms"))]
    rows = []
    for name, get in measures:
        values = [v for v in (get(r) for r in records) if isinstance(v, (int, float))]
        if values:
            rows.append((name, len(values), percentile(values, 0.5), percentile(values, 0.95), max(values)))
    return rows


# ---------------------------------------------------------------------------
# Side effects (only with --run or --prepare)

def make_wavs(phrase, voices, seconds):
    """Makes one 16 kHz mono PCM16 WAV per voice with `say` and ffmpeg, once.
    Each is padded with silence to `seconds`; speech over 4 s is an error."""
    for tool in ("say", "ffmpeg"):
        if not shutil.which(tool):
            sys.exit(f"error: {tool} not found")
    os.makedirs(WAV_DIR, exist_ok=True)
    paths = []
    for voice in voices:
        slug = re.sub(r"[^a-z0-9]+", "-", f"{voice}-{phrase}-{seconds}".lower()).strip("-")
        out = os.path.join(WAV_DIR, slug + ".wav")
        if not os.path.exists(out):
            aiff = out[:-4] + ".aiff"
            said = subprocess.run(["say", "-v", voice, "-r", "175", "-o", aiff, phrase], capture_output=True)
            if said.returncode != 0:
                print(f"skip voice {voice}: not installed")
                continue
            raw = out[:-4] + ".raw.wav"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000",
                            "-sample_fmt", "s16", "-map_metadata", "-1", "-fflags", "+bitexact", raw], check=True)
            speech = wav_seconds(raw)
            if speech > 4.0:
                sys.exit(f"error: voice {voice} speaks for {speech:.2f} s, over 4 s; use a shorter phrase")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", f"apad=whole_dur={seconds}",
                            "-t", str(seconds), "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
                            "-map_metadata", "-1", "-fflags", "+bitexact", out], check=True)
            os.remove(aiff)
            os.remove(raw)
        length = wav_seconds(out)
        if not 3.0 <= length <= 4.0:
            sys.exit(f"error: {out} is {length:.2f} s, not 3-4 s")
        paths.append(out)
    if not paths:
        sys.exit("error: no voice made a WAV")
    return paths


def wav_seconds(path):
    with wave.open(path, "rb") as handle:
        return handle.getnframes() / handle.getframerate()


def post_json(url, body, headers, timeout):
    data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def call_outlayer(args, payment_key, wav_bytes):
    body = call_body(wav_bytes, args.expected, args.contacts, args.version_key,
                     {"max_instructions": args.max_instructions, "max_memory_mb": args.max_memory_mb,
                      "max_execution_seconds": args.max_seconds})
    started = time.monotonic()
    status, raw = post_json(args.url, body, {"X-Payment-Key": payment_key}, args.max_seconds + 60)
    wall_ms = round((time.monotonic() - started) * 1000)
    record = {"http_status": status, "client_wall_ms": wall_ms}
    try:
        response = json.loads(raw)
    except ValueError:
        record["error"] = f"non-JSON reply ({len(raw)} bytes)"
        return record
    record["time_ms"] = find_key(response, "time_ms")
    record["instructions"] = find_key(response, "instructions")
    record["attestation_url"] = find_key(response, "attestation_url")
    record["guest"] = worker_output(response)
    if status != 200 or record["guest"] is None:
        record["error"] = (json.dumps(response)[:400] if status != 200 else "no worker output")
    return record


def rpc_tx(args, tx_hash, wait_until):
    body = {"jsonrpc": "2.0", "id": "latency", "method": "tx",
            "params": {"tx_hash": tx_hash, "sender_account_id": args.account, "wait_until": wait_until}}
    status, raw = post_json(args.rpc, body, {}, 60)
    reply = json.loads(raw)
    if status != 200 or "error" in reply:
        raise RuntimeError(json.dumps(reply.get("error", reply))[:300])
    return reply["result"]


def self_transfer(args):
    command = ["near", "tokens", args.account, "send-near", args.account, "0.001 NEAR",
               "network-config", "testnet", args.sign_with, "send"]
    started = time.monotonic()
    cli = subprocess.run(command, capture_output=True, text=True, timeout=120)
    cli_ms = round((time.monotonic() - started) * 1000)
    record = {"chain_cli_ms": cli_ms}
    tx_hash = parse_tx_hash(cli.stdout + cli.stderr)
    if cli.returncode != 0 or not tx_hash:
        record["chain_error"] = f"near CLI exit {cli.returncode}, hash {tx_hash}"
        return record
    record["tx_hash"] = tx_hash
    try:
        result = rpc_tx(args, tx_hash, "EXECUTED")
        record["chain_receipt_ms"] = round((time.monotonic() - started) * 1000)
        record["tx_status"] = "SuccessValue" if "SuccessValue" in json.dumps(result.get("status")) else "other"
        rpc_tx(args, tx_hash, "FINAL")
        record["chain_final_ms"] = round((time.monotonic() - started) * 1000)
    except Exception as error:  # noqa: BLE001 - recorded, the run goes on
        record["chain_error"] = str(error)[:300]
    return record


# ---------------------------------------------------------------------------

def print_plan(args):
    print("PLAN (nothing runs without --run)")
    print(f"  runs              {args.runs}")
    print(f"  worker call       POST {args.url} (sync)")
    print(f"  payment key       {PAYMENT_KEY_NAME} from {args.env_file or '<--env-file required>'} (never printed)")
    print(f"  version_key       {args.version_key or '<none: active version>'}")
    print(f"  limits            {args.max_instructions} instructions, {args.max_memory_mb} MB, {args.max_seconds} s")
    print(f"  audio             say '{args.phrase}', voices {', '.join(args.voices)}, padded to {args.seconds} s")
    print(f"  WAV folder        {WAV_DIR}")
    print(f"  expected          '{args.expected}', contacts {args.contacts}")
    print(f"  chain             near tokens {args.account} send-near {args.account} '0.001 NEAR' "
          f"network-config testnet {args.sign_with} send")
    print(f"  receipt check     {args.rpc} tx wait_until EXECUTED, then FINAL")
    print(f"  records           {RECORD_DIR}/latency-<UTC>.jsonl")
    print("  cost (estimate)   per run: OutLayer base 0.001 NEAR + run time; transfer gas only (self-transfer)")
    print("  needs             project secret NEAR_AI_API_KEY on the voice-probe project; near CLI key for the account")
    print("Run it:  python3 latency.py --run --env-file <path> [--runs N] [--version-key <hash>]")
    print("Make only the WAVs (local):  python3 latency.py --prepare")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="really call OutLayer and send transactions")
    parser.add_argument("--prepare", action="store_true", help="only make the WAVs (local, no network)")
    parser.add_argument("--env-file", help=f"file with {PAYMENT_KEY_NAME}=...")
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--version-key", help="WASM hash of the voice-probe version to run")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--rpc", default=DEFAULT_RPC)
    parser.add_argument("--account", default=DEFAULT_ACCOUNT)
    parser.add_argument("--sign-with", default="sign-with-legacy-keychain")
    parser.add_argument("--phrase", default=DEFAULT_PHRASE)
    parser.add_argument("--expected", default=DEFAULT_EXPECTED)
    parser.add_argument("--contacts", nargs="*", default=DEFAULT_CONTACTS)
    parser.add_argument("--voices", nargs="+", default=DEFAULT_VOICES)
    parser.add_argument("--seconds", type=float, default=3.5)
    parser.add_argument("--max-instructions", type=int, default=50_000_000_000)
    parser.add_argument("--max-memory-mb", type=int, default=512)
    parser.add_argument("--max-seconds", type=int, default=60)
    parser.add_argument("--pause", type=float, default=2.0, help="seconds between runs")
    args = parser.parse_args(argv)

    if args.prepare:
        for path in make_wavs(args.phrase, args.voices, args.seconds):
            print(f"{path}  {wav_seconds(path):.2f} s")
        return 0
    if not args.run:
        print_plan(args)
        return 0
    if not args.env_file:
        parser.error("--run needs --env-file")
    for tool in ("near",):
        if not shutil.which(tool):
            sys.exit(f"error: {tool} not found")
    payment_key = read_env_value(args.env_file, PAYMENT_KEY_NAME)
    if not payment_key:
        sys.exit(f"error: {PAYMENT_KEY_NAME} is not set in the env file")

    wavs = [open(path, "rb").read() for path in make_wavs(args.phrase, args.voices, args.seconds)]
    os.makedirs(RECORD_DIR, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    record_path = os.path.join(RECORD_DIR, f"latency-{stamp}.jsonl")
    records = []
    with open(record_path, "w", encoding="utf-8") as out:
        for index in range(args.runs):
            record = {"run": index + 1, "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "version_key": args.version_key}
            record.update(call_outlayer(args, payment_key, wavs[index % len(wavs)]))
            record.update(self_transfer(args))
            if "client_wall_ms" in record and "chain_receipt_ms" in record:
                record["end_to_receipt_ms"] = record["client_wall_ms"] + record["chain_receipt_ms"]
            records.append(record)
            out.write(json.dumps(record) + "\n")
            out.flush()
            guest = record.get("guest") or {}
            print(f"run {index + 1:>3}: wall {record.get('client_wall_ms')} ms, time_ms {record.get('time_ms')}, "
                  f"matched {guest.get('matched')}, errors {guest.get('errors')}, "
                  f"receipt {record.get('chain_receipt_ms')} ms, end-to-receipt {record.get('end_to_receipt_ms')} ms"
                  + (f", error {record['error']}" if record.get("error") else "")
                  + (f", chain error {record['chain_error']}" if record.get("chain_error") else ""))
            if index + 1 < args.runs:
                time.sleep(args.pause)

    print(f"\nrecords: {record_path}")
    print(f"{'measure':<34}{'n':>4}{'p50':>16}{'p95':>16}{'max':>16}")
    for name, count, p50, p95, top in summarize(records):
        print(f"{name:<34}{count:>4}{p50:>16,}{p95:>16,}{top:>16,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
