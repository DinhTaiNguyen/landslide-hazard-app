(function () {
  const defaultBackend = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || 'https://landslide-hazard-app.onrender.com';
  const backendUrlInput = document.getElementById('backendUrlInput');
  const checkBackendBtn = document.getElementById('checkBackendBtn');
  const backendStatus = document.getElementById('backendStatus');
  const uploadStatus = document.getElementById('uploadStatus');
  const rasterStats = document.getElementById('rasterStats');
  const consoleContent = document.getElementById('consoleContent');
  const mlConsoleContent = document.getElementById('mlConsoleContent');
  const inputSummaryContent = document.getElementById('inputSummaryContent');
  const resultSummaryContent = document.getElementById('resultSummaryContent');
  const dataPrepContent = document.getElementById('dataPrepContent');
  const mlPlotsContent = document.getElementById('mlPlotsContent');
  const dataPrepStatus = document.getElementById('dataPrepStatus');
  const mlRunStatus = document.getElementById('mlRunStatus');
  const geotopRunCards = document.getElementById('geotopRunCards');
  const geotopRunCountInput = document.getElementById('geotopRunCountInput');
  const generateGeotopRunsBtn = document.getElementById('generateGeotopRunsBtn');
  const generateFormInputsBtn = document.getElementById('generateFormInputsBtn');
  const formSoilTypeCount = document.getElementById('formSoilTypeCount');
  const formSoilTypeContainer = document.getElementById('formSoilTypeContainer');
  const runDataPrepBtn = document.getElementById('runDataPrepBtn');
  const runMlBtn = document.getElementById('runMlBtn');
  const mlMapsFolderInput = document.getElementById('mlMapsFolderInput');
  const mlMapsSummary = document.getElementById('mlMapsSummary');
  const mlMapLayersList = document.getElementById('mlMapLayersList');
  const mlFormOutputsFolderInput = document.getElementById('mlFormOutputsFolderInput');
  const mlFormOutputsSummary = document.getElementById('mlFormOutputsSummary');
  const mlDetectedEventsBox = document.getElementById('mlDetectedEventsBox');
  const rainfallEventContainer = document.getElementById('rainfallEventContainer');
  const stage1TrainEventsBox = document.getElementById('stage1TrainEventsBox');
  const stage1TestEventsBox = document.getElementById('stage1TestEventsBox');
  const stage1ValEventsBox = document.getElementById('stage1ValEventsBox');
  const stage2EnabledInput = document.getElementById('stage2EnabledInput');
  const stage2ConfigWrap = document.getElementById('stage2ConfigWrap');
  const stage2EventSelect = document.getElementById('stage2EventSelect');
  const landslideLabelInput = document.getElementById('landslideLabelInput');
  const landslideLabelSummary = document.getElementById('landslideLabelSummary');
  const landslideLabelViewToggle = document.getElementById('landslideLabelViewToggle');
  const mlHyperparametersGrid = document.getElementById('mlHyperparametersGrid');
  const mlResultLayersList = document.getElementById('mlResultLayersList');
  const psiFileStyleSelect = document.getElementById('psiFileStyleSelect');
  const psiUnitSelect = document.getElementById('psiUnitSelect');
  const soilThicknessUnitSelect = document.getElementById('soilThicknessUnitSelect');
  const singleTimeCodeInput = document.getElementById('singleTimeCodeInput');
  const useMultipleTimestepsInput = document.getElementById('useMultipleTimestepsInput');
  const colorbarPanel = document.getElementById('colorbarPanel');
  const colorbarMax = document.getElementById('colorbarMax');
  const colorbarMid = document.getElementById('colorbarMid');
  const colorbarMin = document.getElementById('colorbarMin');
  const mapEmptyNote = document.getElementById('mapEmptyNote');
  const crsSelect = document.getElementById('crsSelect');
  const basemapSelect = document.getElementById('basemapSelect');

  const rasterConfigs = {
    dem: { label: 'DEM', input: document.getElementById('demFileInput'), selectedFile: document.getElementById('demSelectedFile'), viewToggle: document.getElementById('demViewToggle') },
    slope: { label: 'Slope map', input: document.getElementById('slopeFileInput'), selectedFile: document.getElementById('slopeSelectedFile'), viewToggle: document.getElementById('slopeViewToggle') },
    soilType: { label: 'Soil type map', input: document.getElementById('soilTypeFileInput'), selectedFile: document.getElementById('soilTypeSelectedFile'), viewToggle: document.getElementById('soilTypeViewToggle') },
    soilThickness: { label: 'Soil thickness map', input: document.getElementById('soilThicknessFileInput'), selectedFile: document.getElementById('soilThicknessSelectedFile'), viewToggle: document.getElementById('soilThicknessViewToggle') }
  };

  const defaultSoils = [
    { soil_id: 1, name: 'Qg', phi_deg: 40.50, phi_cov: 0.02, c_kpa: 1.72, c_cov: 0.69, gamma_s: 16.87, rho_c_phi: -0.5 },
    { soil_id: 2, name: 'Hs', phi_deg: 41.40, phi_cov: 0.08, c_kpa: 2.48, c_cov: 0.51, gamma_s: 16.48, rho_c_phi: -0.5 },
    { soil_id: 3, name: 'Hi', phi_deg: 37.61, phi_cov: 0.08, c_kpa: 4.82, c_cov: 0.29, gamma_s: 15.50, rho_c_phi: -0.5 }
  ];

  const defaultHyperparameters = [
    ['batch_size_stage1', 8192], ['batch_size_stage2', 4096], ['epochs_stage1', 80], ['epochs_stage2', 100],
    ['lr_stage1', 1e-3], ['lr_stage2', 1e-3], ['weight_decay', 1e-5], ['patience_stage1', 10], ['patience_stage2', 15],
    ['min_delta', 1e-5], ['stage2_train_frac', 0.60], ['stage2_val_frac', 0.20], ['stage2_test_frac', 0.20], ['class_threshold', 0.5], ['random_seed', 42]
  ];

  const state = {
    backendUrl: localStorage.getItem('landslide_backend_url') || defaultBackend,
    rainfallDefaults: {},
    formInputs: { dem: null, slope: null, soilType: null, soilThickness: null },
    geotopCards: [],
    ml: {
      mapFiles: [],
      formOutputFiles: [],
      detectedEvents: [],
      rainfall: {},
      prepJobId: null,
      mlJobId: null,
      labelFile: null
    }
  };

  let map = null;
  let currentBaseLayer = null;
  let activeLayerKey = null;
  const rasterLayers = {};
  const defaultMapView = { center: [29.72, 119.96], zoom: 10 };

  if (typeof proj4 !== 'undefined') {
    try { proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs'); } catch (e) {}
    try { proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs +type=crs'); } catch (e) {}
    try { proj4.defs('EPSG:4549', '+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs'); } catch (e) {}
  }

  const baseLayerConfigs = {
    osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { attribution: '© OpenStreetMap contributors' } },
    terrain: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', options: { attribution: '© OpenTopoMap contributors' } },
    voyager: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', options: { attribution: '© CARTO' } },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', options: { attribution: '© Esri' } }
  };

  function apiBase() { return String(backendUrlInput.value || '').replace(/\/$/, ''); }
  function addConsoleLine(target, type, message) {
    const line = document.createElement('div');
    line.style.marginBottom = '6px';
    line.style.color = type === 'err' ? '#ff6b6b' : type === 'warn' ? '#ffd166' : '#8affc1';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    target.appendChild(line);
    target.scrollTop = target.scrollHeight;
  }
  function setStatus(el, text) { if (el) el.textContent = text; }
  function setBackendStatus(text, className) { backendStatus.textContent = text; backendStatus.className = className || ''; }

  async function checkBackend() {
    const url = apiBase();
    if (!url) { setBackendStatus('Empty URL'); return false; }
    setBackendStatus('Checking...');
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBackendStatus('Reachable');
      localStorage.setItem('landslide_backend_url', url);
      state.backendUrl = url;
      state.rainfallDefaults = (await fetch(`${url}/api/rainfall-defaults`).then(r => r.json()).catch(() => ({ defaults: {} }))).defaults || {};
      addConsoleLine(consoleContent, 'info', `Backend reachable at ${url}`);
      return true;
    } catch (err) {
      setBackendStatus('Not reachable');
      addConsoleLine(consoleContent, 'err', `Backend check failed: ${err.message}`);
      return false;
    }
  }

  function activateVizPanel(id) {
    document.querySelectorAll('.viz-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.viz === id));
    document.querySelectorAll('.viz-panel').forEach(panel => panel.classList.toggle('active', panel.id === id));
  }
  function activateRightPanel(id) {
    document.querySelectorAll('.right-workflow-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.rightPanel === id));
    document.querySelectorAll('.right-subpanel').forEach(panel => panel.classList.toggle('active', panel.id === id));
  }

  function setBaseLayer(key) {
    if (!map || !baseLayerConfigs[key]) return;
    if (currentBaseLayer && map.hasLayer(currentBaseLayer)) map.removeLayer(currentBaseLayer);
    const cfg = baseLayerConfigs[key];
    currentBaseLayer = L.tileLayer(cfg.url, cfg.options).addTo(map);
  }

  function initMap() {
    map = L.map('map', { center: defaultMapView.center, zoom: defaultMapView.zoom, zoomControl: true });
    setBaseLayer('osm');
  }

  function updateColorbar(min, max) {
    colorbarPanel.style.display = 'block';
    colorbarMax.textContent = max.toFixed(2);
    colorbarMid.textContent = ((min + max) / 2).toFixed(2);
    colorbarMin.textContent = min.toFixed(2);
  }
  function clearColorbar() { colorbarPanel.style.display = 'none'; }
  function updateRasterStats(min, max, width, height, label) {
    rasterStats.textContent = `Layer: ${label}\nMin: ${min.toFixed(2)}\nMax: ${max.toFixed(2)}\nSize: ${width} × ${height}`;
  }

  function parseAsc(text) {
    const lines = text.replace(/\r/g, '').trim().split('\n');
    const header = {};
    let dataStart = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase();
        if (['ncols','nrows','xllcorner','yllcorner','xllcenter','yllcenter','cellsize','nodata_value'].includes(key)) {
          header[key] = parseFloat(parts[1]);
          dataStart = i + 1;
        }
      }
    }
    const ncols = parseInt(header.ncols, 10); const nrows = parseInt(header.nrows, 10); const nodata = header.nodata_value;
    if (!ncols || !nrows) throw new Error('Invalid ASC header');
    const values = [];
    for (let i = dataStart; i < lines.length; i++) {
      const row = lines[i].trim(); if (!row) continue;
      row.split(/\s+/).forEach(v => { const num = parseFloat(v); if (Number.isFinite(num)) values.push(num); });
    }
    const sliced = values.slice(0, ncols * nrows);
    const grid = new Float32Array(sliced.length);
    let min = Infinity; let max = -Infinity;
    sliced.forEach((val, i) => {
      if (!Number.isFinite(val) || (Number.isFinite(nodata) && val === nodata)) grid[i] = NaN;
      else { grid[i] = val; min = Math.min(min, val); max = Math.max(max, val); }
    });
    return { width: ncols, height: nrows, grid, min, max, xll: header.xllcorner ?? header.xllcenter ?? 0, yll: header.yllcorner ?? header.yllcenter ?? 0, cellsize: header.cellsize ?? 1 };
  }

  function renderGridToCanvas(width, height, grid, min, max) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); const imageData = ctx.createImageData(width, height);
    for (let i = 0; i < grid.length; i++) {
      const idx = i * 4; const val = grid[i];
      if (!Number.isFinite(val)) { imageData.data[idx+3] = 0; continue; }
      const norm = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
      imageData.data[idx] = Math.round(255 * norm);
      imageData.data[idx+1] = Math.round(180 * (1 - Math.abs(norm - 0.5) * 2));
      imageData.data[idx+2] = Math.round(255 * (1 - norm));
      imageData.data[idx+3] = 220;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function ascLooksGeographic(asc) {
    const west = asc.xll; const south = asc.yll; const east = asc.xll + asc.width * asc.cellsize; const north = asc.yll + asc.height * asc.cellsize;
    return west >= -180 && west <= 180 && east >= -180 && east <= 180 && south >= -90 && south <= 90 && north >= -90 && north <= 90;
  }
  function transformPointToWGS84(x, y, sourceCRS) {
    if (sourceCRS === 'EPSG:4326' || sourceCRS === 'EPSG:4490') return [x, y];
    if (typeof proj4 === 'undefined') throw new Error('proj4 is not available');
    const pt = proj4(sourceCRS, 'EPSG:4326', [x, y]);
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) throw new Error(`Failed CRS transform from ${sourceCRS}`);
    return pt;
  }
  function getEffectivePreviewCRS(ascLike = null) {
    const selected = crsSelect && crsSelect.value ? crsSelect.value : 'EPSG:4549';
    if (selected && selected !== 'auto') return selected;
    return 'EPSG:4549';
  }
  function fallbackBounds() {
    return [[defaultMapView.center[0] - 0.08, defaultMapView.center[1] - 0.08], [defaultMapView.center[0] + 0.08, defaultMapView.center[1] + 0.08]];
  }

  function ascBoundsToLatLngBounds(asc, selectedCRS) {
    const xMin = asc.xll, yMin = asc.yll, xMax = asc.xll + asc.width * asc.cellsize, yMax = asc.yll + asc.height * asc.cellsize;
    try {
      const effectiveCRS = selectedCRS === 'auto' ? getEffectivePreviewCRS(asc) : selectedCRS;
      if (effectiveCRS === 'EPSG:4326' || effectiveCRS === 'EPSG:4490') return [[yMin, xMin], [yMax, xMax]];
      const corners = [
        transformPointToWGS84(xMin, yMin, effectiveCRS),
        transformPointToWGS84(xMax, yMin, effectiveCRS),
        transformPointToWGS84(xMin, yMax, effectiveCRS),
        transformPointToWGS84(xMax, yMax, effectiveCRS),
      ];
      const lons = corners.map(c => c[0]);
      const lats = corners.map(c => c[1]);
      if (![...lons, ...lats].every(Number.isFinite)) throw new Error('Invalid transformed bounds');
      return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
    } catch (err) {
      addConsoleLine(consoleContent, 'warn', `Using fallback display bounds for raster preview: ${err.message}`);
      return fallbackBounds();
    }
  }

  function registerLayer(layerKey, layerLabel, leafletLayer, bounds, stats, onVisibleChange) {
    if (rasterLayers[layerKey] && rasterLayers[layerKey].layer && map.hasLayer(rasterLayers[layerKey].layer)) map.removeLayer(rasterLayers[layerKey].layer);
    rasterLayers[layerKey] = { key: layerKey, label: layerLabel, layer: leafletLayer, bounds, min: stats.min, max: stats.max, width: stats.width, height: stats.height, visible: true, onVisibleChange };
    activeLayerKey = layerKey;
    map.fitBounds(bounds, { padding: [20,20] });
    mapEmptyNote.style.display = 'none';
    updateRasterStats(stats.min, stats.max, stats.width, stats.height, layerLabel);
    updateColorbar(stats.min, stats.max);
  }

  function getSafeFileName(file, fallback = 'uploaded_file') {
    if (!file) return fallback;
    return file.name || (file.webkitRelativePath ? file.webkitRelativePath.split('/').pop() : '') || file.webkitRelativePath || fallback;
  }

  function removeLayerByKey(layerKey) {
    if (rasterLayers[layerKey] && rasterLayers[layerKey].layer && map.hasLayer(rasterLayers[layerKey].layer)) {
      map.removeLayer(rasterLayers[layerKey].layer);
    }
    delete rasterLayers[layerKey];
    if (!Object.keys(rasterLayers).length) {
      mapEmptyNote.style.display = 'block';
      clearColorbar();
      rasterStats.textContent = 'No raster loaded';
    }
  }

  function addAscLayerFromParsed(asc, fileName, layerKey, layerLabel) {
    const canvas = renderGridToCanvas(asc.width, asc.height, asc.grid, asc.min, asc.max);
    const bounds = ascBoundsToLatLngBounds(asc, 'EPSG:4549');
    const overlay = L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity: 1.0 }).addTo(map);
    registerLayer(layerKey, layerLabel, overlay, bounds, { min: asc.min, max: asc.max, width: asc.width, height: asc.height });
    uploadStatus.textContent = `Loaded ${fileName}`;
    return overlay;
  }

  async function addTiffLayer(file, layerKey, layerLabel) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters();
    const grid = rasters[0];
    let min = Infinity; let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const canvas = renderGridToCanvas(width, height, grid, min, max);
    let bounds = fallbackBounds();
    try {
      const bbox = image.getBoundingBox();
      if (bbox && bbox.length === 4) {
        if (bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90) bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
        else if (typeof proj4 !== 'undefined') {
          const effectiveCRS = 'EPSG:4549';
          const ll = transformPointToWGS84(bbox[0], bbox[1], effectiveCRS);
          const ur = transformPointToWGS84(bbox[2], bbox[3], effectiveCRS);
          if ([ll[0], ll[1], ur[0], ur[1]].every(Number.isFinite)) bounds = [[ll[1], ll[0]], [ur[1], ur[0]]];
        }
      }
    } catch (err) {
      addConsoleLine(consoleContent, 'warn', `Using fallback display bounds for TIFF preview: ${err.message}`);
    }
    const overlay = L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity: 1.0 }).addTo(map);
    registerLayer(layerKey, layerLabel, overlay, bounds, { min, max, width, height });
    uploadStatus.textContent = `Loaded ${getSafeFileName(file)}`;
    return overlay;
  }

  async function displayRasterFile(file, layerKey, layerLabel) {
    const name = getSafeFileName(file);
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'asc') {
      const text = await file.text();
      const asc = parseAsc(text);
      return addAscLayerFromParsed(asc, name, layerKey, layerLabel || name);
    }
    if (ext === 'tif' || ext === 'tiff') {
      return addTiffLayer(file, layerKey, layerLabel || name);
    }
    throw new Error(`Unsupported raster type: ${ext}`);
  }

  async function displayAscFile(file, layerKey, layerLabel) {
    return displayRasterFile(file, layerKey, layerLabel);
  }

  async function displayAscUrl(url, layerKey, layerLabel) {
    const text = await fetch(url).then(r => r.text());
    const asc = parseAsc(text);
    addAscLayerFromParsed(asc, url.split('/').pop(), layerKey, layerLabel);
  }

  function clearAllLayers() {
    Object.keys(rasterLayers).forEach(key => { if (rasterLayers[key].layer && map.hasLayer(rasterLayers[key].layer)) map.removeLayer(rasterLayers[key].layer); delete rasterLayers[key]; });
    activeLayerKey = null; mapEmptyNote.style.display = 'block'; clearColorbar(); rasterStats.textContent = 'No active layer';
  }

  function updateInputSummary() {
    const summary = [];
    ['dem','slope','soilType','soilThickness'].forEach(key => { if (state.formInputs[key]) summary.push(`${key}: ${getSafeFileName(state.formInputs[key], key)}`); });
    summary.push(`FORM GeoTOP boxes: ${state.geotopCards.length}`);
    if (state.ml.mapFiles.length) summary.push(`ML maps uploaded: ${state.ml.mapFiles.length}`);
    if (state.ml.formOutputFiles.length) summary.push(`ML FORM files uploaded: ${state.ml.formOutputFiles.length}`);
    inputSummaryContent.textContent = summary.join('\n') || 'No input summary yet.';
  }

  function updateResultSummary(text) {
    resultSummaryContent.textContent = text;
  }

  function createSoilInputs() {
    const count = Math.max(1, parseInt(formSoilTypeCount.value || '3', 10));
    formSoilTypeContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const soil = defaultSoils[i] || { soil_id: i + 1, name: `Soil ${i+1}`, phi_deg: 35, phi_cov: 0.1, c_kpa: 2, c_cov: 0.5, gamma_s: 16, rho_c_phi: -0.5 };
      const card = document.createElement('div'); card.className = 'geotop-card';
      card.innerHTML = `
        <div class="geotop-title">Soil ${i+1}</div>
        <div class="field-grid two-col">
          <div class="field-group"><label class="field-label">soil_id</label><input data-field="soil_id" type="number" class="field-input" value="${soil.soil_id}" /></div>
          <div class="field-group"><label class="field-label">name</label><input data-field="name" type="text" class="field-input" value="${soil.name}" /></div>
          <div class="field-group"><label class="field-label">phi_deg</label><input data-field="phi_deg" type="number" step="0.01" class="field-input" value="${soil.phi_deg}" /></div>
          <div class="field-group"><label class="field-label">phi_cov</label><input data-field="phi_cov" type="number" step="0.01" class="field-input" value="${soil.phi_cov}" /></div>
          <div class="field-group"><label class="field-label">c_kpa</label><input data-field="c_kpa" type="number" step="0.01" class="field-input" value="${soil.c_kpa}" /></div>
          <div class="field-group"><label class="field-label">c_cov</label><input data-field="c_cov" type="number" step="0.01" class="field-input" value="${soil.c_cov}" /></div>
          <div class="field-group"><label class="field-label">gamma_s</label><input data-field="gamma_s" type="number" step="0.01" class="field-input" value="${soil.gamma_s}" /></div>
          <div class="field-group"><label class="field-label">rho_c_phi</label><input data-field="rho_c_phi" type="number" step="0.01" class="field-input" value="${soil.rho_c_phi}" /></div>
        </div>`;
      formSoilTypeContainer.appendChild(card);
    }
  }

  function collectSoilParams() {
    return Array.from(formSoilTypeContainer.children).map(card => {
      const payload = {};
      card.querySelectorAll('[data-field]').forEach(input => {
        payload[input.dataset.field] = input.type === 'text' ? input.value : parseFloat(input.value);
      });
      return payload;
    });
  }

  function setCardStatus(card, statusText, cls) {
    card.statusEl.textContent = statusText; card.statusEl.className = `status-pill ${cls}`;
  }

  function createGeotopCard(index) {
    const card = document.createElement('div'); card.className = 'geotop-card';
    card.innerHTML = `
      <div class="geotop-header"><div class="geotop-title">GeoTOP folder ${index + 1}</div><div class="status-pill waiting">Waiting</div></div>
      <div class="field-group"><label class="field-label">Optional event label</label><input class="field-input event-label-input" type="text" placeholder="For example 20210610" /></div>
      <input type="file" class="pwp-folder-input" webkitdirectory directory multiple hidden />
      <button type="button" class="small-btn choose-folder-btn">Choose GeoTOP PWP folder</button>
      <div class="summary-box folder-summary">No folder uploaded yet.</div>
      <div class="toolbar-row buttons" style="margin-top:8px;"><button type="button" class="primary-btn run-btn">Run</button><button type="button" class="small-btn show-logs-btn">Show logs</button></div>
      <div class="layer-control-list result-layers"></div>
    `;
    const obj = { el: card, statusEl: card.querySelector('.status-pill'), input: card.querySelector('.pwp-folder-input'), chooseBtn: card.querySelector('.choose-folder-btn'), runBtn: card.querySelector('.run-btn'), showLogsBtn: card.querySelector('.show-logs-btn'), folderSummary: card.querySelector('.folder-summary'), resultLayers: card.querySelector('.result-layers'), labelInput: card.querySelector('.event-label-input'), pwpFiles: [], jobId: null };
    obj.chooseBtn.addEventListener('click', () => obj.input.click());
    obj.input.addEventListener('change', () => {
      obj.pwpFiles = Array.from(obj.input.files || []);
      const detectedTimeCodes = [...new Set(obj.pwpFiles.map(f => {
        const m = f.name.match(/N(\d+)\.asc$/i); return m ? m[1] : null;
      }).filter(Boolean))].sort();
      obj.folderSummary.textContent = `${obj.pwpFiles.length} files uploaded${detectedTimeCodes.length ? ` | time codes: ${detectedTimeCodes.join(', ')}` : ''}`;
      setCardStatus(obj, 'Ready', 'waiting');
      updateInputSummary();
    });
    obj.showLogsBtn.addEventListener('click', () => activateVizPanel('formRunningPanel'));
    obj.runBtn.addEventListener('click', () => runFormCard(obj));
    return obj;
  }

  function createGeotopCards() {
    geotopRunCards.innerHTML = '';
    state.geotopCards = [];
    const count = Math.max(1, parseInt(geotopRunCountInput.value || '1', 10));
    for (let i = 0; i < count; i++) {
      const card = createGeotopCard(i);
      state.geotopCards.push(card);
      geotopRunCards.appendChild(card.el);
    }
    updateInputSummary();
  }

  async function runFormCard(card) {
    if (!(await checkBackend())) return;
    if (!state.formInputs.slope || !state.formInputs.soilType || !state.formInputs.soilThickness) {
      addConsoleLine(consoleContent, 'err', 'Upload slope, soiltype, and soilthickness maps first.');
      return;
    }
    if (!card.pwpFiles.length) {
      addConsoleLine(consoleContent, 'err', 'Upload a GeoTOP PWP folder first.');
      return;
    }
    activateVizPanel('formRunningPanel');
    setCardStatus(card, 'Uploading...', 'running');
    const payload = {
      psi_file_style: psiFileStyleSelect.value,
      psi_unit: psiUnitSelect.value,
      soilthickness_unit: soilThicknessUnitSelect.value,
      use_multiple_timesteps: useMultipleTimestepsInput.checked,
      single_time_code: singleTimeCodeInput.value,
      soil_params: collectSoilParams()
    };
    const formData = new FormData();
    formData.append('settings_json', JSON.stringify(payload));
    formData.append('slope_file', state.formInputs.slope, state.formInputs.slope.name);
    formData.append('soiltype_file', state.formInputs.soilType, state.formInputs.soilType.name);
    formData.append('soilthickness_file', state.formInputs.soilThickness, state.formInputs.soilThickness.name);
    if (state.formInputs.dem) formData.append('dem_file', state.formInputs.dem, state.formInputs.dem.name);
    card.pwpFiles.forEach(file => formData.append('pwp_files', file, file.webkitRelativePath || file.name));
    try {
      const res = await fetch(`${apiBase()}/api/form/run`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      card.jobId = data.job_id;
      addConsoleLine(consoleContent, 'info', `FORM job ${data.job_id} started${card.labelInput.value ? ` for ${card.labelInput.value}` : ''}`);
      pollJob(card.jobId, card, 'form');
    } catch (err) {
      setCardStatus(card, 'Failed', 'failed');
      addConsoleLine(consoleContent, 'err', `FORM run failed to start: ${err.message}`);
    }
  }

  async function pollJob(jobId, owner, mode) {
    const targetConsole = mode === 'form' ? consoleContent : mlConsoleContent;
    let lastLogCount = 0;
    const poll = async () => {
      const res = await fetch(`${apiBase()}/api/jobs/${jobId}`);
      const job = await res.json();
      const newLogs = job.logs.slice(lastLogCount);
      newLogs.forEach(line => addConsoleLine(targetConsole, line.includes('ERROR') ? 'err' : 'info', line.replace(/^\[[^\]]+\]\s*/, '')));
      lastLogCount = job.logs.length;
      if (mode === 'form') {
        setCardStatus(owner, job.status, job.status);
      } else {
        mlRunStatus.textContent = `Machine learning job status: ${job.status}`;
      }
      if (job.status === 'completed') {
        if (mode === 'form') handleFormCompleted(owner, job);
        if (mode === 'ml_prepare') handlePrepCompleted(job);
        if (mode === 'ml_run') handleMlCompleted(job);
        return;
      }
      if (job.status === 'failed') {
        if (mode === 'form') setCardStatus(owner, 'Failed', 'failed');
        if (mode === 'ml_prepare') dataPrepStatus.textContent = `Data preparation failed: ${job.error || 'Unknown error'}`;
        if (mode === 'ml_run') mlRunStatus.textContent = `Machine learning failed: ${job.error || 'Unknown error'}`;
        return;
      }
      setTimeout(poll, 2000);
    };
    poll();
  }

  function renderResultLayerControls(container, jobId, outputs, prefixKey) {
    container.innerHTML = '';
    Object.entries(outputs).forEach(([name, relativeUrl]) => {
      const row = document.createElement('div'); row.className = 'layer-row';
      const downloadUrl = `${apiBase()}${relativeUrl}`;
      row.innerHTML = `<span>${name}</span><div class="layer-actions"><label><input type="checkbox" ${name.toLowerCase().includes('pof') ? 'checked' : ''}/> View</label><a href="${downloadUrl}" target="_blank" rel="noopener">Download</a></div>`;
      const checkbox = row.querySelector('input[type="checkbox"]');
      const layerKey = `${prefixKey}_${name}`;
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) {
          await displayAscUrl(downloadUrl, layerKey, name);
        } else {
          removeLayerByKey(layerKey);
        }
      });
      container.appendChild(row);
      if (checkbox.checked) displayAscUrl(downloadUrl, layerKey, name).catch(() => {});
    });
  }

  function handleFormCompleted(card, job) {
    setCardStatus(card, 'Completed', 'completed');
    renderResultLayerControls(card.resultLayers, job.job_id, job.outputs, `form_${job.job_id}`);
    updateResultSummary(`Latest FORM job ${job.job_id} completed.\n${JSON.stringify(job.summary, null, 2)}`);
    activateVizPanel('resultSummaryPanel');
  }

  function initMlHyperparameters() {
    mlHyperparametersGrid.innerHTML = '';
    defaultHyperparameters.forEach(([key, value]) => {
      const wrap = document.createElement('div'); wrap.className = 'field-group';
      wrap.innerHTML = `<label class="field-label">${key}</label><input class="field-input" data-ml-param="${key}" type="number" step="any" value="${value}" />`;
      mlHyperparametersGrid.appendChild(wrap);
    });
  }

  function updateStageEventSelectors() {
    const events = state.ml.detectedEvents.slice();
    const previousTrain = new Set(Array.from(stage1TrainEventsBox.querySelectorAll('input:checked')).map(i => i.value));
    const previousVal = new Set(Array.from(stage1ValEventsBox.querySelectorAll('input:checked')).map(i => i.value));
    const previousTest = new Set(Array.from(stage1TestEventsBox.querySelectorAll('input:checked')).map(i => i.value));

    stage1TrainEventsBox.innerHTML = '';
    events.forEach(eventId => {
      const checked = previousTrain.size ? previousTrain.has(eventId) : true;
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${eventId}" ${checked ? 'checked' : ''}/> ${eventId}`;
      label.querySelector('input').addEventListener('change', updateStageEventSelectors);
      stage1TrainEventsBox.appendChild(label);
    });

    const checkedTrain = new Set(Array.from(stage1TrainEventsBox.querySelectorAll('input:checked')).map(i => i.value));
    stage1ValEventsBox.innerHTML = '';
    events.filter(e => !checkedTrain.has(e)).forEach((eventId, idx) => {
      const defaultChecked = previousVal.size ? previousVal.has(eventId) : idx < Math.min(2, Math.max(events.length - checkedTrain.size, 0));
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${eventId}" ${defaultChecked ? 'checked' : ''}/> ${eventId}`;
      label.querySelector('input').addEventListener('change', updateStageEventSelectors);
      stage1ValEventsBox.appendChild(label);
    });

    const checkedVal = new Set(Array.from(stage1ValEventsBox.querySelectorAll('input:checked')).map(i => i.value));
    stage1TestEventsBox.innerHTML = '';
    events.filter(e => !checkedTrain.has(e) && !checkedVal.has(e)).forEach((eventId, idx) => {
      const defaultChecked = previousTest.size ? previousTest.has(eventId) : idx < Math.min(4, Math.max(events.length - checkedTrain.size - checkedVal.size, 0));
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${eventId}" ${defaultChecked ? 'checked' : ''}/> ${eventId}`;
      label.querySelector('input').addEventListener('change', updateStageEventSelectors);
      stage1TestEventsBox.appendChild(label);
    });

    const checkedTest = new Set(Array.from(stage1TestEventsBox.querySelectorAll('input:checked')).map(i => i.value));
    const stage2Candidates = events.filter(e => checkedTest.has(e));
    stage2EventSelect.innerHTML = stage2Candidates.map(e => `<option value="${e}">${e}</option>`).join('');
    if (!stage2Candidates.length) stage2EventSelect.innerHTML = '<option value=>Select at least one Stage 1 test event</option>';
  }

  function renderStageEventBoxes() {
    updateStageEventSelectors();
  }

  function renderRainfallBoxes() {
    rainfallEventContainer.innerHTML = '';
    state.ml.detectedEvents.forEach(eventId => {
      const defaults = state.rainfallDefaults[eventId] || { E: 0, D: 0, PI: 0 };
      if (!state.ml.rainfall[eventId]) state.ml.rainfall[eventId] = { E: defaults.E, D: defaults.D, PI: defaults.PI };
      const values = state.ml.rainfall[eventId];
      const card = document.createElement('div'); card.className = 'geotop-card';
      card.innerHTML = `
        <div class="geotop-title">Rainfall event ${eventId}</div>
        <div class="field-grid two-col">
          <div class="field-group"><label class="field-label">Accumulated rainfall (E)</label><input class="field-input" data-k="E" type="number" step="any" value="${values.E}" /></div>
          <div class="field-group"><label class="field-label">Rainfall duration (D)</label><input class="field-input" data-k="D" type="number" step="any" value="${values.D}" /></div>
          <div class="field-group"><label class="field-label">Peak intensity rainfall (PI)</label><input class="field-input" data-k="PI" type="number" step="any" value="${values.PI}" /></div>
        </div>`;
      card.querySelectorAll('[data-k]').forEach(input => {
        input.addEventListener('input', () => { state.ml.rainfall[eventId][input.dataset.k] = parseFloat(input.value || '0'); });
      });
      rainfallEventContainer.appendChild(card);
    });
  }

  function renderMlMapLayerControls() {
    mlMapLayersList.innerHTML = '';
    if (!state.ml.mapFiles.length) {
      mlMapLayersList.innerHTML = '<div class="summary-box">No raster maps detected yet.</div>';
      return;
    }
    state.ml.mapFiles.forEach((file, idx) => {
      const displayName = file.webkitRelativePath || getSafeFileName(file, `map_${idx + 1}.asc`);
      const row = document.createElement('div'); row.className = 'layer-row';
      row.innerHTML = `<span>${displayName}</span><div class="layer-actions"><label><input type="checkbox"/> View</label></div>`;
      const checkbox = row.querySelector('input');
      const uniquePart = (file.webkitRelativePath || getSafeFileName(file, `map_${idx}`)).replace(/[^a-zA-Z0-9_\-.]/g, '_');
      const key = `ml_map_${idx}_${uniquePart}`;
      checkbox.addEventListener('change', async () => {
        try {
          if (checkbox.checked) {
            const overlay = await displayRasterFile(file, key, displayName);
            if (!overlay) throw new Error('No preview overlay was created');
            addConsoleLine(mlConsoleContent, 'info', `Displayed ML map: ${displayName}`);
          } else {
            removeLayerByKey(key);
          }
        } catch (err) {
          checkbox.checked = false;
          addConsoleLine(mlConsoleContent, 'err', `Failed to display ${displayName}: ${err.message}`);
          setStatus(uploadStatus, `Failed to display ${displayName}`);
        }
      });
      mlMapLayersList.appendChild(row);
    });
  }

  function parseDetectedEventsFromFormFiles(files) {
    const set = new Set();
    files.forEach(file => {
      const path = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
      if (/PoF\.asc$/i.test(path)) {
        const parts = path.split('/');
        if (parts.length >= 2) set.add(parts[parts.length - 2]);
      }
    });
    return [...set].sort();
  }

  async function runDataPreparation() {
    if (!(await checkBackend())) return;
    if (!state.ml.mapFiles.length || !state.ml.formOutputFiles.length) {
      addConsoleLine(mlConsoleContent, 'err', 'Upload map folder and FORM outputs folder first.');
      return;
    }
    activateRightPanel('mlPanel'); activateVizPanel('mlRunningPanel');
    dataPrepStatus.textContent = 'Preparing and uploading data...';
    const fd = new FormData();
    fd.append('rainfall_json', JSON.stringify(state.ml.rainfall));
    state.ml.mapFiles.forEach(file => fd.append('map_files', file, file.webkitRelativePath || file.name));
    state.ml.formOutputFiles.forEach(file => fd.append('form_output_files', file, file.webkitRelativePath || file.name));
    try {
      const res = await fetch(`${apiBase()}/api/ml/prepare`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      state.ml.prepJobId = data.job_id;
      addConsoleLine(mlConsoleContent, 'info', `Data preparation job ${data.job_id} started`);
      pollJob(data.job_id, null, 'ml_prepare');
    } catch (err) {
      dataPrepStatus.textContent = `Data preparation failed to start: ${err.message}`;
      addConsoleLine(mlConsoleContent, 'err', err.message);
    }
  }

  async function handlePrepCompleted(job) {
    state.ml.prepJobId = job.job_id;
    dataPrepStatus.textContent = `Data preparation completed. stage1_base_dataset.csv ready.`;
    const previewUrl = `${apiBase()}${job.outputs['stage1_base_dataset_preview.csv'] || job.outputs['stage1_base_dataset_preview.csv'.replace('.csv','')] || ''}`;
    const previewKey = Object.keys(job.outputs).find(k => k.toLowerCase().includes('preview'));
    if (previewKey) {
      const previewText = await fetch(`${apiBase()}${job.outputs[previewKey]}`).then(r => r.text()).catch(() => 'Preview unavailable');
      dataPrepContent.textContent = previewText;
      activateVizPanel('dataPrepPanel');
    }
    updateResultSummary(`ML data preparation completed.\n${JSON.stringify(job.summary, null, 2)}`);
  }

  function collectMlConfig() {
    const params = {};
    mlHyperparametersGrid.querySelectorAll('[data-ml-param]').forEach(input => { params[input.dataset.mlParam] = parseFloat(input.value); });
    const trainEvents = Array.from(stage1TrainEventsBox.querySelectorAll('input:checked')).map(i => i.value);
    const testEvents = Array.from(stage1TestEventsBox.querySelectorAll('input:checked')).map(i => i.value);
    const valEvents = Array.from(stage1ValEventsBox.querySelectorAll('input:checked')).map(i => i.value);
    return {
      ...params,
      stage1_train_events: trainEvents,
      stage1_test_events: testEvents,
      stage1_val_events: valEvents,
      stage2_enabled: stage2EnabledInput.checked,
      stage2_event: stage2EnabledInput.checked ? stage2EventSelect.value : null
    };
  }

  async function runMachineLearning() {
    if (!(await checkBackend())) return;
    if (!state.ml.prepJobId) {
      addConsoleLine(mlConsoleContent, 'err', 'Run data preparation first.');
      return;
    }
    activateRightPanel('mlPanel'); activateVizPanel('mlRunningPanel');
    mlRunStatus.textContent = 'Starting machine learning...';
    const fd = new FormData();
    fd.append('prep_job_id', state.ml.prepJobId);
    fd.append('config_json', JSON.stringify(collectMlConfig()));
    if (stage2EnabledInput.checked && state.ml.labelFile) fd.append('label_file', state.ml.labelFile, state.ml.labelFile.name);
    try {
      const res = await fetch(`${apiBase()}/api/ml/run`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      state.ml.mlJobId = data.job_id;
      addConsoleLine(mlConsoleContent, 'info', `Machine learning job ${data.job_id} started`);
      pollJob(data.job_id, null, 'ml_run');
    } catch (err) {
      mlRunStatus.textContent = `Machine learning failed to start: ${err.message}`;
      addConsoleLine(mlConsoleContent, 'err', err.message);
    }
  }

  function handleMlCompleted(job) {
    mlRunStatus.textContent = 'Machine learning completed.';
    mlResultLayersList.innerHTML = '';
    Object.entries(job.outputs).forEach(([name, relativeUrl]) => {
      if (!name.toLowerCase().endsWith('.asc')) return;
      const row = document.createElement('div'); row.className = 'layer-row';
      const fullUrl = `${apiBase()}${relativeUrl}`;
      row.innerHTML = `<span>${name}</span><div class="layer-actions"><label><input type="checkbox" ${name.toLowerCase().includes('stage2_final_prob') ? 'checked' : ''}/> View</label><a href="${fullUrl}" target="_blank" rel="noopener">Download</a></div>`;
      const key = `ml_result_${job.job_id}_${name}`;
      const checkbox = row.querySelector('input');
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) await displayAscUrl(fullUrl, key, name);
        else removeLayerByKey(key);
      });
      mlResultLayersList.appendChild(row);
      if (checkbox.checked) displayAscUrl(fullUrl, key, name).catch(() => {});
    });

    mlPlotsContent.innerHTML = '';
    Object.entries(job.plots || {}).forEach(([name, relativeUrl]) => {
      const fullUrl = `${apiBase()}${relativeUrl}`;
      const card = document.createElement('div'); card.className = 'plot-card';
      card.innerHTML = `<div class="field-label">${name}</div><img src="${fullUrl}" alt="${name}" /><a href="${fullUrl}" target="_blank" rel="noopener">Download</a>`;
      mlPlotsContent.appendChild(card);
    });
    activateVizPanel('mlAnalysePanel');
    updateResultSummary(`Machine learning completed.\n${JSON.stringify(job.summary, null, 2)}`);
  }

  function onRasterSelected(key, file) {
    state.formInputs[key] = file;
    const configKey = key === 'soilType' ? 'soilType' : key === 'soilThickness' ? 'soilThickness' : key;
    rasterConfigs[configKey].selectedFile.textContent = file ? getSafeFileName(file, key) : 'None';
    rasterConfigs[configKey].viewToggle.disabled = !file;
    rasterConfigs[configKey].viewToggle.checked = !!file;
    if (file) displayRasterFile(file, `base_${key}`, getSafeFileName(file, key)).catch(err => { addConsoleLine(consoleContent, 'err', `Failed to load ${getSafeFileName(file, key)}: ${err.message}`); setStatus(uploadStatus, `Failed to load ${getSafeFileName(file, key)}`); });
    updateInputSummary();
  }

  Object.entries(rasterConfigs).forEach(([key, cfg]) => {
    const stateKey = key === 'soilType' ? 'soilType' : key === 'soilThickness' ? 'soilThickness' : key;

    cfg.input.addEventListener('change', async () => {
      const file = cfg.input.files && cfg.input.files[0];
      if (!file) return;
      onRasterSelected(stateKey, file);
      try {
        await displayRasterFile(file, `base_${stateKey}`, cfg.label);
        cfg.viewToggle.checked = true;
        addConsoleLine(consoleContent, 'info', `${cfg.label} loaded: ${getSafeFileName(file, stateKey)}`);
      } catch (err) {
        cfg.viewToggle.checked = false;
        addConsoleLine(consoleContent, 'err', `Failed to load ${getSafeFileName(file, stateKey)}: ${err.message}`);
        setStatus(uploadStatus, `Failed to load ${getSafeFileName(file, stateKey)}`);
      }
    });

    cfg.viewToggle.addEventListener('change', async () => {
      const file = state.formInputs[stateKey];
      const layerKey = `base_${stateKey}`;
      if (!file) return;
      try {
        if (cfg.viewToggle.checked) {
          if (rasterLayers[layerKey] && rasterLayers[layerKey].layer) {
            rasterLayers[layerKey].layer.addTo(map);
            rasterLayers[layerKey].visible = true;
            activeLayerKey = layerKey;
            map.fitBounds(rasterLayers[layerKey].bounds, { padding: [20, 20] });
            updateRasterStats(rasterLayers[layerKey].min, rasterLayers[layerKey].max, rasterLayers[layerKey].width, rasterLayers[layerKey].height, rasterLayers[layerKey].label);
            updateColorbar(rasterLayers[layerKey].min, rasterLayers[layerKey].max);
            mapEmptyNote.style.display = 'none';
          } else {
            await displayRasterFile(file, layerKey, cfg.label);
          }
        } else {
          removeLayerByKey(layerKey);
        }
      } catch (err) {
        cfg.viewToggle.checked = false;
        addConsoleLine(consoleContent, 'err', `Failed to display ${getSafeFileName(file, stateKey)}: ${err.message}`);
      }
    });
  });

  mlMapsFolderInput.addEventListener('change', () => {
    state.ml.mapFiles = Array.from(mlMapsFolderInput.files || []).filter(f => /\.(asc|tif|tiff)$/i.test(getSafeFileName(f)));
    mlMapsSummary.textContent = state.ml.mapFiles.length ? `${state.ml.mapFiles.length} raster map files detected. First files: ${state.ml.mapFiles.slice(0,3).map(f => getSafeFileName(f, 'unknown')).join(', ')}${state.ml.mapFiles.length > 3 ? ' ...' : ''}` : 'No raster map files detected.';
    renderMlMapLayerControls();
    updateInputSummary();
  });

  mlFormOutputsFolderInput.addEventListener('change', () => {
    state.ml.formOutputFiles = Array.from(mlFormOutputsFolderInput.files || []).filter(f => /\.(asc|txt|csv)$/i.test(f.name));
    state.ml.detectedEvents = parseDetectedEventsFromFormFiles(state.ml.formOutputFiles);
    mlFormOutputsSummary.textContent = state.ml.formOutputFiles.length ? `${state.ml.formOutputFiles.length} files uploaded from FORM outputs folder.` : 'No FORM output files detected.';
    mlDetectedEventsBox.textContent = state.ml.detectedEvents.length ? `Detected event_id from PoF.asc folders:\n${state.ml.detectedEvents.join(', ')}` : 'No event folders with PoF.asc detected.';
    renderRainfallBoxes();
    renderStageEventBoxes();
    updateInputSummary();
  });

  landslideLabelInput.addEventListener('change', () => {
    state.ml.labelFile = landslideLabelInput.files && landslideLabelInput.files[0] ? landslideLabelInput.files[0] : null;
    landslideLabelSummary.textContent = state.ml.labelFile ? state.ml.labelFile.name : 'None';
    landslideLabelViewToggle.disabled = !state.ml.labelFile;
    landslideLabelViewToggle.checked = !!state.ml.labelFile;
    if (state.ml.labelFile) displayRasterFile(state.ml.labelFile, 'ml_label_map', getSafeFileName(state.ml.labelFile, 'landslide_label.asc')).catch(() => {});
    landslideLabelViewToggle.onchange = async () => {
      if (landslideLabelViewToggle.checked && state.ml.labelFile) await displayRasterFile(state.ml.labelFile, 'ml_label_map', getSafeFileName(state.ml.labelFile, 'landslide_label.asc'));
      else removeLayerByKey('ml_label_map');
    };
  });

  document.querySelectorAll('.viz-tab').forEach(btn => btn.addEventListener('click', () => activateVizPanel(btn.dataset.viz)));
  document.querySelectorAll('.right-workflow-tab').forEach(btn => btn.addEventListener('click', () => activateRightPanel(btn.dataset.rightPanel)));
  basemapSelect.addEventListener('change', () => setBaseLayer(basemapSelect.value));
  document.getElementById('resetViewBtn').addEventListener('click', () => map.setView(defaultMapView.center, defaultMapView.zoom));
  document.getElementById('fitLayerBtn').addEventListener('click', () => { if (activeLayerKey && rasterLayers[activeLayerKey]) map.fitBounds(rasterLayers[activeLayerKey].bounds, { padding: [20,20] }); });
  document.getElementById('clearLayerBtn').addEventListener('click', clearAllLayers);
  checkBackendBtn.addEventListener('click', checkBackend);
  generateFormInputsBtn.addEventListener('click', createSoilInputs);
  generateGeotopRunsBtn.addEventListener('click', createGeotopCards);
  runDataPrepBtn.addEventListener('click', runDataPreparation);
  runMlBtn.addEventListener('click', runMachineLearning);
  stage2EnabledInput.addEventListener('change', () => { stage2ConfigWrap.style.display = stage2EnabledInput.checked ? 'block' : 'none'; });

  backendUrlInput.value = state.backendUrl;
  initMap();
  createSoilInputs();
  createGeotopCards();
  initMlHyperparameters();
  stage2ConfigWrap.style.display = stage2EnabledInput.checked ? 'block' : 'none';
  updateInputSummary();
  checkBackend();
})();
