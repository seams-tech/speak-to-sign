// GET /api/x/eligible-posts[?offset=<n>&limit=<n>]
//   ->  { posts, fetchedAtMs, stale, total, nextOffset }  or  { error }
//
// A fresh list of X posts that can get a Community Note: the posts where people asked for a
// note. It comes from the X API's AI Note Writer endpoint
// (GET /2/notes/search/posts_eligible_for_notes), which needs the OAuth 1.0a keys of an enrolled
// AI Note Writer account. The demo writes its own notes on these posts and never sends a note
// to X, so the route always calls X in test mode.
//
// X bills each post and each author that it returns. The route therefore keeps one snapshot for
// every visitor and asks X again only when the snapshot is older than X_ELIGIBLE_TTL_SECONDS
// (4 hours). If X fails, the route serves the old snapshot. One call gives the newest posts of
// X's list (X_ELIGIBLE_MAX, 100 at most). X_ELIGIBLE_CALLS sets more calls for one refresh: each
// more call takes the next page of the list, which has older posts.
//
// The snapshot keeps the posts (up to MAX_KEPT_POSTS, newest first), so it grows by the new posts
// of each call: with 10 posts a call and a call every 4 hours, about 120 posts after two days.
// A visitor's request makes the call when the snapshot is old; a scheduled Worker
// (demo/x-refresh-worker) asks every 4 hours, so the posts come also when no one visits. The
// timeline reads the posts in pages: `limit` posts (1 to 50) from `offset` (0 is the newest).
// Without `limit`, the answer has all the posts.
//
// The posts are about what people on X dispute, so most are about politics or war. JEV sorts each
// new post by subject once (functions/lib/topicFilter.ts), and the route gives only the posts
// with an allowed subject, also from a snapshot that an earlier list of subjects made. The
// snapshot collects them over time. A NEAR AI chat model writes the
// draft of a note for each post (functions/lib/noteDrafts.ts), for the write dialog. Each draft
// has a mark: `source` is "model", or "template" when the model gave no note. The route asks
// the model again for a template on a later refresh, with limits (see draftPosts).

import { json, refuseOtherOrigin } from '../../lib/http.ts';
import { oauth1Header, queryString, type OAuth1Keys } from '../../lib/oauth1.ts';
import type { XAuthor, XMedia, XPost } from '../../../src/x/types.ts';
import { fallbackDraft, isTemplateText, validDraft, type PostDraft } from '../../../src/x/noteDrafts.ts';
import { DEFAULT_DRAFT_MODEL, DRAFT_BATCH, draftNotes } from '../../lib/noteDrafts.ts';
import { jevRoute, type KeyedJevRoute } from '../../lib/jev.ts';
import { classifyPosts, DEFAULT_ALLOWED_TOPICS, isTopic, type Topic } from '../../lib/topicFilter.ts';

export interface Env {
  /** OAuth 1.0a "Consumer Key" and secret of the AI Note Writer's X app. */
  X_API_KEY?: string;
  X_API_SECRET?: string;
  /** OAuth 1.0a "Access Token" and secret of the AI Note Writer account. */
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
  /** Optional. Posts for each call to X, 1 to 100. Default 10. */
  X_ELIGIBLE_MAX?: string;
  /**
   * Optional. Calls to X for one refresh, 1 to 10. Default 1. Each call after the first takes the
   * next page of X's list: older posts.
   */
  X_ELIGIBLE_CALLS?: string;
  /** Optional. The most posts that the snapshot keeps, 10 to 2000. Default 600. */
  X_ELIGIBLE_KEEP?: string;
  /** Optional. The age at which the route asks X again. Default 14400 (4 hours), minimum 60. */
  X_ELIGIBLE_TTL_SECONDS?: string;
  /** Optional. A language code such as "ja", or "all". X's default is English. */
  X_ELIGIBLE_LANG?: string;
  /**
   * Optional. The subjects to show, as a comma list (see TOPICS in functions/lib/topicFilter.ts).
   * Default: science, technology, business, politics. "all" turns the filter off.
   */
  X_ELIGIBLE_TOPICS?: string;
  /**
   * The key of the subject filter (JEV at Typesafe), and NEAR_AI_API_KEY without it (JEV on NEAR
   * AI). One of them is required unless X_ELIGIBLE_TOPICS is "all".
   */
  TYPESAFE_API_KEY?: string;
  /** The key of the drafts of notes, and of the subject filter without TYPESAFE_API_KEY. */
  NEAR_AI_API_KEY?: string;
  /** Optional. The chat model of the drafts, one that NEAR AI lists at /v1/models. */
  NEAR_AI_MODEL?: string;
  /** Optional. A KV namespace: one snapshot for all Cloudflare locations. */
  X_CACHE?: KVNamespace;
}

