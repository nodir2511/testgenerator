import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import {
  TG_LIMITS, preferUnused, buildTickets, checkSettings, fitSettings, parseCount, parseNumbers, pickParallel, poolStats, toSnapshot, DEFAULT_SETTINGS,
} from '../supabase/functions/_shared/ticketing';
import { buildSingleTicketBlob, buildTicketsFile } from '../src/lib/docxExport';
import { buildAnswerKeyDocx, keyKindOf, matchingAnswer, openAnswer, selectionInfo, testAnswer } from '../src/lib/answerKey';

// Детерминированный генератор случайных чисел — тесты воспроизводимы
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// topics × perTopic вопросов одного вида
function makePool(type: string, topics: number, perTopic: number) {
  const out: any[] = [];
  for (let t = 0; t < topics; t++) {
    for (let n = 1; n <= perTopic; n++) {
      out.push({
        id: `${type}-${t}-${n}`, type, topic_id: `t${t}`, num: n,
        chapter: { name: 'Глава', order_index: 1 }, topic: { name: `Тема ${t}`, order_index: t },
        content: `Вопрос ${t}.${n}`,
        options: type === 'test' ? [0, 1, 2, 3].map((k) => ({ id: `${type}-${t}-${n}-o${k}`, text: `v${k}`, order_index: k + 1, is_correct: k === 2 })) : undefined,
      });
    }
  }
  return out;
}

