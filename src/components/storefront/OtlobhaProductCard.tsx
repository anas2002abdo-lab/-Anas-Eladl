import React from 'react';
import { Gift, Minus, Package, Plus, Store } from 'lucide-react';
import type { StorefrontProductCard } from '../../shared/types';

interface Props {
  product: StorefrontProductCard;
  cartQty: number;
  onOpenDetails: (productId: string) => void;
  onAdd: (product: StorefrontProductCard) => void;
  onDecrement: (productId: string) => void;
}

export const OtlobhaProductCard: React.FC<Props> = ({
  product,
  cartQty,
  onOpenDetails,
  onAdd,
  onDecrement,
}) => {
  const hasDiscount =
    product.sale_price !== null &&
    product.sale_price !== undefined &&
    product.sale_price < product.base_price;
  const effPrice = hasDiscount ? Number(product.sale_price) : Number(product.base_price);
  const discountPct =
    product.discount_percent > 0
      ? product.discount_percent
      : hasDiscount && product.base_price > 0
      ? Math.round(((product.base_price - effPrice) / product.base_price) * 100)
      : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_10px_rgba(15,23,42,0.04)] hover:shadow-[0_6px_20px_rgba(169,34,36,0.08)] transition-all duration-200 flex flex-col overflow-hidden group">
      {/* Product Image Area */}
      <div
        onClick={() => onOpenDetails(product.id)}
        className="relative aspect-square bg-[#F9FAFB] p-3 flex items-center justify-center cursor-pointer overflow-hidden"
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name_ar}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-200"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-[#FEF2F2] text-[#A92224]/70 flex items-center justify-center">
            <Package className="w-8 h-8" />
          </div>
        )}

        {/* Single disciplined top-right discount/offer ribbon */}
        {discountPct > 0 ? (
          <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg bg-[#A92224] text-white text-[10px] font-black shadow-sm">
            خصم {discountPct}%
          </div>
        ) : product.is_offer ? (
          <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg bg-[#F5A623] text-[#3B180E] text-[10px] font-black shadow-sm">
            عرض مميز
          </div>
        ) : null}

        {/* Floating Quick Add (+) or Stepper at bottom-left of image */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 left-2 z-10"
        >
          {cartQty > 0 ? (
            <div className="flex items-center gap-1 bg-[#A92224] text-white rounded-full px-1 py-1 shadow-md">
              <button
                type="button"
                onClick={() => onAdd(product)}
                aria-label="زيادة الكمية"
                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="min-w-[20px] text-center text-xs font-black tabular-nums">{cartQty}</span>
              <button
                type="button"
                onClick={() => onDecrement(product.id)}
                aria-label="تقليل الكمية"
                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAdd(product)}
              aria-label="إضافة سريعة للسلة"
              className="w-9 h-9 rounded-full bg-white border border-slate-200 text-[#A92224] hover:bg-[#A92224] hover:text-white hover:border-[#A92224] shadow-md flex items-center justify-center transition-colors cursor-pointer"
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* Product Metadata Area */}
      <div
        onClick={() => onOpenDetails(product.id)}
        className="p-2.5 flex-1 flex flex-col justify-between gap-1.5 cursor-pointer"
      >
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-bold text-[#A92224] truncate">
              {product.brand || product.category_name || 'اطلبها'}
            </span>
            {product.size_label && (
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md shrink-0">
                {product.size_label}
              </span>
            )}
          </div>
          <h4 className="text-[13px] font-extrabold text-slate-900 leading-snug line-clamp-2 min-h-[2.35rem]">
            {product.name_ar}
          </h4>
        </div>

        <div className="space-y-1 pt-1">
          {/* Price Row */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[15px] font-black text-slate-950 tabular-nums">
              {effPrice.toLocaleString('ar-EG')}
              <span className="text-[10px] font-bold text-slate-600 mr-0.5">ج.م</span>
            </span>
            {hasDiscount && (
              <span className="text-[11px] text-slate-400 line-through tabular-nums">
                {product.base_price.toLocaleString('ar-EG')}
              </span>
            )}
          </div>

          {/* Store / Multi-store Comparison Hint */}
          <div className="flex items-center justify-between gap-1 text-[10px] pt-0.5 border-t border-slate-100">
            <span className="text-slate-500 truncate flex items-center gap-1 font-semibold">
              <Store className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="truncate">{product.merchant_name}</span>
            </span>
            {product.stores_count > 1 && (
              <span className="shrink-0 font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                {product.stores_count} متاجر
              </span>
            )}
          </div>

          {/* Optional Active Savings Deal Hint */}
          {product.active_deal && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-[#86191B] bg-[#FFFBEB] border border-[#F5A623]/40 rounded-lg px-2 py-1 truncate">
              <Gift className="w-3 h-3 text-[#D97706] shrink-0" />
              <span className="truncate">{product.active_deal.title_ar}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
