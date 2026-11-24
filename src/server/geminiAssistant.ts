import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const OTLOBHA_ASSISTANT_MODEL = 'gemini-4-hydrogen';
export const OTLOBHA_ASSISTANT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const PER_MODEL_TIMEOUT_MS = 12_000;
const MODEL_OVERLOAD_COOLDOWN_MS = 90_000;

interface ModelCandidate {
  model: string;
  thinkingLevel?: ThinkingLevel;
  timeoutMs: number;
}

const ASSISTANT_MODEL_CANDIDATES: ModelCandidate[] = [
  { model: OTLOBHA_ASSISTANT_MODEL, thinkingLevel: ThinkingLevel.LOW, timeoutMs: 10_000 },
  { model: OTLOBHA_ASSISTANT_FALLBACK_MODEL, thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 10_000 },
  { model: 'gemini-2.5-flash', timeoutMs: PER_MODEL_TIMEOUT_MS },
];

// Circuit breaker: skip models that just returned 503 high-demand for 90s so users get fast replies
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

export class GeminiAssistantError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 502, code = 'GEMINI_UPSTREAM_ERROR') {
    super(message);
    this.name = 'GeminiAssistantError';
    this.statusCode = statusCode;
    this.code = code;
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

function classifyGeminiError(err: unknown): GeminiAssistantError {
  if (err instanceof GeminiAssistantError) return err;

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
      'API_KEY_INVALID'
    );
  }

  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA')) {
    return new GeminiAssistantError(
      'تم تجاوز الحد المسموح لطلبات المساعد الذكي حاليًا. يرجى المحاولة بعد لحظات.',
      429,
      'RESOURCE_EXHAUSTED'
    );
  }

  if (status === 404 || upper.includes('NOT_FOUND') || upper.includes('IS NOT FOUND')) {
    return new GeminiAssistantError(
      'نموذج الذكاء الاصطناعي المطلوب غير متاح حاليًا على الخادم.',
      502,
      'MODEL_NOT_FOUND'
    );
  }

  if (upper.includes('TIMEOUT') || upper.includes('ABORT')) {
    return new GeminiAssistantError(
      'استغرق الاتصال بخدمة الذكاء الاصطناعي وقتًا أطول من المعتاد. يرجى المحاولة مرة أخرى.',
      504,
      'UPSTREAM_TIMEOUT'
    );
  }

  if (status === 400 || upper.includes('INVALID_ARGUMENT')) {
    return new GeminiAssistantError(
      'تعذر معالجة صيغة الطلب. جرّب إعادة صياغة سؤالك بشكل مختصر.',
      400,
      'INVALID_ARGUMENT'
    );
  }

  if (status === 503 || upper.includes('HIGH DEMAND') || upper.includes('OVERLOADED') || upper.includes('UNAVAILABLE')) {
    return new GeminiAssistantError(
      'تشهد خدمة المساعد الذكي ضغطًا مؤقتًا الآن. يرجى الضغط على إعادة المحاولة خلال ثوانٍ.',
      503,
      'UPSTREAM_HIGH_DEMAND'
    );
  }

  return new GeminiAssistantError(
    'تعذر الاتصال بخدمة المساعد الذكي حاليًا. يرجى المحاولة مرة أخرى خلال لحظات.',
    502,
    'UPSTREAM_UNAVAILABLE'
  );
}

