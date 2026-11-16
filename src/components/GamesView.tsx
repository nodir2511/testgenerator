import React from 'react';
import { ExternalLink, Gamepad2, Stethoscope, Trophy } from 'lucide-react';
import { Card, PageHeader } from './ui';
import { ClinicClass } from './ClinicClass';
import { useReleases } from '../hooks/useReleases';

interface GameCard {
  href: string;
  title: string;
  text: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Новая игра — одна запись здесь + папка со страницей в public/games/<имя>/index.html
const GAMES: GameCard[] = [
  {
    href: '/games/priem-patsienta/index.html',
    title: 'Приём пациента',
    text: 'Клинические случаи по разделам: расспрос, осмотр, обследование, диагноз и лечение. За ход приёма — баллы и итоговый разбор.',
    icon: Stethoscope,
  },
];

const OWNER_GAMES: GameCard[] = [
  {
    href: '/game',
    title: 'Своя игра',
    text: 'Командная викторина с ведущим, табло на проекторе и телефонами команд.',
    icon: Trophy,
  },
];

export const GamesView: React.FC<{ isOwner: boolean; canHost: boolean }> = ({ isOwner, canHost }) => {
  const { gameNotes } = useReleases();
  const games = isOwner ? [...GAMES, ...OWNER_GAMES] : GAMES;
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Игры" icon={Gamepad2} description="Учебные игры открываются в новом окне." />
      {gameNotes.length > 0 && (
        <Card>
          <h3 className="font-bold text-slate-900 mb-2">Что нового в играх</h3>
          <div className="space-y-3">
            {gameNotes.slice(0, 3).map((r) => (
              <div key={r.id}>
                <div className="text-xs font-semibold text-slate-500 mb-1">Версия {r.version} · {new Date(r.released_at).toLocaleDateString('ru-RU')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                  {r.site_release_items.map((i) => <li key={i.id}>{i.text}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}
      {canHost && <ClinicClass />}
      <div className="grid gap-4 sm:grid-cols-2">
        {games.map((g) => {
          const Icon = g.icon;
          return (
            <a key={g.href} href={g.href} target="_blank" rel="noopener" className="block">
              <Card interactive className="h-full">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-900">{g.title}</h3>
                      <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                    <p className="text-sm text-slate-600 mt-1 leading-relaxed">{g.text}</p>
                  </div>
                </div>
              </Card>
            </a>
          );
        })}
      </div>
    </div>
  );
};
