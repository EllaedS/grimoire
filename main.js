'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

app.setName('Grimoire');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const WEB = path.join(__dirname, 'web');
const SEED = path.join(__dirname, 'seed');
let DATA, STORE, BLOBS, SETTINGS;
const SEALED = 'C:\\Claude\\MTG\\sealed-prices.json';

function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return fb; } }
function writeAtomic(f, txt) { const tmp = f + '.tmp'; fs.writeFileSync(tmp, txt, 'utf8'); fs.renameSync(tmp, f); }

function initData() {
  DATA = app.getPath('userData');
  STORE = path.join(DATA, 'grimoire-data.json');
  BLOBS = path.join(DATA, 'blobs');
  SETTINGS = path.join(DATA, 'settings.json');
  fs.mkdirSync(BLOBS, { recursive: true });
  // Optional seed (not shipped in the public repo): used only when no local data exists yet.
  if (!fs.existsSync(STORE) && fs.existsSync(path.join(SEED, 'store.json'))) {
    fs.copyFileSync(path.join(SEED, 'store.json'), STORE);
    for (const f of fs.readdirSync(path.join(SEED, 'blobs'))) {
      const dst = path.join(BLOBS, f);
      if (!fs.existsSync(dst)) fs.copyFileSync(path.join(SEED, 'blobs', f), dst);
    }
  }
  // one backup per launch
  try { fs.copyFileSync(STORE, STORE.replace(/\.json$/, '.bak.json')); } catch {}
}

function num(x) { const n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }
function mergeSealed(store) {
  const raw = readJson(SEALED, null);
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  const items = list.map(x => ({ edition: x.edition || '', set_code: x.set_code || '', product_type: x.product_type || '', product_label: x.product_label || '',
    total_cards: x.total_cards ?? null, price: num(x.price), price_per_card: num(x.price_per_card), store: x.store || '', url: x.url || '', in_stock: x.in_stock !== false, fetched_at: x.fetched_at || '' }));
  if (!items.length) return;
  const fetchedAt = items.map(x => x.fetched_at).filter(Boolean).sort().pop() || '';
  const cur = store.docs['app/offres'];
  if (!cur || (fetchedAt && fetchedAt > (cur.fetchedAt || ''))) {
    store.docs['app/offres'] = { items, fetchedAt, importedAt: new Date().toISOString(), file: SEALED };
  }
}

ipcMain.on('load-store', e => {
  const store = readJson(STORE, { version: 1, docs: {} });
  if (!store.docs) store.docs = {};
  try { mergeSealed(store); } catch {}
  e.returnValue = store;
});
ipcMain.on('save-store', (e, txt) => { try { writeAtomic(STORE, txt); } catch (err) { console.error(err); } });
ipcMain.on('save-blob', (e, id, txt) => {
  try { if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('bad id'); fs.writeFileSync(path.join(BLOBS, id), txt, 'utf8'); e.returnValue = { ok: true, size: Buffer.byteLength(txt) }; }
  catch (err) { e.returnValue = { ok: false, error: String(err.message || err) }; }
});
let lastFetch = 0;
ipcMain.handle('fetch-json', async (e, url, opts = {}) => {
  if (!/^https:\/\/api\.scryfall\.com\//.test(url)) throw new Error('URL non autorisée');
  const wait = 110 - (Date.now() - lastFetch); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetch = Date.now();
  const res = await net.fetch(url, { method: opts.method || 'GET', body: opts.body, headers: { 'User-Agent': 'Grimoire/1.0 (deck tool)', 'Accept': 'application/json', 'Content-Type': 'application/json' } });
  const body = await res.json();
  if (!res.ok && res.status !== 404) throw new Error('Scryfall ' + res.status + ' ' + (body.details || ''));
  return body;
});

// ---- auto-update from GitHub Releases (EllaedS/grimoire) ----
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch {}
ipcMain.on('app-version', e => { e.returnValue = app.getVersion(); });
ipcMain.on('install-update', () => { if (autoUpdater) autoUpdater.quitAndInstall(false, true); });
function setupUpdates(win) {
  if (!autoUpdater || !app.isPackaged) return;
  const send = d => { try { if (!win.isDestroyed()) win.webContents.send('update', d); } catch {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let last = -10;
  autoUpdater.on('update-available', i => { last = -10; send({ state: 'downloading', version: i.version, percent: 0 }); });
  autoUpdater.on('download-progress', p => { const pc = Math.floor(p.percent); if (pc - last >= 5) { last = pc; send({ state: 'downloading', percent: pc }); } });
  autoUpdater.on('update-downloaded', i => send({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => console.error('update error', e && e.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 3600 * 1000);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css' };
function serve(req) {
  const u = new URL(req.url);
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/_blob/')) {
    const id = p.slice(7);
    const f = path.join(BLOBS, id);
    if (!/^[0-9a-f]{32}$/.test(id) || !fs.existsSync(f)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  }
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const f = path.normalize(path.join(WEB, rel));
  if (!f.startsWith(WEB) || !fs.existsSync(f)) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(f), { headers: { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' } });
}

function createWindow() {
  const settings = readJson(SETTINGS, {});
  const win = new BrowserWindow({
    width: settings.width || 1440, height: settings.height || 940, title: 'Grimoire', autoHideMenuBar: true, backgroundColor: '#111317',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false, spellcheck: false }
  });
  win.setMenuBarVisibility(false);
  const wc = win.webContents;
  const saveSettings = () => { try { const [w, h] = win.getSize(); writeAtomic(SETTINGS, JSON.stringify({ ...readJson(SETTINGS, {}), width: w, height: h, zoom: wc.getZoomLevel() })); } catch {} };
  let updatesStarted = false;
  wc.on('did-finish-load', () => {
    if (typeof settings.zoom === 'number') wc.setZoomLevel(settings.zoom);
    if (!updatesStarted) { updatesStarted = true; setupUpdates(win); }
  });
  const zoom = d => { wc.setZoomLevel(d === 0 ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + d * 0.5))); saveSettings(); };
  wc.on('zoom-changed', (e, dir) => zoom(dir === 'in' ? 1 : -1));
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.control && (i.key === '=' || i.key === '+')) { zoom(1); e.preventDefault(); }
    else if (i.control && i.key === '-') { zoom(-1); e.preventDefault(); }
    else if (i.control && i.key === '0') { zoom(0); e.preventDefault(); }
    else if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')) { wc.reload(); e.preventDefault(); }
    else if (i.key === 'F12') { wc.toggleDevTools(); e.preventDefault(); }
  });
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.on('close', saveSettings);
  win.loadURL('app://grimoire/index.html');
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    initData();
    protocol.handle('app', serve);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
