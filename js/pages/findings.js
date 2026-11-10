// Findings: studies across a player's games, each with the sample size and the uncertainty that go with it.
// First study, "Closing out leads" (tools/closing.py, served at local/closing/:id): how often a resource lead becomes a
// win, mirrored against what opponents do with the same lead, where leads are lost, and which games to review.
// Everything comes from the companion's store; the static copy shows a notice.
import { el, fmt, hrefTo, clear, setTitle, append } from '../util.js';
import { getJSON, ApiError } from '../api.js';
import { card, select, segmented, notice, skeleton, statTile, dataTable, civChip, subTabs } from '../components.js';
import { CIVS, civName, civShort, kindName } from '../constants.js';
import { pageHead, companionNotice } from './_shared.js';
import { lineChart, intervalChart } from '../charts.js';
import { getMe } from '../me.js';

const SUB = 'Patterns across your games, with the sample sizes and intervals that go with them.';
const companionMissing = e => !(e instanceof ApiError) || [404, 501, 405].includes(e.status);
const LEADS = [250, 500, 1000, 2000];
const ATS = [10, 15, 20];
const KINDS = [{ value: '', label: 'Ranked and quick 1v1' }, { value: 'rm_1v1', label: 'Ranked 1v1' }, { value: 'qm_1v1', label: 'Quick match 1v1' }];
const PERIODS = [{ value: '', label: 'All games on record' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '180', label: 'Last 180 days' }];
const ME = '--s1', OPP = '--s2', KEPT = '--s3', LOST = '--s8';     // you / opponent as everywhere else on the site; kept / lost leads

