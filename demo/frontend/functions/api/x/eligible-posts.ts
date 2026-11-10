// GET /api/x/eligible-posts  ->  { posts, fetchedAtMs, stale }  or  { error }
//
// A fresh list of X posts that can get a Community Note: the posts where people asked for a
// note. It comes from the X API's AI Note Writer endpoint
// (GET /2/notes/search/posts_eligible_for_notes), which needs the OAuth 1.0a keys of an enrolled
// AI Note Writer account. The demo writes its own notes on these posts and never sends a note
// to X, so the route always calls X in test mode.
//
// X bills each post and each author that it returns. The route therefore keeps one snapshot for
// every visitor and asks X again only when the snapshot is older than X_ELIGIBLE_TTL_SECONDS.
// If X fails, the route serves the old snapshot.
//
// The posts are about what people on X dispute, so most are about politics or war. A NEAR AI
// model sorts each new post by subject once (functions/lib/topicFilter.ts), and the route gives
// only the posts with an allowed subject. The snapshot collects them over time.

import { json, refuseOtherOrigin } from '../../lib/http.ts';
import { oauth1Header, queryString, type OAuth1Keys } from '../../lib/oauth1.ts';
import { classifyPosts, DEFAULT_ALLOWED_TOPICS, DEFAULT_TOPIC_MODEL, isTopic, type Topic } from '../../lib/topicFilter.ts';

export interface Env {
  /** OAuth 1.0a "Consumer Key" and secret of the AI Note Writer's X app. */
  X_API_KEY?: string;
  X_API_SECRET?: string;
  /** OAuth 1.0a "Access Token" and secret of the AI Note Writer account. */
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
  /** Optional. Posts for each call to X, 1 to 100. Default 20. */
  X_ELIGIBLE_MAX?: string;
  /** Optional. The age at which the route asks X again. Default 21600 (6 hours), minimum 60. */
  X_ELIGIBLE_TTL_SECONDS?: string;
  /** Optional. A language code such as "ja", or "all". X's default is English. */
  X_ELIGIBLE_LANG?: string;
  /**
   * Optional. The subjects to show, as a comma list (see TOPICS in functions/lib/topicFilter.ts).
   * Default: sport, science, technology, business, entertainment. "all" turns the filter off.
   */
  X_ELIGIBLE_TOPICS?: string;
  /** The key of the subject filter. Required unless X_ELIGIBLE_TOPICS is "all". */
  NEAR_AI_API_KEY?: string;
  /** Optional. A chat model that NEAR AI lists at /v1/models. */
  NEAR_AI_MODEL?: string;
  /** Optional. A KV namespace: one snapshot for all Cloudflare locations. */
  X_CACHE?: KVNamespace;
}

