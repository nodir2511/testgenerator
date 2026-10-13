import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { must, notifySuccess } from '../lib/errors';
import { Subject, Chapter, Topic, Source, QuestionType } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { parseDocxFile } from '../lib/docxImport';
import { pairBilingual } from '../lib/docxPair';
import { uploadQuestionImage } from '../lib/imageCompression';
import { FormattedText } from './FormulaEditor';
import { 
  Upload, 
  FileSpreadsheet, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  Trash2, 
  Loader2,
  Undo2,
  Image as ImageIcon,
  X,
  Sparkles,
  Layers
} from 'lucide-react';

type ImportLang = 'ru' | 'tg';

interface ParsedRow {
  rowNum: number;
  type: QuestionType;
  /** Язык, на котором написан content (и тексты вариантов); при contentTg — это русский */
  lang?: ImportLang;
  content: string;
  /** Таджикский текст (двуязычный импорт парой файлов) */
  contentTg?: string;
  warnings?: string[];
  imageUrl?: string | null;
  subjectName: string;
  chapterName: string;
  topicName: string;
  sourceName?: string;
  optionsText?: string;
  rawOptions?: { text: string; textTg?: string; imageUrl?: string | null }[];
  matchingText?: string;
  rawMatchingItems?: { side: 'left' | 'right'; text: string; text_tg?: string; image_url?: string | null; order_index: number }[];
  correctAnswer?: string;
  section?: string;
  errors: string[];
}

