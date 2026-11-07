#!/usr/bin/env python3
"""Speak-to-Sign demo client: it stands in for the Wallet on the HTTPS path
(plan Section 7.5).

  enroll  Makes three WAVs of a macOS `say` voice, computes their enrollment
          digest, and signs and sends the owner's `authorize_enrollment` on
          the vault over RPC (send_tx, FINAL: the verifier reads it with
          finality final). Then it calls the verifier operation `enroll` over
          OutLayer's HTTPS API. Prints the result and the verifier key to pin
          in the vault.
  pay     Reads the vault state over RPC, makes a WAV that says
          "send <amount> near to <contact>", calls `verify`, checks the signed
          verdict locally, then signs and sends ONE vault transaction
          `transfer_with_verdict` over RPC (send_tx, NONE) and polls
          EXPERIMENTAL_tx_status. Prints two times: "vault accepted" (the
          function call receipt succeeded; the vault state is final) and
          "settled" (the transfer and its callback ran too).

The OutLayer payment key comes from an env file (OUTLAYER_PAYMENT_KEY=...).
It is never printed. The NEAR key comes from a near-cli legacy key file; its
private key is never printed.

Needs: macOS `say`, ffmpeg, PyNaCl.
"""
import argparse
import base64
import decimal
import hashlib
import io
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
ENROLLMENT_DOMAIN = b"seams:voice-enrollment:v1"
YOCTO_PER_NEAR = 10 ** 24
YOCTO_PER_HUNDREDTH = 10 ** 22
TRANSFER_GAS = 50 * 10 ** 12
AUTHORIZE_GAS = 10 * 10 ** 12
POLL_SECONDS = 0.1
SETTLE_TIMEOUT_SECONDS = 60
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


def b58encode(data):
    number = int.from_bytes(data, "big")
    digits = ""
    while number:
        number, rest = divmod(number, 58)
        digits = B58[rest] + digits
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + digits


