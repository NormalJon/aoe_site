// Theme: dark (Castle stone, the default) or light. The tokens live at the top of css/styles.css; the choice is kept
// in this browser. Switching dispatches `forge:theme` so the router re-renders the page and canvases pick up the colours.
const KEY = 'forge-theme';
export const THEMES = ['dark', 'light'];

export function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }

/** Put a theme on <html> (no persistence). Unknown keys fall back to dark. */
export function applyTheme(key) {
  const t = THEMES.includes(key) ? key : 'dark';
  if (t === 'dark') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  return t;
}

/** Apply, remember, and tell the app. */
export function setTheme(key) {
  const t = applyTheme(key);
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('forge:theme', { detail: t }));
  return t;
}

export function initTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!t) t = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return applyTheme(t);
}
