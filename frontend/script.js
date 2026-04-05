(function () {
  const defaultBackendUrl = 'http://127.0.0.1:8000';
  const defaultMapView = { center: [29.72, 119.96], zoom: 10 };

  const rasterConfigs = {
    dem: { label: 'DEM', input: document.getElementById('demFileInput'), selectedFile: document.getElementById('demSelectedFile'), viewToggle: document.getElementById('demViewToggle') },
    slope: { label: 'Slope', input: document.getElementById('slopeFileInput'), selectedFile: document.getElementById('slopeSelectedFile'), viewToggle: document.getElementById('slopeViewToggle') },
    soilType: { label: 'Soil Type', input: document.getElementById('soilTypeFileInput'), selectedFile: document.getElementById('soilTypeSelectedFile'), viewToggle: document.getElementById('soilTypeViewToggle') },
    soilThickness: { label: 'Soil Thickness', input: document.getElementById('soilThicknessFileInput'), selectedFile: document.getElementById('soilThicknessSelectedFile'), viewToggle: document.getElementById('soilThicknessViewToggle') },
  };

  const crsSelect = document.getElementById('crsSelect');
  const uploadStatus = document.getElementById('uploadStatus');
  const rasterStats = document.getElementById('rasterStats');
  const pwpFolderInput = document.getElementById('pwpFolderInput');
  const pwpFolderSummary = document.getElementById('pwpFolderSummary');
  const pwpFileList = document.getElementById('pwpFileList');
  const formSoilTypeCount = document.getElementById('formSoilTypeCount');
  const generateFormInputsBtn = document.getElementById('generateFormInputsBtn');
  const formSoilTypeContainer = document.getElementById('formSoilTypeContainer');
  const psiFileStyleSelect = document.getElementById('psiFileStyleSelect');
  const psiUnitSelect = document.getElementById('psiUnitSelect');
  const soilThicknessUnitSelect = document.getElementById('soilThicknessUnitSelect');
  const useMultipleTimestepsInput = document.getElementById('useMultipleTimestepsInput');
  const singleTimeCodeInput = document.getElementById('singleTimeCodeInput');
  const runFormBtn = document.getElementById('runFormBtn');
  const runStatusBox = document.getElementById('runStatusBox');
  const consoleContent = document.getElementById('consoleContent');
  const inputSummaryContent = document.getElementById('inputSummaryContent');
  const resultSummaryContent = document.getElementById('resultSummaryContent');
  const resultLayerControls = document.getElementById('resultLayerControls');
  const backendUrlInput = document.getElementById('backendUrlInput');
  const checkBackendBtn = document.getElementById('checkBackendBtn');
  const backendStatus = document.getElementById('backendStatus');
  const basemapSelect = document.getElementById('basemapSelect');
  const resetViewBtn = document.getElementById('resetViewBtn');
  const fitLayerBtn = document.getElementById('fitLayerBtn');
  const clearLayerBtn = document.getElementById('clearLayerBtn');
  const mapEmptyNote = document.getElementById('mapEmptyNote');
  const colorbarPanel = document.getElementById('colorbarPanel');
  const colorbarMin = document.getElementById('colorbarMin');
  const colorbarMid = document.getElementById('colorbarMid');
  const colorbarMax = document.getElementById('colorbarMax');

  const state = {
    map: null,
    currentBaseLayer: null,
    rasterLayers: {},
    activeLayerKey: null,
    uploadedFiles: { dem: null, slope: null, soilType: null, soilThickness: null },
    pwpFiles: [],
    currentJobId: null,
    pollHandle: null,
    resultFiles: {},
  };

  const baseLayerConfigs = {
    osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { attribution: '© OpenStreetMap contributors' } },
    terrain: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', options: { attribution: '© OpenTopoMap contributors' } },
    voyager: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', options: { attribution: '© OpenStreetMap contributors, © CARTO' } },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', options: { attribution: 'Tiles © Esri' } },
  };

  if (typeof proj4 !== 'undefined') {
    proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs');
    proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs +type=crs');
    proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs');
    proj4.defs('EPSG:4549', '+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs');
  }

  function backendUrl() { return (backendUrlInput.value || defaultBackendUrl).replace(/\/$/, ''); }

  function addConsoleLine(type, message) {
    const line = document.createElement('div');
    line.className = 'log-line ' + (type || 'info');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleContent.appendChild(line);
    consoleContent.scrollTop = consoleContent.scrollHeight;
  }

  function setStatus(message) { uploadStatus.textContent = message; }

  async function checkBackend() {
    backendStatus.textContent = 'Checking...';
    backendStatus.className = '';
    try {
      const res = await fetch(`${backendUrl()}/api/health`);
      if (!res.ok) throw new Error('Health check failed');
      const data = await res.json();
      backendStatus.textContent = `Connected (${data.status})`;
      backendStatus.className = 'ok';
      addConsoleLine('info', `Backend connected: ${backendUrl()}`);
    } catch (err) {
      backendStatus.textContent = 'Not reachable';
      backendStatus.className = 'bad';
      addConsoleLine('err', `Backend not reachable: ${err.message}`);
    }
  }

  function initMap() {
    state.map = L.map('map', { center: defaultMapView.center, zoom: defaultMapView.zoom, zoomControl: true });
    setBaseLayer('osm');
  }

  function setBaseLayer(key) {
    if (!state.map || !baseLayerConfigs[key]) return;
    if (state.currentBaseLayer) state.map.removeLayer(state.currentBaseLayer);
    const cfg = baseLayerConfigs[key];
    state.currentBaseLayer = L.tileLayer(cfg.url, cfg.options).addTo(state.map);
  }

  function resetMapView() { if (state.map) state.map.setView(defaultMapView.center, defaultMapView.zoom); }

  function clearAllLayers() {
    Object.keys(state.rasterLayers).forEach(key => {
      const item = state.rasterLayers[key];
      if (item.layer && state.map.hasLayer(item.layer)) state.map.removeLayer(item.layer);
    });
    state.rasterLayers = {};
    state.activeLayerKey = null;
    mapEmptyNote.style.display = 'block';
    rasterStats.textContent = 'No active layer';
    colorbarPanel.style.display = 'none';
  }

  function fitActiveLayer() {
    const item = state.rasterLayers[state.activeLayerKey];
    if (item && item.bounds) state.map.fitBounds(item.bounds, { padding: [20, 20] });
  }

  function parseAsc(text) {
    const lines = text.replace(/\r/g, '').trim().split('\n');
    const header = {};
    let dataStart = 0;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase();
        if (['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize', 'nodata_value'].includes(key)) {
          header[key] = parseFloat(parts[1]);
          dataStart = i + 1;
        }
      }
    }

    const width = parseInt(header.ncols, 10);
    const height = parseInt(header.nrows, 10);
    if (!width || !height) throw new Error('Invalid ASC header');
    const nodata = header.nodata_value;
    const values = [];
    for (let r = dataStart; r < lines.length; r++) {
      const row = lines[r].trim();
      if (!row) continue;
      row.split(/\s+/).forEach(part => {
        const value = parseFloat(part);
        if (Number.isFinite(value)) values.push(value);
      });
    }
    const grid = new Float32Array(values.slice(0, width * height));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      const val = grid[i];
      if (!Number.isFinite(val) || (typeof nodata !== 'undefined' && val === nodata)) {
        grid[i] = NaN;
      } else {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    return {
      width,
      height,
      grid,
      min,
      max,
      xll: header.xllcorner ?? header.xllcenter ?? 0,
      yll: header.yllcorner ?? header.yllcenter ?? 0,
      cellsize: header.cellsize ?? 1,
    };
  }

  function renderGridToCanvas(width, height, grid, min, max) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    for (let i = 0; i < grid.length; i++) {
      const idx = i * 4;
      const val = grid[i];
      if (!Number.isFinite(val)) {
        data[idx + 3] = 0;
      } else {
        const norm = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
        data[idx] = Math.round(255 * norm);
        data[idx + 1] = Math.round(180 * (1 - Math.abs(norm - 0.5) * 2));
        data[idx + 2] = Math.round(255 * (1 - norm));
        data[idx + 3] = 220;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function ascLooksGeographic(asc) {
    const west = asc.xll;
    const south = asc.yll;
    const east = asc.xll + asc.width * asc.cellsize;
    const north = asc.yll + asc.height * asc.cellsize;
    return west >= -180 && west <= 180 && east >= -180 && east <= 180 && south >= -90 && south <= 90 && north >= -90 && north <= 90;
  }

  function transformPointToWGS84(x, y, sourceCRS) {
    if (sourceCRS === 'EPSG:4326' || sourceCRS === 'EPSG:4490') return [x, y];
    return proj4(sourceCRS, 'EPSG:4326', [x, y]);
  }

  function ascBoundsToLatLngBounds(asc, selectedCRS) {
    const xMin = asc.xll;
    const yMin = asc.yll;
    const xMax = asc.xll + asc.width * asc.cellsize;
    const yMax = asc.yll + asc.height * asc.cellsize;
    if (selectedCRS === 'EPSG:4326' || selectedCRS === 'EPSG:4490' || (selectedCRS === 'auto' && ascLooksGeographic(asc))) {
      return [[yMin, xMin], [yMax, xMax]];
    }
    const ll = transformPointToWGS84(xMin, yMin, selectedCRS);
    const ur = transformPointToWGS84(xMax, yMax, selectedCRS);
    return [[ll[1], ll[0]], [ur[1], ur[0]]];
  }

  function updateColorbar(min, max) {
    colorbarMax.textContent = max.toFixed(2);
    colorbarMid.textContent = ((min + max) / 2).toFixed(2);
    colorbarMin.textContent = min.toFixed(2);
    colorbarPanel.style.display = 'block';
  }

  function registerRasterLayer(layerKey, label, fileName, leafletLayer, bounds, stats, viewToggleEl) {
    if (state.rasterLayers[layerKey] && state.map.hasLayer(state.rasterLayers[layerKey].layer)) {
      state.map.removeLayer(state.rasterLayers[layerKey].layer);
    }
    state.rasterLayers[layerKey] = {
      key: layerKey,
      label,
      fileName,
      layer: leafletLayer,
      bounds,
      visible: true,
      min: stats.min,
      max: stats.max,
      width: stats.width,
      height: stats.height,
      crsText: stats.crsText,
      viewToggleEl,
    };
    if (viewToggleEl) {
      viewToggleEl.disabled = false;
      viewToggleEl.checked = true;
    }
    state.activeLayerKey = layerKey;
    rasterStats.innerHTML = `Layer: ${label}<br>Min: ${stats.min.toFixed(3)}<br>Max: ${stats.max.toFixed(3)}<br>Size: ${stats.width} × ${stats.height}<br>CRS: ${stats.crsText}`;
    updateColorbar(stats.min, stats.max);
    mapEmptyNote.style.display = 'none';
  }

  function addAscLayer(asc, fileName, layerKey, layerLabel, viewToggleEl) {
    const canvas = renderGridToCanvas(asc.width, asc.height, asc.grid, asc.min, asc.max);
    const url = canvas.toDataURL('image/png');
    const selectedCRS = crsSelect.value || 'auto';
    const bounds = ascBoundsToLatLngBounds(asc, selectedCRS);
    const crsText = selectedCRS === 'auto' ? (ascLooksGeographic(asc) ? 'Auto → EPSG:4326' : 'Auto/projected') : selectedCRS;
    const leafletLayer = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(state.map);
    state.map.fitBounds(bounds, { padding: [20, 20] });
    registerRasterLayer(layerKey, layerLabel, fileName, leafletLayer, bounds, {
      min: asc.min, max: asc.max, width: asc.width, height: asc.height, crsText,
    }, viewToggleEl);
    setStatus(`Loaded ${fileName}`);
  }

  async function addTiffLayer(file, layerKey, layerLabel, viewToggleEl) {
    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters();
    const grid = rasters[0];
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      const val = grid[i];
      if (!Number.isFinite(val)) continue;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const canvas = renderGridToCanvas(width, height, grid, min, max);
    const url = canvas.toDataURL('image/png');
    let bounds = [[29.60, 119.85], [29.85, 120.10]];
    let crsText = 'TIFF preview';
    try {
      const bbox = image.getBoundingBox();
      if (bbox && bbox.length === 4) {
        bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
        crsText = 'TIFF bbox';
      }
    } catch (err) {}
    const leafletLayer = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(state.map);
    state.map.fitBounds(bounds, { padding: [20, 20] });
    registerRasterLayer(layerKey, layerLabel, file.name, leafletLayer, bounds, { min, max, width, height, crsText }, viewToggleEl);
    setStatus(`Loaded ${file.name}`);
  }

  async function handleRasterFile(file, layerKey, layerLabel, viewToggleEl) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'asc') {
      const text = await file.text();
      const asc = parseAsc(text);
      addAscLayer(asc, file.name, layerKey, layerLabel, viewToggleEl);
    } else if (ext === 'tif' || ext === 'tiff') {
      await addTiffLayer(file, layerKey, layerLabel, viewToggleEl);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  function generateFormInputs() {
    const count = parseInt(formSoilTypeCount.value, 10);
    const defaults = [
      { soil_id: 1, name: 'Qg', phi_deg: 40.5, phi_cov: 0.02, c_kpa: 1.72, c_cov: 0.69, gamma_s: 16.87, rho_c_phi: -0.5 },
      { soil_id: 2, name: 'Hs', phi_deg: 41.4, phi_cov: 0.08, c_kpa: 2.48, c_cov: 0.51, gamma_s: 16.48, rho_c_phi: -0.5 },
      { soil_id: 3, name: 'Hi', phi_deg: 37.61, phi_cov: 0.08, c_kpa: 4.82, c_cov: 0.29, gamma_s: 15.5, rho_c_phi: -0.5 },
    ];
    formSoilTypeContainer.innerHTML = '';
    for (let i = 1; i <= count; i++) {
      const base = defaults[i - 1] || { soil_id: i, name: `Soil ${i}`, phi_deg: 40, phi_cov: 0.05, c_kpa: 2, c_cov: 0.5, gamma_s: 16, rho_c_phi: -0.5 };
      const card = document.createElement('div');
      card.className = 'soil-param-card';
      card.innerHTML = `
        <div class="soil-param-title">Soil type ${i}</div>
        <div class="soil-param-grid">
          <div><label class="field-label">soil_id</label><input class="field-input" id="soil_id_${i}" type="number" value="${base.soil_id}" /></div>
          <div><label class="field-label">name</label><input class="field-input" id="soil_name_${i}" type="text" value="${base.name}" /></div>
          <div><label class="field-label">phi_deg</label><input class="field-input" id="phi_deg_${i}" type="number" step="any" value="${base.phi_deg}" /></div>
          <div><label class="field-label">phi_cov</label><input class="field-input" id="phi_cov_${i}" type="number" step="any" value="${base.phi_cov}" /></div>
          <div><label class="field-label">c_kpa</label><input class="field-input" id="c_kpa_${i}" type="number" step="any" value="${base.c_kpa}" /></div>
          <div><label class="field-label">c_cov</label><input class="field-input" id="c_cov_${i}" type="number" step="any" value="${base.c_cov}" /></div>
          <div><label class="field-label">gamma_s</label><input class="field-input" id="gamma_s_${i}" type="number" step="any" value="${base.gamma_s}" /></div>
          <div><label class="field-label">rho_c_phi</label><input class="field-input" id="rho_c_phi_${i}" type="number" step="any" value="${base.rho_c_phi}" /></div>
        </div>
      `;
      formSoilTypeContainer.appendChild(card);
    }
  }

  function collectSoilParams() {
    const count = parseInt(formSoilTypeCount.value, 10);
    const soilParams = [];
    for (let i = 1; i <= count; i++) {
      soilParams.push({
        soil_id: Number(document.getElementById(`soil_id_${i}`).value),
        name: document.getElementById(`soil_name_${i}`).value,
        phi_deg: Number(document.getElementById(`phi_deg_${i}`).value),
        phi_cov: Number(document.getElementById(`phi_cov_${i}`).value),
        c_kpa: Number(document.getElementById(`c_kpa_${i}`).value),
        c_cov: Number(document.getElementById(`c_cov_${i}`).value),
        gamma_s: Number(document.getElementById(`gamma_s_${i}`).value),
        rho_c_phi: Number(document.getElementById(`rho_c_phi_${i}`).value),
      });
    }
    return soilParams;
  }

  function buildInputSummary() {
    const lines = [];
    lines.push(`<b>Required maps</b>`);
    lines.push(`Slope: ${state.uploadedFiles.slope ? state.uploadedFiles.slope.name : 'Missing'}`);
    lines.push(`Soil type: ${state.uploadedFiles.soilType ? state.uploadedFiles.soilType.name : 'Missing'}`);
    lines.push(`Soil thickness: ${state.uploadedFiles.soilThickness ? state.uploadedFiles.soilThickness.name : 'Missing'}`);
    lines.push(`DEM: ${state.uploadedFiles.dem ? state.uploadedFiles.dem.name : 'Not uploaded'}`);
    lines.push('');
    lines.push(`<b>GeoTOP folder</b>`);
    lines.push(`PWP files detected: ${state.pwpFiles.length}`);
    lines.push(`PWP file style: ${psiFileStyleSelect.value}`);
    lines.push(`PWP unit: ${psiUnitSelect.value}`);
    lines.push(`Soil thickness unit: ${soilThicknessUnitSelect.value}`);
    lines.push(`Use all time steps: ${useMultipleTimestepsInput.checked ? 'Yes' : 'No'}`);
    lines.push(`Single time code: ${singleTimeCodeInput.value}`);
    inputSummaryContent.innerHTML = lines.join('<br>');
  }

  function detectTimeCodes(files) {
    const pattern = psiFileStyleSelect.value === 'psiz' ? /^psizL0000N(\d+)\.asc$/i : /^SoilLiqWaterPressL0000N(\d+)\.asc$/i;
    const codes = new Set();
    files.forEach(file => {
      const match = file.name.match(pattern);
      if (match) codes.add(match[1]);
    });
    return Array.from(codes).sort((a, b) => Number(a) - Number(b));
  }

  function summarizePwpFiles(files) {
    const codes = detectTimeCodes(files);
    const preview = files.slice(0, 12).map(f => f.webkitRelativePath || f.name).join('\n');
    pwpFolderSummary.innerHTML = `Files: ${files.length}<br>Detected time codes: ${codes.length ? codes.join(', ') : 'None detected yet'}`;
    pwpFileList.textContent = preview || 'No files in selection';
  }

  function validateBeforeRun() {
    if (!state.uploadedFiles.slope) return 'Upload slope.asc first';
    if (!state.uploadedFiles.soilType) return 'Upload soiltype.asc first';
    if (!state.uploadedFiles.soilThickness) return 'Upload soilthickness.asc first';
    if (!state.pwpFiles.length) return 'Select the GeoTOP PWP folder first';
    return null;
  }

  async function startFormRun() {
    const validationError = validateBeforeRun();
    if (validationError) {
      runStatusBox.textContent = validationError;
      addConsoleLine('err', validationError);
      return;
    }

    runFormBtn.disabled = true;
    runStatusBox.textContent = 'Uploading inputs and starting job...';
    addConsoleLine('info', 'Submitting FORM job to backend');

    const settings = {
      psi_file_style: psiFileStyleSelect.value,
      psi_unit: psiUnitSelect.value,
      soilthickness_unit: soilThicknessUnitSelect.value,
      use_multiple_timesteps: useMultipleTimestepsInput.checked,
      single_time_code: singleTimeCodeInput.value || '0001',
      soil_params: collectSoilParams(),
    };

    const formData = new FormData();
    formData.append('settings_json', JSON.stringify(settings));
    formData.append('slope_file', state.uploadedFiles.slope);
    formData.append('soiltype_file', state.uploadedFiles.soilType);
    formData.append('soilthickness_file', state.uploadedFiles.soilThickness);
    if (state.uploadedFiles.dem) formData.append('dem_file', state.uploadedFiles.dem);
    state.pwpFiles.forEach(file => formData.append('pwp_files', file, file.name));

    try {
      const response = await fetch(`${backendUrl()}/api/form/run`, { method: 'POST', body: formData });
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(txt || 'Failed to start run');
      }
      const data = await response.json();
      state.currentJobId = data.job_id;
      runStatusBox.textContent = `Job started: ${data.job_id}`;
      startPolling();
    } catch (err) {
      runStatusBox.textContent = 'Failed to start';
      addConsoleLine('err', `FORM start failed: ${err.message}`);
      runFormBtn.disabled = false;
    }
  }

  function startPolling() {
    if (state.pollHandle) clearInterval(state.pollHandle);
    pollJob();
    state.pollHandle = setInterval(pollJob, 1200);
  }

  async function pollJob() {
    if (!state.currentJobId) return;
    try {
      const response = await fetch(`${backendUrl()}/api/jobs/${state.currentJobId}`);
      if (!response.ok) throw new Error('Polling failed');
      const job = await response.json();
      syncConsole(job.logs || []);
      renderResultSummary(job);
      if (job.status === 'completed') {
        runStatusBox.textContent = 'Completed';
        runFormBtn.disabled = false;
        clearInterval(state.pollHandle);
        state.pollHandle = null;
        await loadOutputLayers(job);
      } else if (job.status === 'failed') {
        runStatusBox.textContent = `Failed: ${job.error || 'Unknown error'}`;
        runFormBtn.disabled = false;
        clearInterval(state.pollHandle);
        state.pollHandle = null;
      } else {
        runStatusBox.textContent = `Status: ${job.status}`;
      }
    } catch (err) {
      addConsoleLine('err', `Polling error: ${err.message}`);
    }
  }

  function syncConsole(logs) {
    consoleContent.innerHTML = '';
    logs.forEach(entry => {
      const type = entry.includes('ERROR') ? 'err' : entry.includes('warning') ? 'warn' : 'info';
      const line = document.createElement('div');
      line.className = 'log-line ' + type;
      line.textContent = entry;
      consoleContent.appendChild(line);
    });
    consoleContent.scrollTop = consoleContent.scrollHeight;
  }

  function renderResultSummary(job) {
    const lines = [];
    lines.push(`<b>Status</b>: ${job.status}`);
    if (job.error) lines.push(`<b>Error</b>: ${job.error}`);
    if (job.summary) {
      Object.keys(job.summary).forEach(key => lines.push(`<b>${key}</b>: ${job.summary[key]}`));
    }
    resultSummaryContent.innerHTML = lines.join('<br>') || 'No result summary yet.';
  }

  async function loadOutputLayers(job) {
    state.resultFiles = {};
    const names = ['PoF.asc', 'FS_min.asc', 'FS_min_depth.asc', 'beta.asc'];
    for (const name of names) {
      if (!job.outputs || !job.outputs[name]) continue;
      const textUrl = `${backendUrl()}/api/jobs/${state.currentJobId}/outputs/${encodeURIComponent(name)}/text`;
      const response = await fetch(textUrl);
      if (!response.ok) continue;
      const text = await response.text();
      const asc = parseAsc(text);
      state.resultFiles[name] = { text, asc, downloadUrl: `${backendUrl()}${job.outputs[name]}` };
    }
    renderResultLayerControls();
    if (state.resultFiles['PoF.asc']) showResultLayer('PoF.asc');
  }

  function renderResultLayerControls() {
    const entries = Object.entries(state.resultFiles);
    if (!entries.length) {
      resultLayerControls.textContent = 'No FORM outputs yet.';
      return;
    }
    resultLayerControls.innerHTML = '';
    entries.forEach(([name, info]) => {
      const row = document.createElement('div');
      row.className = 'result-layer-row';
      row.innerHTML = `
        <div class="result-layer-name">${name}</div>
        <div class="result-layer-actions">
          <label><input type="radio" name="activeResultLayer" ${name === 'PoF.asc' ? 'checked' : ''}/> View</label>
          <a href="${info.downloadUrl}" target="_blank" rel="noopener">Download</a>
        </div>
      `;
      row.querySelector('input[type="radio"]').addEventListener('change', () => showResultLayer(name));
      resultLayerControls.appendChild(row);
    });
  }

  function showResultLayer(name) {
    const result = state.resultFiles[name];
    if (!result) return;
    addAscLayer(result.asc, name, `result_${name}`, name.replace('.asc', ''), null);
  }

  document.querySelectorAll('.viz-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.viz-tab').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.viz-panel').forEach(panel => panel.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.viz).classList.add('active');
    });
  });

  Object.keys(rasterConfigs).forEach(layerKey => {
    const cfg = rasterConfigs[layerKey];
    cfg.input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      cfg.selectedFile.textContent = file.name;
      state.uploadedFiles[layerKey] = file;
      try {
        await handleRasterFile(file, layerKey, cfg.label, cfg.viewToggle);
        buildInputSummary();
      } catch (err) {
        addConsoleLine('err', err.message);
      }
    });
    cfg.viewToggle.addEventListener('change', () => {
      const layerObj = state.rasterLayers[layerKey];
      if (!layerObj) return;
      if (cfg.viewToggle.checked) {
        layerObj.layer.addTo(state.map);
        state.activeLayerKey = layerKey;
      } else if (state.map.hasLayer(layerObj.layer)) {
        state.map.removeLayer(layerObj.layer);
      }
    });
  });

  pwpFolderInput.addEventListener('change', e => {
    state.pwpFiles = Array.from(e.target.files || []).filter(file => file.name.toLowerCase().endsWith('.asc'));
    summarizePwpFiles(state.pwpFiles);
    buildInputSummary();
    setStatus(`Loaded ${state.pwpFiles.length} PWP files from folder selection`);
  });

  generateFormInputsBtn.addEventListener('click', generateFormInputs);
  runFormBtn.addEventListener('click', startFormRun);
  checkBackendBtn.addEventListener('click', checkBackend);
  basemapSelect.addEventListener('change', e => setBaseLayer(e.target.value));
  resetViewBtn.addEventListener('click', resetMapView);
  fitLayerBtn.addEventListener('click', fitActiveLayer);
  clearLayerBtn.addEventListener('click', clearAllLayers);

  initMap();
  generateFormInputs();
  buildInputSummary();
  checkBackend();
  addConsoleLine('info', 'Frontend ready');
})();
