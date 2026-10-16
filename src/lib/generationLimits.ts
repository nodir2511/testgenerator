import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { TG_LIMITS } from '../../supabase/functions/_shared/ticketing';

// Лимиты генерации для обычных пользователей: таблица generation_settings (supabase/sql/generation_limits.sql).
// Пока не загрузились или таблицы нет — значения по умолчанию. Их же проверяет триггер в базе.

export interface GenerationSettings {
  per_day: number;
  cooldown_seconds: number;
  max_tickets: number;
  max_per_ticket: number;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  per_day: TG_LIMITS.perDay,
  cooldown_seconds: 60,
  max_tickets: TG_LIMITS.tickets,
  max_per_ticket: TG_LIMITS.total,
};

export function useGenerationSettings() {
  return useQuery({
    queryKey: ['generation_settings'],
    staleTime: 60_000,
    queryFn: async (): Promise<GenerationSettings> => {
      const { data, error } = await supabase.from('generation_settings').select('per_day, cooldown_seconds, max_tickets, max_per_ticket').eq('id', true).maybeSingle();
      if (error || !data) return DEFAULT_GENERATION_SETTINGS;
      return data as GenerationSettings;
    },
  });
}

/** Лимиты обычного пользователя в формате checkSettings */
export function useUserLimits() {
  const { data = DEFAULT_GENERATION_SETTINGS } = useGenerationSettings();
  return { perType: TG_LIMITS.perType, tickets: data.max_tickets, total: data.max_per_ticket, perDay: data.per_day, cooldownSeconds: data.cooldown_seconds };
}

export const formatCooldown = (s: number) => (s % 60 === 0 && s >= 60 ? (s === 60 ? 'раз в минуту' : `раз в ${s / 60} мин.`) : `раз в ${s} сек.`);
