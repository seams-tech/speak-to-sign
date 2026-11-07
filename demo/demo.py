#!/usr/bin/env python3
"""Speak-to-Sign demo client: it stands in for the Wallet on the HTTPS path
(plan Section 7.5).

  enroll  Makes three WAVs of a macOS `say` voice and calls the verifier
          operation `enroll` over OutLayer's HTTPS API. Prints the result and
          the verifier key to pin in the vault.
  pay     Reads the vault state over RPC, makes a WAV that says
          "send <amount> near to <contact>", calls `verify`, checks the signed
          verdict locally, then signs and sends ONE vault transaction
          `transfer_with_verdict` over RPC (send_tx, EXECUTED_OPTIMISTIC).
          Prints the stage times and the time from the end of speech to the
          executed receipt.

The OutLayer payment key comes from an env file (OUTLAYER_PAYMENT_KEY=...).
It is never printed. The NEAR key comes from a near-cli legacy key file; its
private key is never printed.

Needs: macOS `say`, ffmpeg, PyNaCl.
"""
import argparse
import base64
import decimal
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

OUTLAYER_URL = "https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier"
RPC_URL = "https://test.rpc.fastnear.com"
SECRETS_REF = {"profile": "main", "account_id": "cyan-loong.testnet"}
PAYMENT_KEY_NAME = "OUTLAYER_PAYMENT_KEY"
VERDICT_DOMAIN = b"seams:outlayer:voice-verdict:v1"
YOCTO_PER_NEAR = 10 ** 24
YOCTO_PER_HUNDREDTH = 10 ** 22
TRANSFER_GAS = 50 * 10 ** 12
ENROLL_PHRASES = [
    "My voice is my signature for this vault.",
    "I send money only to the contacts I saved.",
    "Seams, please learn how I sound today.",
]
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


# ---------------------------------------------------------------------------
# Pure helpers (see test_demo.py)

def read_env_value(path, name):
    """The value of `name` in a KEY=VALUE file, or None. Reads only that
    one name; never returns or prints anything else."""
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


def b58decode(text):
    number = 0
    for char in text:
        number = number * 58 + B58.index(char)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    return b"\0" * (len(text) - len(text.lstrip("1"))) + raw


def near_to_yocto(text):
    """'2', '2.5' or '0.01' NEAR to yoctoNEAR. The vault grammar takes only
    whole hundredths, so other amounts are refused here."""
    try:
        value = decimal.Decimal(text)
    except decimal.InvalidOperation:
        raise ValueError(f"not a number: {text}") from None
    yocto = value * YOCTO_PER_NEAR
    if value <= 0 or yocto != yocto.to_integral_value() or int(yocto) % YOCTO_PER_HUNDREDTH:
        raise ValueError(f"amount must be a positive whole number of hundredths of NEAR: {text}")
    return int(yocto)


def spoken_account(account_id):
    """How `say` should read an account: 'alice.testnet' -> 'alice dot testnet'."""
    words = account_id.replace(".", " dot ").replace("-", " dash ").replace("_", " underscore ")
    return " ".join(words.split())


def pay_phrase(amount_text, contact):
    return f"Send {amount_text} NEAR to {spoken_account(contact)}."


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
    """The worker's JSON output from an OutLayer HTTPS reply."""
    output = find_key(response, "output")
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except ValueError:
            return None
    return output if isinstance(output, dict) else None


def verdict_message(verdict_json):
    return hashlib.sha256(VERDICT_DOMAIN + verdict_json.encode()).digest()


def borsh_string(value):
    data = value.encode() if isinstance(value, str) else value
    return struct.pack("<I", len(data)) + data


def function_call_tx(signer, public_key, nonce, receiver, block_hash, method, args, gas, deposit):
    """Borsh Transaction (v0) with one FunctionCall action (enum index 2)."""
    return (
        borsh_string(signer)
        + b"\x00" + public_key
        + struct.pack("<Q", nonce)
        + borsh_string(receiver)
        + block_hash
        + struct.pack("<I", 1)
        + b"\x02" + borsh_string(method) + borsh_string(args)
        + struct.pack("<Q", gas) + deposit.to_bytes(16, "little")
    )


def signed_tx_base64(tx, signer):
    """`signer` is a nacl SigningKey. NEAR signs SHA-256 of the borsh bytes."""
    signature = signer.sign(hashlib.sha256(tx).digest()).signature
    return base64.b64encode(tx + b"\x00" + signature).decode()


# ---------------------------------------------------------------------------
# Side effects

def post_json(url, body, headers, timeout):
    data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def rpc(method, params, timeout=60):
    status, raw = post_json(RPC_URL, {"jsonrpc": "2.0", "id": "demo", "method": method, "params": params}, {}, timeout)
    reply = json.loads(raw)
    if status != 200 or "error" in reply:
        raise RuntimeError(json.dumps(reply.get("error", reply))[:400])
    return reply["result"]


