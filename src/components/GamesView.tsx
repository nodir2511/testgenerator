import React from 'react';
import { ExternalLink, Gamepad2, Stethoscope, Trophy } from 'lucide-react';
import { Card, PageHeader } from './ui';
import { ClinicClass } from './ClinicClass';

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
  const games = isOwner ? [...GAMES, ...OWNER_GAMES] : GAMES;
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Игры" icon={Gamepad2} description="Учебные игры открываются в новом окне." />
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
