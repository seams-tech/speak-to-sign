// GET /api/near-ai-status  ->  { nearAi, whisper, checkedAtMs }
//
// The state of NEAR AI Cloud and of the Whisper model that the verifier uses
// (functions/lib/nearAiStatus.ts). The nav of each demo page shows a warning when one is down
// or slow. The route signs nothing and takes no input.

import { json, refuseOtherOrigin } from '../lib/http.ts';
import { checkNearAi, statusCache } from '../lib/nearAiStatus.ts';

interface Env {
  NEAR_AI_API_KEY?: string;
}

const cached = statusCache(Date.now);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const refused = refuseOtherOrigin(request);
  if (refused) return refused;
  const status = await cached(() => checkNearAi({ apiKey: env.NEAR_AI_API_KEY, fetch: (input, init) => fetch(input, init), now: Date.now }));
  return json(status);
};
