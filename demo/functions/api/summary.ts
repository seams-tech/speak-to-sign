// POST /api/summary  { text }  ->  { summary }  or  { error }
//
// Asks NEAR AI for one plain sentence of 12 words or fewer that the author
// reads aloud. Checks the reply with the same rules as the page, and asks
// once more if the first reply breaks a rule.

import { checkSummary, SUMMARY_MAX_WORDS } from '../../src/summaryRules';

interface Env {
  NEAR_AI_API_KEY?: string;
  /** Optional. A chat model that NEAR AI lists at /v1/models. */
  NEAR_AI_MODEL?: string;
}

const NEAR_AI_URL = 'https://cloud-api.near.ai/v1/chat/completions';
// A small instruct model that NEAR AI hosts itself (private inference).
const DEFAULT_MODEL = 'Qwen/Qwen3.8-27B';
const MAX_NOTE_CHARS = 280;
const TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
  'You write one short plain sentence that a person will read aloud to sign a Community Note.',
  'The sentence summarizes the note.',
  'Rules:',
  `- 1 to ${SUMMARY_MAX_WORDS} words.`,
  '- Only the letters A to Z and spaces. No accents.',
  '- No digits. Write numbers as words.',
  '- No apostrophes: write "do not", not "don\'t".',
  '- No links, web addresses, handles, hashtags or hyphens.',
  '- No commas, quotes or other punctuation.',
  '- Do not start with the word "send".',
  'Reply with the sentence only.',
].join('\n');

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string } | string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'This route takes requests from this site only.' }, 403);
  }
  if (!env.NEAR_AI_API_KEY) {
    return json({ error: 'The summary service has no NEAR AI key. Write the summary yourself.' }, 503);
  }

  let text = '';
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return json({ error: 'Send JSON in the form { "text": "..." }.' }, 400);
  }
  if (text === '') {
    return json({ error: 'The note text is empty.' }, 400);
  }
  if ([...text].length > MAX_NOTE_CHARS) {
    return json({ error: `The note text is longer than ${MAX_NOTE_CHARS} characters.` }, 400);
  }

  const model = env.NEAR_AI_MODEL?.trim() || DEFAULT_MODEL;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Summarize this Community Note in ${SUMMARY_MAX_WORDS} words or fewer.\n\nNote:\n"""\n${text}\n"""` },
  ];

  let lastReply = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const reply = await askNearAi(env.NEAR_AI_API_KEY, model, messages);
    if (!reply.ok) {
      return json({ error: reply.error }, 502);
    }
    lastReply = cleanReply(reply.content);
    const check = checkSummary(lastReply);
    if (check.ok) {
      return json({ summary: check.spoken, model });
    }
    const broken = check.rules.filter((rule) => !rule.ok).map((rule) => rule.label);
    messages.push(
      { role: 'assistant', content: reply.content },
      { role: 'user', content: `That sentence breaks these rules: ${broken.join('; ')}. Write it again and follow every rule.` },
    );
  }
  return json({ error: 'NEAR AI did not give a summary that follows the rules. Write the summary yourself.', lastReply }, 422);
};

export const onRequestGet: PagesFunction<Env> = async () =>
  json({ error: 'Use POST with { "text": "..." }.' }, 405, { Allow: 'POST' });

async function askNearAi(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(NEAR_AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 200,
        // Qwen 3 models think first unless this is off. Other models ignore it.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: 'NEAR AI did not answer in time. Try again, or write the summary yourself.' };
  }
  const body = (await response.json().catch(() => null)) as ChatResponse | null;
  if (!response.ok) {
    const detail = typeof body?.error === 'string' ? body.error : body?.error?.message;
    return { ok: false, error: `NEAR AI answered ${response.status}${detail ? `: ${detail}` : ''}.` };
  }
  const content = body?.choices?.[0]?.message?.content ?? '';
  if (content.trim() === '') {
    return { ok: false, error: 'NEAR AI gave an empty answer. Try again, or write the summary yourself.' };
  }
  return { ok: true, content };
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan['’]t\b/gi, 'cannot'],
  [/\bwon['’]t\b/gi, 'will not'],
  [/n['’]t\b/gi, ' not'],
  [/['’]re\b/gi, ' are'],
  [/['’]ll\b/gi, ' will'],
  [/['’]ve\b/gi, ' have'],
  [/\bi['’]m\b/gi, 'I am'],
  [/\bit['’]s\b/gi, 'it is'],
  [/['’]s\b/gi, 's'],
];

/** Removes thinking text and quotes, opens contractions, and drops commas and hyphens between words. */
function cleanReply(content: string): string {
  const withoutThinking = content.includes('</think>') ? content.slice(content.lastIndexOf('</think>') + 8) : content;
  let line = withoutThinking.trim().split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  line = line.replace(/^\s*(summary|sentence)\s*:\s*/i, '').replace(/["“”«»]/g, '');
  for (const [pattern, replacement] of CONTRACTIONS) line = line.replace(pattern, replacement);
  return line
    .replace(/(\p{L})[-‐‑–—](\p{L})/gu, '$1 $2')
    .replace(/[,;:]/g, ' ')
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
