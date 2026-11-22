import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const OTLOBHA_ASSISTANT_MODEL = 'gemini-4-hydrogen';

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
      'تم تجاوز الحد المسموح لطلبات المساعد الذكي حاليًا. يرجى المحاولة بعد قليل أو الترقية لباقة أعلى.',
      429,
      'RESOURCE_EXHAUSTED'
    );
  }

  if (status === 404 || upper.includes('NOT_FOUND') || upper.includes('IS NOT FOUND')) {
    return new GeminiAssistantError(
      'نموذج الذكاء الاصطناعي المطلوب غير متاح حاليًا على الخادم. يرجى مراجعة إعدادات النموذج.',
      502,
      'MODEL_NOT_FOUND'
    );
  }

  if (status === 400 || upper.includes('INVALID_ARGUMENT')) {
    return new GeminiAssistantError(
      'تعذر معالجة صيغة الطلب لدى خدمة الذكاء الاصطناعي. حاول صياغة سؤالك بشكل أوضح.',
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
  if (status === 400 || status === 401 || status === 403 || status === 404) return false;
  if (status === 429 || status >= 500) return true;
  const msg = String((err as any)?.message || '').toUpperCase();
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('NOT_FOUND')) {
    return false;
  }
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
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

export async function runOtlobhaGeminiAssistant(
  input: AssistantRunInput
): Promise<AssistantRunOutput> {
  const ai = getGeminiClient();

  const catalogBlock =
    input.catalogProducts.length > 0
      ? input.catalogProducts
          .slice(0, 20)
          .map(
            (p) =>
              `- id:${p.id} | ${p.name_ar}${p.size_label ? ` (${p.size_label})` : ''}${p.brand ? ` [${p.brand}]` : ''} | السعر: ${p.effective_price} ج.م${p.is_offer ? ' (عرض)' : ''} | المتجر: ${p.merchant_name || 'اطلبها'}${p.category_name ? ` | القسم: ${p.category_name}` : ''}`
          )
          .join('\n')
      : 'لا توجد منتجات مسجلة مطابقة مباشرة في الكتالوج الآن (يمكن للعميل استخدام خدمة «الطلب النصي الحر» لطلب أي منتج من أي محل في المنزلة).';

  const categoriesBlock =
    input.categoryNames.length > 0
      ? input.categoryNames.slice(0, 30).join('، ')
      : 'المقاضي والمواد الغذائية، المنتجات الطازجة، المشروبات، المنظفات، الصيدلية';

  const merchantsBlock =
    input.merchantNames.length > 0
      ? input.merchantNames.slice(0, 20).join('، ')
      : 'متاجر وصيدليات المنزلة';

  const systemInstruction = [
    'أنت «مساعد اطلبها الذكي» لتطبيق «اطلبها – Otlobha» في مدينة المنزلة – الدقهلية، مصر.',
    'شخصيتك: ودود، عملي، سريع الفهم، تتحدث باللهجة المصرية الراقية المفهومة أو العربية السلسة حسب أسلوب المستخدم، وترد بإجابات واضحة ومفيدة ومباشرة (من 2 إلى 5 جمل قصيرة منظمة).',
    'خدمات منصة اطلبها المتاحة للعميل:',
    '1. متجر اطلبها والمتاجر والمقاضي (مقارنة أسعار بين المتاجر وإضافة مباشرة للسلة).',
    '2. الطلب النصي الحر (free_order): يكتب العميل أي طلب أو قائمة مقاضي غير موجودة بالكتالوج والطيار يشتريها ويوصلها له.',
    '3. الصيدليات (pharmacy): طلب أدوية أو رفع صورة الروشتة.',
    '4. اطلبها مشوار (rides): حجز مشوار سريع داخل المنزلة والمناطق المجاورة.',
    '5. طرود أي حاجة (parcels): إرسال أو استلام أي طرد أو أمانة عبر طيار.',
    '6. سوق اطلبها (market): شراء وبيع منتجات محلية متنوعة.',
    '',
    'قواعد مهمة جدًا:',
    '- افهم رسالة المستخدم الحقيقية وجاوب عليها مباشرة بذكاء (سواء كانت تحية، سؤال عن وصفات/مكونات طبخة، مقارنة أسعار، استفسار عن خدمة، أو البحث عن منتج).',
    '- لا تخترع أبدًا أسعارًا أو منتجات غير موجودة في «المنتجات المتاحة في الكتالوج» أدناه. إذا ذكرت منتجًا من الكتالوج، التزم بسعره واسمه الحقيقي وأضف معرّفه (id) داخل suggested_product_ids.',
    '- إذا لم توجد منتجات مطابقة في الكتالوج للمطلوب، أجب المستخدم بإفادة كاملة (مثلاً اذكر له المكونات أو النصيحة أو الطريقة) واقترح عليه بلطف استخدام «الطلب النصي الحر» لتوصيل ما يريده فورًا مع تعيين suggested_service إلى "free_order" عند الحاجة.',
    '- إذا كان سؤال المستخدم يخص دواء أو صيدلية عيّن suggested_service إلى "pharmacy"، وللمشاوير "rides"، وللطرود "parcels"، وللسوق "market"، وإلا اتركها "".',
    '- ضع في search_keywords كلمات مفتاحية قصيرة (1-4 كلمات عربية أو إنجليزية) تساعد الخادم في البحث داخل الكتالوج لو كان المستخدم يطلب منتجات.',
    '- ضع في quick_prompts من 3 إلى 4 اقتراحات قصيرة وذكية لأسئلة المتابعة المناسبة للمحادثة.',
    '',
    `الأقسام المتاحة في التطبيق: ${categoriesBlock}`,
    `المتاجر المسجلة: ${merchantsBlock}`,
    'المنتجات المتاحة في الكتالوج حاليًا (ذات الصلة):',
    catalogBlock,
  ].join('\n');

  const safeHistory = (input.history || [])
    .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
    .slice(-10);

  const contents = [
    ...safeHistory.map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text.trim().slice(0, 1200) }],
    })),
    {
      role: 'user',
      parts: [{ text: input.message.trim().slice(0, 1500) }],
    },
  ];

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: OTLOBHA_ASSISTANT_MODEL,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
                description: 'كلمات بحث قصيرة للبحث عن منتجات مناسبة في الكتالوج (إن وجدت).',
              },
              suggested_product_ids: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'معرّفات المنتجات الحقيقية من قائمة الكتالوج المقدمة فقط.',
              },
              suggested_service: {
                type: Type.STRING,
                description: 'خدمة مقترحة إن كانت مناسبة: pharmacy أو rides أو parcels أو market أو free_order أو نص فارغ.',
              },
              quick_prompts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 إلى 4 اقتراحات قصيرة لأسئلة متابعة باللغة العربية.',
              },
            },
            required: ['reply_ar', 'quick_prompts'],
          },
        },
      });

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
        suggested_service: (ALLOWED_SERVICES.has(rawService) ? rawService : '') as AssistantRunOutput['suggested_service'],
        quick_prompts:
          quickPrompts.length > 0
            ? quickPrompts
            : ['أرخص العروض اليوم', 'مقاضي الفطار والألبان', 'اطلب من الصيدلية', 'طلب نصي حر'],
        model: OTLOBHA_ASSISTANT_MODEL,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 3 && isRetryableError(err)) {
        const delayMs = attempt * 600;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw classifyGeminiError(err);
    }
  }

  throw classifyGeminiError(lastErr);
}
