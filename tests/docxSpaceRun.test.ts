import { describe, it, expect } from 'vitest';
import { cleanXmlRunsToFormattedText } from '../src/lib/docxParse';

const r = (t: string, b = true) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}</w:rPr><w:t${/^\s|\s$/.test(t) ? ' xml:space="preserve"' : ''}>${t}</w:t></w:r>`;

describe('пробел отдельным фрагментом Word', () => {
  it('слова не склеиваются, жирность не дробится', () => {
    const xml = r('Кадоме') + '<w:proofErr w:type="spellEnd"/>' + r(' ') + r('элементҳои') + r(' ') + r('химиявӣ');
    expect(cleanXmlRunsToFormattedText(xml)).toBe('Кадоме элементҳои химиявӣ');
  });
  it('пустой фрагмент без текста по-прежнему пропускается', () => {
    expect(cleanXmlRunsToFormattedText(r('а', false) + '<w:r><w:t></w:t></w:r>' + r('б', false))).toBe('аб');
  });
});

describe('коды символов XML', () => {
  it('&quot; и &amp; становятся обычными знаками', () => {
    expect(cleanXmlRunsToFormattedText(r('Слово &quot;Физика&quot; и Tom &amp; Jerry', false))).toBe('Слово "Физика" и Tom & Jerry');
  });
});