def b64u(data):
    """Unpadded base64url."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def canonical_wav(data):
    """The verifier's canonical WAV of a 16 kHz mono PCM16 WAV: a 44-byte
    header, then the samples. Its SHA-256 is the audio digest."""
    with wave.open(io.BytesIO(data), "rb") as handle:
        shape = (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getcomptype())
        if shape != (1, 2, 16000, "NONE"):
            raise ValueError(f"not a 16 kHz mono PCM16 WAV: {shape}")
        pcm = handle.readframes(handle.getnframes())
    header = (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
              + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16) + b"data" + struct.pack("<I", len(pcm)))
    return header + pcm


def enrollment_digest(vault, owner, audio_digests):
    """base64url SHA-256(domain || vault || 0 || owner || 0 || d1 || d2 || d3);
    each audio digest is 32 raw bytes."""
    preimage = ENROLLMENT_DOMAIN + vault.encode() + b"\0" + owner.encode() + b"\0" + b"".join(audio_digests)
    return b64u(hashlib.sha256(preimage).digest())


def tx_progress(result):
    """What an EXPERIMENTAL_tx_status reply shows so far.

    accepted: True or False once the first receipt (the function call on the
    vault) has an outcome, else None. settled: the whole transaction has a
    final status (every receipt ran)."""
    first_ids = find_key(result.get("transaction_outcome", {}), "receipt_ids") or []
    outcomes = {item.get("id"): item.get("outcome", {}) for item in result.get("receipts_outcome", [])}
    accepted = None
    if first_ids and first_ids[0] in outcomes:
        status = outcomes[first_ids[0]].get("status", {})
        if isinstance(status, dict) and ("SuccessValue" in status or "SuccessReceiptId" in status):
            accepted = True
        elif isinstance(status, dict) and "Failure" in status:
            accepted = False
    status = result.get("status")
    settled = isinstance(status, dict) and ("SuccessValue" in status or "Failure" in status)
    failures = [outcome["status"] for outcome in outcomes.values()
                if isinstance(outcome.get("status"), dict) and "Failure" in outcome["status"]]
    logs = [log for outcome in outcomes.values() for log in outcome.get("logs", [])]
    return {"accepted": accepted, "settled": settled, "failures": failures, "logs": logs}


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


def view(contract, method, args, finality="optimistic"):
    result = rpc("query", {"request_type": "call_function", "finality": finality, "account_id": contract,
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


def load_owner_key(path, owner):
    """(nacl SigningKey, 32-byte public key, 'ed25519:...' text) from a
    near-cli legacy key file. The private key is never printed."""
    import nacl.signing  # PyNaCl

    with open(os.path.expanduser(path), encoding="utf-8") as handle:
        key_file = json.load(handle)
    signer_id = key_file.get("account_id") or owner
    if signer_id != owner:
        sys.exit(f"error: the key file is for {signer_id}, not the owner {owner}")
    signer = nacl.signing.SigningKey(b58decode(key_file["private_key"].split(":", 1)[1])[:32])
    public_key = bytes(signer.verify_key)
    if b58decode(key_file["public_key"].split(":", 1)[1]) != public_key:
        sys.exit("error: the key file's public key does not match its private key")
    return signer, public_key, key_file["public_key"]


def tx_inputs(owner, public_key_text):
    """(next access key nonce, recent final block hash)."""
    access = rpc("query", {"request_type": "view_access_key", "finality": "optimistic",
                           "account_id": owner, "public_key": public_key_text})
    block_hash = b58decode(rpc("block", {"finality": "final"})["header"]["hash"])
    return access["nonce"] + 1, block_hash


def authorize(args, key, digest):
    """Signs and sends the owner's authorize_enrollment(digest); waits for
    FINAL, because the verifier reads the vault with finality final."""
    signer, public_key, public_key_text = key
    nonce, block_hash = tx_inputs(args.owner, public_key_text)
    call_args = json.dumps({"enrollment_digest": digest}).encode()
    tx = function_call_tx(args.owner, public_key, nonce, args.vault, block_hash, "authorize_enrollment", call_args,
                          AUTHORIZE_GAS, 0)
    started = time.monotonic()
    result = rpc("send_tx", {"signed_tx_base64": signed_tx_base64(tx, signer), "wait_until": "FINAL"})
    final_ms = round((time.monotonic() - started) * 1000)
    tx_hash = result["transaction"]["hash"]
    print(f"authorize  {tx_hash}  final in {final_ms} ms  https://testnet.nearblocks.io/txns/{tx_hash}")
    status = result.get("status", {})
    if "SuccessValue" not in status:
        sys.exit(f"error: authorize_enrollment failed: {json.dumps(status)[:300]}")
    pending = view(args.vault, "get_pending_enrollment", {"owner_id": args.owner}, finality="final")
    if not pending or pending.get("enrollment_digest") != digest:
        sys.exit(f"error: the vault's final pending enrollment is {pending}, not {digest}")
    print(f"authorize  pending until {pending['expires_at_ns']} ns")


def cmd_enroll(args):
    payment_key = payment_key_from(args.env_file)
    key = load_owner_key(args.key_file, args.owner)
    with tempfile.TemporaryDirectory() as folder:
        clips = [make_wav(phrase, args.voice, folder) for phrase in ENROLL_PHRASES]
    wavs = [canonical_wav(wav) for wav, _ in clips]
    for phrase, (_, seconds) in zip(ENROLL_PHRASES, clips):
        print(f"clip  {seconds:4.2f} s  {phrase}")
    digest = enrollment_digest(args.vault, args.owner, [hashlib.sha256(wav).digest() for wav in wavs])
    print(f"enrollment digest {digest}")

    # The owner authorizes exactly these three recordings, then enrolls.
    authorize(args, key, digest)
    payload = {"op": "enroll", "vault": args.vault, "owner": args.owner,
               "audio_wav_b64": [base64.b64encode(wav).decode() for wav in wavs]}
    output, wall_ms, time_ms = call_outlayer(args, payment_key, payload)
    print(json.dumps(output, indent=2))
    print(f"enroll: HTTPS wall {wall_ms} ms, OutLayer time_ms {time_ms}")
    if output.get("enrollment_digest") not in (None, digest):
        print(f"warning: the verifier computed {output['enrollment_digest']}, not {digest}")
    if output.get("verifier_public_key"):
        print("vault init args: " + json.dumps({"verifier_public_key": output["verifier_public_key"],
                                                "contact_delay_seconds": 0}))
    return 0 if output.get("outcome") == "accept" else 1


def send_and_follow(signed_tx, tx_hash, sender):
    """Sends with wait_until NONE, then polls EXPERIMENTAL_tx_status.
    Returns (accepted ms or None, settled ms or None, last progress, last
    result). The times are from the send."""
    sent = time.monotonic()
    rpc("send_tx", {"signed_tx_base64": signed_tx, "wait_until": "NONE"})
    accepted_ms = settled_ms = None
    progress, result = {"accepted": None, "settled": False, "failures": [], "logs": []}, {}
    while time.monotonic() - sent < SETTLE_TIMEOUT_SECONDS:
        try:
            result = rpc("EXPERIMENTAL_tx_status", {"tx_hash": tx_hash, "sender_account_id": sender,
                                                    "wait_until": "NONE"}, timeout=15)
        except RuntimeError as error:
            # Not seen yet by this RPC node.
            if "UNKNOWN_TRANSACTION" in str(error) or "TIMEOUT_ERROR" in str(error):
                time.sleep(POLL_SECONDS)
                continue
            raise
        progress = tx_progress(result)
        now_ms = round((time.monotonic() - sent) * 1000)
        if progress["accepted"] is not None and accepted_ms is None:
            accepted_ms = now_ms
            print(f"vault   {'accepted' if progress['accepted'] else 'refused'} {accepted_ms} ms after send")
            if not progress["accepted"]:
                break
        if progress["settled"]:
            settled_ms = now_ms
            break
        time.sleep(POLL_SECONDS)
    return accepted_ms, settled_ms, progress, result


def cmd_pay(args):
    import nacl.signing  # PyNaCl

    payment_key = payment_key_from(args.env_file)
    amount_yocto = near_to_yocto(args.amount)
    signer, public_key, public_key_text = load_owner_key(args.key_file, args.owner)

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
    access_nonce, block_hash = tx_inputs(args.owner, public_key_text)

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
    tx = function_call_tx(args.owner, public_key, access_nonce, args.vault, block_hash,
                          "transfer_with_verdict", call_args, TRANSFER_GAS, 0)
    tx_hash = b58encode(hashlib.sha256(tx).digest())
    print(f"tx      {tx_hash}  https://testnet.nearblocks.io/txns/{tx_hash}")
    send_offset_ms = round((time.monotonic() - t0) * 1000)
    accepted_ms, settled_ms, progress, result = send_and_follow(signed_tx_base64(tx, signer), tx_hash, args.owner)

    print(f"status  {json.dumps(result.get('status', {}))[:300]}")
    for log in progress["logs"]:
        print(f"log     {log[:300]}")
    if progress["failures"]:
        print(f"failure {json.dumps(progress['failures'])[:400]}")
    shown = lambda ms: "n/a" if ms is None else f"{ms} ms"  # noqa: E731
    print(f"times   verify {verify_ms} ms + local check {check_ms} ms + tx to vault accepted {shown(accepted_ms)}"
          f" (to settled {shown(settled_ms)})")
    to_end = lambda ms: "n/a" if ms is None else f"{send_offset_ms + ms} ms"  # noqa: E731
    print(f"total   end of speech to vault accepted {to_end(accepted_ms)}, to settled {to_end(settled_ms)}"
          f" (speech itself {seconds:.2f} s)")
    status = result.get("status", {})
    return 0 if progress["accepted"] and "SuccessValue" in status and not progress["failures"] else 1


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
        command.add_argument("--key-file", required=True, help="near-cli legacy key file of the owner")
        if name == "pay":
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
