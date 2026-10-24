// Shared client state with a tiny subscribe mechanism.
export const state = { session: null, user: null, profile: null, role: null, unread: 0, banned: null };
const subs = new Set();
export function setState(patch) { Object.assign(state, patch); for (const f of subs) { try { f(state); } catch { /* ignore */ } } }
export function onState(f) { subs.add(f); return () => subs.delete(f); }
