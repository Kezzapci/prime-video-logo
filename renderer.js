const state = {
  settings: {},
  history: [],
  videos: [],
  processing: false,
  activeVideo: null,
  drag: null,
  health: null,
  inputPath: '',
  thumbCache: new Map(),
  thumbLoading: new Set(),
  thumbQueue: [],
  thumbInFlight: 0,
  queueProgress: new Map()
};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const toFileUrl = value => {
  if (!value) return '';
  const normalized = String(value).replace(/\\/g, '/');
  return encodeURI(normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`);
};
const shortPath = value => value ? (value.length > 52 ? `…${value.slice(-49)}` : value) : '';
const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const showToast = message => {
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
};

function setStatus(message, busy = false) {
  ['topStatus', 'readyChip', 'headingStatus'].forEach(id => { if ($(id)) $(id).textContent = message; });
  if ($('footerStatus')) $('footerStatus').textContent = busy ? 'İşlem sürüyor' : 'Kayıt aktif';
  document.querySelectorAll('.status-dot').forEach(dot => {
    dot.style.background = busy ? '#f5b91c' : '#66d52e';
    dot.style.boxShadow = busy ? '0 0 10px rgba(245,185,28,.65)' : '0 0 10px rgba(102,213,46,.65)';
  });
}

function updateRangeFill(input) {
  if (!input) return;
  const min = Number(input.min || 0); const max = Number(input.max || 100); const value = Number(input.value || min);
  const percent = ((value - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(90deg,#188dd0 0 ${percent}%,#203846 ${percent}% 100%)`;
}

function applySettingsToUI() {
  const s = state.settings || {};
  $('inputPath').value = state.inputPath || '';
  $('outputPathText').textContent = shortPath(s.outputPath || 'Masaüstü\\Edilmiş Videolar');
  $('outputSettingPath').textContent = s.outputPath || 'Masaüstü\\Edilmiş Videolar';
  $('logoSettingPath').textContent = s.logoPath ? shortPath(s.logoPath) : 'Varsayılan logo';
  $('sizeSlider').value = Math.round(numeric(s.logoWidth, .22) * 100);
  $('opacitySlider').value = Math.round(numeric(s.opacity, 1) * 100);
  $('sizeValue').textContent = `${$('sizeSlider').value}%`;
  $('opacityValue').textContent = `${$('opacitySlider').value}%`;
  updateRangeFill($('sizeSlider')); updateRangeFill($('opacitySlider'));
  positionLogo();
  if (s.logoPath) $('logoOverlay').src = toFileUrl(s.logoPath);
}

function videoRowMarkup(video, index) {
  const cached = state.thumbCache.get(video.path);
  const src = cached ? `src="${toFileUrl(cached)}"` : '';
  return `<div class="video-row" data-index="${index}"><img class="video-thumb" ${src} loading="lazy" alt=""><span title="${esc(video.name)}">${esc(video.name)}</span></div>`;
}

function queueRowMarkup(video, index) {
  const data = state.queueProgress.get(index) || { progress: 0, status: 'wait', message: 'Bekliyor' };
  const status = data.status === 'done' ? 'done' : data.status === 'skipped' ? 'skipped' : data.status === 'processing' ? 'processing' : data.status === 'error' ? 'error' : 'wait';
  const barColor = status === 'done' ? '#58c835' : status === 'skipped' ? '#738795' : status === 'error' ? '#e05656' : '';
  return `<div class="queue-item" data-queue="${index}"><div class="queue-title"><strong title="${esc(video.name)}">${esc(video.name)}</strong><span class="queue-percent">${data.progress || 0}%</span></div><div class="queue-state state-${status}">${esc(status === 'skipped' ? 'Atlandı · Daha önce işlendi' : data.message || 'Bekliyor')}</div><div class="progress-bar"><i style="width:${data.progress || 0}%;${barColor ? `background:${barColor};` : ''}"></i></div></div>`;
}

function getWindow(container, rowHeight = 46, overscan = 10) {
  const viewport = Math.max(260, container.clientHeight || 500);
  const start = Math.max(0, Math.floor(container.scrollTop / rowHeight) - overscan);
  const end = Math.min(state.videos.length, start + Math.ceil(viewport / rowHeight) + overscan * 2);
  return { start, end, top: start * rowHeight, bottom: Math.max(0, (state.videos.length - end) * rowHeight) };
}

function renderVideoWindow() {
  const container = $('videoList');
  if (!container) return;
  if (!state.videos.length) { container.innerHTML = '<div class="empty-state"><span class="empty-orbit">◌</span><strong>Henüz video seçilmedi</strong><small>MP4, MOV, MKV, AVI veya WEBM</small></div>'; return; }
  const win = getWindow(container);
  const rows = state.videos.slice(win.start, win.end).map((video, offset) => videoRowMarkup(video, win.start + offset)).join('');
  container.innerHTML = `<div class="virtual-spacer" style="height:${win.top}px"></div>${rows}<div class="virtual-spacer" style="height:${win.bottom}px"></div>`;
  for (let index = win.start; index < win.end; index += 1) loadThumb(state.videos[index], index);
}

function renderQueueWindow() {
  const container = $('queueList');
  if (!container) return;
  if (!state.videos.length) { container.innerHTML = '<div class="empty-state compact"><span class="empty-orbit">☷</span><strong>Kuyruk boş</strong><small>Video klasörü seçildiğinde burada görünür.</small></div>'; return; }
  const win = getWindow(container);
  const rows = state.videos.slice(win.start, win.end).map((video, offset) => queueRowMarkup(video, win.start + offset)).join('');
  container.innerHTML = `<div class="virtual-spacer" style="height:${win.top}px"></div>${rows}<div class="virtual-spacer" style="height:${win.bottom}px"></div>`;
}

function renderVideoList() {
  $('videoCount').textContent = `${state.videos.length} video`;
  $('scanText').textContent = state.videos.length ? 'İşleme hazır · Akıllı kuyruk' : 'Video bulunamadı';
  $('queueCount').textContent = state.videos.length;
  state.thumbCache.clear(); state.thumbLoading.clear(); state.thumbQueue.length = 0; state.queueProgress.clear();
  $('videoList').scrollTop = 0; $('queueList').scrollTop = 0;
  renderVideoWindow(); renderQueueWindow();
  if (state.videos[0]) loadThumb(state.videos[0], 0);
}

function loadThumb(video, index) {
  if (!video || state.thumbCache.has(video.path) || state.thumbLoading.has(video.path)) return;
  state.thumbLoading.add(video.path); state.thumbQueue.push({ video, index }); pumpThumbs();
}
async function pumpThumbs() {
  while (state.thumbInFlight < 2 && state.thumbQueue.length) {
    const task = state.thumbQueue.shift(); state.thumbInFlight += 1;
    window.primeAPI.previewFrame(task.video.path).then(frame => {
      if (frame) {
        state.thumbCache.set(task.video.path, frame);
        const el = document.querySelector(`[data-index="${task.index}"] .video-thumb`);
        if (el) el.src = toFileUrl(frame);
        if (!state.activeVideo || task.index === 0) setPreview(task.video, frame);
      }
    }).catch(error => {
      window.primeAPI.reportError({ message: 'Ön izleme karesi alınamadı', stack: error?.stack });
    }).finally(() => {
      state.thumbLoading.delete(task.video.path); state.thumbInFlight -= 1; pumpThumbs();
    });
  }
}

function setPreview(video, framePath) {
  state.activeVideo = video;
  if (framePath) { $('previewImage').src = toFileUrl(framePath); $('previewImage').style.display = 'block'; $('previewPlaceholder').style.display = 'none'; }
  if (state.settings.logoPath) { $('logoOverlay').src = toFileUrl(state.settings.logoPath); $('logoOverlay').style.display = 'block'; }
}

function positionLogo() {
  const s = state.settings || {}; const logo = $('logoOverlay'); if (!logo) return;
  const width = clamp(numeric(s.logoWidth, .22), .05, .8);
  const x = clamp(numeric(s.logoX, .74), 0, 1 - width);
  const y = clamp(numeric(s.logoY, .05), 0, .94);
  logo.style.left = `${x * 100}%`; logo.style.top = `${y * 100}%`;
  logo.style.width = `${width * 100}%`; logo.style.opacity = clamp(numeric(s.opacity, 1), .05, 1);
  logo.style.transform = 'translate3d(0,0,0)';
  const pos = `${Math.round(x * 100)}%, ${Math.round(y * 100)}%`;
  if ($('logoPositionValue')) $('logoPositionValue').textContent = pos;
}

function updateSetting(key, value) { state.settings[key] = value; window.primeAPI.saveSettings(state.settings); }

async function chooseInput() {
  const folder = await window.primeAPI.chooseFolder('input'); if (!folder) return;
  state.inputPath = folder; $('inputPath').value = folder; setStatus('Klasör taranıyor…', true);
  try {
    state.videos = await window.primeAPI.scanFolder(folder);
    renderVideoList(); setStatus('Hazır');
    showToast(state.videos.length ? `${state.videos.length} video akıllı kuyruğa eklendi` : 'Bu klasörde desteklenen video bulunamadı');
  } catch (error) {
    window.primeAPI.reportError({ message: 'Klasör taranamadı', stack: error?.stack }); setStatus('Onarım gerekli'); showToast('Klasör taranamadı. Sistem onarımı deneniyor.'); await autoRepair(true);
  }
}
async function chooseOutput() { const folder = await window.primeAPI.chooseFolder('output'); if (!folder) return; state.settings.outputPath = folder; updateSetting('outputPath', folder); applySettingsToUI(); showToast('Çıktı klasörü kaydedildi'); }
async function chooseLogo() { const logo = await window.primeAPI.chooseLogo(); if (!logo) return; state.settings.logoPath = logo; updateSetting('logoPath', logo); applySettingsToUI(); $('logoOverlay').style.display = 'block'; showToast('Logo güncellendi · Ön izlemede istediğin yere taşı'); }

function applyQueueData(item, data) {
  if (!item) return;
  const stateEl = item.querySelector('.queue-state'); const bar = item.querySelector('.progress-bar i'); const percent = item.querySelector('.queue-percent');
  percent.textContent = `${data.progress || 0}%`; bar.style.width = `${data.progress || 0}%`;
  stateEl.textContent = data.status === 'skipped' ? 'Atlandı · Daha önce işlendi' : data.status === 'error' ? 'Otomatik onarım denenecek' : data.message || 'İşleniyor';
  const className = data.status === 'done' ? 'done' : data.status === 'skipped' ? 'skipped' : data.status === 'processing' ? 'processing' : data.status === 'error' ? 'error' : 'wait';
  stateEl.className = `queue-state state-${className}`;
  bar.style.background = data.status === 'done' ? '#58c835' : data.status === 'skipped' ? '#738795' : data.status === 'error' ? '#e05656' : '';
}
function updateQueue(data) {
  if (Number.isFinite(data.index)) state.queueProgress.set(data.index, data);
  applyQueueData(document.querySelector(`[data-queue="${data.index}"]`), data);
}

function updateBanner(title, message, action, actionText) {
  $('updateBanner').classList.remove('hidden'); $('updateTitle').textContent = title; $('updateMessage').textContent = message;
  const button = $('updateActionBtn'); button.dataset.action = action || ''; button.textContent = actionText || 'Kapat'; button.disabled = !action;
}
function handleUpdateStatus(data) {
  if (!data) return;
  if (data.type === 'checking') { $('checkUpdateBtn').disabled = true; updateBanner('Güncellemeler kontrol ediliyor', 'Sürüm sunucusu güvenli şekilde kontrol ediliyor…', '', 'Kontrol ediliyor'); }
  if (data.type === 'available') { $('checkUpdateBtn').disabled = false; updateBanner('Yeni sürüm bulundu', `v${data.version} hazır. İndirmek ister misin?`, 'download', 'Güncellemeyi İndir'); showToast(`Yeni sürüm v${data.version} bulundu`); }
  if (data.type === 'downloading') updateBanner('Güncelleme indiriliyor', `%${data.percent || 0} tamamlandı. Uygulamayı kullanmaya devam edebilirsin.`, '', `%${data.percent || 0}`);
  if (data.type === 'downloaded') updateBanner('Güncelleme hazır', `v${data.version} yeniden başlatınca kurulacak.`, 'install', 'Yeniden Başlat ve Güncelle');
  if (data.type === 'not-available') { $('checkUpdateBtn').disabled = false; $('updateBanner').classList.add('hidden'); showToast('Uygulama güncel'); }
  if (data.type === 'error') { $('checkUpdateBtn').disabled = false; $('updateBanner').classList.add('hidden'); showToast(data.message || 'Güncelleme şu an kontrol edilemedi.'); }
}

function renderHealth(result) {
  if (!result) return;
  state.health = result;
  $('healthSummary').textContent = result.summary || 'Sistem kontrol edildi.';
  const orb = $('healthOrb'); orb.classList.toggle('warn', result.failed > 0 && result.failed < 3); orb.classList.toggle('bad', result.failed >= 3); orb.querySelector('span').textContent = result.ok ? '✓' : '!';
  $('healthGrid').innerHTML = (result.checks || []).map(check => `<div class="health-item ${check.ok ? 'ok' : 'bad'}"><div class="health-item-head"><span class="health-item-dot"></span>${esc(check.label)}</div><small>${esc(check.detail || (check.ok ? 'Hazır' : 'Kontrol gerekli'))}</small></div>`).join('');
}
async function autoRepair(silent = false) {
  const button = $('repairBtn'); if (button) { button.disabled = true; button.innerHTML = '<span>↻</span> SİSTEM TARANIYOR…'; }
  $('healthSummary').textContent = 'Bileşenler kontrol ediliyor, güvenli düzeltmeler uygulanıyor…';
  try { const result = await window.primeAPI.repairSystem(); renderHealth(result); if (!silent) showToast(result.ok ? 'Sistem tarandı ve hazırlandı' : result.summary); }
  catch (error) { window.primeAPI.reportError({ message: 'Otomatik onarım başarısız', stack: error?.stack }); showToast('Sistem onarımı tamamlanamadı. Teknik kayıt tutuldu.'); }
  finally { if (button) { button.disabled = false; button.innerHTML = '<span>✦</span> SİSTEMİ TARA VE ONAR'; } }
}

async function startProcessing() {
  if (state.processing) return;
  if (!state.videos.length) return showToast('Önce bir video klasörü seç');
  if (!state.settings.logoPath) return showToast('Önce bir logo seç');
  state.processing = true; $('startBtn').disabled = true; $('stopBtn').disabled = false; setStatus('İşlem sürüyor…', true);
  try { await window.primeAPI.processVideos({ videos: state.videos, settings: state.settings }); state.history = (await window.primeAPI.getInitialState()).history; renderHistory(); showToast('Seri işlem tamamlandı'); setStatus('Tamamlandı'); }
  catch (error) { window.primeAPI.reportError({ message: 'Video işleme hatası', stack: error?.stack }); showToast('Video işlenemedi. Sistem onarımı ve tekrar deneme öneriliyor.'); setStatus('Onarım gerekli'); await autoRepair(true); }
  finally { state.processing = false; $('startBtn').disabled = false; $('stopBtn').disabled = true; }
}
function renderHistory() {
  $('historyList').innerHTML = state.history.length ? [...state.history].reverse().map(item => `<div class="history-row"><span>${esc(item.name)}</span><span>${new Date(item.processedAt).toLocaleString('tr-TR')}</span><a title="${esc(item.outputPath)}">${esc(shortPath(item.outputPath))}</a></div>`).join('') : '<div class="empty-state compact"><span class="empty-orbit">◔</span><strong>Henüz kayıt yok</strong><small>İşlenen videolar burada tutulur.</small></div>';
}
function setPage(page) { document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page)); document.querySelectorAll('.page').forEach(item => item.classList.remove('active-page')); $(`${page}Page`).classList.add('active-page'); if (page === 'history') renderHistory(); }
function presetPosition(pos) {
  const s = state.settings; const width = numeric(s.logoWidth, .22); const margin = numeric(s.margin, .04);
  s.logoX = pos.includes('right') ? 1 - width - margin : margin; s.logoY = pos.includes('bottom') ? 1 - width * .65 - margin : margin;
  document.querySelectorAll('.preset').forEach(btn => btn.classList.toggle('active', btn.dataset.pos === pos)); positionLogo(); window.primeAPI.saveSettings(s);
}
function setupDrag() {
  const logo = $('logoOverlay'); const stage = $('previewStage'); if (!logo || !stage) return;
  logo.addEventListener('pointerdown', event => {
    event.preventDefault(); const rect = stage.getBoundingClientRect();
    state.drag = { startX: event.clientX, startY: event.clientY, x: numeric(state.settings.logoX, .74), y: numeric(state.settings.logoY, .05), rect };
    logo.setPointerCapture(event.pointerId); logo.classList.add('dragging'); stage.classList.add('logo-editing');
  });
  logo.addEventListener('pointermove', event => {
    if (!state.drag) return; const { rect } = state.drag; const dx = (event.clientX - state.drag.startX) / rect.width; const dy = (event.clientY - state.drag.startY) / rect.height; const width = numeric(state.settings.logoWidth, .22);
    state.settings.logoX = clamp(state.drag.x + dx, 0, 1 - width); state.settings.logoY = clamp(state.drag.y + dy, 0, .94); positionLogo();
  });
  const end = () => { if (!state.drag) return; state.drag = null; logo.classList.remove('dragging'); stage.classList.remove('logo-editing'); window.primeAPI.saveSettings(state.settings); showToast('Logo konumu kaydedildi'); };
  logo.addEventListener('pointerup', end); logo.addEventListener('pointercancel', end);
}

