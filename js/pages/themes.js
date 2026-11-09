// Theme lab: the design candidates side by side, each sample built from the site's own components and rendered
// with that theme's tokens (scoped .theme-… class), with a one-click switch for the whole site.
import { el, setTitle } from '../util.js';
import { card, statTile, resultPill, rankBadge, civChip, notice } from '../components.js';
import { pageHead } from './_shared.js';
import { THEMES, setTheme, currentTheme } from '../theme.js';

const SWATCHES = [['--page', 'page'], ['--surface', 'surface'], ['--surface-3', 'raised surface'], ['--ink', 'text'], ['--accent', 'accent'],
  ['--s1', 'series 1 · azure'], ['--s2', 'series 2 · gules'], ['--s3', 'series 3 · vert'], ['--s4', 'series 4 · or'], ['--s5', 'series 5 · purpure']];

export async function render(app) {
  setTitle('Theme lab');
  app.append(pageHead('Theme lab', 'Four historical directions next to today’s dark and light. Every sample is built from the site’s own components; “Use this theme” switches the whole site and remembers the choice in this browser.'));
  app.append(notice(el('strong', {}, 'What changes and what does not. '),
    'Colours, the heading typeface (a system serif: Palatino on Windows and Mac, Georgia elsewhere, so nothing is downloaded) and one small ornament per theme. Layout, charts, the body text face and the fixed win/loss colours stay as they are. In the historical themes the chart series become heraldic tinctures: azure, gules, vert, or, purpure, tenné.'));
  const grid = el('div', { class: 'theme-grid', style: { marginTop: '16px' } });
  for (const t of THEMES) grid.append(sample(t));
  app.append(grid);
  app.append(el('p', { class: 'muted small', style: { marginTop: '16px' } },
    'Possible next steps once one is chosen: a matching favicon and header mark, a web font for headings (Cinzel for carved capitals or EB Garamond for a book feel), and retiring the other candidates.'));
}

function sample(t) {
  const current = currentTheme() === t.key;
  const row = (label, a, b, bBetter) => el('tr', {}, el('td', { class: 'metric' }, label), el('td', { class: 'center' }, a), el('td', { class: `center ${bBetter ? 'better' : ''}` }, b));
  const inner = el('div', { class: `themed theme-${t.key}` },
    el('div', { class: 'sample-head' }, el('h2', {}, t.name), el('span', { class: 'muted small' }, t.scheme === 'dark' ? 'dark' : 'light'), current ? el('span', { class: 'pill neutral' }, 'in use') : null),
    el('p', { class: 'muted small', style: { margin: '2px 0 0' } }, t.blurb),
    el('div', { class: 'swatches' }, SWATCHES.map(([v, title]) => el('span', { class: 'swatch-box', title, style: { background: `var(${v})` } }))),
    el('div', { class: 'tiles', style: { marginTop: '12px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
      statTile({ label: 'Solo Ranked rating', value: '1,146', delta: 23, deltaGood: true, sub: 'last 7 days' }),
      statTile({ label: 'Win rate', value: '52.4%', sub: '163 W – 148 L' })),
    el('div', { style: { marginTop: '12px' } }, card('Timings', el('table', { class: 'data compare timings' },
      el('thead', {}, el('tr', {}, el('th', { class: 'metric' }, 'Median'), el('th', { class: 'center' }, 'You'), el('th', { class: 'center' }, 'MarineLorD'))),
      el('tbody', {}, row('Feudal landmark placed', '3:38', '2:46', true), row('Villagers by 10:00', '36', '45', true), row('Castle landmark placed', '13:04', '8:48', true))),
      { level: 3, flush: true, meta: 'medians · French' })),
    el('div', { class: 'sample-row', style: { marginTop: '12px' } }, resultPill('win'), civChip('french', { name: 'short' }), el('span', { class: 'muted small' }, 'vs'), civChip('knights_templar', { name: 'short' }),
      rankBadge('platinum_1', { sm: true }), el('span', { class: 'muted small' }, 'Dry Arabia · 17:06'), el('span', { class: 'spacer' }), el('a', { href: '#/themes', class: 'small' }, 'Summary ›')),
    el('ul', { class: 'tells', style: { marginTop: '12px', padding: 0, listStyle: 'none' } }, el('li', { class: 'strong' },
      el('div', { class: 'tell-top' }, el('span', { class: 'tell-kind' }, 'Tempo'), el('strong', {}, 'Fast Feudal · 2:46'), el('span', { class: 'tell-n num' }, '3/3')),
      el('div', { class: 'tell-bar' }, el('span', { style: { width: '100%' } })),
      el('div', { class: 'tell-text muted small' }, 'Feudal landmark placed before 3:15 in 3 of 3 games that aged up'))),
    el('div', { style: { marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
      el('button', { class: 'btn primary', type: 'button', disabled: current ? true : null, onClick: () => setTheme(t.key) }, current ? 'In use' : 'Use this theme'),
      el('span', { class: 'muted small' }, 'headings in the theme face · body text stays the system sans')));
  return el('section', { class: 'theme-sample' }, inner);
}
