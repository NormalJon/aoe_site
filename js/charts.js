// Hand-rolled SVG charts. Thin marks, hairline grid, crosshair tooltip, direct end labels.
import { el, svgEl, clear, fmt, cssVar } from './util.js';
import { showTooltip, hideTooltip, ttRows } from './components.js';

const resolveColor = c => c?.startsWith('--') ? `var(${c})` : c;

function niceTicks(min, max, count = 4) {
  if (!(isFinite(min) && isFinite(max))) return { ticks: [], lo: 0, hi: 1 };
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const rough = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= rough) ?? pow * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { ticks, lo, hi };
}
function timeTicks(t0, t1, count = 5) {
  const ticks = []; const span = t1 - t0;
  if (!(span > 0)) return [t0];
  for (let i = 0; i <= count; i++) ticks.push(t0 + span * i / count);
  return ticks;
}
function timeLabel(ms, span) {
  const d = new Date(ms);
  if (span < 3 * 86400e3) return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
  if (span < 400 * 86400e3) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}
function bisect(points, x) {
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid].x < x) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(points[lo - 1].x - x) < Math.abs(points[lo].x - x)) return lo - 1;
  return lo;
}

/**
 * Multi-series line chart over time.
 * series: [{ name, color ('--s1' or css color), points: [{x: ms, y, meta?}] }]
 */