$('chooseInput').addEventListener('click', chooseInput); $('chooseLogo').addEventListener('click', chooseLogo); $('chooseLogoSettings').addEventListener('click', chooseLogo); $('chooseOutput').addEventListener('click', chooseOutput); $('startBtn').addEventListener('click', startProcessing); $('stopBtn').addEventListener('click', async () => { await window.primeAPI.stopProcessing(); showToast('İşlem güvenli şekilde durduruluyor…'); });
$('sizeSlider').addEventListener('input', e => { state.settings.logoWidth = Number(e.target.value) / 100; $('sizeValue').textContent = `${e.target.value}%`; updateRangeFill(e.target); positionLogo(); }); $('sizeSlider').addEventListener('change', () => window.primeAPI.saveSettings(state.settings));
$('opacitySlider').addEventListener('input', e => { state.settings.opacity = Number(e.target.value) / 100; $('opacityValue').textContent = `${e.target.value}%`; updateRangeFill(e.target); positionLogo(); }); $('opacitySlider').addEventListener('change', () => window.primeAPI.saveSettings(state.settings));
document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => presetPosition(btn.dataset.pos))); document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
$('videoList').addEventListener('scroll', renderVideoWindow, { passive: true }); $('queueList').addEventListener('scroll', renderQueueWindow, { passive: true });
$('videoList').addEventListener('click', event => { const row = event.target.closest('.video-row'); if (!row) return; const index = Number(row.dataset.index); const video = state.videos[index]; if (video) setPreview(video, state.thumbCache.get(video.path)); if (video && !state.thumbCache.has(video.path)) loadThumb(video, index); });
$('clearHistory').addEventListener('click', async () => { state.history = await window.primeAPI.clearHistory(); renderHistory(); showToast('İşlem geçmişi temizlendi'); });
$('openReleasePage').addEventListener('click', async () => { await window.primeAPI.openReleasePage(); showToast('GitHub Releases sayfası açıldı'); });
$('checkUpdateBtn').addEventListener('click', async () => { $('checkUpdateBtn').disabled = true; const result = await window.primeAPI.checkForUpdates(); if (result?.status === 'dev') { $('checkUpdateBtn').disabled = false; showToast('Otomatik kontrol kurulu EXE sürümünde çalışır.'); } });
$('updateActionBtn').addEventListener('click', async () => { const action = $('updateActionBtn').dataset.action; if (action === 'download') await window.primeAPI.downloadUpdate(); if (action === 'install') await window.primeAPI.installUpdate(); }); $('closeUpdateBanner').addEventListener('click', () => $('updateBanner').classList.add('hidden'));
$('repairBtn').addEventListener('click', () => autoRepair(false)); $('openLogsBtn').addEventListener('click', () => window.primeAPI.openLogs());
window.primeAPI.onProgress(updateQueue); window.primeAPI.onUpdateStatus(handleUpdateStatus); window.primeAPI.onHealthStatus(renderHealth);
window.addEventListener('error', event => { window.primeAPI.reportError({ message: event.message, stack: event.error?.stack }); showToast('Arayüz kendini toparlamaya çalışıyor.'); });
window.addEventListener('unhandledrejection', event => { window.primeAPI.reportError({ message: String(event.reason), stack: event.reason?.stack }); showToast('Beklenmeyen bir işlem hatası kaydedildi.'); });

(async () => {
  try {
    const initial = await window.primeAPI.getInitialState(); state.settings = initial.settings || {}; state.history = initial.history || []; state.health = initial.health || null;
    applySettingsToUI(); renderHistory(); renderHealth(state.health); setupDrag();
    const version = initial.version || await window.primeAPI.getAppVersion(); $('versionText').textContent = `Mevcut sürüm: v${version} · Yeni sürümler otomatik kontrol edilir.`;
    if (state.health && !state.health.ok) setTimeout(() => autoRepair(true), 900);
  } catch (error) { window.primeAPI.reportError({ message: 'Başlangıç durumu yüklenemedi', stack: error?.stack }); showToast('Uygulama başlatılırken sorun oluştu; sistem onarılıyor.'); setTimeout(() => autoRepair(true), 800); }
})();