describe('pickParallel', () => {
  it('основной режим: вопросы не повторяются ни в билете, ни между билетами', () => {
    const pool = makePool('test', 6, 20);
    const tickets = pickParallel(pool, 12, 4, rng(1));
    expect(tickets).toHaveLength(4);
    tickets.forEach((t) => expect(t).toHaveLength(12));
    const ids = tickets.flat().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('малая глава, темы одинакового размера: позиции делятся поровну', () => {
    const pool = makePool('test', 4, 20); // 80 вопросов < LARGE_CHAPTER
    const [first] = pickParallel(pool, 8, 2, rng(2));
    const perTopic = new Map<string, number>();
    first.forEach((q) => perTopic.set(q.topic_id, (perTopic.get(q.topic_id) ?? 0) + 1));
    expect([...perTopic.values()].every((n) => n === 2)).toBe(true);
  });

  // главы: sizes[c] = размеры тем главы c
  function chapterPool(sizes: number[][]) {
    const out: any[] = [];
    sizes.forEach((topics, c) => topics.forEach((n, t) => {
      for (let i = 1; i <= n; i++) {
        out.push({
          id: `c${c}t${t}-${i}`, type: 'test', chapter_id: `ch${c}`, topic_id: `c${c}t${t}`, num: i,
          chapter: { name: `Г${c}`, order_index: c }, topic: { name: `Т${t}`, order_index: t },
        });
      }
    }));
    return out;
  }
  const countBy = (qs: any[], key: string) => {
    const m = new Map<string, number>();
    qs.forEach((q) => m.set(q[key], (m.get(q[key]) ?? 0) + 1));
    return m;
  };

  it('главы получают позиции поровну, даже если в них разное число тем и вопросов', () => {
    // глава 0: 1 большая тема, глава 1: 5 тем, глава 2: 2 темы
    const pool = chapterPool([[200], [20, 20, 20, 20, 20], [40, 40]]);
    for (let seed = 1; seed <= 20; seed++) {
      const [first] = pickParallel(pool, 18, 2, rng(seed));
      expect(first).toHaveLength(18);
      const perCh = countBy(first, 'chapter_id');
      expect([...perCh.values()].every((n) => n === 6)).toBe(true);
    }
  });

  it('малая глава: каждой теме хотя бы одна позиция, остальное пропорционально размеру', () => {
    const pool = chapterPool([[45, 5]]); // 50 вопросов < LARGE_CHAPTER
    let big = 0, small = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const [first] = pickParallel(pool, 10, 2, rng(seed));
      const b = first.filter((q) => q.topic_id === 'c0t0').length;
      const s = first.filter((q) => q.topic_id === 'c0t1').length;
      expect(s).toBeGreaterThanOrEqual(1);
      expect(b + s).toBe(10);
      big += b; small += s;
    }
    expect(big).toBeGreaterThan(small * 3);
  });

  it('большая глава (от 100 вопросов): темы выпадают случайно, но каждая выбранная тема представлена', () => {
    const pool = chapterPool([[400, 300, 200, 100]]); // 1000 вопросов
    const hits = new Map<string, number>();
    for (let seed = 1; seed <= 50; seed++) {
      const [first] = pickParallel(pool, 12, 2, rng(seed));
      expect(first).toHaveLength(12);
      const per = countBy(first, 'topic_id');
      for (let t = 0; t < 4; t++) expect(per.get(`c0t${t}`) ?? 0).toBeGreaterThanOrEqual(1);
      per.forEach((n, k) => hits.set(k, (hits.get(k) ?? 0) + n));
    }
    // шансы пропорциональны числу вопросов, но состав меняется от запуска к запуску
    expect(hits.get('c0t0')!).toBeGreaterThan(hits.get('c0t3')!);
  });

  it('охват главы: неполно выбранная глава получает пропорционально меньшую долю', () => {
    // глава 0 выбрана на 25% (20 из 80), главы 1 и 2 — полностью
    const pool = chapterPool([[20], [80], [80]]);
    const totals = { ch0: 80, ch1: 80, ch2: 80 };
    let c0 = 0, c1 = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const [first] = pickParallel(pool, 18, 2, rng(seed), totals);
      const per = countBy(first, 'chapter_id');
      c0 += per.get('ch0') ?? 0; c1 += per.get('ch1') ?? 0;
    }
    // веса 0,25 : 1 : 1 → глава 0 получает ~1/9 позиций (≈2 из 18), главы 1 и 2 — по ~8
    expect(c0 / 40).toBeGreaterThan(1.5);
    expect(c0 / 40).toBeLessThan(2.6);
    expect(c1 / 40).toBeGreaterThan(7);
  });

  it('без итогов по главам охват считается полным (поровну)', () => {
    const pool = chapterPool([[20], [80], [80]]);
    const [first] = pickParallel(pool, 18, 2, rng(11));
    expect([...countBy(first, 'chapter_id').values()]).toEqual([6, 6, 6]);
  });

  it('доля главы без места уходит другим, повторов нет', () => {
    const pool = chapterPool([[6], [100], [100]]); // глава 0 вмещает 3 позиции при 2 билетах
    const tickets = pickParallel(pool, 18, 2, rng(7));
    tickets.forEach((t) => expect(t).toHaveLength(18));
    const ids = tickets.flat().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(countBy(tickets[0], 'chapter_id').get('ch0')).toBe(3);
  });

  it('малый вид (2 соответствия): главы разыгрываются случайно, каждая бывает', () => {
    const pool = chapterPool([[10], [10], [10]]);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) pickParallel(pool, 2, 2, rng(seed))[0].forEach((q) => seen.add(q.chapter_id));
    expect(seen.size).toBe(3);
  });

  it('позиция j во всех билетах — из одной темы, соседними вопросами', () => {
    const pool = makePool('test', 3, 20);
    const tickets = pickParallel(pool, 6, 3, rng(3));
    for (let j = 0; j < 6; j++) {
      const col = tickets.map((t) => t[j]);
      expect(new Set(col.map((q) => q.topic_id)).size).toBe(1);
      const nums = col.map((q) => q.num);
      expect(nums[1] - nums[0]).toBe(1);
      expect(nums[2] - nums[1]).toBe(1);
    }
  });

  it('запасной режим (вопросов мало): внутри билета нет повторов', () => {
    const pool = makePool('test', 2, 5); // 10 вопросов, 4 билета по 6 — основной режим невозможен
    const tickets = pickParallel(pool, 6, 4, rng(4));
    tickets.forEach((t) => {
      expect(t).toHaveLength(6);
      expect(new Set(t.map((q) => q.id)).size).toBe(6);
    });
  });

  it('не берёт больше, чем есть в пуле', () => {
    const pool = makePool('test', 1, 5);
    const tickets = pickParallel(pool, 20, 2, rng(5));
    tickets.forEach((t) => expect(t).toHaveLength(5));
  });
});

