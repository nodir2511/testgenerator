import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Rocket, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { EXAM_LINKS_KEY, fetchExamLinks, type ExamLinkRow } from '../lib/examLinks';
import { linkState, summaryText } from '../lib/examView';
import { Badge, Button, Card, EmptyState, PageHeader, SkeletonList } from './ui';
import { LaunchDialog } from './exams/LaunchDialog';
import { ExamBoard } from './exams/ExamBoard';

/** Набор, выбранный ссылкой #exams/<id> (кнопка «Запустить классу» в архиве и генераторе) */
const batchFromHash = (): string | null => {
  const m = window.location.hash.match(/^#exams\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const ExamsView: React.FC = () => {
  const { isOwner } = useAuth();
  const [launchFor, setLaunchFor] = useState<{ batchId: string | null } | null>(() => {
    const id = batchFromHash();
    return id ? { batchId: id } : null;
  });
  const [openCode, setOpenCode] = useState<string | null>(null);

  // Адрес с набором — одноразовый: после открытия окна возвращаем чистый #exams, иначе обновление страницы снова откроет окно
  useEffect(() => {
    if (batchFromHash()) window.history.replaceState(null, '', '#exams');
    const onPop = () => {
      const id = batchFromHash();
      if (id) { setLaunchFor({ batchId: id }); window.history.replaceState(null, '', '#exams'); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { data: links = [], isLoading } = useQuery({
    queryKey: [...EXAM_LINKS_KEY, isOwner],
    queryFn: () => fetchExamLinks(isOwner),
    // пока есть открытые запуски, цифры «сдали / идут» обновляются сами
    refetchInterval: (q) => ((q.state.data as ExamLinkRow[] | undefined)?.some((l) => linkState(l, Date.now()) === 'open') ? 10_000 : false),
    meta: { action: 'Не удалось загрузить запуски' },
  });

  const now = Date.now();
  const launchBtn = <Button variant="primary" icon={Rocket} onClick={() => setLaunchFor({ batchId: null })}>Запустить классу</Button>;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Users}
        title="Билеты классу"
        description="Запустите набор билетов, и ученики пройдут их в Telegram. Результаты появятся здесь."
        actions={launchBtn}
      />

      {isLoading ? <SkeletonList /> : links.length === 0 ? (
        <Card>
          <EmptyState
            icon={Rocket}
            title="Запусков пока нет"
            description="Выберите свой набор билетов и нажмите «Запустить классу»: вы получите ссылку и QR-код. Ученики откроют их в Telegram, введут имя и пройдут свой билет, а оценки появятся в таблице."
            action={launchBtn}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {links.map((l) => {
            const state = linkState(l, now);
            const expanded = openCode === l.code;
            return (
              <Card key={l.code} padding="none">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpenCode(expanded ? null : l.code)}
                  className="w-full min-h-[64px] px-4 py-3 flex items-center gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 truncate">{l.batch?.title ?? 'Набор удалён'}</div>
                    <div className="text-sm text-slate-600 flex flex-wrap gap-x-3">
                      {l.batch?.subject?.name && <span>{l.batch.subject.name}</span>}
                      <span>до {fmtDate(l.closes_at)}</span>
                      <span>{summaryText(l.counts)}</span>
                      {isOwner && l.creator && <span>Автор: {l.creator.full_name || l.creator.email}</span>}
                    </div>
                  </div>
                  <Badge tone={state === 'open' ? 'success' : 'neutral'}>{state === 'open' ? 'Идёт' : 'Закрыт'}</Badge>
                  {l.review_sent_at && <Badge tone="info">разбор отправлен</Badge>}
                  <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && <div className="px-4 pb-4 border-t border-slate-100 pt-3"><ExamBoard link={l} /></div>}
              </Card>
            );
          })}
        </div>
      )}

      {launchFor && (
        <LaunchDialog
          initialBatchId={launchFor.batchId}
          onClose={() => setLaunchFor(null)}
          onCreated={(l) => setOpenCode(l.code)}
        />
      )}
    </div>
  );
};
