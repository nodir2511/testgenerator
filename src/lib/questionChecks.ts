// Локальные проверки качества вопроса (без ИИ). Дополняют questionIssues.ts: там — «ответ и стандартный состав»,
// здесь — пустые тексты, одинаковые варианты, сломанное оформление и подозрительные картинки.
// Работают с нейтральной формой CheckInput, поэтому годятся и для вопросов банка, и для строк предпросмотра импорта.

export type CheckCode =
  | 'empty_text'     // пустой текст вопроса
  | 'empty_option'   // пустой вариант или пункт соответствия
  | 'dup_options'    // одинаковые варианты теста / пункты слева
  | 'dup_right'      // одинаковые пункты справа в соответствии
  | 'format_broken'  // незакрытые, лишние или неизвестные теги оформления
  | 'image_bad';     // ссылка на картинку пустая или явно неверная

export const CHECK_LABELS: Record<CheckCode, string> = {
  empty_text: 'пустой текст вопроса',
  empty_option: 'пустой вариант',
  dup_options: 'одинаковые варианты',
  dup_right: 'одинаковые пункты справа',
  format_broken: 'сломано оформление (теги)',
  image_bad: 'неверная ссылка на картинку',
};

export interface CheckText { text?: string | null; image?: string | null }
export interface CheckInput {
  type: string;
  content?: string | null;
  image?: string | null;
  /** Варианты теста */
  options?: CheckText[];
  /** Соответствие: пункты слева и справа */
  left?: CheckText[];
  right?: CheckText[];
}

const KNOWN_TAG = /^(b|i|u|sub|sup)$/;

/** Текст без тегов оформления и неразрывных пробелов, пробелы схлопнуты */
export const plainText = (s?: string | null) =>
  (s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();

/** Нормализация для сравнения вариантов: регистр, ё/е, пробелы, знаки по краям */
export const sameKey = (s?: string | null) =>
  plainText(s).toLowerCase().replace(/ё/g, 'е').replace(/^[\s.,;:!?()«»"']+|[\s.,;:!?()«»"']+$/g, '');

/** Проблемы с тегами <b> <i> <u> <sub> <sup>: незакрытый, лишний закрывающий, пустой, неизвестный */
export function formatProblem(text?: string | null): boolean {
  const s = text ?? '';
  if (!s.includes('<')) return false;
  const depth: Record<string, number> = { b: 0, i: 0, u: 0, sub: 0, sup: 0 };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const name = m[2].toLowerCase();
    if (!KNOWN_TAG.test(name)) return true;
    if (m[1]) {
      if (depth[name] === 0) return true;
      depth[name]--;
    } else depth[name]++;
  }
  if (Object.values(depth).some((d) => d !== 0)) return true;
  return /<(b|i|u|sub|sup)>\s*<\/\1>/i.test(s);
}

const badImage = (src?: string | null) => {
  if (src === null || src === undefined) return false;
  const t = src.trim();
  return t === '' || t === 'null' || t === 'undefined' || /\s/.test(t);
};

const isEmpty = (o: CheckText) => plainText(o.text) === '' && !(o.image && !badImage(o.image));
const hasDup = (list: CheckText[]) => {
  const keys = list.map((o) => sameKey(o.text)).filter((k) => k !== '');
  return new Set(keys).size < keys.length;
};

export function contentChecks(q: CheckInput): CheckCode[] {
  const out: CheckCode[] = [];
  if (plainText(q.content) === '' && !(q.image && !badImage(q.image))) out.push('empty_text');

  const options = q.options ?? [];
  const left = q.left ?? [];
  const right = q.right ?? [];
  if ([...options, ...left, ...right].some(isEmpty)) out.push('empty_option');
  if (hasDup(options) || hasDup(left)) out.push('dup_options');
  if (hasDup(right)) out.push('dup_right');

  const texts = [q.content, ...options.map((o) => o.text), ...left.map((o) => o.text), ...right.map((o) => o.text)];
  if (texts.some(formatProblem)) out.push('format_broken');

  const images = [q.image, ...options.map((o) => o.image), ...left.map((o) => o.image), ...right.map((o) => o.image)];
  if (images.some(badImage)) out.push('image_bad');
  return out;
}

/** Вопрос банка (как его отдаёт база) → форма для проверки */
export function checkInputFromBank(q: {
  type: string; content?: string | null; image_url?: string | null;
  options?: Array<{ text?: string | null; text_ru?: string | null; text_tg?: string | null; image_url?: string | null }> | null;
  matching_items?: Array<{ side: string; text?: string | null; text_ru?: string | null; text_tg?: string | null; image_url?: string | null }> | null;
}): CheckInput {
  const pick = (o: { text?: string | null; text_ru?: string | null; text_tg?: string | null; image_url?: string | null }): CheckText =>
    ({ text: o.text || o.text_ru || o.text_tg || '', image: o.image_url });
  const items = q.matching_items ?? [];
  return {
    type: q.type,
    content: q.content,
    image: q.image_url,
    options: (q.options ?? []).map(pick),
    left: items.filter((m) => m.side === 'left').map(pick),
    right: items.filter((m) => m.side === 'right').map(pick),
  };
}
