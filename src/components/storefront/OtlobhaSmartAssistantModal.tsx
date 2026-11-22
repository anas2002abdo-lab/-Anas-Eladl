import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Car,
  Loader2,
  Package,
  Pill,
  Plus,
  RotateCcw,
  Send,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { StorefrontProductCard } from '../../shared/types';

type AssistantServiceKey = 'pharmacy' | 'rides' | 'parcels' | 'market' | 'free_order';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenProduct: (productId: string, orderedList?: StorefrontProductCard[]) => void;
  onAddProduct: (product: StorefrontProductCard) => void;
  onOpenService: (service: AssistantServiceKey) => void;
}

interface AssistantMessage {
  role: 'assistant' | 'user';
  text: string;
  products?: StorefrontProductCard[];
  suggestedService?: AssistantServiceKey;
  isError?: boolean;
  retryPrompt?: string;
}

const SERVICE_META: Record<
  AssistantServiceKey,
  { label: string; cta: string; icon: React.ComponentType<any> }
> = {
  free_order: { label: 'طلب نصي حر', cta: 'افتح الطلب النصي الحر', icon: Sparkles },
  pharmacy: { label: 'الصيدليات', cta: 'افتح قسم الصيدليات', icon: Pill },
  rides: { label: 'مشوار', cta: 'احجز مشوار الآن', icon: Car },
  parcels: { label: 'طرود أي حاجة', cta: 'أرسل طرد الآن', icon: Package },
  market: { label: 'سوق اطلبها', cta: 'تصفّح سوق اطلبها', icon: ShoppingBag },
};

const DEFAULT_QUICK_PROMPTS = [
  'أرخص العروض اليوم',
  'مقاضي الفطار والألبان',
  'إزاي أطلب دواء من الصيدلية؟',
  'عايز أطلب طلب نصي حر',
];

