/**
 * Универсальный вызов LLM для AI-анализа качества диалогов.
 * Поддерживает три модели:
 *   - `gemma3:12b`         → локальная Ollama ($0, ~60–120 сек/диалог)
 *   - `claude-haiku-4-5`   → Anthropic API ($0.006/диалог, ~2 сек)
 *   - `claude-opus-4-7`    → Anthropic API ($0.095/диалог, ~15 сек)
 *
 * Возвращает нормализованный результат: текст + токены + стоимость.
 */

export type LlmModelId = 'gemma3:12b' | 'claude-haiku-4-5' | 'claude-opus-4-7';

export const LLM_MODELS: Array<{
  id: LlmModelId;
  label: string;
  provider: 'ollama' | 'anthropic';
  free: boolean;
  api_model: string; // реальный id модели для API
}> = [
  { id: 'gemma3:12b', label: 'Gemma 3 (бесплатно)', provider: 'ollama', free: true, api_model: 'gemma3:12b' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku', provider: 'anthropic', free: false, api_model: 'claude-haiku-4-5-20251001' },
  { id: 'claude-opus-4-7', label: 'Claude Opus (премиум)', provider: 'anthropic', free: false, api_model: 'claude-opus-4-7' },
];

/** Цены в USD за 1 000 000 токенов для каждой модели. */
const PRICING: Record<LlmModelId, { input: number; output: number }> = {
  'gemma3:12b': { input: 0, output: 0 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-7': { input: 15, output: 75 },
};

export function isValidModel(v: unknown): v is LlmModelId {
  return v === 'gemma3:12b' || v === 'claude-haiku-4-5' || v === 'claude-opus-4-7';
}

export function calcCost(model: LlmModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  return Number(((inputTokens * p.input + outputTokens * p.output) / 1_000_000).toFixed(4));
}

export type LlmResult = {
  content: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model: LlmModelId;
  provider: 'ollama' | 'anthropic';
  duration_ms: number;
};

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

export async function runLlmAnalysis(
  model: LlmModelId,
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmResult> {
  const meta = LLM_MODELS.find((m) => m.id === model);
  if (!meta) throw new Error(`Unknown model ${model}`);

  const started = Date.now();

  if (meta.provider === 'ollama') {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: meta.api_model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        options: { temperature: 0.3, num_ctx: 8192, num_predict: 4096 },
      }),
    }).catch((e: any) => {
      throw new Error(
        `Ollama не отвечает (${OLLAMA_URL}). Запусти Ollama или выбери Claude. ${e?.message ?? ''}`,
      );
    });
    const data: any = await r.json();
    if (!r.ok) throw new Error(`Ollama API: ${r.status} — ${data?.error ?? JSON.stringify(data)}`);
    const content: string = data?.message?.content ?? '(пустой ответ)';
    const input_tokens = Number(data?.prompt_eval_count ?? 0);
    const output_tokens = Number(data?.eval_count ?? 0);
    return {
      content,
      input_tokens,
      output_tokens,
      cost_usd: 0,
      model,
      provider: 'ollama',
      duration_ms: Date.now() - started,
    };
  }

  // Anthropic (claude-haiku-4-5 / claude-opus-4-7)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env не задан');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: meta.api_model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(`Anthropic API: ${r.status} — ${data?.error?.message ?? JSON.stringify(data)}`);

  const content: string = data?.content?.[0]?.text ?? '(пустой ответ)';
  const input_tokens = Number(data?.usage?.input_tokens ?? 0);
  const output_tokens = Number(data?.usage?.output_tokens ?? 0);
  const cost_usd = calcCost(model, input_tokens, output_tokens);
  return {
    content,
    input_tokens,
    output_tokens,
    cost_usd,
    model,
    provider: 'anthropic',
    duration_ms: Date.now() - started,
  };
}
