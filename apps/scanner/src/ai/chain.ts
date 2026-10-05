import type { Group } from '@teardown/core';
import type { Config } from '../config';
import type { DailyCounters } from '../util/daily';
import { log } from '../util/log';
import { CircuitBreaker } from './breaker';
import { chat, ProviderError, type ChatRequest } from './client';
import { deterministicAdvice } from './fallback';
import { buildMessages } from './prompt';
import type { AiInput, AiResult, AiService } from './types';
import { validateAiOutput, type ValidationStats } from './validate';

export type ProviderName = 'gemini' | 'groq' | 'huggingface' | 'openrouter';

export interface ProviderDef {
  name: ProviderName;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  dailyCap: number;
  /** Extra body params to try first (removed automatically if the endpoint rejects them). */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function providersFromConfig(cfg: Config): ProviderDef[] {
  const all: Record<ProviderName, ProviderDef> = {
    gemini: {
      name: 'gemini',
      baseUrl: cfg.GEMINI_BASE_URL,
      apiKey: cfg.GEMINI_API_KEY,
      models: cfg.GEMINI_MODELS,
      dailyCap: cfg.AI_DAILY_CALLS_GEMINI,
      // Thinking tokens are wasted on this task; disable where the model allows it.
      // Gemini 3 models can't switch reasoning off ('none' is rejected); 'minimal' keeps it short.
      extra: { reasoning_effort: 'minimal' },
    },
    // gpt-oss on Groq reasons before answering; 'low' keeps it brief (dropped automatically for models that reject it).
    groq: { name: 'groq', baseUrl: cfg.GROQ_BASE_URL, apiKey: cfg.GROQ_API_KEY, models: cfg.GROQ_MODELS, dailyCap: cfg.AI_DAILY_CALLS_GROQ, extra: { reasoning_effort: 'low' } },
    huggingface: { name: 'huggingface', baseUrl: cfg.HF_BASE_URL, apiKey: cfg.HF_TOKEN, models: cfg.HF_MODELS, dailyCap: cfg.AI_DAILY_CALLS_HUGGINGFACE },
    openrouter: {
      name: 'openrouter',
      baseUrl: cfg.OPENROUTER_BASE_URL,
      apiKey: cfg.OPENROUTER_API_KEY,
      // Free models only, by policy.
      models: cfg.OPENROUTER_MODELS.filter((m) => m.endsWith(':free')),
      dailyCap: cfg.AI_DAILY_CALLS_OPENROUTER,
      headers: { 'X-Title': 'Teardown' },
    },
  };
  return cfg.AI_PROVIDERS.filter((p): p is ProviderName => p in all).map((p) => all[p]);
}

export interface Attempt {
  provider: ProviderName;
  model: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  tokens?: number;
  stats?: ValidationStats;
}

export interface ChainOptions {
  fetchImpl?: typeof fetch;
  breaker?: CircuitBreaker;
  providers?: ProviderDef[];
  onAttempt?: (a: Attempt) => void;
}

/**
 * Tries providers in order, models in order within each, behind daily budgets and a circuit
 * breaker. Invalid output gets one retry with a "valid JSON only" nudge, then the chain advances.
 * When everything fails, returns deterministic advice with status "fallback".
 */
export class AiChain implements AiService {
  readonly breaker: CircuitBreaker;
  readonly providers: ProviderDef[];
  /** Params a model rejected once; not sent again for that model. */
  private readonly dropped = new Map<string, Set<string>>();

  constructor(
    private readonly cfg: Config,
    private readonly counters: DailyCounters,
    private readonly opts: ChainOptions = {},
  ) {
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.providers = opts.providers ?? providersFromConfig(cfg);
  }

  private globalBudget(): boolean {
    return this.counters.has('ai', this.cfg.AI_DAILY_CALLS);
  }

  private usable(p: ProviderDef): boolean {
    return !!p.apiKey && p.models.length > 0 && this.counters.has(`ai:${p.name}`, p.dailyCap) && p.models.some((m) => !this.breaker.isOpen(`${p.name}:${m}`));
  }

  available(): boolean {
    return this.globalBudget() && this.providers.some((p) => this.usable(p));
  }

