import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const OTLOBHA_ASSISTANT_MODEL = 'gemini-3.1-flash-lite';
const REQUEST_TIMEOUT_MS = 12_000;

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
        timeout: REQUEST_TIMEOUT_MS,
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

  return new GeminiAssistantError(
    'تعذر الاتصال بخدمة المساعد الذكي حاليًا. يرجى المحاولة مرة أخرى خلال لحظات.',
    502,
    'UPSTREAM_UNAVAILABLE'
  );
}

function isRetryableError(err: unknown): boolean {
  const status = Number((err as any)?.status || (err as any)?.statusCode || 0);
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 429) {
    return false;
  }
  if (status >= 500) return true;
  const msg = String((err as any)?.message || '').toUpperCase();
  if (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('QUOTA')
  ) {
    return false;
  }
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('TIMEOUT') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('NETWORK') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('UNAVAILABLE')
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

  const safeHistory = (input.history || [])
    .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
    .slice(-8);

  const contents = [
    ...safeHistory.map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text.trim().slice(0, 900) }],
    })),
    {
      role: 'user',
      parts: [{ text: input.message.trim().slice(0, 1200) }],
    },
  ];

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: OTLOBHA_ASSISTANT_MODEL,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new GeminiAssistantError(
          'لم يُرجع المساعد الذكي ردًا نصيًا لهذه الرسالة. يرجى المحاولة مرة أخرى.',
          502,
          'EMPTY_RESPONSE'
        );
      }

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
        model: OTLOBHA_ASSISTANT_MODEL,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 2 && isRetryableError(err)) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }
      throw classifyGeminiError(err);
    }
  }

  throw classifyGeminiError(lastErr);
}
