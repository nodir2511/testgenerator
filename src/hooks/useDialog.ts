import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Поведение окна или шторки: фокус переходит внутрь, Tab ходит по кругу внутри окна,
 * Escape закрывает, страница под окном не прокручивается, после закрытия фокус возвращается.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, active = true): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const prev = document.activeElement as HTMLElement | null;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    if (!el.contains(document.activeElement)) (items()[0] ?? el).focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      const cur = document.activeElement;
      if (!el.contains(cur)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