  /** Why AI is unavailable, in plain words (for report notes). */
  unavailableReason(): string {
    if (!this.providers.some((p) => p.apiKey)) return 'No AI provider is configured on this server, so tasks use Teardown’s built-in order and fix text.';
    if (!this.globalBudget()) return "Today's AI budget is used up, so tasks use Teardown’s built-in order and fix text.";
    return 'Every AI provider is rate limited or over its daily budget right now, so tasks use Teardown’s built-in order and fix text.';
  }

  private async call(p: ProviderDef, model: string, input: AiInput, nudge: boolean) {
    const key = `${p.name}:${model}`;
    const dropped = this.dropped.get(key) ?? new Set<string>();
    const base: ChatRequest = {
      baseUrl: p.baseUrl,
      apiKey: p.apiKey!,
      model,
      messages: buildMessages(input, nudge),
      // Headroom for reasoning tokens, which count against max_tokens on reasoning models.
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: this.cfg.AI_TIMEOUT_MS,
      jsonMode: !dropped.has('response_format'),
      extra: Object.fromEntries(Object.entries(p.extra ?? {}).filter(([k]) => !dropped.has(k))),
      headers: p.headers,
      fetchImpl: this.opts.fetchImpl,
    };
    this.counters.incr('ai');
    this.counters.incr(`ai:${p.name}`);
    try {
      return await chat(base);
    } catch (e) {
      // Retry once without optional params the endpoint doesn't support (doesn't count twice against the breaker).
      if (e instanceof ProviderError && e.unsupportedParam) {
        const extraKeys = Object.keys(base.extra ?? {});
        for (const k of [...extraKeys, 'response_format']) dropped.add(k);
        this.dropped.set(key, dropped);
        this.counters.incr('ai');
        this.counters.incr(`ai:${p.name}`);
        return await chat({ ...base, jsonMode: false, extra: {} });
      }
      throw e;
    }
  }

  async advise(input: AiInput, groups: Group[]): Promise<AiResult> {
    const ctx = { scores: input.scores, host: input.host, pageCount: input.pageCount };
    if (!this.available()) return deterministicAdvice(ctx, groups, 'skipped', this.unavailableReason());
    const errors: string[] = [];
    const deadline = Date.now() + this.cfg.AI_TOTAL_BUDGET_MS;
    for (const p of this.providers) {
      if (!p.apiKey) continue;
      for (const model of p.models) {
        const key = `${p.name}:${model}`;
        if (this.breaker.isOpen(key)) continue;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (Date.now() > deadline) break; // out of time for this scan: fall back
          if (!this.globalBudget() || !this.counters.has(`ai:${p.name}`, p.dailyCap)) break;
          try {
            const res = await this.call(p, model, input, attempt > 0);
            const v = validateAiOutput(res.content, input, groups);
            this.opts.onAttempt?.({ provider: p.name, model, ok: v.ok, latencyMs: res.latencyMs, tokens: res.usage?.total_tokens, stats: v.stats, error: v.reason });
            if (v.ok && v.result) {
              this.breaker.success(key);
              return { status: 'ok', model: `${p.name}/${model}`, ...v.result };
            }
            this.breaker.invalid(key);
            errors.push(`${key}: ${v.reason}`);
            continue; // one nudge retry, then next model
          } catch (e) {
            const pe = e instanceof ProviderError ? e : new ProviderError(0, e instanceof Error ? e.message : 'error');
            const cool = CircuitBreaker.cooldownFor(pe.status, pe.modelGone);
            if (cool) this.breaker.trip(pe.status === 401 || pe.status === 403 ? `${p.name}:*` : key, cool);
            if (pe.status === 401 || pe.status === 403) for (const m of p.models) this.breaker.trip(`${p.name}:${m}`, cool!);
            errors.push(`${key}: ${pe.message}`);
            this.opts.onAttempt?.({ provider: p.name, model, ok: false, error: pe.message });
            log.warn({ event: 'ai_provider_error', provider: p.name, model, status: pe.status });
            break; // provider errors advance the chain immediately
          }
        }
      }
    }
    return deterministicAdvice(ctx, groups, 'fallback', 'The AI providers failed or returned unusable output, so tasks use Teardown’s built-in order and fix text.');
  }
}
