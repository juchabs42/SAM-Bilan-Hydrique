'use strict';

const SOIL_CLASSES = [
  { name: 'Sable', clayMin: 0, clayMax: 10, siltMin: 0, siltMax: 10, rum: 0.70 },
  { name: 'Sable limoneux', clayMin: 0, clayMax: 15, siltMin: 10, siltMax: 30, rum: 1.00 },
  { name: 'Sable argileux', clayMin: 10, clayMax: 25, siltMin: 0, siltMax: 20, rum: 1.35 },
  { name: 'Argilo-sableux', clayMin: 25, clayMax: 45, siltMin: 0, siltMax: 30, rum: 1.70 },
  { name: 'Argile', clayMin: 30, clayMax: 45, siltMin: 30, siltMax: 50, rum: 1.75 },
  { name: 'Argilo-limoneux', clayMin: 30, clayMax: 45, siltMin: 50, siltMax: 70, rum: 1.80 },
  { name: 'Argile lourde', clayMin: 45, clayMax: 100, siltMin: 0, siltMax: 60, rum: 1.65 },
  { name: 'Limon sableux', clayMin: 10, clayMax: 25, siltMin: 30, siltMax: 50, rum: 1.45 },
  { name: 'Limon sableux argileux', clayMin: 20, clayMax: 35, siltMin: 30, siltMax: 50, rum: 1.65 },
  { name: 'Limon argilo-sableux', clayMin: 20, clayMax: 35, siltMin: 50, siltMax: 70, rum: 1.75 },
  { name: 'Limon moyen sableux', clayMin: 10, clayMax: 25, siltMin: 50, siltMax: 80, rum: 1.60 },
  { name: 'Limon moyen', clayMin: 10, clayMax: 25, siltMin: 70, siltMax: 90, rum: 1.75 },
  { name: 'Limon fin sableux', clayMin: 0, clayMax: 15, siltMin: 50, siltMax: 70, rum: 1.20 },
  { name: 'Limon fin', clayMin: 0, clayMax: 15, siltMin: 70, siltMax: 100, rum: 1.30 },
  { name: 'Limon argileux', clayMin: 20, clayMax: 35, siltMin: 70, siltMax: 90, rum: 1.95 }
];

const STANDARD_KC = {
  noCover: { initial: 0.60, mid: 0.95, end: 0.75 },
  cover: { initial: 0.80, mid: 1.20, end: 0.85 }
};

const state = {
  supabase: null,
  user: null,
  parcels: [],
  activeParcel: null,
  irrigations: [],
  rainCorrections: [],
  weather: [],
  balance: [],
  chart: null,
  selectedLocation: null,
  editingIrrigation: null,
  deferredInstallPrompt: null,
  selectedSeasonYear: null,
  loadedWeatherSeasonYear: null,
  selectedIrrigationIds: new Set()
};

const $ = (id) => document.getElementById(id);
const qsa = (selector) => [...document.querySelectorAll(selector)];