def view(contract, method, args):
    result = rpc("query", {"request_type": "call_function", "finality": "optimistic", "account_id": contract,
                           "method_name": method,
                           "args_base64": base64.b64encode(json.dumps(args).encode()).decode()})
    return json.loads(bytes(result["result"]))


def make_wav(phrase, voice, folder, rate=175):
    """A 16 kHz mono PCM16 WAV of `say -v voice -r rate phrase`."""
    for tool in ("say", "ffmpeg"):
        if not shutil.which(tool):
            sys.exit(f"error: {tool} not found")
    slug = re.sub(r"[^a-z0-9]+", "-", f"{voice}-{rate}-{phrase}".lower()).strip("-")[:80]
    aiff = os.path.join(folder, slug + ".aiff")
    out = os.path.join(folder, slug + ".wav")
    said = subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", aiff, phrase], capture_output=True)
    if said.returncode != 0:
        sys.exit(f"error: say -v {voice} failed: {said.stderr.decode()[:200]}")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
                    "-map_metadata", "-1", "-fflags", "+bitexact", out], check=True)
    with wave.open(out, "rb") as handle:
        seconds = handle.getnframes() / handle.getframerate()
    if seconds > 8.0:
        sys.exit(f"error: {out} is {seconds:.2f} s; the verifier takes at most 8 s")
    with open(out, "rb") as handle:
        return handle.read(), seconds


def call_outlayer(args, payment_key, payload):
    body = {"input": payload, "async": False, "secrets_ref": SECRETS_REF,
            "resource_limits": {"max_instructions": 10_000_000_000, "max_memory_mb": 256, "max_execution_seconds": 60}}
    if args.version_key:
        body["version_key"] = args.version_key
    started = time.monotonic()
    status, raw = post_json(args.url, body, {"X-Payment-Key": payment_key}, 120)
    wall_ms = round((time.monotonic() - started) * 1000)
    try:
        response = json.loads(raw)
    except ValueError:
        sys.exit(f"error: OutLayer HTTP {status}, non-JSON reply ({len(raw)} bytes)")
    output = worker_output(response)
    if status != 200 or output is None:
        sys.exit(f"error: OutLayer HTTP {status}: {json.dumps(response)[:400]}")
    return output, wall_ms, find_key(response, "time_ms")


def payment_key_from(path):
    key = read_env_value(path, PAYMENT_KEY_NAME)
    if not key:
        sys.exit(f"error: {PAYMENT_KEY_NAME} is not set in the env file")
    return key


def cmd_enroll(args):
    payment_key = payment_key_from(args.env_file)
    with tempfile.TemporaryDirectory() as folder:
        clips = [make_wav(phrase, args.voice, folder) for phrase in ENROLL_PHRASES]
    for phrase, (_, seconds) in zip(ENROLL_PHRASES, clips):
        print(f"clip  {seconds:4.2f} s  {phrase}")
    payload = {"op": "enroll", "vault": args.vault, "owner": args.owner,
               "audio_wav_b64": [base64.b64encode(wav).decode() for wav, _ in clips]}
    output, wall_ms, time_ms = call_outlayer(args, payment_key, payload)
    print(json.dumps(output, indent=2))
    print(f"enroll: HTTPS wall {wall_ms} ms, OutLayer time_ms {time_ms}")
    if output.get("verifier_public_key"):
        print("vault init args: " + json.dumps({"verifier_public_key": output["verifier_public_key"],
                                                "contact_delay_seconds": 0}))
    return 0 if output.get("outcome") == "accept" else 1


