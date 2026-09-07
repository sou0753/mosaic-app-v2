
const fileInput = document.getElementById('fileInput');
const editorCard = document.getElementById('editorCard');
const stage = document.getElementById('stage');
const viewCanvas = document.getElementById('viewCanvas');
const viewCtx = viewCanvas.getContext('2d');
const emptyHint = document.getElementById('emptyHint');

const modeSelect = document.getElementById('modeSelect');
const brushSize = document.getElementById('brushSize');
const strengthRange = document.getElementById('strengthRange');
const brushValue = document.getElementById('brushValue');
const strengthValue = document.getElementById('strengthValue');
const zoomLabel = document.getElementById('zoomLabel');

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const resetViewBtn = document.getElementById('resetViewBtn');

const editCanvas = document.createElement('canvas');
const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });

let originalImageData = null;
let imageLoaded = false;

let history = [];
let redoHistory = [];
const maxHistory = 8;

let pointers = new Map();
let drawingPointerId = null;
let isDrawing = false;
let lastDrawPoint = null;

let gestureStart = null;

let view = { scale: 1, offsetX: 0, offsetY: 0, fit: 1 };
let dpr = Math.max(1, window.devicePixelRatio || 1);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateLabels() {
  brushValue.textContent = brushSize.value;
  strengthValue.textContent = strengthRange.value;
}

function updateButtons() {
  const disabled = !imageLoaded;
  undoBtn.disabled = disabled || history.length === 0;
  redoBtn.disabled = disabled || redoHistory.length === 0;
  clearBtn.disabled = disabled;
  saveBtn.disabled = disabled;
  resetViewBtn.disabled = disabled;
}

function resizeViewCanvas() {
  const rect = stage.getBoundingClientRect();
  dpr = Math.max(1, window.devicePixelRatio || 1);
  viewCanvas.width = Math.round(rect.width * dpr);
  viewCanvas.height = Math.round(rect.height * dpr);
  viewCtx.setTransform(1, 0, 0, 1, 0, 0);
  viewCtx.scale(dpr, dpr);
  if (imageLoaded) {
    fitImageToStage(true);
    render();
  }
}

function fitImageToStage(resetScaleOnly = false) {
  const rect = stage.getBoundingClientRect();
  const fitX = rect.width / editCanvas.width;
  const fitY = rect.height / editCanvas.height;
  view.fit = Math.min(fitX, fitY);
  if (resetScaleOnly) {
    // keep current zoom ratio when possible
    const currentZoom = view.scale || 1;
    const imageW = editCanvas.width * view.fit * currentZoom;
    const imageH = editCanvas.height * view.fit * currentZoom;
    view.offsetX = (rect.width - imageW) / 2;
    view.offsetY = (rect.height - imageH) / 2;
  }
}

function resetView() {
  const rect = stage.getBoundingClientRect();
  const fitX = rect.width / editCanvas.width;
  const fitY = rect.height / editCanvas.height;
  view.fit = Math.min(fitX, fitY);
  view.scale = 1;
  view.offsetX = (rect.width - editCanvas.width * view.fit) / 2;
  view.offsetY = (rect.height - editCanvas.height * view.fit) / 2;
  updateZoomLabel();
  render();
}

function updateZoomLabel() {
  zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
}

function screenToImage(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return {
    x: (x - view.offsetX) / (view.fit * view.scale),
    y: (y - view.offsetY) / (view.fit * view.scale)
  };
}

function imageToScreen(ix, iy) {
  return {
    x: ix * view.fit * view.scale + view.offsetX,
    y: iy * view.fit * view.scale + view.offsetY
  };
}

function render(brushPreviewPoint = null) {
  const rect = stage.getBoundingClientRect();
  viewCtx.clearRect(0, 0, rect.width, rect.height);

  if (!imageLoaded) return;

  const drawW = editCanvas.width * view.fit * view.scale;
  const drawH = editCanvas.height * view.fit * view.scale;

  viewCtx.imageSmoothingEnabled = true;
  viewCtx.drawImage(editCanvas, view.offsetX, view.offsetY, drawW, drawH);

  if (brushPreviewPoint) {
    const screen = imageToScreen(brushPreviewPoint.x, brushPreviewPoint.y);
    const radius = (Number(brushSize.value) / 2) * view.fit * view.scale;
    viewCtx.save();
    viewCtx.strokeStyle = 'rgba(255,255,255,0.9)';
    viewCtx.lineWidth = 2;
    viewCtx.setLineDash([6, 4]);
    viewCtx.beginPath();
    viewCtx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    viewCtx.stroke();
    viewCtx.restore();
  }
}

