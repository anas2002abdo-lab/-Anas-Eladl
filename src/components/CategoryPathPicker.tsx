import React, { useMemo, useState } from 'react';
import { ChevronLeft, FolderTree, PencilLine, ListTree } from 'lucide-react';
import type { CategoryRecord } from '../shared/types';

interface Props {
  categories: CategoryRecord[];
  valueCategoryId: string;
  valueCategoryPath: string;
  onChange: (next: { category_id: string; category_path: string; pickedCategory?: CategoryRecord | null }) => void;
  isAr?: boolean;
  label?: string;
  compact?: boolean;
}

export const CategoryPathPicker: React.FC<Props> = ({
  categories,
  valueCategoryId,
  valueCategoryPath,
  onChange,
  isAr = true,
  label,
  compact = false,
}) => {
  const [manualMode, setManualMode] = useState<boolean>(Boolean(valueCategoryPath && valueCategoryPath.trim()));

  const byId = useMemo(() => {
    const m = new Map<string, CategoryRecord>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const childrenMap = useMemo(() => {
    const m = new Map<string, CategoryRecord[]>();
    for (const c of categories) {
      const pid = c.parent_id && byId.has(c.parent_id) ? c.parent_id : '__root__';
      const arr = m.get(pid) || [];
      arr.push(c);
      m.set(pid, arr);
    }
    return m;
  }, [categories, byId]);

  // Build ancestor chain [rootId, sub1Id, ..., selectedId] from current valueCategoryId
  const selectedChain = useMemo(() => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur = valueCategoryId ? byId.get(valueCategoryId) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return chain;
  }, [valueCategoryId, byId]);

  // Build the levels to display: always level 0 (roots), plus next level if selected node has children
  const levelDropdowns = useMemo(() => {
    const levels: Array<{ level: number; parentId: string; options: CategoryRecord[]; selectedId: string }> = [];
    const roots = childrenMap.get('__root__') || [];
    levels.push({
      level: 0,
      parentId: '__root__',
      options: roots,
      selectedId: selectedChain[0] || '',
    });

    for (let i = 0; i < selectedChain.length; i++) {
      const currentId = selectedChain[i];
      const kids = childrenMap.get(currentId) || [];
      if (kids.length > 0) {
        levels.push({
          level: i + 1,
          parentId: currentId,
          options: kids,
          selectedId: selectedChain[i + 1] || '',
        });
      }
    }
    return levels;
  }, [childrenMap, selectedChain]);

  const activeCategory = valueCategoryId ? byId.get(valueCategoryId) || null : null;
  const liveExcelPath = useMemo(() => {
    if (manualMode && valueCategoryPath.trim()) {
      const trimmed = valueCategoryPath.trim();
      return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
    }
    if (!activeCategory) return '';
    return activeCategory.excel_path || activeCategory.full_path_ar || `${activeCategory.name_ar};`;
  }, [manualMode, valueCategoryPath, activeCategory]);

  const handleSelectAtLevel = (levelIdx: number, pickedId: string) => {
    if (!pickedId) {
      // Cleared a sub-level -> fall back to parent level
      const fallbackId = levelIdx > 0 ? selectedChain[levelIdx - 1] || '' : '';
      const fallbackCat = fallbackId ? byId.get(fallbackId) || null : null;
      onChange({ category_id: fallbackId, category_path: '', pickedCategory: fallbackCat });
      return;
    }
    const pickedCat = byId.get(pickedId) || null;
    onChange({ category_id: pickedId, category_path: '', pickedCategory: pickedCat });
  };

  const levelLabel = (lvl: number) => {
    if (lvl === 0) return isAr ? 'القسم الرئيسي' : 'Main Category';
    if (lvl === 1) return isAr ? 'القسم الفرعي الأول' : 'Subcategory 1';
    if (lvl === 2) return isAr ? 'القسم الفرعي الثاني (الأخير)' : 'Subcategory 2';
    return isAr ? `القسم الفرعي ${lvl}` : `Subcategory ${lvl}`;
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-slate-50/70 ${compact ? 'p-2.5 space-y-2' : 'p-3.5 space-y-2.5'}`}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <FolderTree className="w-4 h-4 text-[#A92224]" />
          <span>{label || (isAr ? 'مسار القسم للمنتج (رئيسي ← فرعي ← أخير)' : 'Product Category Path')}</span>
        </label>
        <button
          type="button"
          onClick={() => {
            const nextManual = !manualMode;
            setManualMode(nextManual);
            if (!nextManual) {
              onChange({ category_id: valueCategoryId, category_path: '', pickedCategory: activeCategory });
            } else if (!valueCategoryPath && liveExcelPath) {
              onChange({ category_id: valueCategoryId, category_path: liveExcelPath, pickedCategory: activeCategory });
            }
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 cursor-pointer transition"
        >
          {manualMode ? (
            <>
              <ListTree className="w-3.5 h-3.5" />
              <span>{isAr ? 'اختيار متدرّج من القوائم' : 'Step-by-step Picker'}</span>
            </>
          ) : (
            <>
              <PencilLine className="w-3.5 h-3.5" />
              <span>{isAr ? 'كتابة مسار جديد (مثل Excel)' : 'Type Excel Path'}</span>
            </>
          )}
        </button>
      </div>

      {manualMode ? (
        <div className="space-y-1.5">
          <input
            type="text"
            placeholder="سوبر ماركت > مخبوزات > كرواسون وكيك;"
            value={valueCategoryPath}
            onChange={(e) =>
              onChange({
                category_id: valueCategoryId,
                category_path: e.target.value,
                pickedCategory: activeCategory,
              })
            }
            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white font-semibold focus:border-[#A92224] focus:outline-none"
          />
          <p className="text-[11px] text-slate-500">
            {isAr
              ? 'اكتب المسار من القسم الرئيسي إلى آخر قسم فرعي مفصولًا بـ (>) — سيتم إنشاء أي قسم غير موجود تلقائيًا وربط المنتج بآخر فرع.'
              : 'Type Main > Sub > Leaf; — missing levels will be created automatically.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {levelDropdowns.map((lvl) => (
            <div key={`${lvl.level}-${lvl.parentId}`}>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">{levelLabel(lvl.level)}</label>
              <select
                value={lvl.selectedId}
                onChange={(e) => handleSelectAtLevel(lvl.level, e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:border-[#A92224] focus:outline-none"
              >
                <option value="">
                  {lvl.level === 0
                    ? isAr
                      ? '— اختر القسم الرئيسي —'
                      : '— Select Main Category —'
                    : isAr
                    ? '— اختياري (أو ابقِ في القسم السابق) —'
                    : '— Optional Subcategory —'}
                </option>
                {lvl.options.map((opt) => {
                  const subCount = (childrenMap.get(opt.id) || []).length;
                  return (
                    <option key={opt.id} value={opt.id}>
                      {opt.is_offers_section ? '⭐ ' : ''}
                      {opt.name_ar}
                      {subCount > 0 ? (isAr ? ` (${subCount} فرعي)` : ` (${subCount} sub)`) : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Live Path Breadcrumb Preview */}
      {liveExcelPath && (
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs">
          <span className="font-bold text-slate-500">{isAr ? 'مسار الصنف:' : 'Path:'}</span>
          {liveExcelPath
            .replace(/;\s*$/, '')
            .split('>')
            .map((seg) => seg.trim())
            .filter(Boolean)
            .map((seg, idx, arr) => (
              <React.Fragment key={`${seg}-${idx}`}>
                <span
                  className={`px-2 py-0.5 rounded-md font-bold ${
                    idx === arr.length - 1
                      ? 'bg-[#FEF2F2] text-[#A92224] border border-red-200'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {seg}
                </span>
                {idx < arr.length - 1 && <ChevronLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
              </React.Fragment>
            ))}
          <span className="text-[10px] text-slate-400 font-mono ms-auto" dir="rtl">
            {liveExcelPath}
          </span>
        </div>
      )}
    </div>
  );
};