def cmd_pay(args):
    import nacl.signing  # PyNaCl

    payment_key = payment_key_from(args.env_file)
    amount_yocto = near_to_yocto(args.amount)
    with open(os.path.expanduser(args.key_file), encoding="utf-8") as handle:
        key_file = json.load(handle)
    signer_id = key_file.get("account_id") or args.owner
    if signer_id != args.owner:
        sys.exit(f"error: the key file is for {signer_id}, not the owner {args.owner}")
    secret = b58decode(key_file["private_key"].split(":", 1)[1])
    signer = nacl.signing.SigningKey(secret[:32])
    public_key = bytes(signer.verify_key)
    if b58decode(key_file["public_key"].split(":", 1)[1]) != public_key:
        sys.exit("error: the key file's public key does not match its private key")

    # Before speech, as a Wallet would: vault state, pinned key, tx inputs.
    vault = view(args.vault, "get_vault", {"owner_id": args.owner})
    if vault is None:
        sys.exit(f"error: {args.owner} has no vault on {args.vault}")
    contacts = view(args.vault, "get_contacts", {"owner_id": args.owner})
    names = [contact["account_id"] for contact in contacts]
    active = {contact["account_id"]: contact["active"] for contact in contacts}
    if not active.get(args.contact):
        sys.exit(f"error: {args.contact} is not an active contact (contacts: {active})")
    pinned = view(args.vault, "get_verifier", {})["verifier_public_key"]
    nonce = int(vault["next_nonce"])
    access = rpc("query", {"request_type": "view_access_key", "finality": "optimistic",
                           "account_id": args.owner, "public_key": key_file["public_key"]})
    block_hash = b58decode(rpc("block", {"finality": "final"})["header"]["hash"])

    # --say speaks other words than the request, to show a refusal.
    phrase = args.say or pay_phrase(args.amount, args.contact)
    with tempfile.TemporaryDirectory() as folder:
        wav, seconds = make_wav(phrase, args.voice, folder, args.rate)
    print(f"speech  {seconds:4.2f} s  \"{phrase}\"  (vault nonce {nonce})")

    # End of speech.
    t0 = time.monotonic()
    payload = {"op": "verify", "vault": args.vault, "owner": args.owner, "receiver": args.contact,
               "amount_yocto": str(amount_yocto), "nonce": nonce, "contacts": names,
               "audio_wav_b64": base64.b64encode(wav).decode()}
    output, verify_ms, time_ms = call_outlayer(args, payment_key, payload)
    verdict_text = output.get("verdict_json") or "{}"
    verdict = json.loads(verdict_text)
    print(f"verify  HTTPS wall {verify_ms} ms, OutLayer time_ms {time_ms}, worker ms {json.dumps(output.get('ms'))}")
    print(f"verdict {verdict.get('outcome')} reason={verdict.get('reason')} speaker={verdict.get('speaker_score_milli')} "
          f"heard=\"{verdict.get('heard')}\" detail={output.get('detail')}")
    if verdict.get("outcome") != "accept" or not output.get("signature_b64"):
        print("nothing sent")
        return 1

    # The Wallet checks the signature and the key before it pays for gas.
    checked = time.monotonic()
    if output.get("public_key") != pinned:
        sys.exit(f"error: verdict key {output.get('public_key')} is not the vault's pinned key {pinned}")
    verify_key = nacl.signing.VerifyKey(b58decode(pinned.split(":", 1)[1]))
    verify_key.verify(verdict_message(verdict_text), base64.b64decode(output["signature_b64"]))
    check_ms = round((time.monotonic() - checked) * 1000)

    call_args = json.dumps({"receiver_id": args.contact, "amount": str(amount_yocto), "nonce": str(nonce),
                            "verdict_json": verdict_text, "signature_b64": output["signature_b64"]}).encode()
    tx = function_call_tx(args.owner, public_key, access["nonce"] + 1, args.vault, block_hash,
                          "transfer_with_verdict", call_args, TRANSFER_GAS, 0)
    sent = time.monotonic()
    result = rpc("send_tx", {"signed_tx_base64": signed_tx_base64(tx, signer), "wait_until": "EXECUTED_OPTIMISTIC"})
    receipt_ms = round((time.monotonic() - sent) * 1000)
    total_ms = round((time.monotonic() - t0) * 1000)

    tx_hash = result["transaction"]["hash"]
    status = result.get("status", {})
    failures = [outcome["outcome"]["status"] for outcome in result.get("receipts_outcome", [])
                if "Failure" in outcome["outcome"]["status"]]
    logs = [log for outcome in result.get("receipts_outcome", []) for log in outcome["outcome"]["logs"]]
    print(f"tx      {tx_hash}  https://testnet.nearblocks.io/txns/{tx_hash}")
    print(f"status  {json.dumps(status)[:300]}")
    for log in logs:
        print(f"log     {log[:300]}")
    if failures:
        print(f"failure {json.dumps(failures)[:400]}")
    print(f"times   verify {verify_ms} ms + local check {check_ms} ms + tx to executed receipt {receipt_ms} ms")
    print(f"total   end of speech to receipt {total_ms} ms (speech itself {seconds:.2f} s)")
    return 0 if "SuccessValue" in status and not failures else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("enroll", "pay"):
        command = sub.add_parser(name)
        command.add_argument("--env-file", required=True, help=f"file with {PAYMENT_KEY_NAME}=... (never printed)")
        command.add_argument("--vault", required=True, help="vault contract account")
        command.add_argument("--owner", required=True, help="vault owner account")
        command.add_argument("--voice", default="Samantha", help="macOS say voice (the same for enroll and pay)")
        command.add_argument("--rate", type=int, default=175, help="say rate in words per minute; a new rate makes a new recording")
        command.add_argument("--version-key", help="verifier version (WASM hash) to run")
        command.add_argument("--url", default=OUTLAYER_URL)
        if name == "pay":
            command.add_argument("--key-file", required=True, help="near-cli legacy key file of the owner")
            command.add_argument("--amount", required=True, help="NEAR, whole hundredths, e.g. 2 or 0.5")
            command.add_argument("--contact", required=True, help="an active vault contact")
            command.add_argument("--say", help="speak this text instead of the request (shows a refusal)")
    args = parser.parse_args(argv)
    try:
        return cmd_enroll(args) if args.command == "enroll" else cmd_pay(args)
    except ValueError as error:
        sys.exit(f"error: {error}")


if __name__ == "__main__":
    sys.exit(main())
