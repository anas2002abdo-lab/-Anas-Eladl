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
    <article className="bg-white rounded-[22px] border border-slate-200/75 shadow-[0_4px_18px_rgba(15,23,42,0.045)] hover:shadow-[0_12px_28px_rgba(15,23,42,0.09)] transition-all duration-200 flex flex-col overflow-hidden group">
      {/* Large, Crystal-Clear Square Product Showcase */}
      <div
        onClick={() => onOpenDetails(product.id)}
        className="relative aspect-square bg-[#F8FAFC] p-2.5 flex items-center justify-center cursor-pointer overflow-hidden"
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name_ar}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain group-hover:scale-[1.04] transition-transform duration-300"
          />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-[#FEF2F2] text-[#A92224]/70 flex items-center justify-center">
            <Package className="w-9 h-9" />
          </div>
        )}

        {/* Single disciplined top-right discount/offer indicator */}
        {discountPct > 0 ? (
          <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-xl bg-[#A92224] text-white text-[11px] font-extrabold shadow-sm tabular-nums">
            خصم {discountPct}%
          </div>
        ) : product.is_offer ? (
          <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-xl bg-[#F5A623] text-[#3B180E] text-[11px] font-extrabold shadow-sm">
            عرض
          </div>
        ) : null}

        {/* Floating Quick Add (+) or Quantity Stepper */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2.5 left-2.5 z-10"
        >
          {cartQty > 0 ? (
            <div className="flex items-center gap-1 bg-[#A92224] text-white rounded-full p-1 shadow-[0_6px_16px_rgba(169,34,36,0.3)]">
              <button
                type="button"
                onClick={() => onAdd(product)}
                aria-label="زيادة الكمية"
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              <span className="min-w-[22px] text-center text-xs font-black tabular-nums">{cartQty}</span>
              <button
                type="button"
                onClick={() => onDecrement(product.id)}
                aria-label="تقليل الكمية"
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAdd(product)}
              aria-label="إضافة سريعة للسلة"
              className="w-10 h-10 rounded-full bg-white border border-slate-200/90 text-[#A92224] hover:bg-[#A92224] hover:text-white hover:border-[#A92224] shadow-[0_6px_16px_rgba(15,23,42,0.12)] flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer"
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* Clean Editorial Metadata & Bold Price */}
      <div
        onClick={() => onOpenDetails(product.id)}
        className="p-3 flex-1 flex flex-col justify-between gap-2 cursor-pointer"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 truncate">
            <span className="text-[#A92224] font-bold truncate">
              {product.brand || product.category_name || 'اطلبها'}
            </span>
            {product.size_label && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-slate-500 truncate">{product.size_label}</span>
              </>
            )}
          </div>
          <h4 className="text-[13.5px] font-extrabold text-slate-900 leading-snug line-clamp-2 min-h-[2.4rem]">
            {product.name_ar}
          </h4>
        </div>

        <div className="space-y-1.5 pt-1">
          {/* Bold Tabular Price Row */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[16px] font-black text-slate-950 tabular-nums">
              {effPrice.toLocaleString('ar-EG')}
              <span className="text-[11px] font-bold text-slate-500 mr-1">ج.م</span>
            </span>
            {hasDiscount && (
              <span className="text-[11.5px] text-slate-400 line-through tabular-nums">
                {product.base_price.toLocaleString('ar-EG')}
              </span>
            )}
          </div>

          {/* Quiet Store Metadata Footer */}
          <div className="flex items-center justify-between gap-1.5 text-[11px] pt-1.5 border-t border-slate-100">
            <span className="text-slate-500 truncate flex items-center gap-1 font-medium">
              <Store className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="truncate">{product.merchant_name}</span>
            </span>
            {product.stores_count > 1 && (
              <span className="shrink-0 font-bold text-emerald-700 text-[10.5px] tabular-nums">
                {product.stores_count} متاجر
              </span>
            )}
          </div>

          {product.active_deal && (
            <div className="flex items-center gap-1 text-[10.5px] font-bold text-[#86191B] pt-0.5 truncate">
              <Gift className="w-3 h-3 text-[#D97706] shrink-0" />
              <span className="truncate">{product.active_deal.title_ar}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
