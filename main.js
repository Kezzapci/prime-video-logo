const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, fork, execFileSync } = require('child_process');
const https = require('https');
const { URL } = require('url');

let mainWindow;
let videoWorker = null;
let updateReady = false;
const appDataDir = path.join(app.getPath('userData'), 'data');
const historyPath = path.join(appDataDir, 'history.json');
const settingsPath = path.join(appDataDir, 'settings.json');
const logsDir = path.join(appDataDir, 'logs');
const logPath = path.join(logsDir, 'prime-video-logo.log');
const updateConfig = {
  owner: 'Kezzapci',
  repo: 'prime-video-logo',
  apiBase: 'https://api.github.com',
  releaseBase: 'https://github.com/Kezzapci/prime-video-logo/releases'
};
let availableUpdate = null;
let downloadedUpdatePath = null;

function ensureDataFiles() {
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  const defaultLogoPath = app.isPackaged ? path.join(process.resourcesPath, 'assets', 'logo.png') : path.join(__dirname, 'assets', 'logo.png');
  if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, JSON.stringify([], null, 2));
  if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, JSON.stringify({
    logoPath: defaultLogoPath,
    outputPath: defaultOutputPath(),
    logoX: 0.11,
    logoY: 0.68,
    logoWidth: 0.78,
    opacity: 1,
    fitMode: 'cover',
    margin: 0.04
  }, null, 2));
  else {
    const saved = getSettings();
    const oldDefault = path.join(app.getPath('desktop'), 'PrimeVideoLogo');
    let changed = false;
    if (saved.outputPath === oldDefault) { saved.outputPath = path.join(app.getPath('desktop'), 'Edilmiş Videolar'); changed = true; }
    if (saved.logoX === 0.74 && saved.logoY === 0.05 && saved.logoWidth === 0.22) { saved.logoX = 0.11; saved.logoY = 0.68; saved.logoWidth = 0.78; changed = true; }
    if (changed) writeJson(settingsPath, saved);
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
function defaultOutputPath() { return path.join(app.getPath('desktop'), 'Edilmiş Videolar'); }
function normalizeOutputPath(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (!value || value === 'Masaüstü\\Edilmiş Videolar' || value === 'Desktop\\Edilmiş Videolar') return defaultOutputPath();
  return path.resolve(value);
}
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
  settings.outputPath = normalizeOutputPath(settings.outputPath);
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

function compareVersions(left, right) {
  const parse = value => String(value || '0').replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function requestText(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Güncelleme yönlendirmesi çok uzun.'));
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:') return reject(new Error('Güvenli olmayan güncelleme adresi.'));
    const request = https.get(parsed, {
      headers: {
        'User-Agent': 'PrimeVideoLogo-Updater/1.4',
        Accept: 'application/vnd.github+json'
      }
    }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        return requestText(new URL(response.headers.location, parsed).toString(), redirects + 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error(`Güncelleme sunucusu HTTP ${status}`));
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) { request.destroy(); reject(new Error('Güncelleme bilgisi beklenenden büyük.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(20000, () => request.destroy(new Error('Güncelleme bağlantısı zaman aşımına uğradı.')));
    request.on('error', reject);
  });
}

function requestJson(target) {
  return requestText(target).then(text => JSON.parse(text));
}

function downloadFile(target, destination, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Güncelleme indirme yönlendirmesi çok uzun.'));
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:') return reject(new Error('Güvenli olmayan indirme adresi.'));
    const request = https.get(parsed, { headers: { 'User-Agent': 'PrimeVideoLogo-Updater/1.4' } }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        return downloadFile(new URL(response.headers.location, parsed).toString(), destination, onProgress, redirects + 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error(`Güncelleme indirme sunucusu HTTP ${status}`));
      }
      const total = Number(response.headers['content-length'] || 0);
      let received = 0; let failed = false;
      const output = fs.createWriteStream(destination);
      const fail = error => {
        if (failed) return;
        failed = true;
        output.destroy();
        request.destroy();
        try { fs.unlinkSync(destination); } catch { /* geçici dosya olmayabilir */ }
        reject(error);
      };
      response.on('data', chunk => {
        received += chunk.length;
        if (received > 2 * 1024 * 1024 * 1024) return fail(new Error('Güncelleme paketi güvenli boyut sınırını aşıyor.'));
        if (typeof onProgress === 'function') onProgress(received, total);
      });
      response.on('aborted', () => fail(new Error('Güncelleme indirmesi yarıda kesildi.')));
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => { if (!failed) output.close(() => resolve({ received, total })); });
      response.pipe(output);
    });
    request.setTimeout(120000, () => request.destroy(new Error('Güncelleme indirmesi zaman aşımına uğradı.')));
    request.on('error', reject);
  });
}

