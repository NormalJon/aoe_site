// "Pull every replay" control: starts the companion's background harvest for one player and shows its progress.
// The harvester lists the player's whole AoE4 World history, fetches each replay the official store still has
// (one at a time, pausing on rate limits) and keeps every player's perspective of each game in the store.
import { el, fmt } from '../util.js';
import { getJSON } from '../api.js';

const POLL_MS = 4000;
const ACTIVE = ['queued', 'running'];

/**
 * @param {object} o
 * @param {number|string} o.pid    profile id to harvest
 * @param {string} [o.label]       button text
 * @param {number} [o.pages]       pages of history (50 games each) to list, max 40
 * @param {function} [o.onProgress] called with the status every time the analysed count grows
 * @param {function} [o.onDone]     called once when a run that was active finishes
 */
export function harvestControl({ pid, label = 'Pull every replay', pages = 20, onProgress, onDone }) {
  const root = el('span', { class: 'harvest' });
  const btn = el('button', { class: 'btn sm', type: 'button', title: 'List this player’s whole history and analyse every replay the official store still has, in the background', onClick: () => start() }, label);
  const bar = el('span', { class: 'bar' }, el('span'));
  const text = el('span', { class: 'muted small' });
  bar.hidden = true;
  root.append(btn, bar, text);
  let timer = null, last = null;
  const url = (q = '') => `local/harvest/${pid}${q}`;
  const fetchStatus = q => getJSON(url(q), { ttl: 0, force: true });

  async function start() {
    btn.disabled = true; btn.textContent = 'Starting…';
    try { draw(await fetchStatus(`?start=1&pages=${pages}`)); poll(); }
    catch (e) { text.textContent = String(e.message || e); btn.disabled = false; btn.textContent = label; }
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!root.isConnected) return;
      try { draw(await fetchStatus()); } catch { /* keep the last status */ }
      if (last && ACTIVE.includes(last.state)) poll();
    }, POLL_MS);
  }
  function draw(h) {
    const prev = last; last = h;
    const running = ACTIVE.includes(h.state);
    btn.disabled = running;
    btn.textContent = running ? 'Pulling…' : h.state === 'done' ? 'Pull again' : label;
    const total = h.candidates || 0, progressed = (h.done || 0) + (h.not_found || 0) + (h.errors || 0);
    bar.hidden = !running || !total;
    if (total) bar.firstChild.style.width = `${Math.min(100, 100 * progressed / total)}%`;
    const stored = `${fmt.int(h.stored_stats || 0)} of this player’s games in the store`;
    text.textContent = h.state === 'idle' ? stored
      : h.state === 'queued' ? `queued behind another player · ${stored}`
      : running ? `${h.done || 0} of ${total} replays analysed${h.not_found ? ` · ${h.not_found} not in the store` : ''}${h.message ? ` · ${h.message}` : ''}`
      : `${stored} · ${h.message || h.state}${h.finished ? ` · ${fmt.rel(h.finished * 1000)}` : ''}`;
    if (onProgress && prev && (prev.done || 0) !== (h.done || 0)) onProgress(h);
    if (onDone && prev && ACTIVE.includes(prev.state) && !running) onDone(h);
  }
  fetchStatus().then(h => { draw(h); if (ACTIVE.includes(h.state)) poll(); }).catch(() => { /* no companion: the caller shows its own notice */ });
  return root;
}