function snapshot() {
  history.push(editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height));
  if (history.length > maxHistory) history.shift();
  redoHistory = [];
  updateButtons();
}

function restoreImageData(imageData) {
  editCtx.putImageData(imageData, 0, 0);
  render();
  updateButtons();
}

function loadImageBitmap(bitmap) {
  const maxSide = 2200;
  let w = bitmap.width;
  let h = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  editCanvas.width = w;
  editCanvas.height = h;
  editCtx.clearRect(0, 0, w, h);
  editCtx.drawImage(bitmap, 0, 0, w, h);
  originalImageData = editCtx.getImageData(0, 0, w, h);

  history = [];
  redoHistory = [];
  imageLoaded = true;
  editorCard.classList.remove('hidden');
  emptyHint.classList.add('hidden');
  resizeViewCanvas();
  resetView();
  updateButtons();
}

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  loadImageBitmap(bitmap);
});

function applyAt(x, y) {
  if (!imageLoaded) return;
  const radius = Number(brushSize.value) / 2;
  const strength = Number(strengthRange.value);
  const mode = modeSelect.value;

  if (mode === 'pixelate') {
    pixelateCircle(x, y, radius, strength);
  } else if (mode === 'blur') {
    blurCircle(x, y, radius, strength);
  } else if (mode === 'black') {
    editCtx.save();
    editCtx.fillStyle = '#000';
    editCtx.beginPath();
    editCtx.arc(x, y, radius, 0, Math.PI * 2);
    editCtx.fill();
    editCtx.restore();
  }
}