describe('fitSettings / checkSettings', () => {
  const base = { ...DEFAULT_SETTINGS, testCount: 10, matchingCount: 2, openCount: 3 };

  it('урезает состав билета до того, что есть, и объясняет почему', () => {
    const fit = fitSettings({ total: 12, test: 10, matching: 1, open: 1 }, base);
    expect(fit.error).toBeNull();
    expect(fit.settings).toMatchObject({ testCount: 10, matchingCount: 1, openCount: 1 });
    expect(fit.notes).toHaveLength(2);
  });

  it('ошибка, только если вопросов нет вообще', () => {
    expect(fitSettings({ total: 0, test: 0, matching: 0, open: 0 }, base).error).toBeTruthy();
  });

  it('лимиты Telegram: билетов, вопросов в билете', () => {
    expect(checkSettings({ ...base, ticketCount: TG_LIMITS.tickets }, TG_LIMITS)).toBeNull();
    expect(checkSettings({ ...base, ticketCount: TG_LIMITS.tickets + 1 }, TG_LIMITS)).toMatch(/билетов/);
    expect(checkSettings({ ...base, testCount: 40, matchingCount: 10, openCount: 5 }, TG_LIMITS)).toMatch(/вопросов в одном билете/);
    expect(checkSettings({ ...base, testCount: 0, matchingCount: 0, openCount: 0 }, TG_LIMITS)).toBeTruthy();
  });
});

