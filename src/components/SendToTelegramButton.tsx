import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, Loader2, Check, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notifyError } from '../lib/errors';
import type { ExportFile, ExportLanguage } from '../lib/docxExport';

const LANGS: Array<{ lang: ExportLanguage; label: string }> = [
  { lang: 'ru', label: 'Русский' },
  { lang: 'tg', label: 'Тоҷикӣ' },
  { lang: 'both', label: 'RU + TG' },
];
const LANG_CAPTION: Record<ExportLanguage, string> = { ru: 'RU', tg: 'TG', both: 'RU + TG' };

// Текст ошибки из ответа Edge Function ({ error: '...' })
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* тело не JSON */
    }
  }
  return (error as Error).message;
}

// Отправляет готовый файл в Telegram, привязанный к текущему аккаунту
export async function sendFileToTelegram(file: ExportFile, caption: string, batchId?: string) {
  const form = new FormData();
  form.append('file', file.blob, file.fileName);
  form.append('fileName', file.fileName);
  form.append('caption', caption);
  if (batchId) form.append('batchId', batchId);
  const { data, error } = await supabase.functions.invoke('send-to-telegram', { body: form });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
}

interface Props {
  build: (lang: ExportLanguage) => Promise<ExportFile | null>;
  title: string;
  batchId?: string;
  ticketCount?: number;
  compact?: boolean;
}

// Кнопка «В Telegram» с выбором языка: файл тот же, что при скачивании
export const SendToTelegramButton: React.FC<Props> = ({ build, title, batchId, ticketCount, compact }) => {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<ExportLanguage | null>(null);
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Меню рисуется поверх страницы (портал, fixed), чтобы его не обрезала карточка с overflow-hidden
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const menuH = LANGS.length * 32 + 12;
      const top = r.bottom + 4 + menuH > window.innerHeight ? Math.max(8, r.top - 4 - menuH) : r.bottom + 4;
      setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !menuRef.current?.contains(n)) setOpen(false);
    };
    const hide = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  const send = async (lang: ExportLanguage) => {
    setOpen(false);
    setSending(lang);
    try {
      const file = await build(lang);
      if (!file) return;
      const count = ticketCount ? `: ${ticketCount} шт.` : '';
      await sendFileToTelegram(file, `${title}${count} (${LANG_CAPTION[lang]})`, batchId);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      notifyError(err, 'Не удалось отправить в Telegram');
    } finally {
      setSending(null);
    }
  };

  const pad = compact ? 'px-2.5 py-1.5' : 'px-3 py-2';
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        disabled={Boolean(sending)}
        className={`${pad} bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1 transition disabled:opacity-60`}
        title="Отправить файл в ваш Telegram через бота (вместо скачивания)"
      >
        {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sent ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
        <span>{sending ? 'Отправка…' : sent ? 'Отправлено' : 'В Telegram'}</span>
        {!sending && !sent && <ChevronDown className="w-3 h-3 opacity-80" />}
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-[100] w-36 bg-white border border-slate-200 rounded-xl shadow-lg py-1"
        >
          {LANGS.map((l) => (
            <button
              key={l.lang}
              onClick={() => send(l.lang)}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-700"
            >
              {l.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};
