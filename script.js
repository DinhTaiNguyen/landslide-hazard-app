(function () {
  const fileInputMap = {
    dem: document.getElementById('demFileInput'),
    soilType: document.getElementById('soilTypeFileInput'),
    soilThickness: document.getElementById('soilThicknessFileInput')
  };

  const selectedFileMap = {
    dem: document.getElementById('demSelectedFile'),
    soilType: document.getElementById('soilTypeSelectedFile'),
    soilThickness: document.getElementById('soilThicknessSelectedFile')
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
  const fitLayerMapBtn = document.getElementById('fitLayerMapBtn');

  const crsSelect = document.getElementById('crsSelect');
  const placementMode = document.getElementById('placementMode');
  const rasterStats = document.getElementById('rasterStats');
  const colorbarPanel = document.getElementById('colorbarPanel');
  const colorbarMin = document.getElementById('colorbarMin');
  const colorbarMid = document.getElementById('colorbarMid');
  const colorbarMax = document.getElementById('colorbarMax');
  const layerControlList = document.getElementById('layerControlList');

  const rainfallCountInput = document.getElementById('rainfallCountInput');
  const generateRainfallInputsBtn = document.getElementById('generateRainfallInputsBtn');
  const rainfallUploadContainer = document.getElementById('rainfallUploadContainer');
  const rainfallPlotArea = document.getElementById('rainfallPlotArea');

  const panelTabs = document.querySelectorAll('.panel-tab');
  const subPanels = document.querySelectorAll('.left-subpanel');

  let map = null;
  let rasterLayers = {};
  let activeLayerKey = null;
  let layerOrder = [];

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
    uploadStatus.textContent = message;
  }

  function updateRasterStats(min, max, width, height, crsText, layerName) {
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data © OpenStreetMap contributors'
    }).addTo(map);

    addConsoleLine('info', 'Map initialized');
  }

  function clearAllLayers() {
    Object.keys(rasterLayers).forEach(key => {
      const layerObj = rasterLayers[key];
      if (layerObj && layerObj.layer && map.hasLayer(layerObj.layer)) {
        map.removeLayer(layerObj.layer);
      }
    });

    rasterLayers = {};
    layerOrder = [];
    activeLayerKey = null;

    mapEmptyNote.style.display = 'block';
    hideColorbar();
    rasterStats.textContent = 'No raster loaded';
    layerControlList.textContent = 'No layers loaded';
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

  function refreshLayerControlList() {
    if (layerOrder.length === 0) {
      layerControlList.textContent = 'No layers loaded';
      return;
    }

    layerControlList.innerHTML = '';

    layerOrder.forEach(layerKey => {
      const layerObj = rasterLayers[layerKey];
      if (!layerObj) return;

      const row = document.createElement('div');
      row.className = 'layer-row';

      const left = document.createElement('div');
      left.className = 'layer-row-left';

      const name = document.createElement('div');
      name.className = 'layer-name';
      name.textContent = layerObj.label;

      const file = document.createElement('div');
      file.className = 'layer-file';
      file.textContent = layerObj.fileName;

      left.appendChild(name);
      left.appendChild(file);

      const right = document.createElement('div');
      right.className = 'layer-row-right';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'layer-toggle';
      toggle.checked = layerObj.visible;

      toggle.addEventListener('change', function () {
        layerObj.visible = toggle.checked;

        if (toggle.checked) {
          layerObj.layer.addTo(map);
          activeLayerKey = layerKey;
          mapEmptyNote.style.display = 'none';
          updateColorbar(layerObj.min, layerObj.max);
          updateRasterStats(layerObj.min, layerObj.max, layerObj.width, layerObj.height, layerObj.crsText, layerObj.label);
          addConsoleLine('info', layerObj.label + ' turned on');
        } else {
          if (map.hasLayer(layerObj.layer)) {
            map.removeLayer(layerObj.layer);
          }
          addConsoleLine('warn', layerObj.label + ' turned off');

          if (activeLayerKey === layerKey) {
            const stillVisible = layerOrder.find(k => rasterLayers[k] && rasterLayers[k].visible);
            if (stillVisible) {
              activeLayerKey = stillVisible;
              const active = rasterLayers[stillVisible];
              updateColorbar(active.min, active.max);
              updateRasterStats(active.min, active.max, active.width, active.height, active.crsText, active.label);
            } else {
              activeLayerKey = null;
              hideColorbar();
              rasterStats.textContent = 'No raster loaded';
              mapEmptyNote.style.display = 'block';
            }
          }
        }
      });

      const focusBtn = document.createElement('button');
      focusBtn.className = 'layer-focus-btn';
      focusBtn.textContent = 'Focus';

      focusBtn.addEventListener('click', function () {
        activeLayerKey = layerKey;
        if (!layerObj.visible) {
          layerObj.visible = true;
          toggle.checked = true;
          layerObj.layer.addTo(map);
        }
        map.fitBounds(layerObj.bounds, { padding: [20, 20] });
        updateColorbar(layerObj.min, layerObj.max);
        updateRasterStats(layerObj.min, layerObj.max, layerObj.width, layerObj.height, layerObj.crsText, layerObj.label);
        mapEmptyNote.style.display = 'none';
        addConsoleLine('info', 'Focused on ' + layerObj.label);
      });

      right.appendChild(toggle);
      right.appendChild(focusBtn);

      row.appendChild(left);
      row.appendChild(right);
      layerControlList.appendChild(row);
    });
  }

  function registerRasterLayer(layerKey, layerLabel, fileName, leafletLayer, bounds, stats) {
    if (rasterLayers[layerKey] && rasterLayers[layerKey].layer && map.hasLayer(rasterLayers[layerKey].layer)) {
      map.removeLayer(rasterLayers[layerKey].layer);
    }

    rasterLayers[layerKey] = {
      key: layerKey,
      label: layerLabel,
      fileName: fileName,
      layer: leafletLayer,
      bounds: bounds,
      visible: true,
      min: stats.min,
      max: stats.max,
      width: stats.width,
      height: stats.height,
      crsText: stats.crsText
    };

    if (!layerOrder.includes(layerKey)) {
      layerOrder.push(layerKey);
    }

    activeLayerKey = layerKey;
    refreshLayerControlList();
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

    if (!placementMode || placementMode.value === 'fit') {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    mapEmptyNote.style.display = 'none';
    setStatus('Loaded ' + fileName);
    updateColorbar(asc.min, asc.max);
    updateRasterStats(asc.min, asc.max, asc.width, asc.height, crsText, layerLabel);

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

    if (!placementMode || placementMode.value === 'fit') {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    mapEmptyNote.style.display = 'none';
    setStatus('Loaded ' + file.name);
    updateColorbar(min, max);
    updateRasterStats(min, max, width, height, crsText, layerLabel);

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

      selectedFileMap[layerKey].textContent = file.name;
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

  function parseRainfallText(text) {
    const lines = text.replace(/\r/g, '').trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new Error('Rainfall file must have at least 2 rows');

    const splitLine = (line) => {
      if (line.includes(',')) return line.split(',');
      if (line.includes('\t')) return line.split('\t');
      return line.trim().split(/\s+/);
    };

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

  function drawRainfallChart(container, dataset, title) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 240;
    canvas.className = 'rainfall-chart';

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const padL = 55;
    const padR = 20;
    const padT = 20;
    const padB = 40;

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;

    for (let i = 0; i < 5; i++) {
      const y = padT + ((H - padT - padB) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();

    const yMin = 0;
    const yMax = Math.max(...dataset.yValues);
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.beginPath();
    dataset.yValues.forEach((val, i) => {
      const x = padL + (dataset.yValues.length === 1 ? plotW / 2 : (plotW * i) / (dataset.yValues.length - 1));
      const y = H - padB - ((val - yMin) / ((yMax - yMin) || 1)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#3f9cff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#dbe6f7';
    ctx.font = '12px Arial';
    ctx.fillText(dataset.yLabel, 10, 18);
    ctx.fillText(dataset.xLabel, W / 2 - 20, H - 10);

    ctx.fillStyle = '#9fb3cf';
    ctx.font = '11px Arial';
    ctx.fillText(yMax.toFixed(2), 10, padT + 4);
    ctx.fillText('0', 28, H - padB);

    const card = document.createElement('div');
    card.className = 'rainfall-plot-card';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'rainfall-plot-title';
    titleDiv.textContent = title;

    card.appendChild(titleDiv);
    card.appendChild(canvas);
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

        const existingEmpty = rainfallPlotArea.querySelector('.empty-plot-note');
        if (existingEmpty) existingEmpty.remove();

        drawRainfallChart(
          rainfallPlotArea,
          dataset,
          file.name + ' (' + dataset.xLabel + ' vs ' + dataset.yLabel + ')'
        );

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

  panelTabs.forEach(tab => {
    tab.addEventListener('click', function () {
      activatePanel(tab.dataset.panel);
      addConsoleLine('info', 'Switched to panel: ' + tab.dataset.panel);
    });
  });

  Object.keys(fileInputMap).forEach(layerKey => {
    const input = fileInputMap[layerKey];
    input.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) {
        addConsoleLine('warn', 'No file selected for ' + layerKey);
        return;
      }

      const labelMap = {
        dem: 'DEM Data',
        soilType: 'Soil Type Map',
        soilThickness: 'Soil Thickness Map'
      };

      handleRasterFile(file, layerKey, labelMap[layerKey]);
    });
  });

  clearConsoleBtn.addEventListener('click', clearConsole);
  fitLayerBtn.addEventListener('click', fitActiveLayer);
  fitLayerMapBtn.addEventListener('click', fitActiveLayer);

  clearLayerBtn.addEventListener('click', function () {
    clearAllLayers();
    setStatus('All layers cleared');
    addConsoleLine('warn', 'All raster layers cleared');
  });

  resetViewBtn.addEventListener('click', resetMapView);
  zoomInMapBtn.addEventListener('click', function () { if (map) map.zoomIn(); });
  zoomOutMapBtn.addEventListener('click', function () { if (map) map.zoomOut(); });

  generateRainfallInputsBtn.addEventListener('click', generateRainfallInputs);

  if (typeof proj4 === 'undefined') {
    addConsoleLine('err', 'proj4 library did not load');
  } else {
    addConsoleLine('info', 'proj4 library loaded');
  }

  initMap();
  generateRainfallInputs();
  addConsoleLine('info', 'System initialized');
  addConsoleLine('info', 'Ready. Upload DEM / soil rasters or rainfall files.');
})();