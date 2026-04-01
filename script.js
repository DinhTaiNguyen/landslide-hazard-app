(function () {
  const fileInput = document.getElementById('fileInput');
  const dropBox = document.getElementById('dropBox');
  const selectedFile = document.getElementById('selectedFile');
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

  let map = null;
  let currentRasterLayer = null;
  let currentRasterBounds = null;

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

  function updateRasterStats(min, max, width, height, crsText) {
    rasterStats.innerHTML =
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

  function clearCurrentLayer() {
    if (currentRasterLayer && map) {
      map.removeLayer(currentRasterLayer);
    }
    currentRasterLayer = null;
    currentRasterBounds = null;
  }

  function fitCurrentLayer() {
    if (map && currentRasterBounds) {
      map.fitBounds(currentRasterBounds, { padding: [20, 20] });
      addConsoleLine('info', 'Map fit to raster bounds');
    } else {
      addConsoleLine('warn', 'No raster layer to fit');
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

  function addAscLayer(asc, fileName) {
    clearCurrentLayer();

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

    currentRasterLayer = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(map);
    currentRasterBounds = bounds;

    if (!placementMode || placementMode.value === 'fit') {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    mapEmptyNote.style.display = 'none';
    setStatus('Loaded ' + fileName);
    updateColorbar(asc.min, asc.max);
    updateRasterStats(asc.min, asc.max, asc.width, asc.height, crsText);
    addConsoleLine('info', 'ASC displayed successfully');
  }

  async function addTiffLayer(file) {
    if (typeof GeoTIFF === 'undefined') {
      throw new Error('GeoTIFF library not loaded');
    }

    clearCurrentLayer();
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

    currentRasterLayer = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(map);
    currentRasterBounds = bounds;

    if (!placementMode || placementMode.value === 'fit') {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    mapEmptyNote.style.display = 'none';
    setStatus('Loaded ' + file.name);
    updateColorbar(min, max);
    updateRasterStats(min, max, width, height, crsText);
    addConsoleLine('info', 'TIFF displayed successfully');
  }

  async function handleFile(file) {
    try {
      if (!file) {
        addConsoleLine('err', 'No file received');
        return;
      }

      selectedFile.textContent = file.name;
      setStatus('Reading ' + file.name + ' ...');
      addConsoleLine('info', 'File selected: ' + file.name);

      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'asc') {
        const text = await file.text();
        addConsoleLine('info', 'ASC text loaded. Length=' + text.length);
        const asc = parseAsc(text);
        addAscLayer(asc, file.name);
      } else if (ext === 'tif' || ext === 'tiff') {
        await addTiffLayer(file);
      } else {
        throw new Error('Unsupported file type: ' + ext);
      }
    } catch (err) {
      setStatus('Error loading file');
      addConsoleLine('err', 'handleFile error: ' + err.message);
    }
  }

  fileInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) {
      addConsoleLine('warn', 'No file selected');
      return;
    }
    handleFile(file);
  });

  dropBox.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropBox.classList.add('dragover');
  });

  dropBox.addEventListener('dragleave', function () {
    dropBox.classList.remove('dragover');
  });

  dropBox.addEventListener('drop', function (e) {
    e.preventDefault();
    dropBox.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (!file) {
      addConsoleLine('warn', 'Drop event had no file');
      return;
    }
    handleFile(file);
  });

  clearConsoleBtn.addEventListener('click', clearConsole);
  fitLayerBtn.addEventListener('click', fitCurrentLayer);
  fitLayerMapBtn.addEventListener('click', fitCurrentLayer);

  clearLayerBtn.addEventListener('click', function () {
    clearCurrentLayer();
    mapEmptyNote.style.display = 'block';
    hideColorbar();
    rasterStats.textContent = 'No raster loaded';
    setStatus('Layer cleared');
    addConsoleLine('warn', 'Raster layer cleared');
  });

  resetViewBtn.addEventListener('click', resetMapView);
  zoomInMapBtn.addEventListener('click', function () { if (map) map.zoomIn(); });
  zoomOutMapBtn.addEventListener('click', function () { if (map) map.zoomOut(); });

  if (typeof proj4 === 'undefined') {
    addConsoleLine('err', 'proj4 library did not load');
  } else {
    addConsoleLine('info', 'proj4 library loaded');
  }

  initMap();
  addConsoleLine('info', 'System initialized');
  addConsoleLine('info', 'Ready. Choose CRS first if your raster is projected.');
})();