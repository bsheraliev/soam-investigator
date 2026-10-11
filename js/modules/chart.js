// Вкладка «Схема»: SOAM Chart в SVG по образцу QRG (стр. 47–49), связи между узлами, экспорт SVG/PNG.
// Текст в SVG переносится вручную (<text>/<tspan>), без HTML внутри SVG — чтобы PNG получался везде.
import { newId } from '../db.js';
import { t, tx } from '../i18n.js';
import { taxonomy, osf, barrier, element } from '../taxonomy.js';
import { escapeHtml, toast } from '../ui.js';
import { otherSafetyIssues, suggestLinks } from '../rules.js';

const LEVELS = ['other', 'OSF', 'CC', 'HI', 'BAR', 'outcome'];
const L = {
  colW: 200, gap: 56, pad: 8, font: 11, line: 14, nodeGap: 10, top: 16, headerH: 34, marginX: 16,
  family: 'Arial, Helvetica, sans-serif',
};
const COLORS = {
  header: '#ffff66', osf: '#ccffcc', cc: '#ffffff', hi: '#ffffff', bar: '#ccffcc', worked: '#cfe3ff',
  outcome: '#ffcc66', accident: '#a50021', ink: '#1b2430', line: '#a50021', border: '#333333', ext: '#777777',
};

let selected = null; // id узла, выбранного для связи

