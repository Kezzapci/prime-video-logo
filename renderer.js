const state = {
  settings: {}, history: [], videos: [], processing: false, activeVideo: null, drag: null,
  health: null, inputPath: '', sourceWatchStatus: 'idle', thumbCache: new Map(), thumbLoading: new Set(), thumbQueue: [],
  thumbInFlight: 0, queueProgress: new Map()
};

const $ = id => document.getElementById(id);
const on = (id, event, handler, options) => { const el = $(id); if (el) el.addEventListener(event, handler, options); return el; };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const toFileUrl = value => { if (!value) return ''; const normalized = String(value).replace(/\\/g, '/'); return encodeURI(normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`); };
const shortPath = value => value ? (value.length > 52 ? `…${value.slice(-49)}` : value) : '';
const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const FORMAT_CONFIG = {
  '9:16': { key: '9:16', width: 720, height: 1280, label: '9:16', dimensions: '720 × 1280', className: 'canvas-portrait' },
  '16:9': { key: '16:9', width: 1280, height: 720, label: '16:9', dimensions: '1280 × 720', className: 'canvas-landscape' }
};
const getFormat = value => FORMAT_CONFIG[String(value)] || FORMAT_CONFIG['9:16'];

const showToast = message => {
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3600);
};
function setStatus(message, busy = false) {
  ['topStatus', 'readyChip'].forEach(id => { if ($(id)) $(id).textContent = message; });
  if ($('footerStatus')) $('footerStatus').textContent = busy ? 'İşlem sürüyor' : 'Kayıt aktif';
  document.querySelectorAll('.status-dot').forEach(dot => {
    dot.style.background = busy ? '#ffc52f' : '#70e298';
    dot.style.boxShadow = busy ? '0 0 12px rgba(255,197,47,.75)' : '0 0 12px rgba(112,226,152,.75)';
  });
}
function updateRangeFill(input) {
  if (!input) return;
  const min = Number(input.min || 0), max = Number(input.max || 100), value = Number(input.value || min);
  const pct = ((value - min) / Math.max(1, max - min)) * 100;
  input.style.background = `linear-gradient(90deg,#188dd0 0 ${pct}%,#203846 ${pct}% 100%)`;
}
function logoIsEnabled() {
  return state.settings?.logoEnabled !== false;
}
function applyLogoState() {
  const enabled = logoIsEnabled();
  const logo = $('logoOverlay');
  if (logo) logo.style.display = enabled && state.settings?.logoPath ? 'block' : 'none';
  document.querySelectorAll('.logo-toggle').forEach(toggle => {
    toggle.classList.toggle('is-off', !enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    const label = toggle.querySelector('[data-toggle-label]');
    if (label) label.textContent = enabled ? 'Açık' : 'Kapalı';
  });
  document.querySelectorAll('.preset').forEach(button => { button.disabled = !enabled; button.classList.toggle('is-disabled', !enabled); });
  ['sizeSlider', 'opacitySlider'].forEach(id => { if ($(id)) $(id).disabled = !enabled; });
  if ($('logoStateText')) $('logoStateText').textContent = enabled ? 'BuildBrk overlay etkin' : 'BuildBrk overlay kapalı';
}
function applySettingsToUI() {
  const s = state.settings || {};
  s.logoEnabled = s.logoEnabled !== false;
  state.inputPath = s.inputPath || state.inputPath || '';
  if ($('inputPath')) $('inputPath').value = state.inputPath || '';
  const outputPath = s.outputPath || 'Masaüstü\\Edilmiş Videolar';
  if ($('outputPathText')) $('outputPathText').textContent = shortPath(outputPath);
  if ($('outputSettingPath')) $('outputSettingPath').textContent = outputPath;
  if ($('logoSettingPath')) $('logoSettingPath').textContent = s.logoPath ? shortPath(s.logoPath) : 'Varsayılan logo';
  applyFormatToUI();
  if ($('sizeSlider')) $('sizeSlider').value = Math.round(numeric(s.logoWidth, .78) * 100);
  if ($('opacitySlider')) $('opacitySlider').value = Math.round(numeric(s.opacity, 1) * 100);
  if ($('sizeValue')) $('sizeValue').textContent = `${$('sizeSlider')?.value || 22}%`;
  if ($('opacityValue')) $('opacityValue').textContent = `${$('opacitySlider')?.value || 100}%`;
  updateRangeFill($('sizeSlider')); updateRangeFill($('opacitySlider')); positionLogo();
  if (s.logoPath && $('logoOverlay')) $('logoOverlay').src = toFileUrl(s.logoPath);
  applyLogoState();
}
function applyFormatToUI() {
  const format = getFormat(state.settings?.outputFormat);
  state.settings.outputFormat = format.key;
  document.querySelectorAll('.format-option').forEach(button => button.classList.toggle('active', button.dataset.format === format.key));
  if ($('topFormat')) $('topFormat').textContent = `${format.dimensions} / ${format.label}`;
  if ($('canvasFormat')) $('canvasFormat').textContent = format.label;
  if ($('canvasDimensions')) $('canvasDimensions').textContent = format.dimensions;
  if ($('statFormat')) $('statFormat').textContent = format.label;
  if ($('statDimensions')) $('statDimensions').textContent = `${format.dimensions} · Ses korunur`;
  if ($('composerDimensions')) $('composerDimensions').textContent = `▯ ${format.dimensions}`;
  const stage = $('previewStage');
  if (stage) { stage.classList.remove('canvas-portrait', 'canvas-landscape'); stage.classList.add(format.className); }
  positionLogo();
}
function videoRowMarkup(video, index) {
  const cached = state.thumbCache.get(video.path);
  return `<div class="video-row" data-index="${index}"><img class="video-thumb" ${cached ? `src="${toFileUrl(cached)}"` : ''} loading="lazy" alt=""><span title="${esc(video.name)}">${esc(video.name)}</span></div>`;
}
function queueRowMarkup(video, index) {
  const data = state.queueProgress.get(index) || { progress: 0, status: 'wait', message: 'Bekliyor' };
  const status = ['done', 'skipped', 'processing', 'error'].includes(data.status) ? data.status : 'wait';
  const barColor = status === 'done' ? '#70e298' : status === 'skipped' ? '#738795' : status === 'error' ? '#e05656' : '';
  return `<div class="queue-item" data-queue="${index}"><div class="queue-title"><strong title="${esc(video.name)}">${esc(video.name)}</strong><span class="queue-percent">${data.progress || 0}%</span></div><div class="queue-state state-${status}">${esc(status === 'skipped' ? 'Atlandı · Daha önce işlendi' : data.message || 'Bekliyor')}</div><div class="progress-bar"><i style="width:${data.progress || 0}%;${barColor ? `background:${barColor};` : ''}"></i></div></div>`;
}
function getWindow(container, rowHeight, overscan = 8) {
  const viewport = Math.max(220, container.clientHeight || 400);
  const start = Math.max(0, Math.floor(container.scrollTop / rowHeight) - overscan);
  const end = Math.min(state.videos.length, start + Math.ceil(viewport / rowHeight) + overscan * 2);
  return { start, end, top: start * rowHeight, bottom: Math.max(0, (state.videos.length - end) * rowHeight) };
}
function renderVideoWindow() {
  const container = $('videoList'); if (!container) return;
  if (!state.videos.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-mark">⌁</div><strong>Kaynak klasörü bağlanmadı</strong><small>MP4 · MOV · MKV · AVI · WEBM</small><em>Klasör seçerek başla</em></div>';
    return;
  }
  const win = getWindow(container, 46, 8);
  const rows = state.videos.slice(win.start, win.end).map((video, offset) => videoRowMarkup(video, win.start + offset)).join('');
  container.innerHTML = `<div class="virtual-spacer" style="height:${win.top}px"></div>${rows}<div class="virtual-spacer" style="height:${win.bottom}px"></div>`;
  for (let i = win.start; i < win.end; i += 1) loadThumb(state.videos[i], i);
}
function renderQueueWindow() {
  const container = $('queueList'); if (!container) return;
  if (!state.videos.length) {
    container.innerHTML = '<div class="empty-state compact"><div class="empty-mark gold-mark">☷</div><strong>Kuyruk boş</strong><small>Video klasörü seçildiğinde işler burada görünür.</small></div>';
    return;
  }
  const win = getWindow(container, 87, 5);
  const rows = state.videos.slice(win.start, win.end).map((video, offset) => queueRowMarkup(video, win.start + offset)).join('');
  container.innerHTML = `<div class="virtual-spacer" style="height:${win.top}px"></div>${rows}<div class="virtual-spacer" style="height:${win.bottom}px"></div>`;
}
function renderVideoList(resetQueue = true, refreshThumbs = false) {
  const count = state.videos.length;
  if ($('videoCount')) $('videoCount').textContent = `${count} video`;
  if ($('statVideos')) $('statVideos').textContent = count.toLocaleString('tr-TR');
  if ($('scanText')) $('scanText').textContent = state.sourceWatchStatus === 'watching' ? `${count} video · klasör izleniyor` : state.sourceWatchStatus === 'scanning' ? 'Klasör taranıyor…' : (count ? 'İşleme hazır · Sanal kuyruk' : 'Video bulunamadı');
  if ($('queueCount')) $('queueCount').textContent = count.toLocaleString('tr-TR');
  if (refreshThumbs) { state.thumbCache.clear(); state.thumbLoading.clear(); state.thumbQueue.length = 0; }
  if (resetQueue) { state.queueProgress.clear(); if ($('videoList')) $('videoList').scrollTop = 0; if ($('queueList')) $('queueList').scrollTop = 0; }
  renderVideoWindow(); renderQueueWindow(); updateOverallStats();
}
function loadThumb(video, index) {
  if (!video || state.thumbCache.has(video.path) || state.thumbLoading.has(video.path)) return;
  state.thumbLoading.add(video.path); state.thumbQueue.push({ video, index }); pumpThumbs();
}
function pumpThumbs() {
  while (state.thumbInFlight < 2 && state.thumbQueue.length) {
    const task = state.thumbQueue.shift(); state.thumbInFlight += 1;
    window.primeAPI.previewFrame(task.video.path).then(frame => {
      if (!frame) return;
      state.thumbCache.set(task.video.path, frame);
      const element = document.querySelector(`[data-index="${task.index}"] .video-thumb`);
      if (element) element.src = toFileUrl(frame);
      if (!state.activeVideo || state.activeVideo.path === task.video.path) setPreview(task.video, frame);
    }).catch(error => window.primeAPI.reportError({ message: 'Ön izleme karesi alınamadı', stack: error?.stack })).finally(() => {
      state.thumbLoading.delete(task.video.path); state.thumbInFlight -= 1; pumpThumbs();
    });
  }
}
function setPreview(video, framePath) {
  state.activeVideo = video;
  if (framePath && $('previewImage')) { $('previewImage').src = toFileUrl(framePath); $('previewImage').style.display = 'block'; if ($('previewPlaceholder')) $('previewPlaceholder').style.display = 'none'; }
  if (state.settings.logoPath && $('logoOverlay')) $('logoOverlay').src = toFileUrl(state.settings.logoPath);
  applyLogoState(); positionLogo();
}
function logoHeightFraction(width) {
  const logo = $('logoOverlay'), stage = $('previewStage');
  if (!logo || !stage) return width * .65;
  const ratio = logo.naturalWidth && logo.naturalHeight ? logo.naturalHeight / logo.naturalWidth : .65;
  return clamp(width * (stage.clientWidth / Math.max(1, stage.clientHeight)) * ratio, .02, .92);
}
function positionLogo() {
  const s = state.settings || {}, logo = $('logoOverlay'); if (!logo) return;
  const width = clamp(numeric(s.logoWidth, .78), .05, .8), height = logoHeightFraction(width);
  const x = numeric(s.logoX, .11), y = numeric(s.logoY, .68);
  logo.style.left = `${x * 100}%`; logo.style.top = `${y * 100}%`; logo.style.width = `${width * 100}%`; logo.style.height = 'auto'; logo.style.opacity = clamp(numeric(s.opacity, 1), .05, 1); logo.style.transform = 'translate3d(0,0,0)';
  if ($('logoPositionValue')) $('logoPositionValue').textContent = `${Math.round(x * 100)}%, ${Math.round(y * 100)}%`;
}
function updateSetting(key, value) { state.settings[key] = value; return window.primeAPI.saveSettings(state.settings); }
async function scanInputFolder({ resetQueue = false, silent = false } = {}) {
  const folder = state.inputPath || state.settings?.inputPath;
  if (!folder) return [];
  const previousVideos = state.videos.slice();
  const previousProgress = new Map(previousVideos.map((video, index) => [video.path, state.queueProgress.get(index)]));
  const previousPaths = new Set(previousVideos.map(video => video.path));
  state.sourceWatchStatus = 'scanning'; renderVideoList(false);
  try {
    const videos = await window.primeAPI.scanFolder(folder);
    state.videos = Array.isArray(videos) ? videos : [];
    state.queueProgress.clear();
    state.videos.forEach((video, index) => { const progress = previousProgress.get(video.path); if (progress) state.queueProgress.set(index, progress); });
    if (state.activeVideo) state.activeVideo = state.videos.find(video => video.path === state.activeVideo.path) || null;
    state.sourceWatchStatus = 'watching'; renderVideoList(resetQueue, resetQueue);
    const newCount = state.videos.filter(video => !previousPaths.has(video.path)).length;
    if (!silent && newCount > 0) showToast(`${newCount.toLocaleString('tr-TR')} yeni video bulundu ve kuyruğa eklendi`);
    return state.videos;
  } catch (error) {
    state.sourceWatchStatus = 'error'; renderVideoList(false);
    window.primeAPI.reportError({ message: 'Klasör taranamadı', stack: error?.stack });
    if (!silent) { setStatus('Onarım gerekli'); showToast('Yeni videolar taranamadı. Teknik kayıt tutuldu.'); }
    return [];
  }
}
async function chooseInput() {
  const folder = await window.primeAPI.chooseFolder('input'); if (!folder) return;
  state.inputPath = folder; state.settings.inputPath = folder; if ($('inputPath')) $('inputPath').value = folder; setStatus('Klasör taranıyor…', true);
  try {
    await window.primeAPI.saveSettings(state.settings);
    const watch = await window.primeAPI.watchSourceFolder(folder);
    if (!watch?.ok) showToast(watch?.message || 'Klasör izlenemedi');
    await scanInputFolder({ resetQueue: true, silent: true });
    setStatus('Hazır');
    showToast(state.videos.length ? `${state.videos.length.toLocaleString('tr-TR')} video akıllı kuyruğa alındı · yeni videolar otomatik taranır` : 'Bu klasörde desteklenen video bulunamadı');
  } catch (error) {
    window.primeAPI.reportError({ message: 'Klasör seçilemedi', stack: error?.stack }); setStatus('Onarım gerekli'); showToast('Klasör taranamadı. Teknik kayıt tutuldu.');
  }
}
function handleSourceFolderStatus(data = {}) {
  if (data.type === 'watching') { state.sourceWatchStatus = 'watching'; renderVideoList(false); return; }
  if (data.type === 'changed') { if (data.path === state.inputPath || !state.inputPath) scanInputFolder({ resetQueue: false }); return; }
  if (data.type === 'error' || data.type === 'stopped') { state.sourceWatchStatus = 'error'; renderVideoList(false); showToast(data.message || 'Kaynak klasörü izlenemiyor.'); }
}
async function chooseOutput() {
  const folder = await window.primeAPI.chooseFolder('output'); if (!folder) return;
  await updateSetting('outputPath', folder); applySettingsToUI(); showToast('Çıktı klasörü kaydedildi');
}
async function chooseLogo() {
  const logo = await window.primeAPI.chooseLogo(); if (!logo) return;
  await updateSetting('logoPath', logo); applySettingsToUI(); showToast('Logo güncellendi · Video üstünde istediğin yere taşı');
}
async function toggleLogo() {
  const previous = logoIsEnabled();
  state.settings.logoEnabled = !previous;
  applyLogoState();
  try {
    state.settings = await window.primeAPI.saveSettings(state.settings);
    applySettingsToUI();
    showToast(state.settings.logoEnabled ? 'Logo overlay açıldı' : 'Logo overlay kapatıldı');
  } catch (error) {
    state.settings.logoEnabled = previous;
    applyLogoState();
    window.primeAPI.reportError({ message: 'Logo görünürlüğü kaydedilemedi', stack: error?.stack });
    showToast('Logo ayarı kaydedilemedi.');
  }
}
function updateOverallStats() {
  const total = state.videos.length; if (!total) { if ($('statDone')) $('statDone').textContent = '0'; return; }
  let done = 0, active = 0, percentSum = 0;
  state.queueProgress.forEach(item => { if (item.status === 'done' || item.status === 'skipped') done += 1; if (item.status === 'processing') active += 1; percentSum += numeric(item.progress, 0); });
  const pct = Math.round(Math.min(100, Math.max(done / total * 100, percentSum / Math.max(1, total))));
  if ($('statDone')) $('statDone').textContent = done.toLocaleString('tr-TR'); if ($('queueOverallPercent')) $('queueOverallPercent').textContent = `${pct}%`; if ($('queueProgressOverall')) $('queueProgressOverall').style.width = `${pct}%`;
  if ($('queueProgressLabel')) $('queueProgressLabel').textContent = state.processing ? (active ? `${active} video işleniyor` : 'Kuyruk hazırlanıyor') : (done ? `${done.toLocaleString('tr-TR')} tamamlandı` : 'Hazır');
  const ring = $('statRingValue'); if (ring) ring.style.strokeDashoffset = String(100.5 - (100.5 * pct / 100));
}
function applyQueueData(element, data) {
  if (!element) return;
  const stateEl = element.querySelector('.queue-state'), bar = element.querySelector('.progress-bar i'), percent = element.querySelector('.queue-percent');
  if (percent) percent.textContent = `${data.progress || 0}%`;
  if (bar) { bar.style.width = `${data.progress || 0}%`; bar.style.background = data.status === 'done' ? '#70e298' : data.status === 'skipped' ? '#738795' : data.status === 'error' ? '#e05656' : ''; }
  if (stateEl) { stateEl.textContent = data.status === 'skipped' ? 'Atlandı · Daha önce işlendi' : data.status === 'error' ? data.message || 'Çıktı oluşturulamadı' : data.message || 'İşleniyor'; stateEl.className = `queue-state state-${['done','skipped','processing','error'].includes(data.status) ? data.status : 'wait'}`; }
}
function updateQueue(data) { if (Number.isFinite(data.index)) state.queueProgress.set(data.index, data); applyQueueData(document.querySelector(`[data-queue="${data.index}"]`), data); updateOverallStats(); }
function updateBanner(title, message, action, actionText) { const banner = $('updateBanner'); if (!banner) return; banner.classList.remove('hidden'); $('updateTitle').textContent = title; $('updateMessage').textContent = message; const button = $('updateActionBtn'); button.dataset.action = action || ''; button.textContent = actionText || 'Kapat'; button.disabled = !action; }
function handleUpdateStatus(data) {
  if (!data) return;
  if (data.type === 'checking') { if ($('checkUpdateBtn')) $('checkUpdateBtn').disabled = true; updateBanner('Güncellemeler kontrol ediliyor', 'Sürüm sunucusu güvenli şekilde kontrol ediliyor…', '', 'Kontrol ediliyor'); }
  if (data.type === 'available') { if ($('checkUpdateBtn')) $('checkUpdateBtn').disabled = false; updateBanner('Yeni sürüm bulundu', `v${data.version} hazır.`, 'download', 'Güncellemeyi indir'); showToast(`Yeni sürüm v${data.version} bulundu`); }
  if (data.type === 'downloading') updateBanner('Güncelleme indiriliyor', `%${data.percent || 0} tamamlandı.`, '', `%${data.percent || 0}`);
  if (data.type === 'downloaded') updateBanner('Güncelleme hazır', `v${data.version} yeniden başlatınca kurulacak.`, 'install', 'Yeniden başlat ve güncelle');
  if (data.type === 'not-available') { if ($('checkUpdateBtn')) $('checkUpdateBtn').disabled = false; $('updateBanner')?.classList.add('hidden'); showToast('Uygulama güncel'); }
  if (data.type === 'error') { if ($('checkUpdateBtn')) $('checkUpdateBtn').disabled = false; $('updateBanner')?.classList.add('hidden'); showToast(data.message || 'Güncelleme kontrol edilemedi.'); }
}
function renderHealth(result) {
  if (!result) return; state.health = result; if ($('healthSummary')) $('healthSummary').textContent = result.summary || 'Sistem kontrol edildi.'; if ($('statHealth')) $('statHealth').textContent = result.ok ? 'Hazır' : 'Kontrol';
  const orb = $('healthOrb'); if (orb) { orb.classList.toggle('warn', result.failed > 0 && result.failed < 3); orb.classList.toggle('bad', result.failed >= 3); const span = orb.querySelector('span'); if (span) span.textContent = result.ok ? '✓' : '!'; }
  if ($('healthGrid')) $('healthGrid').innerHTML = (result.checks || []).map(check => `<div class="health-item ${check.ok ? 'ok' : 'bad'}"><div class="health-item-head"><span class="health-item-dot"></span>${esc(check.label)}</div><small>${esc(check.detail || (check.ok ? 'Hazır' : 'Kontrol gerekli'))}</small></div>`).join('');
}
async function autoRepair(silent = false) {
  const button = $('repairBtn'); if (button) { button.disabled = true; button.innerHTML = '<span>↻</span> SİSTEM TARANIYOR…'; }
  if ($('healthSummary')) $('healthSummary').textContent = 'Bileşenler kontrol ediliyor, güvenli düzeltmeler uygulanıyor…';
  try { const result = await window.primeAPI.repairSystem(); renderHealth(result); if (!silent) showToast(result.ok ? 'Sistem tarandı ve hazırlandı' : result.summary); }
  catch (error) { window.primeAPI.reportError({ message: 'Otomatik onarım başarısız', stack: error?.stack }); showToast('Sistem onarımı tamamlanamadı. Teknik kayıt tutuldu.'); }
  finally { if (button) { button.disabled = false; button.innerHTML = '<span>✦</span> Sistemi tara ve onar'; } }
}
async function startProcessing() {
  if (state.processing) return; if (!state.videos.length) return showToast('Önce bir video klasörü seç'); if (logoIsEnabled() && !state.settings.logoPath) return showToast('Logo açıkken önce bir logo seç');
  state.processing = true; if ($('startBtn')) $('startBtn').disabled = true; if ($('stopBtn')) $('stopBtn').disabled = false; setStatus('İşlem sürüyor…', true); updateOverallStats();
  try {
    applyFormatToUI();
    await window.primeAPI.saveSettings(state.settings);
    const results = await window.primeAPI.processVideos({ videos: state.videos, settings: state.settings });
    state.history = (await window.primeAPI.getInitialState()).history; renderHistory();
    const list = Array.isArray(results) ? results : [], done = list.filter(item => item?.status === 'done').length, skipped = list.filter(item => item?.status === 'skipped').length, errors = list.filter(item => item?.status === 'error').length;
    if (errors) { showToast(`${errors} video yazılamadı; çıktı klasörü ve teknik kayıtları kontrol et`); setStatus('Kontrol gerekli'); }
    else if (done) { showToast(`${done} video Edilmiş Videolar klasörüne kaydedildi`); setStatus('Tamamlandı'); }
    else if (skipped) { showToast(`${skipped} video daha önce işlendi; yeni çıktı oluşturulmadı`); setStatus('Güncel'); }
    else { showToast('İşlem sonucu alınamadı; teknik kayıtları kontrol et'); setStatus('Kontrol gerekli'); }
  } catch (error) { window.primeAPI.reportError({ message: 'Video işleme hatası', stack: error?.stack }); showToast(error?.message || 'Video işlenemedi. Çıktı klasörü kontrol edilemedi.'); setStatus('Onarım gerekli'); await autoRepair(true); }
  finally { state.processing = false; if ($('startBtn')) $('startBtn').disabled = false; if ($('stopBtn')) $('stopBtn').disabled = true; updateOverallStats(); }
}
function renderHistory() {
  if (!$('historyList')) return;
  $('historyList').innerHTML = state.history.length ? [...state.history].reverse().map(item => `<div class="history-row"><span>${esc(item.name)}</span><span>${new Date(item.processedAt).toLocaleString('tr-TR')}</span><a title="${esc(item.outputPath)}">${esc(shortPath(item.outputPath))}</a></div>`).join('') : '<div class="empty-state compact"><div class="empty-mark">◔</div><strong>Henüz kayıt yok</strong><small>İşlenen videolar burada tutulur.</small></div>';
}
function setPage(page) { document.querySelectorAll('.page').forEach(item => item.classList.toggle('active-page', item.id === `${page}Page`)); document.querySelectorAll('.rail-item').forEach(item => item.classList.toggle('active', item.dataset.page === page)); }
function presetPosition(pos) {
  const s = state.settings, width = numeric(s.logoWidth, .78), margin = numeric(s.margin, .04), height = logoHeightFraction(width);
  s.logoX = pos.includes('right') ? 1 - width - margin : pos.includes('center') ? (1 - width) / 2 : margin;
  s.logoY = pos.includes('bottom') ? Math.max(margin, 1 - height - margin) : margin;
  document.querySelectorAll('.preset').forEach(button => button.classList.toggle('active', button.dataset.pos === pos)); positionLogo(); window.primeAPI.saveSettings(s); showToast(`Logo konumu: ${pos.replace('-', ' ')}`);
}
function setupDrag() {
  const logo = $('logoOverlay'), stage = $('previewStage'); if (!logo || !stage) return;
  logo.addEventListener('pointerdown', event => { event.preventDefault(); const rect = stage.getBoundingClientRect(); state.drag = { startX: event.clientX, startY: event.clientY, x: numeric(state.settings.logoX, .74), y: numeric(state.settings.logoY, .05), rect }; logo.setPointerCapture(event.pointerId); logo.classList.add('dragging'); stage.classList.add('logo-editing'); });
  logo.addEventListener('pointermove', event => { if (!state.drag) return; const { rect } = state.drag, dx = (event.clientX - state.drag.startX) / rect.width, dy = (event.clientY - state.drag.startY) / rect.height; state.settings.logoX = state.drag.x + dx; state.settings.logoY = state.drag.y + dy; positionLogo(); });
  const end = () => { if (!state.drag) return; state.drag = null; logo.classList.remove('dragging'); stage.classList.remove('logo-editing'); window.primeAPI.saveSettings(state.settings); showToast('Logo konumu kaydedildi'); };
  logo.addEventListener('pointerup', end); logo.addEventListener('pointercancel', end);
}

on('chooseInput', 'click', chooseInput); on('chooseInputSmall', 'click', chooseInput); on('chooseInputLibrary', 'click', chooseInput);
on('chooseLogo', 'click', chooseLogo); on('chooseLogoSettings', 'click', chooseLogo); on('chooseOutput', 'click', chooseOutput); document.querySelectorAll('.logo-toggle').forEach(button => button.addEventListener('click', toggleLogo));
document.querySelectorAll('.format-option').forEach(button => button.addEventListener('click', async () => {
  const format = getFormat(button.dataset.format);
  state.settings.outputFormat = format.key;
  applyFormatToUI();
  await window.primeAPI.saveSettings(state.settings);
  showToast(`Çıktı formatı ${format.label} · ${format.dimensions} olarak ayarlandı`);
}));
on('openOutputFolder', 'click', async () => { const folder = state.settings.outputPath || ''; const error = await window.primeAPI.openOutput(folder); showToast(error ? 'Çıktı klasörü açılamadı' : `Çıktı klasörü açıldı: ${shortPath(folder)}`); });
on('startBtn', 'click', startProcessing); on('stopBtn', 'click', async () => { await window.primeAPI.stopProcessing(); showToast('İşlem güvenli şekilde durduruluyor…'); });
on('windowMinimize', 'click', () => window.primeAPI.minimizeWindow()); on('windowMaximize', 'click', () => window.primeAPI.toggleMaximize()); on('windowClose', 'click', () => window.primeAPI.closeWindow());
on('sizeSlider', 'input', event => { state.settings.logoWidth = Number(event.target.value) / 100; if ($('sizeValue')) $('sizeValue').textContent = `${event.target.value}%`; updateRangeFill(event.target); positionLogo(); });
on('sizeSlider', 'change', () => window.primeAPI.saveSettings(state.settings)); on('opacitySlider', 'input', event => { state.settings.opacity = Number(event.target.value) / 100; if ($('opacityValue')) $('opacityValue').textContent = `${event.target.value}%`; updateRangeFill(event.target); positionLogo(); });
on('opacitySlider', 'change', () => window.primeAPI.saveSettings(state.settings)); on('logoOverlay', 'load', positionLogo);
document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => presetPosition(button.dataset.pos)));
document.querySelectorAll('.rail-item').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
on('videoList', 'scroll', renderVideoWindow, { passive: true }); on('queueList', 'scroll', renderQueueWindow, { passive: true });
on('videoList', 'click', event => { const row = event.target.closest('.video-row'); if (!row) return; const index = Number(row.dataset.index), video = state.videos[index]; if (video) { state.activeVideo = video; setPreview(video, state.thumbCache.get(video.path)); if (!state.thumbCache.has(video.path)) loadThumb(video, index); } });
on('clearHistory', 'click', async () => { state.history = await window.primeAPI.clearHistory(); renderHistory(); showToast('İşlem geçmişi temizlendi'); });
on('openReleasePage', 'click', async () => { await window.primeAPI.openReleasePage(); showToast('GitHub Releases sayfası açıldı'); });
on('checkUpdateBtn', 'click', async () => { if ($('checkUpdateBtn')) $('checkUpdateBtn').disabled = true; const result = await window.primeAPI.checkForUpdates(); if (result?.status === 'dev') { if ($('checkUpdateBtn')) $('checkUpdateBtn').disabled = false; showToast('Otomatik kontrol kurulu EXE sürümünde çalışır.'); } });
on('updateActionBtn', 'click', async () => { const action = $('updateActionBtn')?.dataset.action; if (action === 'download') await window.primeAPI.downloadUpdate(); if (action === 'install') await window.primeAPI.installUpdate(); });
on('closeUpdateBanner', 'click', () => $('updateBanner')?.classList.add('hidden')); on('repairBtn', 'click', () => autoRepair(false)); on('openLogsBtn', 'click', () => window.primeAPI.openLogs());
window.primeAPI.onProgress(updateQueue); window.primeAPI.onSourceFolderStatus(handleSourceFolderStatus); window.primeAPI.onUpdateStatus(handleUpdateStatus); window.primeAPI.onHealthStatus(renderHealth);
window.addEventListener('error', event => { window.primeAPI.reportError({ message: event.message, stack: event.error?.stack }); showToast('Arayüz kendini toparlamaya çalışıyor.'); });
window.addEventListener('unhandledrejection', event => { window.primeAPI.reportError({ message: String(event.reason), stack: event.reason?.stack }); showToast('Beklenmeyen işlem hatası kaydedildi.'); });
(async () => {
  try {
    const initial = await window.primeAPI.getInitialState(); state.settings = initial.settings || {}; state.history = initial.history || []; state.health = initial.health || null;
    applySettingsToUI(); renderHistory(); renderHealth(state.health); setupDrag();
    if (state.inputPath) { await window.primeAPI.watchSourceFolder(state.inputPath); await scanInputFolder({ resetQueue: true, silent: true }); }
    const version = initial.version || await window.primeAPI.getAppVersion(); if ($('versionText')) $('versionText').textContent = `Mevcut sürüm: v${version} · Yeni sürümler otomatik kontrol edilir.`;
    if (state.health && !state.health.ok) setTimeout(() => autoRepair(true), 900);
  } catch (error) { window.primeAPI.reportError({ message: 'Başlangıç durumu yüklenemedi', stack: error?.stack }); showToast('Uygulama başlatılırken sorun oluştu; sistem onarılıyor.'); setTimeout(() => autoRepair(true), 800); }
})();
