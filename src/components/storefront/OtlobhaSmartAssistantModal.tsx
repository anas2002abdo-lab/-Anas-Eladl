import React, { useState } from 'react';
import {
  Car,
  Package,
  Pill,
  Plus,
  Send,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { StorefrontProductCard } from '../../shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenProduct: (productId: string, orderedList?: StorefrontProductCard[]) => void;
  onAddProduct: (product: StorefrontProductCard) => void;
  onOpenService: (service: 'pharmacy' | 'rides' | 'parcels' | 'market' | 'free_order') => void;
}

interface AssistantMessage {
  role: 'assistant' | 'user';
  text: string;
  products?: StorefrontProductCard[];
}

export const OtlobhaSmartAssistantModal: React.FC<Props> = ({
  open,
  onClose,
  onOpenProduct,
  onAddProduct,
  onOpenService,
}) => {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: 'assistant',
      text: 'أهلاً بك في مساعد اطلبها الذكي! اكتب ما تبحث عنه (مثل: «أرخص نسكافيه» أو «مقاضي الفطار» أو «عروض اليوم») وسأقارن لك أسعار المتاجر فورًا.',
    },
  ]);

  if (!open) return null;

  const sendMessage = async (textToSend?: string) => {
    const msg = (textToSend ?? input).trim();
    if (!msg || busy) return;
    setMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setInput('');
    setBusy(true);
    try {
      const res = await api.askStorefrontAssistant(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.reply_ar,
          products: res.suggested_products || [],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'حدث خطأ مؤقت في المساعد. جرّب مرة أخرى الآن.' },
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
              <p className="text-[11px] text-white/80">مقارنة الأسعار الفورية + الوصول السريع لكل خدمات اطلبها</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Otlobha Services Launcher */}
        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex gap-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'free_order', label: 'طلب نصي حر', icon: Sparkles },
            { id: 'pharmacy', label: 'الصيدليات', icon: Pill },
            { id: 'rides', label: 'مشوار', icon: Car },
            { id: 'parcels', label: 'طرود أي حاجة', icon: Package },
            { id: 'market', label: 'سوق اطلبها', icon: ShoppingBag },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onClose();
                  onOpenService(s.id as any);
                }}
                className="px-3 py-1.5 rounded-xl bg-[#FEF2F2] text-[#A92224] hover:bg-[#A92224] hover:text-white text-xs font-extrabold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
              >
                <Icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex flex-col ${m.role === 'user' ? 'items-start' : 'items-end'}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed font-semibold ${
                  m.role === 'user'
                    ? 'bg-[#A92224] text-white'
                    : 'bg-white border border-slate-200 text-slate-800 shadow-xs'
                }`}
              >
                {m.text}
              </div>

              {m.products && m.products.length > 0 && (
                <div className="w-full grid grid-cols-2 gap-2 mt-2">
                  {m.products.slice(0, 4).map((p) => (
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
                        <div className="text-xs font-black text-[#A92224]">{p.effective_price} ج.م</div>
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

          {/* Suggested Quick Prompts */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {['أرخص العروض اليوم', 'ألبان وبيض', 'قهوة وشاي بأقل سعر', 'منظفات المنزل'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void sendMessage(q)}
                className="px-3 py-1.5 rounded-full bg-white border border-slate-200 hover:border-[#A92224] text-[11px] font-bold text-slate-700 cursor-pointer"
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
            placeholder="اسأل مساعد اطلبها عن أي منتج أو سعر..."
            className="flex-1 h-11 px-3.5 rounded-2xl bg-[#F6F7F9] border border-slate-200 focus:border-[#A92224] focus:bg-white focus:outline-none text-xs font-semibold"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="w-11 h-11 rounded-2xl bg-[#A92224] hover:bg-[#86191B] disabled:opacity-50 text-white flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
