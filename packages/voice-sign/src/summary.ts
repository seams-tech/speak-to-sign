/**
 * The summaries of a page, kept for a short time: `@seams/voice-sign/summary`.
 *
 * A person approves a text (a note, a message) by saying a short summary of it. A server writes
 * the summary (`writeSummary` of `@seams/voice-sign/server`), which takes 0.5 to 2 s. A page that
 * asks only when the person presses the button shows nothing for that time. With a source, the
 * page asks early (`prepare`), and the press finds the summary (`get`).
 *
 * The source keeps one summary for each exact text. So the summary that the person saw is the
 * one of the next try, and a changed text gets its own summary. This file has no dependency.
 */

/** A written summary, or a fixed code of the failure. */
export type SummaryResult = { ok: true; summary: string } | { ok: false; code: string };

export interface SummarySourceOptions {
  /** Asks your server for the summary of `text`. It must not throw for a refusal: give a code. */
  write: (text: string, signal: AbortSignal) => Promise<SummaryResult>;
  /** How long a summary stays. Default: 5 minutes. */
  lifeMs?: number;
  /** The most texts that the source keeps. The oldest one goes first. Default: 8. */
  maxEntries?: number;
  /** Tests pass a clock of their own. */
  now?: () => number;
}

export interface SummarySource {
  /** Starts the request for `text`, unless a summary is kept or in flight. It never throws. */
  prepare(text: string): void;
  /**
   * The summary of `text`: the kept one, the one in flight, or a new request. A failure is not
   * kept, so the next call asks again. Aborting `signal` ends only this call's wait: the request
   * goes on for another caller.
   */
  get(text: string, signal?: AbortSignal): Promise<SummaryResult>;
  /** Forgets one text, or all of them (for example when the person signs out). */
  forget(text?: string): void;
}

type Entry = { request: Promise<SummaryResult>; startedAtMs: number; stop: AbortController };

export function createSummarySource(options: SummarySourceOptions): SummarySource {
  const lifeMs = options.lifeMs ?? 5 * 60_000;
  const maxEntries = Math.max(1, options.maxEntries ?? 8);
  const now = options.now ?? Date.now;
  // In the order of their start: the first key is the oldest.
  const entries = new Map<string, Entry>();

  const start = (text: string): Entry => {
    const stop = new AbortController();
    const request = options
      .write(text, stop.signal)
      .catch((): SummaryResult => ({ ok: false, code: 'summary_unreachable' }))
      .then((result) => {
        // Only a summary stays. After a failure, the next call asks again.
        if (!result.ok && entries.get(text) === entry) entries.delete(text);
        return result;
      });
    const entry: Entry = { request, startedAtMs: now(), stop };
    entries.delete(text);
    entries.set(text, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value as string;
      entries.get(oldest)?.stop.abort();
      entries.delete(oldest);
    }
    return entry;
  };

  const current = (text: string): Entry => {
    const kept = entries.get(text);
    return kept && now() - kept.startedAtMs < lifeMs ? kept : start(text);
  };

  return {
    prepare(text) {
      void current(text).request;
    },
    get(text, signal) {
      const { request } = current(text);
      if (!signal) return request;
      if (signal.aborted) return Promise.reject(signal.reason);
      return new Promise<SummaryResult>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        void request.then((result) => {
          signal.removeEventListener('abort', abort);
          resolve(result);
        });
      });
    },
    forget(text) {
      const gone = text === undefined ? [...entries.keys()] : [text];
      for (const key of gone) {
        entries.get(key)?.stop.abort();
        entries.delete(key);
      }
    },
  };
}
