// Unit tests of the faucet's limit for each network (functions/lib/networkLimit.ts), against a
// fake KV store. No network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNTS_PER_NETWORK, networkOf, takeAccount, type CountStore } from '../functions/lib/networkLimit.ts';

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

test('networkOf keeps an IPv4 address and takes the /64 of an IPv6 address', () => {
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
  assert.equal(networkOf('2001:db8:0a:0001:aaaa:bbbb:cccc:dddd'), '2001:db8:a:1::/64');
  assert.equal(networkOf('2001:DB8:a:1::1'), '2001:db8:a:1::/64');
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(networkOf('::1'), '0:0:0:0::/64');
  assert.equal(networkOf(null), 'unknown');
  assert.equal(networkOf(''), 'unknown');
});

test('one network gets the faucet for 3 accounts, then no more', async () => {
  assert.equal(ACCOUNTS_PER_NETWORK, 3);
  const store = fakeStore();
  for (let account = 0; account < 3; account += 1) {
    assert.ok(await takeAccount(store, '203.0.113.7'));
  }
  assert.equal(await takeAccount(store, '203.0.113.7'), null);
  // Another network has its own count.
  assert.ok(await takeAccount(store, '198.51.100.1'));
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
  assert.equal(store.data.get('faucet:203.0.113.7'), '0');
  assert.ok(await takeAccount(store, '203.0.113.7', 1));
});

test('a count that is not a number counts as 0', async () => {
  const store = fakeStore();
  store.data.set('faucet:203.0.113.7', 'garbage');
  assert.ok(await takeAccount(store, '203.0.113.7', 1));
  assert.equal(store.data.get('faucet:203.0.113.7'), '1');
});