export type { XAuthor, XMedia, XPost };

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
  /** The most calls to X for one refresh: the pages of X's list that it reads. */
  maxCalls: number;
  /** The most posts that the snapshot keeps. */
  maxKept: number;
  ttlMs: number;
  lang: string | null;
  /** Null when the filter is off. */
  filter: { route: KeyedJevRoute; allowed: ReadonlySet<Topic> } | null;
  /** The model that writes the drafts of notes; null without the NEAR AI key. */
  drafter: { apiKey: string; model: string } | null;
}

export interface Deps {
  fetch: typeof fetch;
  store: SnapshotStore;
  now: () => number;
  nonce: () => string;
}

const X_URL = 'https://api.x.com/2/notes/search/posts_eligible_for_notes';
const DEFAULT_MAX = 10;
/** The most calls to X for one refresh (X_ELIGIBLE_CALLS): 1,000 posts at most, $15. */
export const MAX_CALLS = 10;
// The demo needs some fresh posts each day, not a live feed. Three calls a day of 10 posts cost
// $0.45 a day at most, which keeps a week below the budget of $5 to $10.
const DEFAULT_TTL_SECONDS = 4 * 3_600;
const MIN_TTL_SECONDS = 60;
/** After a failed call, the route waits this long before it asks X again. */
export const RETRY_AFTER_FAILURE_MS = 60_000;
/** How long a snapshot stays in the store. An old snapshot is better than no posts. */
const KEEP_SECONDS = 7 * 24 * 3_600;
const TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 4_000;
const MAX_MEDIA = 4;
const MAX_TOKEN_CHARS = 1_000;
const STORE_KEY = 'x-eligible-posts-v2';
/**
 * The most posts in the snapshot (X_ELIGIBLE_KEEP changes it), and the most subjects that it
 * remembers. 600 posts is 20 days of 30 posts a day, about 1 MB in the store.
 */
export const MAX_KEPT_POSTS = 600;
const MAX_KEEP_SETTING = 2_000;
/**
 * The schedule asks once every TTL, and its request can come a little early. So a snapshot is
 * old enough for a new call this much before the TTL: 10 minutes, or a tenth of a short TTL.
 */
export function refreshAgeMs(ttlMs: number): number {
  return ttlMs - Math.min(10 * 60_000, ttlMs / 10);
}
/** The most posts in one page of the answer. */
export const MAX_PAGE = 50;
/** The NEAR AI answers with no valid note for a post, after which its template is final. */
export const MAX_MODEL_TRIES = 3;
/** The most posts that one refresh sends to the draft model: 3 calls of DRAFT_BATCH posts. */
export const MAX_DRAFTS_PER_REFRESH = 3 * DRAFT_BATCH;
const MAX_KEPT_TOPICS = 1_000;

