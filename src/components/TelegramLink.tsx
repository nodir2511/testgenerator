import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, X, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;

export const TelegramLink: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: linked } = useQuery({
    queryKey: ['telegram_link', user?.id],
    enabled: Boolean(user?.id) && open,
    // пока ждём активацию в боте — проверяем привязку каждые 3 секунды
    refetchInterval: (q) => (code && q.state.data === false ? 3000 : false),
    queryFn: async () => {
      const { data } = await supabase.from('telegram_links').select('chat_id').eq('user_id', user!.id).maybeSingle();
      return Boolean(data);
    },
  });

  // Имя бота: из настроек сборки, а если не задано — спрашиваем у сервера (Telegram getMe)
  const { data: botName } = useQuery({
    queryKey: ['telegram_bot_name'],
    enabled: open && !BOT_USERNAME,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('send-to-telegram', { body: { action: 'bot' } });
      return (data?.username as string | undefined) ?? null;
    },
  });
  const botUsername = BOT_USERNAME || botName || undefined;

  const getCode = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('create_telegram_link_code');
    setBusy(false);
    if (err) setError(err.message);
    else setCode(data as string);
  };

  // Сразу при открытии: если аккаунт не привязан — готовим код и ссылку на бота
  useEffect(() => {
    if (open && linked === false && !code && !busy && !error) getCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linked]);

  useEffect(() => { if (!open) { setCode(null); setError(null); } }, [open]);
  useEffect(() => { if (linked && code) setCode(null); }, [linked, code]);

  const unlink = async () => {
    if (!confirm('Отвязать Telegram от этого аккаунта?')) return;
    await supabase.from('telegram_links').delete().eq('user_id', user!.id);
    queryClient.invalidateQueries({ queryKey: ['telegram_link'] });
  };

  const command = code ? `/start ${code}` : '';
  const deepLink = code && botUsername ? `https://t.me/${botUsername}?start=${code}` : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg transition"
        title="Telegram-бот"
      >
        <Send className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 flex items-center"><Send className="w-4 h-4 mr-2 text-blue-600" />Telegram-бот</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <p className="text-sm text-slate-600">
              Бот создаёт билеты с теми же настройками, что и сайт, и присылает файл Word прямо в чат.
            </p>

            <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${linked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              {linked ? '✅ Telegram привязан к вашему аккаунту' : 'Telegram пока не привязан'}
            </div>

            {!code && busy && !linked && (
              <div className="flex items-center text-sm text-slate-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Готовлю ссылку для активации…</div>
            )}

            {code ? (
              <div className="space-y-3">
                {deepLink && (
                  <>
                    <a
                      href={deepLink}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />Открыть бота и активировать
                    </a>
                    <p className="text-xs text-slate-500">
                      В Telegram нажмите <strong>«Start / Запустить»</strong> — аккаунт привяжется автоматически (ссылка действует 10 минут).
                    </p>
                    <p className="text-[11px] text-slate-400">Если ссылка не открылась — отправьте боту вручную:</p>
                  </>
                )}
                {!deepLink && (
                  <p className="text-xs text-slate-500">
                    {botUsername ? <>Откройте <strong>@{botUsername}</strong> и отправьте</> : 'Откройте бота и отправьте'} сообщение (код действует 10 минут):
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-100 rounded-lg px-3 py-2 text-sm font-mono">{command}</code>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
                    title="Копировать"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={getCode}
                disabled={busy}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-semibold flex items-center justify-center"
              >
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {linked ? 'Привязать другой чат' : 'Получить код привязки'}
              </button>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            {linked && (
              <button onClick={unlink} className="text-xs text-rose-600 hover:text-rose-800 font-medium">Отвязать Telegram</button>
            )}
          </div>
        </div>
      )}
    </>
  );
};
