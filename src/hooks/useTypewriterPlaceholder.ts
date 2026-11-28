import { useEffect, useMemo, useRef, useState } from 'react';

export const OTLOBHA_SEARCH_PLACEHOLDERS: readonly string[] = [
  'قهوتك ناقصها حاجة حلوة؟ ابحث...',
  'جهّز لمة العيلة.. ابحث عن...',
  'نفسك في إيه انهاردة؟ ابحث...',
  'ابحث عن...',
];

const ARABIC_COMBINING_RE = /[\u064B-\u065F\u0670]/;

/**
 * Splits Arabic text into visual grapheme units so combining diacritics
 * (e.g. shadda in "جهّز") stay attached to their base letter while typing/deleting.
 */
function splitArabicGraphemes(text: string): string[] {
  const units: string[] = [];
  for (const ch of Array.from(text)) {
    if (ARABIC_COMBINING_RE.test(ch) && units.length > 0) {
      units[units.length - 1] += ch;
    } else {
      units.push(ch);
    }
  }
  return units;
}

export interface UseTypewriterPlaceholderOptions {
  phrases?: readonly string[];
  active?: boolean;
  typeSpeedMs?: number;
  deleteSpeedMs?: number;
  holdMs?: number;
  betweenPhrasesMs?: number;
  pausedText?: string;
}

export function useTypewriterPlaceholder(options: UseTypewriterPlaceholderOptions = {}) {
  const {
    phrases = OTLOBHA_SEARCH_PLACEHOLDERS,
    active = true,
    typeSpeedMs = 65,
    deleteSpeedMs = 30,
    holdMs = 1500,
    betweenPhrasesMs = 260,
    pausedText = 'ابحث عن...',
  } = options;

  const tokenizedPhrases = useMemo(
    () => phrases.map((p) => splitArabicGraphemes(p)).filter((units) => units.length > 0),
    [phrases]
  );

  const [displayText, setDisplayText] = useState<string>('');
  const [isHolding, setIsHolding] = useState<boolean>(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<{
    phraseIdx: number;
    charCount: number;
    mode: 'typing' | 'deleting';
  }>({
    phraseIdx: 0,
    charCount: 0,
    mode: 'typing',
  });

  useEffect(() => {
    const clearPending = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    clearPending();

    if (!active || tokenizedPhrases.length === 0) {
      stateRef.current = {
        phraseIdx: stateRef.current.phraseIdx % Math.max(tokenizedPhrases.length, 1),
        charCount: 0,
        mode: 'typing',
      };
      setIsHolding(false);
      setDisplayText('');
      return clearPending;
    }

    let cancelled = false;
    stateRef.current.charCount = 0;
    stateRef.current.mode = 'typing';
    setDisplayText('');
    setIsHolding(false);

    const scheduleStep = (delay: number) => {
      clearPending();
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        const st = stateRef.current;
        const units = tokenizedPhrases[st.phraseIdx % tokenizedPhrases.length];

        if (st.mode === 'typing') {
          const nextCount = st.charCount + 1;
          st.charCount = nextCount;
          setDisplayText(units.slice(0, nextCount).join(''));

          if (nextCount >= units.length) {
            st.mode = 'deleting';
            setIsHolding(true);
            scheduleStep(holdMs);
          } else {
            setIsHolding(false);
            scheduleStep(typeSpeedMs);
          }
        } else {
          setIsHolding(false);
          const nextCount = st.charCount - 1;
          st.charCount = Math.max(0, nextCount);
          setDisplayText(units.slice(0, st.charCount).join(''));

          if (st.charCount <= 0) {
            st.mode = 'typing';
            st.phraseIdx = (st.phraseIdx + 1) % tokenizedPhrases.length;
            scheduleStep(betweenPhrasesMs);
          } else {
            scheduleStep(deleteSpeedMs);
          }
        }
      }, delay);
    };

    scheduleStep(typeSpeedMs);

    return () => {
      cancelled = true;
      clearPending();
    };
  }, [active, tokenizedPhrases, typeSpeedMs, deleteSpeedMs, holdMs, betweenPhrasesMs]);

  return {
    text: active ? displayText : pausedText,
    isAnimating: active,
    isHolding: active && isHolding,
  };
}