export const NO_KEYS = 'The posts service has no X API keys.';
export const NO_FILTER_KEY = 'The posts service has no JEV key (TYPESAFE_API_KEY or NEAR_AI_API_KEY) for its subject filter.';
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

  const page = readPage(new URL(request.url).searchParams);
  const now = deps.now();
  const old = withAllowedPosts(await deps.store.get().catch(() => null), settings);
  const isFresh = old?.fetchedAtMs != null && now - old.fetchedAtMs < refreshAgeMs(settings.ttlMs);
  const failedLately = old?.failedAtMs != null && now - old.failedAtMs < RETRY_AFTER_FAILURE_MS;
  if (old && (isFresh || failedLately)) return answer(old, !isFresh, page);

  const result = await refresh(settings, old, deps);
  if (result.ok) {
    const fresh: Snapshot = { fetchedAtMs: now, posts: result.posts, failedAtMs: null, topics: result.topics };
    await deps.store.put(fresh).catch(() => undefined);
    return answer(fresh, false, page);
  }
  console.error(`eligible-posts: ${result.error}`);
  const failed: Snapshot = { fetchedAtMs: old?.fetchedAtMs ?? null, posts: old?.posts ?? [], failedAtMs: now, topics: old?.topics ?? {} };
  await deps.store.put(failed).catch(() => undefined);
  return answer(failed, true, page);
}

/** A page of the posts: `limit` posts from `offset`. No `limit`: all the posts. */
export interface Page {
  offset: number;
  limit: number | null;
}

/** The page of the query. A value that is not a whole number gives the default. */
export function readPage(params: URLSearchParams): Page {
  const offset = clampInteger(params.get('offset') ?? undefined, 0, 0, MAX_KEEP_SETTING);
  const limitText = params.get('limit');
  return { offset, limit: limitText === null ? null : clampInteger(limitText, 10, 1, MAX_PAGE) };
}

/**
 * The snapshot with only the posts that the settings allow, so a change of the allowed subjects
 * shows at once and not only after the next call to X. With the filter on, a post stays while its
 * subject is allowed. With the filter off, no post has a subject.
 */
function withAllowedPosts(snapshot: Snapshot | null, settings: Settings): Snapshot | null {
  if (!snapshot) return null;
  const { filter } = settings;
  const posts = snapshot.posts.filter((post) => (filter ? post.topic !== null && filter.allowed.has(post.topic) : post.topic === null));
  return posts.length === snapshot.posts.length ? snapshot : { ...snapshot, posts };
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
    const { allowed, route } = settings.filter;
    const unsorted = fetched.posts.filter((post) => topics[post.id] === undefined);
    if (unsorted.length > 0) {
      const sorted = await classifyPosts(unsorted, { route, fetch: deps.fetch });
      if (!sorted.ok) return sorted;
      Object.assign(topics, sorted.topics);
    }
    shown = fetched.posts.flatMap((post) => {
      const topic = topics[post.id];
      return topic !== undefined && allowed.has(topic) ? [{ ...post, topic }] : [];
    });
  }
  // The new posts first, then the old posts that X did not give again (withAllowedPosts left
  // only the allowed posts in `old`).
  const fetchedIds = new Set(fetched.posts.map((post) => post.id));
  const kept = (old?.posts ?? []).filter((post) => !fetchedIds.has(post.id));
  const posts = [...shown, ...kept]
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
    .slice(0, settings.maxKept);
  await draftPosts(posts, old, settings, deps);
  const entries = Object.entries(topics);
  return { ok: true, posts, topics: Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_KEPT_TOPICS))) };
}

/**
 * Gives each post a draft of a note. A model draft is final. A template is not: on each refresh
 * the model gets the newest posts that have a template (MAX_DRAFTS_PER_REFRESH at most), until
 * it writes a note for the post or has answered MAX_MODEL_TRIES times with no valid note for it.
 * Only an answer counts as a try: a failed call (no key, no credit, a timeout) does not, so an
 * outage of NEAR AI does not make a template final. A failed call gets one more try at once
 * (draftNotes). The limit per refresh keeps the NEAR AI cost of a refresh at
 * MAX_DRAFTS_PER_REFRESH / DRAFT_BATCH answered calls, and the time budget of draftNotes keeps
 * the wait short.
 */
