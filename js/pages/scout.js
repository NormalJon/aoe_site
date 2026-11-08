// Scout: paste a lobby (up to 8 names, two teams) or open it from a live game → ratings, form, civ pools,
// playstyle tags, team averages and which side is favoured. Everything is public API data; playstyle tags
// need the local companion (replays).
import { el, fmt, setTitle, hrefTo, navigate, clear, mean, winRate } from '../util.js';
import { api, getJSON } from '../api.js';
import { playerLink, civChip, rankBadge, select, card, notice, skeleton, errorBox, emptyState, bindTooltip, ttRows, statTile, streakEl } from '../components.js';
import { LEADERBOARDS, parseRankLevel, civName } from '../constants.js';
import { pageHead } from './_shared.js';

const MODES = LEADERBOARDS.map(l => ({ value: l.key, label: l.name }));

export async function render(app, route) {
  setTitle('Scout a lobby');
  const q = route.query;
  const mode = LEADERBOARDS.some(l => l.key === q.mode) ? q.mode : 'rm_team';
  app.append(pageHead('Scout', 'Paste the names from a lobby or loading screen — one per line, two teams — and see who you are up against: ratings, recent form, civ pools and playstyle tags. Or open a live game from the Live page.'));

  const taA = el('textarea', { rows: 5, placeholder: 'Team 1 — one name per line', 'aria-label': 'Team 1 names' }, (q.a_names || '').split(',').filter(Boolean).join('\n'));
  const taB = el('textarea', { rows: 5, placeholder: 'Team 2 — one name per line', 'aria-label': 'Team 2 names' }, (q.b_names || '').split(',').filter(Boolean).join('\n'));
  const go = () => navigate('/scout', { mode, a_names: lines(taA.value).join(',') || undefined, b_names: lines(taB.value).join(',') || undefined, a: undefined, b: undefined });
  app.append(el('div', { class: 'scout-input grid cols-2' },
    card('Team 1', taA, { level: 3 }), card('Team 2', taB, { level: 3 })),
    el('div', { class: 'filters', style: { margin: '12px 0 18px' } },
      el('label', {}, 'Ladder ', select(MODES, mode, v => navigate('/scout', { ...q, mode: v }))),
      el('button', { class: 'btn primary', type: 'button', onClick: go }, 'Scout'),
      el('span', { class: 'muted small' }, 'Names are matched exactly first, then by best rating; ids from a live game are used as-is.')));

  const results = el('div'); app.append(results);
  const idsA = (q.a || '').split(',').filter(x => /^\d+$/.test(x)), idsB = (q.b || '').split(',').filter(x => /^\d+$/.test(x));
  const namesA = lines((q.a_names || '').replace(/,/g, '\n')), namesB = lines((q.b_names || '').replace(/,/g, '\n'));
  if (!idsA.length && !idsB.length && !namesA.length && !namesB.length) { results.append(emptyState('Enter some names to scout, or pick a live game from the Live page.')); return; }
  results.append(skeleton(8));
  try {
    const [teamA, teamB] = await Promise.all([resolveTeam(idsA, namesA, mode), resolveTeam(idsB, namesB, mode)]);
    clear(results);
    renderResults(results, teamA, teamB, mode);
  } catch (e) { clear(results); results.append(errorBox(e)); }
}
const lines = s => s.split(/\n/).map(x => x.trim()).filter(Boolean).slice(0, 4);

async function resolveTeam(ids, names, mode) {
  const found = [];
  for (const id of ids) found.push({ query: id, player: await api.player(id).catch(() => null) });
  for (const name of names) {
    let player = null;
    try {
      const d = await api.searchPlayers(name);
      const ql = name.toLowerCase();
      const cands = (d.players || []).slice().sort((a, b) => {
        const ea = a.name?.toLowerCase() === ql ? 1 : 0, eb = b.name?.toLowerCase() === ql ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return (b.leaderboards?.[mode]?.rating || 0) - (a.leaderboards?.[mode]?.rating || 0);
      });
      if (cands[0]) player = await api.player(cands[0].profile_id);
    } catch { player = null; }
    found.push({ query: name, player });
  }
  return found;
}

