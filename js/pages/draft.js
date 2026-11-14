// Draft: an aoe4draft-style pick/ban session followed by the series loop (loser picks the map, both pick two civs,
// each snipes one of the other's, enter the result). Rules live in js/draft.js; this file is the lobby and the room.
// Two ways to run one: hot seat on one screen (localStorage; works on the static copy) or shared through the
// companion, where each player joins a code from their own browser (tools/draft.py keeps the action log).
import { el, clear, setTitle, hrefTo, navigate, fmt } from '../util.js';
import { getJSON } from '../api.js';
import { card, notice, segmented, emptyState, errorBox, skeleton } from '../components.js';
import { CIVS, civName, civShort, civFlag } from '../constants.js';
import { pageHead, companionHint, isLocalHost } from './_shared.js';
import * as D from '../draft.js';

const LOCAL_KEY = 'forge-draft-hotseat', RECENT_KEY = 'forge-draft-recent', SETUP_KEY = 'forge-draft-setup';
const seatKey = code => `forge-draft-seat:${code}`;
const POLL_MS = 2000;
const SIDE_LABEL = { a: 'Player 1', b: 'Player 2' };

const storage = store => ({
  get(k, d) { try { const v = store.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { store.setItem(k, JSON.stringify(v)); } catch { /* quota or private mode */ } },
  del(k) { try { store.removeItem(k); } catch { /* ignore */ } },
});
const ls = storage(localStorage), ss = storage(sessionStorage);

async function companion() { try { return await getJSON('local/config', { ttl: 60e3 }); } catch { return null; } }
async function localJSON(path, body) {
  const res = await fetch(`local/draft/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } });
  let data = {}; try { data = await res.json(); } catch { /* not JSON (static host) */ }
  if (!res.ok) { const e = new Error(data.error || `${res.status} ${res.statusText}`); e.status = res.status; e.state = data.state; throw e; }
  return data;
}
function remember(code, config) {
  const list = ls.get(RECENT_KEY, []).filter(r => r.code !== code);
  list.unshift({ code, names: config.names, title: config.title, bestOf: config.bestOf, at: Date.now() });
  ls.set(RECENT_KEY, list.slice(0, 8));
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

/* ---------- stores: where the action log lives ---------- */
function localStore() {
  const read = () => ls.get(LOCAL_KEY, null);
  const out = d => ({ config: d.config, actions: d.actions, version: d.actions.length, seats: null });
  return {
    kind: 'local', code: 'local', hotseat: true, poll: false,
    async load() { const d = read(); if (!d) throw new Error('There is no hot-seat draft in this browser yet. Start one from the Draft page.'); return out(d); },
    mySide: () => read()?.acting || null,
    setActing(side) { const d = read(); if (d) { d.acting = side; ls.set(LOCAL_KEY, d); } },
    async act(action) { const d = read(); d.actions.push({ ...action, at: Date.now() }); ls.set(LOCAL_KEY, d); return out(d); },
    canUndo: () => (read()?.actions.length || 0) > 0,
    async undo() { const d = read(); d.actions.pop(); ls.set(LOCAL_KEY, d); return out(d); },
  };
}
function onlineStore(code) {
  const seat = () => ss.get(seatKey(code), null);
  return {
    kind: 'online', code, hotseat: false, poll: true,
    load: () => localJSON(code),
    mySide: () => seat()?.side ?? null,
    act: (action, expect) => localJSON(`${code}/act`, { token: seat()?.token, action, expect }),
    canUndo: doc => { const last = doc?.actions?.at(-1); return !!last && last.side === seat()?.side; },
    undo: () => localJSON(`${code}/undo`, { token: seat()?.token }),
    async join(side) { const d = await localJSON(`${code}/join`, { side, token: seat()?.token }); ss.set(seatKey(code), { side: d.side, token: d.token }); remember(code, d.config); return d; },
    async leave() { const d = await localJSON(`${code}/leave`, { token: seat()?.token }); ss.del(seatKey(code)); return d; },
  };
}

export async function render(app, route) {
  const code = String(route.parts[1] || '').toUpperCase();
  if (!code) return lobby(app, route);
  if (code === 'LOCAL') return room(app, localStore(), route);
  return room(app, onlineStore(code), route);
}

/* ====================================================================== lobby */
async function lobby(app, route) {
  setTitle('Draft');
  const cfg = await companion();
  const saved = ls.get(SETUP_KEY, {});
  const setup = { preset: 'bo3', names: { a: 'Player 1', b: 'Player 2' }, first: 'coin', pool: [...D.DEFAULT_POOL], script: null, title: '', ...saved, names: { ...{ a: 'Player 1', b: 'Player 2' }, ...(saved.names || {}) } };
  const ui = { error: null, busy: false, joinCode: String(route.query.code || ''), extraMap: '' };
  const holder = el('div'); app.append(holder);
  const scriptFor = () => setup.script ?? (D.PRESET[setup.preset] || D.PRESETS[0]).script;
  const bestOfFor = () => setup.bestOf ?? (D.PRESET[setup.preset] || D.PRESETS[0]).bestOf;
  const persist = () => ls.set(SETUP_KEY, setup);
  function build() {
    return D.makeConfig({ preset: setup.preset, bestOf: bestOfFor(), script: scriptFor(), mapPool: setup.pool, names: setup.names, first: setup.first, title: setup.title });
  }
  function startLocal() {
    try {
      const config = build();
      if (ls.get(LOCAL_KEY, null)?.actions?.length && !confirm('Replace the hot-seat draft already in this browser?')) return;
      ls.set(LOCAL_KEY, { config, actions: [], acting: null }); persist();
      navigate('/draft/local');
    } catch (e) { ui.error = e.message; draw(); }
  }
  async function createShared() {
    let config;
    try { config = build(); } catch (e) { ui.error = e.message; draw(); return; }
    ui.busy = true; ui.error = null; draw();
    try {
      const d = await localJSON('new', { config, claim: 'a' });
      ss.set(seatKey(d.code), { side: 'a', token: d.token }); remember(d.code, d.config); persist();
      navigate(`/draft/${d.code}`);
    } catch (e) { ui.error = e.message; ui.busy = false; draw(); }
  }

  function draw() {
    clear(holder);
    holder.append(pageHead('Draft', 'Pick and ban like a tournament, then play the series: the loser picks the map, both pick two civilizations, each snipes one of the other\'s, and the civ that is left gets played.'));
    if (ui.error) holder.append(el('div', { class: 'error-box', role: 'alert', style: { marginBottom: '12px' } }, el('strong', {}, 'Cannot start'), ui.error));
    holder.append(el('div', { class: 'grid main-side', style: { alignItems: 'start' } }, setupCard(), el('div', { class: 'stack' }, joinCard(), rulesCard())));
  }
  function input(value, onInput, attrs = {}) { return el('input', { class: 'dr-input', type: 'text', value, onInput: e => onInput(e.target.value), ...attrs }); }

  function setupCard() {
    const box = el('div', { class: 'stack' });
    box.append(el('div', { class: 'dr-form' },
      el('label', {}, el('span', {}, 'Series title (optional)'), input(setup.title, v => { setup.title = v; }, { placeholder: 'e.g. Quarterfinal · Forge Cup', maxlength: 60 })),
      el('label', {}, el('span', {}, 'Player 1'), input(setup.names.a, v => { setup.names.a = v; }, { maxlength: 24 })),
      el('label', {}, el('span', {}, 'Player 2'), input(setup.names.b, v => { setup.names.b = v; }, { maxlength: 24 }))));
    // format
    const presetSeg = segmented([...D.PRESETS.map(p => ({ value: p.key, label: p.label })), { value: 'custom', label: 'Custom' }], setup.preset, v => { setup.preset = v; if (v !== 'custom') { setup.script = null; setup.bestOf = null; } else { setup.script = scriptFor(); setup.bestOf = bestOfFor(); } draw(); }, { ariaLabel: 'Format' });
    const p = D.PRESET[setup.preset];
    box.append(el('div', {}, el('div', { class: 'dr-label' }, 'Format'), presetSeg, el('p', { class: 'muted small', style: { margin: '6px 0 0' } }, p ? p.blurb : 'Edit the step script and the best-of below.')));
    box.append(el('div', {}, el('div', { class: 'dr-label' }, 'Who drafts first'), segmented([{ value: 'coin', label: 'Coin flip (from the seed)' }, { value: 'a', label: setup.names.a || 'Player 1' }, { value: 'b', label: setup.names.b || 'Player 2' }], setup.first, v => { setup.first = v; draw(); }, { ariaLabel: 'Who drafts first' })));
    // map pool
    const pool = setup.pool;
    const all = [...new Set([...D.MAPS, ...pool])];
    box.append(el('div', {}, el('div', { class: 'dr-label' }, `Map pool · ${pool.length} maps`),
      el('div', { class: 'dr-mapchips' }, all.map(m => { const on = pool.includes(m); return el('button', { type: 'button', class: `dr-chip ${on ? 'on' : ''}`, 'aria-pressed': String(on), onClick: () => { if (on) setup.pool = pool.filter(x => x !== m); else setup.pool = [...pool, m]; draw(); } }, m); })),
      el('div', { class: 'dr-inline', style: { marginTop: '6px' } }, input(ui.extraMap, v => { ui.extraMap = v; }, { placeholder: 'Add a map by name…', maxlength: 40, style: { maxWidth: '240px' } }),
        el('button', { class: 'btn sm', type: 'button', onClick: () => { const m = ui.extraMap.trim(); if (m && !pool.includes(m)) setup.pool = [...pool, m]; ui.extraMap = ''; draw(); } }, 'Add'),
        el('button', { class: 'btn sm ghost', type: 'button', onClick: () => { setup.pool = [...D.DEFAULT_POOL]; draw(); } }, 'Reset to the ranked pool'))));
    // script
    const ta = el('textarea', { class: 'dr-script', rows: 3, spellcheck: 'false', 'aria-label': 'Draft script', onInput: e => { setup.script = e.target.value; setup.preset = 'custom'; setup.bestOf = bestOfFor(); } }, scriptFor());
    const bo = el('input', { class: 'dr-input', type: 'number', min: 1, max: 15, step: 2, value: bestOfFor(), style: { width: '80px' }, 'aria-label': 'Best of', onInput: e => { setup.bestOf = Number(e.target.value); setup.preset = 'custom'; setup.script = scriptFor(); } });
    box.append(el('details', { class: 'dr-details', open: setup.preset === 'custom' ? true : null }, el('summary', {}, 'Step script and best-of'),
      el('div', { class: 'stack', style: { marginTop: '8px' } },
        el('div', { class: 'dr-inline' }, el('span', { class: 'muted small' }, 'Best of'), bo),
        ta,
        el('p', { class: 'muted small', style: { margin: 0 } }, 'One token per step, in order: ', el('code', {}, 'map_ban'), ', ', el('code', {}, 'map_pick'), ', ', el('code', {}, 'civ_ban'), ' or ', el('code', {}, 'civ_pick'), ' followed by ', el('code', {}, ':a'), ' or ', el('code', {}, ':b'), '. Map picks become the series pool (otherwise the unbanned maps are). Civ bans are global. Civ pool picks restrict that player to their pool for the whole series; leave them out and any unbanned civ may be brought to a game.'))));
    // summary + actions
    let summary;
    try { const c = build(); const n = t => c.script.filter(s => s.type === t).length; summary = `Best of ${c.bestOf} · ${n('map_ban')} map bans, ${n('map_pick')} map picks, ${n('civ_ban')} civ bans${n('civ_pick') ? `, ${n('civ_pick')} civ pool picks` : ''} · ${c.mapPool.length} maps in the pool · first to ${D.needWins(c)} wins`; } catch (e) { summary = el('span', { class: 'bad' }, e.message); }
    box.append(el('p', { class: 'dr-summary' }, summary));
    const canShare = !!cfg;
    box.append(el('div', { class: 'dr-inline' },
      el('button', { class: 'btn primary', type: 'button', disabled: ui.busy ? true : null, onClick: createShared, title: canShare ? 'Each player joins from their own browser with the code' : 'Needs the companion server' }, 'Create a shared draft'),
      el('button', { class: 'btn', type: 'button', disabled: ui.busy ? true : null, onClick: startLocal }, 'Play on this screen (hot seat)')));
    if (!canShare) box.append(el('p', { class: 'muted small', style: { margin: 0 } }, el('strong', {}, 'Shared drafts need the companion. '), ...companionHint(), ' Hot seat works everywhere: both players act on one screen, and blind picks hide themselves until both are in.'));
    else box.append(el('p', { class: 'muted small', style: { margin: 0 } }, 'A shared draft gets a code; you take the seat of ', el('strong', {}, setup.names.a || 'Player 1'), ' and your opponent joins as ', el('strong', {}, setup.names.b || 'Player 2'), ' from any browser that can reach this server. Anyone else with the code spectates.'));
    return card('New draft', box, { level: 2 });
  }

  function joinCard() {
    const box = el('div', { class: 'stack' });
    const codeIn = input(ui.joinCode, v => { ui.joinCode = v.toUpperCase(); }, { placeholder: 'Draft code', maxlength: 12, style: { textTransform: 'uppercase', fontFamily: 'var(--mono)', letterSpacing: '.08em' }, onKeydown: e => { if (e.key === 'Enter') go(); } });
    const go = () => { const c = ui.joinCode.trim().toUpperCase(); if (c) navigate(`/draft/${c}`); };
    box.append(el('div', { class: 'dr-inline' }, codeIn, el('button', { class: 'btn', type: 'button', onClick: go, disabled: cfg ? null : true, title: cfg ? '' : 'Needs the companion server' }, 'Open')));
    if (!cfg) box.append(el('p', { class: 'muted small', style: { margin: 0 } }, 'Shared drafts are not reachable from this copy of the site.'));
    const recent = ls.get(RECENT_KEY, []);
    const local = ls.get(LOCAL_KEY, null);
    const rows = [];
    if (local) rows.push(el('a', { class: 'dr-recent', href: hrefTo('/draft/local') }, el('span', { class: 'dr-code' }, 'hot seat'), el('span', {}, `${local.config.names.a} vs ${local.config.names.b}`), el('span', { class: 'muted small' }, `${local.actions.length} actions`)));
    if (cfg) for (const r of recent) rows.push(el('a', { class: 'dr-recent', href: hrefTo(`/draft/${r.code}`) }, el('span', { class: 'dr-code' }, r.code), el('span', {}, r.title || `${r.names?.a} vs ${r.names?.b}`), el('span', { class: 'muted small' }, fmt.rel(r.at))));
    box.append(el('div', {}, el('div', { class: 'dr-label' }, 'Recent'), rows.length ? el('div', { class: 'dr-recents' }, rows) : el('p', { class: 'muted small', style: { margin: 0 } }, 'Nothing yet.')));
    return card('Join a draft', box, { level: 3 });
  }
  function rulesCard() {
    return card('How a series runs', el('ol', { class: 'dr-rules' },
      el('li', {}, el('strong', {}, 'Draft. '), 'The two sides alternate through the script: map bans, map picks, civ bans and, if the format has them, civ pool picks. A coin flip from the seed decides who starts unless you set it.'),
      el('li', {}, el('strong', {}, 'Map. '), 'Game 1 is played on the first map picked in the draft (the page says who picked it); when the draft picks no maps, a coin flip from the seed names who picks it from the pool. From game 2 on, the loser of the previous game picks from the unplayed maps; the last map left is assigned by itself.'),
      el('li', {}, el('strong', {}, 'Two civs. '), 'Both players pick two civilizations, blind, from everything that is not banned (or from their pool). Both pairs are revealed together.'),
      el('li', {}, el('strong', {}, 'Snipe. '), 'Each player removes one of the opponent\'s two, blind. Everyone plays the civ that is left. A sniped civ can be picked again in a later game.'),
      el('li', {}, el('strong', {}, 'Result. '), 'Either player enters who won. The score updates and the next game starts with the map pick, until one side has the wins the best-of needs.')), { level: 3 });
  }
  draw();
}

/* ====================================================================== room */
async function room(app, store, route) {
  setTitle('Draft');
  const holder = el('div'); app.append(holder); holder.append(skeleton(6, { height: 22 }));
  const ui = { selected: [], busy: false, error: null, timer: null, editName: null, nameDraft: '', copied: false, onStorage: null };
  let doc = null, st = null;

  async function load() {
    try { doc = await store.load(); } catch (e) {
      clear(holder);
      const hint = store.kind === 'online' && (e.status === 404 || !e.status) ? (e.status === 404 ? 'No draft has that code on this companion.' : ['Shared drafts need the companion. ', ...companionHint()]) : null;
      holder.append(pageHead('Draft'), errorBox(e, load), hint ? el('p', { class: 'muted small', style: { marginTop: '10px' } }, hint) : null, el('p', { style: { marginTop: '10px' } }, el('a', { href: hrefTo('/draft') }, '← All drafts')));
      return false;
    }
    st = D.reduce(doc.config, doc.actions);
    if (store.hotseat && !store.mySide()) store.setActing(st.step?.by === 'both' ? 'a' : (st.step?.by || 'a'));
    if (store.kind === 'online') remember(store.code, doc.config);
    draw();
    return true;
  }
  function refreshFrom(d) { doc = d; st = D.reduce(doc.config, doc.actions); }
  async function act(action) {
    const err = D.check(st, action);
    if (err) { ui.error = err; draw(); return; }
    ui.busy = true; ui.error = null; draw();
    try { refreshFrom(await store.act(action, doc.version)); ui.selected = []; }
    catch (e) { ui.error = e.message || String(e); if (e.state) refreshFrom(e.state); }
    ui.busy = false;
    if (store.hotseat && st.step) {   // the screen follows the turn: whoever must act next is "acting"
      const s = st.step;
      if (s.by !== 'both') store.setActing(s.by);
      else if (s.waiting.length === 1) store.setActing(s.waiting[0]);
    }
    draw();
  }
  async function run(fn) { ui.busy = true; ui.error = null; draw(); try { const d = await fn(); if (d?.actions) refreshFrom(d); } catch (e) { ui.error = e.message || String(e); if (e.state) refreshFrom(e.state); } ui.busy = false; draw(); }

  const name = side => st.names[side];
  const viewer = () => store.mySide();
  const mine = side => (store.hotseat ? true : viewer() === side);        // may this screen act for `side`?
  const sees = side => store.hotseat ? viewer() === side : viewer() === side;  // may this screen see `side`'s blind, pending choice?
  const inviteUrl = () => `${location.origin}${location.pathname}#/draft/${store.code}`;

  function draw() {
    clear(holder);
    const c = st.config, step = st.step, g = st.current;
    /* head */
    const title = c.title || `${name('a')} vs ${name('b')}`;
    const sub = `${c.preset !== 'custom' ? D.PRESET[c.preset].label : `Best of ${c.bestOf} · custom script`} · first to ${D.needWins(c)}${store.hotseat ? ' · hot seat on this screen' : ` · code ${store.code}`}`;
    const headActions = el('div', { class: 'dr-inline' });
    if (store.hotseat) headActions.append(el('span', { class: 'muted small' }, 'Acting as'), segmented([{ value: 'a', label: name('a') }, { value: 'b', label: name('b') }], viewer(), v => { store.setActing(v); ui.selected = []; draw(); }, { ariaLabel: 'Acting as' }));
    else {
      const v = viewer();
      if (v) headActions.append(el('span', { class: `pill dr-you ${v}` }, `You are ${name(v)}`), el('button', { class: 'btn sm ghost', type: 'button', disabled: ui.busy ? true : null, onClick: () => run(() => store.leave()) }, 'Leave seat'));
      else {
        headActions.append(el('span', { class: 'pill neutral' }, 'Spectating'));
        for (const s of ['a', 'b']) if (!doc.seats?.[s]) headActions.append(el('button', { class: 'btn sm', type: 'button', disabled: ui.busy ? true : null, onClick: () => run(() => store.join(s)) }, `Join as ${name(s)}`));
      }
      headActions.append(el('button', { class: 'btn sm', type: 'button', title: inviteUrl(), onClick: async () => { ui.copied = await copyText(inviteUrl()); draw(); setTimeout(() => { ui.copied = false; draw(); }, 2000); } }, ui.copied ? 'Link copied' : 'Copy invite link'));
    }
    holder.append(pageHead(title, sub, headActions));
    if (ui.error) holder.append(el('div', { class: 'error-box', role: 'alert', style: { marginBottom: '12px' } }, el('strong', {}, 'Not accepted'), ui.error));
    if (st.skipped.length) holder.append(notice(el('strong', {}, `${st.skipped.length} action(s) in the log were skipped as illegal; `), 'the rest of the state is derived without them.'));

    holder.append(timelineEl());
    holder.append(statusEl());
    holder.append(el('div', { class: 'dr-teams' }, teamPanel('a'), vsEl(), teamPanel('b')));
    holder.append(boardEl());
    holder.append(el('div', { class: 'grid main-side', style: { marginTop: '16px', alignItems: 'start' } }, gamesCard(), activityCard()));
    holder.append(footEl());
  }

  /* ---------- timeline ---------- */
  function timelineEl() {
    const items = D.timeline(st);
    const groups = [];
    for (const it of items) { let grp = groups.at(-1); if (!grp || grp.key !== it.group) { grp = { key: it.group, game: it.game, items: [] }; groups.push(grp); } grp.items.push(it); }
    const label = grp => grp.game ? `Game ${grp.game}` : { map_ban: 'Map bans', map_pick: 'Map picks', civ_ban: 'Civ bans', civ_pick: 'Civ pools' }[grp.key];
    const done = items.filter(i => i.done).length;
    const dotTitle = it => `${D.STEP_LABEL[it.type]}${it.side === 'both' ? ' · both' : ` · ${name(it.side)}`}${it.value ? ` · ${it.type === 'game_result' ? name(it.value) + ' won' : CIVS[it.value]?.name || it.value}` : ''}`;
    return el('div', { class: 'dr-timeline card', 'aria-label': 'Timeline' },
      el('div', { class: 'dr-tl-head' }, el('span', { class: 'dr-label' }, 'Timeline'), el('span', { class: 'muted small num' }, `${done}/${items.length}${st.phase === 'done' ? ' · series over' : ''}`)),
      el('div', { class: 'dr-tgroups' }, groups.map(grp => el('div', { class: `dr-tgroup ${grp.items.some(i => i.now) ? 'now' : grp.items.every(i => i.done) ? 'done' : ''}` },
        el('span', { class: 'dr-tg-label' }, label(grp)),
        el('div', { class: 'dr-dots' }, grp.items.map(it => el('span', { class: `dr-dot ${it.side} ${it.done ? 'done' : ''} ${it.now ? 'now' : ''}`, title: dotTitle(it) })))))));
  }

  /* ---------- status banner ---------- */
  function statusEl() {
    const step = st.step, g = st.current;
    let h, sub, cls = '';
    if (!step) { h = `${name(st.winner)} wins the series ${st.score.a}–${st.score.b}`; sub = `${st.games.length} game${st.games.length === 1 ? '' : 's'} played · best of ${st.config.bestOf}`; cls = 'done'; }
    else {
      const who = step.by === 'both' ? null : step.by;
      const turnTxt = who ? (mine(who) && (!store.hotseat || viewer() === who) ? 'Your turn' : `${name(who)} to act`) : `Both players, blind · waiting for ${step.waiting.map(name).join(' and ')}`;
      if (who && mine(who) && (!store.hotseat || viewer() === who)) cls = 'mine';
      if (step.by === 'both' && step.waiting.some(s => mine(s) && (!store.hotseat || viewer() === s))) cls = 'mine';
      switch (step.type) {
        case 'map_ban': h = 'Ban a map'; sub = `${turnTxt} · ${D.openMaps(st).length} maps open`; break;
        case 'map_pick': h = 'Pick a map'; sub = `${turnTxt} · picked maps form the series pool`; break;
        case 'civ_ban': h = 'Ban a civilization'; sub = `${turnTxt} · bans apply to both players`; break;
        case 'civ_pick': h = 'Pick a civilization for your pool'; sub = `${turnTxt} · ${name(who)}'s pool: ${st.pools[who].length} so far`; break;
        case 'game_map': h = `Game ${g.n} · pick the map`; sub = `${turnTxt} (${g.mapWhy}) · ${D.availableMaps(st).length} maps available`; break;
        case 'game_civs': h = `Game ${g.n} · pick two civilizations`; sub = `${g.map} · ${turnTxt}`; break;
        case 'game_snipe': h = `Game ${g.n} · snipe one of the opponent's two`; sub = `${g.map} · ${turnTxt}`; break;
        case 'game_result': h = `Game ${g.n} · who won?`; sub = `${g.map} · ${name('a')} as ${civName(D.playing(g, 'a'))} vs ${name('b')} as ${civName(D.playing(g, 'b'))}`; break;
        default: h = step.type; sub = '';
      }
    }
    return el('div', { class: `dr-status ${cls}` }, el('h2', {}, h), el('div', { class: 'dr-status-sub' }, sub));
  }

  /* ---------- team panels ---------- */
  function civTag(civ, { strike = false, tag = null, hidden = false, cls = '' } = {}) {
    if (hidden) return el('span', { class: `dr-civ hidden ${cls}` }, el('span', { class: 'dr-flag-blank' }), el('span', { class: 'nm' }, 'hidden'));
    return el('span', { class: `dr-civ ${strike ? 'strike' : ''} ${cls}`, title: civName(civ) }, el('img', { src: civFlag(civ), alt: '', width: 26, height: 14 }), el('span', { class: 'nm' }, civShort(civ)), tag ? el('span', { class: 'tag' }, tag) : null);
  }
  function mapTag(m, { strike = false, tag = null, cls = '' } = {}) {
    return el('span', { class: `dr-map ${strike ? 'strike' : ''} ${cls}` }, mapMark(m), el('span', { class: 'nm' }, m), tag ? el('span', { class: 'tag' }, tag) : null);
  }
  function mapMark(m) { const h = D.hashSeed(m); return el('span', { class: 'dr-mark', style: { '--h': `${h % 360}` } }, m.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()); }
  function teamPanel(side) {
    const g = st.current, step = st.step, isYou = !store.hotseat && viewer() === side;
    const acting = store.hotseat && viewer() === side;
    const head = el('div', { class: 'dr-team-head' }, el('span', { class: `dr-side-dot ${side}` }));
    if (ui.editName === side) {
      const inp = el('input', { class: 'dr-input', type: 'text', value: ui.nameDraft, maxlength: 24, 'aria-label': 'Name', onInput: e => { ui.nameDraft = e.target.value; }, onKeydown: e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { ui.editName = null; draw(); } } });
      const save = () => { const v = ui.nameDraft.trim(); ui.editName = null; if (v && v !== name(side)) act({ t: 'name', side, value: v }); else draw(); };
      head.append(inp, el('button', { class: 'btn sm', type: 'button', onClick: save }, 'Save'));
      setTimeout(() => inp.focus(), 0);
    } else {
      head.append(el('h2', { class: 'dr-team-name' }, name(side)));
      if (isYou) head.append(el('span', { class: 'badge me' }, 'you'));
      if (acting) head.append(el('span', { class: 'badge me' }, 'acting'));
      if (mine(side)) head.append(el('button', { class: 'linkish small', type: 'button', title: 'Rename', onClick: () => { ui.editName = side; ui.nameDraft = name(side); draw(); } }, 'rename'));
      if (!store.hotseat && !viewer() && !doc.seats?.[side]) head.append(el('button', { class: 'btn sm', type: 'button', style: { marginLeft: 'auto' }, disabled: ui.busy ? true : null, onClick: () => run(() => store.join(side)) }, 'Join this seat'));
      else if (!store.hotseat && !isYou) head.append(el('span', { class: 'muted small', style: { marginLeft: 'auto' } }, doc.seats?.[side] ? 'seated' : 'open seat'));
    }
    if (step && step.waiting.includes(side) && !st.winner) head.append(el('span', { class: 'dr-turn', title: 'to act' }));
    const body = el('div', { class: 'dr-team-body' }, head);
    const row = (label, content) => el('div', { class: 'dr-row' }, el('span', { class: 'dr-row-label' }, label), el('div', { class: 'dr-row-items' }, content));

    // the current game, as this side sees it
    if (g) {
      const pair = g.civs[side], hiddenPair = pair && g.stage === 'civs' && !sees(side);
      const snipedByOpp = g.snipes[D.other(side)], mySnipe = g.snipes[side], hideSnipe = mySnipe && g.stage === 'snipe' && !sees(side);
      const items = [];
      if (!pair) items.push(el('span', { class: 'muted small' }, g.stage === 'civs' ? 'picking two…' : '—'));
      else if (hiddenPair) items.push(civTag(null, { hidden: true }), civTag(null, { hidden: true }));
      else for (const civ of pair) items.push(civTag(civ, { strike: snipedByOpp === civ && (g.stage !== 'snipe' || sees(D.other(side))), tag: snipedByOpp === civ && (g.stage !== 'snipe' || sees(D.other(side))) ? 'sniped' : (g.stage === 'result' || g.winner) && D.playing(g, side) === civ ? 'plays' : null }));
      const snipeLine = g.stage === 'snipe' || g.stage === 'result' ? row('Snipes', mySnipe ? (hideSnipe ? el('span', { class: 'muted small' }, 'sniped · hidden until both are in') : civTag(mySnipe, { strike: true, tag: `removed from ${name(D.other(side))}` })) : el('span', { class: 'muted small' }, 'choosing…')) : null;
      body.append(el('div', { class: 'dr-game-now' }, el('div', { class: 'dr-label' }, `Game ${g.n}${g.map ? ` · ${g.map}` : ''}`), row('Two civs', items), snipeLine));
    }
    // draft results of this side
    const picks = st.mapPicks.filter(p => p.by === side).map(p => mapTag(p.map, { tag: st.games.find(x => x.map === p.map) ? `G${st.games.find(x => x.map === p.map).n}` : g?.map === p.map ? `G${g.n}` : null }));
    body.append(row('Maps', picks.length ? picks : el('span', { class: 'muted small' }, st.script.some(s => s.type === 'map_pick' && s.by === side) ? 'no picks yet' : 'no map picks in this format')));
    const bans = [...st.mapBans[side].map(m => mapTag(m, { strike: true })), ...st.civBans[side].map(civ => civTag(civ, { strike: true }))];
    body.append(row('Bans', bans.length ? bans : el('span', { class: 'muted small' }, 'none yet')));
    if (st.pools[side].length || st.script.some(s => s.type === 'civ_pick' && s.by === side)) body.append(row('Civ pool', st.pools[side].length ? st.pools[side].map(civ => civTag(civ)) : el('span', { class: 'muted small' }, 'empty')));
    const played = st.games.map(x => x.played?.[side]).filter(Boolean);
    if (played.length) body.append(row('Played', played.map((civ, i) => civTag(civ, { tag: `G${st.games[i].n}`, cls: st.games[i].winner === side ? 'won' : 'lost' }))));
    return el('section', { class: `dr-team ${side} ${isYou || acting ? 'you' : ''} ${step?.waiting.includes(side) ? 'turn' : ''}` }, body);
  }
  function vsEl() {
    return el('div', { class: 'dr-vs' }, el('div', { class: `dr-score num ${st.winner ? 'final' : ''}` }, el('span', { class: 'a' }, String(st.score.a)), el('span', { class: 'dash' }, '–'), el('span', { class: 'b' }, String(st.score.b))),
      el('div', { class: 'muted small' }, st.winner ? `${name(st.winner)} wins` : `first to ${D.needWins(st.config)}`),
      el('div', { class: 'muted small' }, st.first ? `${name(st.first)} drafted first (${st.config.first === 'coin' ? 'coin flip' : 'chosen'})` : ''));
  }

  /* ---------- the board: what the acting player chooses from ---------- */
  function boardEl() {
    const step = st.step, g = st.current;
    if (!step) {
      return el('div', { class: 'dr-board card dr-final' }, el('h2', {}, `${name(st.winner)} wins ${st.score.a}–${st.score.b}`),
        el('p', { class: 'muted' }, st.games.map(x => `G${x.n} ${x.map}: ${name(x.winner)} (${civShort(x.played[x.winner])} over ${civShort(x.played[D.other(x.winner)])})`).join(' · ')),
        el('div', { class: 'dr-inline' }, el('a', { class: 'btn primary', href: hrefTo('/draft') }, 'New draft')));
    }
    const actor = step.by !== 'both' ? step.by : (store.hotseat ? viewer() : viewer());
    const canAct = actor && mine(actor) && (!store.hotseat || viewer() === actor) && !ui.busy;
    const waitingNote = () => {
      if (store.hotseat) return notice(el('strong', {}, `${name(step.by === 'both' ? step.waiting[0] : step.by)} to act. `), 'Switch "Acting as" in the header, or pass the screen.');
      if (!viewer()) return notice(el('strong', {}, 'You are spectating. '), 'Join an open seat above to play.');
      return notice(el('strong', {}, `Waiting for ${step.waiting.filter(s => s !== viewer()).map(name).join(' and ') || name(step.by)}. `), 'This page refreshes by itself.');
    };
    const head = (label, hint) => el('div', { class: 'dr-board-head' }, el('span', { class: 'dr-label' }, label), hint ? el('span', { class: 'muted small' }, hint) : null);

    /* maps */
    if (['map_ban', 'map_pick', 'game_map'].includes(step.type)) {
      const open = step.type === 'game_map' ? D.availableMaps(st) : D.openMaps(st);
      const series = D.seriesMaps(st);
      const tiles = st.config.mapPool.map(m => {
        const banBy = st.mapBans.a.includes(m) ? 'a' : st.mapBans.b.includes(m) ? 'b' : null;
        const pick = st.mapPicks.find(p => p.map === m);
        const playedIn = st.games.find(x => x.map === m);
        const ok = open.includes(m);
        let tag = banBy ? `banned by ${name(banBy)}` : playedIn ? `played in game ${playedIn.n}` : pick ? `picked by ${name(pick.by)}` : step.type === 'game_map' && !series.includes(m) ? 'not in the series pool' : '';
        return el('button', { type: 'button', class: `dr-tile map ${banBy ? 'banned' : ''} ${pick && step.type !== 'game_map' ? 'picked' : ''} ${!ok ? 'off' : ''} ${ok && canAct ? 'live' : ''}`, disabled: !ok || !canAct ? true : null, title: tag || m,
          onClick: () => act({ t: step.type, side: actor, value: m }) }, mapMark(m), el('span', { class: 'nm' }, m), tag ? el('span', { class: 'tag' }, tag) : null);
      });
      return el('div', { class: 'dr-board card' }, head(step.type === 'game_map' ? `Maps for game ${g.n}` : 'Map pool', step.type === 'map_ban' ? 'click a map to ban it' : step.type === 'map_pick' ? 'click a map to pick it into the series pool' : `${name(actor)} picks (${g.mapWhy})`), !canAct ? waitingNote() : null, el('div', { class: 'dr-grid maps' }, tiles));
    }
    /* civ bans and pool picks */
    if (step.type === 'civ_ban' || step.type === 'civ_pick') {
      const tiles = D.CIV_IDS.map(civ => {
        const banBy = D.bannedBy(st, civ);
        const inPool = st.pools.a.includes(civ) ? 'a' : st.pools.b.includes(civ) ? 'b' : null;
        const ok = step.type === 'civ_ban' ? !banBy && !inPool : !banBy && !st.pools[actor].includes(civ);
        const tag = banBy ? `banned by ${name(banBy)}` : inPool ? `${name(inPool)}'s pool` : '';
        return civTile(civ, { cls: `${banBy ? 'banned' : ''} ${inPool ? `pool-${inPool}` : ''} ${!ok ? 'off' : ''} ${ok && canAct ? 'live' : ''}`, disabled: !ok || !canAct, tag, onClick: () => act({ t: step.type, side: actor, value: civ }) });
      });
      return el('div', { class: 'dr-board card' }, head('Civilizations', step.type === 'civ_ban' ? 'click a civilization to ban it for both players' : `click a civilization to add it to ${name(actor)}'s pool`), !canAct ? waitingNote() : null, el('div', { class: 'dr-grid' }, tiles));
    }
    /* two civs, blind */
    if (step.type === 'game_civs') {
      const side = actor;
      if (!side || !mine(side) || (store.hotseat && viewer() !== side)) return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · two civilizations`), waitingNote());
      if (g.civs[side]) return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · two civilizations`), notice(el('strong', {}, 'Your pair is in: '), g.civs[side].map(civName).join(' + '), store.hotseat ? ` · now pass the screen to ${name(D.other(side))} (switch "Acting as").` : ` · waiting for ${name(D.other(side))}.`));
      const sel = ui.selected;
      const tiles = D.CIV_IDS.map(civ => {
        const ok = D.civAllowed(st, side, civ), banBy = D.bannedBy(st, civ), on = sel.includes(civ);
        const tag = banBy ? `banned by ${name(banBy)}` : !ok ? 'not in your pool' : st.games.some(x => x.snipes[D.other(side)] === civ) ? 'sniped before · allowed' : '';
        return civTile(civ, { cls: `${banBy ? 'banned' : ''} ${!ok ? 'off' : ''} ${on ? 'sel' : ''} ${ok && canAct ? 'live' : ''}`, disabled: !ok || !canAct, tag, pressed: on,
          onClick: () => { if (on) ui.selected = sel.filter(c => c !== civ); else ui.selected = [...sel.slice(-1), civ]; draw(); } });
      });
      const lock = el('div', { class: 'dr-lock' }, el('span', {}, sel.length ? ['Selected: ', ...sel.map(c => civTag(c))] : el('span', { class: 'muted' }, 'Select two civilizations')),
        el('button', { class: 'btn primary', type: 'button', disabled: sel.length !== 2 || !canAct ? true : null, onClick: () => act({ t: 'game_civs', side, value: [...sel] }) }, 'Lock in'));
      return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · pick two civilizations`, `${name(side)} · blind: the opponent sees your pair once both are in`), lock, el('div', { class: 'dr-grid' }, tiles));
    }
    /* snipe */
    if (step.type === 'game_snipe') {
      const side = actor;
      if (!side || !mine(side) || (store.hotseat && viewer() !== side)) return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · snipe`), waitingNote());
      const opp = D.other(side);
      if (g.snipes[side]) return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · snipe`), notice(el('strong', {}, `You removed ${civName(g.snipes[side])}. `), store.hotseat ? `Pass the screen to ${name(opp)} (switch "Acting as").` : `Waiting for ${name(opp)}.`));
      return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · snipe`, `${name(side)}: remove one of ${name(opp)}'s two; they play the other`),
        el('div', { class: 'dr-snipe' }, g.civs[opp].map(civ => el('button', { type: 'button', class: 'dr-tile big live', disabled: !canAct ? true : null, onClick: () => act({ t: 'game_snipe', side, value: civ }) }, el('img', { src: civFlag(civ), alt: '' }), el('span', { class: 'nm' }, civName(civ)), el('span', { class: 'tag' }, `remove · ${name(opp)} plays ${civShort(g.civs[opp].find(c => c !== civ))}`)))),
        el('p', { class: 'muted small', style: { margin: '10px 0 0' } }, `Your own pair, ${g.civs[side].map(civName).join(' + ')}, is being sniped by ${name(opp)} at the same time.`));
    }
    /* result */
    if (step.type === 'game_result') {
      const allowed = store.hotseat || !!viewer();
      return el('div', { class: 'dr-board card' }, head(`Game ${g.n} · result`, `${g.map} · ${name('a')} plays ${civName(D.playing(g, 'a'))}, ${name('b')} plays ${civName(D.playing(g, 'b'))}`),
        allowed ? el('div', { class: 'dr-inline' }, ['a', 'b'].map(s => el('button', { class: `btn ${s === 'a' ? 'primary' : ''}`, type: 'button', disabled: ui.busy ? true : null, onClick: () => act({ t: 'game_result', side: store.hotseat ? s : viewer(), value: s }) }, `${name(s)} won`)),
          el('span', { class: 'muted small' }, 'Either player can enter the result; the other can undo it.')) : waitingNote());
    }
    return el('div');
  }
  function civTile(civ, { cls = '', disabled = false, tag = '', pressed = null, onClick } = {}) {
    return el('button', { type: 'button', class: `dr-tile ${cls}`, disabled: disabled ? true : null, 'aria-pressed': pressed === null ? null : String(pressed), title: tag || civName(civ), onClick },
      el('img', { src: civFlag(civ), alt: '', loading: 'lazy' }), el('span', { class: 'nm' }, civName(civ)), tag ? el('span', { class: 'tag' }, tag) : null);
  }

  /* ---------- games + activity ---------- */
  function gamesCard() {
    const rows = st.games.map(x => el('div', { class: 'dr-gamerow' }, el('span', { class: 'muted small num' }, `Game ${x.n}`), mapTag(x.map),
      el('span', { class: 'dr-gameciv' }, civTag(x.played.a, { cls: x.winner === 'a' ? 'won' : 'lost' }), el('span', { class: 'muted small' }, 'vs'), civTag(x.played.b, { cls: x.winner === 'b' ? 'won' : 'lost' })),
      el('span', { class: 'spacer' }), el('span', { class: `dr-winner ${x.winner}` }, `${name(x.winner)} won`),
      el('span', { class: 'muted small', title: `${name('a')} sniped ${civName(x.snipes.a)}, ${name('b')} sniped ${civName(x.snipes.b)}` }, `snipes: ${civShort(x.snipes.a)} / ${civShort(x.snipes.b)}`)));
    if (st.current) {
      const g = st.current;
      rows.push(el('div', { class: 'dr-gamerow pending' }, el('span', { class: 'muted small num' }, `Game ${g.n}`), g.map ? mapTag(g.map) : el('span', { class: 'muted small' }, `map: ${name(g.mapBy)} picks (${g.mapWhy})`), el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, D.STEP_LABEL[st.step.type])));
    }
    return card('Games', rows.length ? el('div', { class: 'dr-games' }, rows) : emptyState('The games start when the draft is complete.'), { level: 3, meta: `${st.score.a}–${st.score.b} · best of ${st.config.bestOf}` });
  }
  function activityCard() {
    const items = [...st.log].reverse().slice(0, 30).map(l => el('li', {}, el('span', { class: `dr-side-dot ${l.side}` }), ' ', l.text));
    return card('Activity', items.length ? el('ul', { class: 'dr-log' }, items) : emptyState('Nothing yet.'), { level: 3 });
  }
  function footEl() {
    const canUndo = store.hotseat ? store.canUndo() : store.canUndo(doc);
    return el('div', { class: 'dr-foot' },
      el('span', { class: 'muted small' }, 'Seed ', el('code', { class: 'dr-code' }, st.config.seed)),
      store.kind === 'online' ? el('span', { class: 'muted small' }, 'Code ', el('code', { class: 'dr-code' }, store.code)) : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn sm ghost', type: 'button', disabled: !canUndo || ui.busy ? true : null, title: store.hotseat ? 'Take back the last action' : 'Take back your own last action (only when it is the latest one)', onClick: () => run(() => store.undo()) }, 'Undo last action'),
      el('a', { class: 'btn sm ghost', href: hrefTo('/draft') }, 'All drafts'));
  }

  if (!(await load())) return;
  if (store.poll) {
    ui.timer = setInterval(async () => {
      if (document.hidden || ui.busy) return;
      try { const d = await store.load(); if (d.version !== doc.version || JSON.stringify(d.seats) !== JSON.stringify(doc.seats) || d.updated !== doc.updated) { refreshFrom(d); draw(); } } catch { /* next tick */ }
    }, POLL_MS);
  } else {
    ui.onStorage = e => { if (e.key === LOCAL_KEY) load(); };
    window.addEventListener('storage', ui.onStorage);
  }
  return () => { if (ui.timer) clearInterval(ui.timer); if (ui.onStorage) window.removeEventListener('storage', ui.onStorage); };
}