const has = v => v !== null && v !== undefined && !Number.isNaN(v);
const pct = v => has(v) ? `${Math.round(v * 100)}%` : '—';
const ci = w => w && has(w.lo) ? `${Math.round(w.lo * 100)}–${Math.round(w.hi * 100)}` : '';
const sign = (v, text) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${text}`;
const pts = v => has(v) ? `${sign(Math.round(v * 100), Math.abs(Math.round(v * 100)))} pts` : '—';
const ptsRange = (lo, hi) => has(lo) && has(hi) ? `${sign(Math.round(lo * 100), Math.abs(Math.round(lo * 100)))} to ${sign(Math.round(hi * 100), Math.abs(Math.round(hi * 100)))}` : '—';
const num = (v, d = 0) => has(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
const signed = (v, d = 0) => { if (!has(v)) return '—'; const r = Number(Number(v).toFixed(d)); return sign(r, num(Math.abs(r), d)); };
const mm = m => has(m) ? `${Math.round(m)}:00` : '—';
const sinceFor = days => days ? new Date(Date.now() - Number(days) * 86400e3).toISOString().slice(0, 10) : '';
const w2v = w => w && w.n ? { value: w.rate * 100, lo: w.lo * 100, hi: w.hi * 100, n: w.n } : null;
const rateCell = w => !w || !w.n ? el('span', { class: 'muted' }, '—') : el('span', {}, el('span', { class: 'num' }, pct(w.rate)), ' ', el('span', { class: 'ci' }, `(${ci(w)}) · ${w.k}/${w.n}`));
const decimalsFor = key => ['mil_pm', 'eco_pm', 'spend_pm'].includes(key) ? 0 : 1;
const civOptions = first => [{ value: '', label: first }, ...Object.keys(CIVS).sort((a, b) => civName(a).localeCompare(civName(b))).map(c => ({ value: c, label: civName(c) }))];

export async function render(app, route) {
  setTitle('Findings');
  let cfg;
  try { cfg = await getJSON('local/config', { ttl: 60e3 }); } catch {
    app.append(pageHead('Findings', SUB), companionNotice('Findings'));
    return;
  }
  const q = route.query || {};
  const pid = /^\d+$/.test(q.p || '') ? q.p : (cfg.me ? String(cfg.me) : getMe());
  if (!pid) {
    app.append(pageHead('Findings', SUB), notice('Forge does not know which player you are yet. Pick yourself with ', el('strong', {}, 'This is me'), ' on your profile, or set ', el('code', {}, 'me'), ' in forge.local.json.'));
    return;
  }
  const state = {
    p: pid,
    lead: LEADS.includes(Number(q.lead)) ? Number(q.lead) : 500,
    at: ATS.includes(Number(q.at)) ? Number(q.at) : 15,
    kind: KINDS.some(k => k.value === (q.kind || '')) ? (q.kind || '') : '',
    civ: CIVS[q.civ] ? q.civ : '', vs: CIVS[q.vs] ? q.vs : '',
    days: PERIODS.some(x => x.value === (q.days || '')) ? (q.days || '') : '',
    bench: /^\d+$/.test(q.bench || '') && q.bench !== pid ? q.bench : '',
  };
  const friends = cfg.friends || [];
  const people = [...(cfg.me ? [{ value: String(cfg.me), label: 'You' }] : []), ...friends.map(f => ({ value: String(f.profile_id), label: f.name }))];
  if (!people.some(o => o.value === state.p)) people.unshift({ value: state.p, label: `Player ${state.p}` });
  const nameOf = id => people.find(o => o.value === String(id))?.label || `#${id}`;

  app.append(pageHead('Findings', SUB));
  const tabs = el('div', { class: 'tabs-row' }, subTabs([{ value: 'closing', label: 'Closing out leads' }], 'closing', () => {}), el('span', { class: 'period' }, 'the first study; others will sit beside it'));
  const filters = el('div', { class: 'filters' });
  const body = el('div', { class: 'stack findings' });
  app.append(tabs, filters, body);

  let seq = 0, report = null, bench = null;
  const syncUrl = () => history.replaceState(null, '', hrefTo('/findings', {
    p: cfg.me && state.p === String(cfg.me) ? undefined : state.p, lead: state.lead === 500 ? undefined : String(state.lead), at: state.at === 15 ? undefined : String(state.at),
    kind: state.kind || undefined, civ: state.civ || undefined, vs: state.vs || undefined, days: state.days || undefined, bench: state.bench || undefined }));
  const params = () => new URLSearchParams({ lead: String(state.lead), ...(state.kind ? { kind: state.kind } : {}), ...(state.civ ? { civ: state.civ } : {}), ...(state.vs ? { vs: state.vs } : {}), ...(state.days ? { since: sinceFor(state.days) } : {}) });

  function drawFilters() {
    clear(filters);
    const change = patch => { Object.assign(state, patch); drawFilters(); load(); };
    append(filters, [
      el('label', {}, 'Player ', select(people, state.p, v => change({ p: v, bench: state.bench === v ? '' : state.bench }), { ariaLabel: 'Player' })),
      el('label', {}, 'Mode ', select(KINDS, state.kind, v => change({ kind: v }), { ariaLabel: 'Game mode' })),
      el('label', {}, 'As ', select(civOptions('any civilization'), state.civ, v => change({ civ: v }), { ariaLabel: 'Own civilization' })),
      el('label', {}, 'against ', select(civOptions('any civilization'), state.vs, v => change({ vs: v }), { ariaLabel: 'Opponent civilization' })),
      el('label', {}, 'Period ', select(PERIODS, state.days, v => change({ days: v }), { ariaLabel: 'Period' })),
      el('label', {}, 'A lead is ', segmented(LEADS.map(v => ({ value: String(v), label: num(v), title: `${num(v)} resources more ordered than the opponent, two minutes running` })), String(state.lead), v => change({ lead: Number(v) }), { ariaLabel: 'Lead threshold' }), el('span', { class: 'muted small' }, 'resources for 2 min')),
      el('label', {}, 'Checkpoint ', segmented(ATS.map(v => ({ value: String(v), label: `${v}:00` })), String(state.at), v => { state.at = Number(v); drawFilters(); syncUrl(); if (report) draw(); }, { ariaLabel: 'Checkpoint minute' })),
      friends.length ? el('label', {}, 'Benchmark ', select([{ value: '', label: 'none' }, ...people.filter(o => o.value !== state.p)], state.bench, v => change({ bench: v }), { ariaLabel: 'Benchmark player' })) : null,
    ]);
  }

  async function load() {
    const my = ++seq;
    syncUrl();
    body.classList.add('fade');                                   // hold the previous render while the new slice loads
    if (!body.childElementCount) body.append(skeleton(12));
    try {
      const [r, b] = await Promise.all([
        getJSON(`local/closing/${state.p}?${params()}`, { ttl: 60e3 }),
        state.bench ? getJSON(`local/closing/${state.bench}?${params()}`, { ttl: 60e3 }).catch(() => null) : null]);
      if (my !== seq || !body.isConnected) return;
      report = r; bench = b;
      draw();
    } catch (e) {
      if (my !== seq) return;
      clear(body); body.classList.remove('fade');
      body.append(companionMissing(e) ? companionNotice('Findings') : notice(String(e.message || e)));
    }
  }

  function draw() {
    clear(body); body.classList.remove('fade');
    const r = report;
    if (!r.counts.games) {
      body.append(notice(el('strong', {}, `${nameOf(state.p)} has no 1v1 games with both replay sides in the store. `),
        'Replays are parsed once for every player in them; open the ', el('a', { href: hrefTo(`/player/${state.p}`) }, 'profile'), ' and use ', el('strong', {}, 'Pull every replay'), ' to fill the store, or widen the filters.'));
      return;
    }
    body.append(tiles(r), conversionCard(r, bench), lengthCard(r), trajectoryCard(r), afterCard(r), collapseCard(r), reviewCard(r), methodCard(r));
  }

  /* ---------- the cards ---------- */
  function tiles(r) {
    const c = r.counts, me = r.leads.me, op = r.leads.opp;
    return el('div', { class: 'tiles' },
      statTile({ label: 'Games analysed', value: fmt.int(c.games), sub: `${c.wins} W – ${c.losses} L · 1v1s with both replay sides` }),
      statTile({ label: 'Leads you took', value: fmt.int(me.n), sub: me.n ? `${Math.round(100 * me.n / c.games)}% of games · typical peak ${signed(me.median_peak)} · taken by ${mm(me.median_lead_at)}` : 'none at this threshold' }),
      statTile({ label: 'You converted', value: pct(me.rate), sub: me.n ? `${ci(me)} · ${me.k} of ${me.n}` : '—' }),
      statTile({ label: 'Opponents converted', value: pct(op.rate), sub: op.n ? `${ci(op)} · ${op.k} of ${op.n} leads they took against you` : '—' }),
      statTile({ label: 'Leads you lost', value: fmt.int(me.lost), sub: `${me.lost_collapsed} collapsed · ${me.lost_held} still ahead at the end` }),
      statTile({ label: 'Comebacks', value: fmt.int(op.lost), sub: 'the opponent led, you won' }));
  }

  function conversionCard(r, b) {
    const at = state.at, cp = r.checkpoints[String(at)], L = r.params.lead;
    const series = [{ key: 'me', name: 'You ahead → your win rate', color: ME }, { key: 'opp', name: 'Opponent ahead by the same → their win rate', color: OPP }];
    const groups = cp.bins.map(x => ({ label: x.key === 'even' ? `even (${x.label})` : `ahead ${x.label}`, sub: x.opp ? `n ${x.me.n} · ${x.opp.n}` : `n ${x.me.n}`, values: { me: w2v(x.me), opp: w2v(x.opp) } }));
    const o = cp.overall, d = o.diff;
    const claim = el('p', { class: 'claim' });
    if (o.me.n && o.opp.n && d) {
      const verdict = d.lo > 0 ? 'Your opponents close out leads more reliably than you do.' : d.hi < 0 ? 'You close out leads more reliably than your opponents do.' : 'The interval includes zero: this sample cannot tell the two apart yet.';
      claim.append(`Ahead by ${num(L)} or more at ${at}:00 you win `, el('strong', {}, pct(o.me.rate)), ` (${ci(o.me)}, n=${o.me.n}). When your opponents are ahead by the same margin they win `, el('strong', {}, pct(o.opp.rate)), ` (${ci(o.opp)}, n=${o.opp.n}). Gap `, el('strong', {}, pts(d.value)), ` (${ptsRange(d.lo, d.hi)}). `, verdict);
    } else claim.append(`Not enough games ran past ${at + r.params.margin}:00 with a lead of ${num(L)} on either side to compare conversion at this checkpoint.`);
    const table = el('table', { class: 'data compact' },
      el('thead', {}, el('tr', {}, el('th', {}, `Lead at ${at}:00`), el('th', {}, 'You ahead · your win rate'), el('th', {}, 'Opponent ahead · their win rate'))),
      el('tbody', {}, cp.bins.map(x => el('tr', {}, el('td', {}, x.key === 'even' ? `even, ${x.label}` : `ahead by ${x.label}`), el('td', {}, rateCell(x.me)), el('td', {}, x.opp ? rateCell(x.opp) : el('span', { class: 'muted' }, 'same games, other side')))),
        el('tr', {}, el('td', {}, el('strong', {}, `ahead by ${num(L)} or more`)), el('td', {}, rateCell(o.me)), el('td', {}, rateCell(o.opp)))));
    const benchEl = el('div', { class: 'muted small', style: { marginTop: '10px' } });
    if (state.bench) {
      if (!b) benchEl.append(`${nameOf(state.bench)} could not be loaded.`);
      else if (b.counts.games < 20) benchEl.append(el('strong', {}, `${b.name || nameOf(state.bench)}: `), `only ${b.counts.games} 1v1 game${b.counts.games === 1 ? '' : 's'} with both replay sides in the store, too few to benchmark. `, el('a', { href: hrefTo(`/player/${state.bench}`) }, 'Pull their replays ›'));
      else {
        const bo = b.checkpoints[String(at)].overall;
        benchEl.append(el('strong', {}, `Benchmark · ${b.name || nameOf(state.bench)}: `), `converts ${pct(b.leads.me.rate)} (${ci(b.leads.me)}) of ${b.leads.me.n} leads over ${b.counts.games} games; ahead by ${num(L)} or more at ${at}:00 → ${pct(bo.me.rate)} (${ci(bo.me)}, n=${bo.me.n}); their opponents convert ${pct(bo.opp.rate)} (n=${bo.opp.n}).`);
      }
    }
    return card('Do you convert a lead as well as your opponents do?', el('div', {}, claim,
      intervalChart({ groups, series, refLine: 50, yDomain: [0, 100], yFormat: v => `${Math.round(v)}%`, ariaLabel: 'Win rate by lead size, you against your opponents' }),
      el('div', { class: 'table-wrap', style: { marginTop: '10px' } }, table), benchEl),
      { meta: `lead = resources you ordered minus the opponent's, net of cancels, at ${at}:00 · games that ran past ${at + r.params.margin}:00 (n=${cp.n}; a typical total by then is ${num(cp.median_spend)}) · dots are win rates, lines their 95% intervals` });
  }

  function lengthCard(r) {
    const at = state.at, cp = r.checkpoints[String(at)], L = r.params.lead;
    const series = [{ key: 'me', name: 'You ahead → your win rate', color: ME }, { key: 'opp', name: 'Opponent ahead → their win rate', color: OPP }];
    const groups = cp.by_length.map(x => ({ label: x.label, sub: `n ${x.me.n} · ${x.opp.n}`, values: { me: w2v(x.me), opp: w2v(x.opp) } }));
    const withData = cp.by_length.filter(x => x.me.n >= 5);
    const claim = el('p', { class: 'claim' });
    if (withData.length >= 2) {
      const first = withData[0], last = withData.at(-1);
      claim.append(`With a lead of ${num(L)} or more at ${at}:00 you convert `, el('strong', {}, pct(first.me.rate)), ` of games that end ${first.label} (${ci(first.me)}, n=${first.me.n}) and `, el('strong', {}, pct(last.me.rate)), ` of games that run ${last.label} (${ci(last.me)}, n=${last.me.n}); your opponents convert ${pct(last.opp.rate)} (n=${last.opp.n}) of theirs in games that long.`);
    } else claim.append('Too few games with a lead at this checkpoint to split by game length.');
    const table = el('table', { class: 'data compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Final game length'), el('th', {}, `You ahead by ${num(L)}+ · win rate`), el('th', {}, `Opponent ahead by ${num(L)}+ · their win rate`))),
      el('tbody', {}, cp.by_length.map(x => el('tr', {}, el('td', {}, x.label), el('td', {}, rateCell(x.me)), el('td', {}, rateCell(x.opp))))));
    return card('Does the lead survive a long game?', el('div', {}, claim,
      intervalChart({ groups, series, refLine: 50, yDomain: [0, 100], yFormat: v => `${Math.round(v)}%`, ariaLabel: 'Win rate when ahead, by final game length' }),
      el('div', { class: 'table-wrap', style: { marginTop: '10px' } }, table)),
      { meta: `games with a lead of ${num(L)} or more at ${at}:00, grouped by how long they eventually ran · the game length is an outcome too: a lead that ends the game early never gets the chance to be lost` });
  }

  function trajectoryCard(r) {
    const t = r.trajectory, mins = t.minutes;
    const mk = (grp, name, color) => !grp ? null : {
      name, color,
      points: mins.map((m, i) => has(grp.median[i]) ? { x: m, y: grp.median[i], meta: { valueText: `${signed(grp.median[i])} · ${grp.n[i]} games` } } : null).filter(Boolean),
      band: mins.map((m, i) => has(grp.q1[i]) ? { x: m, lo: grp.q1[i], hi: grp.q3[i] } : null).filter(Boolean),
    };
    const series = [mk(t.converted, 'Leads you converted', KEPT), mk(t.lost, 'Leads you lost', LOST)].filter(s => s && s.points.length >= 2);
    const chart = lineChart({ series, xIsTime: false, xFormat: m => `${Math.round(m)}:00`, yFormat: v => signed(v), baseline: 0, area: false, height: 280,
      markers: [{ x: state.at, label: `${state.at}:00`, color: '--muted' }], emptyText: 'Fewer than 5 games with a lead: no trajectory to draw.' });
    const steps = mins.filter(m => m % 5 === 0);
    const cell = (grp, i) => has(grp?.median[i]) ? el('span', {}, el('span', { class: 'num' }, signed(grp.median[i])), ' ', el('span', { class: 'ci' }, `(${signed(grp.q1[i])} to ${signed(grp.q3[i])}) · n=${grp.n[i]}`)) : el('span', { class: 'muted' }, '—');
    const table = el('table', { class: 'data compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Minute'), el('th', {}, 'Converted leads · median lead (quartiles)'), el('th', {}, 'Lost leads · median lead (quartiles)'))),
      el('tbody', {}, steps.map(m => { const i = mins.indexOf(m); return el('tr', {}, el('td', {}, mm(m)), el('td', {}, cell(t.converted, i)), el('td', {}, cell(t.lost, i))); })));
    return card('How your leads evolve', el('div', {}, chart, el('div', { class: 'table-wrap', style: { marginTop: '10px' } }, table)),
      { meta: `median lead by minute across the games with a lead, the band is the middle half · each minute counts only the games still running, so late minutes describe long games · drawn while at least ${r.params.min_n} games and a ${Math.round(1 / r.params.min_share) === 5 ? 'fifth' : `${Math.round(100 * r.params.min_share)}%`} of the group remain` });
  }

  function afterCard(r) {
    const a = r.after_lead, W = r.params.window;
    const rows = a.rows;
    if (!rows.length) return card(`The ${W} minutes after you take a lead`, notice('Not enough leads with five more minutes of play on both sides.'), { level: 2 });
    const table = el('table', { class: 'data compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'In the window'), el('th', { class: 'num' }, `Converted (n=${a.n_converted})`), el('th', { class: 'num' }, `Lost (n=${a.n_lost})`), el('th', { class: 'num' }, 'Lost − converted (95%)'), el('th', { class: 'num', title: 'Probability that a random lost lead shows the higher value; 0.5 means no difference' }, 'AUC'))),
      el('tbody', {}, ['me', 'opp'].flatMap(who => [
        el('tr', { class: 'group' }, el('td', { colspan: 5 }, who === 'me' ? 'What you did' : 'What the opponent did')),
        ...rows.filter(x => x.who === who).map(x => {
          const d = decimalsFor(x.key), sig = has(x.lo) && has(x.hi) && (x.lo > 0 || x.hi < 0);
          const label = x.label.replace(/^Opponent:? /, '').replace(/^./, ch => ch.toUpperCase());
          return x.kind === 'share'
            ? el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, pct(x.converted)), el('td', { class: 'num' }, pct(x.lost)), el('td', { class: `num ${sig ? 'sig' : ''}` }, `${pts(x.diff)} `, el('span', { class: 'ci' }, `[${ptsRange(x.lo, x.hi)}]`)), el('td', { class: 'num muted' }, '—'))
            : el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, num(x.converted, d)), el('td', { class: 'num' }, num(x.lost, d)), el('td', { class: `num ${sig ? 'sig' : ''}` }, `${signed(x.diff, d)} `, el('span', { class: 'ci' }, `[${signed(x.lo, d)}, ${signed(x.hi, d)}]`)), el('td', { class: 'num' }, has(x.auc) ? x.auc.toFixed(2) : '—'));
        })])));
    const sig = rows.filter(x => has(x.lo) && (x.lo > 0 || x.hi < 0));
    const claim = el('p', { class: 'claim' }, sig.length
      ? ['Differences whose interval excludes zero: ', ...sig.map((x, i) => [i ? '; ' : '', el('strong', {}, x.label.toLowerCase()), ` (${x.kind === 'share' ? pts(x.diff) : signed(x.diff, decimalsFor(x.key))})`]), '.']
      : 'Nothing you or the opponent did in these five minutes separates the leads you converted from the leads you lost: the intervals all include zero. The split happens later, in the collapse.');
    return card(`The ${W} minutes after you take a lead`, el('div', {}, claim, el('div', { class: 'table-wrap' }, table)),
      { meta: 'medians per game over the five minutes after the lead was established, converted leads against lost leads · bootstrap intervals (600 resamples) on the difference of medians, Newcombe intervals on shares · bold where the interval excludes zero' });
  }

  function collapseCard(r) {
    const c = r.collapse;
    if (!c.n) return card('Anatomy of a lost lead', notice('No lead lost under these filters.'), { level: 2 });
    const facts = el('div', { class: 'facts' },
      el('span', {}, el('strong', {}, fmt.int(c.n)), ' leads lost'),
      el('span', {}, 'typical peak ', el('strong', {}, signed(c.median_peak)), ` at ${mm(c.median_peak_at)}`),
      el('span', {}, el('strong', {}, fmt.int(c.collapsed)), ' collapsed', has(c.median_minutes_to_gone) ? `, typically ${num(c.median_minutes_to_gone)} min from peak to gone` : ''),
      el('span', {}, el('strong', {}, fmt.int(c.held)), ' still ahead in orders at the end', has(c.median_end_when_held) ? ` (typically ${signed(c.median_end_when_held)})` : ''));
    const table = el('table', { class: 'data compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Per minute'), el('th', { class: 'num' }, '5 min before the peak'), el('th', { class: 'num' }, 'Peak → gone'), el('th', { class: 'num' }, 'Change (95%)'))),
      el('tbody', {}, c.rows.map(x => {
        const d = decimalsFor(x.key), sig = has(x.lo) && (x.lo > 0 || x.hi < 0);
        return el('tr', {}, el('td', {}, x.label), el('td', { class: 'num' }, num(x.before, d)), el('td', { class: 'num' }, num(x.after, d)), el('td', { class: `num ${sig ? 'sig' : ''}` }, `${signed(x.delta, d)} `, el('span', { class: 'ci' }, `[${signed(x.lo, d)}, ${signed(x.hi, d)}]`)));
      })));
    const shares = el('ul', { class: 'insights', style: { marginTop: '12px' } }, c.shares.map(s => el('li', {}, el('span', { class: 'mark' }, '•'), el('span', {}, `${s.label}: `, el('strong', {}, pct(s.rate)), ' ', el('span', { class: 'ci' }, `(${ci(s)}) of ${s.n}`)))));
    const held = c.held ? el('p', { class: 'muted small', style: { marginTop: '12px' } }, `${fmt.int(c.held)} of these games ended with you still ahead in orders: the replay shows the lead in production, not what happened to the army, so the official counters (kills and losses) on each game page are the place to look.`) : null;
    return card('Anatomy of a lost lead', el('div', {}, facts, el('div', { class: 'table-wrap' }, table), shares, held),
      { meta: `the ${c.n_with_window} lost leads with at least two minutes between the peak and the end · the collapse window runs from the peak until the lead was gone, at most ${r.params.cap} minutes · bootstrap intervals on the median per-game change` });
  }

  function reviewCard(r) {
    const rows = r.review;
    const columns = [
      { key: 'started_at', label: 'When', sortValue: x => new Date(x.started_at).getTime(), defaultDir: 'desc', render: x => el('span', { class: 'small', title: fmt.dateTime(x.started_at) }, fmt.date(x.started_at)) },
      { key: 'matchup', label: 'Matchup', sortable: false, render: x => el('div', { class: 'mu' }, el('div', { class: 'civs' }, civChip(x.civ, { name: 'short' }), el('span', { class: 'muted small' }, 'vs'), civChip(x.opp_civ, { name: 'short' })), x.opp_id ? el('a', { class: 'small', href: hrefTo(`/player/${x.opp_id}`) }, x.opp_name || `#${x.opp_id}`) : null) },
      { key: 'map', label: 'Map', render: x => el('strong', {}, x.map || '—') },
      { key: 'duration', label: 'Length', num: true, render: x => fmt.duration(x.duration) },
      { key: 'lead_at', label: 'Lead taken', num: true, render: x => mm(x.lead_at) },
      { key: 'peak', label: 'Peak lead', num: true, render: x => el('span', {}, el('span', { class: 'num' }, signed(x.peak)), el('span', { class: 'ci' }, ` at ${mm(x.peak_at)}`)) },
      { key: 'gone_at', label: 'Gone by', num: true, sortValue: x => x.gone_at ?? 999, render: x => x.gone_at ? mm(x.gone_at) : el('span', { class: 'muted', title: 'still ahead in orders when the game ended' }, 'never') },
      { key: 'rating_diff', label: 'Rating Δ', num: true, render: x => el('span', { class: `num ${x.rating_diff > 0 ? 'good' : x.rating_diff < 0 ? 'bad' : 'muted'}` }, fmt.signed(x.rating_diff)) },
      { key: 'kd', label: 'Kills / lost', num: true, title: 'official counters, when the companion kept them', sortValue: x => x.counters?.me?.kills ?? null, render: x => x.counters && has(x.counters.me.kills) ? el('span', { class: 'num' }, `${fmt.int(x.counters.me.kills)} / ${fmt.int(x.counters.me.units_lost)}`) : el('span', { class: 'muted' }, '—') },
      { key: 'note', label: 'What the orders show', sortable: false, render: x => el('span', { class: 'small' }, x.note) },
    ];
    return card('Games to review', rows.length
      ? dataTable({ columns, rows, sort: { key: 'peak', dir: 'desc' }, rowHref: x => hrefTo(`/game/${x.game_id}`, { p: state.p }), emptyText: 'No lead lost under these filters.' })
      : notice('No lead lost under these filters.'),
      { meta: `every lead of ${num(r.params.lead)} or more that ended in a loss, biggest first · a row opens the game summary from your side`, flush: rows.length > 0 });
  }

  function methodCard(r) {
    const p = r.params, c = r.counts, sk = c.skipped || {};
    const kinds = (p.kinds || []).map(kindName).join(' and ');
    return card('Method', el('div', { class: 'method small' },
      el('p', {}, el('strong', {}, 'Lead. '), `Resources you ordered (units, buildings, technologies) minus what the opponent ordered, cumulative to the end of each minute, read from both replays and net of cancelled orders. A lead counts once it is at least ${num(p.lead)} for two consecutive minutes; it is "taken" at the first such minute, its peak is the largest value from then on, and it is "gone" at the first later minute at or below zero.`),
      el('p', {}, el('strong', {}, 'Checkpoint conversion. '), `Your win rate when the lead at the checkpoint minute falls in a bin, among games that ran at least ${p.margin} more minutes (so the final minute of a decided game does not stand in for a lead). The mirror uses the same games from the other side: the opponent's win rate when they were ahead by that much. Game length is itself an outcome, so the split by length describes, it does not explain.`),
      el('p', {}, el('strong', {}, 'Windows. '), `The ${p.window} minutes after a lead is taken, compared between converted and lost leads; and for lost leads the minutes from the peak until the lead was gone (at most ${p.cap}), against the five minutes before the peak. Rates are per minute of the window.`),
      el('p', {}, el('strong', {}, 'Uncertainty. '), `95% Wilson score intervals on every rate, Newcombe intervals on differences of rates, percentile bootstrap intervals (${p.boot} resamples, fixed seed) on medians and on differences of medians, and the rank AUC as a scale-free effect size. Trajectory minutes with fewer than ${p.min_n} games, or fewer than ${Math.round(100 * p.min_share)}% of the group, are not drawn.`),
      el('p', {}, el('strong', {}, 'What this cannot see. '), 'Orders are not resources banked or an army alive: a unit that was built and died still counts, so a lead in orders can outlive the army, and the games that ended with you still ahead in orders are exactly the ones the replay cannot explain. Nothing here is causal; it says where the losses sit, not what to do.'),
      el('p', { class: 'muted' }, `Data: ${fmt.int(c.games)} ${kinds} games of ${r.name || nameOf(state.p)} with a stored summary of both players and per-minute series${sk.no_opponent_summary ? `; ${sk.no_opponent_summary} left out for lack of the opponent's summary` : ''}${sk.no_series ? `; ${sk.no_series} left out for lack of per-minute series` : ''}. Reproduce it in a terminal with `, el('code', {}, `py -3 tools/closing.py ${state.p} --lead ${p.lead} --at ${state.at}`), '.')));
  }

  drawFilters();
  load();
}
