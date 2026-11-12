// JEV (Typesafe System One): a model that answers questions about a state with probabilities. A
// Noul question gives the probability of "yes"; a choice question gives one of its options, with
// the probability of each. JEV answers all the questions of a request in one call.
//
// The functions call JEV at Typesafe when TYPESAFE_API_KEY is set, and on NEAR AI Cloud otherwise.

export interface JevRoute {
  endpoint: string;
  model: string;
}

/** JEV at Typesafe. Pinned: a moving alias could change the probabilities. */
export const TYPESAFE_JEV: JevRoute = { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.14.0' };
/** JEV served by NEAR AI Cloud: the same request, with the NEAR AI key. */
export const NEAR_AI_JEV: JevRoute = { endpoint: 'https://cloud-api.near.ai/v1/systemone', model: 'typesafe/jev-1.13' };

export type KeyedJevRoute = JevRoute & { key: string };

/** The JEV route of the keys that a function has, or null when it has neither key. */
export function jevRoute(env: { TYPESAFE_API_KEY?: string; NEAR_AI_API_KEY?: string }): KeyedJevRoute | null {
  const typesafe = env.TYPESAFE_API_KEY?.trim();
  if (typesafe) return { ...TYPESAFE_JEV, key: typesafe };
  const nearAi = env.NEAR_AI_API_KEY?.trim();
  return nearAi ? { ...NEAR_AI_JEV, key: nearAi } : null;
}
