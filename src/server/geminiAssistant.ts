import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const OTLOBHA_ASSISTANT_MODEL = 'gemini-4-hydrogen';
export const OTLOBHA_ASSISTANT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
export const OTLOBHA_ASSISTANT_TERTIARY_MODEL = 'gemini-3.8-flash';

const PER_ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_REQUEST_BUDGET_MS = 38_000;
const MODEL_OVERLOAD_COOLDOWN_MS = 15_000;

interface ModelCandidate {
  model: string;
  thinkingLevel?: ThinkingLevel;
}

const ASSISTANT_MODEL_CANDIDATES: ModelCandidate[] = [
  { model: OTLOBHA_ASSISTANT_FALLBACK_MODEL, thinkingLevel: ThinkingLevel.MINIMAL },
  { model: OTLOBHA_ASSISTANT_MODEL, thinkingLevel: ThinkingLevel.LOW },
  { model: OTLOBHA_ASSISTANT_TERTIARY_MODEL, thinkingLevel: ThinkingLevel.LOW },
];

// Short circuit breaker: deprioritize models that just returned 503 for 15s (10m for 404)
const modelCooldownUntil = new Map<string, number>();

export interface AssistantHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantCatalogProductSummary {
  id: string;
  name_ar: string;
  brand?: string;
  size_label?: string;
  category_name?: string;
  merchant_name?: string;
  effective_price: number;
  base_price: number;
  is_offer: boolean;
  stores_count?: number;
}

export interface AssistantRunInput {
  message: string;
  history?: AssistantHistoryTurn[];
  catalogProducts: AssistantCatalogProductSummary[];
  categoryNames: string[];
  merchantNames: string[];
  zoneName?: string;
}

export interface AssistantRunOutput {
  reply_ar: string;
  search_keywords: string[];
  suggested_product_ids: string[];
  suggested_service: '' | 'pharmacy' | 'rides' | 'parcels' | 'market' | 'free_order';
  quick_prompts: string[];
  model: string;
}

export interface AssistantAttemptDiagnostic {
  model: string;
  status: number;
  ms: number;
  reason: string;
}

export class GeminiAssistantError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly attempts?: AssistantAttemptDiagnostic[];

  constructor(
    message: string,
    statusCode = 502,
    code = 'GEMINI_UPSTREAM_ERROR',
    attempts?: AssistantAttemptDiagnostic[]
  ) {
    super(message);
    this.name = 'GeminiAssistantError';
    this.statusCode = statusCode;
    this.code = code;
    this.attempts = attempts;
  }
}

let cachedClientKey = '';
let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiAssistantError(
      'مفتاح خدمة الذكاء الاصطناعي غير مضبوط على الخادم. يرجى التأكد من إعداد GEMINI_API_KEY في لوحة الإعدادات (Settings > Secrets).',
      503,
      'API_KEY_MISSING'
    );
  }
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedClientKey = apiKey;
  }
  return cachedClient;
}

function classifyGeminiError(
  err: unknown,
  attempts?: AssistantAttemptDiagnostic[]
): GeminiAssistantError {
  if (err instanceof GeminiAssistantError) {
    return attempts && !err.attempts
      ? new GeminiAssistantError(err.message, err.statusCode, err.code, attempts)
      : err;
  }

  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err ?? '');
  const status = Number((err as any)?.status || (err as any)?.statusCode || 0);
  const upper = rawMsg.toUpperCase();

  if (
    status === 401 ||
    status === 403 ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('API KEY NOT VALID')
  ) {
    return new GeminiAssistantError(
      'تعذر المصادقة مع خدمة الذكاء الاصطناعي. يرجى مراجعة مفتاح GEMINI_API_KEY في إعدادات الخادم (Settings > Secrets).',
      503,
      'API_KEY_INVALID',
      attempts
    );
  }

  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA')) {
    return new GeminiAssistantError(
      'تم تجاوز الحد المسموح لطلبات المساعد الذكي حاليًا. يرجى المحاولة بعد لحظات.',
      429,
      'RESOURCE_EXHAUSTED',
      attempts
    );
  }

  if (status === 404 || upper.includes('NOT_FOUND') || upper.includes('IS NOT FOUND')) {
    return new GeminiAssistantError(
      'نموذج الذكاء الاصطناعي المطلوب غير متاح حاليًا على الخادم.',
      502,
      'MODEL_NOT_FOUND',
      attempts
    );
  }

  if (upper.includes('TIMEOUT') || upper.includes('ABORT')) {
    return new GeminiAssistantError(
      'استغرق الاتصال بخدمة الذكاء الاصطناعي وقتًا أطول من المعتاد. يرجى المحاولة مرة أخرى.',
      504,
      'UPSTREAM_TIMEOUT',
      attempts
    );
  }

  if (status === 400 || upper.includes('INVALID_ARGUMENT')) {
    return new GeminiAssistantError(
      'تعذر معالجة صيغة الطلب. جرّب إعادة صياغة سؤالك بشكل مختصر.',
      400,
      'INVALID_ARGUMENT',
      attempts
    );
  }

  if (
    status === 503 ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('UNAVAILABLE')
  ) {
    return new GeminiAssistantError(
      'تشهد خدمة المساعد الذكي ضغطًا مؤقتًا الآن. يرجى الضغط على إعادة المحاولة خلال ثوانٍ.',
      503,
      'UPSTREAM_HIGH_DEMAND',
      attempts
    );
  }

  return new GeminiAssistantError(
    'تعذر الاتصال بخدمة المساعد الذكي حاليًا. يرجى المحاولة مرة أخرى خلال لحظات.',
    502,
    'UPSTREAM_UNAVAILABLE',
    attempts
  );
}

