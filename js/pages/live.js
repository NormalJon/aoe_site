import { el, fmt, setTitle, hrefTo, navigate, clear, groupBy } from '../util.js';
import { api } from '../api.js';
import { select, card, statTile, resultPill, flattenTeams, notice, skeleton, errorBox, emptyState, gameRow } from '../components.js';
import { civName, civFlag, kindName } from '../constants.js';
import { pageHead } from './_shared.js';

const KINDS = [{ value: '', label: 'All modes' }, { value: 'rm_1v1', label: 'Ranked 1v1' }, { value: 'rm_2v2', label: 'Ranked 2v2' }, { value: 'rm_3v3', label: 'Ranked 3v3' }, { value: 'rm_4v4', label: 'Ranked 4v4' }, { value: 'qm_1v1', label: 'QM 1v1' }, { value: 'qm_2v2', label: 'QM 2v2' }, { value: 'qm_3v3', label: 'QM 3v3' }, { value: 'qm_4v4', label: 'QM 4v4' }];

function liveCard(g) {
  const teams = flattenTeams(g);
  const started = new Date(g.started_at).getTime();
  const elapsed = Math.max(0, Math.round((Date.now() - started) / 1000));
  const player = p => el('div', { class: 'p' },
    el('img', { src: civFlag(p.civilization), alt: civName(p.civilization), title: civName(p.civilization), width: 24, height: 13, style: { borderRadius: '2px', boxShadow: '0 0 0 1px var(--border)' } }),
    el('a', { class: 'pname', href: hrefTo(`/player/${p.profile_id}`), style: { color: 'var(--ink)' } }, p.name || `#${p.profile_id}`),
    p.rating ? el('span', { class: 'r' }, fmt.int(p.rating)) : (p.mmr ? el('span', { class: 'r', title: 'hidden MMR' }, fmt.int(p.mmr)) : null));
  return el('div', { class: 'live-card' },
    el('div', { class: 'top' }, el('span', {}, el('strong', { style: { color: 'var(--ink)' } }, g.map), ` · ${kindName(g.kind)}`), el('span', {}, g.ongoing ? resultPill('live') : el('span', {}, fmt.duration(g.duration)))),
    el('div', { class: 'teams' }, teams.map((t, i) => [i > 0 ? el('div', { class: 'vs' }, 'vs') : null, el('div', { class: 'team' }, t.map(player))])),
    el('div', { class: 'top' }, el('span', {}, g.server || ''), el('span', {}, g.ongoing ? `started ${fmt.rel(g.started_at)} · ${fmt.duration(elapsed)} elapsed` : `finished ${fmt.rel(g.updated_at)}`),
      g.average_rating ? el('span', { title: 'average rating' }, `avg ${fmt.int(g.average_rating)}`) : (g.average_mmr ? el('span', { title: 'average hidden MMR' }, `avg MMR ${fmt.int(g.average_mmr)}`) : null),
      g.ongoing && teams[0]?.[0] ? el('a', { class: 'small', href: hrefTo(`/player/${teams[0][0].profile_id}`), title: `Open ${teams[0][0].name}'s profile: the live game panel shows this game with intel on the opponents` }, 'Live view ›') : null));
}

