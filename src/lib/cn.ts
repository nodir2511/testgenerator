import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склеивает классы и убирает конфликты: cn('px-3', cond && 'px-5') → 'px-5' */
export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
