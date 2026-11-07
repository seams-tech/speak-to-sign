// The vault transfer subset of the `spoken-intent` crate (crates/spoken-intent): the same
// account and amount rules, the same rendered words and the same Borsh bytes and digests.
// The crate's golden vectors check this port.

export const RENDERER_VERSION = 'spoken-intent/1';
const REQUEST_DIGEST_DOMAIN = 'seams:spoken-intent:request:v1';
const SPOKEN_TEXT_DIGEST_DOMAIN = 'seams:spoken-intent:spoken:v1';
const YOCTO_PER_HUNDREDTH = 10n ** 22n;
const MAX_HUNDREDTHS = 100_000_000n;

export type SpokenNetwork = 'testnet' | 'mainnet';

export type VaultTransferRequest = Readonly<{
  network: SpokenNetwork;
  vault: string;
  owner: string;
  receiver: string;
  /** A whole multiple of 0.01 NEAR, from 0.01 to 1,000,000 NEAR. */
  amountYocto: bigint;
  nonce: bigint;
}>;

export type RenderedTransfer = Readonly<{
  /** The sentence that the capture surface shows. */
  displayText: string;
  /** The words that the owner says, joined with single spaces. */
  spokenText: string;
}>;

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: ReadonlyArray<readonly [string, bigint]> = [
  ['quintillion', 10n ** 18n],
  ['quadrillion', 10n ** 15n],
  ['trillion', 10n ** 12n],
  ['billion', 10n ** 9n],
  ['million', 10n ** 6n],
  ['thousand', 1_000n],
];

/** A named NEAR account that the grammar can speak; implicit and `0x` accounts are refused. */
export function isSpeakableAccount(accountId: string): boolean {
  if (accountId.length < 2 || accountId.length > 64) return false;
  if (accountId.length === 64 && /^[0-9a-fA-F]+$/.test(accountId)) return false;
  if (accountId.startsWith('0x')) return false;
  return accountId.split('.').every(isValidPart);
}

function isValidPart(part: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(part);
}

/** `"2.5"` NEAR to yoctoNEAR, or null when the grammar cannot speak the amount. It never rounds. */
export function parseSpeakableNear(text: string): bigint | null {
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const hundredths = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return isSpeakableHundredths(hundredths) ? hundredths * YOCTO_PER_HUNDREDTH : null;
}

function isSpeakableHundredths(hundredths: bigint): boolean {
  return hundredths > 0n && hundredths <= MAX_HUNDREDTHS;
}

/** The one canonical sentence of a vault transfer. */
export function renderTransfer(request: VaultTransferRequest): RenderedTransfer {
  const hundredths = request.amountYocto / YOCTO_PER_HUNDREDTH;
  const words = [
    'send',
    ...amountWords(hundredths),
    'near',
    'to',
    ...accountWords(request.receiver),
  ];
  return {
    displayText: `Send ${displayAmount(hundredths)} NEAR to ${request.receiver}`,
    spokenText: words.join(' '),
  };
}

function amountWords(hundredths: bigint): string[] {
  const words = integerWords(hundredths / 100n);
  const fraction = Number(hundredths % 100n);
  if (fraction !== 0) {
    words.push('point', ONES[Math.floor(fraction / 10)]);
    if (fraction % 10 !== 0) words.push(ONES[fraction % 10]);
  }
  return words;
}

function displayAmount(hundredths: bigint): string {
  const digits = (hundredths / 100n).toString();
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits[index];
  }
  const fraction = Number(hundredths % 100n);
  if (fraction !== 0) {
    out += `.${Math.floor(fraction / 10)}`;
    if (fraction % 10 !== 0) out += String(fraction % 10);
  }
  return out;
}

function integerWords(value: bigint): string[] {
  if (value === 0n) return [ONES[0]];
  const words: string[] = [];
  let rest = value;
  for (const [word, scale] of SCALES) {
    const group = rest / scale;
    if (group > 0n) {
      words.push(...belowThousand(Number(group)), word);
      rest %= scale;
    }
  }
  if (rest > 0n) words.push(...belowThousand(Number(rest)));
  return words;
}

function belowThousand(value: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) words.push(ONES[hundreds], 'hundred');
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10 !== 0) words.push(ONES[rest % 10]);
  } else if (rest > 0) {
    words.push(ONES[rest]);
  }
  return words;
}

/** "bob-1.testnet" is "bob dash one dot testnet": letter runs, one word per digit and separator. */
function accountWords(accountId: string): string[] {
  return accountId.match(/[a-z]+|[^a-z]/g)!.map(separatorWord);
}

function separatorWord(piece: string): string {
  if (piece === '.') return 'dot';
  if (piece === '-') return 'dash';
  if (piece === '_') return 'underscore';
  return /^\d$/.test(piece) ? ONES[Number(piece)] : piece;
}

/** Borsh of `SpokenRequestV1::VaultTransfer`. */
export function transferBorsh(request: VaultTransferRequest): Uint8Array {
  const parts: Uint8Array[] = [
    Uint8Array.of(0, request.network === 'testnet' ? 0 : 1),
    borshString(request.vault),
    borshString(request.owner),
    borshString(request.receiver),
    littleEndian(request.amountYocto, 16),
    littleEndian(request.nonce, 8),
  ];
  return concat(parts);
}

/** `sha256(REQUEST_DIGEST_DOMAIN || borsh(request))`. */
export async function requestDigest(request: VaultTransferRequest): Promise<Uint8Array> {
  return await sha256(concat([utf8(REQUEST_DIGEST_DOMAIN), transferBorsh(request)]));
}

/** `sha256(SPOKEN_TEXT_DIGEST_DOMAIN || spoken_text)`. */
export async function spokenTextDigest(rendered: RenderedTransfer): Promise<Uint8Array> {
  return await sha256(concat([utf8(SPOKEN_TEXT_DIGEST_DOMAIN), utf8(rendered.spokenText)]));
}

function borshString(value: string): Uint8Array {
  const bytes = utf8(value);
  return concat([littleEndian(BigInt(bytes.length), 4), bytes]);
}

function littleEndian(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n || value < 0n) throw new RangeError('Value does not fit the Borsh integer.');
  return out;
}

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce(addLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function addLength(total: number, part: Uint8Array): number {
  return total + part.length;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
