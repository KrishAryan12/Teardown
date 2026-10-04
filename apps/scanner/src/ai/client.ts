/** Shared OpenAI-compatible chat client (Gemini compat endpoint, Groq, HF router, OpenRouter). */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonMode: boolean;
  /** Provider-specific extras, e.g. { reasoning_effort: 'none' } for Gemini. */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface ChatResponse {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  latencyMs: number;
}

export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body = '',
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** The request shape was rejected (unsupported param such as response_format or reasoning_effort). */
  get unsupportedParam(): boolean {
    return this.status === 400 && /response_format|json_object|reasoning|unsupported|not support|unknown (field|parameter)|invalid.*param/i.test(this.body);
  }

  get modelGone(): boolean {
    return this.status === 404 || (this.status === 400 && /model.*(not found|does not exist|decommissioned|deprecated|retired|no longer|invalid model)|not a valid model/i.test(this.body));
  }
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    stream: false,
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...req.extra,
  };
  let res: Response;
  try {
    res = await (req.fetchImpl ?? fetch)(`${req.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${req.apiKey}`, ...req.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    throw new ProviderError(timeout ? 408 : 0, timeout ? 'timeout' : 'network error');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ProviderError(res.status, `HTTP ${res.status}`, text.slice(0, 1000));
  let json: { choices?: { message?: { content?: string | null } }[]; usage?: ChatResponse['usage']; error?: { message?: string; code?: number } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError(502, 'non-JSON response', text.slice(0, 300));
  }
  if (json.error) throw new ProviderError(json.error.code ?? 502, json.error.message ?? 'provider error', JSON.stringify(json.error).slice(0, 500));
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content) throw new ProviderError(502, 'empty completion');
  return { content, usage: json.usage, latencyMs: Date.now() - started };
}
