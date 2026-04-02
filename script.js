(function () {
  const rasterConfigs = {
    dem: {
      label: 'DEM Data',
      input: document.getElementById('demFileInput'),
      selectedFile: document.getElementById('demSelectedFile'),
      viewToggle: document.getElementById('demViewToggle')
    },
    slope: {
      label: 'Slope Map',
      input: document.getElementById('slopeFileInput'),
      selectedFile: document.getElementById('slopeSelectedFile'),
      viewToggle: document.getElementById('slopeViewToggle')
    },
    soilType: {
      label: 'Soil Type Map',
      input: document.getElementById('soilTypeFileInput'),
      selectedFile: document.getElementById('soilTypeSelectedFile'),
      viewToggle: document.getElementById('soilTypeViewToggle')
    },
    soilThickness: {
      label: 'Soil Thickness Map',
      input: document.getElementById('soilThicknessFileInput'),
      selectedFile: document.getElementById('soilThicknessSelectedFile'),
      viewToggle: document.getElementById('soilThicknessViewToggle')
    }
  };

  const uploadStatus = document.getElementById('uploadStatus');
  const mapEmptyNote = document.getElementById('mapEmptyNote');
  const consoleContent = document.getElementById('consoleContent');
  const clearConsoleBtn = document.getElementById('clearConsoleBtn');
  const fitLayerBtn = document.getElementById('fitLayerBtn');
  const clearLayerBtn = document.getElementById('clearLayerBtn');
  const resetViewBtn = document.getElementById('resetViewBtn');
  const zoomInMapBtn = document.getElementById('zoomInMapBtn');
  const zoomOutMapBtn = document.getElementById('zoomOutMapBtn');
  const basemapSelect = document.getElementById('basemapSelect');
  const currentTimeDisplay = document.getElementById('currentTimeDisplay');
  const loginBtn = document.getElementById('loginBtn');
  const helpBtn = document.getElementById('helpBtn');

  const crsSelect = document.getElementById('crsSelect');
  const rasterStats = document.getElementById('rasterStats');
  const colorbarPanel = document.getElementById('colorbarPanel');
  const colorbarMin = document.getElementById('colorbarMin');
  const colorbarMid = document.getElementById('colorbarMid');
  const colorbarMax = document.getElementById('colorbarMax');

  const rainfallCountInput = document.getElementById('rainfallCountInput');
  const generateRainfallInputsBtn = document.getElementById('generateRainfallInputsBtn');
  const rainfallUploadContainer = document.getElementById('rainfallUploadContainer');
  const rainfallPlotArea = document.getElementById('rainfallPlotArea');

  const soilCountInput = document.getElementById('soilCountInput');
  const generateSoilInputsBtn = document.getElementById('generateSoilInputsBtn');
  const soilUploadContainer = document.getElementById('soilUploadContainer');
  const soilTableArea = document.getElementById('soilTableArea');

  const geoMapCountInput = document.getElementById('geoMapCountInput');
  const generateGeoMapInputsBtn = document.getElementById('generateGeoMapInputsBtn');
  const geoUploadContainer = document.getElementById('geoUploadContainer');

  const geotopConfigInput = document.getElementById('geotopConfigInput');
  const geotopConfigFileName = document.getElementById('geotopConfigFileName');
  const geotopConfigStatus = document.getElementById('geotopConfigStatus');
  const geotopSummaryArea = document.getElementById('geotopSummaryArea');
  const runGeotopBtn = document.getElementById('runGeotopBtn');

  const formSoilTypeCount = document.getElementById('formSoilTypeCount');
  const generateFormInputsBtn = document.getElementById('generateFormInputsBtn');
  const formSoilTypeContainer = document.getElementById('formSoilTypeContainer');
  const runFormBtn = document.getElementById('runFormBtn');

  const mlHyperparametersGrid = document.getElementById('mlHyperparametersGrid');
  const mlInventoryCountInput = document.getElementById('mlInventoryCountInput');
  const generateMlInventoryInputsBtn = document.getElementById('generateMlInventoryInputsBtn');
  const mlInventoryUploadContainer = document.getElementById('mlInventoryUploadContainer');
  const mlTrainingBtn = document.getElementById('mlTrainingBtn');
  const mlFastPredictionBtn = document.getElementById('mlFastPredictionBtn');
  const mlArPredictionBtn = document.getElementById('mlArPredictionBtn');

  const panelTabs = document.querySelectorAll('.panel-tab');
  const subPanels = document.querySelectorAll('.left-subpanel');

  const vizTabs = document.querySelectorAll('.viz-tab');
  const vizPanels = document.querySelectorAll('.viz-panel');

  const rightTabs = document.querySelectorAll('.right-tab');
  const rightSubPanels = document.querySelectorAll('.right-subpanel');

  let map = null;
  let rasterLayers = {};
  let activeLayerKey = null;
  let currentBaseLayer = null;
  let dynamicLayerCounter = 0;

  const defaultMapView = {
    center: [29.72, 119.96],
    zoom: 10
  };

  const baseLayerConfigs = {
    osm: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { attribution: 'Map data © OpenStreetMap contributors' }
    },
    terrain: {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      options: { attribution: 'Map data © OpenTopoMap contributors' }
    },
    voyager: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      options: { attribution: 'Map data © OpenStreetMap contributors, © CARTO' }
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles © Esri' }
    }
  };

  const mlHyperparametersDefaults = [
    ['BATCH_SIZE_STAGE1', '8192'],
    ['BATCH_SIZE_STAGE2', '4096'],
    ['EPOCHS_STAGE1', '80'],
    ['EPOCHS_STAGE2', '100'],
    ['LR_STAGE1', '1e-3'],
    ['LR_STAGE2', '1e-3'],
    ['WEIGHT_DECAY', '1e-5'],
    ['PATIENCE_STAGE1', '10'],
    ['PATIENCE_STAGE2', '15'],
    ['MIN_DELTA', '1e-5'],
    ['STAGE2_TRAIN_FRAC', '0.60'],
    ['STAGE2_VAL_FRAC', '0.20'],
    ['STAGE2_TEST_FRAC', '0.20'],
    ['CLASS_THRESHOLD', '0.5']
  ];

  if (typeof proj4 !== 'undefined') {
    proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs');
    proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs +type=crs');
    proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs');
    proj4.defs('EPSG:4549', '+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs');
  }

  function addConsoleLine(type, message) {
    const line = document.createElement('div');
    const now = new Date();
    const ts = now.toLocaleTimeString();
    line.style.marginBottom = '6px';
    line.style.color = type === 'err' ? '#ff6b6b' : type === 'warn' ? '#ffd166' : '#8affc1';
    line.textContent = `[${ts}] ${message}`;
    consoleContent.appendChild(line);
    consoleContent.scrollTop = consoleContent.scrollHeight;
  }

  function setStatus(message) {
    if (uploadStatus) uploadStatus.textContent = message;
  }

  function updateRasterStats(min, max, width, height, crsText, layerName) {
    if (!rasterStats) return;
    rasterStats.innerHTML =
      'Layer: ' + layerName + '<br>' +
      'Min: ' + min.toFixed(2) + '<br>' +
      'Max: ' + max.toFixed(2) + '<br>' +
      'Size: ' + width + ' × ' + height + '<br>' +
      'CRS: ' + crsText;
  }

  function updateColorbar(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    const mid = (min + max) / 2;
    colorbarMax.textContent = max.toFixed(2);
    colorbarMid.textContent = mid.toFixed(2);
    colorbarMin.textContent = min.toFixed(2);
    colorbarPanel.style.display = 'block';
  }

  function hideColorbar() {
    if (colorbarPanel) colorbarPanel.style.display = 'none';
  }

  function clearConsole() {
    consoleContent.innerHTML = '';
    addConsoleLine('info', 'Console cleared');
  }

  function updateCurrentTime() {
    if (!currentTimeDisplay) return;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });

    currentTimeDisplay.textContent =
      'Current Time (Australia/Melbourne): ' + formatter.format(now);
  }

  window.onerror = function (message, source, lineno) {
    addConsoleLine('err', `JS error: ${message} (line ${lineno})`);
  };

  window.addEventListener('unhandledrejection', function (event) {
    addConsoleLine('err', 'Promise error: ' + event.reason);
  });

  function setBaseLayer(key) {
    if (!map || !baseLayerConfigs[key]) return;

    if (currentBaseLayer && map.hasLayer(currentBaseLayer)) {
      map.removeLayer(currentBaseLayer);
    }

    const cfg = baseLayerConfigs[key];
    currentBaseLayer = L.tileLayer(cfg.url, cfg.options);
    currentBaseLayer.addTo(map);
  }

  function initMap() {
    if (typeof L === 'undefined') {
      addConsoleLine('err', 'Leaflet did not load');
      return;
    }

    map = L.map('map', {
      center: defaultMapView.center,
      zoom: defaultMapView.zoom,
      zoomControl: true
    });

    setBaseLayer('osm');
    addConsoleLine('info', 'Map initialized');
  }

  function clearAllLayers() {
    Object.keys(rasterLayers).forEach(key => {
      if (rasterLayers[key].layer && map.hasLayer(rasterLayers[key].layer)) {
        map.removeLayer(rasterLayers[key].layer);
      }
    });

    rasterLayers = {};
    activeLayerKey = null;

    Object.values(rasterConfigs).forEach(cfg => {
      if (cfg.selectedFile) cfg.selectedFile.textContent = 'None';
      if (cfg.viewToggle) {
        cfg.viewToggle.checked = true;
        cfg.viewToggle.disabled = true;
      }
    });

    mapEmptyNote.style.display = 'block';
    hideColorbar();
    if (rasterStats) rasterStats.textContent = 'No raster loaded';
  }

  function fitActiveLayer() {
    if (!activeLayerKey || !rasterLayers[activeLayerKey]) {
      addConsoleLine('warn', 'No active layer to fit');
      return;
    }

    const bounds = rasterLayers[activeLayerKey].bounds;
    if (bounds) {
      map.fitBounds(bounds, { padding: [20, 20] });
      addConsoleLine('info', 'Map fit to active layer');
    }
  }

  function resetMapView() {
    if (map) {
      map.setView(defaultMapView.center, defaultMapView.zoom);
      addConsoleLine('info', 'Map reset to default view');
    }
  }

  function parseAsc(text) {
    const lines = text.replace(/\r/g, '').trim().split('\n');
    const header = {};
    let dataStart = 0;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase();
        const value = parts[1];
        if (['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize', 'nodata_value'].includes(key)) {
          header[key] = parseFloat(value);
          dataStart = i + 1;
        }
      }
    }

    const ncols = parseInt(header.ncols, 10);
    const nrows = parseInt(header.nrows, 10);
    const nodata = header.nodata_value;

    if (!ncols || !nrows) {
      throw new Error('ASC header invalid: ncols/nrows not found');
    }

    const values = [];
    for (let r = dataStart; r < lines.length; r++) {
      const row = lines[r].trim();
      if (!row) continue;
      const nums = row.split(/\s+/);
      for (const n of nums) {
        const v = parseFloat(n);
        if (Number.isFinite(v)) values.push(v);
      }
    }

    if (values.length < ncols * nrows) {
      throw new Error('ASC data size is smaller than expected');
    }

    const sliced = values.slice(0, ncols * nrows);
    const grid = new Float32Array(sliced.length);
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < sliced.length; i++) {
      const val = sliced[i];
      if (!Number.isFinite(val) || (typeof nodata !== 'undefined' && val === nodata)) {
        grid[i] = NaN;
      } else {
        grid[i] = val;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    return {
      width: ncols,
      height: nrows,
      grid,
      min,
      max,
      xll: header.xllcorner ?? header.xllcenter ?? 0,
      yll: header.yllcorner ?? header.yllcenter ?? 0,
      cellsize: header.cellsize ?? 1
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
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
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

    return (
      west >= -180 && west <= 180 &&
      east >= -180 && east <= 180 &&
      south >= -90 && south <= 90 &&
      north >= -90 && north <= 90
    );
  }

  function transformPointToWGS84(x, y, sourceCRS) {
    if (typeof proj4 === 'undefined') {
      throw new Error('proj4 not loaded');
    }

    if (sourceCRS === 'EPSG:4326' || sourceCRS === 'EPSG:4490') {
      return [x, y];
    }

    const result = proj4(sourceCRS, 'EPSG:4326', [x, y]);

    if (!result || !isFinite(result[0]) || !isFinite(result[1])) {
      throw new Error('Invalid transformed coordinate for ' + sourceCRS);
    }

    return result;
  }

  function ascBoundsToLatLngBounds(asc, selectedCRS) {
    const xMin = asc.xll;
    const yMin = asc.yll;
    const xMax = asc.xll + asc.width * asc.cellsize;
    const yMax = asc.yll + asc.height * asc.cellsize;

    if (selectedCRS === 'EPSG:4326' || selectedCRS === 'EPSG:4490' || (selectedCRS === 'auto' && ascLooksGeographic(asc))) {
      return [[yMin, xMin], [yMax, xMax]];
    }

    if (selectedCRS === 'EPSG:3857' || selectedCRS === 'EPSG:4549') {
      const ll = transformPointToWGS84(xMin, yMin, selectedCRS);
      const ur = transformPointToWGS84(xMax, yMax, selectedCRS);
      return [[ll[1], ll[0]], [ur[1], ur[0]]];
    }

    throw new Error('Unsupported CRS selection: ' + selectedCRS);
  }

  function updateActiveFromVisibleLayers() {
    const visibleKeys = Object.keys(rasterLayers).filter(key => rasterLayers[key].visible);

    if (visibleKeys.length === 0) {
      activeLayerKey = null;
      mapEmptyNote.style.display = 'block';
      hideColorbar();
      if (rasterStats) rasterStats.textContent = 'No raster loaded';
      return;
    }

    if (!activeLayerKey || !rasterLayers[activeLayerKey] || !rasterLayers[activeLayerKey].visible) {
      activeLayerKey = visibleKeys[visibleKeys.length - 1];
    }

    const active = rasterLayers[activeLayerKey];
    updateColorbar(active.min, active.max);
    updateRasterStats(active.min, active.max, active.width, active.height, active.crsText, active.label);
    mapEmptyNote.style.display = 'none';
  }

  function registerRasterLayer(layerKey, layerLabel, fileName, leafletLayer, bounds, stats, viewToggleEl) {
    if (rasterLayers[layerKey] && rasterLayers[layerKey].layer && map.hasLayer(rasterLayers[layerKey].layer)) {
      map.removeLayer(rasterLayers[layerKey].layer);
    }

    rasterLayers[layerKey] = {
      key: layerKey,
      label: layerLabel,
      fileName,
      layer: leafletLayer,
      bounds,
      visible: true,
      min: stats.min,
      max: stats.max,
      width: stats.width,
      height: stats.height,
      crsText: stats.crsText,
      viewToggleEl: viewToggleEl || null
    };

    if (viewToggleEl) {
      viewToggleEl.disabled = false;
      viewToggleEl.checked = true;
    } else if (rasterConfigs[layerKey] && rasterConfigs[layerKey].viewToggle) {
      rasterConfigs[layerKey].viewToggle.disabled = false;
      rasterConfigs[layerKey].viewToggle.checked = true;
    }

    activeLayerKey = layerKey;
    updateActiveFromVisibleLayers();
  }

  function addAscLayer(asc, fileName, layerKey, layerLabel, viewToggleEl) {
    const canvas = renderGridToCanvas(asc.width, asc.height, asc.grid, asc.min, asc.max);
    const url = canvas.toDataURL('image/png');

    let bounds;
    let crsText = 'Auto detect';
    const selectedCRS = crsSelect ? crsSelect.value : 'auto';

    bounds = ascBoundsToLatLngBounds(asc, selectedCRS);

    if (selectedCRS === 'auto') {
      crsText = ascLooksGeographic(asc) ? 'Auto → EPSG:4326 geographic' : 'Auto → unsupported projected CRS';
    } else {
      crsText = selectedCRS;
    }

    const leafletLayer = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(map);

    map.fitBounds(bounds, { padding: [20, 20] });
    mapEmptyNote.style.display = 'none';
    setStatus('Loaded ' + fileName);

    registerRasterLayer(layerKey, layerLabel, fileName, leafletLayer, bounds, {
      min: asc.min,
      max: asc.max,
      width: asc.width,
      height: asc.height,
      crsText
    }, viewToggleEl);

    addConsoleLine('info', layerLabel + ' displayed successfully');
  }

  async function addTiffLayer(file, layerKey, layerLabel, viewToggleEl) {
    if (typeof GeoTIFF === 'undefined') {
      throw new Error('GeoTIFF library not loaded');
    }

    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters();
    const grid = rasters[0];

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const canvas = renderGridToCanvas(width, height, grid, min, max);
    const url = canvas.toDataURL('image/png');

    let bounds = [[29.60, 119.85], [29.85, 120.10]];
    let crsText = 'TIFF preview';

    try {
      const bbox = image.getBoundingBox();
      if (
        bbox && bbox.length === 4 &&
        bbox[0] >= -180 && bbox[0] <= 180 &&
        bbox[2] >= -180 && bbox[2] <= 180 &&
        bbox[1] >= -90 && bbox[1] <= 90 &&
        bbox[3] >= -90 && bbox[3] <= 90
      ) {
        bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
        crsText = 'Geographic TIFF bbox';
      }
    } catch (err) {}

    const leafletLayer = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(map);

    map.fitBounds(bounds, { padding: [20, 20] });
    mapEmptyNote.style.display = 'none';
    setStatus('Loaded ' + file.name);

    registerRasterLayer(layerKey, layerLabel, file.name, leafletLayer, bounds, {
      min,
      max,
      width,
      height,
      crsText
    }, viewToggleEl);

    addConsoleLine('info', layerLabel + ' displayed successfully');
  }

  async function handleRasterFile(file, layerKey, layerLabel, viewToggleEl) {
    try {
      if (!file) return;

      if (rasterConfigs[layerKey] && rasterConfigs[layerKey].selectedFile) {
        rasterConfigs[layerKey].selectedFile.textContent = file.name;
      }

      setStatus('Reading ' + file.name + ' ...');

      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'asc') {
        const text = await file.text();
        const asc = parseAsc(text);
        addAscLayer(asc, file.name, layerKey, layerLabel, viewToggleEl);
      } else if (ext === 'tif' || ext === 'tiff') {
        await addTiffLayer(file, layerKey, layerLabel, viewToggleEl);
      } else {
        throw new Error('Unsupported file type: ' + ext);
      }
    } catch (err) {
      setStatus('Error loading file');
      addConsoleLine('err', 'handleRasterFile error: ' + err.message);
    }
  }

  function activatePanel(panelId) {
    panelTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.panel === panelId);
    });

    subPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === panelId);
    });
  }

  function activateVizPanel(vizId) {
    vizTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.viz === vizId);
    });

    vizPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === vizId);
    });
  }

  function activateRightPanel(panelId) {
    rightTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.rightPanel === panelId);
    });

    rightSubPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === panelId);
    });
  }

  function splitLine(line) {
    if (line.includes(',')) return line.split(',');
    if (line.includes('\t')) return line.split('\t');
    return line.trim().split(/\s+/);
  }

  function parseRainfallText(text) {
    const lines = text.replace(/\r/g, '').trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new Error('Rainfall file must have at least 2 rows');

    const headers = splitLine(lines[0]).map(s => s.trim());
    if (headers.length < 2) throw new Error('Rainfall file must have at least 2 columns');

    const xLabel = headers[0];
    const yLabel = headers[1];

    const xValues = [];
    const yValues = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = splitLine(lines[i]).map(s => s.trim());
      if (parts.length < 2) continue;

      const x = parts[0];
      const y = parseFloat(parts[1]);

      if (!Number.isFinite(y)) continue;

      xValues.push(x);
      yValues.push(y);
    }

    if (yValues.length === 0) throw new Error('No valid rainfall values found');

    return { xLabel, yLabel, xValues, yValues };
  }

  function drawRainfallChart(container, dataset, title, slotId) {
    const existing = document.getElementById(slotId);
    if (existing) existing.remove();

    const empty = container.querySelector('.empty-plot-note');
    if (empty) empty.remove();

    const card = document.createElement('div');
    card.className = 'rainfall-plot-card';
    card.id = slotId;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'rainfall-plot-title';
    titleDiv.textContent = title;

    const scroll = document.createElement('div');
    scroll.className = 'chart-scroll';

    const containerWidth = Math.max(container.clientWidth || 600, 420);
    const pointCount = dataset.yValues.length;
    const baseVisibleWidth = Math.max(containerWidth - 24, 420);

    let svgWidth = baseVisibleWidth;

    /* wider chart only when needed so local scroll appears as backup */
    if (pointCount > 20) {
      svgWidth = Math.max(baseVisibleWidth, pointCount * 40);
    }

    const svgHeight = 250;
    const padL = 60;
    const padR = 20;
    const padT = 20;
    const padB = 52;
    const plotW = svgWidth - padL - padR;
    const plotH = svgHeight - padT - padB;
    const maxY = Math.max(...dataset.yValues, 1);
    const stepX = pointCount > 0 ? plotW / pointCount : plotW;
    const barWidth = Math.max(2, Math.min(20, stepX * 0.7));

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.classList.add('rainfall-chart');

    for (let i = 0; i < 5; i++) {
      const y = padT + (plotH / 4) * i;

      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', padL);
      line.setAttribute('x2', svgWidth - padR);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.10)');
      svg.appendChild(line);

      const val = maxY - (maxY / 4) * i;
      const tick = document.createElementNS(svgNS, 'text');
      tick.setAttribute('x', padL - 8);
      tick.setAttribute('y', y + 4);
      tick.setAttribute('fill', '#b6c8de');
      tick.setAttribute('font-size', '10');
      tick.setAttribute('text-anchor', 'end');
      tick.textContent = val.toFixed(2);
      svg.appendChild(tick);
    }

    const axisX = document.createElementNS(svgNS, 'line');
    axisX.setAttribute('x1', padL);
    axisX.setAttribute('x2', svgWidth - padR);
    axisX.setAttribute('y1', svgHeight - padB);
    axisX.setAttribute('y2', svgHeight - padB);
    axisX.setAttribute('stroke', 'rgba(255,255,255,0.25)');
    svg.appendChild(axisX);

    const axisY = document.createElementNS(svgNS, 'line');
    axisY.setAttribute('x1', padL);
    axisY.setAttribute('x2', padL);
    axisY.setAttribute('y1', padT);
    axisY.setAttribute('y2', svgHeight - padB);
    axisY.setAttribute('stroke', 'rgba(255,255,255,0.25)');
    svg.appendChild(axisY);

    const labelStep = pointCount <= 12 ? 1 : pointCount <= 30 ? 2 : pointCount <= 60 ? Math.ceil(pointCount / 12) : Math.ceil(pointCount / 14);

    dataset.yValues.forEach((val, i) => {
      const centerX = padL + i * stepX + stepX / 2;
      const x = centerX - barWidth / 2;
      const h = (val / maxY) * plotH;
      const y = svgHeight - padB - h;

      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', h);
      rect.setAttribute('rx', 2);
      rect.setAttribute('fill', '#3f9cff');
      svg.appendChild(rect);

      if (i % labelStep === 0 || i === pointCount - 1) {
        const lbl = document.createElementNS(svgNS, 'text');
        lbl.setAttribute('x', centerX);
        lbl.setAttribute('y', svgHeight - padB + 15);
        lbl.setAttribute('fill', '#b6c8de');
        lbl.setAttribute('font-size', '10');
        lbl.setAttribute('text-anchor', 'middle');
        lbl.textContent = String(dataset.xValues[i]).slice(0, 10);
        svg.appendChild(lbl);
      }
    });

    const yTitle = document.createElementNS(svgNS, 'text');
    yTitle.setAttribute('x', 10);
    yTitle.setAttribute('y', 16);
    yTitle.setAttribute('fill', '#dbe6f7');
    yTitle.setAttribute('font-size', '12');
    yTitle.textContent = dataset.yLabel;
    svg.appendChild(yTitle);

    const xTitle = document.createElementNS(svgNS, 'text');
    xTitle.setAttribute('x', svgWidth / 2);
    xTitle.setAttribute('y', svgHeight - 8);
    xTitle.setAttribute('fill', '#dbe6f7');
    xTitle.setAttribute('font-size', '12');
    xTitle.setAttribute('text-anchor', 'middle');
    xTitle.textContent = dataset.xLabel;
    svg.appendChild(xTitle);

    scroll.appendChild(svg);
    card.appendChild(titleDiv);
    card.appendChild(scroll);
    container.appendChild(card);
  }

  function parseSoilText(text) {
    const lines = text.replace(/\r/g, '').trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new Error('Soil file must have at least 2 rows');

    const headers = splitLine(lines[0]).map(s => s.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = splitLine(lines[i]).map(s => s.trim());
      if (parts.length === 0) continue;
      rows.push(parts);
    }

    return { headers, rows };
  }

  function drawSoilTable(container, dataset, title, slotId) {
    const existing = document.getElementById(slotId);
    if (existing) existing.remove();

    const empty = container.querySelector('.empty-plot-note');
    if (empty) empty.remove();

    const card = document.createElement('div');
    card.className = 'soil-table-card';
    card.id = slotId;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'rainfall-plot-title';
    titleDiv.textContent = title;

    const scroll = document.createElement('div');
    scroll.className = 'soil-table-scroll';

    const table = document.createElement('table');
    table.className = 'soil-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    dataset.headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    dataset.rows.forEach(row => {
      const tr = document.createElement('tr');
      dataset.headers.forEach((_, idx) => {
        const td = document.createElement('td');
        td.textContent = row[idx] ?? '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    scroll.appendChild(table);

    card.appendChild(titleDiv);
    card.appendChild(scroll);
    container.appendChild(card);
  }

  function parseGeotopConfig(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const results = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('!') || !trimmed.includes('=')) return;
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      if (key) results.push({ name: key, value: value });
    });

    return results;
  }

  function drawNameValueTable(container, rows, title, slotId) {
    const existing = document.getElementById(slotId);
    if (existing) existing.remove();

    const empty = container.querySelector('.empty-plot-note');
    if (empty) empty.remove();

    const card = document.createElement('div');
    card.className = 'soil-table-card';
    card.id = slotId;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'rainfall-plot-title';
    titleDiv.textContent = title;

    const scroll = document.createElement('div');
    scroll.className = 'soil-table-scroll';

    const table = document.createElement('table');
    table.className = 'soil-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    ['Name', 'Value'].forEach(txt => {
      const th = document.createElement('th');
      th.textContent = txt;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    const tbody = document.createElement('tbody');
    rows.forEach(item => {
      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.textContent = item.name;

      const td2 = document.createElement('td');
      td2.textContent = item.value;

      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    scroll.appendChild(table);

    card.appendChild(titleDiv);
    card.appendChild(scroll);
    container.appendChild(card);
  }

  function createRainfallUploadBlock(index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'upload-section';

    const title = document.createElement('div');
    title.className = 'upload-section-title';
    title.textContent = 'Rainfall file ' + index;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.hidden = true;
    input.id = 'rainfallFileInput_' + index;

    const label = document.createElement('label');
    label.className = 'dropbox';
    label.htmlFor = input.id;
    label.innerHTML = `
      <div class="dropbox-icon">⤒</div>
      <div class="dropbox-title">Upload rainfall file ${index}</div>
      <div class="dropbox-subtitle">CSV, TXT, comma/tab/space separated</div>
    `;

    const fileInfo = document.createElement('div');
    fileInfo.className = 'field-box compact-box';
    fileInfo.textContent = 'None';

    input.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      fileInfo.textContent = file.name;

      try {
        const text = await file.text();
        const dataset = parseRainfallText(text);

        drawRainfallChart(
          rainfallPlotArea,
          dataset,
          file.name + ' (' + dataset.xLabel + ' vs ' + dataset.yLabel + ')',
          'rainfallPlot_' + index
        );

        activateVizPanel('rainfallVizPanel');
      } catch (err) {
        addConsoleLine('err', 'Rainfall file error: ' + err.message);
      }
    });

    wrapper.appendChild(title);
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    wrapper.appendChild(fileInfo);

    return wrapper;
  }

  function createSoilUploadBlock(index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'upload-section';

    const title = document.createElement('div');
    title.className = 'upload-section-title';
    title.textContent = 'Soil file ' + index;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.hidden = true;
    input.id = 'soilFileInput_' + index;

    const label = document.createElement('label');
    label.className = 'dropbox';
    label.htmlFor = input.id;
    label.innerHTML = `
      <div class="dropbox-icon">⤒</div>
      <div class="dropbox-title">Upload soil file ${index}</div>
      <div class="dropbox-subtitle">CSV, TXT, comma/tab/space separated</div>
    `;

    const fileInfo = document.createElement('div');
    fileInfo.className = 'field-box compact-box';
    fileInfo.textContent = 'None';

    input.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      fileInfo.textContent = file.name;

      try {
        const text = await file.text();
        const dataset = parseSoilText(text);

        drawSoilTable(soilTableArea, dataset, file.name, 'soilTable_' + index);
        activateVizPanel('soilVizPanel');
      } catch (err) {
        addConsoleLine('err', 'Soil file error: ' + err.message);
      }
    });

    wrapper.appendChild(title);
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    wrapper.appendChild(fileInfo);

    return wrapper;
  }

  function createGeoMapUploadBlock(index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'geo-map-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'upload-section-title-row';

    const title = document.createElement('span');
    title.className = 'upload-section-title';
    title.textContent = 'Geo map ' + index;

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'view-toggle-wrap';

    const viewToggle = document.createElement('input');
    viewToggle.type = 'checkbox';
    viewToggle.checked = true;
    viewToggle.disabled = true;

    const toggleText = document.createElement('span');
    toggleText.textContent = 'View';

    toggleWrap.appendChild(viewToggle);
    toggleWrap.appendChild(toggleText);

    titleRow.appendChild(title);
    titleRow.appendChild(toggleWrap);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.asc,.tif,.tiff';
    input.hidden = true;
    input.id = 'geoMapFileInput_' + index;

    const label = document.createElement('label');
    label.className = 'dropbox';
    label.htmlFor = input.id;
    label.innerHTML = `
      <div class="dropbox-icon">⤒</div>
      <div class="dropbox-title">Upload geo raster ${index}</div>
      <div class="dropbox-subtitle">.asc, .tif, .tiff</div>
    `;

    const fileInfo = document.createElement('div');
    fileInfo.className = 'field-box compact-box';
    fileInfo.textContent = 'None';

    const layerKey = 'geo_dynamic_' + (++dynamicLayerCounter);

    input.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;

      fileInfo.textContent = file.name;
      handleRasterFile(file, layerKey, 'Geo Map ' + index, viewToggle);
    });

    viewToggle.addEventListener('change', function () {
      const layerObj = rasterLayers[layerKey];
      if (!layerObj) return;

      layerObj.visible = viewToggle.checked;
      if (viewToggle.checked) {
        layerObj.layer.addTo(map);
        activeLayerKey = layerKey;
      } else {
        if (map.hasLayer(layerObj.layer)) map.removeLayer(layerObj.layer);
      }
      updateActiveFromVisibleLayers();
    });

    wrapper.appendChild(titleRow);
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    wrapper.appendChild(fileInfo);
    return wrapper;
  }

  function generateGeoMapInputs() {
    const count = parseInt(geoMapCountInput.value, 10);
    geoUploadContainer.innerHTML = '';

    if (!Number.isFinite(count) || count < 1) return;

    for (let i = 1; i <= count; i++) {
      geoUploadContainer.appendChild(createGeoMapUploadBlock(i));
    }
  }

  function generateRainfallInputs() {
    const count = parseInt(rainfallCountInput.value, 10);
    rainfallUploadContainer.innerHTML = '';
    if (!Number.isFinite(count) || count < 1) return;
    for (let i = 1; i <= count; i++) rainfallUploadContainer.appendChild(createRainfallUploadBlock(i));
  }

  function generateSoilInputs() {
    const count = parseInt(soilCountInput.value, 10);
    soilUploadContainer.innerHTML = '';
    if (!Number.isFinite(count) || count < 1) return;
    for (let i = 1; i <= count; i++) soilUploadContainer.appendChild(createSoilUploadBlock(i));
  }

  function createFormSoilTypeBlock(index) {
    const card = document.createElement('div');
    card.className = 'form-soil-card';

    const title = document.createElement('div');
    title.className = 'form-soil-title';
    title.textContent = 'Soil type ' + index;

    const grid = document.createElement('div');
    grid.className = 'form-grid';

    const fields = [
      { key: 'phi_deg', label: 'phi_deg', value: '40.50' },
      { key: 'phi_cov', label: 'phi_cov', value: '0.02' },
      { key: 'c_kpa', label: 'c_kpa', value: '1.72' },
      { key: 'c_cov', label: 'c_cov', value: '0.69' },
      { key: 'gamma_s', label: 'gamma_s', value: '16.87' },
      { key: 'rho_c_phi', label: 'rho_c_phi', value: '-0.5' }
    ];

    fields.forEach(field => {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';

      const label = document.createElement('div');
      label.className = 'field-label';
      label.textContent = field.label;

      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.className = 'number-input';
      input.value = field.value;
      input.id = `form_${field.key}_${index}`;

      wrap.appendChild(label);
      wrap.appendChild(input);
      grid.appendChild(wrap);
    });

    card.appendChild(title);
    card.appendChild(grid);
    return card;
  }

  function generateFormInputs() {
    const count = parseInt(formSoilTypeCount.value, 10);
    formSoilTypeContainer.innerHTML = '';
    if (!Number.isFinite(count) || count < 1) return;
    for (let i = 1; i <= count; i++) formSoilTypeContainer.appendChild(createFormSoilTypeBlock(i));
  }

  function buildMlHyperparametersGrid() {
    mlHyperparametersGrid.innerHTML = '';

    mlHyperparametersDefaults.forEach(([name, value]) => {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';

      const label = document.createElement('div');
      label.className = 'field-label';
      label.textContent = name;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'number-input';
      input.value = value;
      input.id = 'ml_' + name;

      wrap.appendChild(label);
      wrap.appendChild(input);
      mlHyperparametersGrid.appendChild(wrap);
    });
  }

  function createMlInventoryBlock(index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ml-inventory-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'upload-section-title-row';

    const title = document.createElement('span');
    title.className = 'upload-section-title';
    title.textContent = 'Landslide inventory ' + index;

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'view-toggle-wrap';

    const viewToggle = document.createElement('input');
    viewToggle.type = 'checkbox';
    viewToggle.checked = true;
    viewToggle.disabled = true;

    const toggleText = document.createElement('span');
    toggleText.textContent = 'View';

    toggleWrap.appendChild(viewToggle);
    toggleWrap.appendChild(toggleText);
    titleRow.appendChild(title);
    titleRow.appendChild(toggleWrap);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.asc';
    input.hidden = true;
    input.id = 'mlInventoryInput_' + index;

    const label = document.createElement('label');
    label.className = 'dropbox';
    label.htmlFor = input.id;
    label.innerHTML = `
      <div class="dropbox-icon">⤒</div>
      <div class="dropbox-title">Upload landslide inventory ${index}</div>
      <div class="dropbox-subtitle">ASC file</div>
    `;

    const fileInfo = document.createElement('div');
    fileInfo.className = 'field-box compact-box';
    fileInfo.textContent = 'None';

    const dateWrap = document.createElement('div');
    dateWrap.className = 'field-group';

    const dateLabel = document.createElement('div');
    dateLabel.className = 'field-label';
    dateLabel.textContent = 'Date value';

    const dateInput = document.createElement('input');
    dateInput.type = 'text';
    dateInput.className = 'date-input';
    dateInput.value = '20210610';

    dateWrap.appendChild(dateLabel);
    dateWrap.appendChild(dateInput);

    const layerKey = 'ml_inventory_' + (++dynamicLayerCounter);

    input.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;

      fileInfo.textContent = file.name;
      handleRasterFile(file, layerKey, 'Landslide Inventory ' + index + ' (' + dateInput.value + ')', viewToggle);
    });

    viewToggle.addEventListener('change', function () {
      const layerObj = rasterLayers[layerKey];
      if (!layerObj) return;

      layerObj.visible = viewToggle.checked;
      if (viewToggle.checked) {
        layerObj.layer.addTo(map);
        activeLayerKey = layerKey;
      } else {
        if (map.hasLayer(layerObj.layer)) map.removeLayer(layerObj.layer);
      }
      updateActiveFromVisibleLayers();
    });

    wrapper.appendChild(titleRow);
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    wrapper.appendChild(fileInfo);
    wrapper.appendChild(dateWrap);

    return wrapper;
  }

  function generateMlInventoryInputs() {
    const count = parseInt(mlInventoryCountInput.value, 10);
    mlInventoryUploadContainer.innerHTML = '';
    if (!Number.isFinite(count) || count < 1) return;
    for (let i = 1; i <= count; i++) mlInventoryUploadContainer.appendChild(createMlInventoryBlock(i));
  }

  panelTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      activatePanel(tab.dataset.panel);
    });
  });

  vizTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      activateVizPanel(tab.dataset.viz);
    });
  });

  rightTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      activateRightPanel(tab.dataset.rightPanel);
    });
  });

  Object.keys(rasterConfigs).forEach(layerKey => {
    const cfg = rasterConfigs[layerKey];

    if (cfg.input) {
      cfg.input.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        handleRasterFile(file, layerKey, cfg.label, cfg.viewToggle);
      });
    }

    if (cfg.viewToggle) {
      cfg.viewToggle.addEventListener('change', function () {
        const layerObj = rasterLayers[layerKey];
        if (!layerObj) return;

        layerObj.visible = cfg.viewToggle.checked;

        if (cfg.viewToggle.checked) {
          layerObj.layer.addTo(map);
          activeLayerKey = layerKey;
        } else {
          if (map.hasLayer(layerObj.layer)) map.removeLayer(layerObj.layer);
        }
        updateActiveFromVisibleLayers();
      });
    }
  });

  if (geotopConfigInput) {
    geotopConfigInput.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      geotopConfigFileName.textContent = file.name;
      geotopConfigStatus.textContent = 'Reading GeoTOP configuration...';

      try {
        const text = await file.text();
        const rows = parseGeotopConfig(text);

        drawNameValueTable(
          geotopSummaryArea,
          rows,
          file.name,
          'geotopSummaryTable'
        );

        geotopConfigStatus.textContent = 'GeoTOP configuration uploaded successfully';
        activateVizPanel('geotopVizPanel');
      } catch (err) {
        geotopConfigStatus.textContent = 'Failed to parse GeoTOP configuration';
        addConsoleLine('err', 'GeoTOP configuration error: ' + err.message);
      }
    });
  }

  if (runGeotopBtn) runGeotopBtn.addEventListener('click', function () { addConsoleLine('info', 'Run simulation button clicked'); });
  if (generateFormInputsBtn) generateFormInputsBtn.addEventListener('click', generateFormInputs);
  if (runFormBtn) runFormBtn.addEventListener('click', function () { addConsoleLine('info', 'Run FORM to calculate PoF button clicked'); });
  if (mlTrainingBtn) mlTrainingBtn.addEventListener('click', function () { addConsoleLine('info', 'Machine Learning: Training button clicked'); });
  if (mlFastPredictionBtn) mlFastPredictionBtn.addEventListener('click', function () { addConsoleLine('info', 'Machine Learning: Fast Prediction button clicked'); });
  if (mlArPredictionBtn) mlArPredictionBtn.addEventListener('click', function () { addConsoleLine('info', 'Machine Learning: Augmented-Reality Prediction button clicked'); });

  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      addConsoleLine('info', 'Login button clicked');
    });
  }

  if (helpBtn) {
    helpBtn.addEventListener('click', function () {
      addConsoleLine('info', 'Help button clicked');
    });
  }

  clearConsoleBtn.addEventListener('click', clearConsole);
  fitLayerBtn.addEventListener('click', fitActiveLayer);
  clearLayerBtn.addEventListener('click', function () { clearAllLayers(); setStatus('All layers cleared'); });
  resetViewBtn.addEventListener('click', resetMapView);
  zoomInMapBtn.addEventListener('click', function () { if (map) map.zoomIn(); });
  zoomOutMapBtn.addEventListener('click', function () { if (map) map.zoomOut(); });

  if (basemapSelect) {
    basemapSelect.addEventListener('change', function () {
      setBaseLayer(this.value);
    });
  }

  generateRainfallInputsBtn.addEventListener('click', generateRainfallInputs);
  generateSoilInputsBtn.addEventListener('click', generateSoilInputs);
  generateGeoMapInputsBtn.addEventListener('click', generateGeoMapInputs);
  generateMlInventoryInputsBtn.addEventListener('click', generateMlInventoryInputs);

  panelTabs.forEach(tab => {
    tab.addEventListener('click', playTabSound);
  });

  vizTabs.forEach(tab => {
    tab.addEventListener('click', playTabSound);
  });

  rightTabs.forEach(tab => {
    tab.addEventListener('click', playTabSound);
  });
    
  initMap();
  generateRainfallInputs();
  generateSoilInputs();
  generateGeoMapInputs();
  generateFormInputs();
  buildMlHyperparametersGrid();
  generateMlInventoryInputs();
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);  
  addConsoleLine('info', 'System initialized');
  let tabAudioCtx = null;

  function getTabAudioContext() {
    if (!tabAudioCtx) {
      tabAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return tabAudioCtx;
  }

  function playTabSound() {
    try {
      const ctx = getTabAudioContext();

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.08);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, ctx.currentTime);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } catch (err) {
      console.warn('Tab sound failed:', err);
    }
  }  
})();