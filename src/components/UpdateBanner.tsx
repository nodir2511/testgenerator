import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const CHECK_MS = 3 * 60 * 1000;

async function fetchBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.id === 'string' ? j.id : null;
  } catch {
    return null;
  }
}

// Мини-уведомление: на сайте вышла новая версия — кнопка «Обновить» перезагружает страницу
export default function UpdateBanner() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (__BUILD_ID__ === 'dev') return;
    let stop = false;
    const check = async () => {
      const id = await fetchBuildId();
      if (!stop && id && id !== __BUILD_ID__) setOutdated(true);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const timer = window.setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    check();
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100vw-2rem)]" role="status">
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 rounded-full bg-slate-900 text-white shadow-lg px-4 py-2.5 text-sm font-medium hover:bg-slate-700 transition min-h-[40px]"
      >
        <RefreshCw className="w-4 h-4 shrink-0" />
        <span>Вышло обновление — нажмите, чтобы применить</span>
      </button>
    </div>
  );
}