function parseNumericAnswer(raw?: string): number | null {
  if (!raw) return null;
  const t = raw.trim().replace(/[−–—]/g, '-').replace(/\*+$/, '').replace(/(\d)\s+(?=\d{3}(?:\D|$))/g, '$1');
  const num = (x: string) => Number(x.replace(',', '.'));
  const frac = t.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (frac) {
    const d = num(frac[2]);
    if (d) return num(frac[1]) / d;
  }
  const m = t.match(/^-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  // «12,04·10²³» — число со степенью десяти: не подменяем его мантиссой
  if (/^\s*[·x×*]\s*10/i.test(t.slice(m[0].length))) return null;
  return num(m[0]);
}

// Предупреждение, если у открытого вопроса ответ указан, но числом не распознан
function answerWarning(type: QuestionType, answer?: string): string[] {
  return type === 'open' && answer && parseNumericAnswer(answer) === null
    ? [`Ответ «${answer}» не распознан как число — вопрос сохранится без ответа`]
    : [];
}

// Поля текста для базы по языку записи
function langFields(lang: ImportLang | undefined, text: string, textTg?: string) {
  if (textTg !== undefined) return { text, text_ru: text || null, text_tg: textTg || null };
  return lang === 'tg' ? { text, text_ru: null, text_tg: text } : { text, text_ru: text, text_tg: null };
}

// Сравнение вопросов при защите от дублей: текст без тегов и лишних пробелов
const normText = (x: string | null | undefined) => (x || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function isCorrectLetter(answer: string | undefined, optionIndex: number): boolean {
  if (!answer) return false;
  // Допускаем кириллические двойники латинских букв (А, В, С, Е)
  const twin: Record<string, string> = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E' };
  const l = answer.trim().toUpperCase();
  return (twin[l] || l) === 'ABCDEF'[optionIndex];
}

interface ImportReport {
  total: number;
  inserted: number;
  skipped: number;
  failed: { rowNum: number; message: string }[];
}

export const BulkImport: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<'file' | 'text' | 'history'>('file');
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState('');
  // Язык одного файла и режим «пара файлов» (русский + таджикский → двуязычные вопросы)
  const [fileLang, setFileLang] = useState<ImportLang>('ru');
  const [pairMode, setPairMode] = useState(false);
  const [pairRu, setPairRu] = useState<File | null>(null);
  const [pairTg, setPairTg] = useState<File | null>(null);
  // Картинки из документов: временные blob-ссылки -> файлы (в хранилище попадают при импорте)
  const imagesRef = React.useRef<Map<string, File>>(new Map());
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  // Таксономия по умолчанию для импорта (сохраняется в localStorage)
  const [defaultSubjectId, setDefaultSubjectId] = useState(
    () => localStorage.getItem('examiner_import_subject_id') || ''
  );
  const [defaultChapterId, setDefaultChapterId] = useState(
    () => localStorage.getItem('examiner_import_chapter_id') || ''
  );
  const [defaultTopicId, setDefaultTopicId] = useState(
    () => localStorage.getItem('examiner_import_topic_id') || ''
  );

  React.useEffect(() => {
    localStorage.setItem('examiner_import_subject_id', defaultSubjectId);
  }, [defaultSubjectId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_import_chapter_id', defaultChapterId);
  }, [defaultChapterId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_import_topic_id', defaultTopicId);
  }, [defaultTopicId]);

  // Справочники
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ['all_chapters'],
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('is_deleted', false).order('order_index');
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ['all_topics'],
    queryFn: async () => {
      const { data } = await supabase.from('topics').select('*').eq('is_deleted', false).order('order_index');
      return (data || []) as Topic[];
    },
  });

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await supabase.from('sources').select('*').eq('is_deleted', false);
      return (data || []) as Source[];
    },
  });

  // Автовыбор первого предмета при первом запуске
  React.useEffect(() => {
    if (!defaultSubjectId && subjects.length > 0) {
      setDefaultSubjectId(subjects[0].id);
    }
  }, [subjects, defaultSubjectId]);

  const availableChapters = chapters.filter(c => !defaultSubjectId || c.subject_id === defaultSubjectId);
  const availableTopics = topics.filter(t => !defaultChapterId || t.chapter_id === defaultChapterId);

  // Найти текущие имена для назначения
  const getTaxonomyNames = () => {
    const subj = subjects.find(s => s.id === defaultSubjectId) || subjects[0];
    const chap = availableChapters.find(c => c.id === defaultChapterId) || availableChapters[0] || chapters[0];
    const top = availableTopics.find(t => t.id === defaultTopicId) || availableTopics[0] || topics[0];
    return {
      subjectName: subj?.name || 'Химия',
      chapterName: chap?.name || 'Общая химия',
      topicName: top?.name || 'Общие вопросы',
    };
  };

  // Парсинг сырых строковых данных (из CSV или Excel)
  const validateAndProcessRawData = (rows: any[]) => {
    const { subjectName: defSubj, chapterName: defChap, topicName: defTop } = getTaxonomyNames();
    const processed: ParsedRow[] = [];

    rows.forEach((row, idx) => {
      // Поддержка русских и английских названий колонок
      const typeRaw = (row['Тип вопроса'] || row['Type'] || row['type'] || 'test').toString().trim().toLowerCase();
      const content = (row['Текст вопроса'] || row['Question'] || row['content'] || '').toString().trim();
      const subjectName = (row['Предмет'] || row['Subject'] || row['subject'] || defSubj).toString().trim();
      const chapterName = (row['Глава'] || row['Chapter'] || row['chapter'] || defChap).toString().trim();
      const topicName = (row['Тема'] || row['Topic'] || row['topic'] || defTop).toString().trim();
      const sourceName = (row['Источник'] || row['Source'] || row['source'] || '').toString().trim();
      const optionsText = (row['Варианты ответа'] || row['Options'] || row['options'] || '').toString().trim();
      const matchingText = (row['Элементы соответствия'] || row['Matching'] || row['matching'] || '').toString().trim();
      const correctAnswer = (row['Ответ'] || row['Answer'] || row['answer'] || '').toString().trim();

      if (!content && !subjectName) return; // Пропуск пустых строк

      const errors: string[] = [];
      let type: QuestionType = 'test';
      if (typeRaw === 'test' || typeRaw === 'тест') type = 'test';
      else if (typeRaw === 'matching' || typeRaw === 'соответствие') type = 'matching';
      else if (typeRaw === 'open' || typeRaw === 'открытый') type = 'open';
      else errors.push(`Неизвестный тип вопроса "${typeRaw}". Разрешены: test, matching, open`);

      if (!content) errors.push('Отсутствует текст вопроса');
      if (!subjectName) errors.push('Не указан предмет');
      if (!chapterName) errors.push('Не указана глава');
      if (!topicName) errors.push('Не указана тема');

      if (type === 'test') {
        const opts = optionsText.split(/[|;]/).map((s: string) => s.trim()).filter(Boolean);
        if (opts.length < 2) errors.push('Для теста нужно минимум 2 варианта ответа (через разделитель | или ;)');
      }

      if (type === 'matching') {
        if (!matchingText.includes('||')) {
          errors.push('Для соответствия разделите левую и правую части знаками "||"');
        }
      }

      processed.push({
        rowNum: idx + 1,
        type,
        lang: fileLang,
        warnings: answerWarning(type, correctAnswer),
        content,
        subjectName,
        chapterName,
        topicName,
        sourceName,
        optionsText,
        matchingText,
        correctAnswer,
        errors,
      });
    });

    setParsedRows(processed);
  };

  // Загрузка файла (.docx / .xlsx / .xls / .csv)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setGlobalError(null);
    setStatusMessage(null);
    setSectionFilter('');
    setImportReport(null);

    const isDocx = file.name.endsWith('.docx');
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    // 1. ИМПОРТ ИЗ WORD (.DOCX) С АВТОМАТИЧЕСКИМ ИЗВЛЕЧЕНИЕМ ИЗОБРАЖЕНИЙ
    if (isDocx) {
      try {
        const parsed = await parseDocxFile(file, (msg) => setStatusMessage(msg));
        parsed.images.forEach((f, url) => imagesRef.current.set(url, f));
        const { subjectName, chapterName, topicName } = getTaxonomyNames();
        const sourceName = file.name.replace(/\.[^/.]+$/, '');

        const processed: ParsedRow[] = parsed.questions.map((q, idx) => {
          const errors: string[] = [];
          if (!q.content && !q.imageUrl) errors.push('Отсутствует текст и рисунок вопроса');
          if (q.type === 'test' && (!q.options || q.options.length < 2)) {
            errors.push('Меньше 2 вариантов ответа');
          }

          return {
            rowNum: idx + 1,
            type: q.type,
            lang: fileLang,
            warnings: answerWarning(q.type, q.correctAnswer),
            content: q.content,
            imageUrl: q.imageUrl || null,
            subjectName,
            chapterName,
            topicName,
            sourceName,
            optionsText: q.options ? q.options.map(o => o.text).join(' | ') : '',
            rawOptions: q.options,
            rawMatchingItems: q.matchingItems ? q.matchingItems.map(m => ({
              side: m.side,
              text: m.text,
              image_url: m.imageUrl || null,
              order_index: m.orderIndex,
            })) : undefined,
            correctAnswer: q.correctAnswer || '',
            section: q.section || undefined,
            errors,
          };
        });

        setParsedRows(processed);
      } catch (err: any) {
        setGlobalError('Ошибка импорта Word (.docx): ' + (err.message || String(err)));
      } finally {
        setIsProcessing(false);
        setStatusMessage(null);
      }
      return;
    }

    // 2. ИМПОРТ ИЗ EXCEL
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          validateAndProcessRawData(data);
        } catch (err: any) {
          setGlobalError('Ошибка чтения Excel: ' + err.message);
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsBinaryString(file);
    } else {
      // 3. ИМПОРТ ИЗ CSV
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          validateAndProcessRawData(results.data);
          setIsProcessing(false);
        },
        error: (err) => {
          setGlobalError('Ошибка парсинга CSV: ' + err.message);
          setIsProcessing(false);
        },
      });
    }
  };

  // Пара файлов: русский и таджикский варианты одного документа -> двуязычные вопросы
  const handleParsePair = async () => {
    if (!pairRu || !pairTg) return;
    setIsProcessing(true);
    setGlobalError(null);
    setStatusMessage(null);
    setSectionFilter('');
    setImportReport(null);
    try {
      setStatusMessage('Разбор русского файла...');
      const ru = await parseDocxFile(pairRu, (m) => setStatusMessage('Русский файл: ' + m));
      setStatusMessage('Разбор таджикского файла...');
      const tg = await parseDocxFile(pairTg, (m) => setStatusMessage('Таджикский файл: ' + m));
      ru.images.forEach((f, url) => imagesRef.current.set(url, f));
      tg.images.forEach((f, url) => imagesRef.current.set(url, f));

      const pairs = pairBilingual(ru.questions, tg.questions);
      const unusedTg = tg.questions.length - pairs.filter(p => p.contentTg).length;
      const { subjectName, chapterName, topicName } = getTaxonomyNames();
      const sourceName = pairRu.name.replace(/\.[^/.]+$/, '');

      const processed: ParsedRow[] = pairs.map((p, idx) => {
        const errors = [...p.errors];
        if (!p.content && !p.imageUrl) errors.push('Отсутствует текст и рисунок вопроса');
        if (p.type === 'test' && !errors.length && (!p.options || p.options.length < 2)) errors.push('Меньше 2 вариантов ответа');
        return {
          rowNum: idx + 1,
          type: p.type,
          lang: 'ru' as ImportLang,
          content: p.content,
          contentTg: p.contentTg,
          imageUrl: p.imageUrl || null,
          warnings: [...p.warnings, ...answerWarning(p.type, p.correctAnswer)],
          subjectName,
          chapterName,
          topicName,
          sourceName,
          optionsText: p.options ? p.options.map(o => o.text).join(' | ') : '',
          rawOptions: p.options?.map(o => ({ text: o.text, textTg: o.textTg, imageUrl: o.imageUrl })),
          rawMatchingItems: p.matchingItems?.map(m => ({
            side: m.side,
            text: m.text,
            text_tg: m.textTg,
            image_url: m.imageUrl || null,
            order_index: m.orderIndex,
          })),
          correctAnswer: p.correctAnswer || '',
          section: p.section || undefined,
          errors,
        };
      });
      setParsedRows(processed);
      if (unusedTg > 0) {
        setGlobalError(`Внимание: в таджикском файле ${unusedTg} вопр. не нашли пары в русском — они не будут импортированы.`);
      }
    } catch (err: any) {
      setGlobalError('Ошибка разбора пары файлов: ' + (err.message || String(err)));
    } finally {
      setIsProcessing(false);
      setStatusMessage(null);
    }
  };

  // Парсинг вставленного текста
  const handleParseText = () => {
    setIsProcessing(true);
    Papa.parse(pastedText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        validateAndProcessRawData(results.data);
        setIsProcessing(false);
      },
      error: (err: any) => {
        setGlobalError('Ошибка парсинга текста: ' + err.message);
        setIsProcessing(false);
      },
    });
  };

  // Применить выбранную таксономию ко всем строкам предпросмотра
  const handleApplyTaxonomyToAll = () => {
    const { subjectName, chapterName, topicName } = getTaxonomyNames();
    setParsedRows(prev =>
      prev.map(r => ({
        ...r,
        subjectName,
        chapterName,
        topicName,
      }))
    );
  };

  // Скачивание готового шаблона Excel
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Тип вопроса': 'test',
        'Текст вопроса': 'Какая формула у серной кислоты?',
        'Варианты ответа': 'H2SO4 | HCl | HNO3 | H3PO4',
        'Элементы соответствия': '',
        'Ответ': '',
        'Предмет': 'Химия',
        'Глава': 'Неорганическая химия',
        'Тема': 'Кислоты и основания',
        'Источник': 'Демоверсия 2025',
      },
      {
        'Тип вопроса': 'matching',
        'Текст вопроса': 'Установите соответствие между формулой и классом веществ',
        'Варианты ответа': '',
        'Элементы соответствия': 'А: NaOH; Б: H2SO4; В: NaCl || 1: Кислота; 2: Основание; 3: Соль; 4: Оксид',
        'Ответ': '',
        'Предмет': 'Химия',
        'Глава': 'Неорганическая химия',
        'Тема': 'Классификация веществ',
        'Источник': 'Сборник Кузьменко',
      },
      {
        'Тип вопроса': 'open',
        'Текст вопроса': 'Определите молярную массу метана CH4 (г/моль)',
        'Варианты ответа': '',
        'Элементы соответствия': '',
        'Ответ': '16',
        'Предмет': 'Химия',
        'Глава': 'Органическая химия',
        'Тема': 'Алканы',
        'Источник': 'ЕГЭ 2024',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Шаблон');
    XLSX.writeFile(wb, 'shablon_voprosov.xlsx');
  };

  // Сохранение проверенной партии в базу данных Supabase.
  // Каждая строка сохраняется независимо: ошибка одной не останавливает остальные и попадает в отчёт.
  // Уже имеющиеся в теме вопросы (тот же текст и варианты) пропускаются — повторный запуск не плодит дубли.
  const importMutation = useMutation({
    mutationFn: async (rowsToImport: ParsedRow[]): Promise<ImportReport> => {
      const report: ImportReport = { total: rowsToImport.length, inserted: 0, skipped: 0, failed: [] };

      const { data: batch, error: bErr } = await supabase
        .from('import_batches')
        .insert({
          created_by: user?.id,
          filename: `Партия от ${new Date().toLocaleDateString('ru-RU')} (${rowsToImport.length} вопр.)`,
          items_count: rowsToImport.length,
        })
        .select()
        .single();
      if (bErr || !batch) throw bErr;

      const localSubjects = [...subjects];
      const localChapters = [...chapters];
      const localTopics = [...topics];
      const localSources = [...sources];

      // Картинки загружаем в хранилище только сейчас (и каждую один раз)
      const uploaded = new Map<string, string>();
      const resolveImage = async (url?: string | null): Promise<string | null> => {
        if (!url) return null;
        if (!url.startsWith('blob:')) return url;
        const cached = uploaded.get(url);
        if (cached) return cached;
        const file = imagesRef.current.get(url);
        if (!file) throw new Error('Рисунок документа потерян — разберите файл заново');
        const publicUrl = await uploadQuestionImage(file);
        uploaded.set(url, publicUrl);
        return publicUrl;
      };

      // Отпечатки уже имеющихся в теме вопросов
      const fingerprints = new Map<string, Set<string>>();
      const fingerprint = (content: string, opts: string[], items: string[]) =>
        [normText(content), opts.map(normText).join('|'), items.map(normText).join('|')].join('#');
      const loadFingerprints = async (topicId: string): Promise<Set<string>> => {
        const known = fingerprints.get(topicId);
        if (known) return known;
        const set = new Set<string>();
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from('questions')
            .select('id, content, options:question_options(text, order_index), matching_items:matching_items(text, side, order_index)')
            .eq('topic_id', topicId)
            .eq('is_deleted', false)
            .order('id')
            .range(from, from + 999);
          if (error) throw error;
          for (const q of (data || []) as any[]) {
            const opts = [...(q.options || [])].sort((x, y) => x.order_index - y.order_index).map(o => o.text);
            const items = [...(q.matching_items || [])]
              .sort((x, y) => (x.side === y.side ? x.order_index - y.order_index : x.side < y.side ? -1 : 1))
              .map(m => m.text);
            set.add(fingerprint(q.content, opts, items));
          }
          if (!data || data.length < 1000) break;
        }
        fingerprints.set(topicId, set);
        return set;
      };

      const createTaxonomy = async <T,>(what: string, req: PromiseLike<{ data: T | null; error: any }>): Promise<T> => {
        const { data, error } = await req;
        if (error || !data) throw new Error(`не удалось создать ${what}: ${error?.message || 'нет прав'}`);
        return data;
      };

      interface Prepared {
        row: ParsedRow;
        topicId: string;
        key: string;
        question: Record<string, unknown>;
        options: Record<string, unknown>[];
        items: Record<string, unknown>[];
      }

      // Разбираем строку: раздел, источник, рисунки, строки вопроса/вариантов
      const prepare = async (row: ParsedRow): Promise<Prepared | null> => {
        const subj: Subject =
          localSubjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase()) ||
          (await createTaxonomy<Subject>('предмет', supabase.from('subjects').insert({ name: row.subjectName }).select().single()).then(x => { localSubjects.push(x); return x; }));
        const chap: Chapter =
          localChapters.find(c => c.subject_id === subj.id && c.name.toLowerCase() === row.chapterName.toLowerCase()) ||
          (await createTaxonomy<Chapter>('главу', supabase.from('chapters').insert({ subject_id: subj.id, name: row.chapterName }).select().single()).then(x => { localChapters.push(x); return x; }));
        const top: Topic =
          localTopics.find(t => t.chapter_id === chap.id && t.name.toLowerCase() === row.topicName.toLowerCase()) ||
          (await createTaxonomy<Topic>('тему', supabase.from('topics').insert({ chapter_id: chap.id, name: row.topicName }).select().single()).then(x => { localTopics.push(x); return x; }));
        let src: Source | undefined = row.sourceName ? localSources.find(s => s.name.toLowerCase() === row.sourceName!.toLowerCase()) : undefined;
        if (row.sourceName && !src) {
          src = await createTaxonomy<Source>('источник', supabase.from('sources').insert({ name: row.sourceName }).select().single());
          localSources.push(src);
        }

        // Тексты вариантов/элементов в порядке документа
        let optionDefs: { text: string; textTg?: string; imageUrl?: string | null }[] = [];
        if (row.type === 'test') {
          optionDefs = row.rawOptions && row.rawOptions.length > 0
            ? row.rawOptions
            : (row.optionsText || '').split(/[|;]/).map(t => t.trim()).filter(Boolean).map(t => ({ text: t }));
        }
        let itemDefs: { side: 'left' | 'right'; text: string; text_tg?: string; image_url?: string | null; order_index: number }[] = [];
        if (row.type === 'matching') {
          if (row.rawMatchingItems && row.rawMatchingItems.length > 0) {
            itemDefs = row.rawMatchingItems;
          } else if (row.matchingText) {
            const [leftPart, rightPart] = row.matchingText.split('||');
            const split = (x?: string) => (x || '').split(';').map(t => t.trim()).filter(Boolean);
            itemDefs = [
              ...split(leftPart).map((l, i) => ({ side: 'left' as const, text: l.replace(/^[А-ЯA-Z]:\s*/i, ''), order_index: i + 1 })),
              ...split(rightPart).map((r, i) => ({ side: 'right' as const, text: r.replace(/^[0-9]+:\s*/, ''), order_index: i + 1 })),
            ];
          }
        }

        const set = await loadFingerprints(top.id);
        const key = fingerprint(
          row.content,
          optionDefs.map(o => o.text),
          [...itemDefs].sort((x, y) => (x.side === y.side ? x.order_index - y.order_index : x.side < y.side ? -1 : 1)).map(m => m.text)
        );
        if (set.has(key)) return null; // дубль

        const bilingual = row.contentTg !== undefined;
        const lang: ImportLang = row.lang || 'ru';
        const imageUrl = await resolveImage(row.imageUrl);
        const optionRows: Record<string, unknown>[] = [];
        for (let i = 0; i < optionDefs.length; i++) {
          const o = optionDefs[i];
          optionRows.push({
            ...langFields(lang, o.text, bilingual ? (o.textTg ?? '') : undefined),
            image_url: await resolveImage(o.imageUrl),
            is_correct: isCorrectLetter(row.correctAnswer, i),
            order_index: i + 1,
          });
        }
        const itemRows: Record<string, unknown>[] = [];
        for (const m of itemDefs) {
          itemRows.push({
            side: m.side,
            ...langFields(lang, m.text, bilingual ? (m.text_tg ?? '') : undefined),
            image_url: await resolveImage(m.image_url),
            order_index: m.order_index,
          });
        }

        return {
          row,
          topicId: top.id,
          key,
          question: {
            batch_id: batch.id,
            subject_id: subj.id,
            chapter_id: chap.id,
            topic_id: top.id,
            source_id: src?.id || null,
            type: row.type,
            content: row.content || row.contentTg || '',
            content_ru: lang === 'tg' && !bilingual ? null : row.content || null,
            content_tg: bilingual ? row.contentTg || null : lang === 'tg' ? row.content : null,
            image_url: imageUrl,
            correct_numeric_answer: row.type === 'open' ? parseNumericAnswer(row.correctAnswer) : null,
            created_by: user?.id,
            version: 1,
          },
          options: optionRows,
          items: itemRows,
        };
      };

      // Пишем пачку вопросов одним запросом; при любой ошибке откатываем пачку и повторяем по одному
      const writeChunk = async (chunk: Prepared[]): Promise<void> => {
        const { data: ins, error } = await supabase.from('questions').insert(chunk.map(c => c.question)).select('id');
        let ids: string[] = [];
        try {
          if (error || !ins || ins.length !== chunk.length) throw error || new Error('база вернула не все строки');
          ids = ins.map((x: any) => x.id);
          const opts = chunk.flatMap((c, i) => c.options.map(o => ({ ...o, question_id: ids[i] })));
          const items = chunk.flatMap((c, i) => c.items.map(o => ({ ...o, question_id: ids[i] })));
          if (opts.length) await must(supabase.from('question_options').insert(opts));
          if (items.length) await must(supabase.from('matching_items').insert(items));
        } catch (e: any) {
          const toDrop = ids.length ? ids : (ins || []).map((x: any) => x.id);
          if (toDrop.length) {
            await supabase.from('questions').update({ is_deleted: true, deleted_at: new Date().toISOString() }).in('id', toDrop);
          }
          if (chunk.length === 1) throw e;
          for (const one of chunk) await writeChunk([one]).catch((err: any) => {
            report.failed.push({ rowNum: one.row.rowNum, message: err?.message || String(err) });
          });
          return;
        }
        chunk.forEach(c => fingerprints.get(c.topicId)?.add(c.key));
        report.inserted += chunk.length;
      };

      const pending: Prepared[] = [];
      const flush = async () => {
        const chunk = pending.splice(0, pending.length);
        if (chunk.length) {
          await writeChunk(chunk).catch((err: any) => {
            report.failed.push({ rowNum: chunk[0].row.rowNum, message: err?.message || String(err) });
          });
        }
      };

      for (const row of rowsToImport) {
        try {
          const prepared = await prepare(row);
          if (!prepared) { report.skipped++; continue; }
          // Одинаковые строки внутри самого файла тоже считаем дублями
          if (pending.some(p => p.key === prepared.key && p.topicId === prepared.topicId)) { report.skipped++; continue; }
          pending.push(prepared);
          if (pending.length >= 50) await flush();
        } catch (e: any) {
          report.failed.push({ rowNum: row.rowNum, message: e?.message || String(e) });
        }
      }
      await flush();

      await supabase.from('import_batches').update({ items_count: report.inserted }).eq('id', batch.id);
      return report;
    },
    meta: { action: 'Не удалось выполнить импорт' },
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
      queryClient.invalidateQueries({ queryKey: ['pool_stats'] });
      queryClient.invalidateQueries({ queryKey: ['all_chapters'] });
      queryClient.invalidateQueries({ queryKey: ['all_topics'] });
      setImportReport(report);
      if (report.failed.length === 0 && report.skipped === 0) {
        notifySuccess(`Импорт завершён: добавлено вопросов — ${report.inserted}`);
        onSuccess();
      } else {
        // Есть пропуски или ошибки — остаёмся на странице, показываем отчёт
        setParsedRows([]);
      }
    },
  });

  // История партий и откат для администратора
  const { data: batches = [] } = useQuery({
    queryKey: ['import_batches'],
    enabled: activeTab === 'history',
    queryFn: async () => {
      const { data } = await supabase.from('import_batches').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const revertBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      await must(supabase.from('questions').update({ is_deleted: true }).eq('batch_id', batchId));
      await must(supabase.from('import_batches').update({ is_reverted: true }).eq('id', batchId));
    },
    meta: { action: 'Не удалось откатить импорт', success: 'Импорт отменён: вопросы партии удалены из базы' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
    },
  });

  const sectionNames = Array.from(new Set(parsedRows.map(r => r.section).filter((x): x is string => !!x)));
  const visibleRows = sectionFilter ? parsedRows.filter(r => r.section === sectionFilter) : parsedRows;
  const validRows = visibleRows.filter(r => r.errors.length === 0);
  const errorRowsCount = visibleRows.filter(r => r.errors.length > 0).length;
  const warningRowsCount = visibleRows.filter(r => r.errors.length === 0 && (r.warnings?.length || 0) > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-5xl mx-auto my-6">
      {/* Header */}
      <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Upload className="w-5 h-5 mr-2 text-blue-600" />
            Импорт вопросов (Word .docx, Excel, CSV)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Прямой импорт документов Word с автоматическим извлечением картинок и формул
          </p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-300 shadow-sm flex items-center space-x-1.5 transition"
        >
          <Download className="w-4 h-4 text-emerald-600" />
          <span>Скачать шаблон Excel</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 px-6 bg-white text-xs font-semibold">
        <button
          onClick={() => setActiveTab('file')}
          className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
            activeTab === 'file' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Word (.docx) / Excel / CSV</span>
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
            activeTab === 'text' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Вставка текста</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
              activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>История партий и откат</span>
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {globalError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {globalError}
          </div>
        )}

        {/* Панель выбора раздела по умолчанию (для документов Word и общих таблиц) */}
        {activeTab !== 'history' && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center">
                <Layers className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                Раздел для вопросов (по умолчанию):
              </span>
              {parsedRows.length > 0 && (
                <button
                  type="button"
                  onClick={handleApplyTaxonomyToAll}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                >
                  Применить ко всем ({parsedRows.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Предмет</label>
                <select
                  value={defaultSubjectId}
                  onChange={(e) => {
                    setDefaultSubjectId(e.target.value);
                    setDefaultChapterId('');
                    setDefaultTopicId('');
                  }}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Глава</label>
                <select
                  value={defaultChapterId}
                  onChange={(e) => {
                    setDefaultChapterId(e.target.value);
                    setDefaultTopicId('');
                  }}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Выберите главу --</option>
                  {availableChapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Тема</label>
                <select
                  value={defaultTopicId}
                  onChange={(e) => setDefaultTopicId(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Выберите тему --</option>
                  {availableTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Вкладка 1: Файл (Word / Excel / CSV) */}
        {activeTab === 'file' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setPairMode(false)}
                  className={`px-3 py-1.5 font-semibold ${!pairMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Один файл
                </button>
                <button
                  type="button"
                  onClick={() => setPairMode(true)}
                  className={`px-3 py-1.5 font-semibold border-l border-slate-300 ${pairMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Пара файлов: русский + таджикский
                </button>
              </div>
              {!pairMode && (
                <label className="flex items-center gap-2 text-slate-600">
                  <span className="font-semibold">Язык файла:</span>
                  <select
                    value={fileLang}
                    onChange={(e) => setFileLang(e.target.value as ImportLang)}
                    className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ru">Русский</option>
                    <option value="tg">Таджикский</option>
                  </select>
                </label>
              )}
            </div>

            {pairMode ? (
              <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 space-y-4">
                <p className="text-xs text-slate-600">
                  Загрузите два варианта одного документа Word. Вопросы сопоставляются по разделу (§) и номеру,
                  варианты ответов — по ключу ответов и по формулам/числам (порядок вариантов в файлах разный).
                  Получатся двуязычные вопросы; несовпадения будут показаны в предпросмотре.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([['Русский файл (.docx)', pairRu, setPairRu], ['Таджикский файл (.docx)', pairTg, setPairTg]] as const).map(([label, file, setFile]) => (
                    <label key={label} className="block text-xs font-semibold text-slate-600 space-y-1">
                      <span>{label}</span>
                      <input
                        type="file"
                        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        disabled={isProcessing}
                        className="block w-full text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-semibold"
                      />
                      {file && <span className="block text-[11px] text-slate-400 truncate">{file.name}</span>}
                    </label>
                  ))}
                </div>
                <button
                  onClick={handleParsePair}
                  disabled={!pairRu || !pairTg || isProcessing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Распознать пару и сопоставить</span>
                </button>
                {isProcessing && statusMessage && <p className="text-xs text-blue-600 font-medium">{statusMessage}</p>}
              </div>
            ) : (
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-slate-50 hover:bg-slate-100/60 transition cursor-pointer relative">
            <input
              type="file"
              accept=".docx, .xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            {isProcessing ? (
              <div className="space-y-2 py-4">
                <Loader2 className="w-10 h-10 text-blue-600 mx-auto animate-spin" />
                <p className="font-bold text-slate-800 text-sm">Обработка документа...</p>
                {statusMessage && <p className="text-xs text-blue-600 font-medium">{statusMessage}</p>}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center space-x-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                </div>
                <p className="font-bold text-slate-800 text-sm">
                  Нажмите для выбора файла Word (.docx), Excel или CSV
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Картинки из файлов Word (.docx) извлекаются, сжимаются и прикрепляются к вопросам автоматически!
                </p>
              </>
            )}
          </div>
            )}
          </div>
        )}

        {/* Вкладка 2: Текст */}
        {activeTab === 'text' && (
          <div className="space-y-3">
            <textarea
              rows={6}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Вставьте таблицу с заголовками (например, скопированную из Excel или CSV)..."
              className="w-full p-3 font-mono text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleParseText}
              disabled={!pastedText.trim() || isProcessing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              Распознать и проверить текст
            </button>
          </div>
        )}

        {/* Вкладка 3: История партий (для админа) */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900 text-sm">Ранее загруженные партии вопросов</h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {batches.map((b: any) => (
                <div key={b.id} className="p-4 flex items-center justify-between bg-white hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-xs text-slate-900">{b.filename}</div>
                    <div className="text-[11px] text-slate-400">
                      Вопросов: {b.items_count} • Дата: {new Date(b.created_at).toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <div>
                    {b.is_reverted ? (
                      <span className="text-xs text-slate-400 font-medium">Откачено</span>
                    ) : (
                      <button
                        onClick={() => {
                          if (confirm(`Откатить эту партию (${b.items_count} вопр.)? Все они будут скрыты.`)) {
                            revertBatchMutation.mutate(b.id);
                          }
                        }}
                        className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 border border-red-200 rounded-lg flex items-center space-x-1 font-semibold"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Откатить партию</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Итог последнего импорта */}
        {importReport && activeTab !== 'history' && (
          <div className={`p-4 rounded-xl border text-xs space-y-2 ${importReport.failed.length ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="font-bold text-slate-900">
                Итог импорта: добавлено {importReport.inserted} из {importReport.total}
                {importReport.skipped > 0 && <> • пропущено как дубли: {importReport.skipped}</>}
                {importReport.failed.length > 0 && <> • не удалось: <span className="text-red-600">{importReport.failed.length}</span></>}
              </div>
              <button onClick={() => setImportReport(null)} className="text-slate-400 hover:text-slate-700" title="Закрыть">
                <X className="w-4 h-4" />
              </button>
            </div>
            {importReport.skipped > 0 && (
              <p className="text-slate-600">Дубли — вопросы с тем же текстом и вариантами, которые уже есть в этой теме. Повторный запуск импорта безопасен.</p>
            )}
            {importReport.failed.length > 0 && (
              <ul className="max-h-40 overflow-y-auto space-y-0.5 text-red-700">
                {importReport.failed.map((f, i) => (
                  <li key={i}>№ {f.rowNum}: {f.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Предпросмотр распознанных строк */}
        {parsedRows.length > 0 && activeTab !== 'history' && (
          <div className="space-y-4 pt-4 border-t border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Предварительный просмотр перед сохранением</h3>
                <p className="text-xs text-slate-500">
                  Готово к импорту: <span className="font-bold text-emerald-600">{validRows.length}</span> • 
                  Ошибок: <span className="font-bold text-red-600">{errorRowsCount}</span>
                  {warningRowsCount > 0 && (
                    <> • С предупреждениями: <span className="font-bold text-amber-600">{warningRowsCount}</span></>
                  )}
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setParsedRows([])}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  Очистить
                </button>
                <button
                  onClick={() => importMutation.mutate(validRows)}
                  disabled={validRows.length === 0 || importMutation.isPending}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Импортировать в базу ({validRows.length})</span>
                </button>
              </div>
            </div>

            {sectionNames.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <label className="font-semibold text-slate-600 shrink-0">Раздел документа:</label>
                <select
                  value={sectionFilter}
                  onChange={(e) => setSectionFilter(e.target.value)}
                  className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Все разделы ({parsedRows.length} вопр.)</option>
                  {sectionNames.map(name => (
                    <option key={name} value={name}>
                      {name} ({parsedRows.filter(r => r.section === name).length})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
              {visibleRows.map((r, i) => (
                <div key={i} className={`p-3 ${r.errors.length > 0 ? 'bg-red-50/50' : 'bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-slate-400 font-semibold">#{r.rowNum}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.type === 'test' ? 'bg-blue-100 text-blue-800' : r.type === 'matching' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {r.type === 'test' ? 'Тест' : r.type === 'matching' ? 'Соответствие' : 'Открытый'}
                        </span>
                        <div className="font-semibold text-slate-800 leading-snug">
                          <FormattedText text={r.content} />
                          {r.lang === 'tg' && r.contentTg === undefined && (
                            <span className="ml-2 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">ТЖ</span>
                          )}
                        </div>
                      </div>
                      {r.contentTg && (
                        <div className="pl-8 text-slate-600 leading-snug">
                          <span className="mr-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">ТЖ</span>
                          <FormattedText text={r.contentTg} />
                        </div>
                      )}

                      {r.errors.length > 0 ? (
                        <div className="mt-1 text-red-600 text-[11px] flex items-center space-x-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{r.errors.join('; ')}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-slate-500 text-[11px]">
                          {r.type === 'test' && r.rawOptions && (
                            <div className="flex flex-wrap gap-2 pt-0.5">
                              {r.rawOptions.map((opt, oIdx) => (
                                <span key={oIdx} className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                  <strong className="mr-1">{['A', 'B', 'C', 'D', 'E'][oIdx] || String(oIdx + 1)})</strong>
                                  <FormattedText text={opt.text} />
                                  {opt.textTg && opt.textTg !== opt.text && (
                                    <span className="ml-1 text-slate-400">/ <FormattedText text={opt.textTg} /></span>
                                  )}
                                  {opt.imageUrl && <ImageIcon className="w-3 h-3 text-blue-500 ml-1 inline" />}
                                </span>
                              ))}
                            </div>
                          )}
                          {r.type === 'test' && !r.rawOptions && r.optionsText && (
                            <span>Варианты: {r.optionsText}</span>
                          )}
                          {r.type === 'test' && r.correctAnswer && (
                            <div className="pt-0.5">Ответ: <strong className="text-slate-700">{r.correctAnswer}</strong></div>
                          )}
                          {r.type === 'matching' && r.rawMatchingItems && (
                            <span className="text-purple-700 font-medium">
                              Элементов соответствия: {r.rawMatchingItems.length} (ABCD / 12345)
                            </span>
                          )}
                          {r.type === 'open' && (
                            <span>Ответ: <strong className="text-slate-700">{r.correctAnswer || 'не указан'}</strong></span>
                          )}
                        </div>
                      )}
                      {r.errors.length === 0 && r.warnings && r.warnings.length > 0 && (
                        <div className="mt-1 text-amber-700 text-[11px] flex items-start space-x-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                          <span>{r.warnings.join('; ')}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      {r.imageUrl && (
                        <img
                          src={r.imageUrl}
                          alt="Изображение"
                          onClick={() => setPreviewImage(r.imageUrl || null)}
                          className="w-12 h-12 object-contain rounded-lg border border-slate-200 bg-slate-50 p-0.5 cursor-pointer hover:opacity-90 hover:scale-105 transition shadow-sm"
                          title="Нажмите для просмотра"
                        />
                      )}
                      <div className="text-[11px] text-slate-400 text-right">
                        <div>{r.subjectName}</div>
                        <div className="text-[10px] text-slate-300">{r.chapterName}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Модальное окно увеличения картинки (Lightbox) */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-11 right-0 text-white hover:text-slate-300 p-2 rounded-full bg-black/50 hover:bg-black/75 transition"
              title="Закрыть (Esc)"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewImage}
              alt="Увеличенное изображение"
              className="max-h-[85vh] max-w-full rounded-2xl shadow-2xl object-contain border border-white/20 bg-white p-2"
            />
          </div>
        </div>
      )}
    </div>
  );
};
