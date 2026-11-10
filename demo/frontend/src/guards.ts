// Small type guards for JSON that comes over the network. The page and the Pages Functions
// share them. No imports, so Node's test runner can load this file.

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** A whole number in decimal text with no leading zero, for example yoctoNEAR. */
export function isDecimalText(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
}

/** An object with exactly these keys: no key missing and no other key. */
export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}