function localToday() {
  return new Date();
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISO(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function fmtDate(iso) {
  return parseISO(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtShort(iso) {
  return parseISO(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function setMessage(id, text = '', type = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `form-message ${type}`.trim();
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function isSupabaseConfigured() {
  const cfg = window.SAM_CONFIG || {};
  return cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('VOTRE-PROJET') && !cfg.supabaseAnonKey.includes('VOTRE_CLE');
}

function getCurrentSeasonYear(date = localToday()) {
  return date.getMonth() >= 2 ? date.getFullYear() : date.getFullYear() - 1;
}

function getSeasonStart(year = getCurrentSeasonYear()) {
  return new Date(Number(year), 2, 1, 12);
}

function getSeasonEnd(year = getCurrentSeasonYear()) {
  return new Date(Number(year), 9, 31, 12);
}

function isCurrentSeasonYear(year) {
  return Number(year) === getCurrentSeasonYear();
}

function standardKcForCover(covered) {
  return covered ? STANDARD_KC.cover : STANDARD_KC.noCover;
}

function findSoilClass(clay, silt) {
  // Reprend la règle du classeur Excel : premier résultat dont min <= valeur < max.
  return SOIL_CLASSES.find(row =>
    clay >= row.clayMin && clay < row.clayMax && silt >= row.siltMin && silt < row.siltMax
  ) || null;
}

function interpolation(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function kcForDate(iso, parcel) {
  const d = parseISO(iso);
  const y = d.getFullYear();
  const md = (m, day) => new Date(y, m - 1, day, 12);
  const initial = Number(parcel.kc_initial);
  const mid = Number(parcel.kc_mid);
  const end = Number(parcel.kc_end);

  if (d >= md(3, 1) && d <= md(4, 30)) return initial;
  if (d >= md(5, 1) && d <= md(5, 31)) {
    const t = (d - md(5, 1)) / (md(5, 31) - md(5, 1));
    return interpolation(initial, mid, t);
  }
  if (d >= md(6, 1) && d <= md(8, 10)) return mid;
  if (d >= md(8, 11) && d <= md(9, 30)) {
    const t = (d - md(8, 11)) / (md(9, 30) - md(8, 11));
    return interpolation(mid, end, t);
  }
  if (d >= md(10, 1) && d <= md(10, 31)) return end;
  return 0;
}

function setupPwa() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 800;
  if (mobile && !standalone) $('installCard').classList.remove('hidden');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    if (mobile && !standalone) $('installCard').classList.remove('hidden');
  });

  $('installBtn').addEventListener('click', async () => {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
    } else {
      toast('Dans le menu du navigateur, choisissez « Ajouter à l’écran d’accueil » / « Installer l’application ».');
    }
  });

  window.addEventListener('appinstalled', () => $('installCard').classList.add('hidden'));
}

function bindEvents() {
  $('authToggle').addEventListener('click', () => $('authCard').classList.toggle('hidden'));
  $('loginBtn').addEventListener('click', login);
  $('logoutBtn').addEventListener('click', logout);

  qsa('.tab').forEach(btn => btn.addEventListener('click', () => openTab(btn.dataset.tab)));
  qsa('[data-open-parcel]').forEach(btn => btn.addEventListener('click', () => openNewParcel()));
  $('newParcelBtn').addEventListener('click', openNewParcel);
  $('parcelSelect').addEventListener('change', () => activateParcel($('parcelSelect').value));
  $('seasonSelect').addEventListener('change', async () => {
    state.selectedSeasonYear = Number($('seasonSelect').value || getCurrentSeasonYear());
    state.loadedWeatherSeasonYear = null;
    await refreshBalance(true);
  });

  $('searchLocationBtn').addEventListener('click', searchLocation);
  $('locationSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchLocation(); } });
  $('geolocateBtn').addEventListener('click', geolocate);

  ['clayPct', 'siltPct', 'sandPct', 'rootDepth'].forEach(id => $(id).addEventListener('input', updateSoilPreview));
  $('groundCover').addEventListener('change', updateKcDefaults);
  $('customKc').addEventListener('change', () => {
    $('kcFields').classList.toggle('hidden', !$('customKc').checked);
    if (!$('customKc').checked) updateKcDefaults();
  });
  $('saveParcelBtn').addEventListener('click', saveParcel);
  $('deleteParcelBtn').addEventListener('click', deleteParcel);

  $('repeatIrrigation').addEventListener('change', () => $('repeatOptions').classList.toggle('hidden', !$('repeatIrrigation').checked));
  $('irrigationAmount').addEventListener('input', updateIrrigationConversion);
  $('saveIrrigationBtn').addEventListener('click', saveIrrigation);
  $('selectAllIrrigation').addEventListener('change', toggleAllIrrigations);
  $('deleteSelectedIrrigationBtn').addEventListener('click', deleteSelectedIrrigations);

  $('cancelModalBtn').addEventListener('click', closeIrrigationModal);
  $('modalBackdrop').addEventListener('click', e => { if (e.target === $('modalBackdrop')) closeIrrigationModal(); });
  $('saveEditIrrigationBtn').addEventListener('click', saveEditedIrrigation);

  $('periodSelect').addEventListener('change', renderDashboard);
  $('refreshBtn').addEventListener('click', () => refreshBalance(true));
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportXlsxBtn').addEventListener('click', exportXlsx);

  $('rainCorrectionDate').addEventListener('change', updateRainCorrectionInfo);
  $('saveRainCorrectionBtn').addEventListener('click', saveRainCorrection);
  $('deleteRainCorrectionBtn').addEventListener('click', deleteRainCorrection);
}

function openTab(name) {
  qsa('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  qsa('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
}

async function init() {
  setupPwa();
  bindEvents();
  const today = toISO(localToday());
  $('irrigationDate').value = today;
  $('irrigationDate').max = today;
  $('repeatEndDate').value = today;
  $('repeatEndDate').max = today;
  $('rainCorrectionDate').value = today;
  $('rainCorrectionDate').max = today;

  if (!isSupabaseConfigured()) {
    $('configWarning').classList.remove('hidden');
    $('authCard').classList.remove('hidden');
    setMessage('authMessage', 'Complétez d’abord config.js.', 'error');
    return;
  }

  state.supabase = window.supabase.createClient(window.SAM_CONFIG.supabaseUrl, window.SAM_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const { data: { session } } = await state.supabase.auth.getSession();
  await handleSession(session);
  state.supabase.auth.onAuthStateChange(async (_event, sessionNow) => handleSession(sessionNow));
}

async function handleSession(session) {
  state.user = session?.user || null;
  if (!state.user) {
    $('loggedOutPanel').classList.remove('hidden');
    $('loggedInPanel').classList.add('hidden');
    $('appArea').classList.add('hidden');
    $('authCard').classList.remove('hidden');
    return;
  }

  $('loggedOutPanel').classList.add('hidden');
  $('loggedInPanel').classList.remove('hidden');
  $('userEmail').textContent = state.user.email || '';
  $('appArea').classList.remove('hidden');
  $('authCard').classList.add('hidden');
  setMessage('authMessage', '');
  await loadParcels();
}

async function login() {
  if (!state.supabase) return;
  const email = $('emailInput').value.trim();
  const password = $('passwordInput').value;
  if (!email || !password) return setMessage('authMessage', 'Renseignez l’email et le mot de passe.', 'error');
  setMessage('authMessage', 'Connexion…');
  const { error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) setMessage('authMessage', error.message, 'error');
}

async function logout() {
  if (state.supabase) await state.supabase.auth.signOut();
  state.parcels = [];
  state.activeParcel = null;
  state.balance = [];
}

async function loadParcels() {
  const { data, error } = await state.supabase.from('parcels').select('*').order('created_at', { ascending: true });
  if (error) {
    toast(`Erreur Supabase : ${error.message}`);
    return;
  }
  state.parcels = data || [];
  if (!state.selectedSeasonYear) state.selectedSeasonYear = getCurrentSeasonYear();
  renderParcelSelector();
  populateSeasonOptions();

  const stored = localStorage.getItem('samBilanActiveParcel');
  const target = state.parcels.find(p => p.id === stored) || state.parcels[0] || null;
  if (target) await activateParcel(target.id);
  else showNoParcel();
}

function renderParcelSelector() {
  const select = $('parcelSelect');
  select.innerHTML = '';
  if (!state.parcels.length) {
    const opt = document.createElement('option');
    opt.textContent = 'Aucune parcelle';
    opt.value = '';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  state.parcels.forEach(parcel => {
    const opt = document.createElement('option');
    opt.value = parcel.id;
    opt.textContent = parcel.name;
    select.appendChild(opt);
  });
}

function populateSeasonOptions() {
  const select = $('seasonSelect');
  const currentYear = getCurrentSeasonYear();
  const years = [];
  for (let year = currentYear; year >= currentYear - 5; year -= 1) years.push(year);
  if (!state.selectedSeasonYear) state.selectedSeasonYear = currentYear;
  if (!years.includes(Number(state.selectedSeasonYear))) years.unshift(Number(state.selectedSeasonYear));
  const seen = new Set();
  select.innerHTML = years.filter(y => {
    if (seen.has(y)) return false;
    seen.add(y);
    return true;
  }).map(year => {
    const selected = Number(year) === Number(state.selectedSeasonYear) ? ' selected' : '';
    return '<option value="' + year + '"' + selected + '>Saison ' + year + '</option>';
  }).join('');
}

function showNoParcel() {
  state.activeParcel = null;
  state.selectedSeasonYear = getCurrentSeasonYear();
  state.loadedWeatherSeasonYear = null;
  populateSeasonOptions();
  $('noParcelDashboard').classList.remove('hidden');
  $('dashboardContent').classList.add('hidden');
  $('noParcelIrrigation').classList.remove('hidden');
  $('irrigationContent').classList.add('hidden');
  resetParcelForm();
}

async function activateParcel(id) {
  const parcel = state.parcels.find(p => p.id === id);
  if (!parcel) return showNoParcel();
  state.activeParcel = parcel;
  state.weather = [];
  state.balance = [];
  state.selectedIrrigationIds = new Set();
  state.loadedWeatherSeasonYear = null;
  if (!state.selectedSeasonYear) state.selectedSeasonYear = getCurrentSeasonYear();
  populateSeasonOptions();
  localStorage.setItem('samBilanActiveParcel', id);
  $('parcelSelect').value = id;
  $('noParcelDashboard').classList.add('hidden');
  $('dashboardContent').classList.remove('hidden');
  $('noParcelIrrigation').classList.add('hidden');
  $('irrigationContent').classList.remove('hidden');
  fillParcelForm(parcel);
  await Promise.all([loadIrrigations(), loadRainCorrections()]);
  renderIrrigationList();
  updateIrrigationConversion();
  await refreshBalance(true);
}

function openNewParcel() {
  resetParcelForm();
  openTab('parcel');
}

function resetParcelForm() {
  state.selectedLocation = null;
  $('parcelFormTitle').textContent = 'Nouvelle parcelle';
  $('deleteParcelBtn').classList.add('hidden');
  ['parcelName','parcelArea','locationSearch','clayPct','siltPct','sandPct','rootDepth'].forEach(id => $(id).value = '');
  $('selectedLocation').textContent = 'Non définie';
  $('locationResults').innerHTML = '';
  $('groundCover').checked = false;
  $('customKc').checked = false;
  $('kcFields').classList.add('hidden');
  const kc = STANDARD_KC.noCover;
  $('kcInitial').value = kc.initial;
  $('kcMid').value = kc.mid;
  $('kcEnd').value = kc.end;
  $('soilClassResult').textContent = '—';
  $('rumResult').textContent = '—';
  $('ruResult').textContent = '—';
  $('rfuResult').textContent = '—';
  $('thresholdResult').textContent = '—';
  $('saveParcelBtn').dataset.editingId = '';
  setMessage('parcelMessage', '');
}

function fillParcelForm(parcel) {
  $('parcelFormTitle').textContent = `Parcelle — ${parcel.name}`;
  $('deleteParcelBtn').classList.remove('hidden');
  $('saveParcelBtn').dataset.editingId = parcel.id;
  $('parcelName').value = parcel.name;
  $('parcelArea').value = parcel.area_ha;
  state.selectedLocation = { name: parcel.location_name, latitude: Number(parcel.latitude), longitude: Number(parcel.longitude) };
  $('selectedLocation').textContent = `${parcel.location_name} (${Number(parcel.latitude).toFixed(4)}, ${Number(parcel.longitude).toFixed(4)})`;
  $('clayPct').value = parcel.clay_pct;
  $('siltPct').value = parcel.silt_pct;
  $('sandPct').value = parcel.sand_pct;
  $('rootDepth').value = parcel.root_depth_cm;
  $('groundCover').checked = !!parcel.ground_cover;
  $('customKc').checked = !!parcel.use_custom_kc;
  $('kcFields').classList.toggle('hidden', !parcel.use_custom_kc);
  $('kcInitial').value = parcel.kc_initial;
  $('kcMid').value = parcel.kc_mid;
  $('kcEnd').value = parcel.kc_end;
  updateSoilPreview();
}

async function searchLocation() {
  const name = $('locationSearch').value.trim();
  if (name.length < 2) return toast('Saisissez au moins 2 caractères.');
  $('locationResults').innerHTML = '<div class="muted small">Recherche…</div>';
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=fr&format=json&countryCode=FR`;
    const data = await fetchJson(url);
    const results = data.results || [];
    if (!results.length) {
      $('locationResults').innerHTML = '<div class="muted small">Aucun lieu trouvé.</div>';
      return;
    }
    $('locationResults').innerHTML = results.map((r, idx) => {
      const label = [r.name, r.admin2, r.admin1].filter(Boolean).join(', ');
      return `<div class="location-result"><span>${escapeHTML(label)}</span><button class="btn secondary" type="button" data-location-index="${idx}">Choisir</button></div>`;
    }).join('');
    qsa('[data-location-index]').forEach(btn => btn.addEventListener('click', () => {
      const r = results[Number(btn.dataset.locationIndex)];
      const label = [r.name, r.admin2, r.admin1].filter(Boolean).join(', ');
      state.selectedLocation = { name: label, latitude: r.latitude, longitude: r.longitude };
      $('selectedLocation').textContent = `${label} (${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)})`;
      $('locationResults').innerHTML = '';
    }));
  } catch (err) {
    $('locationResults').innerHTML = `<div class="form-message error">${escapeHTML(err.message)}</div>`;
  }
}

function geolocate() {
  if (!navigator.geolocation) return toast('La géolocalisation n’est pas disponible sur ce navigateur.');
  navigator.geolocation.getCurrentPosition(pos => {
    const latitude = pos.coords.latitude;
    const longitude = pos.coords.longitude;
    const name = `Position GPS ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    state.selectedLocation = { name, latitude, longitude };
    $('selectedLocation').textContent = name;
  }, err => toast(`Géolocalisation impossible : ${err.message}`), { enableHighAccuracy: true, timeout: 10000 });
}

function updateSoilPreview() {
  const clay = Number($('clayPct').value);
  const silt = Number($('siltPct').value);
  const sand = Number($('sandPct').value);
  const depth = Number($('rootDepth').value);

  if (![clay, silt, sand].every(Number.isFinite)) return;
  const total = clay + silt + sand;
  if (Math.abs(total - 100) > 0.1) {
    $('soilClassResult').textContent = `Total = ${num(total,1)} %`;
    $('rumResult').textContent = '—';
    $('ruResult').textContent = '—';
    $('rfuResult').textContent = '—';
    $('thresholdResult').textContent = '—';
    return;
  }

  const soil = findSoilClass(clay, silt);
  if (!soil) {
    $('soilClassResult').textContent = 'Classe non déterminée';
    $('rumResult').textContent = '—';
    return;
  }
  $('soilClassResult').textContent = soil.name;
  $('rumResult').textContent = `${num(soil.rum,2)} mm/cm`;
  if (depth > 0) {
    const ru = soil.rum * depth;
    const rfu = ru * 0.50;
    $('ruResult').textContent = `${num(ru,1)} mm`;
    $('rfuResult').textContent = `${num(rfu,1)} mm`;
    $('thresholdResult').textContent = `${num(rfu,1)} mm`;
  }
}

function updateKcDefaults() {
  if ($('customKc').checked) return;
  const kc = standardKcForCover($('groundCover').checked);
  $('kcInitial').value = kc.initial;
  $('kcMid').value = kc.mid;
  $('kcEnd').value = kc.end;
}

async function saveParcel() {
  setMessage('parcelMessage', '');
  const clay = Number($('clayPct').value);
  const silt = Number($('siltPct').value);
  const sand = Number($('sandPct').value);
  const depth = Number($('rootDepth').value);
  const area = Number($('parcelArea').value);
  const name = $('parcelName').value.trim();
  const total = clay + silt + sand;

  if (!name) return setMessage('parcelMessage', 'Donnez un nom à la parcelle.', 'error');
  if (!state.selectedLocation) return setMessage('parcelMessage', 'Choisissez une localisation.', 'error');
  if (!(area > 0)) return setMessage('parcelMessage', 'La surface doit être supérieure à 0.', 'error');
  if (![clay, silt, sand].every(v => Number.isFinite(v) && v >= 0 && v <= 100)) return setMessage('parcelMessage', 'Renseignez correctement sable, limon et argile.', 'error');
  if (Math.abs(total - 100) > 0.1) return setMessage('parcelMessage', `Sable + limon + argile doivent totaliser 100 % (actuellement ${num(total,1)} %).`, 'error');
  if (!(depth > 0)) return setMessage('parcelMessage', 'Renseignez la profondeur d’enracinement.', 'error');

  const soil = findSoilClass(clay, silt);
  if (!soil) return setMessage('parcelMessage', 'Cette combinaison argile/limon ne correspond à aucune classe de votre tableau Excel.', 'error');

  const custom = $('customKc').checked;
  if (!custom) updateKcDefaults();
  const kcInitial = Number($('kcInitial').value);
  const kcMid = Number($('kcMid').value);
  const kcEnd = Number($('kcEnd').value);
  if (![kcInitial, kcMid, kcEnd].every(v => Number.isFinite(v) && v >= 0 && v <= 2)) return setMessage('parcelMessage', 'Vérifiez les valeurs de Kc.', 'error');

  const ru = soil.rum * depth;
  const rfu = ru * 0.50;
  const payload = {
    user_id: state.user.id,
    name,
    location_name: state.selectedLocation.name,
    latitude: state.selectedLocation.latitude,
    longitude: state.selectedLocation.longitude,
    area_ha: area,
    clay_pct: clay,
    silt_pct: silt,
    sand_pct: sand,
    soil_class: soil.name,
    rum_mm_cm: soil.rum,
    root_depth_cm: depth,
    ru_mm: ru,
    p_factor: 0.50,
    rfu_mm: rfu,
    ground_cover: $('groundCover').checked,
    use_custom_kc: custom,
    kc_initial: kcInitial,
    kc_mid: kcMid,
    kc_end: kcEnd,
    updated_at: new Date().toISOString()
  };

  const editingId = $('saveParcelBtn').dataset.editingId;
  let result;
  if (editingId) result = await state.supabase.from('parcels').update(payload).eq('id', editingId).select().single();
  else result = await state.supabase.from('parcels').insert(payload).select().single();

  if (result.error) return setMessage('parcelMessage', result.error.message, 'error');
  setMessage('parcelMessage', 'Parcelle enregistrée.', 'success');
  await loadParcels();
  if (result.data?.id) await activateParcel(result.data.id);
  openTab('dashboard');
}

async function deleteParcel() {
  if (!state.activeParcel) return;
  if (!confirm(`Supprimer définitivement la parcelle « ${state.activeParcel.name} » et ses irrigations ?`)) return;
  const { error } = await state.supabase.from('parcels').delete().eq('id', state.activeParcel.id);
  if (error) return toast(error.message);
  localStorage.removeItem('samBilanActiveParcel');
  await loadParcels();
  openTab('dashboard');
}

async function loadIrrigations() {
  if (!state.activeParcel) return;
  const { data, error } = await state.supabase.from('irrigations').select('*').eq('parcel_id', state.activeParcel.id).order('irrigation_date', { ascending: false });
  if (error) return toast(error.message);
  state.irrigations = data || [];
}

async function loadRainCorrections() {
  if (!state.activeParcel) return;
  const { data, error } = await state.supabase.from('rain_corrections').select('*').eq('parcel_id', state.activeParcel.id).order('rain_date', { ascending: true });
  if (error) return toast(error.message);
  state.rainCorrections = data || [];
}

function updateIrrigationConversion() {
  const amount = Number($('irrigationAmount').value);
  const area = Number(state.activeParcel?.area_ha || 0);
  if (!(amount >= 0) || !area) return $('irrigationConversion').textContent = '—';
  const m3parcel = amount * 10 * area;
  $('irrigationConversion').textContent = `${num(m3parcel,1)} m³ sur la parcelle`;
}

async function saveIrrigation() {
  setMessage('irrigationMessage', '');
  if (!state.activeParcel) return;
  const date = $('irrigationDate').value;
  const amount = Number($('irrigationAmount').value);
  const today = toISO(localToday());
  if (!date || date > today) return setMessage('irrigationMessage', 'La date doit être aujourd’hui ou dans le passé.', 'error');
  if (!(amount >= 0)) return setMessage('irrigationMessage', 'Renseignez une quantité en mm.', 'error');

  const rows = [];
  if ($('repeatIrrigation').checked) {
    const interval = Number($('repeatInterval').value);
    let end = $('repeatEndDate').value;
    if (!end || end < date) return setMessage('irrigationMessage', 'La date de fin doit être postérieure ou égale à la date de début.', 'error');
    if (end > today) end = today;
    const seriesId = crypto.randomUUID();
    for (let d = parseISO(date); toISO(d) <= end; d = addDays(d, interval)) {
      rows.push({
        user_id: state.user.id,
        parcel_id: state.activeParcel.id,
        irrigation_date: toISO(d),
        amount_mm: amount,
        series_id: seriesId,
        repeat_interval_days: interval,
        series_start_date: date,
        series_end_date: end
      });
      if (rows.length > 400) break;
    }
  } else {
    rows.push({ user_id: state.user.id, parcel_id: state.activeParcel.id, irrigation_date: date, amount_mm: amount });
  }

  const { error } = await state.supabase.from('irrigations').insert(rows);
  if (error) return setMessage('irrigationMessage', error.message, 'error');
  setMessage('irrigationMessage', `${rows.length} irrigation${rows.length > 1 ? 's' : ''} enregistrée${rows.length > 1 ? 's' : ''}.`, 'success');
  $('irrigationAmount').value = '';
  updateIrrigationConversion();
  await loadIrrigations();
  renderIrrigationList();
  await refreshBalance();
}

function renderIrrigationList() {
  const list = $('irrigationList');
  if (!state.irrigations.length) {
    $('selectAllIrrigation').checked = false;
    $('deleteSelectedIrrigationBtn').disabled = true;
    $('selectedIrrigationCount').classList.add('hidden');
    list.innerHTML = '<div class="muted">Aucune irrigation enregistrée.</div>';
    return;
  }
  const area = Number(state.activeParcel?.area_ha || 0);
  list.innerHTML = state.irrigations.map(item => {
    const amount = Number(item.amount_mm);
    const volume = amount * 10 * area;
    const checked = state.selectedIrrigationIds.has(item.id) ? ' checked' : '';
    return `<div class="list-item">
      <div class="list-item-main">
        <label class="check-inline"><input type="checkbox" data-select-irrigation="${item.id}"${checked} /><span></span></label>
        <div>
          <strong>${fmtDate(item.irrigation_date)} — ${num(amount,1)} mm</strong>
          <div class="meta">${num(volume,1)} m³ sur la parcelle${item.series_id ? ' · irrigation répétée' : ''}</div>
        </div>
      </div>
      <div class="list-actions"><button type="button" data-edit-irrigation="${item.id}">Modifier</button><button type="button" data-delete-irrigation="${item.id}">Supprimer</button></div>
    </div>`;
  }).join('');

  qsa('[data-edit-irrigation]').forEach(btn => btn.addEventListener('click', () => openIrrigationModal(btn.dataset.editIrrigation)));
  qsa('[data-delete-irrigation]').forEach(btn => btn.addEventListener('click', () => deleteIrrigation(btn.dataset.deleteIrrigation)));
  qsa('[data-select-irrigation]').forEach(box => box.addEventListener('change', () => {
    if (box.checked) state.selectedIrrigationIds.add(box.dataset.selectIrrigation);
    else state.selectedIrrigationIds.delete(box.dataset.selectIrrigation);
    syncIrrigationSelectionUi();
  }));
  syncIrrigationSelectionUi();
}

function openIrrigationModal(id) {
  const item = state.irrigations.find(i => i.id === id);
  if (!item) return;
  state.editingIrrigation = item;
  $('editIrrigationAmount').value = item.amount_mm;
  $('editSeriesOptions').classList.toggle('hidden', !item.series_id);
  qsa('input[name="seriesScope"]').forEach(r => r.checked = r.value === 'one');
  $('modalBackdrop').classList.remove('hidden');
}

function closeIrrigationModal() {
  state.editingIrrigation = null;
  $('modalBackdrop').classList.add('hidden');
}

async function saveEditedIrrigation() {
  const item = state.editingIrrigation;
  if (!item) return;
  const amount = Number($('editIrrigationAmount').value);
  if (!(amount >= 0)) return toast('Quantité invalide.');
  let query = state.supabase.from('irrigations').update({ amount_mm: amount });
  if (!item.series_id) query = query.eq('id', item.id);
  else {
    const scope = document.querySelector('input[name="seriesScope"]:checked')?.value || 'one';
    if (scope === 'one') query = query.eq('id', item.id);
    if (scope === 'following') query = query.eq('series_id', item.series_id).gte('irrigation_date', item.irrigation_date);
    if (scope === 'all') query = query.eq('series_id', item.series_id);
  }
  const { error } = await query;
  if (error) return toast(error.message);
  closeIrrigationModal();
  await loadIrrigations();
  renderIrrigationList();
  await refreshBalance();
}

async function deleteIrrigation(id) {
  const item = state.irrigations.find(i => i.id === id);
  if (!item || !confirm(`Supprimer l’irrigation du ${fmtDate(item.irrigation_date)} ?`)) return;
  const { error } = await state.supabase.from('irrigations').delete().eq('id', id);
  if (error) return toast(error.message);
  await loadIrrigations();
  renderIrrigationList();
  await refreshBalance();
}

function syncIrrigationSelectionUi() {
  const total = state.irrigations.length;
  const selected = state.selectedIrrigationIds.size;
  $('selectAllIrrigation').checked = total > 0 && selected === total;
  $('deleteSelectedIrrigationBtn').disabled = selected === 0;
  const helper = $('selectedIrrigationCount');
  if (selected === 0) {
    helper.classList.add('hidden');
    helper.textContent = '';
  } else {
    helper.classList.remove('hidden');
    helper.textContent = `${selected} irrigation${selected > 1 ? 's' : ''} sélectionnée${selected > 1 ? 's' : ''}.`;
  }
}

function toggleAllIrrigations() {
  state.selectedIrrigationIds = $('selectAllIrrigation').checked
    ? new Set(state.irrigations.map(item => item.id))
    : new Set();
  renderIrrigationList();
}

async function deleteSelectedIrrigations() {
  const ids = [...state.selectedIrrigationIds];
  if (!ids.length) return;
  if (!confirm(`Supprimer ${ids.length} irrigation${ids.length > 1 ? 's' : ''} sélectionnée${ids.length > 1 ? 's' : ''} ?`)) return;
  const { error } = await state.supabase.from('irrigations').delete().in('id', ids);
  if (error) return toast(error.message);
  state.selectedIrrigationIds = new Set();
  await loadIrrigations();
  renderIrrigationList();
  await refreshBalance();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.reason || 'Erreur de données');
  return json;
}

async function fetchWeather(parcel) {
  const selectedYear = Number(state.selectedSeasonYear || getCurrentSeasonYear());
  const today = localToday();
  const todayIso = toISO(today);
  const seasonStartIso = toISO(getSeasonStart(selectedYear));
  const seasonEndIso = toISO(getSeasonEnd(selectedYear));
  const weatherMap = new Map();
  const commonDaily = 'precipitation_sum,et0_fao_evapotranspiration';

  if (isCurrentSeasonYear(selectedYear)) {
    const archiveEnd = addDays(today, -8);
    const archiveEndIso = toISO(archiveEnd);
    if (seasonStartIso <= archiveEndIso) {
      const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${parcel.latitude}&longitude=${parcel.longitude}&start_date=${seasonStartIso}&end_date=${archiveEndIso}&daily=${commonDaily}&timezone=auto`;
      const archive = await fetchJson(archiveUrl);
      ingestDailyWeather(weatherMap, archive.daily, todayIso);
    }

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${parcel.latitude}&longitude=${parcel.longitude}&daily=${commonDaily}&timezone=auto&past_days=7&forecast_days=8`;
    const forecast = await fetchJson(forecastUrl);
    ingestDailyWeather(weatherMap, forecast.daily, todayIso);

    return [...weatherMap.values()]
      .filter(row => row.date >= seasonStartIso)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${parcel.latitude}&longitude=${parcel.longitude}&start_date=${seasonStartIso}&end_date=${seasonEndIso}&daily=${commonDaily}&timezone=auto`;
  const archive = await fetchJson(archiveUrl);
  ingestDailyWeather(weatherMap, archive.daily, '9999-12-31');

  return [...weatherMap.values()]
    .filter(row => row.date >= seasonStartIso && row.date <= seasonEndIso)
    .map(row => ({ ...row, forecast: false }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function ingestDailyWeather(map, daily, todayIso) {
  if (!daily?.time) return;
  daily.time.forEach((date, i) => {
    map.set(date, {
      date,
      precipitation: Number(daily.precipitation_sum?.[i] ?? 0),
      et0: Number(daily.et0_fao_evapotranspiration?.[i] ?? 0),
      forecast: date >= todayIso
    });
  });
}

function irrigationMap() {
  const map = new Map();
  state.irrigations.forEach(i => map.set(i.irrigation_date, (map.get(i.irrigation_date) || 0) + Number(i.amount_mm || 0)));
  return map;
}

function correctionMap() {
  return new Map(state.rainCorrections.map(c => [c.rain_date, Number(c.amount_mm)]));
}

function computeBalance(weather, parcel) {
  const ru = Number(parcel.ru_mm);
  const corrections = correctionMap();
  const irrig = irrigationMap();
  let stock = ru;
  let lastYear = null;

  return weather.map((w, index) => {
    const d = parseISO(w.date);
    if (d.getMonth() === 2 && d.getDate() === 1 && (index === 0 || d.getFullYear() !== lastYear)) stock = ru;
    lastYear = d.getFullYear();

    const kc = kcForDate(w.date, parcel);
    const etc = Math.max(0, Number(w.et0 || 0) * kc);
    const corrected = corrections.has(w.date);
    const rainUsed = corrected ? corrections.get(w.date) : Number(w.precipitation || 0);
    const irrigation = Number(irrig.get(w.date) || 0);
    const raw = stock - etc + rainUsed + irrigation;
    const drainage = Math.max(0, raw - ru);
    stock = clamp(raw, 0, ru);

    return {
      date: w.date,
      forecast: w.forecast,
      et0: Number(w.et0 || 0),
      kc,
      etc,
      rainOriginal: Number(w.precipitation || 0),
      rainUsed,
      rainCorrected: corrected,
      irrigation,
      stock,
      drainage,
      status: stock <= Number(parcel.rfu_mm) ? 'Sous RFU' : 'Confort'
    };
  });
}

async function refreshBalance(force = false) {
  if (!state.activeParcel) return;
  $('refreshBtn').disabled = true;
  $('refreshBtn').textContent = 'Actualisation…';
  try {
    if (force || !state.weather.length || Number(state.loadedWeatherSeasonYear) !== Number(state.selectedSeasonYear)) {
      state.weather = await fetchWeather(state.activeParcel);
      state.loadedWeatherSeasonYear = Number(state.selectedSeasonYear);
    }
    state.balance = computeBalance(state.weather, state.activeParcel);
    renderDashboard();
    updateRainCorrectionInfo();
  } catch (err) {
    toast(`Météo : ${err.message}`);
  } finally {
    $('refreshBtn').disabled = false;
    $('refreshBtn').textContent = 'Actualiser';
  }
}

function currentBalanceRow() {
  if (!state.balance.length) return null;
  if (!isCurrentSeasonYear(state.selectedSeasonYear)) return state.balance[state.balance.length - 1] || null;
  const today = toISO(localToday());
  return state.balance.find(r => r.date === today) || [...state.balance].reverse().find(r => r.date <= today) || null;
}

function renderDashboard() {
  if (!state.activeParcel || !state.balance.length) return;
  const p = state.activeParcel;
  const current = currentBalanceRow();
  if (!current) return;
  const ru = Number(p.ru_mm);
  const rfu = Number(p.rfu_mm);
  const pct = ru ? (current.stock / ru * 100) : 0;
  const margin = current.stock - rfu;

  $('kpiStock').textContent = `${num(current.stock,1)} mm`;
  $('kpiStockSub').textContent = `sur ${num(ru,1)} mm`;
  $('kpiPercent').textContent = `${num(pct,0)} %`;
  $('kpiMargin').textContent = `${margin >= 0 ? '+' : ''}${num(margin,1)} mm`;
  $('kpiRfuSub').textContent = `RFU : ${num(rfu,1)} mm`;
  $('kpiNeed').textContent = `${num(current.etc,1)} mm`;
  $('summaryRu').textContent = `${num(ru,1)} mm`;
  $('summaryRfu').textContent = `${num(rfu,1)} mm`;
  $('summaryKc').textContent = num(current.kc,2);

  const shown = getDisplayedBalance();
  $('summaryDrainage').textContent = `${num(shown.reduce((s, r) => s + r.drainage, 0),1)} mm`;
  $('chartSubtitle').textContent = `${p.name} · ${p.location_name} · Saison ${state.selectedSeasonYear} · RU ${num(ru,1)} mm · RFU ${num(rfu,1)} mm`;
  renderAdvice(current);
  renderChart(shown);
}

function getDisplayedBalance() {
  const period = $('periodSelect').value;
  const isCurrent = isCurrentSeasonYear(state.selectedSeasonYear);
  const endDate = isCurrent ? toISO(addDays(localToday(), 7)) : toISO(getSeasonEnd(state.selectedSeasonYear));
  if (period === 'season') return state.balance.filter(r => r.date <= endDate);
  const baseDate = isCurrent ? localToday() : getSeasonEnd(state.selectedSeasonYear);
  const start = toISO(addDays(baseDate, -Number(period) + 1));
  return state.balance.filter(r => r.date >= start && r.date <= endDate);
}

function renderAdvice(current) {
  const card = $('adviceCard');
  const p = state.activeParcel;
  const rfu = Number(p.rfu_mm);
  if (current.stock > rfu) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  const today = toISO(localToday());
  const future = isCurrentSeasonYear(state.selectedSeasonYear)
    ? state.balance.filter(r => r.date > today).slice(0, 2)
    : [];
  const rain48 = future.reduce((s, r) => s + r.rainUsed, 0);
  const targetRow = future[future.length - 1] || current;
  const recommended = Math.max(0, Number(p.rfu_mm) - targetRow.stock);
  const volume = recommended * 10 * Number(p.area_ha);

  if (recommended <= 0.1) {
    $('adviceText').textContent = `Le stock est sous le seuil RFU, mais ${num(rain48,1)} mm de pluie sont intégrés dans les prochaines 48 h et devraient permettre de revenir au niveau RFU. Pas d'irrigation à prévoir pour le moment.`;
  } else {
    $('adviceText').textContent = `Le stock est sous le seuil RFU. Après prise en compte de ${num(rain48,1)} mm de pluie prévus dans les prochaines 48 h, il manquerait environ ${num(recommended,1)} mm pour revenir au niveau RFU, soit ${num(volume,0)} m³ sur cette parcelle.`;
  }
}

const todayLinePlugin = {
  id: 'todayLine',
  afterDraw(chart) {
    if (!isCurrentSeasonYear(state.selectedSeasonYear)) return;
    const labels = chart.data.labels || [];
    const todayLabel = fmtShort(toISO(localToday()));
    const idx = labels.indexOf(todayLabel);
    if (idx < 0) return;
    const meta = chart.getDatasetMeta(0);
    const point = meta.data[idx];
    if (!point) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#d7002f';
    ctx.lineWidth = 1.3;
    ctx.moveTo(point.x, chartArea.top);
    ctx.lineTo(point.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  }
};

function renderChart(rows) {
  const labels = rows.map(r => fmtShort(r.date));
  const firstForecast = rows.findIndex(r => r.forecast);
  const observed = rows.map(r => r.forecast ? null : r.stock);
  const forecast = rows.map((r, i) => (r.forecast || (firstForecast > 0 && i === firstForecast - 1)) ? r.stock : null);
  const ru = Number(state.activeParcel.ru_mm);
  const rfu = Number(state.activeParcel.rfu_mm);
  const maxFlux = Math.max(5, ...rows.map(r => Math.max(r.rainUsed || 0, r.irrigation || 0)));

  const data = {
    labels,
    datasets: [
      { type: 'line', label: 'Stock observé', data: observed, yAxisID: 'yStock', borderColor: '#2b3137', backgroundColor: '#2b3137', borderWidth: 3, pointRadius: 1.5, tension: .25, spanGaps: false },
      { type: 'line', label: 'Stock prévisionnel', data: forecast, yAxisID: 'yStock', borderColor: '#7a8088', backgroundColor: '#7a8088', borderWidth: 3, borderDash: [7,5], pointRadius: 1.5, tension: .25, spanGaps: true },
      { type: 'line', label: 'RU', data: rows.map(() => ru), yAxisID: 'yStock', borderColor: '#1f6f43', borderWidth: 2, borderDash: [], pointRadius: 0 },
      { type: 'line', label: 'RFU', data: rows.map(() => rfu), yAxisID: 'yStock', borderColor: '#b24a00', borderWidth: 2, borderDash: [], pointRadius: 0 },
      { type: 'bar', label: 'Pluie', data: rows.map(r => r.rainUsed), yAxisID: 'yFlux', backgroundColor: 'rgba(0, 88, 183, .88)', borderWidth: 0, order: 0 },
      { type: 'bar', label: 'Irrigation', data: rows.map(r => r.irrigation), yAxisID: 'yFlux', backgroundColor: 'rgba(0, 166, 81, .92)', borderWidth: 0, order: 0 }
    ]
  };

  const config = {
    type: 'line',
    data,
    plugins: [todayLinePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: false, boxWidth: 28, boxHeight: 3 } },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const idx = items[0]?.dataIndex;
              const row = rows[idx];
              if (!row) return '';
              return [`ET₀ : ${num(row.et0,1)} mm`, `Kc : ${num(row.kc,2)}`, `ETc : ${num(row.etc,1)} mm`, row.rainCorrected ? `Pluie corrigée (Open‑Meteo : ${num(row.rainOriginal,1)} mm)` : 'Pluie Open‑Meteo'];
            }
          }
        }
      },
      scales: {
        x: { stacked: false, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: window.innerWidth < 700 ? 8 : 16 }, grid: { display: false } },
        yStock: { position: 'left', min: 0, suggestedMax: ru * 1.08, title: { display: true, text: 'Stock (mm)' } },
        yFlux: { position: 'right', reverse: true, min: 0, max: maxFlux * 1.15, title: { display: true, text: 'Pluie / irrigation (mm)' }, grid: { drawOnChartArea: false } }
      }
    }
  };

  if (state.chart) state.chart.destroy();
  state.chart = new Chart($('waterChart'), config);
}

