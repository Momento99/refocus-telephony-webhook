import type { RecognitionEngine } from './frameProcurementTypes';

// Standard API tariff, verified 2026-10-05; prompts stay below 272k tokens.
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
export const FRAME_RECOGNITION_MODEL_CONFIG = {
  'gpt-6.1-sol': {
    label: 'GPT-6.1 Sol', inputUsdPerMillion: 2,
    cachedInputUsdPerMillion: .10, outputUsdPerMillion: 10,
    reasoningEffort: 'low' as const,
  },
} satisfies Record<RecognitionEngine, unknown>;
/** Indicative UI conversion, not an accounting exchange rate. */
export const FRAME_RECOGNITION_USD_TO_KGS = 87.45;
export function frameRecognitionUsageCost(input: number, cached: number, output: number) {
  const config = FRAME_RECOGNITION_MODEL_CONFIG['gpt-6.1-sol'];
  const usd = (Math.max(0, input - cached) * config.inputUsdPerMillion
    + cached * config.cachedInputUsdPerMillion + output * config.outputUsdPerMillion) / 1e6;
  return { inputTokens: input, cachedTokens: cached, outputTokens: output,
    usd, kgs: usd * FRAME_RECOGNITION_USD_TO_KGS };
}