export interface XAuthor {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface XMedia {
  type: 'photo' | 'video' | 'animated_gif';
  /** A still image: the photo, or the preview of a video. */
  url: string;
  alt: string | null;
}

export interface XPost {
  id: string;
  text: string;
  createdAt: string | null;
  lang: string | null;
  url: string;
  author: XAuthor | null;
  media: XMedia[];
  metrics: { likes: number; reposts: number; replies: number; views: number } | null;
  /** The subject from the filter. Null when the filter is off. */
  topic: Topic | null;
}

/** What the route keeps between calls to X. */
export interface Snapshot {
  /** The time of the last good answer of X, and its posts. Null before the first good answer. */
  fetchedAtMs: number | null;
  posts: XPost[];
  /** The time of the last failed call to X, if it came after the last good answer. */
  failedAtMs: number | null;
  /** The subject of each post that the filter sorted, also of the posts that it left out. */
  topics: Record<string, Topic>;
}

export interface SnapshotStore {
  get(): Promise<Snapshot | null>;
  put(snapshot: Snapshot): Promise<void>;
}

export interface Settings {
  keys: OAuth1Keys;
  maxResults: number;
  ttlMs: number;
  lang: string | null;
  /** Null when the filter is off. */
  filter: { apiKey: string; model: string; allowed: ReadonlySet<Topic> } | null;
}

export interface Deps {
  fetch: typeof fetch;
  store: SnapshotStore;
  now: () => number;
  nonce: () => string;
}

const X_URL = 'https://api.x.com/2/notes/search/posts_eligible_for_notes';
const DEFAULT_MAX = 20;
// The demo needs some fresh posts each day, not a live feed. Four calls a day keep the X bill low.
const DEFAULT_TTL_SECONDS = 6 * 3_600;
const MIN_TTL_SECONDS = 60;
/** After a failed call, the route waits this long before it asks X again. */
export const RETRY_AFTER_FAILURE_MS = 60_000;
/** How long a snapshot stays in the store. An old snapshot is better than no posts. */
const KEEP_SECONDS = 7 * 24 * 3_600;
const TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 4_000;
const MAX_MEDIA = 4;
const STORE_KEY = 'x-eligible-posts-v2';
/** The most posts in the snapshot, and the most subjects that it remembers. */
export const MAX_KEPT_POSTS = 30;
const MAX_KEPT_TOPICS = 1_000;

export const NO_KEYS = 'The posts service has no X API keys.';
export const NO_FILTER_KEY = 'The posts service has no NEAR AI key for its subject filter.';
const X_FAILED = 'X did not give the posts. Try again in a minute.';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => {
  const store = env.X_CACHE ? kvStore(env.X_CACHE) : cacheApiStore(new URL(request.url).origin);
  return handleEligiblePosts(request, env, {
    fetch: (input, init) => fetch(input, init),
    store,
    now: () => Date.now(),
    nonce: () => crypto.randomUUID().replaceAll('-', ''),
  });
};

export const onRequestPost: PagesFunction<Env> = async () => json({ error: 'Use GET.' }, 405, { Allow: 'GET' });

export async function handleEligiblePosts(request: Request, env: Env, deps: Deps): Promise<Response> {
  const refusal = refuseOtherOrigin(request);
  if (refusal) return refusal;
  const settings = readSettings(env);
  if (settings === 'no-keys') return json({ error: NO_KEYS }, 503);
  if (settings === 'no-filter-key') return json({ error: NO_FILTER_KEY }, 503);

  const now = deps.now();
  const old = await deps.store.get().catch(() => null);
  const isFresh = old?.fetchedAtMs != null && now - old.fetchedAtMs < settings.ttlMs;
  const failedLately = old?.failedAtMs != null && now - old.failedAtMs < RETRY_AFTER_FAILURE_MS;
  if (old && (isFresh || failedLately)) return answer(old, !isFresh);

  const result = await refresh(settings, old, deps);
  if (result.ok) {
    const fresh: Snapshot = { fetchedAtMs: now, posts: result.posts, failedAtMs: null, topics: result.topics };
    await deps.store.put(fresh).catch(() => undefined);
    return answer(fresh, false);
  }
  console.error(`eligible-posts: ${result.error}`);
  const failed: Snapshot = { fetchedAtMs: old?.fetchedAtMs ?? null, posts: old?.posts ?? [], failedAtMs: now, topics: old?.topics ?? {} };
  await deps.store.put(failed).catch(() => undefined);
  return answer(failed, true);
}

type RefreshResult = { ok: true; posts: XPost[]; topics: Record<string, Topic> } | { ok: false; error: string };

/**
 * The new posts of X, sorted by subject, together with the kept posts of the old snapshot. If
 * the filter fails, the whole refresh fails: a post never shows without its subject.
 */
async function refresh(settings: Settings, old: Snapshot | null, deps: Deps): Promise<RefreshResult> {
  const fetched = await fetchEligiblePosts(settings, deps);
  if (!fetched.ok) return fetched;
  const topics: Record<string, Topic> = { ...old?.topics };
  let shown = fetched.posts;
  if (settings.filter) {
    const { allowed, apiKey, model } = settings.filter;
    const unsorted = fetched.posts.filter((post) => topics[post.id] === undefined);
    if (unsorted.length > 0) {
      const sorted = await classifyPosts(unsorted, { apiKey, model, fetch: deps.fetch });
      if (!sorted.ok) return sorted;
      Object.assign(topics, sorted.topics);
    }
    shown = fetched.posts.flatMap((post) => {
      const topic = topics[post.id];
      return topic !== undefined && allowed.has(topic) ? [{ ...post, topic }] : [];
    });
  }
  // The new posts first, then the old posts that X did not give again. With the filter on, an
  // old post stays only while its subject is allowed. With the filter off, no post has a subject.
  const ids = new Set(shown.map((post) => post.id));
  const kept = (old?.posts ?? []).filter((post) => {
    if (ids.has(post.id) || fetched.posts.some((other) => other.id === post.id)) return false;
    return settings.filter ? post.topic !== null && settings.filter.allowed.has(post.topic) : post.topic === null;
  });
  const posts = [...shown, ...kept]
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
    .slice(0, MAX_KEPT_POSTS);
  const entries = Object.entries(topics);
  return { ok: true, posts, topics: Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_KEPT_TOPICS))) };
}

