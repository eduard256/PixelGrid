/* ============================================================
   PixelGrid -- Canvas Editor
   Handles image rendering, grid overlay, and crop tool
   ============================================================ */

'use strict';

const CanvasEditor = (() => {

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  let mainCanvas, mainCtx;
  let overlayCanvas, overlayCtx;
  let canvasWrap;

  let currentEntry = null;
  let displayScale = 1;   // ratio: displayed pixels / original pixels
  let canvasW = 0;
  let canvasH = 0;

  // Crop state (in original image coordinates)
  let crop = null;          // { x, y, w, h }
  let isDragging = false;
  let dragMode = 'none';   // 'draw' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r'
  let dragStart = { x: 0, y: 0 };
  let cropStart = null;

  const HANDLE_SIZE = 7;   // px in screen space

  // ----------------------------------------------------------
  // Init & Load
  // ----------------------------------------------------------
  function loadImage(entry) {
    currentEntry = entry;
    crop = entry.crop || null;

    if (!mainCanvas) {
      mainCanvas = document.getElementById('mainCanvas');
      mainCtx = mainCanvas.getContext('2d');
      overlayCanvas = document.getElementById('overlayCanvas');
      overlayCtx = overlayCanvas.getContext('2d');
      canvasWrap = document.getElementById('canvasWrap');
      bindCanvasEvents();
    }

    fitToContainer();
    drawMain();
    drawOverlay();
    updateZoomInfo();
  }

  function fitToContainer() {
    const editor = document.getElementById('editor');
    const maxW = editor.clientWidth - 40;
    const maxH = editor.clientHeight - 60;

    const imgW = currentEntry.img.naturalWidth;
    const imgH = currentEntry.img.naturalHeight;

    displayScale = Math.min(maxW / imgW, maxH / imgH, 1);
    canvasW = Math.round(imgW * displayScale);
    canvasH = Math.round(imgH * displayScale);

    mainCanvas.width = canvasW;
    mainCanvas.height = canvasH;
    overlayCanvas.width = canvasW;
    overlayCanvas.height = canvasH;

    canvasWrap.style.width = canvasW + 'px';
    canvasWrap.style.height = canvasH + 'px';
  }

  function drawMain() {
    mainCtx.clearRect(0, 0, canvasW, canvasH);
    mainCtx.drawImage(currentEntry.img, 0, 0, canvasW, canvasH);
  }

  function updateZoomInfo() {
    const pct = Math.round(displayScale * 100);
    const el = document.getElementById('infoZoom');
    if (el) el.textContent = pct + '%';
  }

  // ----------------------------------------------------------
  // Overlay Drawing
  // ----------------------------------------------------------
  function drawOverlay() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, canvasW, canvasH);

    const flags = App.state.gridFlags;

    // Rule of thirds
    if (flags.thirds) drawThirds();
    // Center rectangle
    if (flags.centerRect) drawCenterRect();
    // Diagonals
    if (flags.diagonals) drawDiagonals();
    // Center point
    if (flags.center) drawCenterPoint();
    // Crop selection
    if (crop && crop.w > 0 && crop.h > 0) drawCropOverlay();
    // Pad visualization
    drawPadOverlay();
  }

  function drawThirds() {
    overlayCtx.strokeStyle = 'rgba(184, 169, 212, 0.35)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([]);

    const thirdW = canvasW / 3;
    const thirdH = canvasH / 3;

    for (let i = 1; i <= 2; i++) {
      // Vertical
      drawLine(Math.round(thirdW * i), 0, Math.round(thirdW * i), canvasH);
      // Horizontal
      drawLine(0, Math.round(thirdH * i), canvasW, Math.round(thirdH * i));
    }
  }

  function drawCenterRect() {
    overlayCtx.strokeStyle = 'rgba(212, 169, 184, 0.3)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([4, 3]);

    const thirdW = canvasW / 3;
    const thirdH = canvasH / 3;

    overlayCtx.strokeRect(
      Math.round(thirdW),
      Math.round(thirdH),
      Math.round(thirdW),
      Math.round(thirdH)
    );
    overlayCtx.setLineDash([]);
  }

  function drawDiagonals() {
    overlayCtx.strokeStyle = 'rgba(169, 196, 212, 0.25)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([]);

    drawLine(0, 0, canvasW, canvasH);
    drawLine(canvasW, 0, 0, canvasH);
  }

  function drawCenterPoint() {
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const arm = 12;

    overlayCtx.strokeStyle = 'rgba(212, 169, 184, 0.6)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([]);

    // Crosshair
    drawLine(cx - arm, cy, cx + arm, cy);
    drawLine(cx, cy - arm, cx, cy + arm);

    // Small circle
    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    overlayCtx.stroke();
  }

  // ----------------------------------------------------------
  // Crop Overlay
  // ----------------------------------------------------------
  function drawCropOverlay() {
    if (!crop) return;

    const sx = crop.x * displayScale;
    const sy = crop.y * displayScale;
    const sw = crop.w * displayScale;
    const sh = crop.h * displayScale;

    // Dim outside area
    overlayCtx.fillStyle = 'rgba(17, 17, 24, 0.55)';
    // Top
    overlayCtx.fillRect(0, 0, canvasW, sy);
    // Bottom
    overlayCtx.fillRect(0, sy + sh, canvasW, canvasH - sy - sh);
    // Left
    overlayCtx.fillRect(0, sy, sx, sh);
    // Right
    overlayCtx.fillRect(sx + sw, sy, canvasW - sx - sw, sh);

    // Crop border
    overlayCtx.strokeStyle = 'rgba(184, 169, 212, 0.8)';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([]);
    overlayCtx.strokeRect(sx, sy, sw, sh);

    // Handles
    drawHandles(sx, sy, sw, sh);

    // Size label
    overlayCtx.fillStyle = 'rgba(184, 169, 212, 0.9)';
    overlayCtx.font = '11px "JetBrains Mono", monospace';
    overlayCtx.textAlign = 'center';
    const labelText = crop.w + ' x ' + crop.h;
    const labelY = sy > 20 ? sy - 6 : sy + sh + 16;
    overlayCtx.fillText(labelText, sx + sw / 2, labelY);
  }

  function drawHandles(sx, sy, sw, sh) {
    const hs = HANDLE_SIZE;
    overlayCtx.fillStyle = 'rgba(184, 169, 212, 0.9)';
    overlayCtx.strokeStyle = 'rgba(30, 30, 40, 0.8)';
    overlayCtx.lineWidth = 1;

    const positions = [
      [sx - hs/2, sy - hs/2],                 // top-left
      [sx + sw - hs/2, sy - hs/2],             // top-right
      [sx - hs/2, sy + sh - hs/2],             // bottom-left
      [sx + sw - hs/2, sy + sh - hs/2],        // bottom-right
      [sx + sw/2 - hs/2, sy - hs/2],           // top-center
      [sx + sw/2 - hs/2, sy + sh - hs/2],      // bottom-center
      [sx - hs/2, sy + sh/2 - hs/2],           // left-center
      [sx + sw - hs/2, sy + sh/2 - hs/2],      // right-center
    ];

    positions.forEach(([px, py]) => {
      overlayCtx.fillRect(px, py, hs, hs);
      overlayCtx.strokeRect(px, py, hs, hs);
    });
  }

  // ----------------------------------------------------------
  // Pad Overlay (shows extended area from original)
  // ----------------------------------------------------------
  function drawPadOverlay() {
    const entry = App.getActiveEntry();
    if (!entry?.crop || !entry.pad) return;
    const pad = entry.pad;
    if (pad.sides === 0 && pad.top === 0 && pad.bottom === 0) return;

    const c = entry.crop;
    const sx = (c.x - pad.sides) * displayScale;
    const sy = (c.y - pad.top) * displayScale;
    const sw = (c.w + pad.sides * 2) * displayScale;
    const sh = (c.h + pad.top + pad.bottom) * displayScale;

    // Outer pad border (dashed)
    overlayCtx.strokeStyle = 'rgba(169, 212, 184, 0.5)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([5, 4]);
    overlayCtx.strokeRect(sx, sy, sw, sh);
    overlayCtx.setLineDash([]);

    // Size label for pad area
    overlayCtx.fillStyle = 'rgba(169, 212, 184, 0.7)';
    overlayCtx.font = '10px "JetBrains Mono", monospace';
    overlayCtx.textAlign = 'center';
    const totalW = c.w + pad.sides * 2 + (pad.sidesExtra || 0);
    const totalH = c.h + pad.top + pad.bottom;
    overlayCtx.fillText(totalW + ' x ' + totalH, sx + sw / 2, sy - 4);
  }

  // ----------------------------------------------------------
  // Canvas Events (crop tool)
  // ----------------------------------------------------------
  function bindCanvasEvents() {
    overlayCanvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    overlayCanvas.addEventListener('mousemove', onHoverCursor);
  }

  function screenToImage(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      sx, sy,
      ix: Math.round(sx / displayScale),
      iy: Math.round(sy / displayScale),
    };
  }

  function onMouseDown(e) {
    const { sx, sy, ix, iy } = screenToImage(e);

    if (crop && crop.w > 0 && crop.h > 0) {
      // Check handles first
      const handle = hitTestHandle(sx, sy);
      if (handle) {
        dragMode = handle;
        isDragging = true;
        dragStart = { x: ix, y: iy };
        cropStart = { ...crop };
        return;
      }

      // Check if inside crop (move)
      const csx = crop.x * displayScale;
      const csy = crop.y * displayScale;
      const csw = crop.w * displayScale;
      const csh = crop.h * displayScale;

      if (sx >= csx && sx <= csx + csw && sy >= csy && sy <= csy + csh) {
        dragMode = 'move';
        isDragging = true;
        dragStart = { x: ix, y: iy };
        cropStart = { ...crop };
        return;
      }
    }

    // Draw new crop
    dragMode = 'draw';
    isDragging = true;
    dragStart = { x: ix, y: iy };
    crop = { x: ix, y: iy, w: 0, h: 0 };
  }

  function onMouseMove(e) {
    if (!isDragging) return;

    const { ix, iy } = screenToImage(e);
    const imgW = currentEntry.img.naturalWidth;
    const imgH = currentEntry.img.naturalHeight;

    if (dragMode === 'draw') {
      const x = Math.min(dragStart.x, ix);
      const y = Math.min(dragStart.y, iy);
      const w = Math.abs(ix - dragStart.x);
      const h = Math.abs(iy - dragStart.y);

      crop = {
        x: clamp(x, 0, imgW),
        y: clamp(y, 0, imgH),
        w: clamp(w, 0, imgW - clamp(x, 0, imgW)),
        h: clamp(h, 0, imgH - clamp(y, 0, imgH)),
      };
    } else if (dragMode === 'move') {
      const dx = ix - dragStart.x;
      const dy = iy - dragStart.y;
      crop.x = clamp(cropStart.x + dx, 0, imgW - cropStart.w);
      crop.y = clamp(cropStart.y + dy, 0, imgH - cropStart.h);
      crop.w = cropStart.w;
      crop.h = cropStart.h;
    } else {
      // Resize handles
      resizeCrop(dragMode, ix, iy, imgW, imgH);
    }

    syncCropToPanel();
    drawOverlay();
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;

    if (crop && crop.w > 2 && crop.h > 2) {
      const entry = App.getActiveEntry();
      if (entry) {
        entry.crop = { ...crop };
        entry.status = 'cropped';
        App.updatePanel();
        App.renderGallery();
      }
    }

    drawOverlay();
  }

  // ----------------------------------------------------------
  // Resize logic
  // ----------------------------------------------------------
  function resizeCrop(mode, ix, iy, imgW, imgH) {
    const c = cropStart;
    let x = c.x, y = c.y, w = c.w, h = c.h;

    switch (mode) {
      case 'resize-tl':
        x = clamp(ix, 0, c.x + c.w - 1);
        y = clamp(iy, 0, c.y + c.h - 1);
        w = c.x + c.w - x;
        h = c.y + c.h - y;
        break;
      case 'resize-tr':
        y = clamp(iy, 0, c.y + c.h - 1);
        w = clamp(ix - c.x, 1, imgW - c.x);
        h = c.y + c.h - y;
        break;
      case 'resize-bl':
        x = clamp(ix, 0, c.x + c.w - 1);
        w = c.x + c.w - x;
        h = clamp(iy - c.y, 1, imgH - c.y);
        break;
      case 'resize-br':
        w = clamp(ix - c.x, 1, imgW - c.x);
        h = clamp(iy - c.y, 1, imgH - c.y);
        break;
      case 'resize-t':
        y = clamp(iy, 0, c.y + c.h - 1);
        h = c.y + c.h - y;
        break;
      case 'resize-b':
        h = clamp(iy - c.y, 1, imgH - c.y);
        break;
      case 'resize-l':
        x = clamp(ix, 0, c.x + c.w - 1);
        w = c.x + c.w - x;
        break;
      case 'resize-r':
        w = clamp(ix - c.x, 1, imgW - c.x);
        break;
    }

    crop = { x, y, w, h };
  }

  // ----------------------------------------------------------
  // Hit testing handles
  // ----------------------------------------------------------
  function hitTestHandle(sx, sy) {
    if (!crop) return null;

    const cx = crop.x * displayScale;
    const cy = crop.y * displayScale;
    const cw = crop.w * displayScale;
    const ch = crop.h * displayScale;
    const hs = HANDLE_SIZE + 4; // slightly larger hit area

    const handles = [
      { mode: 'resize-tl', x: cx, y: cy },
      { mode: 'resize-tr', x: cx + cw, y: cy },
      { mode: 'resize-bl', x: cx, y: cy + ch },
      { mode: 'resize-br', x: cx + cw, y: cy + ch },
      { mode: 'resize-t',  x: cx + cw/2, y: cy },
      { mode: 'resize-b',  x: cx + cw/2, y: cy + ch },
      { mode: 'resize-l',  x: cx, y: cy + ch/2 },
      { mode: 'resize-r',  x: cx + cw, y: cy + ch/2 },
    ];

    for (const h of handles) {
      if (Math.abs(sx - h.x) <= hs && Math.abs(sy - h.y) <= hs) {
        return h.mode;
      }
    }
    return null;
  }

  // ----------------------------------------------------------
  // Cursor
  // ----------------------------------------------------------
  function onHoverCursor(e) {
    if (isDragging) return;

    const { sx, sy } = screenToImage(e);

    if (crop && crop.w > 0 && crop.h > 0) {
      const handle = hitTestHandle(sx, sy);
      if (handle) {
        const cursors = {
          'resize-tl': 'nwse-resize', 'resize-br': 'nwse-resize',
          'resize-tr': 'nesw-resize', 'resize-bl': 'nesw-resize',
          'resize-t': 'ns-resize', 'resize-b': 'ns-resize',
          'resize-l': 'ew-resize', 'resize-r': 'ew-resize',
        };
        overlayCanvas.style.cursor = cursors[handle] || 'crosshair';
        return;
      }

      // Inside crop?
      const csx = crop.x * displayScale;
      const csy = crop.y * displayScale;
      const csw = crop.w * displayScale;
      const csh = crop.h * displayScale;

      if (sx >= csx && sx <= csx + csw && sy >= csy && sy <= csy + csh) {
        overlayCanvas.style.cursor = 'move';
        return;
      }
    }

    overlayCanvas.style.cursor = 'crosshair';
  }

  // ----------------------------------------------------------
  // Sync crop to panel fields
  // ----------------------------------------------------------
  function syncCropToPanel() {
    if (!crop) return;
    const dom = App.dom;
    dom.cropX.value = Math.round(crop.x);
    dom.cropY.value = Math.round(crop.y);
    dom.cropW.value = Math.round(crop.w);
    dom.cropH.value = Math.round(crop.h);
  }

  // ----------------------------------------------------------
  // External API
  // ----------------------------------------------------------
  function setCrop(c) {
    crop = c ? { ...c } : null;
  }

  function clearCrop() {
    crop = null;
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  function drawLine(x1, y1, x2, y2) {
    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.stroke();
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // ----------------------------------------------------------
  // Public
  // ----------------------------------------------------------
  return {
    loadImage,
    drawOverlay,
    setCrop,
    clearCrop,
    get crop() { return crop; },
    get displayScale() { return displayScale; },
  };

})();