function renderResults(box, teamA, teamB, mode) {
  const m = p => p?.modes?.[mode] || {};
  const avg = team => mean(team.map(x => m(x.player).rating).filter(Number.isFinite));
  const rA = avg(teamA), rB = avg(teamB);
  const bothTeams = teamA.some(x => x.player) && teamB.some(x => x.player);
  const pA = rA !== null && rB !== null ? 1 / (1 + Math.pow(10, (rB - rA) / 400)) : null;   // Elo expectation from average ratings
  if (bothTeams) {
    box.append(el('div', { class: 'tiles', style: { marginBottom: '16px' } },
      statTile({ label: 'Team 1 average rating', value: fmt.int(rA), sub: `${teamA.filter(x => x.player).length} players found` }),
      statTile({ label: 'Team 2 average rating', value: fmt.int(rB), sub: `${teamB.filter(x => x.player).length} players found` }),
      statTile({ label: 'Favoured', value: pA === null ? '—' : pA >= 0.5 ? 'Team 1' : 'Team 2', sub: pA === null ? 'no ratings' : `${fmt.pct(100 * Math.max(pA, 1 - pA), 0)} by the Elo formula on average ratings` }),
      statTile({ label: 'Rating gap', value: rA !== null && rB !== null ? fmt.signed(Math.round(rA - rB)) : '—', sub: 'Team 1 minus Team 2' })));
  }
  const grid = el('div', { class: 'grid cols-2' });
  grid.append(teamCard('Team 1', teamA, mode), teamCard('Team 2', teamB, mode));
  box.append(grid);
  box.append(el('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Ratings, ranks, win rates and civ pools come from AoE4 World for the selected ladder. Playstyle tags are computed from each player’s recent replays by the local companion and appear when it is running.'));
}

function teamCard(title, team, mode) {
  const rows = team.map(x => {
    const p = x.player; const md = p?.modes?.[mode] || {};
    const civs = [...(md.civilizations || [])].sort((a, b) => b.games_count - a.games_count).slice(0, 3);
    return el('div', { class: 'scout-row' },
      el('div', { class: 'top' }, p ? playerLink(p) : el('span', { class: 'muted' }, `${x.query} — not found`), p ? el('a', { class: 'small', href: hrefTo(`/player/${p.profile_id}`, { mode }) }, 'profile') : null),
      p ? el('div', { class: 'stats' },
        el('span', { class: 'num big' }, fmt.int(md.rating)), md.rank_level ? rankBadge(md.rank_level, { sm: true, rank: md.rank }) : (md.rank ? el('span', { class: 'muted small' }, `#${fmt.int(md.rank)}`) : el('span', { class: 'muted small' }, 'unrated here')),
        md.games_count ? el('span', { class: 'small' }, `${fmt.pct(md.win_rate, 0)} over ${fmt.int(md.games_count)} games`) : null,
        md.streak ? streakEl(md.streak) : null,
        md.max_rating ? el('span', { class: 'muted small', title: 'peak rating' }, `peak ${fmt.int(md.max_rating)}`) : null) : null,
      p && civs.length ? el('div', { class: 'civs' }, civs.map(c => bindTooltip(el('span', { class: 'civpick', tabindex: 0 }, civChip(c.civilization, { name: 'short' }), el('span', { class: 'muted small' }, ` ${fmt.pct(c.pick_rate, 0)}`)), () => ttRows(civName(c.civilization), [{ label: 'pick rate', value: fmt.pct(c.pick_rate, 0) }, { label: 'win rate', value: fmt.pct(c.win_rate, 0) }, { label: 'games', value: String(c.games_count) }])))) : null,
      p ? playstyleLine(p.profile_id) : null);
  });
  return card(title, rows.length ? el('div', { class: 'scout-list' }, rows) : emptyState('No players on this side.'), { level: 3 });
}

/** Async line of playstyle tags from the companion (quiet when unavailable). */
function playstyleLine(pid) {
  const line = el('div', { class: 'tags small', style: { minHeight: '18px' } }, el('span', { class: 'muted small' }, 'playstyle…'));
  getJSON(`local/profile/${pid}?n=6&budget=8`, { ttl: 10 * 60e3 }).then(d => {
    clear(line);
    const tags = (d.tags || []).filter(t => t.pct >= 30).slice(0, 5);
    if (!d.analysed) { line.append(el('span', { class: 'muted small' }, d.rate_limited ? 'replay store rate-limited, try again shortly' : 'no replays analysed yet')); return; }
    line.append(el('span', { class: 'muted small' }, `${d.analysed} replays: `), ...tags.map(t => bindTooltip(el('span', { class: 'tag', tabindex: 0 }, `${t.label} ${t.pct}%`), () => ttRows(t.label, [{ label: 'in', value: `${t.count} of ${d.analysed} analysed games` }]))));
    if (!tags.length) line.append(el('span', { class: 'muted small' }, 'no dominant pattern'));
    const med = d.medians || {};
    const bits = [med.villagers_by_10 ? `${fmt.int(med.villagers_by_10)} vills by 10:00` : null, med.feudal ? `feudal ${fmt.duration(med.feudal)}` : null, med.military_by_8 !== null && med.military_by_8 !== undefined ? `${fmt.int(med.military_by_8)} military by 8:00` : null].filter(Boolean);
    if (bits.length) line.append(el('span', { class: 'muted small' }, ` · ${bits.join(' · ')}`));
  }).catch(() => { clear(line); });
  return line;
}
