// Минимальный генератор DOCX без зависимостей: ZIP без сжатия (метод store) + WordprocessingML.
// Вход — «блоки» (заголовки, абзацы, списки, таблицы, картинка PNG), выход — Blob .docx.
// Чистые функции (crc32, zipStore, xmlEscape, htmlToBlocks, docxXml) покрыты тестами в tests/.

const te = new TextEncoder();

// ---------------------------------------------------------------- ZIP (store)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** entries: [{ name, data: Uint8Array | string }] → Uint8Array ZIP-архива (без сжатия). */
export function zipStore(entries, now = new Date()) {
  const { time, date } = dosDateTime(now);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = te.encode(e.name);
    const data = typeof e.data === 'string' ? te.encode(e.data) : e.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true); central.setUint16(10, 0, true);
    central.setUint16(12, time, true); central.setUint16(14, date, true); central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true); central.setUint32(24, data.length, true); central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true); central.setUint16(32, 0, true); central.setUint16(34, 0, true); central.setUint16(36, 0, true); central.setUint32(38, 0, true); central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = centrals.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true); eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
  const parts = [...locals, ...centrals, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ---------------------------------------------------------------- WordprocessingML
export const xmlEscape = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const run = (text, { bold = false, italic = false, size = null, color = null } = {}) => {
  const props = [bold ? '<w:b/>' : '', italic ? '<w:i/>' : '', color ? `<w:color w:val="${color}"/>` : '', size ? `<w:sz w:val="${size}"/>` : ''].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
};
/** runs: строка или массив { text, bold, italic } */
const runs = (content, opts) => (Array.isArray(content) ? content.map((r) => run(r.text, { ...opts, ...r })).join('') : run(content, opts));
const para = (content, { style = null, align = null, keepNext = false, numbered = false, bullet = false, spacingAfter = null } = {}, ropts = {}) => {
  const p = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>' : bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
    spacingAfter !== null ? `<w:spacing w:after="${spacingAfter}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  return `<w:p>${p ? `<w:pPr>${p}</w:pPr>` : ''}${runs(content, ropts)}</w:p>`;
};
const cell = (content, { header = false, width = null } = {}) =>
  `<w:tc><w:tcPr>${width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : ''}${header ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F7"/>' : ''}</w:tcPr>${para(content, { spacingAfter: 0 }, { bold: header, size: 18 })}</w:tc>`;
const table = (rows, { header = true } = {}) => {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.floor(9600 / cols);
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFC7D1"/>`).join('');
  const body = rows.map((r, i) => `<w:tr>${i === 0 && header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((c) => cell(c, { header: header && i === 0, width })).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${body}</w:tbl>${para('', { spacingAfter: 120 })}`;
};
const EMU = 9525; // 1 px = 9525 EMU при 96 dpi
let imageSeq = 0;
const image = (rId, wPx, hPx, maxWPx = 640) => {
  const k = Math.min(1, maxWPx / wPx);
  const cx = Math.round(wPx * k * EMU), cy = Math.round(hPx * k * EMU);
  const id = ++imageSeq;
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="image${id}"/>
  <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr>
  <pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
  <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
  </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
};

/**
 * Блоки → word/document.xml. Блоки: { type: 'h1'|'h2'|'h3'|'p'|'small'|'li'|'oli'|'table'|'image'|'pagebreak', text|runs|rows|png }.
 * Картинка: { type: 'image', width, height } — вставляется ссылка rId1; сам PNG кладётся в архив в buildDocx.
 */
export function docxXml(blocks) {
  const body = blocks.map((b) => {
    switch (b.type) {
      case 'h1': return para(b.runs || b.text, { style: 'Heading1', keepNext: true });
      case 'h2': return para(b.runs || b.text, { style: 'Heading2', keepNext: true });
      case 'h3': return para(b.runs || b.text, { style: 'Heading3', keepNext: true });
      case 'small': return para(b.runs || b.text, { spacingAfter: 60 }, { size: 18, color: '5B6673' });
      case 'li': return para(b.runs || b.text, { bullet: true, spacingAfter: 40 });
      case 'oli': return para(b.runs || b.text, { numbered: true, spacingAfter: 40 });
      case 'table': return table(b.rows, { header: b.header !== false });
      case 'image': return image(b.rId || 'rId1', b.width, b.height, b.maxWidth || 640);
      case 'pagebreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      default: return para(b.runs || b.text || '', { spacingAfter: 120 });
    }
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

/** Нижний колонтитул: подпись слева, «Стр. N из M» справа (поля PAGE / NUMPAGES — Word считает сам). */
export function footerXml(label) {
  const fld = (instr) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5B6673"/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5B6673"/></w:rPr><w:tab/><w:t xml:space="preserve">Стр. </w:t></w:r>${fld('PAGE')}<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5B6673"/></w:rPr><w:t xml:space="preserve"> из </w:t></w:r>${fld('NUMPAGES')}</w:p></w:ftr>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1B2430"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="004080"/></w:pBdr></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="004080"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/**
 * Собрать .docx: блоки; картинки — блоки { type: 'image', width, height, png: Uint8Array, mime? }. Блок-картинка без байтов
 * выбрасывается. Для совместимости: опция png кладётся в первый image-блок без собственных байтов. Возвращает Uint8Array.
 */
export function buildDocx(blocks, { png = null, title = 'SOAM Investigator', footer = 'SOAM Investigator' } = {}) {
  imageSeq = 0;
  if (png) { const first = blocks.find((b) => b.type === 'image' && !b.png); if (first) first.png = png; }
  const images = [];
  const kept = blocks.filter((b) => {
    if (b.type !== 'image') return true;
    if (!b.png) return false;
    const ext = (b.mime || 'image/png').includes('jpeg') || (b.mime || '').includes('jpg') ? 'jpeg' : 'png';
    const n = images.length + 1;
    b.rId = `rId${9 + n}`;
    images.push({ rId: b.rId, name: `media/image${n}.${ext}`, data: b.png, ext });
    return true;
  });
  const exts = [...new Set(images.map((i) => i.ext))];
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((i) => `<Relationship Id="${i.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${i.name}"/>`).join('')}<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>SOAM Investigator</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;
  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: docxXml(kept) },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: NUMBERING },
    { name: 'word/footer1.xml', data: footerXml(footer) },
    { name: 'docProps/core.xml', data: core },
  ];
  for (const i of images) entries.push({ name: 'word/' + i.name, data: i.data });
  return zipStore(entries);
}

// ---------------------------------------------------------------- HTML отчёта → блоки
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const inlineRuns = (el) => {
  const out = [];
  const walk = (n, fmt) => {
    if (n.nodeType === 3) { const s = n.textContent.replace(/\s+/g, ' '); if (s) out.push({ text: s, ...fmt }); return; }
    if (n.nodeType !== 1) return;
    if (n.tagName === 'BR') { out.push({ text: ' · ' }); return; }
    const f = { ...fmt };
    if (n.tagName === 'STRONG' || n.tagName === 'B' || n.tagName === 'TH') f.bold = true;
    if (n.tagName === 'EM' || n.tagName === 'I') f.italic = true;
    if (n.tagName === 'SMALL') { f.size = 18; f.color = '5B6673'; }
    for (const c of n.childNodes) walk(c, f);
  };
  walk(el, {});
  // сжать пробелы на стыках
  return out.filter((r, i) => !(r.text === ' ' && (i === 0 || out[i - 1].text.endsWith(' ')))).map((r, i, a) => ({ ...r, text: i === 0 ? r.text.replace(/^\s+/, '') : r.text }));
};

/**
 * Печатный отчёт (HTML из report.js) → блоки DOCX. Один источник содержания: что в печати, то и в Word.
 * Элемент с классом rep-svg заменяется картинкой (размеры из SVG), rep-draft — красной строкой.
 */
export function htmlToBlocks(root) {
  const blocks = [];
  const walk = (el) => {
    for (const n of el.children) {
      const cls = n.classList;
      if (cls.contains('no-print')) continue;
      if (cls.contains('rep-svg')) {
        const svg = n.querySelector('svg');
        if (svg) blocks.push({ type: 'image', width: Number(svg.getAttribute('width')) || 800, height: Number(svg.getAttribute('height')) || 600, svg: svg.outerHTML });
        continue;
      }
      if (cls.contains('rep-brand')) { // логотип и название организации (шапка)
        const img = n.querySelector('img.rep-logo');
        if (img && img.src) blocks.push({ type: 'image', width: img.naturalWidth || 200, height: img.naturalHeight || 60, dataUrl: img.src, maxWidth: 180 });
        const org = n.querySelector('.rep-org');
        if (org) blocks.push({ type: 'p', runs: [{ text: text(org), bold: true }] });
        continue;
      }
      switch (n.tagName) {
        case 'H1': blocks.push({ type: 'h1', text: text(n) }); break;
        case 'H2': blocks.push({ type: 'h2', text: text(n) }); break;
        case 'H3': blocks.push({ type: 'h3', text: text(n) }); break;
        case 'P': blocks.push({ type: cls.contains('rep-kicker') ? 'small' : 'p', runs: inlineRuns(n) }); break;
        case 'DIV':
          if (cls.contains('rep-draft')) blocks.push({ type: 'p', runs: [{ text: text(n), bold: true, color: 'A50021' }] });
          else walk(n);
          break;
        case 'UL': for (const li of n.querySelectorAll(':scope > li')) blocks.push({ type: 'li', runs: inlineRuns(li) }); break;
        case 'OL': for (const li of n.querySelectorAll(':scope > li')) blocks.push({ type: 'oli', runs: inlineRuns(li) }); break;
        case 'TABLE': {
          const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => inlineRuns(td)));
          if (rows.length) blocks.push({ type: 'table', rows, header: !!n.querySelector('thead') || cls.contains('rep-meta') });
          break;
        }
        case 'FOOTER': blocks.push({ type: 'small', runs: inlineRuns(n) }); break;
        case 'SECTION': case 'HEADER': case 'ARTICLE': walk(n); break;
        default: if (text(n)) blocks.push({ type: 'p', runs: inlineRuns(n) });
      }
    }
  };
  walk(root);
  return blocks;
}