export function lineChart({ series, height = 260, yFormat = v => fmt.int(v), xIsTime = true, directLabels = true, area = null, yDomain = null, emptyText = 'Not enough data to chart' }) {
  const root = el('div', { class: 'chart' });
  const data = series.filter(s => s.points && s.points.length).map(s => ({ ...s, points: [...s.points].sort((a, b) => a.x - b.x) }));
  if (!data.length || data.every(s => s.points.length < 2)) { root.append(el('div', { class: 'chart-empty' }, emptyText)); return root; }
  const showArea = area ?? data.length === 1;

  let ro = null;
  function render(width) {
    clear(root);
    const endTexts = directLabels && data.length <= 4 ? data.map(s => yFormat(s.points.at(-1).y)) : [];
    const M = { top: 14, right: endTexts.length ? Math.max(48, Math.max(...endTexts.map(t => t.length)) * 7.5 + 16) : 16, bottom: 26, left: 44 };
    const W = Math.max(240, width), H = height;
    const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
    const all = data.flatMap(s => s.points);
    const x0 = Math.min(...all.map(p => p.x)), x1 = Math.max(...all.map(p => p.x));
    let yMin = Math.min(...all.map(p => p.y)), yMax = Math.max(...all.map(p => p.y));
    if (yDomain) { yMin = yDomain[0]; yMax = yDomain[1]; }
    const pad = (yMax - yMin) * 0.08 || 10;
    const { ticks, lo, hi } = niceTicks(yMin - pad, yMax + pad, 4);
    const sx = x => M.left + (x1 === x0 ? pw / 2 : (x - x0) / (x1 - x0) * pw);
    const sy = y => M.top + ph - (y - lo) / (hi - lo) * ph;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${data.map(s => s.name).join(', ')} over time` });
    // grid + y ticks
    for (const t of ticks) {
      svg.append(svgEl('line', { class: 'grid-line', x1: M.left, x2: W - M.right, y1: sy(t), y2: sy(t) }));
      svg.append(svgEl('text', { class: 'tick', x: M.left - 8, y: sy(t) + 4, 'text-anchor': 'end' }, yFormat(t)));
    }
    // baseline + x ticks
    svg.append(svgEl('line', { class: 'axis-line', x1: M.left, x2: W - M.right, y1: M.top + ph, y2: M.top + ph }));
    const span = x1 - x0;
    const xt = timeTicks(x0, x1, Math.max(2, Math.min(6, Math.floor(pw / 110))));
    xt.forEach((t, i) => svg.append(svgEl('text', { class: 'tick', x: sx(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle' }, xIsTime ? timeLabel(t, span) : fmt.int(t))));

    // series
    data.forEach(s => {
      const color = resolveColor(s.color);
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
      if (showArea) svg.append(svgEl('path', { class: 'series-area', d: `${d}L${sx(s.points.at(-1).x).toFixed(1)},${(M.top + ph).toFixed(1)}L${sx(s.points[0].x).toFixed(1)},${(M.top + ph).toFixed(1)}Z`, fill: color }));
      svg.append(svgEl('path', { class: 'series-line', d, stroke: color }));
      const last = s.points.at(-1);
      svg.append(svgEl('circle', { class: 'end-dot', cx: sx(last.x), cy: sy(last.y), r: 4, fill: color }));
    });
    // direct end labels with collision nudging
    if (directLabels && data.length <= 4) {
      const labels = data.map(s => ({ s, y: sy(s.points.at(-1).y), text: yFormat(s.points.at(-1).y) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
      for (const l of labels) svg.append(svgEl('text', { class: 'end-label', x: W - M.right + 8, y: l.y + 4 }, l.text));
    }
    // hover layer
    const cross = svgEl('line', { class: 'crosshair', y1: M.top, y2: M.top + ph, visibility: 'hidden' });
    const dots = data.map(s => svgEl('circle', { class: 'hover-dot', r: 5, fill: resolveColor(s.color), visibility: 'hidden' }));
    svg.append(cross, ...dots);
    const hit = svgEl('rect', { class: 'hit', x: M.left, y: M.top, width: pw, height: ph, tabindex: 0, 'aria-label': 'Chart hover area. Use arrow keys to step through points.' });
    svg.append(hit);
    let focusIdx = null;
    const update = (clientX, clientY, px) => {
      const x = x0 + (px - M.left) / pw * (x1 - x0);
      const rows = [];
      let snapX = null;
      data.forEach((s, i) => {
        const idx = bisect(s.points, x); const p = s.points[idx];
        if (Math.abs(p.x - x) > span / 10 && data.length > 1) { dots[i].setAttribute('visibility', 'hidden'); return; }
        dots[i].setAttribute('cx', sx(p.x)); dots[i].setAttribute('cy', sy(p.y)); dots[i].setAttribute('visibility', 'visible');
        if (snapX === null) snapX = p.x;
        rows.push({ label: s.name, value: p.meta?.valueText ?? yFormat(p.y), color: resolveColor(s.color), when: p.x });
      });
      if (snapX === null) return;
      cross.setAttribute('x1', sx(snapX)); cross.setAttribute('x2', sx(snapX)); cross.setAttribute('visibility', 'visible');
      const title = xIsTime ? new Date(snapX).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : String(snapX);
      showTooltip(clientX, clientY, ttRows(title, rows));
    };
    const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hideTooltip(); };
    hit.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width);
      update(e.clientX, e.clientY, px);
    });
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('keydown', e => {
      const pts = data[0].points;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        focusIdx = focusIdx === null ? pts.length - 1 : Math.max(0, Math.min(pts.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
        const r = svg.getBoundingClientRect(); const px = sx(pts[focusIdx].x);
        update(r.left + px * (r.width / W), r.top + sy(pts[focusIdx].y) * (r.height / H), px);
      } else if (e.key === 'Escape') leave();
    });
    hit.addEventListener('blur', leave);
    root.append(svg);
    if (data.length > 1) root.append(el('div', { class: 'legend' }, data.map(s => el('span', { class: 'key' }, el('i', { style: { '--c': resolveColor(s.color) } }), s.name))));
  }
  // Render when attached and on resize.
  const start = () => { const w = root.clientWidth || root.parentElement?.clientWidth || 720; render(w); };
  if (typeof ResizeObserver !== 'undefined') {
    let last = 0;
    ro = new ResizeObserver(entries => { const w = Math.round(entries[0].contentRect.width); if (w && Math.abs(w - last) > 8) { last = w; render(w); } });
    ro.observe(root);
  }
  queueMicrotask(start);
  return root;
}

/** Tiny sparkline; `points` = numbers or {x,y}. */
export function sparkline(points, { color = '--s1', width = 120, height = 28 } = {}) {
  const ys = points.map(p => typeof p === 'number' ? p : p.y);
  if (ys.length < 2) return el('span', { class: 'muted small' }, '');
  const min = Math.min(...ys), max = Math.max(...ys);
  const sx = i => 2 + i / (ys.length - 1) * (width - 4);
  const sy = y => max === min ? height / 2 : 2 + (1 - (y - min) / (max - min)) * (height - 4);
  const d = ys.map((y, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join('');
  const c = resolveColor(color);
  return svgEl('svg', { class: 'sparkline', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svgEl('path', { d, fill: 'none', stroke: c, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }),
    svgEl('circle', { cx: sx(ys.length - 1), cy: sy(ys.at(-1)), r: 2.5, fill: c }));
}

/**
 * Heatmap grid. rows/cols: arrays of keys. value(r,c) -> number|null. color(v) -> css color.
 * rowLabel(r)/colLabel(c) -> Node. tooltip(r,c,v) -> Node.
 */
export function heatmap({ rows, cols, value, color, rowLabel, colLabel, tooltip, isSelf = (r, c) => r === c, ariaLabel = 'Heatmap' }) {
  const grid = el('div', { class: 'heatmap', role: 'table', 'aria-label': ariaLabel, style: { gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 1fr))` } });
  grid.append(el('div', { class: 'hm-corner' }));
  for (const c of cols) grid.append(el('div', { class: 'hm-col', role: 'columnheader' }, colLabel(c)));
  for (const r of rows) {
    grid.append(el('div', { class: 'hm-row', role: 'rowheader' }, rowLabel(r)));
    for (const c of cols) {
      const self = isSelf(r, c);
      const v = self ? null : value(r, c);
      const cell = el('div', { class: `cell ${self ? 'self' : ''}`, role: 'cell', tabindex: self ? null : 0 });
      if (!self) {
        cell.style.background = v === null || v === undefined ? 'var(--surface-2)' : color(v);
        cell.setAttribute('aria-label', `${v === null ? 'no data' : fmt.pct(v)}`);
        cell.addEventListener('pointermove', e => showTooltip(e.clientX, e.clientY, tooltip(r, c, v)));
        cell.addEventListener('pointerleave', hideTooltip);
        cell.addEventListener('focus', () => { const b = cell.getBoundingClientRect(); showTooltip(b.left + b.width / 2, b.top, tooltip(r, c, v)); });
        cell.addEventListener('blur', hideTooltip);
      }
      grid.append(cell);
    }
  }
  return grid;
}

export function scaleLegend(leftLabel, rightLabel, midLabel = '50%') {
  return el('div', { class: 'scale-legend' }, el('span', {}, leftLabel), el('span', { class: 'ramp' }), el('span', {}, rightLabel), el('span', { class: 'muted' }, `· midpoint ${midLabel}`));
}

export { cssVar };