function answer(snapshot: Snapshot, stale: boolean): Response {
  if (snapshot.fetchedAtMs == null) return json({ error: X_FAILED }, 502);
  // The browser may keep the list for a minute. The snapshot itself is on the server.
  return json({ posts: snapshot.posts, fetchedAtMs: snapshot.fetchedAtMs, stale }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/** The settings, or the name of what is missing. */
export function readSettings(env: Env): Settings | 'no-keys' | 'no-filter-key' {
  const consumerKey = env.X_API_KEY?.trim();
  const consumerSecret = env.X_API_SECRET?.trim();
  const token = env.X_ACCESS_TOKEN?.trim();
  const tokenSecret = env.X_ACCESS_TOKEN_SECRET?.trim();
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return 'no-keys';
  const allowed = readAllowedTopics(env.X_ELIGIBLE_TOPICS);
  const apiKey = env.NEAR_AI_API_KEY?.trim();
  if (allowed && !apiKey) return 'no-filter-key';
  const lang = env.X_ELIGIBLE_LANG?.trim().toLowerCase() ?? '';
  return {
    keys: { consumerKey, consumerSecret, token, tokenSecret },
    maxResults: clampInteger(env.X_ELIGIBLE_MAX, DEFAULT_MAX, 1, 100),
    ttlMs: clampInteger(env.X_ELIGIBLE_TTL_SECONDS, DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS, KEEP_SECONDS) * 1_000,
    lang: /^[a-z]{2,3}$/.test(lang) ? lang : null,
    filter: allowed && apiKey ? { apiKey, model: env.NEAR_AI_MODEL?.trim() || DEFAULT_TOPIC_MODEL, allowed } : null,
  };
}

/** The allowed subjects, or null for "all" (no filter). Unknown names are ignored. */
function readAllowedTopics(value: string | undefined): ReadonlySet<Topic> | null {
  const names = (value ?? '').split(',').map((name) => name.trim().toLowerCase()).filter((name) => name !== '');
  if (names.includes('all')) return null;
  const topics = names.filter(isTopic);
  return new Set(topics.length > 0 ? topics : DEFAULT_ALLOWED_TOPICS);
}

function clampInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const text = value?.trim() ?? '';
  if (!/^\d{1,9}$/.test(text)) return fallback;
  return Math.min(maximum, Math.max(minimum, Number(text)));
}

type FetchResult = { ok: true; posts: XPost[] } | { ok: false; error: string };

/**
 * One call to X. The X docs name the post fields `tweet.fields` in the Community Notes guide and
 * `post.fields` in the OpenAPI spec, so a 400 answer to the first name gets one try with the
 * other name.
 */
export async function fetchEligiblePosts(settings: Settings, deps: Pick<Deps, 'fetch' | 'now' | 'nonce'>): Promise<FetchResult> {
  let last: FetchResult = { ok: false, error: 'no call' };
  for (const noun of ['tweet', 'post'] as const) {
    const params: Record<string, string> = {
      test_mode: 'true',
      max_results: String(settings.maxResults),
      [`${noun}.fields`]: `author_id,created_at,lang,public_metrics,possibly_sensitive,attachments,note_${noun}`,
      expansions: 'author_id,attachments.media_keys',
      'user.fields': 'name,username,profile_image_url,verified',
      'media.fields': 'type,url,preview_image_url,alt_text',
    };
    if (settings.lang) params.post_selection = `feed_lang:${settings.lang}`;
    let response: Response;
    try {
      const authorization = await oauth1Header('GET', X_URL, params, settings.keys, deps.nonce(), Math.floor(deps.now() / 1_000));
      response = await deps.fetch(`${X_URL}?${queryString(params)}`, {
        headers: { Authorization: authorization, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, error: `the request failed: ${error instanceof Error ? error.message : 'unknown'}` };
    }
    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, error: 'the answer of X is not JSON' };
      }
      return { ok: true, posts: parseEligiblePosts(body) };
    }
    // The body can name the fault (no credits, not a note writer). It never holds our keys.
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    last = { ok: false, error: `X answered ${response.status}: ${detail}` };
    if (response.status !== 400) break;
  }
  return last;
}

// ---- The answer of X. It is input from another service, so each field is checked. ----

const POST_ID = /^\d{1,20}$/;
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const MEDIA_TYPES = new Set(['photo', 'video', 'animated_gif']);

