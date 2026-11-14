// Unit tests of the faucet's limit for each network (functions/lib/networkLimit.ts), against a
// fake KV store. No network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNTS_PER_DAY, networkOf, takeAccount, type CountStore } from '../functions/lib/networkLimit.ts';

function fakeStore(): CountStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
  };
}

/** 2026-11-14 10:00 UTC. The tests pass a fixed time, so a run near midnight does not fail. */
const NOW = Date.UTC(2026, 10, 14, 10);
const KEY = 'faucet:203.0.113.7:2026-11-14';

test('networkOf keeps an IPv4 address and takes the /64 of an IPv6 address', () => {
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
  assert.equal(networkOf('2001:db8:0a:0001:aaaa:bbbb:cccc:dddd'), '2001:db8:a:1::/64');
  assert.equal(networkOf('2001:DB8:a:1::1'), '2001:db8:a:1::/64');
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(networkOf('::1'), '0:0:0:0::/64');
  assert.equal(networkOf(null), 'unknown');
  assert.equal(networkOf(''), 'unknown');
});

test('one network gets the faucet for 3 accounts in one day, then no more', async () => {
  assert.equal(ACCOUNTS_PER_DAY, 3);
  const store = fakeStore();
  for (let account = 0; account < 3; account += 1) {
    assert.ok(await takeAccount(store, '203.0.113.7', undefined, NOW));
  }
  assert.equal(await takeAccount(store, '203.0.113.7', undefined, NOW), null);
  // Another network has its own count.
  assert.ok(await takeAccount(store, '198.51.100.1', undefined, NOW));
});

test('the count starts again at 00:00 UTC', async () => {
  const store = fakeStore();
  const lastSecond = Date.UTC(2026, 10, 14, 23, 59, 59);
  assert.ok(await takeAccount(store, '203.0.113.7', 1, NOW));
  assert.equal(await takeAccount(store, '203.0.113.7', 1, lastSecond), null);
  assert.ok(await takeAccount(store, '203.0.113.7', 1, lastSecond + 1000));
  assert.equal(await takeAccount(store, '203.0.113.7', 1, lastSecond + 2000), null);
  assert.deepEqual([...store.data.keys()], [KEY, 'faucet:203.0.113.7:2026-11-15']);
});

test('each count has an expiry, so the store does not keep old days', async () => {
  const options: unknown[] = [];
  const store: CountStore = {
    get: async () => null,
    put: async (_key, _value, option) => {
      options.push(option);
    },
  };
  const giveBack = await takeAccount(store, '203.0.113.7', 1, NOW);
  await giveBack?.();
  assert.deepEqual(options, [{ expirationTtl: 172_800 }, { expirationTtl: 172_800 }]);
});

test('two addresses of one IPv6 /64 share one count', async () => {
  const store = fakeStore();
  assert.ok(await takeAccount(store, '2001:db8:a:1::1', 2, NOW));
  assert.ok(await takeAccount(store, '2001:db8:a:1::2', 2, NOW));
  assert.equal(await takeAccount(store, '2001:db8:a:1:ffff::3', 2, NOW), null);
  assert.ok(await takeAccount(store, '2001:db8:a:2::1', 2, NOW));
});

test('a drip that sent nothing gives its account back', async () => {
  const store = fakeStore();
  const first = await takeAccount(store, '203.0.113.7', 1, NOW);
  assert.ok(first);
  assert.equal(await takeAccount(store, '203.0.113.7', 1, NOW), null);
  await first();
  assert.equal(store.data.get(KEY), '0');
  assert.ok(await takeAccount(store, '203.0.113.7', 1, NOW));
});

test('a count that is not a number counts as 0', async () => {
  const store = fakeStore();
  store.data.set(KEY, 'garbage');
  assert.ok(await takeAccount(store, '203.0.113.7', 1, NOW));
  assert.equal(store.data.get(KEY), '1');
});
