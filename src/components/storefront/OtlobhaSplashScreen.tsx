import React, { useEffect, useState } from 'react';

let hasShownWebColdSplash = false;

interface Props {
  onDone?: () => void;
}

/**
 * Animated cold-launch splash screen for Otlobha Customer App (Web).
 * Displays the official Otlobha logo (`/brand-assets/otlobha_logo.jpg`) with a smooth
 * scale + fade-in (~850ms), reveals «كل حاجة أقرب ليك», and cross-fades cleanly (~2.05s total).
 * Plays once per cold app launch; never re-triggers on navigation or tab focus return.
 */
export const OtlobhaSplashScreen: React.FC<Props> = ({ onDone }) => {
  const [visible, setVisible] = useState<boolean>(() => !hasShownWebColdSplash);
  const [phase, setPhase] = useState<'enter' | 'logo' | 'tagline' | 'exit'>(() =>
    hasShownWebColdSplash ? 'exit' : 'enter'
  );

  useEffect(() => {
    if (hasShownWebColdSplash) {
      setVisible(false);
      onDone?.();
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setPhase('tagline');
      const exitTimer = window.setTimeout(() => setPhase('exit'), 900);
      const doneTimer = window.setTimeout(() => {
        hasShownWebColdSplash = true;
        setVisible(false);
        onDone?.();
      }, 1200);
      return () => {
        window.clearTimeout(exitTimer);
        window.clearTimeout(doneTimer);
      };
    }

    const rafId = window.requestAnimationFrame(() => {
      setPhase('logo');
    });
    const taglineTimer = window.setTimeout(() => {
      setPhase('tagline');
    }, 680);
    const exitTimer = window.setTimeout(() => {
      setPhase('exit');
    }, 1780);
    const doneTimer = window.setTimeout(() => {
      hasShownWebColdSplash = true;
      setVisible(false);
      onDone?.();
    }, 2120);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(taglineTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  if (!visible) return null;

  const logoShown = phase === 'logo' || phase === 'tagline' || phase === 'exit';
  const taglineShown = phase === 'tagline' || phase === 'exit';
  const exiting = phase === 'exit';

  return (
    <div
      dir="rtl"
      role="status"
      aria-label="جاري فتح تطبيق اطلبها"
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-white transition-opacity duration-300 ease-in-out ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle bottom brand warmth; center stays pure white so official JPG logo blends seamlessly */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[28vh] bg-gradient-to-t from-[#A92224]/[0.05] via-[#F5A623]/[0.015] to-transparent"
      />

      <div className="relative flex flex-col items-center justify-center px-7 text-center select-none">
        <div
          className={`transition-all duration-700 ease-out will-change-transform ${
            logoShown ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.84]'
          }`}
        >
          <img
            src="/brand-assets/otlobha_logo.jpg"
            alt="شعار اطلبها"
            referrerPolicy="no-referrer"
            className="w-48 h-48 sm:w-56 sm:h-56 object-contain mx-auto"
          />
        </div>

        <div
          aria-hidden="true"
          className={`mt-2 h-[3px] w-11 rounded-full bg-gradient-to-l from-[#A92224] to-[#F5A623] transition-all duration-500 ease-out origin-center ${
            taglineShown ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
          }`}
        />

        <p
          className={`mt-3.5 text-lg sm:text-xl font-extrabold text-slate-800 tracking-tight transition-all duration-500 ease-out will-change-transform ${
            taglineShown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          كل حاجة أقرب ليك
        </p>
      </div>
    </div>
  );
};
