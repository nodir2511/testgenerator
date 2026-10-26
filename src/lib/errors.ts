// Превращает техническую ошибку (Supabase/сеть/хранилище) в понятное объяснение причины.

export interface ExplainedError {
  title: string;   // что не получилось
  reason: string;  // почему
  details?: string; // исходный текст ошибки для разработчика
}

const errText = (err: unknown): string => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; details?: string; hint?: string };
  return [e.message, e.details, e.hint].filter(Boolean).join(' — ');
};

export function explainError(err: unknown, action = 'Не удалось выполнить действие'): ExplainedError {
  const raw = errText(err);
  const code = String((err as { code?: string } | null)?.code ?? '');
  const status = Number((err as { status?: number } | null)?.status ?? 0);
  const low = raw.toLowerCase();
  let reason: string;

  if (code === '42501' || low.includes('row-level security') || low.includes('permission denied')) {
    reason = 'База запретила операцию: у вашей учётной записи нет на это прав (политика безопасности). Нужна роль администратора, либо в базе не хватает разрешающей политики для администратора.';
  } else if (low.includes('jwt') || low.includes('not authenticated') || low.includes('invalid refresh token') || status === 401) {
    reason = 'Сессия устарела или вы не вошли в систему. Выйдите и войдите снова.';
  } else if (status === 403) {
    reason = 'Доступ запрещён: недостаточно прав для этого действия.';
  } else if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('network request failed') || low.includes('load failed')) {
    reason = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  } else if (low.includes('timeout') || low.includes('timed out') || code === '57014') {
    reason = 'Сервер не ответил вовремя (слишком большой запрос или перегрузка). Попробуйте ещё раз или выберите меньше данных.';
  } else if (code === '23505' || low.includes('duplicate key')) {
    reason = 'Такая запись уже существует (дубликат).';
  } else if (code === '23503' || low.includes('foreign key')) {
    reason = 'Запись связана с другими данными (например, используется в билетах или вопросах), поэтому действие невозможно.';
  } else if (code === '23502' || low.includes('null value')) {
    reason = 'Не заполнено обязательное поле.';
  } else if (code === '23514' || low.includes('violates check constraint')) {
    reason = 'Значение не подходит под ограничения базы (недопустимый тип или формат).';
  } else if (low.includes('payload too large') || low.includes('exceeded the maximum allowed size') || status === 413) {
    reason = 'Файл слишком большой.';
  } else if (low.includes('mime type') || low.includes('not supported')) {
    reason = 'Формат файла не поддерживается (разрешены JPEG, PNG, WebP, GIF).';
  } else if (low.includes('bucket not found')) {
    reason = 'Хранилище картинок не найдено в Supabase.';
  } else if (low.includes('no rows were changed') || low.includes('0 rows')) {
    reason = 'Запись не изменилась: она не найдена или у вас нет прав на её изменение.';
  } else if (status >= 500) {
    reason = 'Ошибка на стороне сервера. Попробуйте позже.';
  } else if (/[а-яё]/i.test(raw)) {
    // Сообщение уже написано для человека (наша проверка или ограничение базы) — показываем его как причину
    return { title: action, reason: raw };
  } else {
    reason = 'Причина не определена автоматически — см. технические подробности ниже.';
  }

  return { title: action, reason, details: raw || undefined };
}

// Показать предупреждение (подхватывает ErrorToaster)
export const ERROR_EVENT = 'app:error';
export function notifyError(err: unknown, action?: string) {
  const info = explainError(err, action);
  console.error(info.title, err);
  window.dispatchEvent(new CustomEvent<ExplainedError>(ERROR_EVENT, { detail: info }));
}

// Бросает ошибку, если запрос обновления/удаления не затронул ни одной строки
// (с RLS такой UPDATE завершается «успешно», но ничего не меняет).
export function assertRowsChanged(data: unknown[] | null | undefined, what = 'запись') {
  if (!data || data.length === 0) {
    throw new Error(`No rows were changed: ${what} не изменена (нет прав или не найдена)`);
  }
}

// Одной строкой для встроенных сообщений в формах: «что не так. Причина. (технический текст)»
export function describeError(err: unknown, action: string): string {
  const { reason, details } = explainError(err, action);
  return `${action}. ${reason}${details ? ` (${details})` : ''}`;
}

// Бросает ошибку, если запрос к базе вернул error (чтобы не сообщать об успехе, когда запись не сохранилась)
export async function must(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}

// Всплывающее подтверждение «изменение внесено в базу» (подхватывает ErrorToaster)
export const SUCCESS_EVENT = 'app:success';
export function notifySuccess(message: string) {
  window.dispatchEvent(new CustomEvent<string>(SUCCESS_EVENT, { detail: message }));
}

// Нейтральное уведомление (не ошибка): например, «вопросов не хватило, взято сколько есть»
export const INFO_EVENT = 'app:info';
export function notifyInfo(message: string) {
  window.dispatchEvent(new CustomEvent<string>(INFO_EVENT, { detail: message }));
}