function parseLatestYml(text) {
  const value = key => {
    const match = new RegExp(`^\\s*${key}:\\s*[\\\"']?([^\\\"'\\r\\n]+)`, 'mi').exec(text);
    return match ? match[1].trim() : '';
  };
  return { version: value('version'), path: value('path'), sha512: value('sha512'), size: Number(value('size')) || 0 };
}

async function loadLatestRelease() {
  const repoPath = `${updateConfig.owner}/${updateConfig.repo}`;
  let release = null;
  try { release = await requestJson(`${updateConfig.apiBase}/repos/${repoPath}/releases/latest`); } catch (apiError) {
    logEvent('warn', 'GitHub API okunamadı; latest.yml yedeği deneniyor', { error: String(apiError?.message || apiError) });
    const yml = parseLatestYml(await requestText(`${updateConfig.releaseBase}/latest/download/latest.yml`));
    if (!yml.version || !yml.path) throw apiError;
    return { ...yml, fileName: yml.path, url: `${updateConfig.releaseBase}/latest/download/${encodeURIComponent(yml.path)}` };
  }
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const setupAsset = assets.find(asset => /^PrimeVideoLogo-Setup-.*\\.exe$/i.test(asset.name));
  const ymlAsset = assets.find(asset => asset.name.toLowerCase() === 'latest.yml');
  let yml = {};
  if (ymlAsset?.browser_download_url) {
    try { yml = parseLatestYml(await requestText(ymlAsset.browser_download_url)); } catch (error) { logEvent('warn', 'latest.yml okunamadı; Release metadata kullanılacak', { error: String(error?.message || error) }); }
  }
  const version = String(release.tag_name || yml.version || '').replace(/^v/i, '');
  const fileName = setupAsset?.name || yml.path;
  if (!version || !fileName) throw new Error('GitHub Release içinde geçerli Windows setup bulunamadı.');
  return {
    version,
    fileName,
    url: setupAsset?.browser_download_url || `${updateConfig.releaseBase}/download/v${version}/${encodeURIComponent(fileName)}`,
    sha512: yml.sha512 || '',
    size: Number(setupAsset?.size || yml.size || 0)
  };
}

async function checkForUpdatesGithub({ silent = false } = {}) {
  if (!silent) sendUpdateStatus('checking');
  try {
    const info = await loadLatestRelease();
    if (compareVersions(info.version, app.getVersion()) > 0) {
      availableUpdate = info;
      sendUpdateStatus('available', { version: info.version, size: info.size, source: 'github' });
      return { status: 'available', version: info.version, size: info.size };
    }
    availableUpdate = null;
    if (!silent) sendUpdateStatus('not-available', { version: app.getVersion() });
    return { status: 'not-available', version: app.getVersion() };
  } catch (error) {
    logEvent('warn', 'GitHub güncelleme kontrolü başarısız', { error: String(error?.message || error) });
    if (!silent) sendUpdateStatus('error', { message: friendlyError(error, 'Güncelleme kontrolü başarısız.') });
    return { status: 'error', message: friendlyError(error, 'Güncelleme kontrolü başarısız.') };
  }
}

function hashFileAs(filePath, algorithm = 'sha256', encoding = 'hex') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest(encoding)));
  });
}

function assertWindowsInstaller(filePath) {
  const header = Buffer.alloc(2); const descriptor = fs.openSync(filePath, 'r');
  try { fs.readSync(descriptor, header, 0, 2, 0); } finally { fs.closeSync(descriptor); }
  if (header.toString('ascii') !== 'MZ') throw new Error('İndirilen güncelleme geçerli bir Windows paketi değil.');
}

