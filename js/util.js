// DOM helpers, formatting, routing utilities. No external dependencies.

/** Create an element. Strings become text nodes (never HTML), so API data is safe. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v; // only for constant markup written in this codebase
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}
export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  append(node, children);
  return node;
}
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function replace(node, ...children) { clear(node); return append(node, children); }

/* ---------- formatting ---------- */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const fmt = {
  int: n => (n === null || n === undefined || Number.isNaN(n)) ? '—' : nf0.format(n),
  compact: n => (n === null || n === undefined) ? '—' : nfCompact.format(n),
  pct: (n, d = 1) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : `${Number(n).toFixed(d)}%`,
  dec: (n, d = 1) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Number(n).toFixed(d),
  signed: n => (n === null || n === undefined) ? '—' : (n > 0 ? `+${nf0.format(n)}` : nf0.format(n)),
  rank: n => (n === null || n === undefined) ? '—' : `#${nf0.format(n)}`,
  duration: s => {
    if (s === null || s === undefined) return '—';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  },
  minutes: s => (s === null || s === undefined) ? '—' : `${Math.round(s / 60)} min`,
  date: iso => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—',
  dateTime: iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
  rel: iso => {
    if (!iso) return '—';
    const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
    const diff = Date.now() - t;
    const s = Math.round(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 36) return `${h} h ago`;
    const d = Math.round(h / 24); if (d < 45) return `${d} d ago`;
    const mo = Math.round(d / 30); if (mo < 18) return `${mo} mo ago`;
    return `${Math.round(d / 365)} y ago`;
  },
};

/* ---------- misc ---------- */
export const sum = a => a.reduce((x, y) => x + y, 0);
export const mean = a => a.length ? sum(a) / a.length : null;
export function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function groupBy(arr, keyFn) { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function winRate(w, l) { const n = w + l; return n ? (100 * w / n) : null; }

/* ---------- query strings & routing ---------- */
export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { path: '/' + parts.join('/'), parts, query: Object.fromEntries(new URLSearchParams(query)) };
}
export function navigate(path, query) { location.hash = `#${path}${qs(query)}`; }
export function hrefTo(path, query) { return `#${path}${qs(query)}`; }
export function setTitle(t) { document.title = t ? `${t} · Forge` : 'Forge — AoE IV Stats'; }

/* ---------- countries ---------- */
let displayNames = null;
try { displayNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { displayNames = null; }
export function countryName(cc) {
  if (!cc) return '';
  try { return displayNames?.of(cc.toUpperCase()) ?? cc.toUpperCase(); } catch { return cc.toUpperCase(); }
}
export function flagUrl(cc, w = 40) { return cc ? `https://flagcdn.com/w${w}/${cc.toLowerCase()}.png` : ''; }

/* ---------- colors ---------- */
export function cssVar(name, node = document.documentElement) { return getComputedStyle(node).getPropertyValue(name).trim(); }
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
/** Diverging colour for a win-rate style value around 50 (neg -> s8, mid -> neutral, pos -> s1). */
export function divergingColor(v, mid = 50, span = 15) {
  if (v === null || v === undefined) return 'transparent';
  const t = clamp((v - mid) / span, -1, 1);
  const neutral = cssVar('--div-mid'), pos = cssVar('--s1'), neg = cssVar('--s8');
  return t >= 0 ? mix(neutral, pos, t) : mix(neutral, neg, -t);
}
/** Sequential blue for 0..1 */
export function sequentialColor(t) {
  const steps = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700'].map(v => cssVar(v));
  const i = clamp(Math.floor(t * (steps.length - 1)), 0, steps.length - 1);
  return steps[i];
}
export function readableOn(rgbOrHex) {
  let r, g, b;
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgbOrHex);
  if (m) [r, g, b] = [+m[1], +m[2], +m[3]]; else [r, g, b] = hexToRgb(rgbOrHex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0b0b0b' : '#f0efec';
}