async function draftPosts(posts: XPost[], old: Snapshot | null, settings: Settings, deps: Deps): Promise<void> {
  const oldDrafts = new Map((old?.posts ?? []).map((post) => [post.id, post.draft]));
  for (const post of posts) post.draft = storedDraft(post.draft ?? oldDrafts.get(post.id));
  const asked = settings.drafter
    ? posts.filter((post) => post.draft?.source !== 'model' && (post.draft?.modelTries ?? 0) < MAX_MODEL_TRIES).slice(0, MAX_DRAFTS_PER_REFRESH)
    : [];
  if (settings.drafter && asked.length > 0) {
    const result = await draftNotes(asked, { ...settings.drafter, today: new Date(deps.now()).toISOString().slice(0, 10), fetch: deps.fetch, now: deps.now });
    for (const problem of result.problems) console.warn(`eligible-posts: note drafts: ${problem}`);
    for (const post of asked) {
      const draft = result.drafts[post.id];
      const tries = post.draft?.modelTries ?? 0;
      post.draft = draft
        ? { ...draft, source: 'model' }
        : templateDraft(post.topic, result.answered.has(post.id) ? tries + 1 : tries);
    }
  }
  for (const post of posts) post.draft ??= templateDraft(post.topic, 0);
}

function templateDraft(topic: Topic | null, modelTries: number): PostDraft {
  return { ...fallbackDraft(topic), source: 'template', modelTries };
}

/**
 * A stored draft with its mark, or null. A draft of an older route has no mark (and can have a
 * spoken summary, which is left out): a template's text marks a template, any other text is the
 * model's.
 */
export function storedDraft(value: unknown): PostDraft | null {
  const draft = validDraft(value);
  if (!draft) return null;
  const { source, modelTries } = value as { source?: unknown; modelTries?: unknown };
  if (source === 'model' || (source === undefined && !isTemplateText(draft.text))) return { text: draft.text, source: 'model' };
  if (source !== 'template' && source !== undefined) return null;
  const tries = typeof modelTries === 'number' && Number.isSafeInteger(modelTries) && modelTries >= 0 ? Math.min(modelTries, MAX_MODEL_TRIES) : 0;
  return { text: draft.text, source: 'template', modelTries: tries };
}

