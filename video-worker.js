const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let currentProcess = null;
let stopRequested = false;

function send(message) {
  if (process.connected) process.send(message);
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

function safeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function sendProgress(index, total, data) {
  send({ type: 'progress', index, total, ...data });
}

async function processOne(index, total, video, settings, historyHashes, ffmpegPath, outputDir) {
  if (stopRequested) return { stopped: true };
  const hash = await hashFile(video.path);
  if (historyHashes.has(hash)) {
    const skipped = { name: video.name, status: 'skipped', progress: 100, message: 'Daha önce işlendi' };
    sendProgress(index, total, skipped);
    return skipped;
  }

  const outputPath = path.join(outputDir, `${safeName(path.parse(video.name).name)}_logo_9x16.mp4`);
  const logoW = Math.max(0.05, Math.min(0.8, Number(settings.logoWidth) || 0.22));
  const x = Math.max(0, Math.min(1 - logoW, Number(settings.logoX) || 0.74));
  const y = Math.max(0, Math.min(0.8, Number(settings.logoY) || 0.05));
  const opacity = Math.max(0.05, Math.min(1, Number(settings.opacity) || 1));
  const logoWidthPx = Math.max(2, Math.round(720 * logoW / 2) * 2);
  const logoXPx = Math.max(0, Math.round(720 * x));
  const logoYPx = Math.max(0, Math.round(1280 * y));
  const filter = `[0:v]scale=iw*max(720/iw\\,1280/ih):ih*max(720/iw\\,1280/ih),crop=720:1280:(in_w-720)/2:(in_h-1280)/2,setsar=1[base];[1:v]format=rgba,colorchannelmixer=aa=${opacity},scale=w=${logoWidthPx}:h=-1[logo];[base][logo]overlay=x=${logoXPx}:y=${logoYPx}:eval=frame[out]`;
  const args = ['-y', '-hide_banner', '-i', video.path, '-i', settings.logoPath, '-filter_complex', filter, '-map', '[out]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '0', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath];
  const job = { name: video.name, status: 'processing', progress: 0, message: 'Hazırlanıyor' };
  sendProgress(index, total, job);

  await new Promise((resolve, reject) => {
    currentProcess = spawn(ffmpegPath, args, { windowsHide: true });
    let duration = 0;
    let stderrTail = '';
    currentProcess.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderrTail = `${stderrTail}${text}`.slice(-4000);
      const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderrTail);
      if (d && !duration) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
      const t = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
      if (t && duration) {
        const current = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        sendProgress(index, total, { name: video.name, status: 'processing', progress: Math.min(99, Math.round((current / duration) * 100)), message: 'İşleniyor' });
      }
    });
    currentProcess.on('error', reject);
    currentProcess.on('close', code => {
      currentProcess = null;
      if (stopRequested) return resolve({ stopped: true });
      if (code === 0 && fs.existsSync(outputPath)) return resolve();
      reject(new Error(stderrTail.slice(-700) || `FFmpeg hata kodu: ${code}`));
    });
  });

  if (stopRequested) return { stopped: true };
  const record = { hash, name: video.name, outputPath, processedAt: new Date().toISOString() };
  historyHashes.add(hash);
  send({ type: 'record', record });
  const done = { name: video.name, status: 'done', progress: 100, message: 'Tamamlandı', outputPath };
  sendProgress(index, total, done);
  return done;
}

async function processBatch(payload) {
  const { videos, settings, historyHashes: hashes, ffmpegPath, outputDir } = payload;
  fs.mkdirSync(outputDir, { recursive: true });
  const historyHashes = new Set(hashes || []);
  const results = [];
  for (let index = 0; index < videos.length; index += 1) {
    if (stopRequested) break;
    try {
      const result = await processOne(index, videos.length, videos[index], settings, historyHashes, ffmpegPath, outputDir);
      results.push(result);
      if (result?.stopped) break;
    } catch (error) {
      sendProgress(index, videos.length, { name: videos[index].name, status: 'error', progress: 0, message: error.message });
      results.push({ name: videos[index].name, status: 'error', message: error.message });
    }
  }
  send({ type: stopRequested ? 'stopped' : 'finished', results });
}

process.on('message', message => {
  if (message.type === 'stop') {
    stopRequested = true;
    if (currentProcess) currentProcess.kill('SIGTERM');
    return;
  }
  if (message.type === 'process-batch') {
    stopRequested = false;
    processBatch(message.payload).catch(error => send({ type: 'fatal-error', message: error.message }));
  }
});
