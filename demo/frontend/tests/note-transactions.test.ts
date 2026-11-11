// Unit tests of the reader that finds the transaction of each note (src/notes/noteTransactions.ts)
// in an answer of FastNEAR's `POST /v0/transactions`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteTransactionsOf } from '../src/notes/noteTransactions.ts';

const CONTRACT = 'notes.seams-v1.testnet';

function added(...noteIds: number[]): string {
  const data = noteIds.map((noteId) => ({ note_id: noteId, post_id: 7, author: 'alice.testnet' }));
  return `EVENT_JSON:${JSON.stringify({ standard: 'community_notes', version: '1.1.0', event: 'note_added', data })}`;
}

function transaction(hash: string, logs: string[], receiver = CONTRACT) {
  return {
    transaction: { hash, receiver_id: receiver },
    receipts: [{ receipt: { receiver_id: receiver }, execution_outcome: { outcome: { logs } } }],
  };
}

test('each note gets the transaction whose note_added event names it', () => {
  const body = { transactions: [transaction('NEW', [added(2)]), transaction('OLD', ['a plain log', added(1)])] };
  assert.deepEqual(noteTransactionsOf(body, CONTRACT), { 2: 'NEW', 1: 'OLD' });
});

test('the newest transaction wins, and other contracts and events do not count', () => {
  const rated = `EVENT_JSON:${JSON.stringify({ standard: 'community_notes', version: '1.1.0', event: 'note_rated', data: [{ note_id: 3 }] })}`;
  const body = {
    transactions: [
      transaction('NEWER', [added(1)]),
      transaction('OLDER', [added(1)]),
      transaction('ELSEWHERE', [added(4)], 'other.testnet'),
      transaction('RATING', [rated]),
      transaction('BROKEN', ['EVENT_JSON:{not json']),
    ],
  };
  assert.deepEqual(noteTransactionsOf(body, CONTRACT), { 1: 'NEWER' });
  assert.deepEqual(noteTransactionsOf({ error: 'down' }, CONTRACT), {});
  assert.deepEqual(noteTransactionsOf(null, CONTRACT), {});
});