// ---------------------------------------------------------------- измерение текста
let _ctx;
function measure(text) {
  if (!_ctx) { _ctx = document.createElement('canvas').getContext('2d'); }
  _ctx.font = `${L.font}px ${L.family}`;
  return _ctx.measureText(text).width;
}
function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (measure(next) <= width || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ---------------------------------------------------------------- раскладка
function levelOf(c) {
  if (c.element === 'OSF') return c.otherSystem ? 'other' : 'OSF';
  return c.element;
}

export function layout(o, classes, factById) {
  const tax = taxonomy();
  const cols = {};
  for (const lv of LEVELS) cols[lv] = [];
  for (const c of classes) cols[levelOf(c)].push(c);
  for (const lv of LEVELS) cols[lv].sort((a, b) => (a.order || 0) - (b.order || 0));
  const present = LEVELS.filter((lv) => lv === 'outcome' || lv === 'OSF' || lv === 'CC' || lv === 'HI' || lv === 'BAR' || cols[lv].length);
  const textW = L.colW - 2 * L.pad;
  const nodes = {}; const columns = [];
  let x = L.marginX;
  for (const lv of present) {
    const col = { level: lv, x, title: lv === 'outcome' ? t('type.' + (o.type || 'unknown')).toUpperCase() : lv === 'other' ? t('soam.otherSystem') : tx(element(lv)), items: [] };
    let y = L.top + L.headerH + L.nodeGap;
    const list = lv === 'outcome'
      ? [{ id: '__outcome', lines: (o.outcome || []).flatMap((s) => wrap('• ' + s, textW)), kind: 'outcome' }]
      : cols[lv].map((c) => {
        const f = factById[c.factId];
        let head = null;
        if (c.element === 'OSF') head = (c.osfCodes || []).map((k) => `${k} (${osf(k) ? tx(osf(k)) : k})`).join(' / ');
        if (c.element === 'BAR' && (c.barrierType || c.barrierState)) head = [c.barrierType ? tx(barrier(c.barrierType)) : '', c.barrierState ? t('barrier.' + c.barrierState) : ''].filter(Boolean).join(' · ');
        if (c.element === 'CC' && c.ccCategory) head = tx(tax._cc[c.ccCategory]);
        return { id: c.id, cls: c, head: head ? wrap(head, textW) : [], lines: wrap(f ? f.text : c.factId, textW), kind: c.element.toLowerCase() };
      });
    for (const n of list) {
      const h = (n.head ? n.head.length : 0) * L.line + n.lines.length * L.line + 2 * L.pad + 2;
      Object.assign(n, { x, y, w: L.colW, h, cx: x + L.colW / 2, cy: y + h / 2 });
      nodes[n.id] = n; col.items.push(n);
      y += h + L.nodeGap;
    }
    col.h = y; columns.push(col);
    x += L.colW + L.gap;
  }
  const width = x - L.gap + L.marginX;
  const height = Math.max(...columns.map((c) => c.h), 200) + L.top;
  return { columns, nodes, width, height, levelIndex: Object.fromEntries(present.map((lv, i) => [lv, i])) };
}

// ---------------------------------------------------------------- отрисовка
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function textBlock(lines, x, y, opts = {}) {
  const { bold = false, size = L.font, fill = COLORS.ink, anchor = 'start' } = opts;
  return `<text x="${x}" y="${y}" font-family="${L.family}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" ${bold ? 'font-weight="bold"' : ''}>${lines.map((ln, i) => `<tspan x="${x}" dy="${i ? L.line : 0}">${esc(ln)}</tspan>`).join('')}</text>`;
}

function nodeSvg(n, lv, interactive) {
  let fill = COLORS.cc, stroke = COLORS.border, dash = '', sw = 1;
  if (n.kind === 'osf') fill = COLORS.osf;
  if (n.kind === 'bar') fill = n.cls.barrierState === 'worked' ? COLORS.worked : COLORS.bar;
  if (n.kind === 'outcome') fill = COLORS.outcome;
  if (n.cls && n.cls.otherSystem) { dash = 'stroke-dasharray="5 3"'; stroke = COLORS.ext; }
  if (n.cls && n.cls.confirmed !== true) { stroke = COLORS.line; sw = 2; }
  const sel = selected === n.id ? `<rect x="${n.x - 3}" y="${n.y - 3}" width="${n.w + 6}" height="${n.h + 6}" rx="10" fill="none" stroke="#0b5aa8" stroke-width="3"/>` : '';
  let ty = n.y + L.pad + L.font;
  let text = '';
  if (n.head && n.head.length) { text += textBlock(n.head, n.x + L.pad, ty, { bold: true }); ty += n.head.length * L.line; }
  text += textBlock(n.lines, n.x + L.pad, ty);
  const anchor = `${n.x + n.w / 2}`;
  const label = interactive ? ` tabindex="0" role="button" aria-label="${esc([...(n.head || []), ...(n.lines || [])].join(' ')).replace(/"/g, '&quot;')}"` : '';
  return `<g data-node="${esc(n.id)}" ${interactive ? 'style="cursor:pointer"' : ''}${label}>${sel}<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>${text}</g>`;
}

function linkPath(a, b, lay, style) {
  // ствол между колонками a и b, как в QRG
  const ax = a.x + a.w, bx = b.x;
  const trunk = ax + L.gap / 2;
  const d = `M ${ax} ${a.cy} H ${trunk} V ${b.cy} H ${bx}`;
  const dash = style === 'dotted' ? 'stroke-dasharray="3 3"' : '';
  return `<path d="${d}" fill="none" stroke="${COLORS.line}" stroke-width="1.4" ${dash}/>`;
}

export function renderSvg(o, lay, links, { interactive = false } = {}) {
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${lay.width}" height="${lay.height}" fill="#ffffff"/>`);
  for (const col of lay.columns) {
    const isOut = col.level === 'outcome';
    parts.push(`<rect x="${col.x}" y="${L.top}" width="${L.colW}" height="${L.headerH}" rx="7" fill="${isOut ? COLORS.accident : COLORS.header}" stroke="${COLORS.border}"/>`);
    const tl = wrap(col.title.toUpperCase(), L.colW - 12);
    parts.push(textBlock(tl.slice(0, 2), col.x + L.colW / 2, L.top + (tl.length > 1 ? 14 : 21), { bold: true, size: 10, anchor: 'middle', fill: isOut ? '#fff' : COLORS.ink }));
    for (const n of col.items) parts.push(nodeSvg(n, col.level, interactive));
  }
  for (const l of links) {
    const a = lay.nodes[l.fromId], b = lay.nodes[l.toId === o.id ? '__outcome' : l.toId];
    if (!a || !b || a.x >= b.x) continue;
    parts.push(linkPath(a, b, lay, l.style));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lay.width}" height="${lay.height}" viewBox="0 0 ${lay.width} ${lay.height}" font-family="${L.family}" role="img" aria-label="SOAM Chart: ${esc(tx(o.title)).replace(/"/g, '&quot;')}">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------- экспорт
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function safeName(o) { return ('soam-chart-' + tx(o.title)).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60); }

/** SVG-текст → PNG Blob (масштаб 2, белый фон для Word/печати). */
export async function svgToPngBlob(svgText, w, h, scale = 2) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(scale, scale); g.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

async function exportPng(svgText, w, h, name) {
  download(await svgToPngBlob(svgText, w, h), name + '.png');
}

// ---------------------------------------------------------------- вкладка
export async function renderTab(container, ctx) {
  const o = ctx.occurrence;
  const [classes, links] = await Promise.all([
    ctx.store.byIndex('classification', 'occurrenceId', ctx.id),
    ctx.store.byIndex('link', 'occurrenceId', ctx.id),
  ]);
  const factById = Object.fromEntries(ctx.facts.map((f) => [f.id, f]));
  const lay = layout(o, classes, factById);
  const svg = renderSvg(o, lay, links, { interactive: true });
  const other = otherSafetyIssues(ctx.facts);
  const unconfirmed = classes.filter((c) => c.confirmed !== true).length;

  container.innerHTML = `
    <div class="card chart-tools">
      <div class="btn-row top">
        <button class="btn secondary" id="expSvg">${t('chart.exportSvg')}</button>
        <button class="btn secondary" id="expPng">${t('chart.exportPng')}</button>
        <button class="btn secondary" id="suggest">${t('chart.suggest')}</button>
        <span class="small muted">${t('chart.counts', { nodes: classes.length, links: links.length })}</span>
      </div>
      <p class="small muted">${t('chart.howToLink')}${selected ? ` <strong>${t('chart.selected')}</strong> <button class="link" id="clearSel">${t('btn.cancel')}</button>` : ''}</p>
      ${(taxonomy().principles || {}).chart_links ? `<details class="hint"><summary>${t('chart.linksGuide')} <span class="muted small">(QRG, стр. 46)</span></summary><p>${esc(tx(taxonomy().principles.chart_links))}</p></details>` : ''}
      ${unconfirmed ? `<p class="small warn">${t('chart.unconfirmed', { n: unconfirmed })}</p>` : ''}
      <div class="legend small">
        <span><i style="background:${COLORS.osf}"></i>${t('chart.legend.osf')}</span>
        <span><i style="background:${COLORS.cc}"></i>${t('chart.legend.cc')}</span>
        <span><i style="background:${COLORS.worked}"></i>${t('chart.legend.worked')}</span>
        <span><i style="background:${COLORS.outcome}"></i>${t('chart.legend.outcome')}</span>
        <span><i style="border:2px solid ${COLORS.line};background:#fff"></i>${t('chart.legend.unconfirmed')}</span>
        <span><i style="border:1px dashed ${COLORS.ext};background:#fff"></i>${t('chart.legend.other')}</span>
      </div>
    </div>
    <div class="chart-wrap" id="chartWrap">${svg}</div>
    ${other.length ? `<div class="card"><h3>${t('sort.otherTitle')}</h3><ul>${other.map((f) => `<li>${escapeHtml(f.text)}</li>`).join('')}</ul></div>` : ''}`;

  const name = safeName(o);
  const cleanSvg = () => renderSvg(o, layout(o, classes, factById), links, { interactive: false });
  container.querySelector('#expSvg').addEventListener('click', () => download(new Blob([cleanSvg()], { type: 'image/svg+xml;charset=utf-8' }), name + '.svg'));
  container.querySelector('#expPng').addEventListener('click', () => exportPng(cleanSvg(), lay.width, lay.height, name).catch((e) => toast(t('error.title') + ': ' + e.message)));
  container.querySelector('#suggest').addEventListener('click', async () => {
    const events = await ctx.store.byIndex('event', 'occurrenceId', ctx.id);
    const sugg = suggestLinks({ classifications: classes, events, links, occurrenceId: o.id });
    if (!sugg.length) { toast(t('chart.suggestNone'), 5000); return; }
    if (!confirm(t('chart.suggestConfirm', { n: sugg.length }))) return;
    await ctx.store.putMany('link', sugg.map((l) => ({ id: newId(), occurrenceId: ctx.id, fromId: l.fromId, toId: l.toId, style: 'solid', reason: l.reason })));
    toast(t('chart.suggestApplied', { n: sugg.length })); ctx.refresh();
  });
  const clr = container.querySelector('#clearSel');
  if (clr) clr.addEventListener('click', () => { selected = null; ctx.refresh(); });

  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const lvIdx = (id) => id === '__outcome' ? lay.levelIndex.outcome : lay.levelIndex[levelOf(byId[id])];
  container.querySelectorAll('[data-node]').forEach((g) => g.addEventListener('click', async () => {
    const id = g.dataset.node;
    if (!selected) { selected = id; ctx.refresh(); return; }
    if (selected === id) { selected = null; ctx.refresh(); return; }
    let a = selected, b = id;
    if (lvIdx(a) > lvIdx(b)) [a, b] = [b, a];
    if (lvIdx(a) === lvIdx(b)) { toast(t('chart.sameLevel')); return; }
    const toId = b === '__outcome' ? o.id : b;
    if (a === '__outcome') { toast(t('chart.sameLevel')); return; }
    const existing = links.find((l) => l.fromId === a && l.toId === toId);
    if (existing) { await ctx.store.del('link', existing.id); toast(t('chart.linkRemoved')); }
    else { await ctx.store.put('link', { id: newId(), occurrenceId: ctx.id, fromId: a, toId, style: 'solid' }); toast(t('chart.linkAdded')); }
    selected = null; ctx.refresh();
  }));
}

export function reset() { selected = null; }
