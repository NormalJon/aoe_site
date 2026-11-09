// Who "me" is. The companion's forge.local.json wins when it is running; otherwise the id the user picked with
// "This is me" on a profile page (kept in localStorage, so it also works on the static GitHub Pages copy).
import { getJSON } from './api.js';

const KEY = 'forge-me';
let companionMe = null;
let synced = null;

export function getMe() {
  if (companionMe) return String(companionMe);
  try { const v = localStorage.getItem(KEY); return v && /^\d+$/.test(v) ? v : null; } catch { return null; }
}
export function meSource() { return companionMe ? 'companion' : (getMe() ? 'local' : null); }
export function setMe(id) {
  try { if (id) localStorage.setItem(KEY, String(id)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('forge:me'));
}
/** Ask the companion once per page load for the configured profile id. Resolves to the effective "me". */
export function syncMe() {
  if (!synced) {
    synced = getJSON('local/config', { ttl: 60e3 }).then(cfg => { if (cfg?.me) { companionMe = cfg.me; document.dispatchEvent(new CustomEvent('forge:me')); } }).catch(() => { /* static host or companion down */ }).then(() => getMe());
  }
  return synced;
}
