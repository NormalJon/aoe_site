// Themes: the dark and light defaults plus the historical candidates from the Theme lab (#/themes).
// A theme is a token set in css/styles.css selected by html[data-theme]; the choice is kept in this browser.
export const THEMES = [
  { key: 'dark', name: 'Dark', scheme: 'dark', blurb: 'Today’s default: neutral charcoal, a brass accent, the system sans everywhere.' },
  { key: 'light', name: 'Light', scheme: 'light', blurb: 'Today’s light mode: warm white, the same brass accent.' },
  { key: 'stone', name: 'Castle stone', scheme: 'dark', blurb: 'Dark basalt surfaces, torchlight gold, serif headings with a gold hairline under each card title. Closest to the game’s own menus and the smallest change.' },
  { key: 'parchment', name: 'Parchment', scheme: 'light', blurb: 'Warm paper, iron-gall ink, a wax-seal sienna accent, ledger rules under card titles and italic serif column heads. A light theme with a scribe’s feel.' },
  { key: 'manuscript', name: 'Illuminated', scheme: 'dark', blurb: 'Ink-navy night, gold-leaf accent, an inner frame line on every card like a bordered folio, serif numerals on the tiles. The richest of the four.' },
  { key: 'atlas', name: 'Campaign atlas', scheme: 'light', blurb: 'Vellum and olive tones, a verdigris accent and a small compass mark before each card title, like a map table. The quietest light theme.' },
];
const KEY = 'forge-theme';
const byKey = Object.fromEntries(THEMES.map(t => [t.key, t]));

export function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }

/** Put a theme on <html> (no persistence). Unknown keys fall back to dark. */
export function applyTheme(key) {
  const t = byKey[key] || byKey.dark;
  if (t.key === 'dark') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t.key);
  document.documentElement.setAttribute('data-scheme', t.scheme);
  document.querySelectorAll('[data-theme-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePick === t.key)));
  return t.key;
}

/** Apply, remember, and tell the app (which re-renders the page so canvases pick up the new colours). */
export function setTheme(key) {
  const k = applyTheme(key);
  try { localStorage.setItem(KEY, k); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('forge:theme', { detail: k }));
  return k;
}

export function initTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!t) t = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return applyTheme(t);
}
