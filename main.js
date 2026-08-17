const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, fork, execFileSync } = require('child_process');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let videoWorker = null;
let updateReady = false;
const appDataDir = path.join(app.getPath('userData'), 'data');
const historyPath = path.join(appDataDir, 'history.json');
const settingsPath = path.join(appDataDir, 'settings.json');
const logsDir = path.join(appDataDir, 'logs');
const logPath = path.join(logsDir, 'prime-video-logo.log');

function ensureDataFiles() {
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  const defaultLogoPath = app.isPackaged ? path.join(process.resourcesPath, 'assets', 'logo.png') : path.join(__dirname, 'assets', 'logo.png');
  if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, JSON.stringify([], null, 2));
  if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, JSON.stringify({
    logoPath: defaultLogoPath,
    outputPath: path.join(app.getPath('desktop'), 'Edilmiş Videolar'),
    logoX: 0.74,
    logoY: 0.05,
    logoWidth: 0.22,
    opacity: 1,
    fitMode: 'cover',
    margin: 0.04
  }, null, 2));
  else {
    const saved = getSettings();
    const oldDefault = path.join(app.getPath('desktop'), 'PrimeVideoLogo');
    if (saved.outputPath === oldDefault) { saved.outputPath = path.join(app.getPath('desktop'), 'Edilmiş Videolar'); writeJson(settingsPath, saved); }
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function getSettings() { return readJson(settingsPath, {}); }
function getHistory() { return readJson(historyPath, []); }
function getFfmpegPath() {
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = path.join(process.resourcesPath, 'ffmpeg', binary);
  return fs.existsSync(bundled) ? bundled : binary;
}
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function safeName(name) { return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'); }
function isVideo(file) { return /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(file); }

function logEvent(level, message, details = {}) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), level, message, details });
    fs.appendFileSync(logPath, `${line}\n`);
  } catch { /* log yazılamazsa uygulama durmamalı */ }
}
function friendlyError(error, fallback = 'İşlem tamamlanamadı.') {
  const raw = String(error?.message || error || '');
  const lower = raw.toLowerCase();
  if (!raw || lower.includes('latest.yml') || lower.includes('404') || lower.includes('repository not found') || lower.includes('github')) return 'Güncelleme sunucusuna şu an ulaşılamadı. Birkaç dakika sonra tekrar dene.';
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) return 'Güncelleme kaynağı erişim izni istiyor. Release ayarlarını kontrol et.';
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('econn') || lower.includes('dns')) return 'İnternet bağlantısı kontrol edilemedi. Bağlantını kontrol edip tekrar dene.';
  if (lower.includes('ffmpeg')) return 'Video motoru çalışmadı. Sistem onarımı ile tekrar denenecek.';
  if (lower.includes('permission') || lower.includes('access is denied')) return 'Dosya erişim izni reddedildi. Çıktı klasörü izinlerini kontrol et.';
  return fallback;
}
function sendUpdateStatus(type, data = {}) {
  if (type === 'error') data = { ...data, message: friendlyError(data.message, 'Güncelleme kontrolü başarısız.') };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', { type, ...data });
}
function sendHealthStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('health-status', data);
}
function runHealthCheck() {
  ensureDataFiles();
  const settings = getSettings();
  const defaultLogoPath = app.isPackaged ? path.join(process.resourcesPath, 'assets', 'logo.png') : path.join(__dirname, 'assets', 'logo.png');
  const ffmpegPath = getFfmpegPath();
  let ffmpegReady = false;
  try { execFileSync(ffmpegPath, ['-version'], { stdio: 'ignore', windowsHide: true }); ffmpegReady = true; } catch { ffmpegReady = false; }
  const checks = [
    { id: 'data', label: 'Uygulama verileri', ok: fs.existsSync(appDataDir) && fs.existsSync(settingsPath) && fs.existsSync(historyPath), detail: 'Ayarlar ve işlem geçmişi erişilebilir.' },
    { id: 'logo', label: 'Logo dosyası', ok: !!settings.logoPath && fs.existsSync(settings.logoPath), detail: fs.existsSync(settings.logoPath || '') ? 'Seçili logo hazır.' : 'Varsayılan logo kullanılabilir.' },
    { id: 'output', label: 'Çıktı klasörü', ok: !!settings.outputPath, detail: settings.outputPath || 'Masaüstü\\Edilmiş Videolar' },
    { id: 'worker', label: 'Video motoru', ok: fs.existsSync(app.isPackaged ? path.join(process.resourcesPath, 'video-worker.js') : path.join(__dirname, 'video-worker.js')), detail: 'Arka plan worker hazır.' },
    { id: 'ffmpeg', label: 'FFmpeg', ok: ffmpegReady, detail: ffmpegReady ? 'Video motoru hazır.' : 'FFmpeg bulunamadı.' }
  ];
  const failed = checks.filter(item => !item.ok);
  return { ok: failed.length === 0, checks, failed: failed.length, summary: failed.length ? `${failed.length} sorun bulundu; otomatik onarım öneriliyor.` : 'Sistem sağlıklı ve çalışmaya hazır.' };
}
function repairSystem() {
  ensureDataFiles();
  const settings = getSettings();
  const defaultLogoPath = app.isPackaged ? path.join(process.resourcesPath, 'assets', 'logo.png') : path.join(__dirname, 'assets', 'logo.png');
  if (!settings.outputPath) settings.outputPath = path.join(app.getPath('desktop'), 'Edilmiş Videolar');
  if (!settings.logoPath || !fs.existsSync(settings.logoPath)) settings.logoPath = defaultLogoPath;
  fs.mkdirSync(settings.outputPath, { recursive: true });
  writeJson(settingsPath, settings);
  const previewDir = path.join(appDataDir, 'previews');
  if (fs.existsSync(previewDir)) for (const file of fs.readdirSync(previewDir)) {
    const full = path.join(previewDir, file);
    try { if (Date.now() - fs.statSync(full).mtimeMs > 86400000) fs.unlinkSync(full); } catch { /* bozuk ön izleme temizlenebilir */ }
  }
  const result = runHealthCheck();
  logEvent(result.ok ? 'info' : 'warn', 'Sistem onarımı tamamlandı', { failed: result.failed });
  sendHealthStatus(result);
  return result;
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', info => sendUpdateStatus('not-available', { version: info.version || app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus('downloading', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }));
  autoUpdater.on('update-downloaded', info => { updateReady = true; sendUpdateStatus('downloaded', { version: info.version }); });
  autoUpdater.on('error', error => { logEvent('warn', 'Otomatik güncelleme kontrolü başarısız', { error: String(error?.message || error) }); sendUpdateStatus('error', { message: error?.message || 'Güncelleme kontrolü başarısız.' }); });
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(error => logEvent('warn', 'Başlangıç güncelleme kontrolü başarısız', { error: String(error?.message || error) })), 5000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#06101a',
    title: 'Prime Video Logo',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  ensureDataFiles();
  createWindow();
  setupAutoUpdater();
  setTimeout(() => sendHealthStatus(runHealthCheck()), 700);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { if (videoWorker) { videoWorker.kill(); videoWorker = null; } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', error => { logEvent('error', 'Beklenmeyen uygulama hatası', { error: String(error?.stack || error) }); sendHealthStatus({ ok: false, failed: 1, summary: 'Uygulama kendini toparlamaya çalışıyor.', checks: [{ id: 'runtime', label: 'Uygulama çalışma durumu', ok: false, detail: 'Hata kaydedildi; sistemi onar düğmesi kullanılabilir.' }] }); });
process.on('unhandledRejection', error => logEvent('error', 'Beklenmeyen asenkron hata', { error: String(error?.stack || error) }));

ipcMain.on('renderer-error', (_event, payload = {}) => logEvent('error', 'Renderer hatası', { message: String(payload.message || 'Bilinmeyen arayüz hatası'), stack: String(payload.stack || '') }));
ipcMain.handle('get-initial-state', () => ({ settings: getSettings(), history: getHistory(), version: app.getVersion(), health: runHealthCheck() }));
ipcMain.handle('get-health', () => runHealthCheck());
ipcMain.handle('repair-system', () => repairSystem());
ipcMain.handle('open-logs', () => shell.openPath(logPath));
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev', version: app.getVersion() };
  try { await autoUpdater.checkForUpdates(); return { status: 'checking', version: app.getVersion() }; }
  catch (error) { const message = friendlyError(error, 'Güncelleme kontrolü başarısız.'); logEvent('warn', 'Manuel güncelleme kontrolü başarısız', { error: String(error?.message || error) }); sendUpdateStatus('error', { message }); return { status: 'error', message }; }
});
ipcMain.handle('download-update', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  try { await autoUpdater.downloadUpdate(); return { status: 'downloading' }; }
  catch (error) { const message = friendlyError(error, 'Güncelleme indirilemedi.'); logEvent('warn', 'Güncelleme indirme başarısız', { error: String(error?.message || error) }); sendUpdateStatus('error', { message }); return { status: 'error', message }; }
});
ipcMain.handle('install-update', () => {
  if (!updateReady) return { status: 'not-ready' };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { status: 'installing' };
});
ipcMain.handle('choose-folder', async (_event, kind) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: kind === 'input' ? 'Video klasörü seç' : 'Çıktı klasörü seç' });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('choose-logo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Logo', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('scan-folder', async (_event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath).filter(isVideo).map(name => ({ name, path: path.join(folderPath, name) }));
});
ipcMain.handle('save-settings', (_event, settings) => {
  writeJson(settingsPath, settings);
  return settings;
});
ipcMain.handle('open-output', (_event, folderPath) => {
  if (folderPath) { fs.mkdirSync(folderPath, { recursive: true }); shell.openPath(folderPath); }
});
ipcMain.handle('open-release-page', () => {
  const configPath = path.join(__dirname, 'update-config.json');
  const config = readJson(configPath, { releasePage: 'https://github.com/Kezzapci/prime-video-logo/releases' });
  return shell.openExternal(config.releasePage);
});
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('clear-history', () => { writeJson(historyPath, []); return []; });
ipcMain.handle('preview-frame', async (_event, videoPath) => {
  return new Promise((resolve) => {
    const tempDir = path.join(appDataDir, 'previews');
    fs.mkdirSync(tempDir, { recursive: true });
    const output = path.join(tempDir, `preview-${Date.now()}.jpg`);
    const ffmpeg = spawn(getFfmpegPath(), ['-y', '-ss', '00:00:01', '-i', videoPath, '-frames:v', '1', '-q:v', '3', output]);
    ffmpeg.on('close', code => resolve(code === 0 && fs.existsSync(output) ? output : null));
    ffmpeg.on('error', () => resolve(null));
  });
});

