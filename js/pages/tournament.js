// Forge Cup: monthly Clash-style 1v1 tournament. Sign up → lock in → skill-grouped brackets of 8 → mini draft
// (map bans, civ bans from a declared 3–5 civ pool, winner's civ lock) → best-of-3 → results verified against
// match history. State lives in the local companion (tools/tournament.py); identity is a claimed profile id.
import { el, fmt, setTitle, hrefTo, clear, append } from '../util.js';
import { getJSON, api } from '../api.js';
import { searchBox, avatarImg, countryFlag, rankBadge, civChip, card, notice, skeleton, errorBox, emptyState, bindTooltip, ttRows, resultPill, playerLink } from '../components.js';
import { civName, civShort, civFlag } from '../constants.js';
import { pageHead } from './_shared.js';

const AS_KEY = 'forge-cup-as';
const PHASE = {
  registration: { label: 'Registration open', cls: 'open' }, closed: { label: 'Registration closed · lock-in soon', cls: 'wait' },
  lockin: { label: 'Lock-in window open', cls: 'hot' }, draft: { label: 'Brackets out · drafting', cls: 'hot' }, live: { label: 'Live', cls: 'live' }, done: { label: 'Finished', cls: 'done' },
};
const STEP_LABEL = { ban_map: 'Map ban', pick_map: 'Map pick', ban_civ: 'Civ ban', pick_civ: 'Civ pick', result: 'Result' };
const local = (path, opts = {}) => getJSON(`local/${path}`, { ttl: 0, force: true, ...opts });
const tz = () => { try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
const dayTime = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeOnly = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const countdown = ms => { if (ms <= 0) return 'now'; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };

export async function render(app, route) {
  setTitle('Forge Cup');
  const holder = el('div'); app.append(holder); holder.append(skeleton(6, { height: 22 }));
  let cfg = null;
  try { cfg = await local('config', { ttl: 60e3, force: false }); } catch (e) {
    clear(holder);
    holder.append(pageHead('Forge Cup', 'Monthly 1v1 cup in the Clash format.'), notice(el('strong', {}, 'The tournament prototype runs on the local companion. '), 'Start the site with ', el('code', {}, 'py -3 server.py'), ' and open ', el('code', {}, 'http://127.0.0.1:8000/#/tournament'), '. In production this would be a hosted service with Steam sign-in; here the companion stores sign-ups, brackets and drafts in ', el('code', {}, 'cache/tournament.json'), '.'));
    return;
  }
  let as = null;
  try { as = localStorage.getItem(AS_KEY); } catch { /* ignore */ }
  if (!as && cfg.me) as = String(cfg.me);
  const ui = { as, selectedBracket: route.query.bracket || null, selectedMatch: route.query.match || null, actForBoth: false, civSel: null, slotSel: null, busy: false, error: null, clockTimer: null };
  let state = null;

  const post = async (action, body = {}) => {
    ui.busy = true; ui.error = null;
    try {
      const res = await fetch(`local/tournament/${action}?${new URLSearchParams(ui.as ? { as: ui.as } : {})}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${res.status}`);
      state = data;
    } catch (e) { ui.error = e.message || String(e); }
    ui.busy = false;
    draw();
  };
  const refresh = async () => {
    try { state = await local(`tournament/state${ui.as ? `?as=${ui.as}` : ''}`); } catch (e) { clear(holder); holder.append(errorBox(e, refresh)); return; }
    if (ui.as && !state.me && ui.asProfile?.profile_id !== Number(ui.as)) {
      try { const p = await api.player(ui.as); ui.asProfile = { profile_id: p.profile_id, name: p.name, country: p.country, avatar: p.avatars?.small || '', rating: p.modes?.rm_solo?.rating, rank_level: p.modes?.rm_solo?.rank_level }; } catch { ui.asProfile = null; }
    }
    draw();
  };
  const weekendLabel = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  function draw() {
    clear(holder);
    if (ui.clockTimer) { clearInterval(ui.clockTimer); ui.clockTimer = null; }
    const S = state, ev = S.event, me = S.me;
    const skew = new Date(S.now).getTime() - Date.now();
    const nowMs = () => Date.now() + skew;
    const slotOf = id => ev.slots.find(s => s.id === id);
    const mySlot = me ? slotOf(me.slot) : null;
    if (ui.civSel === null) ui.civSel = new Set(me?.civs || []);
    if (ui.slotSel === null) ui.slotSel = me?.slot || ev.slots.find(s => s.phase === 'registration')?.id || ev.slots[0].id;

    holder.append(pageHead(ev.name, el('span', {}, `Monthly 1v1 cup in the Clash format: sign up, lock in, get a bracket of 8 at your rating, draft, play best-of-3. Weekend of ${weekendLabel(ev.weekend)} · all times ${tz()}.`),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, el('a', { class: 'btn', href: '#rules' }, 'Rules'), S.clock_offset ? el('span', { class: 'pill neutral', title: 'The demo clock is moved; see Prototype controls' }, `demo clock · ${dayTime(S.now)}`) : null)));
    if (ui.error) holder.append(el('div', { class: 'error-box', role: 'alert', style: { marginBottom: '12px' } }, el('strong', {}, 'Action refused'), ui.error));

    /* how it works + where you are */
    const phase = mySlot ? mySlot.phase : null;
    const steps = [
      { k: 'registration', t: 'Sign up', d: `connect your profile, pick a start time, declare ${S.rules.civ_pool[0]}–${S.rules.civ_pool[1]} civs · closes ${S.rules.registration_closes_hours_before} h before` },
      { k: 'lockin', t: 'Lock in', d: `${S.rules.lockin_window_minutes[0]}–${S.rules.lockin_window_minutes[1]} min before your slot · no lock-in, no bracket` },
      { k: 'draft', t: 'Draft', d: 'brackets of 8 by rating · map bans, civ bans, blind civ picks' },
      { k: 'live', t: 'Play', d: `best-of-${S.rules.best_of} series, ~45 min per round · results verified against match history` },
    ];
    const order = ['registration', 'closed', 'lockin', 'draft', 'live', 'done'];
    const cur = phase ? order.indexOf(phase) : -1;
    holder.append(el('ol', { class: 'cup-steps' }, steps.map((s, i) => {
      const idx = order.indexOf(s.k);
      const stateCls = cur < 0 ? '' : idx < cur && !(s.k === 'registration' && phase === 'closed') ? 'past' : (idx === cur || (s.k === 'registration' && phase === 'closed')) ? 'now' : '';
      return el('li', { class: stateCls }, el('span', { class: 'n' }, String(i + 1)), el('div', {}, el('strong', {}, s.t), el('div', { class: 'muted small' }, s.d)));
    })));

    const grid = el('div', { class: 'grid main-side', style: { marginTop: '16px', alignItems: 'start' } });
    grid.append(entryCard(), el('div', { class: 'stack' }, scheduleCard(), logCard()));
    holder.append(grid);

    /* brackets */
    const slotForBrackets = (me && S.brackets.some(b => b.slot === me.slot)) ? me.slot : (S.brackets[0]?.slot ?? null);
    const brs = S.brackets.filter(b => b.slot === slotForBrackets);
    holder.append(el('h2', { style: { margin: '24px 0 10px' } }, 'Brackets'));
    if (!brs.length) {
      const s = mySlot || slotOf(ui.slotSel);
      holder.append(el('div', { class: 'card' }, emptyState(s ? `Brackets for ${s.label} are formed when the lock-in window closes (${dayTime(s.lockin_closes)}). Locked-in players are sorted by rating and cut into groups of ${S.rules.bracket_size}.` : 'No brackets yet.')));
    } else {
      if (!ui.selectedBracket || !brs.some(b => b.id === ui.selectedBracket)) ui.selectedBracket = (me && brs.find(b => b.players.some(p => p.profile_id === me.profile_id)))?.id || brs[0].id;
      holder.append(el('div', { class: 'bracket-cards' }, brs.map(b => {
        const names = b.players.map(p => entrant(p.profile_id));
        const mine = me && b.players.some(p => p.profile_id === me.profile_id);
        return el('button', { type: 'button', class: `bracket-card ${b.id === ui.selectedBracket ? 'on' : ''} ${mine ? 'mine' : ''}`, onClick: () => { ui.selectedBracket = b.id; ui.selectedMatch = null; draw(); } },
          el('div', { class: 'top' }, el('strong', {}, b.label), el('span', { class: 'muted small' }, `${fmt.int(b.band[0])}–${fmt.int(b.band[1])} rating`)),
          el('div', { class: 'muted small' }, `${b.players.length} players${b.champion ? ` · champion ${entrant(b.champion)?.name}` : ''}${mine ? ' · you are here' : ''}`),
          el('div', { class: 'names small' }, names.map(e => e?.name).filter(Boolean).join(', ')));
      })));
      const b = brs.find(x => x.id === ui.selectedBracket);
      holder.append(bracketTree(b));
      const myMatch = me && S.my_matches.map(id => S.matches[id]).find(m => m.bracket === b.id && !m.winner) || (me && S.my_matches.map(id => S.matches[id]).filter(m => m.bracket === b.id).at(-1));
      if (!ui.selectedMatch || !S.matches[ui.selectedMatch] || S.matches[ui.selectedMatch].bracket !== b.id) ui.selectedMatch = myMatch?.id || b.matches.find(id => S.matches[id].a && S.matches[id].b)?.id || null;
      if (ui.selectedMatch) holder.append(el('div', { style: { marginTop: '16px' } }, matchPanel(S.matches[ui.selectedMatch], b)));
    }

    holder.append(el('div', { id: 'rules', style: { marginTop: '24px' } }, rulesCard()));
    holder.append(el('div', { style: { marginTop: '16px' } }, demoCard()));

    /* live countdown */
    const cdEls = holder.querySelectorAll('[data-countdown]');
    if (cdEls.length) ui.clockTimer = setInterval(() => { for (const n of cdEls) n.textContent = countdown(new Date(n.dataset.countdown).getTime() - nowMs()); }, 1000);

    /* ---------- cards ---------- */
    function entrant(pid) { return S.entrants.find(e => e.profile_id === pid) || null; }

    function entryCard() {
      const box = el('div', { class: 'stack' });
      // identity
      const who = me || (ui.as ? S.entrants.find(e => String(e.profile_id) === ui.as) : null) || ui.asProfile;
      const ident = el('div', { class: 'cup-ident' });
      if (ui.as) {
        ident.append(el('div', { class: 'muted small' }, 'Connected profile'),
          el('div', { class: 'row' }, who ? [avatarImg({ avatars: { small: who.avatar } }, 'avatar'), countryFlag(who.country), el('a', { href: hrefTo(`/player/${who.profile_id}`), style: { fontWeight: 650, color: 'var(--ink)' } }, who.name), who.rank_level ? rankBadge(who.rank_level, { sm: true }) : null, el('span', { class: 'num' }, fmt.int(who.rating)), who.provisional ? el('span', { class: 'badge', title: 'no rating on this ladder; another ladder was used' }, 'provisional') : null] : el('span', {}, `profile #${ui.as}`),
            el('button', { class: 'linkish small', type: 'button', style: { marginLeft: 'auto' }, onClick: () => { ui.as = null; try { localStorage.removeItem(AS_KEY); } catch { /* ignore */ } refresh(); } }, 'change')),
          el('p', { class: 'muted small', style: { margin: '4px 0 0' } }, 'Prototype: the profile is claimed, not verified. Production would sign you in through Steam and read the linked AoE4 World profile.'));
      } else {
        ident.append(el('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Connect your profile to enter'),
          searchBox({ placeholder: 'Search your in-game name…', onPick: p => { ui.as = String(p.profile_id); try { localStorage.setItem(AS_KEY, ui.as); } catch { /* ignore */ } ui.civSel = null; refresh(); } }),
          el('p', { class: 'muted small', style: { margin: '6px 0 0' } }, 'Your rating on the chosen ladder decides which bracket of 8 you land in.'));
      }
      box.append(ident);
      if (!ui.as) return card('Your entry', box, { level: 2 });

      // slot choice
      const canEdit = !me || mySlot?.phase === 'registration';
      const slots = el('div', { class: 'slot-list' }, ev.slots.map(s => {
        const ph = PHASE[s.phase];
        const chosen = (me ? me.slot : ui.slotSel) === s.id;
        return el('label', { class: `slot ${chosen ? 'on' : ''} ${s.phase !== 'registration' && !chosen ? 'off' : ''}` },
          el('input', { type: 'radio', name: 'slot', value: s.id, checked: chosen ? true : null, disabled: !canEdit || s.phase !== 'registration' ? true : null, onChange: () => { ui.slotSel = s.id; draw(); } }),
          el('div', {}, el('strong', {}, dayTime(s.start)), el('div', { class: 'muted small' }, s.label)),
          el('div', { class: 'right' }, el('span', { class: `phase ${ph.cls}` }, ph.label), el('div', { class: 'muted small' }, `${s.entrants} signed up${s.locked ? ` · ${s.locked} locked in` : ''}`)));
      }));
      box.append(el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Start time'), slots));

      // civ pool
      const n = ui.civSel.size;
      const civGrid = el('div', { class: 'civ-grid' }, S.civs.map(c => {
        const on = ui.civSel.has(c);
        return el('button', { type: 'button', class: `civ-pick ${on ? 'on' : ''}`, 'aria-pressed': String(on), disabled: !canEdit ? true : null, title: civName(c), onClick: () => { if (on) ui.civSel.delete(c); else if (ui.civSel.size < S.rules.civ_pool[1]) ui.civSel.add(c); draw(); } },
          el('img', { src: civFlag(c), alt: '', width: 26, height: 14 }), el('span', {}, civShort(c)));
      }));
      box.append(el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '6px', display: 'flex', justifyContent: 'space-between' } }, el('span', {}, `Your civ pool · ${S.rules.civ_pool[0]}–${S.rules.civ_pool[1]} civilizations`), el('span', { class: n >= S.rules.civ_pool[0] && n <= S.rules.civ_pool[1] ? 'good' : '' }, `${n} selected`)), civGrid,
        el('p', { class: 'muted small', style: { margin: '6px 0 0' } }, 'Opponents ban one civ from your pool per series, and a civ you win a game with is locked for the rest of that series. Three civs are always enough; five give you options.')));

      // actions + status
      const actions = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } });
      const civs = [...ui.civSel];
      if (!me) {
        actions.append(el('button', { class: 'btn primary', type: 'button', disabled: ui.busy || civs.length < S.rules.civ_pool[0] || !slotOf(ui.slotSel) || slotOf(ui.slotSel).phase !== 'registration' ? true : null, onClick: () => post('signup', { profile_id: Number(ui.as), slot: ui.slotSel, civs }) }, 'Sign up'));
      } else {
        if (canEdit) actions.append(el('button', { class: 'btn primary', type: 'button', disabled: ui.busy || civs.length < S.rules.civ_pool[0] ? true : null, onClick: () => post('signup', { profile_id: me.profile_id, slot: ui.slotSel, civs }) }, 'Update entry'));
        if (mySlot?.phase === 'lockin' && !me.locked) actions.append(el('button', { class: 'btn primary', type: 'button', disabled: ui.busy ? true : null, onClick: () => post('lockin', { profile_id: me.profile_id }) }, 'Lock in now'));
        if (!['live', 'done'].includes(mySlot?.phase)) actions.append(el('button', { class: 'btn ghost', type: 'button', disabled: ui.busy ? true : null, onClick: () => { if (confirm('Withdraw from the cup?')) post('withdraw', { profile_id: me.profile_id }); } }, 'Withdraw'));
      }
      box.append(actions);
      if (me && mySlot) {
        const ph = mySlot.phase;
        let line;
        if (ph === 'registration') line = ['You are signed up for ', el('strong', {}, dayTime(mySlot.start)), '. Registration closes in ', el('strong', { 'data-countdown': mySlot.registration_closes }, countdown(new Date(mySlot.registration_closes).getTime() - nowMs())), '; lock-in opens ', timeOnly(mySlot.lockin_opens), '.'];
        else if (ph === 'closed') line = ['Registration is closed. Lock-in opens in ', el('strong', { 'data-countdown': mySlot.lockin_opens }, countdown(new Date(mySlot.lockin_opens).getTime() - nowMs())), ' (', timeOnly(mySlot.lockin_opens), '–', timeOnly(mySlot.lockin_closes), ').'];
        else if (ph === 'lockin') line = me.locked ? ['Locked in. Brackets are revealed in ', el('strong', { 'data-countdown': mySlot.lockin_closes }, countdown(new Date(mySlot.lockin_closes).getTime() - nowMs())), '.'] : [el('strong', { class: 'bad' }, 'Lock in now'), ' — the window closes in ', el('strong', { 'data-countdown': mySlot.lockin_closes }, countdown(new Date(mySlot.lockin_closes).getTime() - nowMs())), ' and players who do not lock in are dropped.'];
        else if (ph === 'draft') line = me.locked ? ['Brackets are out. Draft your first series below; round 1 starts in ', el('strong', { 'data-countdown': mySlot.start }, countdown(new Date(mySlot.start).getTime() - nowMs())), '.'] : [el('strong', { class: 'bad' }, 'You did not lock in'), ' and were dropped from this slot.'];
        else if (ph === 'live') line = me.locked ? ['The cup is live. Play your series and report results below; verification checks AoE4 World for games between you and your opponent.'] : ['You were not locked in for this slot.'];
        else line = ['This slot has finished.'];
        box.append(el('p', { class: 'cup-status', style: { margin: 0 } }, line));
      }
      return card('Your entry', box, { level: 2, meta: me ? `signed up ${fmt.rel(me.signed_up_at)}` : null });
    }

    function scheduleCard() {
      const rows = ev.slots.map(s => el('div', { class: 'sched-row' },
        el('div', {}, el('strong', {}, dayTime(s.start)), el('div', { class: 'muted small' }, s.label)),
        el('div', { class: 'right' }, el('span', { class: `phase ${PHASE[s.phase].cls}` }, PHASE[s.phase].label), el('div', { class: 'muted small num' }, `${s.entrants} entrants · ${s.locked} locked`))));
      return card('Schedule', el('div', { class: 'sched' }, rows, el('p', { class: 'muted small', style: { margin: '8px 0 0' } }, `Registration closes ${S.rules.registration_closes_hours_before} h before each slot; lock-in ${S.rules.lockin_window_minutes[0]} to ${S.rules.lockin_window_minutes[1]} minutes before; rounds every 45 minutes.`)), { level: 3 });
    }
    function logCard() {
      return card('Activity', S.log.length ? el('ul', { class: 'cup-log' }, [...S.log].reverse().map(l => el('li', {}, el('span', { class: 'muted small num' }, timeOnly(l.at)), ' ', l.text))) : emptyState('Nothing yet.'), { level: 3 });
    }

    /* ---------- bracket tree ---------- */
    function bracketTree(b) {
      const rounds = [...new Set(b.matches.map(id => S.matches[id].round))].sort((x, y) => x - y);
      const names = { 1: rounds.length === 3 ? 'Quarterfinals' : 'Round of 16', 2: rounds.length === 3 ? 'Semifinals' : 'Quarterfinals', 3: rounds.length === 3 ? 'Final' : 'Semifinals', 4: 'Final' };
      const cols = rounds.map(r => el('div', { class: 'round' }, el('div', { class: 'round-name' }, names[r] || `Round ${r}`, el('span', { class: 'muted small' }, ` · ${timeOnly(S.matches[b.matches.find(id => S.matches[id].round === r)].scheduled)}`)),
        b.matches.filter(id => S.matches[id].round === r).map(id => matchBox(S.matches[id], b))));
      const champ = b.champion ? el('div', { class: 'round' }, el('div', { class: 'round-name' }, 'Champion'), el('div', { class: 'match-box champ' }, side(b.champion, null, true, b))) : null;
      return el('div', { class: 'card bracket-wrap' }, el('div', { class: 'bracket' }, cols, champ));
    }
    function side(pid, seed, won, b, score) {
      const e = pid ? entrant(pid) : null;
      const isMe = me && pid === me.profile_id;
      return el('div', { class: `side ${won ? 'won' : ''} ${isMe ? 'me' : ''} ${!pid ? 'tbd' : ''}` },
        el('span', { class: 'seed num' }, seed ?? (pid ? seed_of(b, pid) : '')),
        e ? [countryFlag(e.country), el('span', { class: 'nm' }, e.name), el('span', { class: 'r num muted' }, fmt.int(e.rating))] : el('span', { class: 'nm muted' }, pid ? `#${pid}` : 'TBD'),
        score !== undefined ? el('span', { class: 'score num' }, String(score)) : null);
    }
    function seed_of(b, pid) { return b.players.find(p => p.profile_id === pid)?.seed ?? ''; }
    function matchBox(m, b) {
      const wa = m.games.filter(g => g.winner === m.a).length, wb = m.games.filter(g => g.winner === m.b).length;
      const mine = me && (m.a === me.profile_id || m.b === me.profile_id);
      const box = el('button', { type: 'button', class: `match-box ${m.id === ui.selectedMatch ? 'on' : ''} ${mine ? 'mine' : ''} ${m.bye ? 'bye' : ''}`, onClick: () => { ui.selectedMatch = m.id; draw(); } },
        side(m.a, m.seed_a, m.winner && m.winner === m.a, b, m.bye ? undefined : wa),
        side(m.b, m.seed_b, m.winner && m.winner === m.b, b, m.bye ? undefined : wb),
        el('div', { class: 'muted small status' }, m.bye ? 'bye' : m.winner ? 'finished' : m.a && m.b ? (m.draft && m.draft.index < m.draft.steps.length ? `${STEP_LABEL[m.draft.steps[m.draft.index].type]}${m.draft.steps[m.draft.index].game ? ` · game ${m.draft.steps[m.draft.index].game}` : ''}` : 'ready') : 'waiting for players'));
      return box;
    }

    /* ---------- match panel / draft ---------- */
    function matchPanel(m, b) {
      const A = entrant(m.a), B = entrant(m.b);
      if (!A || !B) return card('Series', emptyState('Waiting for both players.'), { level: 2 });
      const d = m.draft;
      const mySide = me ? (m.a === me.profile_id ? 'a' : m.b === me.profile_id ? 'b' : null) : null;
      const step = d && d.index < d.steps.length ? d.steps[d.index] : null;
      const wa = m.games.filter(g => g.winner === m.a).length, wb = m.games.filter(g => g.winner === m.b).length;
      const head = el('div', { class: 'series-head' },
        el('div', { class: 'p' }, avatarImg({ avatars: { small: A.avatar } }, 'avatar'), el('div', {}, el('div', {}, el('span', { class: 'muted small' }, `#${m.seed_a} `), playerLink(A, { showAvatar: false, showFlag: true })), el('div', { class: 'muted small num' }, `${fmt.int(A.rating)} · pool: ${A.civs.map(civShort).join(', ')}`))),
        el('div', { class: 'score-big num' }, `${wa} – ${wb}`),
        el('div', { class: 'p right' }, el('div', {}, el('div', {}, playerLink(B, { showAvatar: false, showFlag: true }), el('span', { class: 'muted small' }, ` #${m.seed_b}`)), el('div', { class: 'muted small num' }, `${fmt.int(B.rating)} · pool: ${B.civs.map(civShort).join(', ')}`)), avatarImg({ avatars: { small: B.avatar } }, 'avatar')));
      const body = el('div', { class: 'stack' }, head);
      if (m.bye) { body.append(notice('Bye: a short bracket gives the higher seed a free pass to the next round.')); return card(`${ROUND(m, b)} · ${m.id}`, body, { level: 2 }); }
      if (!d) { body.append(notice('The draft opens when the bracket is formed.')); return card(`${ROUND(m, b)}`, body, { level: 2 }); }

      // who may act
      const actorSide = step?.type === 'pick_civ' ? null : step?.by;
      const canActAs = s => ui.actForBoth || mySide === s;
      // step strip
      body.append(el('div', { class: 'draft-steps' }, d.steps.map((s, i) => el('span', { class: `dstep ${i < d.index ? 'done' : i === d.index ? 'now' : ''}` }, `${STEP_LABEL[s.type]}${s.game ? ` G${s.game}` : ''}${s.by ? ` · ${s.by === 'a' ? A.name : B.name}` : ''}`))));
      // maps
      const bannedBy = x => d.map_bans.a.includes(x) ? 'a' : d.map_bans.b.includes(x) ? 'b' : null;
      const gameOf = x => Object.entries(d.maps).find(([, v]) => v === x)?.[0] || null;
      const mapsActive = step && (step.type === 'ban_map' || step.type === 'pick_map') && canActAs(step.by);
      body.append(el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Map pool', step?.type === 'ban_map' ? ` · ${step.by === 'a' ? A.name : B.name} bans` : step?.type === 'pick_map' ? ` · ${step.by === 'a' ? A.name : B.name} picks the game ${step.game} map` : ''),
        el('div', { class: 'map-pool' }, d.map_pool.map(x => {
          const bb = bannedBy(x), g = gameOf(x);
          return el('button', { type: 'button', class: `map-chip ${bb ? 'banned' : ''} ${g ? 'picked' : ''}`, disabled: !mapsActive || bb || g ? true : null, onClick: () => post('draft', { match: m.id, profile_id: step.by === 'a' ? m.a : m.b, value: x, side: step.by }) },
            el('span', { class: 'nm' }, x), bb ? el('span', { class: 'tagline' }, `banned by ${bb === 'a' ? A.name : B.name}`) : g ? el('span', { class: 'tagline' }, `Game ${g}`) : null);
        }))));
      // civ pools
      const civCol = (side, E) => {
        const other = side === 'a' ? 'b' : 'a';
        const banned = d.civ_bans[side];
        const curGame = step?.game ? String(step.game) : null;
        const myPick = curGame ? d.picks[curGame]?.[side] : null;
        const bothPicked = curGame && d.picks[curGame]?.a && d.picks[curGame]?.b;
        const banActive = step?.type === 'ban_civ' && step.by === other && canActAs(other);   // the other side bans from this pool
        const pickActive = step?.type === 'pick_civ' && canActAs(side) && !myPick;
        return el('div', { class: 'civ-col' }, el('div', { class: 'muted small', style: { marginBottom: '6px' } }, `${E.name}'s pool`, banActive ? ` · ${entrant(m[other]).name} bans one` : pickActive ? ' · pick for this game' : ''),
          el('div', { class: 'civ-pool' }, E.civs.map(c => {
            const isBanned = banned === c, isLocked = d.locked[side].includes(c);
            const pickedHere = myPick === c;
            const hidden = pickedHere && !bothPicked && mySide !== side && !ui.actForBoth;
            return el('button', { type: 'button', class: `civ-chip ${isBanned ? 'banned' : ''} ${isLocked ? 'locked' : ''} ${pickedHere && !hidden ? 'picked' : ''}`, disabled: !(banActive || pickActive) || isBanned || isLocked ? true : null, title: isBanned ? 'banned' : isLocked ? 'won with · locked for this series' : civName(c),
              onClick: () => post('draft', { match: m.id, profile_id: banActive ? m[other] : m[side], value: c, side: banActive ? other : side }) },
              el('img', { src: civFlag(c), alt: '', width: 26, height: 14 }), el('span', {}, civShort(c)), isBanned ? el('span', { class: 'tagline' }, 'banned') : isLocked ? el('span', { class: 'tagline' }, 'locked') : pickedHere && !hidden ? el('span', { class: 'tagline' }, `game ${curGame}`) : null);
          })),
          curGame && myPick && !bothPicked ? el('div', { class: 'muted small', style: { marginTop: '4px' } }, hidden_(side) ? 'picked · hidden until both have picked' : 'picked · waiting for the opponent') : null);
        function hidden_(s) { return mySide !== s && !ui.actForBoth; }
      };
      body.append(el('div', { class: 'grid cols-2' }, civCol('a', A), civCol('b', B)));
      // games + result
      const games = el('div', { class: 'games-list' }, m.games.map(g => el('div', { class: 'game-line' }, el('span', { class: 'muted small' }, `Game ${g.game}`), el('strong', {}, g.map || '—'), civChip(g.civ_a, { name: 'short' }), el('span', { class: 'muted small' }, 'vs'), civChip(g.civ_b, { name: 'short' }), el('span', { class: 'spacer' }), el('span', {}, `${entrant(g.winner)?.name} won`), el('span', { class: 'badge', title: g.source === 'aoe4world' ? `verified from AoE4 World game ${g.game_id}` : 'reported by a player' }, g.source === 'aoe4world' ? 'verified' : 'reported'))));
      if (step?.type === 'result') {
        const g = String(step.game);
        games.append(el('div', { class: 'game-line pending' }, el('span', { class: 'muted small' }, `Game ${step.game}`), el('strong', {}, d.maps[g] || '—'), civChip(d.picks[g]?.a, { name: 'short' }), el('span', { class: 'muted small' }, 'vs'), civChip(d.picks[g]?.b, { name: 'short' }), el('span', { class: 'spacer' }),
          (mySide || ui.actForBoth) ? [el('button', { class: 'btn sm', type: 'button', onClick: () => post('report', { match: m.id, game: step.game, winner: m.a }) }, `${A.name} won`), el('button', { class: 'btn sm', type: 'button', onClick: () => post('report', { match: m.id, game: step.game, winner: m.b }) }, `${B.name} won`)] : el('span', { class: 'muted small' }, 'players report'),
          el('button', { class: 'btn sm ghost', type: 'button', title: 'Look for finished games between the two players since the scheduled time on AoE4 World', onClick: () => post('verify', { match: m.id }) }, 'Verify from match history')));
      }
      body.append(el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '6px' } }, `Games · best of ${S.rules.best_of}${m.winner ? ` · ${entrant(m.winner)?.name} advances` : ''}`), games.children.length ? games : emptyState('No games yet — finish the draft first.')));
      if (!mySide && !ui.actForBoth) body.append(el('p', { class: 'muted small', style: { margin: 0 } }, 'You are watching this series. Turn on “act for both players” in Prototype controls to drive the draft in the demo.'));
      return card(`${ROUND(m, b)} · scheduled ${timeOnly(m.scheduled)}`, body, { level: 2, meta: step ? `next: ${STEP_LABEL[step.type]}${step.by ? ` by ${step.by === 'a' ? A.name : B.name}` : step.type === 'pick_civ' ? ' (both, blind)' : ''}` : (m.winner ? 'series complete' : '') });
    }
    function ROUND(m, b) { const rounds = Math.max(...b.matches.map(id => S.matches[id].round)); const names = rounds === 3 ? { 1: 'Quarterfinal', 2: 'Semifinal', 3: 'Final' } : { 1: 'Round of 16', 2: 'Quarterfinal', 3: 'Semifinal', 4: 'Final' }; return names[m.round] || `Round ${m.round}`; }

    function rulesCard() {
      const r = S.rules;
      return card('Rules', el('div', { class: 'prose', style: { maxWidth: 'none' } }, el('ul', {},
        el('li', {}, el('strong', {}, 'Format. '), `1v1, best-of-${r.best_of} single elimination in brackets of ${r.bracket_size}. One event a month on the third weekend, six start times. Brackets are formed from the players locked in for a start time, sorted by rating and cut into groups of ${r.bracket_size}, so you face people within a few dozen rating points.`),
        el('li', {}, el('strong', {}, 'Sign up and lock in. '), `Connect your profile, choose a start time and declare ${r.civ_pool[0]}–${r.civ_pool[1]} civilizations. Registration closes ${r.registration_closes_hours_before} h before the slot. Between ${r.lockin_window_minutes[0]} and ${r.lockin_window_minutes[1]} minutes before, lock in to confirm you are present; players who do not lock in are dropped and brackets are revealed when the window closes.`),
        el('li', {}, el('strong', {}, 'Maps. '), `Seven-map pool from the current ranked rotation. Bans alternate higher seed, lower seed, higher, lower (${r.map_bans_each} each). The lower seed picks the game-1 map, the higher seed game 2, the last map is the decider.`),
        el('li', {}, el('strong', {}, 'Civilizations. '), `Each player bans ${r.civ_bans_each} civilization from the opponent's declared pool. Every game both pick blind from their remaining pool; picks are revealed together. A civilization you win a game with is locked for the rest of the series, so a pool of ${r.civ_pool[0]} always leaves a legal pick. You never need to know more than your own ${r.civ_pool[1]}.`),
        el('li', {}, el('strong', {}, 'Playing. '), 'Host a custom lobby with the drafted map and civs; rounds are scheduled 45 minutes apart. Report each game here; verification looks for a finished game between the two of you on AoE4 World since the scheduled time and records the winner.'),
        el('li', {}, el('strong', {}, 'Prototype limits. '), 'No identity check, no anti-smurf, no no-show timers, no prizes. All state lives in the local companion.'))), { level: 2 });
    }

    function demoCard() {
      const mine = me;
      const btn = (label, fn, opts = {}) => el('button', { class: `btn sm ${opts.primary ? 'primary' : ''}`, type: 'button', disabled: ui.busy || opts.disabled ? true : null, title: opts.title, onClick: fn }, label);
      return card('Prototype controls', el('div', { class: 'stack' },
        el('p', { class: 'muted small', style: { margin: 0 } }, 'These exist so the whole month can be walked through today. Demo entrants are real ladder profiles near your rating with their actual most-played civs as declared pools; they are not really registered.'),
        el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          btn('Add 7 demo entrants near my rating', () => post('seed_demo', { profile_id: mine.profile_id, n: 7 }), { disabled: !mine, title: mine ? '' : 'sign up first' }),
          el('span', { class: 'muted small' }, 'Clock:'),
          btn('→ lock-in window', () => post('clock', { target: 'lockin' })), btn('→ bracket reveal', () => post('clock', { target: 'draft' })), btn('→ live', () => post('clock', { target: 'live' })), btn('reset clock', () => post('clock', { target: 'reset' })),
          mine ? btn('Form brackets now', () => post('form_brackets', { slot: mine.slot, force: true }), { title: 'rebuild brackets for your slot from locked-in and demo entrants' }) : null),
        el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
          el('label', { class: 'checkbox' }, el('input', { type: 'checkbox', checked: ui.actForBoth ? true : null, onChange: e => { ui.actForBoth = e.target.checked; draw(); } }), 'Act for both players in a series (drive the draft and report results for the opponent)'),
          el('span', { class: 'spacer' }),
          btn('Reset tournament', () => { if (confirm('Delete all sign-ups, brackets and drafts?')) post('reset'); }))), { level: 3 });
    }
  }

  await refresh();
  return () => { if (ui.clockTimer) clearInterval(ui.clockTimer); };
}