function parseJsonResponseText(raw: string): Record<string, any> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // fall through
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    return null;
  }
}

const ALLOWED_SERVICES = new Set(['', 'pharmacy', 'rides', 'parcels', 'market', 'free_order']);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`GEMINI_TIMEOUT_${ms}MS`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOtlobhaGeminiAssistant(
  input: AssistantRunInput
): Promise<AssistantRunOutput> {
  const ai = getGeminiClient();

  const catalogBlock =
    input.catalogProducts.length > 0
      ? input.catalogProducts
          .slice(0, 10)
          .map(
            (p) =>
              `- id:${p.id} | ${p.name_ar}${p.size_label ? ` (${p.size_label})` : ''} | ${p.effective_price} ج.م${p.is_offer ? ' (عرض)' : ''} | ${p.merchant_name || 'اطلبها'}`
          )
          .join('\n')
      : 'لا توجد منتجات مطابقة بالكتالوج حاليًا (متاح «الطلب النصي الحر» لطلب أي شيء فورًا).';

  const categoriesBlock =
    input.categoryNames.length > 0
      ? input.categoryNames.slice(0, 14).join('، ')
      : 'المقاضي، الطازج، المشروبات، المنظفات، الصيدلية';

  const merchantsBlock =
    input.merchantNames.length > 0
      ? input.merchantNames.slice(0, 8).join('، ')
      : 'متاجر وصيدليات المنزلة';

  const systemInstruction = [
    'أنت «مساعد اطلبها الذكي» لتطبيق «اطلبها» في المنزلة – الدقهلية، مصر.',
    'أجب بسرعة ووضوح على جميع أسئلة المستخدم (منتجات، أسعار، وصفات طبخ، خدمات اطلبها، أو أسئلة عامة) بعربية/مصرية لطيفة ومختصرة (2-4 جمل).',
    'الخدمات: المتاجر والمقاضي، الطلب النصي الحر، الصيدليات والروشتة، اطلبها مشوار، طرود أي حاجة، سوق اطلبها.',
    'قواعد مهمة:',
    '- لا تذكر أبدًا أسماء برمجية إنجليزية مثل free_order أو pharmacy أو market داخل reply_ar أو quick_prompts؛ اكتبها بالعربية فقط.',
    '- لا تخترع أسعار منتجات غير موجودة في الكتالوج أدناه. إن وجد منتج مناسب اذكره وضع معرّفه الدقيق في suggested_product_ids.',
    '- في search_keywords اكتب كلمات مفردة قصيرة لأسماء المنتجات فقط إن كان الطلب للشراء، وإلا [].',
    '- في suggested_service اختر فقط من: "none" أو "pharmacy" أو "rides" أو "parcels" أو "market" أو "free_order".',
    '- في quick_prompts قدّم 3 اقتراحات عربية قصيرة ومناسبة للمتابعة.',
    `الأقسام: ${categoriesBlock}`,
    `المتاجر: ${merchantsBlock}`,
    'منتجات الكتالوج المتاحة:',
    catalogBlock,
  ].join('\n');

  // Sanitize multi-turn conversation history so Gemini receives strictly alternating user/model turns starting with 'user'
  const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = (input.history || [])
    .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
    .slice(-6)
    .map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      text: h.text.trim().slice(0, 600),
    }));

  const normalizedTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
  for (const turn of rawTurns) {
    if (normalizedTurns.length === 0 && turn.role !== 'user') {
      continue;
    }
    const prev = normalizedTurns[normalizedTurns.length - 1];
    if (prev && prev.role === turn.role) {
      prev.text = `${prev.text}\n${turn.text}`.slice(0, 900);
    } else {
      normalizedTurns.push({ ...turn });
    }
  }

  const currentUserText = input.message.trim().slice(0, 1000);
  const lastNorm = normalizedTurns[normalizedTurns.length - 1];
  if (lastNorm && lastNorm.role === 'user') {
    if (lastNorm.text !== currentUserText) {
      lastNorm.text = `${lastNorm.text}\n${currentUserText}`.slice(0, 1200);
    }
  } else {
    normalizedTurns.push({ role: 'user', text: currentUserText });
  }

  const contents = normalizedTurns.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      reply_ar: { type: Type.STRING },
      search_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      suggested_product_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
      suggested_service: {
        type: Type.STRING,
        enum: ['none', 'pharmacy', 'rides', 'parcels', 'market', 'free_order'],
      },
      quick_prompts: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['reply_ar', 'quick_prompts'],
  };

  const validCatalogIds = new Set(input.catalogProducts.map((p) => p.id));
  const startedAt = Date.now();
  const attempts: AssistantAttemptDiagnostic[] = [];
  const deadModels = new Set<string>();
  let fatalAuthErr: unknown = null;
  let lastTransientErr: unknown = null;
  let lastErr: unknown = null;

  const invokeCandidate = async (
    candidate: ModelCandidate,
    timeoutMs: number
  ): Promise<AssistantRunOutput> => {
    const t0 = Date.now();
    try {
      const config: Record<string, unknown> = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
      };
      if (candidate.thinkingLevel) {
        config.thinkingConfig = { thinkingLevel: candidate.thinkingLevel };
      }

      const response = await withTimeout(
        ai.models.generateContent({
          model: candidate.model,
          contents,
          config: config as any,
        }),
        timeoutMs
      );

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new GeminiAssistantError(
          'لم يُرجع المساعد الذكي ردًا نصيًا لهذه الرسالة. يرجى المحاولة مرة أخرى.',
          502,
          'EMPTY_RESPONSE'
        );
      }

      modelCooldownUntil.delete(candidate.model);

      const parsed = parseJsonResponseText(rawText);
      const replyAr = String(parsed?.reply_ar || rawText).trim();
      const rawKeywords = Array.isArray(parsed?.search_keywords) ? parsed.search_keywords : [];
      const rawProductIds = Array.isArray(parsed?.suggested_product_ids) ? parsed.suggested_product_ids : [];
      const rawPrompts = Array.isArray(parsed?.quick_prompts) ? parsed.quick_prompts : [];
      const rawService = String(parsed?.suggested_service || '').trim().toLowerCase();
      const normalizedService = rawService === 'none' ? '' : rawService;

      const suggestedProductIds = rawProductIds
        .map((id: unknown) => String(id || '').trim())
        .filter((id: string) => id.length > 0 && validCatalogIds.has(id))
        .slice(0, 8);

      const searchKeywords = rawKeywords
        .map((k: unknown) => String(k || '').trim())
        .filter((k: string) => k.length >= 2)
        .slice(0, 6);

      const quickPrompts = rawPrompts
        .map((q: unknown) => String(q || '').trim())
        .filter((q: string) => q.length >= 2 && q.length <= 60)
        .slice(0, 4);

      return {
        reply_ar: replyAr,
        search_keywords: searchKeywords,
        suggested_product_ids: suggestedProductIds,
        suggested_service: (ALLOWED_SERVICES.has(normalizedService)
          ? normalizedService
          : '') as AssistantRunOutput['suggested_service'],
        quick_prompts:
          quickPrompts.length > 0
            ? quickPrompts
            : ['أرخص العروض اليوم', 'مقاضي الفطار والألبان', 'اطلب من الصيدلية', 'طلب نصي حر'],
        model: candidate.model,
      };
    } catch (err) {
      lastErr = err;
      const errStatus = Number((err as any)?.status || (err as any)?.statusCode || 0);
      const errMsg = err instanceof Error ? err.message : String(err ?? '');
      const upper = errMsg.toUpperCase();
      const elapsed = Date.now() - t0;

      attempts.push({
        model: candidate.model,
        status: errStatus,
        ms: elapsed,
        reason: errMsg.slice(0, 200),
      });
      console.error(
        `[OtlobhaAssistant] model=${candidate.model} failed (status=${errStatus}, ${elapsed}ms): ${errMsg.slice(0, 220)}`
      );

      if (errStatus === 401 || errStatus === 403 || upper.includes('API_KEY_INVALID') || upper.includes('PERMISSION_DENIED')) {
        fatalAuthErr = err;
      } else if (errStatus === 404 || upper.includes('NOT_FOUND')) {
        deadModels.add(candidate.model);
        modelCooldownUntil.set(candidate.model, Date.now() + 10 * 60_000);
      } else if (
        errStatus === 503 ||
        errStatus === 429 ||
        upper.includes('HIGH DEMAND') ||
        upper.includes('UNAVAILABLE') ||
        upper.includes('OVERLOADED') ||
        upper.includes('TIMEOUT')
      ) {
        lastTransientErr = err;
        modelCooldownUntil.set(candidate.model, Date.now() + MODEL_OVERLOAD_COOLDOWN_MS);
      }
      throw err;
    }
  };

  /**
   * Clean single-in-flight sequential failover with exponential backoff:
   * - Never fires concurrent requests (protects RPM/quota from self-inflicted 429s).
   * - Tries each healthy model once (fast failover on 503/429/404).
   * - If a brief 503 demand spike hits all models, performs polite exponential-backoff
   *   recovery retries within the 36s total request budget.
   */
  const ready = ASSISTANT_MODEL_CANDIDATES.filter(
    (c) => (modelCooldownUntil.get(c.model) ?? 0) <= startedAt
  );
  const cooled = ASSISTANT_MODEL_CANDIDATES.filter(
    (c) => (modelCooldownUntil.get(c.model) ?? 0) > startedAt
  );
  const round1 = [...ready, ...cooled];
  const rateLimitedInRequest = new Set<string>();

  const steps: Array<{ candidate: ModelCandidate; waitBeforeMs: number }> = [
    ...round1.map((candidate, idx) => ({
      candidate,
      waitBeforeMs: idx === 0 ? 0 : 400,
    })),
    { candidate: ASSISTANT_MODEL_CANDIDATES[0], waitBeforeMs: 1_500 },
    { candidate: ASSISTANT_MODEL_CANDIDATES[2], waitBeforeMs: 2_000 },
  ];

  for (const step of steps) {
    const { candidate, waitBeforeMs } = step;
    if (deadModels.has(candidate.model) || rateLimitedInRequest.has(candidate.model)) {
      continue;
    }
    const remainingBeforeWait = TOTAL_REQUEST_BUDGET_MS - (Date.now() - startedAt);
    if (remainingBeforeWait < 5_000) {
      break;
    }
    if (waitBeforeMs > 0) {
      const actualWait = Math.min(waitBeforeMs, Math.max(0, remainingBeforeWait - 5_000));
      if (actualWait > 0) await delay(actualWait);
    }
    const remaining = TOTAL_REQUEST_BUDGET_MS - (Date.now() - startedAt);
    const effTimeout = Math.min(PER_ATTEMPT_TIMEOUT_MS, Math.max(5_000, remaining));
    try {
      return await invokeCandidate(candidate, effTimeout);
    } catch (err) {
      if (fatalAuthErr) {
        throw classifyGeminiError(fatalAuthErr, attempts);
      }
      const errStatus = Number((err as any)?.status || (err as any)?.statusCode || 0);
      const errMsg = String((err as any)?.message || err || '').toUpperCase();
      if (errStatus === 429 || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('QUOTA')) {
        rateLimitedInRequest.add(candidate.model);
        modelCooldownUntil.set(candidate.model, Date.now() + 60_000);
      }
      continue;
    }
  }

  throw classifyGeminiError(fatalAuthErr ?? lastTransientErr ?? lastErr, attempts);
}