/** The posts of an answer, without the posts that X marks as sensitive. A bad post is left out. */
export function parseEligiblePosts(body: unknown): XPost[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  const includes = isRecord(body.includes) ? body.includes : {};
  const authors = new Map<string, XAuthor>();
  for (const user of arrayOf(includes.users)) {
    const author = parseAuthor(user);
    if (author) authors.set(author.id, author);
  }
  const media = new Map<string, XMedia>();
  for (const item of arrayOf(includes.media)) {
    if (!isRecord(item) || typeof item.media_key !== 'string') continue;
    const parsed = parseMedia(item);
    if (parsed) media.set(item.media_key, parsed);
  }

  const posts: XPost[] = [];
  const seen = new Set<string>();
  for (const item of body.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !POST_ID.test(item.id) || seen.has(item.id)) continue;
    if (item.possibly_sensitive === true) continue;
    // A long post has its whole text in note_tweet (note_post in the newer field names).
    const long = [item.note_tweet, item.note_post].find((value) => isRecord(value) && typeof value.text === 'string');
    const text = unescapeText(isRecord(long) && typeof long.text === 'string' ? long.text : typeof item.text === 'string' ? item.text : '').trim();
    if (text === '') continue;
    const author = typeof item.author_id === 'string' ? (authors.get(item.author_id) ?? null) : null;
    const keys = isRecord(item.attachments) ? arrayOf(item.attachments.media_keys) : [];
    seen.add(item.id);
    posts.push({
      id: item.id,
      text: [...text].slice(0, MAX_TEXT_CHARS).join(''),
      createdAt: typeof item.created_at === 'string' && !Number.isNaN(Date.parse(item.created_at)) ? item.created_at : null,
      lang: typeof item.lang === 'string' && /^[a-z]{2,3}$/.test(item.lang) ? item.lang : null,
      url: `https://x.com/${author?.username ?? 'i'}/status/${item.id}`,
      author,
      media: keys.flatMap((key) => (typeof key === 'string' ? (media.get(key) ?? []) : [])).slice(0, MAX_MEDIA),
      metrics: parseMetrics(item.public_metrics),
      topic: null,
    });
  }
  return posts;
}

/** X escapes "&", "<" and ">" in a post's text. The page shows the text as text, so they go back. */
function unescapeText(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function parseAuthor(user: unknown): XAuthor | null {
  if (!isRecord(user) || typeof user.id !== 'string' || !POST_ID.test(user.id)) return null;
  if (typeof user.username !== 'string' || !USERNAME.test(user.username)) return null;
  const name = typeof user.name === 'string' ? user.name.trim() : '';
  return {
    id: user.id,
    username: user.username,
    name: [...(name || user.username)].slice(0, 60).join(''),
    avatarUrl: imageUrl(user.profile_image_url),
    verified: user.verified === true,
  };
}

function parseMedia(item: Record<string, unknown>): XMedia | null {
  if (typeof item.type !== 'string' || !MEDIA_TYPES.has(item.type)) return null;
  const url = imageUrl(item.type === 'photo' ? item.url : item.preview_image_url);
  if (!url) return null;
  const alt = typeof item.alt_text === 'string' && item.alt_text.trim() !== '' ? [...item.alt_text.trim()].slice(0, 420).join('') : null;
  return { type: item.type as XMedia['type'], url, alt };
}

function parseMetrics(value: unknown): XPost['metrics'] {
  if (!isRecord(value)) return null;
  const count = (field: unknown) => (typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : 0);
  return { likes: count(value.like_count), reposts: count(value.retweet_count), replies: count(value.reply_count), views: count(value.impression_count) };
}

/** An https image on X's image hosts (twimg.com), or null. */
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !(url.hostname === 'twimg.com' || url.hostname.endsWith('.twimg.com'))) return null;
  return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A stored value as a snapshot, or null when it does not have the shape. */
export function asSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value) || !Array.isArray(value.posts)) return null;
  const time = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) ? field : null);
  const topics = isRecord(value.topics) ? Object.fromEntries(Object.entries(value.topics).filter((entry): entry is [string, Topic] => isTopic(entry[1]))) : {};
  return { fetchedAtMs: time(value.fetchedAtMs), posts: value.posts as XPost[], failedAtMs: time(value.failedAtMs), topics };
}

// ---- The two stores ----

function kvStore(kv: KVNamespace): SnapshotStore {
  return {
    async get() {
      return asSnapshot(await kv.get(STORE_KEY, 'json'));
    },
    async put(snapshot) {
      await kv.put(STORE_KEY, JSON.stringify(snapshot), { expirationTtl: KEEP_SECONDS });
    },
  };
}

/** Cloudflare's Cache API. It needs no binding, but each Cloudflare location has its own copy. */
function cacheApiStore(origin: string): SnapshotStore {
  const key = `${origin}/__cache/${STORE_KEY}`;
  return {
    async get() {
      const hit = await caches.default.match(key);
      return hit ? asSnapshot(await hit.json()) : null;
    },
    async put(snapshot) {
      await caches.default.put(
        key,
        new Response(JSON.stringify(snapshot), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${KEEP_SECONDS}` },
        }),
      );
    },
  };
}