ipcMain.handle('stop-processing', () => {
  if (videoWorker) videoWorker.send({ type: 'stop' });
  return true;
});
ipcMain.handle('process-videos', async (event, payload) => {
  const { videos, settings } = payload;
  const outputDir = settings.outputPath || path.join(app.getPath('desktop'), 'Edilmiş Videolar');
  const logoPath = settings.logoPath;
  if (!logoPath || !fs.existsSync(logoPath)) { logEvent('warn', 'Logo dosyası bulunamadı', { logoPath }); throw new Error('Logo dosyası bulunamadı.'); }
  if (videoWorker) throw new Error('Başka bir işlem zaten devam ediyor.');
  const history = getHistory();
  const historyMap = new Map(history.map(item => [item.hash, item]));
  const workerPath = app.isPackaged ? path.join(process.resourcesPath, 'video-worker.js') : path.join(__dirname, 'video-worker.js');
  return new Promise((resolve, reject) => {
    videoWorker = fork(workerPath, [], { windowsHide: true });
    const cleanup = () => { if (videoWorker) { videoWorker.removeAllListeners(); videoWorker = null; } };
    videoWorker.on('message', message => {
      if (message.type === 'progress') event.sender.send('process-progress', message);
      if (message.type === 'record') { history.push(message.record); historyMap.set(message.record.hash, message.record); writeJson(historyPath, history); }
      if (message.type === 'finished' || message.type === 'stopped') { cleanup(); resolve(message.results || []); }
      if (message.type === 'fatal-error') { logEvent('error', 'Video worker beklenmeyen hata verdi', { error: message.message }); cleanup(); reject(new Error(message.message)); }
    });
    videoWorker.on('error', error => { cleanup(); reject(error); });
    videoWorker.send({ type: 'process-batch', payload: { videos, settings, historyHashes: [...historyMap.keys()], ffmpegPath: getFfmpegPath(), outputDir } });
  });
});