describe('buildTickets / toSnapshot', () => {
  it('билеты собираются из тестов, соответствий и открытых по порядку', () => {
    const pool = [...makePool('test', 4, 10), ...makePool('open', 2, 10)];
    const stats = poolStats(pool);
    const fit = fitSettings(stats, { ...DEFAULT_SETTINGS, testCount: 6, matchingCount: 2, openCount: 2, ticketCount: 3 });
    const tickets = buildTickets(pool, fit.settings, rng(6));
    expect(tickets).toHaveLength(3);
    tickets.forEach((t) => {
      expect(t.questions.map((q) => q.question_snapshot.type)).toEqual(['test', 'test', 'test', 'test', 'test', 'test', 'open', 'open']);
      expect(t.questions.map((q) => q.order_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });

  it('после перемешивания вариантов отметка верного ответа остаётся у того же варианта', () => {
    const q = makePool('test', 1, 1)[0];
    for (let seed = 1; seed <= 20; seed++) {
      const snap = toSnapshot(q, { shuffleOptions: true, shuffleMatching: true }, rng(seed));
      const correct = snap.options!.filter((o: any) => o.is_correct);
      expect(correct).toHaveLength(1);
      expect(correct[0].id).toBe(`${q.id}-o2`);
    }
  });

  it('соответствие: правильная пара сохраняется после перемешивания правой колонки', () => {
    const q = {
      id: 'm1', type: 'matching', content: 'x',
      matching_items: [
        ...[1, 2, 3, 4].map((k) => ({ id: `l${k}`, side: 'left', text: `L${k}`, order_index: k, correct_match_id: `r${5 - k}` })),
        ...[1, 2, 3, 4, 5].map((k) => ({ id: `r${k}`, side: 'right', text: `R${k}`, order_index: k })),
      ],
    };
    const snap = toSnapshot(q, { shuffleOptions: true, shuffleMatching: true }, rng(7));
    const ans = matchingAnswer(snap);
    const right = snap.matching_items!.filter((m: any) => m.side === 'right').sort((a: any, b: any) => a.order_index - b.order_index);
    ans.forEach((a, i) => expect(right[Number(a) - 1].id).toBe(`r${5 - (i + 1)}`));
  });
});

describe('ввод пользователя', () => {
  it('parseCount', () => {
    expect(parseCount('12', 100)).toBe(12);
    expect(parseCount('101', 100)).toBeNull();
    expect(parseCount('abc', 100)).toBeNull();
    expect(parseCount('0', 100, 1)).toBeNull();
  });
  it('parseNumbers', () => {
    expect(parseNumbers('1-3, 5', 10)).toEqual([1, 2, 3, 5]);
    expect(parseNumbers('все', 10)).toBe('all');
    expect(parseNumbers('11', 10)).toBeNull();
    expect(parseNumbers('3-1', 10)).toBeNull();
  });
});

describe('ключи ответов', () => {
  it('ответы на тест, соответствие и открытый вопрос', () => {
    expect(testAnswer({ options: [{ order_index: 1, is_correct: false }, { order_index: 2, is_correct: true }] })).toBe('B');
    expect(testAnswer({ options: [{ order_index: 1, is_correct: false }] })).toBeNull();
    expect(openAnswer({ correct_numeric_answer: 0.25 })).toBe('0,25');
    expect(openAnswer({ correct_numeric_answer: null })).toBeNull();
  });

  it('предмет определяется по названию', () => {
    expect(keyKindOf('Химия')).toBe('chem');
    expect(keyKindOf('Физика / Физика')).toBe('phys');
    expect(keyKindOf('История')).toBeNull();
  });

  it('описание выбора: главы полностью и темы неполных глав', () => {
    const chapters = [1, 2, 3, 4, 5].map((n) => ({ id: 'c' + n, order_index: n }));
    const topics = chapters.flatMap((c) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `${c.id}t${n}`, chapter_id: c.id, order_index: n })));
    const ids = (c: number, ns: number[]) => ns.map((n) => `c${c}t${n}`);
    const full = (c: number) => ids(c, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(selectionInfo(chapters, topics, ['c1', 'c2', 'c3'], [])).toBe('Главы 1, 2, 3 — полностью');
    expect(selectionInfo(chapters, topics, [], [...full(1), ...full(2), ...full(3), ...ids(4, [1, 2, 3, 4])]))
      .toBe('Главы 1, 2, 3 — полностью; глава 4 — темы 1–4');
    expect(selectionInfo(chapters, topics, [], ids(5, [1, 3, 5, 6, 7]))).toBe('Глава 5 — темы 1, 3, 5–7');
    expect(selectionInfo(chapters, topics, [], ids(2, [4]))).toBe('Глава 2 — тема 4');
    expect(selectionInfo(chapters.slice(0, 2), topics, [], [])).toBe('Главы 1, 2 — полностью');
  });

  it('вариант билета: под шапкой печатаются главы и темы (рус. и тадж.)', async () => {
    const chapters = [1, 2, 3, 4].map((n) => ({ id: 'c' + n, order_index: n }));
    const topics = chapters.flatMap((c) => [1, 2, 3, 4, 5].map((n) => ({ id: `${c.id}t${n}`, chapter_id: c.id, order_index: n })));
    const picked = [...topics.filter((t) => t.chapter_id !== 'c4'), ...topics.filter((t) => t.chapter_id === 'c4' && t.order_index <= 4)].map((t) => t.id);
    const info = { ru: selectionInfo(chapters, topics, [], picked, 'ru'), tg: selectionInfo(chapters, topics, [], picked, 'tg') };
    expect(info.tg).toBe('Бобҳои 1, 2, 3 — пурра; боби 4 — мавзӯъҳои 1–4');
    const textOf = async (isTg: boolean) => {
      const blob = await buildSingleTicketBlob('Экзамен', { ticket_number: 1, questions: [], selection_info: info }, 'Химия', isTg);
      const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
      return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join('|');
    };
    expect(await textOf(false)).toContain('Включено: |Главы 1, 2, 3 — полностью; глава 4 — темы 1–4');
    expect(await textOf(true)).toContain('Дохил шудааст: |Бобҳои 1, 2, 3 — пурра; боби 4 — мавзӯъҳои 1–4');
    // без описания строки нет
    const blob = await buildSingleTicketBlob('Экзамен', { ticket_number: 1, questions: [] }, 'Химия', false);
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).not.toContain('Включено');
  });

  it('архив «RU + TJ»: варианты обоих языков и ключи в одном ZIP', async () => {
    const tickets = [1, 2].map((n) => ({ ticket_number: n, questions: [] }));
    const key = { name: 'Ключи – Экзамен.docx', blob: new Blob(['x']) };
    const file = await buildTicketsFile('Экзамен', tickets, 'Химия', 'both', [key]);
    expect(file!.fileName).toBe('Экзамен_RU_TJ.zip');
    const names = Object.keys((await JSZip.loadAsync(await file!.blob.arrayBuffer())).files).sort();
    expect(names).toContain('Ключи – Экзамен.docx');
    expect(names).toContain('Русский/Вариант 2.docx');
    expect(names).toContain('Тоҷикӣ/Варианти 1.docx');
    const tj = await buildTicketsFile('Экзамен', tickets, 'Химия', 'tg');
    expect(tj!.fileName).toBe('Экзамен_TJ.zip');
  });

  it('шапка ключей: «ҶАВОБИ ДУРУСТИ …» заменяется на то, что вошло в билеты', async () => {
    for (const kind of ['bio', 'chem', 'phys', 'taj']) {
      const tpl = fs.readFileSync(`templates/key/${kind}.docx`);
      const { bytes } = await buildAnswerKeyDocx(tpl, [{ ticket_number: 1, questions: [] }], 'Главы 1, 2, 3 — полностью; глава 4 — темы 1–4');
      const zip = await JSZip.loadAsync(bytes);
      const h = await zip.file('word/header1.xml')!.async('string');
      const text = (h.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join('|');
      expect(text).toContain('ВКЛЮЧЕНО В БИЛЕТЫ');
      expect(text).toContain('Главы 1, 2, 3 — полностью; глава 4 — темы 1–4');
      expect(text).not.toContain('ДУРУСТИ');
      expect(text).not.toContain('А.5');
      expect(text).toContain('Repetitor');
    }
  });

  it('шаблон химии заполняется: по странице на вариант, ответы в нужных клетках', async () => {
    const mk = (type: string, i: number) => {
      if (type === 'test') return { question_snapshot: { type, options: [0, 1, 2, 3].map((k) => ({ order_index: k + 1, is_correct: k === i % 4 })) } };
      if (type === 'matching') {
        return { question_snapshot: { type, matching_items: [
          ...[1, 2, 3, 4].map((k) => ({ id: `l${k}`, side: 'left', order_index: k, correct_match_id: `r${k}` })),
          ...[1, 2, 3, 4, 5].map((k) => ({ id: `r${k}`, side: 'right', order_index: k })),
        ] } };
      }
      return { question_snapshot: { type, correct_numeric_answer: 12.5 } };
    };
    const questions = [mk('test', 0), mk('test', 1), mk('test', 2), mk('matching', 0), mk('open', 0)];
    const tpl = fs.readFileSync('templates/key/chem.docx');
    const { bytes, stats } = await buildAnswerKeyDocx(tpl, [
      { ticket_number: 1, questions }, { ticket_number: 2, questions },
    ]);
    expect(stats).toEqual({ missing: 0, overflow: 0 });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml.match(/w:br w:type="page"/g)).toHaveLength(1);
    const text = (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, ''));
    expect(text.filter((t) => t === 'Вариант(и) ')).toHaveLength(2);
    expect(text).toContain(',');
  });
});

describe('preferUnused (кластер: без повторов с прошлыми экзаменами)', () => {
  const pool = Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i }));
  it('без прошлых экзаменов берёт весь пул', () => {
    expect(preferUnused(pool, new Set(), 4).pool).toHaveLength(10);
  });
  it('новых хватает — берёт только новые', () => {
    const r = preferUnused(pool, new Set(['q0', 'q1', 'q2']), 5);
    expect(r.fresh).toBe(true);
    expect(r.pool.map((q) => q.id)).not.toContain('q1');
    expect(r.pool).toHaveLength(7);
  });
  it('новых не хватает — весь пул, помечено как с повторами', () => {
    const r = preferUnused(pool, new Set(['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6']), 5);
    expect(r.fresh).toBe(false);
    expect(r.pool).toHaveLength(10);
  });
});