function answer(snapshot: Snapshot, stale: boolean, page: Page): Response {
  if (snapshot.fetchedAtMs == null) return json({ error: X_FAILED }, 502);
  const total = snapshot.posts.length;
  const end = page.limit === null ? total : Math.min(total, page.offset + page.limit);
  const posts = snapshot.posts.slice(page.offset, end);
  // The browser may keep a page for a minute. The snapshot itself is on the server.
  return json({ posts, fetchedAtMs: snapshot.fetchedAtMs, stale, total, nextOffset: end < total ? end : null }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
}

/** The settings, or the name of what is missing. */
export function readSettings(env: Env): Settings | 'no-keys' | 'no-filter-key' {
  const consumerKey = env.X_API_KEY?.trim();
  const consumerSecret = env.X_API_SECRET?.trim();
  const token = env.X_ACCESS_TOKEN?.trim();
  const tokenSecret = env.X_ACCESS_TOKEN_SECRET?.trim();
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return 'no-keys';
  const allowed = readAllowedTopics(env.X_ELIGIBLE_TOPICS);
  const route = jevRoute(env);
  if (allowed && !route) return 'no-filter-key';
  const apiKey = env.NEAR_AI_API_KEY?.trim();
  const lang = env.X_ELIGIBLE_LANG?.trim().toLowerCase() ?? '';
  return {
    keys: { consumerKey, consumerSecret, token, tokenSecret },
    maxResults: clampInteger(env.X_ELIGIBLE_MAX, DEFAULT_MAX, 1, 100),
    maxCalls: clampInteger(env.X_ELIGIBLE_CALLS, 1, 1, MAX_CALLS),
    maxKept: clampInteger(env.X_ELIGIBLE_KEEP, MAX_KEPT_POSTS, 10, MAX_KEEP_SETTING),
    ttlMs: clampInteger(env.X_ELIGIBLE_TTL_SECONDS, DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS, KEEP_SECONDS) * 1_000,
    lang: /^[a-z]{2,3}$/.test(lang) ? lang : null,
    filter: allowed && route ? { route, allowed } : null,
    drafter: apiKey ? { apiKey, model: env.NEAR_AI_MODEL?.trim() || DEFAULT_DRAFT_MODEL } : null,
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
type PageResult = { ok: true; posts: XPost[]; nextToken: string | null } | { ok: false; error: string; status: number | null };

/**
 * The X docs name the post fields `tweet.fields` in the Community Notes guide and `post.fields`
 * in the OpenAPI spec.
 */
const FIELD_NOUNS = ['tweet', 'post'] as const;
type FieldNoun = (typeof FIELD_NOUNS)[number];

/**
 * The posts of one refresh: the first page of X's list, then its next pages (older posts) up to
 * `maxCalls` calls. A 400 answer to the first field name gets one try with the other name. If
 * the first page fails, the refresh fails. If a later page fails, the posts of the pages before
 * it stay: X billed them already.
 */
export async function fetchEligiblePosts(settings: Settings, deps: Pick<Deps, 'fetch' | 'now' | 'nonce'>): Promise<FetchResult> {
  let noun: FieldNoun = FIELD_NOUNS[0];
  let page: PageResult = { ok: false, error: 'no call', status: null };
  for (noun of FIELD_NOUNS) {
    page = await fetchPage(settings, deps, noun, null);
    if (page.ok || page.status !== 400) break;
  }
  if (!page.ok) return { ok: false, error: page.error };

  const posts = new Map(page.posts.map((post) => [post.id, post]));
  for (let call = 2; call <= settings.maxCalls && page.nextToken !== null; call += 1) {
    const next: PageResult = await fetchPage(settings, deps, noun, page.nextToken);
    if (!next.ok) {
      console.warn(`eligible-posts: call ${call} to X: ${next.error}`);
      break;
    }
    for (const post of next.posts) if (!posts.has(post.id)) posts.set(post.id, post);
    page = next;
  }
  return { ok: true, posts: [...posts.values()] };
}

/** One call to X: the first page of its list, or the page of a `next_token`. */
async function fetchPage(settings: Settings, deps: Pick<Deps, 'fetch' | 'now' | 'nonce'>, noun: FieldNoun, paginationToken: string | null): Promise<PageResult> {
  const params: Record<string, string> = {
    test_mode: 'true',
    max_results: String(settings.maxResults),
    [`${noun}.fields`]: `author_id,created_at,lang,public_metrics,possibly_sensitive,attachments,note_${noun}`,
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'name,username,profile_image_url,verified',
    'media.fields': 'type,url,preview_image_url,alt_text',
  };
  if (settings.lang) params.post_selection = `feed_lang:${settings.lang}`;
  if (paginationToken !== null) params.pagination_token = paginationToken;
  let response: Response;
  try {
    const authorization = await oauth1Header('GET', X_URL, params, settings.keys, deps.nonce(), Math.floor(deps.now() / 1_000));
    response = await deps.fetch(`${X_URL}?${queryString(params)}`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: `the request failed: ${error instanceof Error ? error.message : 'unknown'}`, status: null };
  }
  if (!response.ok) {
    // The body can name the fault (no credits, not a note writer). It never holds our keys.
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    return { ok: false, error: `X answered ${response.status}: ${detail}`, status: response.status };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'the answer of X is not JSON', status: response.status };
  }
  return { ok: true, posts: parseEligiblePosts(body), nextToken: nextTokenOf(body) };
}

/** The token of the next page of X's list, or null at its end. */
function nextTokenOf(body: unknown): string | null {
  const token = isRecord(body) && isRecord(body.meta) ? body.meta.next_token : null;
  return typeof token === 'string' && token !== '' && token.length <= MAX_TOKEN_CHARS ? token : null;
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