export async function render(app, route) {
  setTitle('Live games');
  let kind = KINDS.some(k => k.value === route.query.kind) ? route.query.kind : '';
  let auto = route.query.auto !== '0';
  const sub = el('span', {}, 'Games starting and finishing right now across every ladder.');
  app.append(pageHead('Live', sub));
  const autoBtn = el('button', { class: 'btn sm', type: 'button', 'aria-pressed': String(auto) }, auto ? 'Auto-refresh: on' : 'Auto-refresh: off');
  const refreshBtn = el('button', { class: 'btn sm', type: 'button' }, 'Refresh now');
  const stamp = el('span', { class: 'muted small' });
  app.append(el('div', { class: 'filters' },
    el('label', {}, 'Mode ', select(KINDS, kind, v => { kind = v; navigate('/live', { kind: v, auto: auto ? undefined : '0' }); }, { ariaLabel: 'Mode' })),
    refreshBtn, autoBtn, el('span', { class: 'spacer' }), stamp));
  const tiles = el('div', { class: 'tiles', style: { marginBottom: '16px' } });
  const liveBox = el('div'), doneBox = el('div', { class: 'game-list card flush' });
  app.append(tiles, el('h2', { style: { margin: '8px 0 10px' } }, 'In progress'), liveBox, el('h2', { style: { margin: '22px 0 10px' } }, 'Just finished'), doneBox);

  let timer = null; let first = true;
  async function load() {
    if (first) { liveBox.append(skeleton(6)); doneBox.append(skeleton(6)); }
    else { liveBox.classList.add('fade'); doneBox.classList.add('fade'); }
    try {
      const [started, updated] = await Promise.all([
        api.games({ order: 'started_at', per_page: 50, leaderboard: kind || undefined }),
        api.games({ order: 'updated_at', per_page: 50, leaderboard: kind || undefined }),
      ]);
      const seen = new Set(); const all = [];
      for (const g of [...(started.games || []), ...(updated.games || [])]) if (!seen.has(g.game_id)) { seen.add(g.game_id); all.push(g); }
      const live = all.filter(g => g.ongoing).sort((a, b) => (b.average_rating ?? b.average_mmr ?? 0) - (a.average_rating ?? a.average_mmr ?? 0) || new Date(b.started_at) - new Date(a.started_at));
      const done = all.filter(g => !g.ongoing && g.state === 'processed').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 20);
      const byKind = [...groupBy(live, g => g.kind)].sort((a, b) => b[1].length - a[1].length);
      const servers = [...groupBy(live, g => g.server || 'Unknown')].sort((a, b) => b[1].length - a[1].length);
      tiles.replaceChildren(
        statTile({ label: 'Live games in view', value: String(live.length), sub: `of ${all.length} recent games sampled` }),
        statTile({ label: 'Busiest mode', value: byKind[0] ? kindName(byKind[0][0]) : '—', sub: byKind[0] ? `${byKind[0][1].length} live` : null }),
        statTile({ label: 'Busiest server', value: servers[0]?.[0] ?? '—', sub: servers[0] ? `${servers[0][1].length} live` : null }),
        statTile({ label: 'Highest-rated live game', value: live[0]?.average_rating ? fmt.int(live[0].average_rating) : (live[0]?.average_mmr ? fmt.int(live[0].average_mmr) : '—'), sub: live[0] ? `${live[0].map} · ${kindName(live[0].kind)}` : null }));
      clear(liveBox); liveBox.append(live.length ? el('div', { class: 'live-grid' }, live.map(liveCard)) : emptyState('No live games in the sampled window.'));
      clear(doneBox); if (done.length) for (const g of done) doneBox.append(gameRow(g)); else doneBox.append(emptyState('Nothing finished recently.'));
      stamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      clear(liveBox); liveBox.append(errorBox(e, load));
    }
    liveBox.classList.remove('fade'); doneBox.classList.remove('fade'); first = false;
  }
  function schedule() { clearInterval(timer); if (auto) timer = setInterval(load, 30000); }
  refreshBtn.addEventListener('click', load);
  autoBtn.addEventListener('click', () => { auto = !auto; autoBtn.textContent = auto ? 'Auto-refresh: on' : 'Auto-refresh: off'; autoBtn.setAttribute('aria-pressed', String(auto)); schedule(); });
  await load(); schedule();
  app.append(el('p', { class: 'muted small', style: { marginTop: '14px' } }, 'The feed samples the 50 most recently started and 50 most recently updated games; ratings appear once the game is rated. "Live view" opens a player’s profile, whose live game panel shows the match with intel on the opponents.'));
  return () => clearInterval(timer);
}
