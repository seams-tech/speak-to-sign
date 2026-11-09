"""Transcribe STT-1 cases with Whisper large-v3 on NEAR AI Cloud.

Usage:
  python3 -I near_ai_stt.py probe <cases.jsonl> <env-file>
      One call: print the response body, the headers and the signature lookup.
  python3 -I near_ai_stt.py run <cases.jsonl> <env-file> <out.jsonl> [workers]
      Every case; resumable (skips case ids already in out.jsonl).

Audio files are raw little-endian f32 mono 16 kHz; each is sent as 16-bit WAV.
The API key is read from NEAR_AI_API_KEY in the env file and never printed.
"""
import io
import json
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor

API = "https://cloud-api.near.ai/v1"
MODEL = "openai/whisper-large-v3"


def api_key(env_file):
    for line in open(env_file):
        if line.startswith("NEAR_AI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("NEAR_AI_API_KEY missing")


def wav_bytes(f32_path):
    raw = open(f32_path, "rb").read()
    count = len(raw) // 4
    samples = struct.unpack(f"<{count}f", raw[: count * 4])
    pcm = struct.pack(f"<{count}h", *(max(-32768, min(32767, int(s * 32767))) for s in samples))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(pcm)
    return buffer.getvalue(), count / 16000


def transcribe(key, wav):
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{MODEL}\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n".encode()
        + wav
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    request = urllib.request.Request(
        f"{API}/audio/transcriptions",
        body,
        {
            "Authorization": f"Bearer {key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "x-no-aliasing": "true",
        },
    )
    started = time.time()
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read()
        headers = dict(response.headers)
    return payload, headers, time.time() - started


def signature(key, response_id):
    request = urllib.request.Request(
        f"{API}/signature/{response_id}?model={MODEL}&signing_algo=ed25519",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read().decode()[:800]
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:400]


def probe(cases, env_file):
    key = api_key(env_file)
    case = json.loads(open(cases).readline())
    wav, seconds = wav_bytes(case["audio"])
    payload, headers, elapsed = transcribe(key, wav)
    print("expected:", case["text"], f"({seconds:.2f} s audio, {elapsed:.2f} s call)")
    print("body:", payload.decode()[:800])
    print("headers:", json.dumps({k: v for k, v in headers.items() if k.lower() not in ("set-cookie",)})[:800])
    body = json.loads(payload)
    response_id = body.get("id") or headers.get("x-request-id") or headers.get("X-Request-Id")
    print("response id:", response_id)
    if response_id:
        print("signature:", signature(key, response_id))


def run(cases, env_file, out_path, workers):
    key = api_key(env_file)
    done = set()
    try:
        done = {json.loads(line)["caseId"] for line in open(out_path)}
    except FileNotFoundError:
        pass
    todo = [json.loads(line) for line in open(cases)]
    todo = [case for case in todo if case["caseId"] not in done]
    lock = threading.Lock()
    out = open(out_path, "a")

    def one(case):
        wav, seconds = wav_bytes(case["audio"])
        for attempt in range(5):
            try:
                payload, _, elapsed = transcribe(key, wav)
                text = json.loads(payload).get("text", "")
                record = {"caseId": case["caseId"], "heard": text, "seconds": round(elapsed, 3), "audioSeconds": round(seconds, 3)}
                break
            except Exception as error:  # rate limits and timeouts
                record = {"caseId": case["caseId"], "error": str(error)[:200]}
                time.sleep(2 * (attempt + 1))
        with lock:
            out.write(json.dumps(record) + "\n")
            out.flush()

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, todo))
    print("transcribed", len(todo))


if __name__ == "__main__":
    if sys.argv[1] == "probe":
        probe(sys.argv[2], sys.argv[3])
    else:
        run(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 8)
