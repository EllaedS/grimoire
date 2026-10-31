'use strict';
// Local stand-in for the claude.ai runtime: the page talks to window.claude.use("db"|"assets"|"user")
// exactly as it does online; documents live in %APPDATA%\Grimoire\grimoire-data.json.
const { ipcRenderer } = require('electron');

const store = ipcRenderer.sendSync('load-store');
let saveTimer = null;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => ipcRenderer.send('save-store', JSON.stringify(store)), 250); }
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); ipcRenderer.send('save-store', JSON.stringify(store)); });

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) { const o = { ...a }; for (const k of Object.keys(b)) { const v = b[k]; if (isObj(v) && v.__delete__) delete o[k]; else if (isObj(v) && isObj(o[k])) o[k] = merge(o[k], v); else o[k] = clone(v); } return o; }
const meta = { fromCache: false, hasPendingWrites: false };
function snapDoc(p) { const v = store.docs[p]; return { id: p.split('/').pop(), exists: !!v, data: () => clone(v), metadata: meta }; }
function snapCol(p) {
  const pre = p + '/';
  const docs = Object.keys(store.docs).filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).sort().map(snapDoc);
  return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
}
const listeners = new Set();
function notify(p) {
  const col = p.slice(0, p.lastIndexOf('/'));
  for (const l of listeners) {
    if (l.type === 'doc' && l.path === p) setTimeout(() => l.fn(snapDoc(p)));
    if (l.type === 'col' && l.path === col) setTimeout(() => l.fn(snapCol(col)));
  }
}
function docRef(p) {
  return {
    id: p.split('/').pop(), path: p,
    get: async () => snapDoc(p),
    set: async d => { store.docs[p] = clone(d); persist(); notify(p); },
    update: async d => { if (!store.docs[p]) throw { code: 'invalid_argument', message: 'Document absent' }; store.docs[p] = merge(store.docs[p], d); persist(); notify(p); },
    delete: async () => { delete store.docs[p]; persist(); notify(p); },
    onSnapshot: fn => { const l = { type: 'doc', path: p, fn }; listeners.add(l); setTimeout(() => fn(snapDoc(p))); return () => listeners.delete(l); },
    collection: c => colRef(p + '/' + c)
  };
}
function colRef(p) {
  return {
    path: p,
    doc: id => docRef(p + '/' + (id || Math.random().toString(36).slice(2, 12))),
    add: async d => { const r = docRef(p + '/' + Math.random().toString(36).slice(2, 12)); await r.set(d); return r; },
    get: async () => snapCol(p),
    onSnapshot: fn => { const l = { type: 'col', path: p, fn }; listeners.add(l); setTimeout(() => fn(snapCol(p))); return () => listeners.delete(l); }
  };
}
const db = { doc: docRef, collection: colRef };
const assets = {
  async upload(blob, opts = {}) {
    const txt = await blob.text();
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    const r = ipcRenderer.sendSync('save-blob', id, txt);
    if (!r.ok) throw { code: 'store_unavailable', message: r.error };
    return { id, url: '/_blob/' + id, sizeBytes: r.size, contentType: opts.type || blob.type || 'text/plain' };
  },
  async list() { return { assets: [], usage: {} }; },
  async delete() { return { deleted: false }; }
};
const user = { isOwner: () => true, canEdit: () => true, can: () => true, id: async () => 'local', me: async () => ({ id: 'local', name: 'Fred' }) };
const caps = { db, assets, user };

window.claude = { use: async name => caps[name] || null };
window.grimoireLocal = {
  fetchJson: (url, opts) => ipcRenderer.invoke('fetch-json', url, opts),
  version: ipcRenderer.sendSync('app-version'),
  installUpdate: () => ipcRenderer.send('install-update')
};
ipcRenderer.on('update', (e, d) => window.dispatchEvent(new CustomEvent('grimoire-update', { detail: d })));
