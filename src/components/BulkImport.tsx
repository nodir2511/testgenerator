import React, { useState } from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import writeExcelFile from 'write-excel-file/browser';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { notifyError } from '../lib/errors';
import { Subject, Chapter, Topic, Source, QuestionType } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { parseDocxFile } from '../lib/docxImport';
import { pairBilingual } from '../lib/docxPair';
import { Upload, FileText, Download } from 'lucide-react';
import { checkImportRows, type RowCheck } from '../lib/importCheck';
import { Button, PageHeader } from './ui';
import { answerWarning, type ImportLang, type ImportReport, type ParsedRow } from '../lib/importParse';
import { withOpenAnswerError } from '../lib/openAnswer';
import { DefaultTaxonomyBar } from './bulk-import/DefaultTaxonomyBar';
import { FileTab } from './bulk-import/FileTab';
import { TextTab } from './bulk-import/TextTab';
import { HistoryTab } from './bulk-import/HistoryTab';
import { ImportReportCard } from './bulk-import/ImportReportCard';
import { PreviewTable } from './bulk-import/PreviewTable';
import { ImageLightbox } from './bulk-import/ImageLightbox';
import { useImportMutations } from './bulk-import/useImportMutations';

export const BulkImport: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const { user, isStaff: isAdmin, isOwner } = useAuth();

  const [activeTab, setActiveTab] = useState<'file' | 'text' | 'history'>('file');
  const [pastedText, setPastedText] = useState('');
  const [rawRows, setParsedRows] = useState<ParsedRow[]>([]);
  // Открытый вопрос с ключом не для клеток бланка (дробь, минус, слишком длинный) — ошибка строки; считается по текущему предмету строки
  const parsedRows = React.useMemo(() => rawRows.map(withOpenAnswerError), [rawRows]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState('');
  // Проверка на ошибки и дубли (только главный админ): результаты по номеру строки; сбрасываются при смене строк
  const [rowChecks, setRowChecks] = useState<Record<number, RowCheck> | null>(null);
  const [checking, setChecking] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  React.useEffect(() => { setRowChecks(null); setOnlyFlagged(false); }, [parsedRows]);
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
      const { data, error } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      if (error) throw error;
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ['all_chapters'],
    queryFn: async () => {
      const { data, error } = await supabase.from('chapters').select('*').eq('is_deleted', false).order('order_index');
      if (error) throw error;
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ['all_topics'],
    queryFn: async () => {
      const { data, error } = await supabase.from('topics').select('*').eq('is_deleted', false).order('order_index');
      if (error) throw error;
      return (data || []) as Topic[];
    },
  });

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sources').select('*').eq('is_deleted', false);
      if (error) throw error;
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
    // Только явно выбранные предмет, глава и тема: без подстановки чужих или выдуманных названий
    const subj = subjects.find(s => s.id === defaultSubjectId);
    const chap = subj ? chapters.find(c => c.id === defaultChapterId && c.subject_id === subj.id) : undefined;
    const top = chap ? topics.find(t => t.id === defaultTopicId && t.chapter_id === chap.id) : undefined;
    return { subjectName: subj?.name || '', chapterName: chap?.name || '', topicName: top?.name || '' };
  };
  const NEED_TAXONOMY = 'Сначала выберите предмет, главу и тему, в которые попадут вопросы (списки выше). Если списки пусты, подождите загрузки или обновите страницу.';
  const taxonomyChosen = () => { const n = getTaxonomyNames(); return Boolean(n.subjectName && n.chapterName && n.topicName); };

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
    e.target.value = ''; // тот же файл после правки можно выбрать снова
    if (!file) return;
    if (file.name.endsWith('.docx') && !taxonomyChosen()) { setGlobalError(NEED_TAXONOMY); return; }

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
      readSheet(file)
        .then((grid) => {
          // Первая строка — заголовки; пустые ячейки пропускаем, как раньше
          const [header = [], ...body] = grid;
          const data = body
            .map((cells) => {
              const row: Record<string, unknown> = {};
              header.forEach((h, i) => {
                const v = cells[i];
                if (h != null && v != null && v !== '') row[String(h).trim()] = v;
              });
              return row;
            })
            .filter((row) => Object.keys(row).length > 0);
          validateAndProcessRawData(data);
        })
        .catch((err: any) => {
          setGlobalError('Ошибка чтения Excel: ' + (err?.message || String(err)));
        })
        .finally(() => setIsProcessing(false));
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
    if (!taxonomyChosen()) { setGlobalError(NEED_TAXONOMY); return; }
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
    if (!taxonomyChosen()) { setGlobalError(NEED_TAXONOMY); return; }
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

    const columns = Object.keys(templateData[0]);
    const sheetData = [
      columns.map((c) => ({ value: c, fontWeight: 'bold' as const })),
      ...templateData.map((row) => columns.map((c) => ({ value: String((row as Record<string, unknown>)[c] ?? '') }))),
    ];
    void writeExcelFile(sheetData as any, { sheet: 'Шаблон', columns: columns.map(() => ({ width: 30 })) } as any).toFile('shablon_voprosov.xlsx');
  };

  const { importMutation, revertBatchMutation } = useImportMutations({ user, imagesRef, setImportReport, setParsedRows, onSuccess });

  // История партий и откат для администратора
  const { data: batches = [] } = useQuery({
    queryKey: ['import_batches'],
    enabled: activeTab === 'history',
    queryFn: async () => {
      const { data, error } = await supabase.from('import_batches').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const runChecks = async () => {
    if (checking) return;
    setChecking(true);
    try {
      setRowChecks(await checkImportRows(parsedRows, subjects, defaultSubjectId));
    } catch (e) {
      notifyError(e, 'Не удалось проверить вопросы');
    } finally {
      setChecking(false);
    }
  };
  const flagged = (r: ParsedRow) => { const c = rowChecks?.[r.rowNum]; return !!c && (c.codes.length > 0 || c.bank.length > 0 || c.inFile.length > 0); };
  const flaggedCount = rowChecks ? parsedRows.filter(flagged).length : 0;
  const sectionNames = Array.from(new Set(parsedRows.map(r => r.section).filter((x): x is string => !!x)));
  const visibleRows = (sectionFilter ? parsedRows.filter(r => r.section === sectionFilter) : parsedRows).filter(r => !onlyFlagged || flagged(r));
  const validRows = visibleRows.filter(r => r.errors.length === 0);
  const errorRowsCount = visibleRows.filter(r => r.errors.length > 0).length;
  const warningRowsCount = visibleRows.filter(r => r.errors.length === 0 && (r.warnings?.length || 0) > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-5xl xl:max-w-7xl mx-auto my-6">
      {/* Header */}
      <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <PageHeader
            icon={Upload}
            title="Импорт вопросов"
            description="Загрузите Word (.docx), Excel или CSV — картинки и формулы подтянутся сами"
            className="px-0"
          />
        </div>

        <Button variant="secondary" className="bg-white" onClick={handleDownloadTemplate}>
          <Download className="w-4 h-4 text-emerald-600" />
          <span>Скачать шаблон Excel</span>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 px-6 bg-white text-xs font-semibold">
        <button
          onClick={() => setActiveTab('file')}
          className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
            activeTab === 'file' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          } min-h-[40px]`}
        >
          <FileText className="w-4 h-4" />
          <span>Word (.docx) / Excel / CSV</span>
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
            activeTab === 'text' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          } min-h-[40px]`}
        >
          <span>Вставка текста</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
              activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            } min-h-[40px]`}
          >
            <span>История партий и откат</span>
          </button>
        )}
      </div>

      <div className={`p-6 space-y-6 ${parsedRows.length > 0 && activeTab !== 'history' ? 'xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] xl:gap-8 xl:items-start' : ''}`}>
      <div className="space-y-6 min-w-0">
        {globalError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {globalError}
          </div>
        )}

        {/* Панель выбора раздела по умолчанию (для документов Word и общих таблиц) */}
        {activeTab !== 'history' && (
          <DefaultTaxonomyBar parsedRows={parsedRows} handleApplyTaxonomyToAll={handleApplyTaxonomyToAll} subjects={subjects} availableChapters={availableChapters} availableTopics={availableTopics} defaultSubjectId={defaultSubjectId} defaultChapterId={defaultChapterId} defaultTopicId={defaultTopicId} setDefaultSubjectId={setDefaultSubjectId} setDefaultChapterId={setDefaultChapterId} setDefaultTopicId={setDefaultTopicId} />
        )}

        {/* Вкладка 1: Файл (Word / Excel / CSV) */}
        {activeTab === 'file' && (
          <FileTab pairMode={pairMode} setPairMode={setPairMode} fileLang={fileLang} setFileLang={setFileLang} pairRu={pairRu} setPairRu={setPairRu} pairTg={pairTg} setPairTg={setPairTg} isProcessing={isProcessing} statusMessage={statusMessage} handleParsePair={handleParsePair} handleFileUpload={handleFileUpload} />
        )}

        {/* Вкладка 2: Текст */}
        {activeTab === 'text' && (
          <TextTab pastedText={pastedText} setPastedText={setPastedText} handleParseText={handleParseText} isProcessing={isProcessing} />
        )}

        {/* Вкладка 3: История партий (для админа) */}
        {activeTab === 'history' && (
          <HistoryTab batches={batches} revertBatchMutation={revertBatchMutation} />
        )}

        {/* Итог последнего импорта */}
        {importReport && activeTab !== 'history' && (
          <ImportReportCard importReport={importReport} setImportReport={setImportReport} />
        )}

        </div>

        {/* Предпросмотр распознанных строк: на широком экране — справа от настроек */}
        {parsedRows.length > 0 && activeTab !== 'history' && (
          <PreviewTable parsedRows={parsedRows} setParsedRows={setParsedRows} validRows={validRows} errorRowsCount={errorRowsCount} warningRowsCount={warningRowsCount} importMutation={importMutation} isOwner={isOwner} runChecks={runChecks} checking={checking} rowChecks={rowChecks} flaggedCount={flaggedCount} onlyFlagged={onlyFlagged} setOnlyFlagged={setOnlyFlagged} sectionNames={sectionNames} sectionFilter={sectionFilter} setSectionFilter={setSectionFilter} visibleRows={visibleRows} setPreviewImage={setPreviewImage} />
        )}
      </div>

      {/* Модальное окно увеличения картинки (Lightbox) */}
      {previewImage && (
        <ImageLightbox previewImage={previewImage} setPreviewImage={setPreviewImage} />
      )}
    </div>
  );
};
