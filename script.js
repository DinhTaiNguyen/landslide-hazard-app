(function () {
  const fixedRasterConfigs = {
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

  const fitLayerBtnInside = document.getElementById('fitLayerBtnInside');
  const clearLayerBtnInside = document.getElementById('clearLayerBtnInside');
  const resetViewBtnInside = document.getElementById('resetViewBtnInside');

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

  const geoCountInput = document.getElementById('geoCountInput');
  const generateGeoInputsBtn = document.getElementById('generateGeoInputsBtn');
  const geoUploadContainer = document.getElementById('geoUploadContainer');

  const panelTabs = document.querySelectorAll('.panel-tab');
  const subPanels = document.querySelectorAll('.left-subpanel');

  const vizTabs = document.querySelectorAll('.viz-tab');
  const vizPanels = document.querySelectorAll('.viz-panel');

  const mapStyleButtons = document.querySelectorAll('.map-style-btn');

  let map = null;
  let rasterLayers = {};
  let activeLayerKey = null;
  let dynamicGeoConfigs = {};
  let baseLayers = {};
  let currentBaseLayerKey = 'osm';

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
    addConsoleLine('info', 'Color bar updated');
  }

  function hideColorbar() {
    colorbarPanel.style.display = 'none';
  }

  function clearConsole() {
    consoleContent.innerHTML = '';
    addConsoleLine('info', 'Console cleared');
  }

  window.onerror = function (message, source, lineno) {
    addConsoleLine('err', `JS error: ${message} (line ${lineno})`);
  };

  window.addEventListener('unhandledrejection', function (event) {
    addConsoleLine('err', 'Promise error: ' + event.reason);
  });

  function initMap() {
    if (typeof L === 'undefined') {
      addConsoleLine('err', 'Leaflet did not load');
      return;
    }

    map = L.map('map', { center: [29.72, 119.96], zoom: 10, zoomControl: true });

    baseLayers = {
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data © OpenStreetMap contributors'
      }),
      topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data © OpenTopoMap contributors'
      }),
      terrain: L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg', {
        attribution: 'Map tiles by Stamen Design'
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri'
      })
    };

    baseLayers.osm.addTo(map);

    addConsoleLine('info', 'Map initialized');
  }

  function switchBaseLayer(key) {
    if (!baseLayers[key] || !map) return;

    if (baseLayers[currentBaseLayerKey] && map.hasLayer(baseLayers[currentBaseLayerKey])) {
      map.removeLayer(baseLayers[currentBaseLayerKey]);
    }

    baseLayers[key].addTo(map);
    currentBaseLayerKey = key;

    mapStyleButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.basemap === key);
    });

    addConsoleLine('info', 'Base map changed to ' + key);
  }

  function clearAllLayers() {
    Object.keys(rasterLayers).forEach(key => {
      if (rasterLayers[key].layer && map.hasLayer(rasterLayers[key].layer)) {
        map.removeLayer(rasterLayers[key].layer);
      }
    });

    rasterLayers = {};
    activeLayerKey = null;

    Object.values(fixedRasterConfigs).forEach(cfg => {
      cfg.selectedFile.textContent = 'None';
      cfg.viewToggle.checked = true;
      cfg.viewToggle.disabled = true;
    });

    Object.values(dynamicGeoConfigs).forEach(cfg => {
      cfg.selectedFile.textContent = 'None';
      cfg.viewToggle.checked = true;
      cfg.viewToggle.disabled = true;
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
      map.setView([29.72, 119.96], 10);
      addConsoleLine('info', 'Map reset to default view');
    }
  }

  function parseAsc(text) {
    addConsoleLine('info', 'Parsing ASC file');
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

    addConsoleLine('info', `ASC parsed: ${ncols} x ${nrows}`);

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

    addConsoleLine('info', 'ASC raw bounds: xMin=' + xMin + ', yMin=' + yMin + ', xMax=' + xMax + ', yMax=' + yMax);

    if (selectedCRS === 'EPSG:4326' || selectedCRS === 'EPSG:4490' || (selectedCRS === 'auto' && ascLooksGeographic(asc))) {
      return [
        [yMin, xMin],
        [yMax, xMax]
      ];
    }

    if (selectedCRS === 'EPSG:3857' || selectedCRS === 'EPSG:4549') {
      const ll = transformPointToWGS84(xMin, yMin, selectedCRS);
      const ur = transformPointToWGS84(xMax, yMax, selectedCRS);

      addConsoleLine('info', 'Transformed lower-left: lon=' + ll[0] + ', lat=' + ll[1]);
      addConsoleLine('info', 'Transformed upper-right: lon=' + ur[0] + ', lat=' + ur[1]);

      return [
        [ll[1], ll[0]],
        [ur[1], ur[0]]
      ];
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

  function registerRasterLayer(layerKey, layerLabel, fileName, leafletLayer, bounds, stats) {
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
      crsText: stats.crsText
    };

    const cfg = fixedRasterConfigs[layerKey] || dynamicGeoConfigs[layerKey];
    if (cfg) {
      cfg.viewToggle.disabled = false;
      cfg.viewToggle.checked = true;
    }

    activeLayerKey = layerKey;
    updateActiveFromVisibleLayers();
  }

  function addAscLayer(asc, fileName, layerKey, layerLabel) {
    const canvas = renderGridToCanvas(asc.width, asc.height, asc.grid, asc.min, asc.max);
    const url = canvas.toDataURL('image/png');

    let bounds;
    let crsText = 'Auto detect';
    const selectedCRS = crsSelect ? crsSelect.value : 'auto';

    try {
      bounds = ascBoundsToLatLngBounds(asc, selectedCRS);

      if (selectedCRS === 'auto') {
        if (ascLooksGeographic(asc)) {
          crsText = 'Auto → EPSG:4326 geographic';
          addConsoleLine('info', 'ASC auto-detected as geographic');
        } else {
          crsText = 'Auto → unsupported projected CRS';
          addConsoleLine('warn', 'Auto detect could not identify projected CRS. Choose one manually.');
        }
      } else {
        crsText = selectedCRS;
        addConsoleLine('info', 'ASC displayed using selected CRS: ' + selectedCRS);
      }
    } catch (err) {
      addConsoleLine('err', 'CRS transform failed: ' + err.message);
      setStatus('CRS transform failed');
      throw err;
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
    });

    addConsoleLine('info', layerLabel + ' displayed successfully');
  }

  async function addTiffLayer(file, layerKey, layerLabel) {
    if (typeof GeoTIFF === 'undefined') {
      throw new Error('GeoTIFF library not loaded');
    }

    addConsoleLine('info', 'Reading TIFF array buffer');

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
        addConsoleLine('info', 'TIFF geographic bounding box detected');
      } else {
        addConsoleLine('warn', 'TIFF bbox not geographic; using fallback bounds');
      }
    } catch (err) {
      addConsoleLine('warn', 'TIFF bbox unavailable; using fallback bounds');
    }

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
    });

    addConsoleLine('info', layerLabel + ' displayed successfully');
  }

  async function handleRasterFile(file, layerKey, layerLabel) {
    try {
      if (!file) {
        addConsoleLine('err', 'No file received');
        return;
      }

      const cfg = fixedRasterConfigs[layerKey] || dynamicGeoConfigs[layerKey];
      if (cfg) cfg.selectedFile.textContent = file.name;

      setStatus('Reading ' + file.name + ' ...');
      addConsoleLine('info', 'File selected for ' + layerLabel + ': ' + file.name);

      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'asc') {
        const text = await file.text();
        addConsoleLine('info', 'ASC text loaded. Length=' + text.length);
        const asc = parseAsc(text);
        addAscLayer(asc, file.name, layerKey, layerLabel);
      } else if (ext === 'tif' || ext === 'tiff') {
        await addTiffLayer(file, layerKey, layerLabel);
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

    const card = document.createElement('div');
    card.className = 'rainfall-plot-card';
    card.id = slotId;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'rainfall-plot-title';
    titleDiv.textContent = title;

    const scroll = document.createElement('div');
    scroll.className = 'chart-scroll';

    const containerWidth = Math.max(container.clientWidth - 40, 700);
    const preferredWidth = dataset.yValues.length * 22 + 120;
    const svgWidth = Math.max(containerWidth, preferredWidth);
    const svgHeight = 240;
    const padL = 60;
    const padR = 20;
    const padT = 20;
    const padB = 45;
    const plotW = svgWidth - padL - padR;
    const plotH = svgHeight - padT - padB;
    const maxY = Math.max(...dataset.yValues, 1);

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

    const barSlot = plotW / Math.max(dataset.yValues.length, 1);
    const barWidth = Math.max(6, Math.min(18, barSlot * 0.7));

    dataset.yValues.forEach((val, i) => {
      const xCenter = padL + barSlot * i + barSlot / 2;
      const x = xCenter - barWidth / 2;
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

      if (dataset.xValues.length <= 20 || i % Math.ceil(dataset.xValues.length / 10) === 0) {
        const lbl = document.createElementNS(svgNS, 'text');
        lbl.setAttribute('x', xCenter - 8);
        lbl.setAttribute('y', svgHeight - padB + 14);
        lbl.setAttribute('fill', '#b6c8de');
        lbl.setAttribute('font-size', '10');
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
    xTitle.setAttribute('x', svgWidth / 2 - 30);
    xTitle.setAttribute('y', svgHeight - 8);
    xTitle.setAttribute('fill', '#dbe6f7');
    xTitle.setAttribute('font-size', '12');
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
      addConsoleLine('info', 'Rainfall file selected: ' + file.name);

      try {
        const text = await file.text();
        const dataset = parseRainfallText(text);

        const empty = rainfallPlotArea.querySelector('.empty-plot-note');
        if (empty) empty.remove();

        drawRainfallChart(
          rainfallPlotArea,
          dataset,
          file.name + ' (' + dataset.xLabel + ' vs ' + dataset.yLabel + ')',
          'rainfallPlot_' + index
        );

        activateVizPanel('rainfallVizPanel');
        addConsoleLine('info', 'Rainfall plot created for ' + file.name);
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
      addConsoleLine('info', 'Soil file selected: ' + file.name);

      try {
        const text = await file.text();
        const dataset = parseSoilText(text);

        const empty = soilTableArea.querySelector('.empty-plot-note');
        if (empty) empty.remove();

        drawSoilTable(
          soilTableArea,
          dataset,
          file.name,
          'soilTable_' + index
        );

        activateVizPanel('soilVizPanel');
        addConsoleLine('info', 'Soil table created for ' + file.name);
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

  function createGeoUploadBlock(index) {
    const key = 'geoDynamic_' + index;

    const wrapper = document.createElement('div');
    wrapper.className = 'upload-section';

    const titleRow = document.createElement('div');
    titleRow.className = 'upload-section-title-row';

    const title = document.createElement('span');
    title.className = 'upload-section-title';
    title.textContent = 'Geo map ' + index;

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'view-toggle-wrap';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = true;
    toggle.disabled = true;

    const toggleText = document.createElement('span');
    toggleText.textContent = 'View';

    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(toggleText);

    titleRow.appendChild(title);
    titleRow.appendChild(toggleWrap);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.asc,.tif,.tiff';
    input.hidden = true;
    input.id = 'geoFileInput_' + index;

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

    dynamicGeoConfigs[key] = {
      label: 'Geo map ' + index,
      input,
      selectedFile: fileInfo,
      viewToggle: toggle
    };

    input.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      handleRasterFile(file, key, dynamicGeoConfigs[key].label);
    });

    toggle.addEventListener('change', function () {
      const layerObj = rasterLayers[key];
      if (!layerObj) return;

      layerObj.visible = toggle.checked;

      if (toggle.checked) {
        layerObj.layer.addTo(map);
        activeLayerKey = key;
        updateActiveFromVisibleLayers();
        addConsoleLine('info', layerObj.label + ' turned on');
      } else {
        if (map.hasLayer(layerObj.layer)) {
          map.removeLayer(layerObj.layer);
        }
        addConsoleLine('warn', layerObj.label + ' turned off');
        updateActiveFromVisibleLayers();
      }
    });

    wrapper.appendChild(titleRow);
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    wrapper.appendChild(fileInfo);

    return wrapper;
  }

  function generateRainfallInputs() {
    const count = parseInt(rainfallCountInput.value, 10);
    rainfallUploadContainer.innerHTML = '';

    if (!Number.isFinite(count) || count < 1) {
      addConsoleLine('warn', 'Rainfall file count must be at least 1');
      return;
    }

    for (let i = 1; i <= count; i++) {
      rainfallUploadContainer.appendChild(createRainfallUploadBlock(i));
    }

    addConsoleLine('info', 'Generated ' + count + ' rainfall upload input(s)');
  }

  function generateSoilInputs() {
    const count = parseInt(soilCountInput.value, 10);
    soilUploadContainer.innerHTML = '';

    if (!Number.isFinite(count) || count < 1) {
      addConsoleLine('warn', 'Soil file count must be at least 1');
      return;
    }

    for (let i = 1; i <= count; i++) {
      soilUploadContainer.appendChild(createSoilUploadBlock(i));
    }

    addConsoleLine('info', 'Generated ' + count + ' soil upload input(s)');
  }

  function generateGeoInputs() {
    const count = parseInt(geoCountInput.value, 10);
    geoUploadContainer.innerHTML = '';
    dynamicGeoConfigs = {};

    if (!Number.isFinite(count) || count < 1) {
      addConsoleLine('warn', 'Geo file count must be at least 1');
      return;
    }

    for (let i = 1; i <= count; i++) {
      geoUploadContainer.appendChild(createGeoUploadBlock(i));
    }

    addConsoleLine('info', 'Generated ' + count + ' geo upload input(s)');
  }

  panelTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      activatePanel(tab.dataset.panel);
      addConsoleLine('info', 'Switched to panel: ' + tab.dataset.panel);
    });
  });

  vizTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      activateVizPanel(tab.dataset.viz);
      addConsoleLine('info', 'Switched to visualise tab: ' + tab.dataset.viz);
    });
  });

  mapStyleButtons.forEach(btn => {
    btn.addEventListener('click', function () {
      switchBaseLayer(btn.dataset.basemap);
    });
  });

  Object.keys(fixedRasterConfigs).forEach(layerKey => {
    const cfg = fixedRasterConfigs[layerKey];

    cfg.input.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) {
        addConsoleLine('warn', 'No file selected for ' + layerKey);
        return;
      }
      handleRasterFile(file, layerKey, cfg.label);
    });

    cfg.viewToggle.addEventListener('change', function () {
      const layerObj = rasterLayers[layerKey];
      if (!layerObj) return;

      layerObj.visible = cfg.viewToggle.checked;

      if (cfg.viewToggle.checked) {
        layerObj.layer.addTo(map);
        activeLayerKey = layerKey;
        updateActiveFromVisibleLayers();
        addConsoleLine('info', cfg.label + ' turned on');
      } else {
        if (map.hasLayer(layerObj.layer)) {
          map.removeLayer(layerObj.layer);
        }
        addConsoleLine('warn', cfg.label + ' turned off');
        updateActiveFromVisibleLayers();
      }
    });
  });

  clearConsoleBtn.addEventListener('click', clearConsole);
  fitLayerBtn.addEventListener('click', fitActiveLayer);
  clearLayerBtn.addEventListener('click', function () {
    clearAllLayers();
    setStatus('All layers cleared');
    addConsoleLine('warn', 'All raster layers cleared');
  });
  resetViewBtn.addEventListener('click', resetMapView);

  fitLayerBtnInside.addEventListener('click', fitActiveLayer);
  clearLayerBtnInside.addEventListener('click', function () {
    clearAllLayers();
    setStatus('All layers cleared');
    addConsoleLine('warn', 'All raster layers cleared');
  });
  resetViewBtnInside.addEventListener('click', resetMapView);

  generateRainfallInputsBtn.addEventListener('click', generateRainfallInputs);
  generateSoilInputsBtn.addEventListener('click', generateSoilInputs);
  generateGeoInputsBtn.addEventListener('click', generateGeoInputs);

  if (typeof proj4 === 'undefined') {
    addConsoleLine('err', 'proj4 library did not load');
  } else {
    addConsoleLine('info', 'proj4 library loaded');
  }

  initMap();
  generateRainfallInputs();
  generateSoilInputs();
  generateGeoInputs();
  addConsoleLine('info', 'System initialized');
  addConsoleLine('info', 'Ready. Upload DEM / soil / geo rasters or rainfall / soil files.');
})();