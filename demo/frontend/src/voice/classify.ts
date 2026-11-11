// Asks the Pages Function for the scores of a spoken sentence (JEV), and makes the command.
// When the route does not answer, the page's own word rules give the scores.

import { commandRequest, decideCommand, readScores, ruleScores, type Screen, type VoiceCommand } from './command';

export interface Classified {
  command: VoiceCommand;
  /** `jev`: the route answered. `rules`: the page's word rules. */
  by: 'jev' | 'rules';
  ms: number;
}

export async function classify(transcript: string, screen: Screen, signal?: AbortSignal): Promise<Classified> {
  const request = commandRequest(transcript, screen);
  const started = performance.now();
  let scores = null;
  try {
    const response = await fetch('/api/voice-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (response.ok) scores = readScores(await response.json().catch(() => null), request.posts.length);
  } catch (cause) {
    if (signal?.aborted) throw cause;
  }
  const by = scores ? 'jev' : 'rules';
  return { command: decideCommand(scores ?? ruleScores(request), screen, transcript), by, ms: Math.round(performance.now() - started) };
}
