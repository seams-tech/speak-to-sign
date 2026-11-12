// Unit tests of the reader that finds an account's bets and their transactions
// (src/market/betTransactions.ts) in an answer of FastNEAR's `POST /v0/transactions`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placedBetsOf } from '../src/market/betTransactions.ts';

const MARKET = 'pm-notes.seams-v1.testnet';
const TOKEN = 'usdc.testnet';
const ME = 'alice.testnet';

function bet(account: string, marketId: number, outcome: string, amount: string, standard = 'pm_notes'): string {
  const data = [{ market_id: marketId, account_id: account, outcome, amount, yes_pool: '1', no_pool: '1', yes_share_bps: 5000, bets: 1 }];
  return `EVENT_JSON:${JSON.stringify({ standard, version: '1.0.0', event: 'bet', data })}`;
}

/** A bet in USDC: the transaction goes to the token, and the market logs the event. */
function transaction(hash: string, logs: string[], logger = MARKET, blockNanos = '1794457498332661058') {
  return {
    transaction: { hash, receiver_id: TOKEN },
    execution_outcome: { block_timestamp: blockNanos },
    receipts: [
      { receipt: { receiver_id: TOKEN }, execution_outcome: { outcome: { logs: ['Transfer 100000 from alice.testnet'] } } },
      { receipt: { receiver_id: logger }, execution_outcome: { outcome: { logs } } },
    ],
  };
}

test('each bet event of the market that names the account gives a bet with its transaction', () => {
  const body = { transactions: [transaction('NEW', [bet(ME, 9, 'no', '200000')]), transaction('OLD', [bet(ME, 9, 'yes', '100000')])] };
  assert.deepEqual(placedBetsOf(body, MARKET, ME), [
    { hash: 'NEW', atMs: 1794457498332, marketId: 9, side: 'no', amount: 200000n },
    { hash: 'OLD', atMs: 1794457498332, marketId: 9, side: 'yes', amount: 100000n },
  ]);
});

test('bets of other accounts, other contracts and other standards do not count', () => {
  const body = {
    transactions: [
      transaction('THEIRS', [bet('bob.testnet', 9, 'yes', '100000')]),
      transaction('ELSEWHERE', [bet(ME, 9, 'yes', '100000')], 'other.testnet'),
      transaction('STANDARD', [bet(ME, 9, 'yes', '100000', 'community_notes')]),
      transaction('BAD', [bet(ME, 9, 'maybe', '100000'), bet(ME, 9, 'yes', '-5'), 'EVENT_JSON:{not json']),
    ],
  };
  assert.deepEqual(placedBetsOf(body, MARKET, ME), []);
  assert.deepEqual(placedBetsOf({ error: 'down' }, MARKET, ME), []);
  assert.deepEqual(placedBetsOf(null, MARKET, ME), []);
});
