#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Собирает экзаменационные билеты и ключи в Word точно в том формате, который выдаёт сайт.
Нужен только Python 3 (сторонние библиотеки не требуются).

Запуск:   python make_tickets.py tickets.json [папка_для_результата]

Что делает:
  1. проверяет данные (состав билетов, ответы, повторы) и при ошибке ничего не создаёт;
  2. перемешивает варианты A–D и правую колонку соответствий, один раз на вопрос:
     русская и таджикская версии остаются одинаковыми, ключ у них общий;
  3. создаёт файлы «Вариант N.docx» / «Варианти N.docx» и «Ключи – <название>.docx»;
  4. если файлов больше одного, складывает их ещё и в ZIP, как сайт.

Формат tickets.json описан в файле «Промт.txt».
"""
import io
import json
import os
import random
import re
import struct
import sys
import zipfile
from datetime import date
from xml.sax.saxutils import escape

FONT = 'Times New Roman'
SIZE = 28  # 14 pt, в половинках пункта
LETTERS = 'ABCDE'
NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')

# ---------------------------------------------------------------- текст и формулы

def rpr(b=False, i=False, u=False, sub=False, sup=False, size=SIZE):
    return ('<w:rPr><w:rFonts w:ascii="%s" w:cs="%s" w:eastAsia="%s" w:hAnsi="%s"/>' % (FONT, FONT, FONT, FONT)
            + ('<w:b/><w:bCs/>' if b else '') + ('<w:i/><w:iCs/>' if i else '')
            + '<w:sz w:val="%d"/><w:szCs w:val="%d"/>' % (size, size)
            + ('<w:u w:val="single"/>' if u else '')
            + ('<w:vertAlign w:val="subscript"/>' if sub else '<w:vertAlign w:val="superscript"/>' if sup else '')
            + '</w:rPr>')


def run(text, **fmt):
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr(**fmt), escape(text))


def mrun(text):
    return '<m:r><m:t xml:space="preserve">%s</m:t></m:r>' % escape(text) if text else ''


def math_text(text):
    """Текст внутри формулы: <sub>/<sup> становятся настоящими индексами формулы."""
    text = re.sub(r'</?[biu]>', '', text)
    out, pos = '', 0
    for m in re.finditer(r'<sub>(.*?)</sub>(?:<sup>(.*?)</sup>)?|<sup>(.*?)</sup>', text):
        plain = text[pos:m.start()]
        pos = m.end()
        tail = re.search(r'\d+(?:\.\d+)?$', plain)
        base = tail.group(0) if tail else plain[-1:]
        out += mrun(plain[:len(plain) - len(base)])
        base = '<m:e>%s</m:e>' % mrun(base or ' ')
        sub, both, sup = m.group(1), m.group(2), m.group(3)
        if sub is not None and both is not None:
            out += '<m:sSubSup>%s<m:sub>%s</m:sub><m:sup>%s</m:sup></m:sSubSup>' % (base, mrun(sub), mrun(both))
        elif sub is not None:
            out += '<m:sSub>%s<m:sub>%s</m:sub></m:sSub>' % (base, mrun(sub))
        else:
            out += '<m:sSup>%s<m:sup>%s</m:sup></m:sSup>' % (base, mrun(sup))
    return out + mrun(text[pos:])


def strip_group(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == '(' and s[-1] == ')':
        depth = 0
        for i, c in enumerate(s):
            depth += (c == '(') - (c == ')')
            if depth == 0:
                return s[1:-1] if i == len(s) - 1 else s
    return s


def fraction(inner):
    m = re.search(r'(?<!<)/', inner)
    if not m:
        return math_text(inner)
    return '<m:f><m:num>%s</m:num><m:den>%s</m:den></m:f>' % (
        math_text(strip_group(inner[:m.start()])), math_text(strip_group(inner[m.end():])))


def rich(text, bold=False):
    """Текст с тегами <b> <i> <u> <sub> <sup> и дробями <frac>a/b</frac> -> фрагменты абзаца."""
    text = re.sub(r'\\frac\{([^{}]+)\}\{([^{}]+)\}', r'<frac>(\1)/(\2)</frac>', text or '')
    state = {'b': 0, 'i': 0, 'u': 0, 'sub': 0, 'sup': 0}
    out = []
    for part in re.split(r'(<frac>.*?</frac>)', text, flags=re.S):
        if part.startswith('<frac>'):
            out.append('<m:oMath>%s</m:oMath>' % fraction(part[6:-7]))
            continue
        pos = 0
        pieces = []
        for m in re.finditer(r'<(/?)(b|i|u|sub|sup)>', part):
            pieces.append((part[pos:m.start()], dict(state)))
            state[m.group(2)] = max(0, state[m.group(2)] + (-1 if m.group(1) else 1))
            pos = m.end()
        pieces.append((part[pos:], dict(state)))
        for t, s in pieces:
            if t:
                out.append(run(t, b=bold or s['b'] > 0, i=s['i'] > 0, u=s['u'] > 0, sub=s['sub'] > 0, sup=s['sup'] > 0))
    return ''.join(out)


# Оценка ширины текста Times New Roman: от неё зависит, как расставить варианты (4 в ряд, 2×2, столбиком)
def char_em(c):
    if c == ' ': return 0.25
    if c.isascii() and c.isdigit(): return 0.5
    if c in '+=<>±−': return 0.56
    if c in '→←⇄⇌↑↓': return 1.0
    if c in '()[]-/': return 0.34
    if c in ".,:;'!": return 0.27
    if c in 'iljtfI': return 0.3
    if c in 'mwMWЖШЩЫЮжшщфюы': return 0.78
    if re.match(r'[A-ZА-ЯЁҶҚҒӢӮҲ]', c): return 0.7
    return 0.48


def width_em(text):
    w, scale = 0.0, 1.0
    for part in re.split(r'(</?(?:sub|sup|b|i|u|frac)>)', text or ''):
        if part in ('<sub>', '<sup>'): scale = 0.6
        elif part in ('</sub>', '</sup>'): scale = 1.0
        elif not re.fullmatch(r'</?(?:b|i|u|frac)>', part):
            w += sum(char_em(c) for c in part) * scale
    return w


def option_width_pt(text):
    return (width_em(text) + 1.35) * (SIZE / 2) * 1.1


def inner_pt(twips):
    return (twips - 200) / 20

# ---------------------------------------------------------------- абзацы и таблицы

def p(content='', jc=None, before=None, after=None, keep=True, bdr='', shd='', line=None, extra=''):
    sp = ''
    if before is not None or after is not None or line is not None:
        sp = '<w:spacing' + ('' if before is None else ' w:before="%d"' % before) + \
             ('' if after is None else ' w:after="%d"' % after) + \
             ('' if line is None else ' w:line="%d" w:lineRule="exact"' % line) + '/>'
    return ('<w:p><w:pPr>' + ('<w:keepNext/><w:keepLines/>' if keep else '') + extra + bdr + shd + sp
            + ('<w:jc w:val="%s"/>' % jc if jc else '') + '</w:pPr>' + content + '</w:p>')


NONE = ''.join('<w:%s w:val="none" w:color="auto" w:sz="0"/>' % s for s in ('top', 'left', 'bottom', 'right'))
TOP_LINE = '<w:top w:val="single" w:color="000000" w:sz="8"/>' + NONE.split('/>', 1)[1]
CM = (80, 100, 80, 100)  # поля ячейки: верх, лево, низ, право


def tc(w, content, span=1, mar=CM, borders=NONE):
    return ('<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="%d"/>' % w
            + ('<w:gridSpan w:val="%d"/>' % span if span > 1 else '')
            + '<w:tcBorders>%s</w:tcBorders>' % borders
            + '<w:tcMar><w:top w:type="dxa" w:w="%d"/><w:left w:type="dxa" w:w="%d"/>'
              '<w:bottom w:type="dxa" w:w="%d"/><w:right w:type="dxa" w:w="%d"/></w:tcMar>' % mar
            + '</w:tcPr>' + content + '</w:tc>')


def tr(*cells):
    return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + ''.join(cells) + '</w:tr>'


def table(cols, rows):
    # Вопрос не разрывается между страницами: все абзацы «держатся со следующим», кроме последней строки
    rows = list(rows)
    rows[-1] = rows[-1].replace('<w:keepNext/>', '')
    none = ''.join('<w:%s w:val="none" w:color="auto" w:sz="0"/>' % s
                   for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    return ('<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="9348"/><w:tblBorders>%s</w:tblBorders></w:tblPr><w:tblGrid>' % none
            + ''.join('<w:gridCol w:w="%d"/>' % c for c in cols) + '</w:tblGrid>' + ''.join(rows) + '</w:tbl>')


def number_cell(n):
    # Серая плашка с номером: задана у абзаца, поэтому остаётся в одну строку при длинном вопросе
    bdr = ('<w:pBdr><w:top w:val="single" w:color="D9D9D9" w:sz="4" w:space="4"/>'
           '<w:left w:val="single" w:color="7F7F7F" w:sz="4" w:space="0"/>'
           '<w:bottom w:val="single" w:color="7F7F7F" w:sz="4" w:space="4"/>'
           '<w:right w:val="single" w:color="7F7F7F" w:sz="4" w:space="0"/></w:pBdr>')
    return tc(500, p(run(str(n), b=True), jc='center', before=0, after=0, bdr=bdr,
                     shd='<w:shd w:fill="D9D9D9" w:color="auto" w:val="clear"/>'),
              mar=(0, 0, 0, 0), borders=TOP_LINE)


def empty_cell():
    return tc(500, p())


def head_row(n, text, span):
    return tr(number_cell(n), tc(8848, p(rich(text, bold=True), before=80), span=span, mar=(0, 100, 80, 100), borders=TOP_LINE))


def label(mark, text):
    return run(mark + ') ', b=True) + rich(text)

# ---------------------------------------------------------------- картинки

class Media:
    def __init__(self):
        self.files = []

    def picture(self, path, max_w, max_h, max_scale=1.0):
        data = open(path, 'rb').read()
        w, h = image_size(data, path)
        k = min(max_w / w, max_h / h, max_scale)
        cx, cy = max(1, round(w * k)) * 9525, max(1, round(h * k)) * 9525
        self.files.append((data, 'jpeg' if data[:2] == b'\xff\xd8' else 'png'))
        n = len(self.files)
        drawing = ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="%d" cy="%d"/>'
                   '<wp:docPr id="%d" name="Picture %d"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                   '<pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="Picture %d"/><pic:cNvPicPr/></pic:nvPicPr>'
                   '<pic:blipFill><a:blip r:embed="rIdImg%d"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
                   '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
                   '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>') % (cx, cy, n, n, n, n, n, cx, cy)
        return p(drawing, jc='center')


def image_size(b, path):
    if b[:4] == b'\x89PNG':
        return struct.unpack('>II', b[16:24])
    if b[:2] == b'\xff\xd8':
        o = 2
        while o + 9 < len(b):
            if b[o] != 0xFF:
                o += 1
                continue
            m = b[o + 1]
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack('>HH', b[o + 5:o + 9])
                return w, h
            o += 2 + struct.unpack('>H', b[o + 2:o + 4])[0]
    raise SystemExit('Картинка должна быть PNG или JPEG: %s' % path)

# ---------------------------------------------------------------- вопрос

def question_table(q, n, lang, media):
    def tx(x):
        return x.get(lang) or ''

    def image_row(span):
        return [tr(empty_cell(), tc(8848, media.picture(q['image'], 540, 340, 2.5), span=span))] if q.get('image') else []

    def img(x, w, h):
        return media.picture(x['image'], w, h) if x.get('image') else ''

    if q['type'] == 'test':
        opts = q['options']
        widest = max(option_width_pt(tx(o)) for o in opts)
        has_img = any(o.get('image') for o in opts)
        if not has_img and widest <= inner_pt(2212):  # четыре в ряд
            cells = [tc(2212, p(label(LETTERS[i], tx(o)))) for i, o in enumerate(opts)]
            return table([500, 2212, 2212, 2212, 2212], [head_row(n, tx(q), 4)] + image_row(4) + [tr(empty_cell(), *cells)])
        if widest <= inner_pt(4424):  # два в ряд
            cell = lambda i: tc(4424, p(label(LETTERS[i], tx(opts[i]))) + img(opts[i], 140, 95))
            return table([500, 4424, 4424], [head_row(n, tx(q), 2)] + image_row(2)
                         + [tr(empty_cell(), cell(0), cell(1)), tr(empty_cell(), cell(2), cell(3))])
        rows = [tr(empty_cell(), tc(8848, p(label(LETTERS[i], tx(o))) + img(o, 180, 110))) for i, o in enumerate(opts)]
        return table([500, 8848], [head_row(n, tx(q), 1)] + image_row(1) + rows)  # столбиком

    if q['type'] == 'matching':
        rows = []
        for i in range(max(len(q['left']), len(q['right']))):
            l = q['left'][i] if i < len(q['left']) else None
            r = q['right'][i] if i < len(q['right']) else None
            rows.append(tr(empty_cell(),
                           tc(4424, p(label(LETTERS[i], tx(l))) + img(l, 130, 85) if l else p()),
                           tc(4424, p(label(str(i + 1), tx(r))) + img(r, 130, 85) if r else p())))
        return table([500, 4424, 4424], [head_row(n, tx(q), 2)] + image_row(2) + rows)

    answer = run('Ҷавоб: ' if lang == 'tg' else 'Ответ: ', b=True) + run('_' * 24)
    return table([500, 8848], [head_row(n, tx(q), 1)] + image_row(1) + [tr(empty_cell(), tc(8848, p(answer)))])

# ---------------------------------------------------------------- файл Word

def package(body, sect, media=None, header=None, footer=None):
    media = media or Media()
    rels, types = [], ''
    parts = {}
    rels.append('<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
    rels.append('<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>')
    for i, (data, ext) in enumerate(media.files, 1):
        name = 'media/image%d.%s' % (i, ext)
        parts['word/' + name] = data
        rels.append('<Relationship Id="rIdImg%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="%s"/>' % (i, name))
    refs = ''
    for kind, xml, tag in (('header', header, 'hdr'), ('footer', footer, 'ftr')):
        if xml:
            parts['word/%s1.xml' % kind] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:%s %s>%s</w:%s>' % (tag, NS, xml, tag)
            rels.append('<Relationship Id="rId%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/%s" Target="%s1.xml"/>' % (kind, kind, kind))
            refs += '<w:%sReference w:type="default" r:id="rId%s"/>' % (kind, kind)
            types += ('<Override PartName="/word/%s1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.%s+xml"/>' % (kind, kind))
    parts['word/document.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s<w:sectPr>%s%s</w:sectPr></w:body></w:document>'
                                  % (NS, body, refs, sect))
    parts['word/_rels/document.xml.rels'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                             + ''.join(rels) + '</Relationships>')
    parts['word/styles.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles %s><w:docDefaults><w:rPrDefault><w:rPr>'
                                '<w:rFonts w:ascii="%s" w:cs="%s" w:eastAsia="%s" w:hAnsi="%s"/><w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>'
                                '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>' % (NS, FONT, FONT, FONT, FONT, SIZE, SIZE))
    parts['word/settings.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings %s><w:compat><w:compatSetting w:val="15" w:name="compatibilityMode" '
                                  'w:uri="http://schemas.microsoft.com/office/word"/></w:compat></w:settings>' % NS)
    parts['_rels/.rels'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    parts['[Content_Types].xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                                    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
                                    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                                    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                                    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
                                    + types + '</Types>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', parts.pop('[Content_Types].xml'))
        for name, data in parts.items():
            z.writestr(name, data)
    return buf.getvalue()


def ticket_docx(ticket, lang):
    media = Media()
    title = ('Варианти %d' if lang == 'tg' else 'Вариант %d') % ticket['number']
    body = p(run(title, b=True, size=32), jc='center', after=80)
    body += p(after=180, bdr='<w:pBdr><w:bottom w:val="single" w:color="999999" w:sz="4" w:space="1"/></w:pBdr>')
    for i, q in enumerate(ticket['questions'], 1):
        body += question_table(q, i, lang, media)
        body += p(before=0, after=0, line=200)  # промежуток 10 pt между вопросами
    sect = ('<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" '
            'w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>')
    return package(body, sect, media)

# ---------------------------------------------------------------- ответы

def test_answer(q):
    return LETTERS[[bool(o.get('correct')) for o in q['options']].index(True)]


def matching_answer(q):
    return [str(l['match']) for l in q['left']]


def open_answer(q):
    return str(q['answer'])

# ---------------------------------------------------------------- ключи

SUBJECT_TITLES = [
    ('хим', 'химии', 'химия'), ('физ', 'физике', 'физика'), ('биол', 'биологии', 'биология'),
    ('тадж', 'таджикскому языку', 'забони тоҷикӣ'), ('тоҷик', 'таджикскому языку', 'забони тоҷикӣ'), ('забон', 'таджикскому языку', 'забони тоҷикӣ'),
]
GREY = 'E6E6E6'


def key_cell(text, boxed, sides, grey=False, bold=False):
    b = ''.join('<w:%s w:val="%s"/>' % (s, 'single" w:sz="4" w:space="0" w:color="auto' if on else 'nil')
                for s, on in zip(('top', 'left', 'bottom', 'right'), sides))
    shd = '<w:shd w:val="clear" w:color="auto" w:fill="%s"/>' % GREY if grey else ''
    return ('<w:tc><w:tcPr><w:tcW w:w="850" w:type="dxa"/><w:tcBorders>%s</w:tcBorders>%s<w:vAlign w:val="center"/></w:tcPr>' % (b, shd)
            + p(run(text, b=bold) if text else '', jc='center', keep=False, after=0) + '</w:tc>')


def key_grid(ticket, nt, nm, no):
    """Таблица ключа: 12 колонок — тесты | спейсер | соответствия | спейсер | открытые (4 клетки на ответ)."""
    qs = ticket['questions']
    tests = [q for q in qs if q['type'] == 'test']
    matching = [q for q in qs if q['type'] == 'matching']
    opens = [q for q in qs if q['type'] == 'open']
    cells = {}  # (строка, колонка) -> (текст, серый, жирный)
    for i, q in enumerate(tests):
        cells[(i, 0)] = (str(i + 1), True, True)
        cells[(i, 1)] = (test_answer(q), False, False)
    for i, q in enumerate(matching):
        r = i * 5
        cells[(r, 3)] = (str(nt + i + 1), True, True)
        for k, a in enumerate(matching_answer(q)):
            cells[(r + k, 4)] = (LETTERS[k], False, False)
            cells[(r + k, 5)] = (a, False, False)
    for i, q in enumerate(opens):
        r = i * 2
        cells[(r, 7)] = (str(nt + nm + i + 1), True, True)
        chars = list(open_answer(q))
        if len(chars) > 4:
            chars = chars[:3] + [''.join(chars[3:])]
        for k in range(4):
            cells[(r, 8 + k)] = (chars[k] if k < len(chars) else '', False, False)
    rows = ''
    for r in range(nt):
        row = ''
        for c in range(12):
            has = (r, c) in cells
            near = [(r - 1, c), (r, c - 1), (r + 1, c), (r, c + 1)]
            sides = [has or x in cells for x in near]
            text, grey, bold = cells.get((r, c), ('', False, False))
            row += key_cell(text, has, sides, grey, bold)
        rows += '<w:tr><w:trPr><w:trHeight w:val="386"/></w:trPr>%s</w:tr>' % row
    return ('<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'
            + '<w:gridCol w:w="850"/>' * 12 + '</w:tblGrid>' + rows + '</w:tbl>')


def key_docx_template(data, nt, nm, no):
    subject = data['subject'].lower()
    dat, tj = next(((d, t) for k, d, t in SUBJECT_TITLES if k in subject), (data['subject'], data['subject']))
    code = data.get('code', 'А.5')
    info = data.get('info_ru')
    center = lambda text, size, bold=True, keep=False: p(run(text, b=bold, size=size) if text else '', jc='center', after=0, keep=keep)
    body = ''
    for i, t in enumerate(data['tickets']):
        brk = '<w:pageBreakBefore/>' if i else ''
        body += p('', jc='center', after=0, keep=False, extra=brk)
        body += center('КЛЮЧИ', SIZE) + center('к субтесту по %s – %s' % (dat, code), SIZE) + center('', SIZE)
        body += center('Вариант(и) %d' % t['number'], SIZE) + center('', SIZE)
        body += key_grid(t, nt, nm, no)
    head = (center('Маркази омӯзишии Repetitor.tj // Образовательный центр Repetitor.tj', 24, False)
            + center('www.repetitor.tj // (+992) 003-003-007', 24, False)
            + center('_' * 72, 24, False) + center('', 24, False))
    if info:
        head += center('ВКЛЮЧЕНО В БИЛЕТЫ', SIZE) + center(info, 24)
    else:
        head += center('ҶАВОБИ ДУРУСТИ', SIZE) + center('саволу масъалаҳои субтести %s – %s' % (tj, code), SIZE)
    head += center('_' * 47, SIZE)
    line = '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    foot = ('<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="8700"/><w:gridCol w:w="1500"/></w:tblGrid><w:tr>'
            '<w:tc><w:tcPr><w:tcW w:w="8700" w:type="dxa"/><w:tcBorders>%s</w:tcBorders></w:tcPr>' % line
            + p(run('Имтиҳонҳои мувофиқи стандартҳои ММТ', size=22), jc='right', before=120, after=0, keep=False)
            + p(run('Промежуточные экзамены по стандартам НЦТ', size=22), jc='right', after=0, keep=False)
            + '</w:tc><w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/><w:tcBorders>%s<w:left w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>' % line
            + p(run(str(data.get('year', date.today().year)), size=40), jc='center', before=120, after=0, keep=False)
            + '</w:tc></w:tr></w:tbl>' + p(keep=False, after=0))
    sect = ('<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="851" w:right="567" w:bottom="851" w:left="1134" w:header="709" w:footer="340" w:gutter="0"/>')
    return package(body, sect, header=head, footer=foot)


def key_docx_universal(data):
    """Состав билета не совпал со стандартным: простая таблица № — Тип — Ответ на каждый вариант."""
    widths = (900, 2400, 6338)
    labels = {'test': 'Тест', 'matching': 'Соответствие', 'open': 'Открытый'}

    def cell(text, w, bold=False, fill=None, center=False):
        shd = '<w:shd w:val="clear" w:color="auto" w:fill="%s"/>' % fill if fill else ''
        return ('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s<w:vAlign w:val="center"/></w:tcPr>' % (w, shd)
                + p(run(text, b=bold, size=24), jc='center' if center else None, before=40, after=40, keep=False) + '</w:tc>')

    border = ''.join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="808080"/>' % s
                     for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    info = data.get('info_ru')
    body = ''
    for i, t in enumerate(data['tickets']):
        rows = ('<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + cell('№', widths[0], True, 'E7E6E6', True)
                + cell('Тип', widths[1], True, 'E7E6E6') + cell('Ответ', widths[2], True, 'E7E6E6') + '</w:tr>')
        for n, q in enumerate(t['questions'], 1):
            if q['type'] == 'test':
                ans = test_answer(q)
            elif q['type'] == 'open':
                ans = open_answer(q)
            else:
                ans = '   '.join('%s–%s' % (LETTERS[k], a) for k, a in enumerate(matching_answer(q)))
            rows += ('<w:tr><w:trPr><w:cantSplit/></w:trPr>' + cell(str(n), widths[0], center=True)
                     + cell(labels[q['type']], widths[1]) + cell(ans, widths[2], True) + '</w:tr>')
        body += p(run('Ключи – Вариант %d' % t['number'], b=True, size=32), jc='center', after=60 if info else 160, before=0,
                  keep=False, extra='<w:pageBreakBefore/>' if i else '')
        if info:
            body += p(run(info, size=22), jc='center', before=0, after=160, keep=False)
        body += ('<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/><w:tblBorders>%s</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' % (sum(widths), border)
                 + ''.join('<w:gridCol w:w="%d"/>' % w for w in widths) + '</w:tblGrid>' + rows + '</w:tbl>')
    sect = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>'
    return package(body, sect)


def key_docx(data):
    first = data['tickets'][0]['questions']
    counts = tuple(sum(q['type'] == k for q in first) for k in ('test', 'matching', 'open'))
    if counts in ((18, 2, 7), (20, 4, 2)) and any(k in data['subject'].lower() for k, _, _ in SUBJECT_TITLES):
        return key_docx_template(data, *counts)
    return key_docx_universal(data)

# ---------------------------------------------------------------- проверка данных

def fail(errors):
    print('ОШИБКИ В ДАННЫХ, файлы не созданы:')
    for e in errors:
        print(' -', e)
    sys.exit(1)


def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s or '')).strip().lower()


def validate(data):
    errors, warnings = [], []
    langs = {'ru': ['ru'], 'tg': ['tg'], 'both': ['ru', 'tg']}.get(data.get('languages', 'ru'))
    if not langs:
        errors.append('languages должен быть ru, tg или both')
        fail(errors)
    data['_langs'] = langs
    tickets = data.get('tickets') or []
    if not tickets:
        fail(['нет билетов'])
    seen = {}
    plan = None
    for t in tickets:
        n = t.get('number')
        where = 'Вариант %s' % n
        types = [q.get('type') for q in t.get('questions', [])]
        if types != sorted(types, key=lambda x: ('test', 'matching', 'open').index(x) if x in ('test', 'matching', 'open') else 9):
            errors.append('%s: порядок должен быть — тесты, соответствия, открытые' % where)
        counts = tuple(types.count(k) for k in ('test', 'matching', 'open'))
        if plan is None:
            plan = counts
        elif counts != plan:
            errors.append('%s: состав %s отличается от первого варианта %s' % (where, counts, plan))
        for i, q in enumerate(t.get('questions', []), 1):
            w = '%s, вопрос %d' % (where, i)
            texts = [q] + q.get('options', []) + q.get('left', []) + q.get('right', [])
            for lang in langs:
                if any(not (x.get(lang) or '').strip() and not x.get('image') for x in texts):
                    errors.append('%s: пустой текст на языке %s' % (w, lang))
                key = norm(q.get(lang))
                if key and not q.get('image'):
                    if key in seen:
                        errors.append('%s: вопрос повторяется (%s)' % (w, seen[key]))
                    seen.setdefault(key, w)
                for x in texts:
                    bad = re.findall(r'[А-Яа-яЁёҒғӢӣҚқӮӯҲҳҶҷ]+[A-Za-z]+[А-Яа-яЁё]*|[A-Za-z]+[А-Яа-яЁёҒғӢӣҚқӮӯҲҳҶҷ]+', re.sub(r'<[^>]+>', '', x.get(lang) or ''))
                    if bad:
                        warnings.append('%s: латиница и кириллица в одном слове: %s' % (w, ', '.join(bad)))
            if q.get('type') == 'test':
                opts = q.get('options', [])
                if len(opts) != 4:
                    errors.append('%s: вариантов должно быть 4, сейчас %d' % (w, len(opts)))
                if sum(bool(o.get('correct')) for o in opts) != 1:
                    errors.append('%s: верный вариант должен быть ровно один' % w)
                for lang in langs:
                    if len({norm(o.get(lang)) for o in opts}) < len(opts):
                        errors.append('%s: одинаковые варианты ответа' % w)
            elif q.get('type') == 'matching':
                left, right = q.get('left', []), q.get('right', [])
                if len(left) != 4 or len(right) != 5:
                    errors.append('%s: нужно 4 пункта слева и 5 справа, сейчас %d и %d' % (w, len(left), len(right)))
                if any(not isinstance(l.get('match'), int) or not 1 <= l['match'] <= len(right) for l in left):
                    errors.append('%s: match должен быть номером пункта справа от 1 до %d' % (w, len(right)))
                elif len({l['match'] for l in left}) < len(left):
                    warnings.append('%s: два пункта слева ведут к одному ответу справа' % w)
            elif q.get('type') == 'open':
                a = q.get('answer')
                if not isinstance(a, int) or isinstance(a, bool):
                    errors.append('%s: ответ открытого вопроса должен быть целым числом, сейчас %r' % (w, a))
                elif len(str(a)) > 4:
                    warnings.append('%s: ответ %s длиннее 4 знаков, в клетках ключа он не уместится' % (w, a))
            else:
                errors.append('%s: неизвестный тип %r' % (w, q.get('type')))
            paths = [x.get('image') for x in texts if x.get('image')]
            errors += ['%s: нет файла картинки %s' % (w, f) for f in paths if not os.path.exists(f)]
    if errors:
        fail(errors)
    return warnings


def shuffle(data):
    rnd = random.Random(data.get('seed'))
    for t in data['tickets']:
        for q in t['questions']:
            if q['type'] == 'test' and data.get('shuffle_options', True):
                rnd.shuffle(q['options'])
            if q['type'] == 'matching' and data.get('shuffle_matching', True):
                order = list(range(len(q['right'])))
                rnd.shuffle(order)
                q['right'] = [q['right'][i] for i in order]
                new_pos = {old + 1: new + 1 for new, old in enumerate(order)}
                for l in q['left']:
                    l['match'] = new_pos[l['match']]


def safe_name(s):
    return re.sub(r'\s+', ' ', re.sub(r'[\\/:*?"<>|\r\n]+', ' ', s)).strip()[:80] or 'Билеты'


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if len(sys.argv) < 2:
        raise SystemExit('Запуск: python make_tickets.py tickets.json [папка]')
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2] if len(sys.argv) > 2 else 'Билеты'
    base = os.path.dirname(os.path.abspath(sys.argv[1]))
    os.chdir(base)
    warnings = validate(data)
    shuffle(data)
    both = len(data['_langs']) == 2
    title = safe_name(data.get('title') or 'Экзаменационные билеты')
    files = {}
    for t in sorted(data['tickets'], key=lambda x: x['number']):
        if 'ru' in data['_langs']:
            files['%sВариант %d.docx' % ('Русский/' if both else '', t['number'])] = ticket_docx(t, 'ru')
        if 'tg' in data['_langs']:
            files['%sВарианти %d.docx' % ('Тоҷикӣ/' if both else '', t['number'])] = ticket_docx(t, 'tg')
    files['Ключи – %s.docx' % title] = key_docx(data)

    os.makedirs(out, exist_ok=True)
    for name, blob in files.items():
        path = os.path.join(out, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(blob)
    suffix = 'RU_TJ' if both else ('TJ' if data['_langs'] == ['tg'] else 'RU')
    archive = os.path.join(out, '%s_%s.zip' % (title, suffix))
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, blob in files.items():
            z.writestr(name, blob)

    print('Готово:', os.path.abspath(out))
    for name in files:
        print(' ', name)
    print(' ', os.path.basename(archive))
    print('\nСводка ответов (для сверки):')
    for t in data['tickets']:
        line = []
        for i, q in enumerate(t['questions'], 1):
            a = test_answer(q) if q['type'] == 'test' else open_answer(q) if q['type'] == 'open' else ''.join(matching_answer(q))
            line.append('%d:%s' % (i, a))
        print('  Вариант %d — %s' % (t['number'], ' '.join(line)))
    for w in sorted(set(warnings)):
        print('ВНИМАНИЕ:', w)


if __name__ == '__main__':
    main()
