const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

let mainWindow;
const appDataDir = path.join(app.getPath('userData'), 'data');
const historyPath = path.join(appDataDir, 'history.json');
const settingsPath = path.join(appDataDir, 'settings.json');

function ensureDataFiles() {
  fs.mkdirSync(appDataDir, { recursive: true });
  const defaultLogoPath = app.isPackaged ? path.join(process.resourcesPath, 'assets', 'logo.png') : path.join(__dirname, 'assets', 'logo.png');
  if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, JSON.stringify([], null, 2));
  if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, JSON.stringify({
    logoPath: defaultLogoPath,
    outputPath: path.join(app.getPath('desktop'), 'PrimeVideoLogo'),
    logoX: 0.74,
    logoY: 0.05,
    logoWidth: 0.22,
    opacity: 1,
    fitMode: 'cover',
    margin: 0.04
  }, null, 2));
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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-initial-state', () => ({ settings: getSettings(), history: getHistory() }));
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

ipcMain.handle('process-videos', async (event, payload) => {
  const { videos, settings } = payload;
  const outputDir = settings.outputPath;
  fs.mkdirSync(outputDir, { recursive: true });
  const history = getHistory();
  const historyMap = new Map(history.map(item => [item.hash, item]));
  const results = [];
  const logoPath = settings.logoPath;
  if (!logoPath || !fs.existsSync(logoPath)) throw new Error('Logo dosyası bulunamadı.');

  for (let i = 0; i < videos.length; i += 1) {
    const video = videos[i];
    const hash = await hashFile(video.path);
    if (historyMap.has(hash)) {
      const skipped = { name: video.name, status: 'skipped', progress: 100, message: 'Daha önce işlendi' };
      results.push(skipped);
      event.sender.send('process-progress', { index: i, total: videos.length, ...skipped });
      continue;
    }
    const base = path.parse(video.name).name;
    const outputPath = path.join(outputDir, `${safeName(base)}_logo_9x16.mp4`);
    const margin = Math.max(0, Math.min(0.2, Number(settings.margin) || 0.04));
    const logoW = Math.max(0.05, Math.min(0.8, Number(settings.logoWidth) || 0.22));
    const x = Math.max(0, Math.min(1 - logoW, Number(settings.logoX) || 0.74));
    const y = Math.max(0, Math.min(1 - 0.2, Number(settings.logoY) || 0.05));
    const filter = `[0:v]scale=iw*max(720/iw\,1280/ih):ih*max(720/iw\,1280/ih),crop=720:1280:(in_w-720)/2:(in_h-1280)/2,setsar=1[base];[1:v]format=rgba,colorchannelmixer=aa=${Math.max(0.05, Math.min(1, Number(settings.opacity) || 1))},scale=iw*${logoW}/0.22:-1[logo];[base][logo]overlay=x='(main_w-overlay_w)*${x / (1 - logoW)}':y='main_h*${y}':eval=frame[out]`;
    const args = ['-y', '-i', video.path, '-i', logoPath, '-filter_complex', filter, '-map', '[out]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath];
    const job = { name: video.name, status: 'processing', progress: 0, message: 'Hazırlanıyor' };
    event.sender.send('process-progress', { index: i, total: videos.length, ...job });
    await new Promise((resolve, reject) => {
      const proc = spawn(getFfmpegPath(), args);
      let duration = 0;
      let lastProgress = 0;
      let stderr = '';
      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
        const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
        if (d && !duration) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
        const t = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(chunk.toString());
        if (t && duration) {
          const current = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
          lastProgress = Math.min(99, Math.round((current / duration) * 100));
          event.sender.send('process-progress', { index: i, total: videos.length, name: video.name, status: 'processing', progress: lastProgress, message: 'İşleniyor' });
        }
      });
      proc.on('error', reject);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.slice(-500) || `FFmpeg hata kodu: ${code}`)));
    });
    const record = { hash, name: video.name, outputPath, processedAt: new Date().toISOString() };
    history.push(record);
    historyMap.set(hash, record);
    writeJson(historyPath, history);
    const done = { name: video.name, status: 'done', progress: 100, message: 'Tamamlandı', outputPath };
    results.push(done);
    event.sender.send('process-progress', { index: i, total: videos.length, ...done });
  }
  return results;
});