export const OtlobhaSmartAssistantModal: React.FC<Props> = ({
  open,
  onClose,
  onOpenProduct,
  onAddProduct,
  onOpenService,
}) => {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickPrompts, setQuickPrompts] = useState<string[]>(DEFAULT_QUICK_PROMPTS);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: 'assistant',
      text: 'أهلاً بك في مساعد اطلبها الذكي! اسألني عن أي منتج، مقارنة أسعار، مقاضي طبخة، أو أي خدمة من خدمات اطلبها (صيدلية، مشوار، طرود، طلب نصي حر) وسأساعدك فورًا.',
    },
  ]);

  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = feedRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, busy, open]);

  if (!open) return null;

  const sendMessage = async (textToSend?: string, isRetry = false) => {
    const msg = (textToSend ?? input).trim();
    if (!msg || busy) return;

    const historySnapshot = messages
      .filter((m) => !m.isError)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));

    if (!isRetry) {
      setMessages((prev) => [...prev, { role: 'user', text: msg }]);
    } else {
      setMessages((prev) => prev.filter((m) => !m.isError));
    }
    setInput('');
    setBusy(true);

    try {
      const res = await api.askStorefrontAssistant(msg, historySnapshot);
      const replyText = String(res.reply_ar || '').trim();
      const validService =
        res.suggested_service && res.suggested_service in SERVICE_META
          ? (res.suggested_service as AssistantServiceKey)
          : undefined;

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: replyText || 'تمت معالجة طلبك بنجاح.',
          products: Array.isArray(res.suggested_products) ? res.suggested_products : [],
          suggestedService: validService,
        },
      ]);

      if (Array.isArray(res.quick_prompts) && res.quick_prompts.length > 0) {
        setQuickPrompts(res.quick_prompts.slice(0, 4));
      }
    } catch (err: any) {
      const errorMsg =
        typeof err?.message === 'string' && err.message.trim()
          ? err.message.trim()
          : 'تعذر الاتصال بالمساعد الذكي حاليًا. يرجى المحاولة مرة أخرى.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: errorMsg,
          isError: true,
          retryPrompt: msg,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4"
      dir="rtl"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#F6F7F9] rounded-t-[28px] sm:rounded-[28px] max-h-[88vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="bg-gradient-to-l from-[#A92224] to-[#86191B] text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#F5A623] text-[#3B180E] flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">مساعد اطلبها الذكي</h3>
              <p className="text-[11px] text-white/85">مقارنة الأسعار الفورية + الوصول السريع لكل خدمات اطلبها</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق المساعد الذكي"
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Otlobha Services Launcher */}
        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex gap-2 overflow-x-auto no-scrollbar">
          {(Object.keys(SERVICE_META) as AssistantServiceKey[]).map((key) => {
            const meta = SERVICE_META[key];
            const Icon = meta.icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onClose();
                  onOpenService(key);
                }}
                className="px-3 py-1.5 rounded-xl bg-[#FEF2F2] text-[#A92224] hover:bg-[#A92224] hover:text-white text-xs font-extrabold flex items-center gap-1.5 shrink-0 transition cursor-pointer whitespace-nowrap"
              >
                <Icon className="w-3.5 h-3.5" />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Messages Feed */}
        <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex flex-col ${m.role === 'user' ? 'items-start' : 'items-end'}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed font-semibold whitespace-pre-line ${
                  m.role === 'user'
                    ? 'bg-[#A92224] text-white'
                    : m.isError
                    ? 'bg-red-50 border border-red-200 text-red-900 shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-800 shadow-xs'
                }`}
              >
                {m.isError && (
                  <div className="flex items-center gap-1.5 text-red-700 font-black mb-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>تعذر إكمال الرد</span>
                  </div>
                )}
                <div>{m.text}</div>
                {m.isError && m.retryPrompt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void sendMessage(m.retryPrompt, true)}
                    className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#A92224] text-white text-[11px] font-extrabold hover:bg-[#86191B] cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>إعادة المحاولة</span>
                  </button>
                )}
              </div>

              {m.suggestedService && SERVICE_META[m.suggestedService] && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenService(m.suggestedService!);
                  }}
                  className="mt-2 px-3.5 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  {React.createElement(SERVICE_META[m.suggestedService].icon, { className: 'w-3.5 h-3.5' })}
                  <span>{SERVICE_META[m.suggestedService].cta}</span>
                </button>
              )}

              {m.products && m.products.length > 0 && (
                <div className="w-full grid grid-cols-2 gap-2 mt-2">
                  {m.products.slice(0, 6).map((p) => (
                    <div
                      key={p.id}
                      className="bg-white rounded-2xl border border-slate-200 p-2.5 flex flex-col justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenProduct(p.id, m.products);
                        }}
                        className="text-right space-y-1 cursor-pointer"
                      >
                        <div className="text-[11px] font-black text-slate-900 line-clamp-2">{p.name_ar}</div>
                        <div className="text-[10px] text-slate-500 truncate">{p.merchant_name}</div>
                        <div className="text-xs font-black text-[#A92224] tabular-nums">{p.effective_price} ج.م</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddProduct(p)}
                        className="w-full py-1.5 rounded-xl bg-[#FEF2F2] hover:bg-[#A92224] text-[#A92224] hover:text-white text-[11px] font-black flex items-center justify-center gap-1 transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> أضف للسلة
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Live Thinking Indicator */}
          {busy && (
            <div className="flex flex-col items-end">
              <div className="bg-white border border-slate-200 text-slate-700 rounded-2xl px-3.5 py-2.5 text-xs font-bold inline-flex items-center gap-2 shadow-xs">
                <Loader2 className="w-3.5 h-3.5 text-[#A92224] animate-spin" />
                <span>المساعد الذكي يجهز لك الرد...</span>
              </div>
            </div>
          )}

          {/* Contextual Suggested Quick Prompts */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quickPrompts.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => void sendMessage(q)}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-[#A92224] text-[11px] font-bold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Input Footer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="bg-white border-t border-slate-200 p-3 flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder="اسأل مساعد اطلبها عن أي منتج أو سعر أو خدمة..."
            className="flex-1 h-11 px-3.5 rounded-2xl bg-[#F6F7F9] border border-slate-200 focus:border-[#A92224] focus:bg-white focus:outline-none text-xs font-semibold disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="إرسال الرسالة"
            className="w-11 h-11 rounded-2xl bg-[#A92224] hover:bg-[#86191B] disabled:opacity-50 text-white flex items-center justify-center shrink-0 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};