function pixelateCircle(cx, cy, radius, block) {
  const left = clamp(Math.floor(cx - radius), 0, editCanvas.width);
  const top = clamp(Math.floor(cy - radius), 0, editCanvas.height);
  const right = clamp(Math.ceil(cx + radius), 0, editCanvas.width);
  const bottom = clamp(Math.ceil(cy + radius), 0, editCanvas.height);

  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;

  const img = editCtx.getImageData(left, top, width, height);
  const data = img.data;

  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const sampleX = Math.min(width - 1, bx + Math.floor(block / 2));
      const sampleY = Math.min(height - 1, by + Math.floor(block / 2));
      const sampleIndex = (sampleY * width + sampleX) * 4;
      const r = data[sampleIndex];
      const g = data[sampleIndex + 1];
      const b = data[sampleIndex + 2];
      const a = data[sampleIndex + 3];

      for (let y = by; y < Math.min(height, by + block); y++) {
        for (let x = bx; x < Math.min(width, bx + block); x++) {
          const globalX = left + x;
          const globalY = top + y;
          if (Math.hypot(globalX - cx, globalY - cy) > radius) continue;
          const i = (y * width + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
    }
  }

  editCtx.putImageData(img, left, top);
}

function blurCircle(cx, cy, radius, strength) {
  const pad = Math.max(12, strength * 2);
  const sourceLeft = clamp(Math.floor(cx - radius - pad), 0, editCanvas.width);
  const sourceTop = clamp(Math.floor(cy - radius - pad), 0, editCanvas.height);
  const sourceRight = clamp(Math.ceil(cx + radius + pad), 0, editCanvas.width);
  const sourceBottom = clamp(Math.ceil(cy + radius + pad), 0, editCanvas.height);
  const sw = sourceRight - sourceLeft;
  const sh = sourceBottom - sourceTop;
  if (sw <= 0 || sh <= 0) return;

  const temp = document.createElement('canvas');
  temp.width = sw;
  temp.height = sh;
  const tctx = temp.getContext('2d');
  tctx.filter = `blur(${strength}px)`;
  tctx.drawImage(editCanvas, sourceLeft, sourceTop, sw, sh, 0, 0, sw, sh);

  editCtx.save();
  editCtx.beginPath();
  editCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  editCtx.clip();
  editCtx.drawImage(temp, sourceLeft, sourceTop);
  editCtx.restore();
}

function drawInterpolated(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(2, Number(brushSize.value) / 6);
  const count = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    applyAt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
}

function beginGestureIfNeeded() {
  if (pointers.size < 2 || !imageLoaded) return;
  const entries = [...pointers.values()].slice(0, 2);
  const a = entries[0];
  const b = entries[1];
  const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const imageAtCenter = screenToImage(center.x, center.y);
  gestureStart = {
    distance,
    center,
    startScale: view.scale,
    imageAtCenter
  };
  isDrawing = false;
  drawingPointerId = null;
  lastDrawPoint = null;
}

function handleGestureMove() {
  if (!gestureStart || pointers.size < 2) return;
  const entries = [...pointers.values()].slice(0, 2);
  const a = entries[0];
  const b = entries[1];
  const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  view.scale = clamp(gestureStart.startScale * (distance / gestureStart.distance), 1, 8);

  const rect = stage.getBoundingClientRect();
  const stageX = center.x - rect.left;
  const stageY = center.y - rect.top;
  view.offsetX = stageX - gestureStart.imageAtCenter.x * view.fit * view.scale;
  view.offsetY = stageY - gestureStart.imageAtCenter.y * view.fit * view.scale;

  updateZoomLabel();
  render();
}

function onPointerDown(event) {
  stage.setPointerCapture?.(event.pointerId);
  pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

  if (pointers.size >= 2) {
    beginGestureIfNeeded();
    return;
  }

  if (!imageLoaded) return;

  snapshot();
  drawingPointerId = event.pointerId;
  isDrawing = true;
  lastDrawPoint = screenToImage(event.clientX, event.clientY);
  applyAt(lastDrawPoint.x, lastDrawPoint.y);
  render(lastDrawPoint);
}

function onPointerMove(event) {
  if (pointers.has(event.pointerId)) {
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  }

  if (pointers.size >= 2) {
    if (!gestureStart) beginGestureIfNeeded();
    handleGestureMove();
    return;
  }

  if (!imageLoaded) return;

  const imagePoint = screenToImage(event.clientX, event.clientY);

  if (isDrawing && drawingPointerId === event.pointerId) {
    drawInterpolated(lastDrawPoint, imagePoint);
    lastDrawPoint = imagePoint;
    render(imagePoint);
  } else {
    render(imagePoint);
  }
}

function endPointer(event) {
  pointers.delete(event.pointerId);

  if (pointers.size < 2) {
    gestureStart = null;
  }

  if (drawingPointerId === event.pointerId) {
    isDrawing = false;
    drawingPointerId = null;
    lastDrawPoint = null;
    render();
    updateButtons();
  } else if (pointers.size === 0) {
    render();
  }
}

stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('pointerleave', (event) => {
  if (isDrawing && drawingPointerId === event.pointerId) return;
});

undoBtn.addEventListener('click', () => {
  if (!history.length) return;
  redoHistory.push(editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height));
  const prev = history.pop();
  restoreImageData(prev);
});

redoBtn.addEventListener('click', () => {
  if (!redoHistory.length) return;
  history.push(editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height));
  const next = redoHistory.pop();
  restoreImageData(next);
});

clearBtn.addEventListener('click', () => {
  if (!imageLoaded || !originalImageData) return;
  snapshot();
  editCtx.putImageData(originalImageData, 0, 0);
  render();
  updateButtons();
});

resetViewBtn.addEventListener('click', () => {
  if (!imageLoaded) return;
  resetView();
});

saveBtn.addEventListener('click', async () => {
  if (!imageLoaded) return;
  const blob = await new Promise(resolve => editCanvas.toBlob(resolve, 'image/jpeg', 0.96));
  if (!blob) return;

  const file = new File([blob], 'mosaic.jpg', { type: 'image/jpeg' });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'モザイク画像' });
      return;
    } catch (error) {}
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mosaic.jpg';
  a.click();
  URL.revokeObjectURL(url);
});

brushSize.addEventListener('input', () => {
  updateLabels();
  render();
});
strengthRange.addEventListener('input', () => {
  updateLabels();
  render();
});
modeSelect.addEventListener('change', () => render());

window.addEventListener('resize', resizeViewCanvas);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js');
  });
}

updateLabels();
updateButtons();
resizeViewCanvas();
