// The state of NEAR AI Cloud and of its Whisper model, as GET /api/near-ai-status gives it
// (functions/lib/nearAiStatus.ts), and the warning that the nav shows for it
// (components/NearAiWarning.tsx).

/**
 * `unknown` is an answer that says nothing about an outage: no key, a refused key, a rate limit
 * or a refused clip. The page shows no warning for it.
 */
export type ServiceState = 'up' | 'slow' | 'down' | 'unknown';

export interface NearAiStatus {
  nearAi: ServiceState;
  whisper: ServiceState;
  checkedAtMs: number;
}

/** `short` fits a narrow nav; `long` says what fails. */
export interface NearAiWarningText {
  level: 'down' | 'slow';
  short: string;
  long: string;
}

const STATES: readonly string[] = ['up', 'slow', 'down', 'unknown'];
const isState = (value: unknown): value is ServiceState => typeof value === 'string' && STATES.includes(value);

export function readNearAiStatus(body: unknown): NearAiStatus | null {
  if (typeof body !== 'object' || body === null) return null;
  const { nearAi, whisper, checkedAtMs } = body as Record<string, unknown>;
  if (!isState(nearAi) || !isState(whisper) || typeof checkedAtMs !== 'number') return null;
  return { nearAi, whisper, checkedAtMs };
}

/** The verifier sends each recording to Whisper, so a Whisper outage stops every voice check. */
export function warningOf(status: NearAiStatus | null): NearAiWarningText | null {
  if (!status) return null;
  if (status.nearAi === 'down') {
    return { level: 'down', short: 'NEAR AI is down', long: 'NEAR AI is down. Voice checks fail until it is back.' };
  }
  if (status.whisper === 'down') {
    return {
      level: 'down',
      short: 'Speech-to-text is down',
      long: 'NEAR AI speech-to-text is down. Voice checks fail until it is back.',
    };
  }
  if (status.whisper === 'slow') {
    return { level: 'slow', short: 'Speech-to-text is slow', long: 'NEAR AI speech-to-text is slow. Voice checks take longer.' };
  }
  return null;
}