function originalRainForDate(date) {
  return state.balance.find(r => r.date === date)?.rainOriginal;
}

function updateRainCorrectionInfo() {
  if (!state.activeParcel) return;
  const date = $('rainCorrectionDate').value;
  if (!date) return;
  const row = state.balance.find(r => r.date === date);
  const corr = state.rainCorrections.find(c => c.rain_date === date);
  if (!row) {
    $('rainOriginalInfo').textContent = 'Pas de donnée Open‑Meteo disponible pour cette date.';
    return;
  }
  $('rainOriginalInfo').textContent = `Open‑Meteo : ${num(row.rainOriginal,1)} mm${corr ? ` · remplacement actuel : ${num(corr.amount_mm,1)} mm` : ''}`;
  $('rainCorrectionAmount').value = corr ? corr.amount_mm : '';
}

async function saveRainCorrection() {
  setMessage('rainCorrectionMessage', '');
  if (!state.activeParcel) return;
  const date = $('rainCorrectionDate').value;
  const amount = Number($('rainCorrectionAmount').value);
  if (!date || date > toISO(localToday())) return setMessage('rainCorrectionMessage', 'Choisissez une date passée ou aujourd’hui.', 'error');
  if (!(amount >= 0)) return setMessage('rainCorrectionMessage', 'Renseignez la pluie mesurée en mm.', 'error');
  const payload = { user_id: state.user.id, parcel_id: state.activeParcel.id, rain_date: date, amount_mm: amount, updated_at: new Date().toISOString() };
  const { error } = await state.supabase.from('rain_corrections').upsert(payload, { onConflict: 'parcel_id,rain_date' });
  if (error) return setMessage('rainCorrectionMessage', error.message, 'error');
  setMessage('rainCorrectionMessage', 'Pluie remplacée pour cette date.', 'success');
  await loadRainCorrections();
  state.balance = computeBalance(state.weather, state.activeParcel);
  renderDashboard();
  updateRainCorrectionInfo();
}

