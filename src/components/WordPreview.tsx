import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Предпросмотр «как в Word»: собирается тот же .docx, что и при скачивании, и рисуется библиотекой docx-preview и режется на листы A4 (`paginate`).
// Подгружается только при включении режима.

/** Режет единственную длинную страницу, которую рисует docx-preview, на листы A4: блок (вопрос — таблица целиком) на лист не влез — уходит на следующий, как в Word при «не разрывать строки таблицы». */
function paginate(host: HTMLElement): number {
  const first = host.querySelector<HTMLElement>('section.wp-docx');
  const article = first?.querySelector<HTMLElement>('article');
  if (!first || !article) return 1;
  const cs = getComputedStyle(first);
  const pageH = parseFloat(cs.minHeight) || 1122.5;
  const room = pageH - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  const blockH = (el: HTMLElement) => {
    const c = getComputedStyle(el);
    return el.offsetHeight + (parseFloat(c.marginTop) || 0) + (parseFloat(c.marginBottom) || 0);
  };
  const blocks = Array.from(article.children) as HTMLElement[];
  const heights = blocks.map(blockH); // все высоты — до переноса, пока страница одна
  let page = first;
  let target = article;
  let used = 0;
  let pages = 1;
  blocks.forEach((b, i) => {
    if (used > 0 && used + heights[i] > room) {
      const next = first.cloneNode(false) as HTMLElement;
      const art = article.cloneNode(false) as HTMLElement;
      next.appendChild(art);
      page.after(next);
      page = next; target = art; used = 0; pages++;
    }
    if (target !== article) target.appendChild(b);
    used += heights[i];
  });
  return pages;
}

export const WordPreview: React.FC<{
  ticket: { ticket_number: number; questions: Array<{ question_snapshot: any }> };
  title?: string;
  subjectName: string;
  isTg: boolean;
}> = ({ ticket, title, subjectName, isTg }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    let dead = false;
    setState('loading');
    (async () => {
      try {
        const [{ buildSingleTicketBlob }, { renderAsync }] = await Promise.all([import('../lib/docxExport'), import('docx-preview')]);
        const blob = await buildSingleTicketBlob(title || '', ticket, subjectName, isTg);
        if (dead || !hostRef.current || !styleRef.current) return;
        hostRef.current.replaceChildren();
        styleRef.current.replaceChildren();
        await renderAsync(blob, hostRef.current, styleRef.current, { className: 'wp-docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true });
        if (dead) return;
        setPages(paginate(hostRef.current));
        setState('ready');
      } catch (e) {
        console.error('Предпросмотр Word не построен', e);
        if (!dead) setState('error');
      }
    })();
    return () => { dead = true; };
  }, [ticket, title, subjectName, isTg]);

  // Страница A4 (≈ 794 px) сжимается под ширину панели
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const page = hostRef.current?.querySelector<HTMLElement>('section.wp-docx');
      const pageW = page ? page.offsetWidth : 794;
      setZoom(Math.min(1, Math.max(0.3, (box.clientWidth - 8) / (pageW + 60))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [state]);

  return (
    <div ref={boxRef} className="relative min-h-full bg-slate-200">
      {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-slate-600 gap-2 text-sm"><Loader2 className="w-5 h-5 animate-spin" /> Собираем Word…</div>}
      {state === 'error' && <div className="p-6 text-sm text-red-700">Не удалось построить предпросмотр Word. Скачайте файл и откройте его.</div>}
      {state === 'ready' && <div className="px-3 pt-2 text-xs text-slate-600">Листов: {pages} · разрывы приблизительные: в Word они могут сдвинуться на строку</div>}
      <div ref={styleRef} />
      <div ref={hostRef} className="wp-host" style={{ zoom, visibility: state === 'ready' ? 'visible' : 'hidden' }} />
    </div>
  );
};
