// The Wallet's ways to say that the owner closed or rejected a confirm step: an error text, for
// example "User rejected signing request" or "Request cancelled." (a `not_submitted` result has
// only the text), or a thrown error with a cancel code, for example `cancelled` or
// `wallet_operation_step_up_cancelled`. Nothing was sent, and the page does not show it as an
// error.

const USER_REJECTION =
  /\buser (rejected|cancell?ed|denied|declined)\b|\brejected by (the )?user\b|\bcancell?ed by (the )?user\b|^request (was )?cancell?ed\b/i;

/** The codes and names of the Wallet's (and the browser's) cancel errors. */
const CANCEL_CODES = new Set([
  'cancelled',
  'canceled',
  'user_cancelled',
  'user_canceled',
  'user_rejected',
  'request_rejected',
  'action_rejected',
  'wallet_operation_step_up_cancelled',
]);
/** A closed passkey prompt (WebAuthn) or an aborted request. */
const CANCEL_NAMES = new Set(['NotAllowedError', 'AbortError', 'WalletOperationStepUpCancelled']);

/** True when a Wallet error text says that the owner closed or rejected the confirm step. */
export function isUserRejection(error: string): boolean {
  return USER_REJECTION.test(error.trim());
}

/** True when a thrown error is the owner's own cancel: by its code, its name or its text. */
export function isCancelError(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return typeof cause === 'string' && isUserRejection(cause);
  const { code, name, message } = cause as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof code === 'string' && CANCEL_CODES.has(code.toLowerCase())) return true;
  if (typeof name === 'string' && CANCEL_NAMES.has(name)) return true;
  return typeof message === 'string' && isUserRejection(message);
}