function isRetryableError(err: unknown): boolean {
  const status = Number((err as any)?.status || (err as any)?.statusCode || 0);
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  if (status === 429 || status >= 500) return true;
  const code = String((err as any)?.code || '').toUpperCase();
  if (code === 'EMPTY_RESPONSE' || code === 'TIMEOUT' || code === 'UPSTREAM_UNAVAILABLE') {
    return true;
  }
  const msg = String((err as any)?.message || '').toUpperCase();
  if (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('NOT_FOUND')
  ) {
    return false;
  }
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('TIMEOUT') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('NETWORK') ||
    msg.includes('ABORTED') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('OVERLOADED')
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

export async function runOtlobhaGeminiAssistant(
  input: AssistantRunInput
): Promise<AssistantRunOutput> {
  const ai = getGeminiClient();

  const catalogBlock =
    input.catalogProducts.length > 0
      ? input.catalogProducts
          .slice(0, 14)
          .map(
            (p) =>
              `- id:${p.id} | ${p.name_ar}${p.size_label ? ` (${p.size_label})` : ''}${p.brand ? ` [${p.brand}]` : ''} | ${p.effective_price} ج.م${p.is_offer ? ' (عرض)' : ''} | ${p.merchant_name || 'اطلبها'}`
          )
          .join('\n')
      : 'لا توجد منتجات مطابقة بالكتالوج حاليًا (متاح «الطلب النصي الحر» لطلب أي شيء فورًا).';

  const categoriesBlock =
    input.categoryNames.length > 0
      ? input.categoryNames.slice(0, 20).join('، ')
      : 'المقاضي، المنتجات الطازجة، المشروبات، المنظفات، الصيدلية';

  const merchantsBlock =
    input.merchantNames.length > 0
      ? input.merchantNames.slice(0, 12).join('، ')
      : 'متاجر وصيدليات المنزلة';

  const systemInstruction = [
    'أنت «مساعد اطلبها الذكي» لتطبيق «اطلبها – Otlobha» في المنزلة – الدقهلية، مصر.',
    'أجب بسرعة ووضوح على جميع أسئلة المستخدم بدون استثناء: سواء كانت أسئلة عن منتجات أو أسعار أو وصفات طبخ أو خدمات اطلبها أو أي أسئلة عامة ومعلومات وحسابات ونصائح يومية. تحدّث بلغة عربية/مصرية راقية ومختصرة (2 إلى 5 جمل مفيدة).',
    'خدمات اطلبها المتاحة: المتاجر والمقاضي، الطلب النصي الحر (free_order)، الصيدليات والروشتة (pharmacy)، اطلبها مشوار (rides)، طرود أي حاجة (parcels)، سوق اطلبها (market).',
    'القواعد:',
    '- لا ترفض أي سؤال عادي أو عام — جاوب عليه بذكاء ومباشرة دائمًا.',
    '- لا تخترع أسعار منتجات غير موجودة في الكتالوج أدناه. إن وجد منتج مناسب في الكتالوج اذكره وضع معرّفه في suggested_product_ids.',
    '- في search_keywords اكتب كلمات مفردة قصيرة لأسماء المنتجات فقط (مثل: "مكرونة"، "لبن"، "شاي") إن كان السؤال يتعلق بشراء منتجات، وإلا اتركها مصفوفة فارغة [].',
    '- في suggested_service اختر فقط من القيم: "none" أو "pharmacy" أو "rides" أو "parcels" أو "market" أو "free_order".',
    '- في quick_prompts قدّم 3 اقتراحات متابعة قصيرة ومناسبة للسؤال.',
    `الأقسام: ${categoriesBlock}`,
    `المتاجر: ${merchantsBlock}`,
    'منتجات الكتالوج ذات الصلة:',
    catalogBlock,
  ].join('\n');

  // Sanitize multi-turn conversation history so Gemini always receives
  // strictly alternating user/model turns starting with a 'user' turn.
  const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = (input.history || [])
    .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
    .slice(-8)
    .map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      text: h.text.trim().slice(0, 900),
    }));

  const normalizedTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
  for (const turn of rawTurns) {
    if (normalizedTurns.length === 0 && turn.role !== 'user') {
      continue;
    }
    const prev = normalizedTurns[normalizedTurns.length - 1];
    if (prev && prev.role === turn.role) {
      prev.text = `${prev.text}\n${turn.text}`.slice(0, 1200);
    } else {
      normalizedTurns.push({ ...turn });
    }
  }

  const currentUserText = input.message.trim().slice(0, 1200);
  const lastNorm = normalizedTurns[normalizedTurns.length - 1];
  if (lastNorm && lastNorm.role === 'user') {
    if (lastNorm.text !== currentUserText) {
      lastNorm.text = `${lastNorm.text}\n${currentUserText}`.slice(0, 1500);
    }
  } else {
    normalizedTurns.push({ role: 'user', text: currentUserText });
  }

  const contents = normalizedTurns.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  const now = Date.now();
  const readyCandidates = ASSISTANT_MODEL_CANDIDATES.filter(
    (c) => (modelCooldownUntil.get(c.model) ?? 0) <= now
  );
  const cooledCandidates = ASSISTANT_MODEL_CANDIDATES.filter(
    (c) => (modelCooldownUntil.get(c.model) ?? 0) > now
  );
  const orderedCandidates = [...readyCandidates, ...cooledCandidates];

  // Try all candidates once; if a brief 503 burst hits them all, do one quick recovery retry on flash-lite
  const executionPlan: Array<{ candidate: ModelCandidate; delayBeforeMs: number }> = [
    ...orderedCandidates.map((candidate) => ({ candidate, delayBeforeMs: 0 })),
    {
      candidate: ASSISTANT_MODEL_CANDIDATES[1], // gemini-3.1-flash-lite fast recovery
      delayBeforeMs: 600,
    },
  ];

  let lastErr: unknown = null;
  let lastTransientErr: unknown = null;
  for (const step of executionPlan) {
    const { candidate, delayBeforeMs } = step;
    if (delayBeforeMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBeforeMs));
    }
    try {
      const config: Record<string, unknown> = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply_ar: {
              type: Type.STRING,
              description: 'رد واضح ومباشر ومفيد للمستخدم باللغة العربية.',
            },
            search_keywords: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'أسماء منتجات مفردة قصيرة للبحث بالكتالوج إن كان الطلب للشراء، وإلا فارغة.',
            },
            suggested_product_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'معرّفات المنتجات الحقيقية من الكتالوج المرفق فقط.',
            },
            suggested_service: {
              type: Type.STRING,
              enum: ['none', 'pharmacy', 'rides', 'parcels', 'market', 'free_order'],
              description: 'خدمة مقترحة من اطلبها إن كانت مناسبة، وإلا "none".',
            },
            quick_prompts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 اقتراحات قصيرة لأسئلة متابعة مناسبة.',
            },
          },
          required: ['reply_ar', 'quick_prompts'],
        },
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
        candidate.timeoutMs
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

      const validCatalogIds = new Set(input.catalogProducts.map((p) => p.id));
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
        suggested_service: (ALLOWED_SERVICES.has(normalizedService) ? normalizedService : '') as AssistantRunOutput['suggested_service'],
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
      console.error(
        `[OtlobhaAssistant] model=${candidate.model} failed (status=${errStatus}): ${errMsg.slice(0, 260)}`
      );

      // Stop immediately on auth/key errors — failing over to another model won't help
      if (errStatus === 401 || errStatus === 403) {
        throw classifyGeminiError(err);
      }

      if (
        errStatus === 503 ||
        errStatus === 429 ||
        upper.includes('HIGH DEMAND') ||
        upper.includes('UNAVAILABLE') ||
        upper.includes('OVERLOADED') ||
        upper.includes('TIMEOUT')
      ) {
        lastTransientErr = err;
        modelCooldownUntil.set(candidate.model, Date.now() + MODEL_OVERLOAD_COOLDOWN_MS);
      } else if (errStatus === 404 || upper.includes('NOT_FOUND')) {
        // Put unavailable model on longer cooldown (10 min) so it doesn't slow down requests
        modelCooldownUntil.set(candidate.model, Date.now() + 10 * 60_000);
      }
      continue;
    }
  }

  throw classifyGeminiError(lastTransientErr ?? lastErr);
}