function setupAutoUpdater() {
  if (app.isPackaged) setTimeout(() => checkForUpdatesGithub({ silent: true }), 5000);
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
ipcMain.handle('window-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); return true; });
ipcMain.handle('window-toggle-maximize', () => { if (!mainWindow || mainWindow.isDestroyed()) return false; if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); return mainWindow.isMaximized(); });
ipcMain.handle('window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); return true; });
ipcMain.handle('get-health', () => runHealthCheck());
ipcMain.handle('repair-system', () => repairSystem());
ipcMain.handle('open-logs', () => shell.openPath(logPath));
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev', version: app.getVersion() };
  return checkForUpdatesGithub();
});
ipcMain.handle('download-update', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  try {
    if (!availableUpdate) {
      const checked = await checkForUpdatesGithub();
      if (checked.status !== 'available') return checked;
    }
    const info = availableUpdate;
    const updateDir = path.join(app.getPath('temp'), 'PrimeVideoLogo', 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    const destination = path.join(updateDir, safeName(info.fileName));
    try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch { /* eski geçici dosya kilitli olabilir */ }
    sendUpdateStatus('downloading', { percent: 0, total: info.size || 0, transferred: 0 });
    await downloadFile(info.url, destination, (received, total) => {
      const effectiveTotal = total || info.size || 0;
      sendUpdateStatus('downloading', { percent: effectiveTotal ? Math.min(99, Math.round((received / effectiveTotal) * 100)) : 0, total: effectiveTotal, transferred: received });
    });
    assertWindowsInstaller(destination);
    if (info.sha512) {
      const actual = await hashFileAs(destination, 'sha512', 'base64');
      if (actual !== info.sha512) throw new Error('Güncelleme checksum doğrulaması başarısız.');
    }
    downloadedUpdatePath = destination;
    updateReady = true;
    sendUpdateStatus('downloaded', { version: info.version });
    return { status: 'downloaded', version: info.version };
  } catch (error) {
    downloadedUpdatePath = null;
    const message = friendlyError(error, 'Güncelleme indirilemedi veya doğrulanamadı.');
    logEvent('warn', 'Güncelleme indirme/doğrulama başarısız', { error: String(error?.message || error) });
    sendUpdateStatus('error', { message });
    return { status: 'error', message };
  }
});
ipcMain.handle('install-update', () => {
  if (!updateReady || !downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) return { status: 'not-ready' };
  if (process.platform !== 'win32') return { status: 'error', message: 'Otomatik kurulum yalnızca Windows paketinde kullanılabilir.' };
  try {
    const installer = spawn(downloadedUpdatePath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
    installer.unref();
    setTimeout(() => app.quit(), 450);
    return { status: 'installing' };
  } catch (error) {
    const message = friendlyError(error, 'Güncelleme kurulumu başlatılamadı.');
    logEvent('warn', 'Güncelleme kurulumu başarısız', { error: String(error?.message || error) });
    sendUpdateStatus('error', { message });
    return { status: 'error', message };
  }
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
ipcMain.handle('save-settings', (_event, settings = {}) => {
  const normalized = { ...settings, outputPath: normalizeOutputPath(settings.outputPath) };
  writeJson(settingsPath, normalized);
  return normalized;
});
ipcMain.handle('open-output', async (_event, folderPath) => {
  const target = normalizeOutputPath(folderPath);
  fs.mkdirSync(target, { recursive: true });
  return shell.openPath(target);
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
  const outputDir = normalizeOutputPath(settings?.outputPath);
  const jobSettings = { ...settings, outputPath: outputDir };
  const logoPath = jobSettings.logoPath;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.accessSync(outputDir, fs.constants.W_OK);
  } catch (error) {
    logEvent('error', 'Çıktı klasörü hazırlanamadı', { outputDir, error: String(error?.message || error) });
    throw new Error(`Çıktı klasörüne yazılamıyor: ${outputDir}`);
  }
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
    videoWorker.send({ type: 'process-batch', payload: { videos, settings: jobSettings, historyHashes: [...historyMap.keys()], ffmpegPath: getFfmpegPath(), outputDir } });
  });
});
