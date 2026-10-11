import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Subject, Chapter, Topic, Source, QuestionType } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { 
  Upload, 
  FileSpreadsheet, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  Trash2, 
  Loader2,
  Undo2
} from 'lucide-react';

interface ParsedRow {
  rowNum: number;
  type: QuestionType;
  content: string;
  subjectName: string;
  chapterName: string;
  topicName: string;
  sourceName?: string;
  optionsText?: string;
  matchingText?: string;
  correctAnswer?: string;
  errors: string[];
}

export const BulkImport: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<'file' | 'text' | 'history'>('file');
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Справочники
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false);
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ['all_chapters'],
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('is_deleted', false);
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ['all_topics'],
    queryFn: async () => {
      const { data } = await supabase.from('topics').select('*').eq('is_deleted', false);
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

  // Парсинг сырых строковых данных (из CSV или Excel)
  const validateAndProcessRawData = (rows: any[]) => {
    const processed: ParsedRow[] = [];

    rows.forEach((row, idx) => {
      // Поддержка русских и английских названий колонок
      const typeRaw = (row['Тип вопроса'] || row['Type'] || row['type'] || 'test').toString().trim().toLowerCase();
      const content = (row['Текст вопроса'] || row['Question'] || row['content'] || '').toString().trim();
      const subjectName = (row['Предмет'] || row['Subject'] || row['subject'] || '').toString().trim();
      const chapterName = (row['Глава'] || row['Chapter'] || row['chapter'] || '').toString().trim();
      const topicName = (row['Тема'] || row['Topic'] || row['topic'] || '').toString().trim();
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

  // Загрузка файла (Excel / CSV)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setGlobalError(null);

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

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

  // Скачивание готового шаблона CSV/Excel
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

  // Сохранение проверенной партии в базу
  const importMutation = useMutation({
    mutationFn: async (rowsToImport: ParsedRow[]) => {
      // 1. Создаем запись партии
      const { data: batch, error: bErr } = await supabase
        .from('import_batches')
        .insert({
          created_by: user?.id,
          filename: `Партия от ${new Date().toLocaleDateString('ru-RU')}`,
          items_count: rowsToImport.length,
        })
        .select()
        .single();

      if (bErr || !batch) throw bErr;

      // Кэши справочников для быстрого разрешения ID
      let localSubjects = [...subjects];
      let localChapters = [...chapters];
      let localTopics = [...topics];
      let localSources = [...sources];

      for (const row of rowsToImport) {
        // Предмет
        let subj = localSubjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase());
        if (!subj) {
          const { data: newS } = await supabase.from('subjects').insert({ name: row.subjectName }).select().single();
          if (newS) { subj = newS; localSubjects.push(newS); }
        }

        // Глава
        let chap = localChapters.find(c => c.subject_id === subj?.id && c.name.toLowerCase() === row.chapterName.toLowerCase());
        if (!chap && subj) {
          const { data: newC } = await supabase.from('chapters').insert({ subject_id: subj.id, name: row.chapterName }).select().single();
          if (newC) { chap = newC; localChapters.push(newC); }
        }

        // Тема
        let top = localTopics.find(t => t.chapter_id === chap?.id && t.name.toLowerCase() === row.topicName.toLowerCase());
        if (!top && chap) {
          const { data: newT } = await supabase.from('topics').insert({ chapter_id: chap.id, name: row.topicName }).select().single();
          if (newT) { top = newT; localTopics.push(newT); }
        }

        // Источник
        let src = row.sourceName ? localSources.find(s => s.name.toLowerCase() === row.sourceName!.toLowerCase()) : null;
        if (row.sourceName && !src) {
          const { data: newSrc } = await supabase.from('sources').insert({ name: row.sourceName }).select().single();
          if (newSrc) { src = newSrc; localSources.push(newSrc); }
        }

        if (!subj || !chap || !top) continue;

        // Вставляем вопрос
        const { data: q, error: qErr } = await supabase
          .from('questions')
          .insert({
            batch_id: batch.id,
            subject_id: subj.id,
            chapter_id: chap.id,
            topic_id: top.id,
            source_id: src?.id || null,
            type: row.type,
            content: row.content,
            correct_numeric_answer: row.type === 'open' && row.correctAnswer ? Number(row.correctAnswer) : null,
            created_by: user?.id,
            version: 1,
          })
          .select()
          .single();

        if (qErr || !q) continue;

        // Варианты тестов
        if (row.type === 'test' && row.optionsText) {
          const opts = row.optionsText.split(/[|;]/).map(s => s.trim()).filter(Boolean);
          const optionRows = opts.map((optText, i) => ({
            question_id: q.id,
            text: optText,
            order_index: i + 1,
          }));
          await supabase.from('question_options').insert(optionRows);
        }

        // Элементы соответствия
        if (row.type === 'matching' && row.matchingText) {
          const [leftPart, rightPart] = row.matchingText.split('||');
          const leftItems = (leftPart || '').split(/[;]/).map(s => s.trim()).filter(Boolean);
          const rightItems = (rightPart || '').split(/[;]/).map(s => s.trim()).filter(Boolean);

          const allItems = [
            ...leftItems.map((l, i) => ({
              question_id: q.id,
              side: 'left' as const,
              text: l.replace(/^[А-ЯA-Z]:\s*/i, ''),
              order_index: i + 1,
            })),
            ...rightItems.map((r, i) => ({
              question_id: q.id,
              side: 'right' as const,
              text: r.replace(/^[0-9]+:\s*/, ''),
              order_index: i + 1,
            })),
          ];
          await supabase.from('matching_items').insert(allItems);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
      onSuccess();
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
      // Мягко удаляем все вопросы этой партии
      await supabase.from('questions').update({ is_deleted: true }).eq('batch_id', batchId);
      await supabase.from('import_batches').update({ is_reverted: true }).eq('id', batchId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
    },
  });

  const validRows = parsedRows.filter(r => r.errors.length === 0);
  const errorRowsCount = parsedRows.filter(r => r.errors.length > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-5xl mx-auto my-6">
      {/* Header */}
      <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Upload className="w-5 h-5 mr-2 text-blue-600" />
            Массовый импорт вопросов
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Загрузка из Excel/CSV или вставка текста с предварительной проверкой
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
          className={`py-3 px-4 border-b-2 transition ${
            activeTab === 'file' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Файл Excel / CSV
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`py-3 px-4 border-b-2 transition ${
            activeTab === 'text' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Вставка текста
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 border-b-2 transition ${
              activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            История партий и откат
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {globalError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {globalError}
          </div>
        )}

        {/* Вкладка 1: Файл */}
        {activeTab === 'file' && (
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-slate-50 hover:bg-slate-100/60 transition cursor-pointer relative">
            <input
              type="file"
              accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <FileSpreadsheet className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="font-semibold text-slate-800 text-sm">
              Нажмите для выбора файла или перетащите его сюда
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Поддерживаются файлы .xlsx, .xls и .csv
            </p>
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

        {/* Предпросмотр распознанных строк */}
        {parsedRows.length > 0 && activeTab !== 'history' && (
          <div className="space-y-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Предварительный просмотр перед сохранением</h3>
                <p className="text-xs text-slate-500">
                  Готово к импорту: <span className="font-bold text-emerald-600">{validRows.length}</span> • 
                  Ошибок: <span className="font-bold text-red-600">{errorRowsCount}</span>
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
                  <span>Импортировать ({validRows.length})</span>
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
              {parsedRows.map((r, i) => (
                <div key={i} className={`p-3 ${r.errors.length > 0 ? 'bg-red-50/50' : 'bg-white'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-slate-400">#{r.rowNum}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        r.type === 'test' ? 'bg-blue-100 text-blue-800' : r.type === 'matching' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {r.type}
                      </span>
                      <span className="font-semibold text-slate-800">{r.content}</span>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      {r.subjectName} / {r.chapterName} / {r.topicName}
                    </div>
                  </div>

                  {r.errors.length > 0 ? (
                    <div className="mt-1 text-red-600 text-[11px] flex items-center space-x-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{r.errors.join('; ')}</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-slate-500 text-[11px] truncate">
                      {r.type === 'test' && `Варианты: ${r.optionsText}`}
                      {r.type === 'matching' && `Соответствия: ${r.matchingText}`}
                      {r.type === 'open' && `Ответ: ${r.correctAnswer || 'не указан'}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
