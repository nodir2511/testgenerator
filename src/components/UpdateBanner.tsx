import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { reloadToNewVersion, shouldAutoReload, triedId } from '../lib/autoUpdate';

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

// Новая версия сайта: если она замечена сразу при открытии — страница обновляется сама;
// если во время работы — мини-уведомление с кнопкой (чтобы не потерять набранное)
export default function UpdateBanner() {
  const [outdated, setOutdated] = useState<string | null>(null);

  useEffect(() => {
    if (__BUILD_ID__ === 'dev') return;
    let stop = false;
    let firstCheck = true;
    const check = async () => {
      const first = firstCheck;
      firstCheck = false;
      const id = await fetchBuildId();
      if (stop || !id || id === __BUILD_ID__) return;
      if (shouldAutoReload({ firstCheck: first, newId: id, triedId: triedId() })) void reloadToNewVersion(id);
      else setOutdated(id);
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
        onClick={() => void reloadToNewVersion(outdated)}
        className="flex items-center gap-2 rounded-full bg-slate-900 border border-slate-700 text-white shadow-lg px-4 py-2.5 text-sm font-medium hover:bg-slate-700 transition min-h-[40px]"
      >
        <RefreshCw className="w-4 h-4 shrink-0" />
        <span>Вышло обновление — нажмите, чтобы применить</span>
      </button>
    </div>
  );
}
