import React, { useId } from 'react';

export interface LogoProps {
  /** Размер иконки: 'xs' (24px), 'sm' (32px), 'md' (40px), 'lg' (48px), 'xl' (64px) или число в px */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  /** Показывать ли текстовую часть логотипа рядом («Экзаменатор») */
  showText?: boolean;
  /** Показывать ли подзаголовок («Банк вопросов и генератор билетов») при showText=true */
  subtitle?: boolean;
  /** Дополнительные CSS классы для контейнера */
  className?: string;
  /** Обработчик клика */
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: { box: 'w-6 h-6', px: 24, text: 'text-sm', sub: 'text-[11px]' },
  sm: { box: 'w-8 h-8', px: 32, text: 'text-base', sub: 'text-xs' },
  md: { box: 'w-10 h-10', px: 40, text: 'text-base sm:text-lg', sub: 'text-xs' },
  lg: { box: 'w-12 h-12', px: 48, text: 'text-lg sm:text-xl', sub: 'text-sm' },
  xl: { box: 'w-16 h-16', px: 64, text: 'text-xl sm:text-2xl', sub: 'text-sm' },
} as const;

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showText = false,
  subtitle = true,
  className = '',
  onClick,
}) => {
  const uid = useId().replace(/:/g, '');
  const bgGradId = `logo-bg-${uid}`;
  const glowGradId = `logo-glow-${uid}`;
  const starGradId = `logo-star-${uid}`;
  const badgeGradId = `logo-badge-${uid}`;
  const shadowId = `logo-shadow-${uid}`;

  const isPreset = typeof size === 'string' && size in SIZE_MAP;
  const preset = isPreset ? SIZE_MAP[size as keyof typeof SIZE_MAP] : SIZE_MAP.md;
  const customPx = typeof size === 'number' ? size : preset.px;

  const iconElement = (
    <div
      style={typeof size === 'number' ? { width: customPx, height: customPx } : undefined}
      className={`relative shrink-0 rounded-2xl shadow-md shadow-indigo-500/20 transition-transform duration-200 select-none ${
        typeof size === 'string' ? preset.box : ''
      }`}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full block"
        aria-hidden="true"
      >
        <defs>
          {/* Фон — технологичный ультрамариново-индиго градиент */}
          <linearGradient id={bgGradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4338ca" />
            <stop offset="45%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>

          {/* Мягкий блик объема */}
          <linearGradient id={glowGradId} x1="16" y1="8" x2="48" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          {/* Золотая искра знаний */}
          <linearGradient id={starGradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>

          {/* Печать готовности */}
          <linearGradient id={badgeGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          {/* Мягкая тень для переднего билета */}
          <filter id={shadowId} x="10" y="14" width="46" height="46" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="#1e1b4b" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Сквиркл-основа */}
        <rect width="64" height="64" rx="16" fill={`url(#${bgGradId})`} />
        <rect width="64" height="64" rx="16" fill={`url(#${glowGradId})`} />
        <rect
          x="0.75"
          y="0.75"
          width="62.5"
          height="62.5"
          rx="15.25"
          stroke="#ffffff"
          strokeOpacity="0.25"
          strokeWidth="1.5"
        />

        {/* Задний полупрозрачный билет (эффект пачки билетов) */}
        <g transform="rotate(-7 30 35)">
          <rect
            x="14"
            y="16"
            width="28"
            height="34"
            rx="4.5"
            fill="#ffffff"
            fillOpacity="0.24"
            stroke="#ffffff"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <line x1="18" y1="22" x2="27" y2="22" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
          <line x1="18" y1="27" x2="34" y2="27" stroke="#ffffff" strokeOpacity="0.38" strokeWidth="1.5" strokeLinecap="round" />
        </g>

        {/* Передний экзаменационный билет с перфорированными вырезами */}
        <g filter={`url(#${shadowId})`}>
          <path
            d="M 20 18 H 48 A 4 4 0 0 1 52 22 V 33 A 3 3 0 0 0 52 39 V 50 A 4 4 0 0 1 48 54 H 20 A 4 4 0 0 1 16 50 V 39 A 3 3 0 0 0 16 33 V 22 A 4 4 0 0 1 20 18 Z"
            fill="#ffffff"
          />
          {/* Цветная плашка предмета */}
          <rect x="20" y="22.5" width="12" height="3" rx="1.5" fill="#4f46e5" />
          {/* Строки вопросов */}
          <rect x="20" y="28.5" width="20" height="2" rx="1" fill="#64748b" />
          <rect x="20" y="33.5" width="15" height="2" rx="1" fill="#94a3b8" />
          <rect x="20" y="38.5" width="18" height="2" rx="1" fill="#cbd5e1" />
          {/* Изумрудная печать готовности с галочкой */}
          <circle cx="41" cy="44" r="5" fill={`url(#${badgeGradId})`} />
          <path
            d="M 38.8 44 L 40.3 45.5 L 43.5 42.3"
            stroke="#ffffff"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Сияющая золотая искра интеллекта и генерации */}
        <path
          d="M 48 7 C 48 11.5 45.5 14 41 14 C 45.5 14 48 16.5 48 21 C 48 16.5 50.5 14 55 14 C 50.5 14 48 11.5 48 7 Z"
          fill={`url(#${starGradId})`}
        />
        <circle cx="48" cy="14" r="1.2" fill="#ffffff" />
        {/* Акцентная мини-искра */}
        <path
          d="M 54 22 C 54 23.8 53 25 51.2 25 C 53 25 54 26.2 54 28 C 54 26.2 55 25 56.8 25 C 55 25 54 23.8 54 22 Z"
          fill="#fde047"
          opacity="0.95"
        />
      </svg>
    </div>
  );

  if (!showText) {
    return (
      <div className={`inline-flex items-center ${className}`} onClick={onClick}>
        {iconElement}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center space-x-3 select-none ${onClick ? 'cursor-pointer group' : ''} ${className}`}
      onClick={onClick}
    >
      <div className={onClick ? 'group-hover:scale-105 transition-transform' : ''}>
        {iconElement}
      </div>
      <div>
        <div className="flex items-center space-x-1.5">
          <h1 className={`font-bold text-slate-900 leading-tight tracking-tight ${preset.text}`}>
            Экзаменатор
          </h1>
        </div>
        {subtitle && (
          <p className={`hidden sm:block text-slate-500 font-medium ${preset.sub}`}>
            Банк вопросов и генератор билетов
          </p>
        )}
      </div>
    </div>
  );
};

export default Logo;
