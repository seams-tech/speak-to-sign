// Unit tests of the X post adapter (src/x/xPosts.ts): the post id for the notes contract and
// the post shape of the notes app.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_FETCHED_AT_MS, FIXTURE_POSTS } from '../src/x/fixture.ts';
import { ageText, compactCount, notePostId, readXPosts, toPost } from '../src/x/xPosts.ts';

test('notePostId fits the Wallet limit and keeps posts apart', () => {
  assert.equal(notePostId('2120014542000570602'), Number(2120014542000570602n >> 10n));
  // The largest id that X can make (2^63 - 1) still fits below 2^53.
  assert.ok(Number.isSafeInteger(notePostId('9223372036854775807')));
  const ids = FIXTURE_POSTS.map((post) => notePostId(post.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => Number.isSafeInteger(id) && id > 1_000));
  // Two posts of the same X server, one millisecond apart, get two numbers.
  assert.notEqual(notePostId(String(1n << 22n)), notePostId(String(2n << 22n)));
});

test('ageText and compactCount follow the look of X', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.deepEqual(
    ['2026-11-10T11:59:50Z', '2026-11-10T11:15:00Z', '2026-11-10T02:00:00Z', '2026-11-07T12:00:00Z'].map((at) => ageText(at, now)),
    ['1m', '45m', '10h', '3d'],
  );
  assert.equal(ageText(null, now), '');
  assert.deepEqual([72, 2_593, 82_896, 119_613, 3_175_707, 2_000_000].map(compactCount), ['72', '2.6K', '83K', '120K', '3.2M', '2M']);
});

test('toPost gives a post of the notes app', () => {
  const post = toPost(FIXTURE_POSTS[1]!, FIXTURE_FETCHED_AT_MS);
  assert.equal(post.id, notePostId('2119918368736088126'));
  assert.deepEqual([post.author.name, post.author.handle, post.author.initials, post.author.kind], ['TVP', 'Theveripost', 'T', 'person']);
  assert.ok(post.author.avatarUrl?.startsWith('https://pbs.twimg.com/'));
  assert.equal(post.linkify, true);
  assert.equal(post.age, '8h');
  assert.equal(post.topic, 'science');
  assert.ok(post.image?.url.startsWith('https://pbs.twimg.com/media/'));
  assert.deepEqual(post.stats, { replies: '30', reposts: '454', likes: '3.1K', bookmarks: '', views: '444K' });
  assert.equal(post.history.source.url, 'https://x.com/Theveripost/status/2119918368736088126');
  assert.equal(post.context, undefined);

  const bare = toPost({ id: '5000000', text: 'Text', createdAt: null, lang: null, url: 'https://x.com/i/status/5000000', author: null, media: [], metrics: null, topic: null }, 0);
  assert.deepEqual([bare.author.name, bare.author.handle, bare.age, bare.postedAt, bare.stats, bare.image, bare.topic], ['X user', 'unknown', '', 'On X', undefined, undefined, undefined]);
});

test('readXPosts checks the body of the route', () => {
  assert.equal(readXPosts(null, 0), null);
  assert.equal(readXPosts({ error: 'no keys' }, 0), null);
  const posts = readXPosts({ posts: [...FIXTURE_POSTS, FIXTURE_POSTS[0], { id: 'x', text: 't', media: [] }, { id: '7', media: [] }, null] }, FIXTURE_FETCHED_AT_MS);
  assert.equal(posts?.length, FIXTURE_POSTS.length);
});
