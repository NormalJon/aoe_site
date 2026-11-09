// Shared pieces for replay build-order boards: blueprint icons, one order row, minute grouping.
// Used by the game summary (all players of one game) and by Compare (two players' games side by side).
import { el, fmt } from '../util.js';

export const AGE = { 2: 'Feudal', 3: 'Castle', 4: 'Imperial' };
export const AGE_ROMAN = ['', 'I', 'II', 'III', 'IV'];
const MIL_ROLES = ['cavalry', 'ranged', 'infantry', 'siege', 'naval', 'other'];

export function iconImg(bp, size = 28) {
  const img = el('img', { class: 'bp-icon', src: bp?.icon || '', alt: '', width: size, height: size, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => { img.replaceWith(el('span', { class: 'bp-icon fallback', style: { width: `${size}px`, height: `${size}px` } }, (bp?.name || '?').slice(0, 2))); });
  return img;
}

/** One replay order (`{t, k, id, n}`) as a row; `ages` marks the landmark/tech that started an age-up.
 *  A cancel (`k: 'cancel'`, `c`: the kind of order undone) shows struck through at the time it was cancelled. */
export function eventEl(ev, bps, ages = []) {
  const bp = bps[ev.id] || {};
  const cancel = ev.k === 'cancel';
  const ageUp = !cancel && ages.find(a => a.via === bp.name && Math.abs(a.time - ev.t) < 1);
  const title = `${fmt.duration(ev.t)} ${cancel ? 'cancelled ' : ''}${bp.name || ev.id}${ev.n > 1 ? ` × ${ev.n}` : ''}`;
  return el('div', { class: `bo-ev ${ev.k} ${bp.role || ''} ${ageUp ? 'ageup' : ''}`, title },
    el('span', { class: 'num t' }, fmt.duration(ev.t)), iconImg(bp, 22), el('span', { class: 'nm' }, bp.name || `#${ev.id}`),
    cancel ? el('span', { class: 'cx' }, 'cancelled') : null,
    ageUp ? el('span', { class: 'age-pill' }, `→ ${AGE[ageUp.age]}`) : null, ev.n > 1 ? el('span', { class: 'x' }, `× ${ev.n}`) : null);
}

/** Group orders by game minute: Map<minute, events[]>. */
export function groupEvents(events) {
  const m = new Map();
  for (const e of events) { const k = Math.floor(e.t / 60); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return m;
}

/** Running totals at the end of each minute (villagers and military queued, buildings placed) from the order
 *  stream, net of cancels: a cancel event takes its units or building back off the count. */
export function runningTotals(events, bps, minutes) {
  const out = []; let v = 0, mil = 0, b = 0;
  const byMin = groupEvents(events);
  for (let m = 0; m < minutes; m++) {
    for (const e of byMin.get(m) || []) {
      const bp = bps[e.id] || {};
      const sign = e.k === 'cancel' ? -1 : 1;
      const kind = e.k === 'cancel' ? e.c : e.k;
      if (kind === 'train' && bp.role === 'villager') v += sign * e.n;
      else if (kind === 'train' && MIL_ROLES.includes(bp.role)) mil += sign * e.n;
      else if (kind === 'build') b += sign * e.n;
    }
    out.push({ villagers: v, military: mil, buildings: b });
  }
  return out;
}