async function deleteRainCorrection() {
  setMessage('rainCorrectionMessage', '');
  if (!state.activeParcel) return;
  const date = $('rainCorrectionDate').value;
  const { error } = await state.supabase.from('rain_corrections').delete().eq('parcel_id', state.activeParcel.id).eq('rain_date', date);
  if (error) return setMessage('rainCorrectionMessage', error.message, 'error');
  setMessage('rainCorrectionMessage', 'La valeur Open‑Meteo est de nouveau utilisée.', 'success');
  $('rainCorrectionAmount').value = '';
  await loadRainCorrections();
  state.balance = computeBalance(state.weather, state.activeParcel);
  renderDashboard();
  updateRainCorrectionInfo();
}

function exportRows() {
  return state.balance.map(r => ({
    Date: r.date,
    Type: r.forecast ? 'Prévision' : 'Historique',
    'ET0 (mm)': round(r.et0, 2),
    Kc: round(r.kc, 3),
    'ETc / besoin (mm)': round(r.etc, 2),
    'Pluie Open-Meteo (mm)': round(r.rainOriginal, 2),
    'Pluie utilisée (mm)': round(r.rainUsed, 2),
    'Pluie corrigée': r.rainCorrected ? 'Oui' : 'Non',
    'Irrigation (mm)': round(r.irrigation, 2),
    'Irrigation parcelle (m3)': round(r.irrigation * 10 * Number(state.activeParcel.area_ha), 1),
    'Stock eau (mm)': round(r.stock, 2),
    'Drainage/perte (mm)': round(r.drainage, 2),
    Statut: r.status
  }));
}

function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round((Number(v) + Number.EPSILON) * f) / f;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  if (!state.activeParcel || !state.balance.length) return;
  const rows = exportRows();
  const headers = Object.keys(rows[0]);
  const escapeCell = value => {
    if (typeof value === 'number') return String(value).replace('.', ',');
    const s = String(value ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };
  const csv = [headers.map(escapeCell).join(';'), ...rows.map(row => headers.map(h => escapeCell(row[h])).join(';'))].join('\n');
  downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `SAM_Bilan_${safeFilename(state.activeParcel.name)}.csv`);
}

function exportXlsx() {
  if (!state.activeParcel || !state.balance.length) return;
  if (!window.XLSX) return toast('Le module Excel n’a pas pu être chargé.');
  const ws = XLSX.utils.json_to_sheet(exportRows());
  ws['!cols'] = [{wch:12},{wch:12},{wch:11},{wch:8},{wch:18},{wch:22},{wch:19},{wch:15},{wch:16},{wch:24},{wch:18},{wch:20},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bilan hydrique');
  XLSX.writeFile(wb, `SAM_Bilan_${safeFilename(state.activeParcel.name)}.xlsx`);
}

function safeFilename(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

document.addEventListener('DOMContentLoaded', init);
