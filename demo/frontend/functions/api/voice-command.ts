// POST /api/voice-command  { transcript, posts }  ->  CommandScores  or  { error }
//
// Classifies what a visitor said to the notes app (src/voice/command.ts). JEV answers one
// probability for each question (functions/lib/jevCommand.ts). The answer only moves the page:
// it signs nothing, so the route needs no sign-in.
//
// JEV runs at Typesafe when TYPESAFE_API_KEY is set, and on NEAR AI Cloud otherwise.

import { MAX_SCREEN_POSTS, type CommandRequest } from '../../src/voice/command.ts';
import { json, refuseOtherOrigin } from '../lib/http.ts';
import { jevCommandRequest, NEAR_AI_JEV, readJevCommand, TYPESAFE_JEV } from '../lib/jevCommand.ts';

interface Env {
  TYPESAFE_API_KEY?: string;
  NEAR_AI_API_KEY?: string;
}

/** A command must feel instant. After this, the page uses its own word rules. */
const TIMEOUT_MS = 4_000;
const MAX_TEXT_CHARS = 400;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const refused = refuseOtherOrigin(request);
  if (refused) return refused;
  const route = env.TYPESAFE_API_KEY ? { ...TYPESAFE_JEV, key: env.TYPESAFE_API_KEY } : env.NEAR_AI_API_KEY ? { ...NEAR_AI_JEV, key: env.NEAR_AI_API_KEY } : null;
  if (!route) return json({ error: 'The command service has no JEV key.' }, 503);

  const command = readRequest(await request.json().catch(() => null));
  if (!command) return json({ error: 'Send JSON in the form { "transcript": "...", "posts": [{ "author", "text", "note"? }] }.' }, 400);

  let response: Response;
  try {
    response = await fetch(route.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(jevCommandRequest(command, route.model)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json({ error: 'JEV did not answer in time.' }, 504);
  }
  if (!response.ok) return json({ error: `JEV answered ${response.status}.` }, 502);
  const scores = readJevCommand(await response.json().catch(() => null), command);
  return scores ? json(scores, 200) : json({ error: 'JEV gave an answer that this route cannot read.' }, 502);
};

export const onRequestGet: PagesFunction<Env> = async () => json({ error: 'Use POST.' }, 405, { Allow: 'POST' });

function readRequest(body: unknown): CommandRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { transcript, posts } = body as { transcript?: unknown; posts?: unknown };
  if (!isText(transcript) || transcript.trim() === '' || !Array.isArray(posts) || posts.length > MAX_SCREEN_POSTS) return null;
  const read: CommandRequest['posts'] = [];
  for (const post of posts as { author?: unknown; text?: unknown; note?: unknown }[]) {
    if (typeof post !== 'object' || post === null || !isText(post.author) || !isText(post.text)) return null;
    if (post.note !== undefined && !isText(post.note)) return null;
    read.push({ author: post.author, text: post.text, ...(post.note === undefined ? {} : { note: post.note }) });
  }
  return { transcript: transcript.trim(), posts: read };
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_CHARS;
}
