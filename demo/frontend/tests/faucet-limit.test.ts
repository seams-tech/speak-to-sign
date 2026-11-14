// Unit tests of the faucet's limit for each network (functions/lib/networkLimit.ts), against a
// fake KV store. No network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNTS_PER_DAY, dayOf, networkOf, takeAccount, type CountStore } from '../functions/lib/networkLimit.ts';

/** 2026-11-15 12:00 UTC. */
const NOON = Date.UTC(2026, 10, 15, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

function fakeStore(): CountStore & { data: Map<string, string>; ttls: Map<string, number | undefined> } {
  const data = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  return {
    data,
    ttls,
    get: async (key) => data.get(key) ?? null,
    put: async (key, value, options) => {
      data.set(key, value);
      ttls.set(key, options?.expirationTtl);
    },
  };
}

test('networkOf keeps an IPv4 address and takes the /64 of an IPv6 address', () => {
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
  assert.equal(networkOf('2001:db8:0a:0001:aaaa:bbbb:cccc:dddd'), '2001:db8:a:1::/64');
  assert.equal(networkOf('2001:DB8:a:1::1'), '2001:db8:a:1::/64');
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(networkOf('::1'), '0:0:0:0::/64');
  assert.equal(networkOf(null), 'unknown');
  assert.equal(networkOf(''), 'unknown');
});

test('one network gets the faucet for 10 accounts in one day, then no more', async () => {
  assert.equal(ACCOUNTS_PER_DAY, 10);
  const store = fakeStore();
  for (let account = 0; account < 10; account += 1) {
    assert.ok(await takeAccount(store, '203.0.113.7', undefined, NOON));
  }
  assert.equal(await takeAccount(store, '203.0.113.7', undefined, NOON), null);
  // Another network has its own count.
  assert.ok(await takeAccount(store, '198.51.100.1', undefined, NOON));
});

test('a new day (UTC) starts a new count, and KV removes the old one', async () => {
  assert.equal(dayOf(NOON), '2026-11-15');
  assert.equal(dayOf(Date.UTC(2026, 10, 15, 23, 59, 59)), '2026-11-15');
  assert.equal(dayOf(Date.UTC(2026, 10, 16)), '2026-11-16');
  const store = fakeStore();
  assert.ok(await takeAccount(store, '203.0.113.7', 1, NOON));
  assert.equal(await takeAccount(store, '203.0.113.7', 1, NOON + 60_000), null);
  assert.ok(await takeAccount(store, '203.0.113.7', 1, NOON + DAY_MS));
  assert.deepEqual([...store.data.keys()], ['faucet:203.0.113.7:2026-11-15', 'faucet:203.0.113.7:2026-11-16']);
  // Each count has an expiry of two days.
  assert.deepEqual([...store.ttls.values()], [172_800, 172_800]);
});

test('two addresses of one IPv6 /64 share one count', async () => {
  const store = fakeStore();
  assert.ok(await takeAccount(store, '2001:db8:a:1::1', 2));
  assert.ok(await takeAccount(store, '2001:db8:a:1::2', 2));
  assert.equal(await takeAccount(store, '2001:db8:a:1:ffff::3', 2), null);
  assert.ok(await takeAccount(store, '2001:db8:a:2::1', 2));
});

test('a drip that sent nothing gives its account back', async () => {
  const store = fakeStore();
  const first = await takeAccount(store, '203.0.113.7', 1);
  assert.ok(first);
  assert.equal(await takeAccount(store, '203.0.113.7', 1), null);
  await first();
  assert.equal(store.data.get(`faucet:203.0.113.7:${dayOf(Date.now())}`), '0');
  assert.ok(await takeAccount(store, '203.0.113.7', 1));
});

test('a count that is not a number counts as 0', async () => {
  const store = fakeStore();
  const key = `faucet:203.0.113.7:${dayOf(NOON)}`;
  store.data.set(key, 'garbage');
  assert.ok(await takeAccount(store, '203.0.113.7', 1, NOON));
  assert.equal(store.data.get(key), '1');
});
