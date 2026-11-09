export type SuggestResult = { ok: true; summary: string } | { ok: false; error: string };

/** Asks the Pages Function for a summary that NEAR AI writes. */
export async function suggestSummary(text: string, signal?: AbortSignal): Promise<SuggestResult> {
  let response: Response;
  try {
    response = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch {
    return { ok: false, error: 'The summary service is not reachable. Write the summary yourself.' };
  }
  const body = (await response.json().catch(() => null)) as { summary?: unknown; error?: unknown } | null;
  if (response.ok && typeof body?.summary === 'string') {
    return { ok: true, summary: body.summary };
  }
  if (typeof body?.error === 'string') {
    return { ok: false, error: body.error };
  }
  return { ok: false, error: `The summary service answered ${response.status}. Write the summary yourself.` };
}
