const state = {
  settings: {},
  history: [],
  videos: [],
  processing: false,
  activeVideo: null,
  drag: null
};

const $ = id => document.getElementById(id);
const toFileUrl = value => {
  if (!value) return '';
  const normalized = String(value).replace(/\\/g, '/');
  return encodeURI(normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`);
};
const shortPath = value => value ? (value.length > 48 ? `…${value.slice(-45)}` : value) : '';
const showToast = message => {
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
};

function setStatus(message, busy = false) {
  $('topStatus').textContent = message;
  $('readyChip').textContent = message;
  $('footerStatus').textContent = busy ? 'İşlem sürüyor' : 'Kayıt aktif';
  document.querySelectorAll('.status-dot').forEach(dot => { dot.style.background = busy ? '#f5b91c' : '#66d52e'; dot.style.boxShadow = busy ? '0 0 10px rgba(245,185,28,.65)' : '0 0 10px rgba(102,213,46,.65)'; });
}

function applySettingsToUI() {
  const s = state.settings;
  $('inputPath').value = state.inputPath || '';
  $('outputPathText').textContent = shortPath(s.outputPath || 'Masaüstü\\Edilmiş Videolar');
  $('outputSettingPath').textContent = s.outputPath || 'Masaüstü\\Edilmiş Videolar';
  $('logoSettingPath').textContent = s.logoPath || 'Varsayılan logo';
  $('sizeSlider').value = Math.round((Number(s.logoWidth) || .22) * 100);
  $('opacitySlider').value = Math.round((Number(s.opacity) || 1) * 100);
  $('sizeValue').textContent = `${$('sizeSlider').value}%`;
  $('opacityValue').textContent = `${$('opacitySlider').value}%`;
  positionLogo();
  if (s.logoPath) $('logoOverlay').src = toFileUrl(s.logoPath);
}

function renderVideoList() {
  $('videoCount').textContent = `${state.videos.length} video`;
  $('scanText').textContent = state.videos.length ? 'İşleme hazır' : 'Video bulunamadı';
  $('queueCount').textContent = state.videos.length;
  $('videoList').innerHTML = state.videos.length ? state.videos.map((video, index) => `<div class="video-row" data-index="${index}"><img class="video-thumb" id="thumb-${index}" alt=""><span title="${video.name}">${video.name}</span></div>`).join('') : '<div class="empty-state"><span>◌</span><strong>Henüz video seçilmedi</strong><small>MP4, MOV, MKV, AVI veya WEBM</small></div>';
  $('queueList').innerHTML = state.videos.length ? state.videos.map((video, index) => `<div class="queue-item" data-queue="${index}"><div class="queue-title"><strong title="${video.name}">${video.name}</strong><span class="queue-percent">0%</span></div><div class="queue-state state-wait">Bekliyor</div><div class="progress-bar"><i></i></div></div>`).join('') : '<div class="empty-state compact"><span>☷</span><strong>Kuyruk boş</strong><small>Video klasörü seçildiğinde burada görünür.</small></div>';
  state.videos.forEach((video, index) => loadThumb(video, index));
}

async function loadThumb(video, index) {
  try { const frame = await window.primeAPI.previewFrame(video.path); if (frame) { const el = $(`thumb-${index}`); if (el) el.src = toFileUrl(frame); if (index === 0) setPreview(video, frame); } }
  catch { /* ön izleme olmadan da işlem devam eder */ }
}
function setPreview(video, framePath) {
  state.activeVideo = video;
  if (framePath) { $('previewImage').src = toFileUrl(framePath); $('previewImage').style.display = 'block'; $('previewPlaceholder').style.display = 'none'; }
  if (state.settings.logoPath) { $('logoOverlay').src = toFileUrl(state.settings.logoPath); $('logoOverlay').style.display = 'block'; }
}
function positionLogo() {
  const s = state.settings;
  const logo = $('logoOverlay');
  logo.style.left = `${Math.max(0, Math.min(.94, Number(s.logoX) || .74)) * 100}%`;
  logo.style.top = `${Math.max(0, Math.min(.94, Number(s.logoY) || .05)) * 100}%`;
  logo.style.width = `${Math.max(.05, Math.min(.8, Number(s.logoWidth) || .22)) * 100}%`;
  logo.style.opacity = Number(s.opacity) || 1;
}
function updateSetting(key, value) { state.settings[key] = value; window.primeAPI.saveSettings(state.settings); }

async function chooseInput() {
  const folder = await window.primeAPI.chooseFolder('input');
  if (!folder) return;
  state.inputPath = folder; $('inputPath').value = folder; setStatus('Klasör taranıyor…', true);
  state.videos = await window.primeAPI.scanFolder(folder); renderVideoList(); setStatus('Hazır');
  if (state.videos.length) showToast(`${state.videos.length} video kuyruğa eklendi`); else showToast('Bu klasörde desteklenen video bulunamadı');
}
async function chooseOutput() {
  const folder = await window.primeAPI.chooseFolder('output');
  if (!folder) return;
  state.settings.outputPath = folder; updateSetting('outputPath', folder); applySettingsToUI(); showToast('Çıktı klasörü kaydedildi');
}
async function chooseLogo() {
  const logo = await window.primeAPI.chooseLogo();
  if (!logo) return;
  state.settings.logoPath = logo; updateSetting('logoPath', logo); applySettingsToUI(); $('logoOverlay').style.display = 'block'; showToast('Logo güncellendi');
}

function updateQueue(data) {
  const item = document.querySelector(`[data-queue="${data.index}"]`); if (!item) return;
  const stateEl = item.querySelector('.queue-state'); const bar = item.querySelector('.progress-bar i'); const percent = item.querySelector('.queue-percent');
  percent.textContent = `${data.progress || 0}%`; bar.style.width = `${data.progress || 0}%`;
  stateEl.textContent = data.message || 'İşleniyor'; stateEl.className = `queue-state state-${data.status === 'done' ? 'done' : data.status === 'skipped' ? 'skipped' : data.status === 'processing' ? 'processing' : 'wait'}`;
  if (data.status === 'done') bar.style.background = '#58c835';
  if (data.status === 'skipped') { bar.style.background = '#738795'; stateEl.textContent = 'Atlandı · Daha önce işlendi'; }
  if (data.status === 'error') { bar.style.background = '#e05656'; stateEl.textContent = `Hata: ${data.message || 'İşlenemedi'}`; }
}

function updateBanner(title, message, action, actionText) {
  $('updateBanner').classList.remove('hidden'); $('updateTitle').textContent = title; $('updateMessage').textContent = message;
  const button = $('updateActionBtn'); button.dataset.action = action || ''; button.textContent = actionText || 'Kapat'; button.disabled = !action;
}
function handleUpdateStatus(data) {
  if (data.type === 'checking') { $('checkUpdateBtn').disabled = true; updateBanner('Güncellemeler kontrol ediliyor', 'GitHub Releases bağlantısı kontrol ediliyor…', '', 'Kontrol ediliyor'); }
  if (data.type === 'available') { $('checkUpdateBtn').disabled = false; updateBanner('Yeni sürüm bulundu', `v${data.version} hazır. İndirmek ister misin?`, 'download', 'Güncellemeyi İndir'); showToast(`Yeni sürüm v${data.version} bulundu`); }
  if (data.type === 'downloading') { updateBanner('Güncelleme indiriliyor', `%${data.percent || 0} tamamlandı. İşlem devam edebilir.`, '', `%${data.percent || 0}`); }
  if (data.type === 'downloaded') { updateBanner('Güncelleme hazır', `v${data.version} kurulduktan sonra uygulama yeniden başlayacak.`, 'install', 'Yeniden Başlat ve Güncelle'); }
  if (data.type === 'not-available') { $('checkUpdateBtn').disabled = false; $('updateBanner').classList.add('hidden'); showToast('Uygulama güncel'); }
  if (data.type === 'error') { $('checkUpdateBtn').disabled = false; $('updateBanner').classList.add('hidden'); showToast(`Güncelleme kontrolü başarısız: ${data.message || 'Bilinmeyen hata'}`); }
}
async function startProcessing() {
  if (state.processing) return;
  if (!state.videos.length) return showToast('Önce bir video klasörü seç');
  if (!state.settings.logoPath) return showToast('Önce bir logo seç');
  state.processing = true; $('startBtn').disabled = true; $('stopBtn').disabled = false; setStatus('İşlem sürüyor…', true);
  try { await window.primeAPI.processVideos({ videos: state.videos, settings: state.settings }); state.history = (await window.primeAPI.getInitialState()).history; renderHistory(); showToast('Seri işlem tamamlandı'); setStatus('Tamamlandı'); }
  catch (error) { showToast(`İşlem hatası: ${error.message || error}`); setStatus('Hata oluştu'); }
  finally { state.processing = false; $('startBtn').disabled = false; $('stopBtn').disabled = true; }
}
function renderHistory() {
  $('historyList').innerHTML = state.history.length ? [...state.history].reverse().map(item => `<div class="history-row"><span>${item.name}</span><span>${new Date(item.processedAt).toLocaleString('tr-TR')}</span><a title="${item.outputPath}">${shortPath(item.outputPath)}</a></div>`).join('') : '<div class="empty-state compact"><span>◔</span><strong>Henüz kayıt yok</strong><small>İşlenen videolar burada tutulur.</small></div>';
}
function setPage(page) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  document.querySelectorAll('.page').forEach(item => item.classList.remove('active-page'));
  $(`${page}Page`).classList.add('active-page');
  if (page === 'history') renderHistory();
}
function presetPosition(pos) {
  const s = state.settings; const width = Number(s.logoWidth) || .22; const margin = Number(s.margin) || .04;
  s.logoX = pos.includes('right') ? 1 - width - margin : margin; s.logoY = pos.includes('bottom') ? 1 - width * .65 - margin : margin;
  document.querySelectorAll('.preset').forEach(btn => btn.classList.toggle('active', btn.dataset.pos === pos)); positionLogo(); window.primeAPI.saveSettings(s);
}
function setupDrag() {
  const logo = $('logoOverlay'); const stage = $('previewStage');
  logo.addEventListener('pointerdown', event => { event.preventDefault(); const rect = stage.getBoundingClientRect(); state.drag = { startX: event.clientX, startY: event.clientY, x: Number(state.settings.logoX) || .74, y: Number(state.settings.logoY) || .05, rect }; logo.setPointerCapture(event.pointerId); logo.classList.add('dragging'); });
  logo.addEventListener('pointermove', event => { if (!state.drag) return; const { rect } = state.drag; const dx = (event.clientX - state.drag.startX) / rect.width; const dy = (event.clientY - state.drag.startY) / rect.height; const width = Number(state.settings.logoWidth) || .22; state.settings.logoX = Math.max(0, Math.min(1 - width, state.drag.x + dx)); state.settings.logoY = Math.max(0, Math.min(.93, state.drag.y + dy)); positionLogo(); });
  const end = () => { if (!state.drag) return; state.drag = null; logo.classList.remove('dragging'); window.primeAPI.saveSettings(state.settings); };
  logo.addEventListener('pointerup', end); logo.addEventListener('pointercancel', end);
}

$('chooseInput').addEventListener('click', chooseInput); $('chooseLogo').addEventListener('click', chooseLogo); $('chooseLogoSettings').addEventListener('click', chooseLogo); $('chooseOutput').addEventListener('click', chooseOutput); $('startBtn').addEventListener('click', startProcessing); $('stopBtn').addEventListener('click', async () => { await window.primeAPI.stopProcessing(); showToast('İşlem durduruluyor…'); });
$('sizeSlider').addEventListener('input', e => { state.settings.logoWidth = Number(e.target.value) / 100; $('sizeValue').textContent = `${e.target.value}%`; positionLogo(); });
$('sizeSlider').addEventListener('change', () => window.primeAPI.saveSettings(state.settings));
$('opacitySlider').addEventListener('input', e => { state.settings.opacity = Number(e.target.value) / 100; $('opacityValue').textContent = `${e.target.value}%`; positionLogo(); });
$('opacitySlider').addEventListener('change', () => window.primeAPI.saveSettings(state.settings));
document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => presetPosition(btn.dataset.pos)));
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
$('clearHistory').addEventListener('click', async () => { state.history = await window.primeAPI.clearHistory(); renderHistory(); showToast('İşlem geçmişi temizlendi'); });
$('openReleasePage').addEventListener('click', async () => { await window.primeAPI.openReleasePage(); showToast('GitHub Releases sayfası açıldı'); });
$('checkUpdateBtn').addEventListener('click', async () => { $('checkUpdateBtn').disabled = true; const result = await window.primeAPI.checkForUpdates(); if (result?.status === 'dev') { $('checkUpdateBtn').disabled = false; showToast('Geliştirme sürümünde otomatik kontrol yalnızca kurulu EXE ile çalışır'); } });
$('updateActionBtn').addEventListener('click', async () => { const action = $('updateActionBtn').dataset.action; if (action === 'download') await window.primeAPI.downloadUpdate(); if (action === 'install') await window.primeAPI.installUpdate(); });
$('closeUpdateBanner').addEventListener('click', () => $('updateBanner').classList.add('hidden'));
window.primeAPI.onProgress(updateQueue);
window.primeAPI.onUpdateStatus(handleUpdateStatus);

(async () => {
  const initial = await window.primeAPI.getInitialState(); state.settings = initial.settings || {}; state.history = initial.history || [];
  applySettingsToUI(); renderHistory(); setupDrag();
  const version = initial.version || await window.primeAPI.getAppVersion(); $('versionText').textContent = `Mevcut sürüm: v${version} · Yeni sürümler otomatik kontrol edilir.`;
})();
