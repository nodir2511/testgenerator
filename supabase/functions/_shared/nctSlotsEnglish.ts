// Типы заданий НЦТ по английскому языку: код → число сессий (из 19: 2022–2026), в которых тип стоял в разделе и виде.
// АВТОГЕНЕРАЦИЯ scratch/english/nct/gen.mjs из «Анализ НЦТ английский язык 2022–2026». Разделы по номерам билета 2026:
// read — чтение (№ 1–8, текст и вопросы к нему), text — грамматика в тексте (№ 9–16, пропуски), gl — грамматика и лексика (№ 17–20),
// соответствия (№ 21–24) и порядок слов/предложений (№ 25–26, открытые). Коды с префиксом EN_, чтобы не пересекаться с другими предметами.
export const NCT_SLOT_TYPES_ENGLISH: Record<string, Record<string, number>> = {
  'gl:matching': {
    EN_M_DEF: 19,
    EN_M_CONT: 17,
    EN_M_SYN: 15,
    EN_M_REPLY: 14,
    EN_M_ANT: 4,
    EN_M_NUM: 4
  },
  'gl:open': {
    EN_O_SENT: 2,
    EN_O_TEXT: 2
  },
  'gl:test': {
    EN_LEX: 18,
    EN_COMP: 12,
    EN_PREP: 10,
    EN_BE: 8,
    EN_V_PRES: 8,
    EN_V_PERF: 7,
    EN_MODAL: 6,
    EN_CONJ: 5,
    EN_V_NONF: 5,
    EN_V_PAST: 5,
    EN_QUANT: 3,
    EN_V_FUT: 3,
    EN_WFORM: 3,
    EN_COND: 2,
    EN_TAG: 2,
    EN_V_PASS: 1
  },
  'read:test': {
    EN_R_MAIN: 19,
    EN_R_DET: 18,
    EN_R_LEX: 17,
    EN_R_NUM: 15,
    EN_R_PARA: 14,
    EN_R_WORD: 2,
    EN_R_INF: 1
  },
  'text:test': {
    EN_ART: 19,
    EN_BE: 19,
    EN_PREP: 19,
    EN_PRON: 19,
    EN_CONJ: 16,
    EN_COMP: 15,
    EN_QUANT: 14,
    EN_NOUNF: 12,
    EN_V_PAST: 11,
    EN_V_PRES: 11,
    EN_MODAL: 9,
    EN_V_NONF: 7,
    EN_LEX: 6,
    EN_ADV: 5,
    EN_WFORM: 5,
    EN_NUMW: 4,
    EN_V_PASS: 4,
    EN_V_PERF: 3,
    EN_V_FUT: 1
  }
};

/** Раздел каждого типа */
export const NCT_TYPE_SECTION_ENGLISH: Record<string, string> = {
  "EN_ADV": "text",
  "EN_ART": "text",
  "EN_BE": "text",
  "EN_COMP": "gl",
  "EN_COND": "gl",
  "EN_CONJ": "text",
  "EN_LEX": "gl",
  "EN_M_ANT": "gl",
  "EN_M_CONT": "gl",
  "EN_M_DEF": "gl",
  "EN_M_NUM": "gl",
  "EN_M_REPLY": "gl",
  "EN_M_SYN": "gl",
  "EN_MODAL": "gl",
  "EN_NOUNF": "text",
  "EN_NUMW": "text",
  "EN_O_SENT": "gl",
  "EN_O_TEXT": "gl",
  "EN_PREP": "text",
  "EN_PRON": "text",
  "EN_QUANT": "text",
  "EN_R_DET": "read",
  "EN_R_INF": "read",
  "EN_R_LEX": "read",
  "EN_R_MAIN": "read",
  "EN_R_NUM": "read",
  "EN_R_PARA": "read",
  "EN_R_WORD": "read",
  "EN_TAG": "gl",
  "EN_V_FUT": "gl",
  "EN_V_NONF": "text",
  "EN_V_PASS": "text",
  "EN_V_PAST": "text",
  "EN_V_PERF": "gl",
  "EN_V_PRES": "text",
  "EN_WFORM": "text"
};
