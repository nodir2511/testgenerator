import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

/** Значок «?» с пояснением. Открывается нажатием (работает и на телефоне), закрывается Esc, кликом снаружи и прокруткой */
export function Hint({ children, label = 'Пояснение' }: { children: ReactNode; label?: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: Event) => { if (!btn.current?.parentElement?.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const w = Math.min(288, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)), top: r.bottom + 6 });
  };

  return (
    <span className="inline-flex align-middle">
      <button
        ref={btn}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-slate-500 hover:text-primary hover:bg-primary-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && pos && (
        <span
          role="note"
          style={{ left: pos.left, top: pos.top, width: Math.min(288, window.innerWidth - 16) }}
          className="fixed z-[90] rounded-xl bg-slate-900 text-white text-sm font-normal normal-case tracking-normal leading-relaxed p-3 shadow-xl"
        >
          {children}
        </span>
      )}
    </span>
  );
}
