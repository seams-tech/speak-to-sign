// Unit tests of src/signer/rejection.ts: which Wallet error texts are the owner's own cancel.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCancelError, isUserRejection } from '../src/signer/rejection.ts';

test('a closed or rejected confirm step is a cancel', () => {
  assert.equal(isUserRejection('User rejected signing request'), true);
  assert.equal(isUserRejection('User cancelled secure confirm request'), true);
  assert.equal(isUserRejection('User canceled the request'), true);
  assert.equal(isUserRejection('Request rejected by user'), true);
  assert.equal(isUserRejection('user denied transaction signature'), true);
  assert.equal(isUserRejection('Request cancelled.'), true);
  assert.equal(isUserRejection('Request cancelled'), true);
});

test('a thrown cancel is known by its code, its name or its text', () => {
  const stepUp = Object.assign(new Error('Request cancelled.'), { name: 'WalletOperationStepUpCancelled', code: 'wallet_operation_step_up_cancelled' });
  assert.equal(isCancelError(stepUp), true);
  assert.equal(isCancelError(Object.assign(new Error('Request cancelled'), { code: 'cancelled' })), true);
  assert.equal(isCancelError(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })), true);
  assert.equal(isCancelError(new Error('User rejected signing request')), true);
  assert.equal(isCancelError('Request cancelled.'), true);
  assert.equal(isCancelError(new Error('The verifier did not answer.')), false);
  assert.equal(isCancelError(Object.assign(new Error('Wallet Session expired'), { code: 'session_expired' })), false);
  assert.equal(isCancelError(null), false);
});

test('other failures are not a cancel', () => {
  assert.equal(isUserRejection('Wallet Session expired while signing confirmation was open'), false);
  assert.equal(isUserRejection('InvalidNonce: the nonce is too small'), false);
  assert.equal(isUserRejection('NotEnoughBalance for the transaction'), false);
  assert.equal(isUserRejection(''), false);
});
