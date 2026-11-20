import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { StorefrontProductDetailsResponse } from '../../shared/types';
import {
  ProductDetailCardContent,
  type ProductCardLocalState,
  type SwipeProductPreview,
} from './ProductDetailCardContent';

export type { SwipeProductPreview } from './ProductDetailCardContent';

interface Props {
  productId: string | null;
  productList?: SwipeProductPreview[];
  cartCount: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onActiveProductChange?: (productId: string) => void;
  onClose: () => void;
  onOpenCart: () => void;
  onOpenProduct: (productId: string, listHint?: SwipeProductPreview[]) => void;
  onSelectBrand: (brand: string) => void;
  onSelectStore: (merchantId: string, merchantName: string) => void;
  onAddToCart: (item: {
    id: string;
    merchant_id: string;
    merchant_name: string;
    name_ar: string;
    price: number;
    image_url: string;
    quantity: number;
    giftNote?: string;
  }) => void;
  onNotify: (msg: string) => void;
}

const FAV_KEY = 'otlobha_favorite_products_v1';

// Module-level session cache so reopening or swiping back to previously viewed products is instant (0ms)
const productDetailsCache = new Map<string, StorefrontProductDetailsResponse>();

export const OtlobhaProductDetailSheet: React.FC<Props> = ({
  productId,
  productList,
  cartCount,
  hasMore = false,
  onLoadMore,
  onActiveProductChange,
  onClose,
  onOpenCart,
  onOpenProduct,
  onSelectBrand,
  onSelectStore,
  onAddToCart,
  onNotify,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 390
  );

  // Per-session dynamic list additions when user taps a related/alternative item not in the current list
  const [extraPreviews, setExtraPreviews] = useState<SwipeProductPreview[]>([]);
  const [detailsMap, setDetailsMap] = useState<Record<string, StorefrontProductDetailsResponse>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const savedCardStatesRef = useRef<Record<string, ProductCardLocalState>>({});
  const lastLoadMoreLenRef = useRef<number>(0);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const [zoomModal, setZoomModal] = useState<{ url: string; title: string } | null>(null);

  // Drag / Swipe state
  const [dragX, setDragX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Build ordered deduplicated swipe list tied directly to the current product listing
  const resolvedList = useMemo<SwipeProductPreview[]>(() => {
    if (!productId) return [];
    const seen = new Set<string>();
    const out: SwipeProductPreview[] = [];

    const pushItem = (item: SwipeProductPreview) => {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      out.push(item);
    };

    if (productList && productList.length > 0) {
      for (const p of productList) pushItem(p);
    }
    for (const p of extraPreviews) pushItem(p);

    if (!seen.has(productId)) {
      const cached = productDetailsCache.get(productId);
      pushItem({
        id: productId,
        name_ar: cached?.product.name_ar || 'تفاصيل المنتج',
        brand: cached?.product.brand || undefined,
        size_label: cached?.product.size_label || undefined,
        image_url: cached?.product.image_url || undefined,
        base_price: cached?.product.base_price ?? 0,
        sale_price: cached?.product.sale_price ?? null,
        effective_price: cached?.product.effective_price ?? 0,
        merchant_id: cached?.product.merchant_id,
        merchant_name: cached?.product.merchant_name,
        is_available: cached?.product.is_available ?? true,
      });
    }
    return out;
  }, [productId, productList, extraPreviews]);

  const activeIndex = useMemo(() => {
    if (!productId || resolvedList.length === 0) return 0;
    const idx = resolvedList.findIndex((item) => item.id === productId);
    return idx >= 0 ? idx : 0;
  }, [productId, resolvedList]);

  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const resolvedListRef = useRef(resolvedList);
  resolvedListRef.current = resolvedList;

  // Reset session extras when modal closes completely
  useEffect(() => {
    if (!productId) {
      setExtraPreviews([]);
      setDragX(0);
      setIsDragging(false);
      setZoomModal(null);
      lastLoadMoreLenRef.current = 0;
    }
  }, [productId]);

  // Lock background page scroll while open without disturbing scroll position
  useEffect(() => {
    if (!productId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [productId]);

  // Responsive viewport measurement for card width & peek spacing
  useEffect(() => {
    if (!productId) return;
    const updateWidth = () => {
      const w = stageRef.current?.clientWidth || window.innerWidth;
      setViewportWidth(w);
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [productId]);

  // Responsive geometry: generous rounded center card + visible peeking edges on mobile & desktop
  const cardGap = viewportWidth < 640 ? 12 : 20;
  const cardWidth = useMemo(() => {
    if (viewportWidth < 640) {
      // ~85% width leaves ~7.5% visible peek on left & right sides (matching reference peek sheet)
      return Math.max(270, Math.round(viewportWidth * 0.85));
    }
    if (viewportWidth < 1024) {
      return Math.min(440, Math.round(viewportWidth * 0.72));
    }
    return 440;
  }, [viewportWidth]);

  const cardStep = cardWidth + cardGap;
  const cardStepRef = useRef(cardStep);
  cardStepRef.current = cardStep;

  // Fetch & cache details lazily for a specific product ID
  const fetchProductDetails = useCallback((id: string) => {
    if (!id) return;
    const cached = productDetailsCache.get(id);
    if (cached) {
      setDetailsMap((prev) => (prev[id] ? prev : { ...prev, [id]: cached }));
      return;
    }
    if (inFlightRef.current.has(id)) return;

    inFlightRef.current.add(id);
    setLoadingMap((prev) => ({ ...prev, [id]: true }));
    setErrorMap((prev) => ({ ...prev, [id]: null }));

    api
      .getStorefrontProductDetails(id)
      .then((res: StorefrontProductDetailsResponse) => {
        productDetailsCache.set(id, res);
        setDetailsMap((prev) => ({ ...prev, [id]: res }));
      })
      .catch((e) => {
        setErrorMap((prev) => ({
          ...prev,
          [id]: (e as Error).message || 'تعذر تحميل تفاصيل المنتج',
        }));
      })
      .finally(() => {
        inFlightRef.current.delete(id);
        setLoadingMap((prev) => ({ ...prev, [id]: false }));
      });
  }, []);

  // Lazy load active product + prefetch immediate neighbors (activeIndex - 1, activeIndex + 1)
  useEffect(() => {
    if (!productId || resolvedList.length === 0) return;

    const currentItem = resolvedList[activeIndex];
    const nextItem = resolvedList[activeIndex + 1];
    const prevItem = resolvedList[activeIndex - 1];

    if (currentItem) fetchProductDetails(currentItem.id);
    if (nextItem) {
      fetchProductDetails(nextItem.id);
      if (nextItem.image_url) {
        const img = new Image();
        img.src = nextItem.image_url;
      }
    }
    if (prevItem) {
      fetchProductDetails(prevItem.id);
      if (prevItem.image_url) {
        const img = new Image();
        img.src = prevItem.image_url;
      }
    }

    // Auto-load next page seamlessly when customer swipes near the end of a paginated list
    if (
      hasMore &&
      onLoadMore &&
      activeIndex >= resolvedList.length - 3 &&
      lastLoadMoreLenRef.current !== resolvedList.length
    ) {
      lastLoadMoreLenRef.current = resolvedList.length;
      onLoadMore();
    }
  }, [productId, activeIndex, resolvedList, fetchProductDetails, hasMore, onLoadMore]);

  // Navigate cleanly to a target index in resolvedList
  const goToIndex = useCallback(
    (nextIdx: number) => {
      const list = resolvedListRef.current;
      if (list.length === 0) return;
      const clamped = Math.max(0, Math.min(list.length - 1, nextIdx));
      const target = list[clamped];
      if (!target) return;
      if (onActiveProductChange) {
        onActiveProductChange(target.id);
      } else {
        onOpenProduct(target.id);
      }
    },
    [onActiveProductChange, onOpenProduct]
  );

  // Handle opening an alternative / complementary product from inside a card
  const handleOpenRelatedProduct = useCallback(
    (targetId: string, listHint?: SwipeProductPreview[]) => {
      const existingIdx = resolvedListRef.current.findIndex((p) => p.id === targetId);
      if (existingIdx >= 0) {
        goToIndex(existingIdx);
        return;
      }
      if (listHint && listHint.length > 0) {
        setExtraPreviews((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const additions = listHint.filter((x) => !seen.has(x.id));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
      }
      if (onActiveProductChange) {
        onActiveProductChange(targetId);
      } else {
        onOpenProduct(targetId, listHint);
      }
    },
    [goToIndex, onActiveProductChange, onOpenProduct]
  );

  // Keyboard navigation (RTL: ArrowLeft -> Next on left, ArrowRight -> Prev on right, Escape -> Close)
  useEffect(() => {
    if (!productId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (zoomModal) {
        if (e.key === 'Escape') setZoomModal(null);
        return;
      }
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        if (activeIndexRef.current < resolvedListRef.current.length - 1) {
          e.preventDefault();
          goToIndex(activeIndexRef.current + 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (activeIndexRef.current > 0) {
          e.preventDefault();
          goToIndex(activeIndexRef.current - 1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [productId, zoomModal, onClose, goToIndex]);

  // Native Touch & Desktop Mouse Drag Engine with strict horizontal/vertical axis locking
  useEffect(() => {
    const stage = stageRef.current;
    if (!productId || !stage) return;

    let activeTouchId: number | null = null;
    let mouseDragging = false;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lastRawDx = 0;
    let directionLock: 'none' | 'horizontal' | 'vertical' = 'none';
    let ignored = false;

    const isInsideIgnoredTarget = (target: EventTarget | null, isMouse: boolean): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest('[data-horizontal-scroll="true"]')) return true;
      if (target.closest('input, textarea, select')) return true;
      if (isMouse && target.closest('button, a')) return true;
      return false;
    };

    const computeRubberBandDx = (rawDx: number): number => {
      const idx = activeIndexRef.current;
      const total = resolvedListRef.current.length;
      const step = cardStepRef.current;
      if (total <= 1) return rawDx * 0.22;
      // RTL: rawDx > 0 pulls Next (left) into center; rawDx < 0 pulls Prev (right) into center
      if (idx === 0 && rawDx < 0) return rawDx * 0.28;
      if (idx === total - 1 && rawDx > 0) return rawDx * 0.28;
      return Math.max(-step * 1.08, Math.min(step * 1.08, rawDx));
    };

    const finishSwipe = () => {
      if (directionLock === 'horizontal') {
        const elapsed = Math.max(16, performance.now() - startTime);
        const velocity = Math.abs(lastRawDx) / elapsed; // px per ms
        const step = cardStepRef.current;
        const idx = activeIndexRef.current;
        const total = resolvedListRef.current.length;

        const crossedThreshold =
          Math.abs(lastRawDx) >= step * 0.22 || (Math.abs(lastRawDx) >= 34 && velocity >= 0.35);

        if (crossedThreshold && total > 1) {
          if (lastRawDx > 0 && idx < total - 1) {
            goToIndex(idx + 1);
          } else if (lastRawDx < 0 && idx > 0) {
            goToIndex(idx - 1);
          }
        }
      }
      activeTouchId = null;
      mouseDragging = false;
      directionLock = 'none';
      ignored = false;
      lastRawDx = 0;
      setIsDragging(false);
      setDragX(0);
    };

    // --- TOUCH LISTENERS (non-passive move for conflict-free vertical scroll vs horizontal swipe) ---
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (isInsideIgnoredTarget(e.target, false)) {
        ignored = true;
        return;
      }
      const t = e.touches[0];
      activeTouchId = t.identifier;
      startX = t.clientX;
      startY = t.clientY;
      startTime = performance.now();
      lastRawDx = 0;
      directionLock = 'none';
      ignored = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (ignored || activeTouchId === null) return;
      let t: Touch | undefined;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === activeTouchId) {
          t = e.touches[i];
          break;
        }
      }
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (directionLock === 'none') {
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.15) {
          directionLock = 'horizontal';
          setIsDragging(true);
        } else {
          directionLock = 'vertical';
          return;
        }
      }

      if (directionLock === 'horizontal') {
        if (e.cancelable) e.preventDefault();
        lastRawDx = dx;
        setDragX(computeRubberBandDx(dx));
      }
    };

    const onTouchEnd = () => {
      if (activeTouchId === null) return;
      finishSwipe();
    };

    // --- DESKTOP MOUSE DRAG LISTENERS ---
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isInsideIgnoredTarget(e.target, true)) return;
      mouseDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startTime = performance.now();
      lastRawDx = 0;
      directionLock = 'none';
      ignored = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (directionLock === 'none') {
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.1) {
          directionLock = 'horizontal';
          setIsDragging(true);
        } else {
          directionLock = 'vertical';
          mouseDragging = false;
          return;
        }
      }

      if (directionLock === 'horizontal') {
        e.preventDefault();
        lastRawDx = dx;
        setDragX(computeRubberBandDx(dx));
      }
    };

    const onMouseUp = () => {
      if (!mouseDragging) return;
      finishSwipe();
    };

    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd, { passive: true });
    stage.addEventListener('touchcancel', onTouchEnd, { passive: true });
    stage.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchEnd);
      stage.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [productId, goToIndex]);

  const handleToggleFavorite = useCallback(
    (pid: string) => {
      setFavorites((prev) => {
        const exists = prev.includes(pid);
        const next = exists ? prev.filter((id) => id !== pid) : [...prev, pid];
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify(next));
        } catch {
          // ignore storage quota errors
        }
        onNotify(exists ? 'تمت إزالة المنتج من المفضلة' : 'تمت إضافة المنتج إلى المفضلة ❤️');
        return next;
      });
    },
    [onNotify]
  );

  const handleSaveCardState = useCallback((pid: string, next: ProductCardLocalState) => {
    savedCardStatesRef.current[pid] = next;
  }, []);

  const handleZoomImage = useCallback((url: string, title: string) => {
    setZoomModal({ url, title });
  }, []);

  if (!productId || resolvedList.length === 0) return null;

  const total = resolvedList.length;
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < total - 1;

  // Windowed rendering: mount ONLY cards within [-2, +2] of activeIndex so even 500+ products stay 60fps
  const windowStart = Math.max(0, activeIndex - 2);
  const windowEnd = Math.min(total - 1, activeIndex + 2);
  const visibleSlice: Array<{ item: SwipeProductPreview; index: number }> = [];
  for (let i = windowStart; i <= windowEnd; i++) {
    visibleSlice.push({ item: resolvedList[i], index: i });
  }

  // Sliding dot window (max 7 dots so indicator stays ultra clean for large lists)
  const maxDots = 7;
  const halfDots = Math.floor(maxDots / 2);
  let dotStart = Math.max(0, activeIndex - halfDots);
  const dotEnd = Math.min(total - 1, dotStart + maxDots - 1);
  dotStart = Math.max(0, dotEnd - maxDots + 1);
  const dotIndices: number[] = [];
  for (let d = dotStart; d <= dotEnd; d++) dotIndices.push(d);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Normalized drag progress (-1..1) for smooth live scale & opacity interpolation during swipe
  const dragProgress = Math.max(-1, Math.min(1, dragX / Math.max(1, cardStep)));

  return (
    <div
      className="fixed inset-0 z-[55] bg-slate-950/60 backdrop-blur-[2px] flex flex-col items-center justify-center overflow-hidden"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل المنتج والتنقل السريع"
      onClick={onClose}
    >
      {/* Top Pager Position Bar (above cards, Otlobha Crimson & Gold accents) */}
      {total > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full px-4 pt-3 pb-1.5 flex items-center justify-center shrink-0 z-20"
        >
          <div
            style={{ width: cardWidth }}
            className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-2xl bg-slate-950/55 border border-white/15 backdrop-blur-md text-white"
          >
            <span className="text-[11px] font-black tabular-nums tracking-tight whitespace-nowrap">
              {activeIndex + 1} <span className="text-white/55">/ {total}</span>
            </span>

            {/* Sliding Pager Dots */}
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {dotIndices.map((dotIdx) => {
                const isDotActive = dotIdx === activeIndex;
                return (
                  <button
                    key={dotIdx}
                    type="button"
                    tabIndex={-1}
                    onClick={() => goToIndex(dotIdx)}
                    className={`h-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                      isDotActive
                        ? 'w-5 bg-[#F5A623]'
                        : 'w-1.5 bg-white/40 hover:bg-white/70'
                    }`}
                  />
                );
              })}
            </div>

            <span className="text-[10px] font-bold text-white/80 whitespace-nowrap flex items-center gap-0.5">
              <ChevronRight className="w-3 h-3 text-[#F5A623]" />
              <span>اسحب للتنقل</span>
              <ChevronLeft className="w-3 h-3 text-[#F5A623]" />
            </span>
          </div>
        </div>
      )}

      {/* Horizontal Swipe Pager Stage */}
      <div
        ref={stageRef}
        onClick={(e) => {
          // Clicking dimmed empty area around cards closes the modal
          if (e.target === e.currentTarget) onClose();
        }}
        className="relative w-full flex-1 min-h-0 flex items-center justify-center overflow-hidden py-2 sm:py-4"
      >
        {/* Desktop Floating Navigation Arrows (RTL: Right = Previous, Left = Next) */}
        {total > 1 && canGoPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToIndex(activeIndex - 1);
            }}
            aria-label="المنتج السابق"
            style={{ right: `calc(50% - ${Math.round(cardWidth / 2)}px - 58px)` }}
            className="hidden md:flex absolute top-1/2 -translate-y-1/2 z-40 w-11 h-11 rounded-full bg-white/95 hover:bg-[#A92224] text-slate-800 hover:text-white shadow-xl border border-white/60 items-center justify-center transition cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {total > 1 && canGoNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToIndex(activeIndex + 1);
            }}
            aria-label="المنتج التالي"
            style={{ left: `calc(50% - ${Math.round(cardWidth / 2)}px - 58px)` }}
            className="hidden md:flex absolute top-1/2 -translate-y-1/2 z-40 w-11 h-11 rounded-full bg-white/95 hover:bg-[#A92224] text-slate-800 hover:text-white shadow-xl border border-white/60 items-center justify-center transition cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Windowed Cards Track — keyed strictly by item.id for zero flicker & preserved DOM */}
        {visibleSlice.map(({ item, index }) => {
          const rel = index - activeIndex; // 0 = center, +1 = Next (LEFT in RTL), -1 = Prev (RIGHT in RTL)
          const translateX = -rel * cardStep + dragX;
          const distFromCenter = Math.min(1.5, Math.abs(rel - dragProgress));
          const scale = 1 - Math.min(1, distFromCenter) * 0.055;
          const opacity = 1 - Math.min(1, distFromCenter) * 0.16;
          const isCardActive = index === activeIndex;

          return (
            <div
              key={item.id}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: cardWidth,
                transform: `translate3d(${translateX}px, 0, 0) scale(${scale})`,
                opacity,
                zIndex: isCardActive ? 20 : 10 - Math.abs(rel),
                transition:
                  isDragging || prefersReducedMotion
                    ? 'none'
                    : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease',
                willChange: 'transform, opacity',
              }}
              className="absolute inset-y-2 sm:inset-y-4 my-auto h-[calc(100%-16px)] sm:h-[calc(100%-32px)] max-h-[800px]"
            >
              <ProductDetailCardContent
                productId={item.id}
                preview={item}
                details={detailsMap[item.id] || productDetailsCache.get(item.id)}
                loading={Boolean(loadingMap[item.id])}
                error={errorMap[item.id]}
                isActive={isCardActive}
                isFavorite={favorites.includes(item.id)}
                cartCount={cartCount}
                savedState={savedCardStatesRef.current[item.id]}
                onSaveState={handleSaveCardState}
                onToggleFavorite={handleToggleFavorite}
                onClose={onClose}
                onOpenCart={onOpenCart}
                onOpenProduct={handleOpenRelatedProduct}
                onSelectBrand={onSelectBrand}
                onSelectStore={onSelectStore}
                onAddToCart={onAddToCart}
                onNotify={onNotify}
                onZoomImage={handleZoomImage}
                onSelectCard={!isCardActive ? () => goToIndex(index) : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* FULLSCREEN IMAGE ZOOM LIGHTBOX */}
      {zoomModal && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setZoomModal(null);
          }}
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setZoomModal(null)}
            aria-label="إغلاق التكبير"
            className="absolute top-4 left-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={zoomModal.url}
            alt={zoomModal.title}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[85vh] object-contain rounded-2xl bg-white p-4"
          />
        </div>
      )}
    </div>
  );
};
