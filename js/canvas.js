/* ============================================================
   PixelGrid -- Canvas Editor
   Handles image rendering, grid overlay, crop tool,
   pinch-to-zoom and pan (trackpad / mouse wheel / touch)
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

  // Display geometry
  let baseScale  = 1;     // scale to fit image into editor viewport
  let zoomLevel  = 1;     // user zoom multiplier (1 = fit, >1 = zoomed in)
  let panX       = 0;     // pan offset in screen pixels
  let panY       = 0;
  let canvasW    = 0;     // current canvas pixel size (changes with zoom)
  let canvasH    = 0;
  let editorW    = 0;     // cached editor container size
  let editorH    = 0;

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 10;

  // Active tool: 'crop' or 'blur'
  let activeTool = 'crop';

  // Locked aspect ratio (null = free, number = w/h ratio)
  let lockedRatio = null;

  // Blur drawing state
  let blurDraw = null;  // { x, y, w, h } while drawing a blur rect

  // Crop state (in original image coordinates)
  let crop = null;
  let isDragging = false;
  let dragMode = 'none';  // 'draw' | 'move' | 'resize-*' | 'pan'
  let dragStart = { x: 0, y: 0 };
  let dragStartScreen = { x: 0, y: 0 };
  let cropStart = null;
  let panStart = { x: 0, y: 0 };

  const HANDLE_SIZE = 7;

  // Touch state for pinch-to-zoom
  let lastTouchDist = 0;
  let lastTouchCenter = { x: 0, y: 0 };
  let touchStartPan = { x: 0, y: 0 };

  // ----------------------------------------------------------
  // Computed helpers
  // ----------------------------------------------------------

  // Effective scale: base fit * user zoom
  function effectiveScale() {
    return baseScale * zoomLevel;
  }

  // Combined displayScale used everywhere for coordinate conversion
  // (kept as a getter for backward compat with overlay drawing code)
  function getDisplayScale() {
    return effectiveScale();
  }

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

    // Reset zoom/pan when loading a new image
    zoomLevel = 1;
    panX = 0;
    panY = 0;

    cacheEditorSize();
    applyZoom();
  }

  function cacheEditorSize() {
    const editor = document.getElementById('editor');
    editorW = editor.clientWidth - 40;
    editorH = editor.clientHeight - 60;
  }

  // Recalculate canvas size based on zoom, redraw everything
  function applyZoom() {
    if (!currentEntry) return;

    const imgW = currentEntry.img.naturalWidth;
    const imgH = currentEntry.img.naturalHeight;

    baseScale = Math.min(editorW / imgW, editorH / imgH, 1);
    const es = effectiveScale();

    canvasW = Math.round(imgW * es);
    canvasH = Math.round(imgH * es);

    // Clamp pan so image doesn't fly off entirely
    clampPan();

    mainCanvas.width = canvasW;
    mainCanvas.height = canvasH;
    overlayCanvas.width = canvasW;
    overlayCanvas.height = canvasH;

    canvasWrap.style.width = canvasW + 'px';
    canvasWrap.style.height = canvasH + 'px';
    canvasWrap.style.transform = 'translate(' + panX + 'px, ' + panY + 'px)';

    drawMain();
    drawOverlay();
    updateZoomInfo();
  }

  function clampPan() {
    // Allow panning so at least 50px of image stays visible
    const minVisible = 50;
    const maxPanX = editorW - minVisible;
    const maxPanY = editorH - minVisible;
    const minPanX = -(canvasW - minVisible);
    const minPanY = -(canvasH - minVisible);

    // Only constrain when zoomed beyond viewport
    if (canvasW > editorW + 40 || canvasH > editorH + 60) {
      panX = clamp(panX, minPanX, maxPanX);
      panY = clamp(panY, minPanY, maxPanY);
    } else {
      // When image fits, center it (no pan)
      panX = 0;
      panY = 0;
    }
  }

  function drawMain() {
    mainCtx.clearRect(0, 0, canvasW, canvasH);
    mainCtx.drawImage(currentEntry.img, 0, 0, canvasW, canvasH);
  }

  function updateZoomInfo() {
    const pct = Math.round(effectiveScale() * 100);
    const el = document.getElementById('infoZoom');
    if (el) el.textContent = pct + '%';
  }

  // ----------------------------------------------------------
  // Zoom logic
  // ----------------------------------------------------------

  // Zoom centered on a screen point (relative to canvas wrapper parent)
  function zoomAt(screenX, screenY, delta) {
    const oldZoom = zoomLevel;
    const factor = delta > 0 ? 0.92 : 1.08; // scroll down = zoom out, up = zoom in
    let newZoom = zoomLevel * factor;
    newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);

    if (newZoom === oldZoom) return;

    // Zoom towards the cursor: adjust pan so the point under cursor stays put
    const ratio = newZoom / oldZoom;

    // screenX/Y relative to editor container
    const anchorX = screenX - panX;
    const anchorY = screenY - panY;

    panX = screenX - anchorX * ratio;
    panY = screenY - anchorY * ratio;

    zoomLevel = newZoom;
    applyZoom();
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyZoom();
  }

  // ----------------------------------------------------------
  // Overlay Drawing
  // ----------------------------------------------------------
  function drawOverlay() {
    if (!overlayCtx) return;
    const ds = getDisplayScale();
    overlayCtx.clearRect(0, 0, canvasW, canvasH);

    const flags = App.state.gridFlags;

    if (flags.thirds) drawThirds();
    if (flags.centerRect) drawCenterRect();
    if (flags.diagonals) drawDiagonals();
    if (flags.center) drawCenterPoint();
    if (crop && crop.w > 0 && crop.h > 0) drawCropOverlay(ds);
    drawPadOverlay(ds);
    drawBlurRegions(ds);
    drawBlurPreview(ds);
  }

  function drawThirds() {
    overlayCtx.strokeStyle = 'rgba(184, 169, 212, 0.35)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([]);

    const thirdW = canvasW / 3;
    const thirdH = canvasH / 3;

    for (let i = 1; i <= 2; i++) {
      drawLine(Math.round(thirdW * i), 0, Math.round(thirdW * i), canvasH);
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
      Math.round(thirdW), Math.round(thirdH),
      Math.round(thirdW), Math.round(thirdH)
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

    drawLine(cx - arm, cy, cx + arm, cy);
    drawLine(cx, cy - arm, cx, cy + arm);

    overlayCtx.beginPath();
    overlayCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    overlayCtx.stroke();
  }

  // ----------------------------------------------------------
  // Crop Overlay
  // ----------------------------------------------------------
  function drawCropOverlay(ds) {
    if (!crop) return;

    const sx = crop.x * ds;
    const sy = crop.y * ds;
    const sw = crop.w * ds;
    const sh = crop.h * ds;

    // Dim outside area
    overlayCtx.fillStyle = 'rgba(17, 17, 24, 0.55)';
    overlayCtx.fillRect(0, 0, canvasW, sy);
    overlayCtx.fillRect(0, sy + sh, canvasW, canvasH - sy - sh);
    overlayCtx.fillRect(0, sy, sx, sh);
    overlayCtx.fillRect(sx + sw, sy, canvasW - sx - sw, sh);

    // Crop border
    overlayCtx.strokeStyle = 'rgba(184, 169, 212, 0.8)';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([]);
    overlayCtx.strokeRect(sx, sy, sw, sh);

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
      [sx - hs/2, sy - hs/2],
      [sx + sw - hs/2, sy - hs/2],
      [sx - hs/2, sy + sh - hs/2],
      [sx + sw - hs/2, sy + sh - hs/2],
      [sx + sw/2 - hs/2, sy - hs/2],
      [sx + sw/2 - hs/2, sy + sh - hs/2],
      [sx - hs/2, sy + sh/2 - hs/2],
      [sx + sw - hs/2, sy + sh/2 - hs/2],
    ];

    positions.forEach(([px, py]) => {
      overlayCtx.fillRect(px, py, hs, hs);
      overlayCtx.strokeRect(px, py, hs, hs);
    });
  }

  // ----------------------------------------------------------
  // Pad Overlay
  // ----------------------------------------------------------
  function drawPadOverlay(ds) {
    const entry = App.getActiveEntry();
    if (!entry?.crop || !entry.pad) return;
    const pad = entry.pad;
    if (pad.sides === 0 && pad.top === 0 && pad.bottom === 0) return;

    const c = entry.crop;
    const sx = (c.x - pad.sides) * ds;
    const sy = (c.y - pad.top) * ds;
    const sw = (c.w + pad.sides * 2) * ds;
    const sh = (c.h + pad.top + pad.bottom) * ds;

    overlayCtx.strokeStyle = 'rgba(169, 212, 184, 0.5)';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([5, 4]);
    overlayCtx.strokeRect(sx, sy, sw, sh);
    overlayCtx.setLineDash([]);

    overlayCtx.fillStyle = 'rgba(169, 212, 184, 0.7)';
    overlayCtx.font = '10px "JetBrains Mono", monospace';
    overlayCtx.textAlign = 'center';
    const totalW = c.w + pad.sides * 2 + (pad.sidesExtra || 0);
    const totalH = c.h + pad.top + pad.bottom;
    overlayCtx.fillText(totalW + ' x ' + totalH, sx + sw / 2, sy - 4);
  }

  // ----------------------------------------------------------
  // Blur region overlays (outlines on overlay canvas)
  // ----------------------------------------------------------
  function drawBlurRegions(ds) {
    const entry = App.getActiveEntry();
    if (!entry?.blurRegions || entry.blurRegions.length === 0) return;

    overlayCtx.strokeStyle = 'rgba(212, 122, 122, 0.6)';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([4, 3]);

    entry.blurRegions.forEach(r => {
      overlayCtx.strokeRect(r.x * ds, r.y * ds, r.w * ds, r.h * ds);
    });

    overlayCtx.setLineDash([]);
  }

  function drawBlurPreview(ds) {
    if (!blurDraw || blurDraw.w === 0 || blurDraw.h === 0) return;

    // Semi-transparent fill to show what will be blurred
    overlayCtx.fillStyle = 'rgba(212, 122, 122, 0.15)';
    overlayCtx.fillRect(blurDraw.x * ds, blurDraw.y * ds, blurDraw.w * ds, blurDraw.h * ds);

    overlayCtx.strokeStyle = 'rgba(212, 122, 122, 0.8)';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([]);
    overlayCtx.strokeRect(blurDraw.x * ds, blurDraw.y * ds, blurDraw.w * ds, blurDraw.h * ds);

    // Label
    overlayCtx.fillStyle = 'rgba(212, 122, 122, 0.9)';
    overlayCtx.font = '10px "JetBrains Mono", monospace';
    overlayCtx.textAlign = 'center';
    overlayCtx.fillText('BLUR', blurDraw.x * ds + blurDraw.w * ds / 2, blurDraw.y * ds + blurDraw.h * ds / 2 + 4);
  }

  // ----------------------------------------------------------
  // Canvas Events
  // ----------------------------------------------------------
  function bindCanvasEvents() {
    overlayCanvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    overlayCanvas.addEventListener('mousemove', onHoverCursor);

    // Wheel: zoom (pinch-to-zoom on trackpad sends wheel events with ctrlKey)
    // Regular scroll on trackpad (two-finger swipe) sends wheel without ctrlKey -> pan
    overlayCanvas.addEventListener('wheel', onWheel, { passive: false });

    // Touch events for mobile / tablet pinch-to-zoom
    overlayCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    overlayCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
    overlayCanvas.addEventListener('touchend', onTouchEnd);

    // Double-click to reset zoom
    overlayCanvas.addEventListener('dblclick', onDoubleClick);
  }

  // ----------------------------------------------------------
  // Wheel event (trackpad pinch-to-zoom & two-finger scroll)
  // ----------------------------------------------------------
  function onWheel(e) {
    e.preventDefault();

    const rect = canvasWrap.parentElement.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom on trackpad (or Ctrl+scroll with mouse)
      // e.deltaY is inverted for zoom: negative = zoom in
      zoomAt(mx, my, e.deltaY);
    } else {
      // Two-finger scroll = pan
      panX -= e.deltaX;
      panY -= e.deltaY;
      clampPan();
      canvasWrap.style.transform = 'translate(' + panX + 'px, ' + panY + 'px)';
    }
  }

  // ----------------------------------------------------------
  // Touch events (mobile pinch-to-zoom + drag-to-pan)
  // ----------------------------------------------------------
  function getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getTouchCenter(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      lastTouchDist = getTouchDist(e.touches[0], e.touches[1]);
      lastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]);
      touchStartPan = { x: panX, y: panY };
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();

      const dist = getTouchDist(e.touches[0], e.touches[1]);
      const center = getTouchCenter(e.touches[0], e.touches[1]);
      const rect = canvasWrap.parentElement.getBoundingClientRect();

      // Zoom
      if (lastTouchDist > 0) {
        const scale = dist / lastTouchDist;
        const oldZoom = zoomLevel;
        let newZoom = zoomLevel * scale;
        newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);

        if (newZoom !== oldZoom) {
          const ratio = newZoom / oldZoom;
          const cx = center.x - rect.left;
          const cy = center.y - rect.top;

          const anchorX = cx - panX;
          const anchorY = cy - panY;

          panX = cx - anchorX * ratio;
          panY = cy - anchorY * ratio;

          zoomLevel = newZoom;
        }
      }

      // Pan
      const dx = center.x - lastTouchCenter.x;
      const dy = center.y - lastTouchCenter.y;
      panX += dx;
      panY += dy;

      lastTouchDist = dist;
      lastTouchCenter = center;

      applyZoom();
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) {
      lastTouchDist = 0;
    }
  }

  // ----------------------------------------------------------
  // Double-click to reset zoom
  // ----------------------------------------------------------
  function onDoubleClick(e) {
    if (zoomLevel !== 1) {
      resetZoom();
    } else {
      // Zoom to 2x centered on click
      const rect = canvasWrap.parentElement.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Simulate a zoom-in
      const oldZoom = zoomLevel;
      const newZoom = 2;
      const ratio = newZoom / oldZoom;
      const anchorX = mx - panX;
      const anchorY = my - panY;
      panX = mx - anchorX * ratio;
      panY = my - anchorY * ratio;
      zoomLevel = newZoom;
      applyZoom();
    }
  }

  // ----------------------------------------------------------
  // Mouse coordinate conversion (accounts for zoom + pan)
  // ----------------------------------------------------------
  function screenToImage(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const ds = getDisplayScale();
    return {
      sx, sy,
      ix: Math.round(sx / ds),
      iy: Math.round(sy / ds),
    };
  }

  // ----------------------------------------------------------
  // Mouse crop interaction
  // ----------------------------------------------------------
  function onMouseDown(e) {
    // Middle mouse button or Space+click = pan
    if (e.button === 1) {
      e.preventDefault();
      dragMode = 'pan';
      isDragging = true;
      dragStartScreen = { x: e.clientX, y: e.clientY };
      panStart = { x: panX, y: panY };
      overlayCanvas.style.cursor = 'grabbing';
      return;
    }

    // Alt+click = pan (alternative for trackpads without middle button)
    if (e.altKey) {
      e.preventDefault();
      dragMode = 'pan';
      isDragging = true;
      dragStartScreen = { x: e.clientX, y: e.clientY };
      panStart = { x: panX, y: panY };
      overlayCanvas.style.cursor = 'grabbing';
      return;
    }

    const { sx, sy, ix, iy } = screenToImage(e);

    // Blur tool mode
    if (activeTool === 'blur') {
      dragMode = 'blur-draw';
      isDragging = true;
      dragStart = { x: ix, y: iy };
      blurDraw = { x: ix, y: iy, w: 0, h: 0 };
      return;
    }

    // Crop tool mode
    if (crop && crop.w > 0 && crop.h > 0) {
      const handle = hitTestHandle(sx, sy);
      if (handle) {
        dragMode = handle;
        isDragging = true;
        dragStart = { x: ix, y: iy };
        cropStart = { ...crop };
        return;
      }

      const ds = getDisplayScale();
      const csx = crop.x * ds;
      const csy = crop.y * ds;
      const csw = crop.w * ds;
      const csh = crop.h * ds;

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

    if (dragMode === 'pan') {
      panX = panStart.x + (e.clientX - dragStartScreen.x);
      panY = panStart.y + (e.clientY - dragStartScreen.y);
      clampPan();
      canvasWrap.style.transform = 'translate(' + panX + 'px, ' + panY + 'px)';
      return;
    }

    const { ix, iy } = screenToImage(e);
    const imgW = currentEntry.img.naturalWidth;
    const imgH = currentEntry.img.naturalHeight;

    if (dragMode === 'blur-draw') {
      const x = Math.min(dragStart.x, ix);
      const y = Math.min(dragStart.y, iy);
      const w = Math.abs(ix - dragStart.x);
      const h = Math.abs(iy - dragStart.y);
      blurDraw = {
        x: clamp(x, 0, imgW),
        y: clamp(y, 0, imgH),
        w: clamp(w, 0, imgW - clamp(x, 0, imgW)),
        h: clamp(h, 0, imgH - clamp(y, 0, imgH)),
      };
      drawOverlay();
      return;
    }

    if (dragMode === 'draw') {
      let w = Math.abs(ix - dragStart.x);
      let h = Math.abs(iy - dragStart.y);

      // Enforce aspect ratio if locked
      if (lockedRatio && lockedRatio > 0) {
        // Use the larger dimension to drive the constrained one
        const hFromW = Math.round(w / lockedRatio);
        const wFromH = Math.round(h * lockedRatio);
        if (hFromW <= imgH) {
          h = hFromW;
        } else {
          w = wFromH;
        }
      }

      // Calculate origin (top-left corner) based on drag direction
      const x = ix >= dragStart.x ? dragStart.x : dragStart.x - w;
      const y = iy >= dragStart.y ? dragStart.y : dragStart.y - h;

      crop = {
        x: clamp(x, 0, imgW - 1),
        y: clamp(y, 0, imgH - 1),
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
      resizeCrop(dragMode, ix, iy, imgW, imgH);
    }

    syncCropToPanel();
    drawOverlay();
  }

  function onMouseUp(e) {
    if (!isDragging) return;

    if (dragMode === 'pan') {
      isDragging = false;
      dragMode = 'none';
      overlayCanvas.style.cursor = activeTool === 'blur' ? 'crosshair' : 'crosshair';
      return;
    }

    if (dragMode === 'blur-draw') {
      isDragging = false;
      dragMode = 'none';
      if (blurDraw && blurDraw.w > 3 && blurDraw.h > 3) {
        const region = {
          x: Math.round(blurDraw.x),
          y: Math.round(blurDraw.y),
          w: Math.round(blurDraw.w),
          h: Math.round(blurDraw.h),
          intensity: App.getBlurIntensity(),
        };
        App.addBlurRegion(region);
      }
      blurDraw = null;
      drawOverlay();
      return;
    }

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

    // Enforce aspect ratio on resize
    if (lockedRatio && lockedRatio > 0) {
      // Determine which dimension to adjust based on handle direction
      const isHorizontal = mode === 'resize-l' || mode === 'resize-r';
      const isVertical = mode === 'resize-t' || mode === 'resize-b';

      if (isHorizontal) {
        // Width changed, adjust height
        h = Math.round(w / lockedRatio);
      } else if (isVertical) {
        // Height changed, adjust width
        w = Math.round(h * lockedRatio);
      } else {
        // Corner: use width to drive height
        h = Math.round(w / lockedRatio);
      }

      // Recalc origin for handles that move the top-left corner
      if (mode === 'resize-tl' || mode === 'resize-t') {
        y = c.y + c.h - h;
      }
      if (mode === 'resize-tl' || mode === 'resize-l') {
        x = c.x + c.w - w;
      }
      if (mode === 'resize-bl') {
        x = c.x + c.w - w;
      }
      if (mode === 'resize-tr') {
        y = c.y + c.h - h;
      }

      // Clamp to image bounds
      w = clamp(w, 1, imgW);
      h = clamp(h, 1, imgH);
      x = clamp(x, 0, imgW - w);
      y = clamp(y, 0, imgH - h);
    }

    crop = { x, y, w, h };
  }

  // ----------------------------------------------------------
  // Hit testing handles
  // ----------------------------------------------------------
  function hitTestHandle(sx, sy) {
    if (!crop) return null;

    const ds = getDisplayScale();
    const cx = crop.x * ds;
    const cy = crop.y * ds;
    const cw = crop.w * ds;
    const ch = crop.h * ds;
    const hs = HANDLE_SIZE + 4;

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

    if (e.altKey) {
      overlayCanvas.style.cursor = 'grab';
      return;
    }

    const { sx, sy } = screenToImage(e);
    const ds = getDisplayScale();

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

      const csx = crop.x * ds;
      const csy = crop.y * ds;
      const csw = crop.w * ds;
      const csh = crop.h * ds;

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

  function setLockedRatio(ratio) {
    lockedRatio = ratio;
  }

  function clearCrop() {
    crop = null;
  }

  function setTool(tool) {
    activeTool = tool;
    if (overlayCanvas) {
      overlayCanvas.style.cursor = 'crosshair';
    }
  }

  // Apply a single blur region to the main canvas (destructive on display)
  function applyBlurRegion(region) {
    if (!mainCtx || !currentEntry) return;

    const ds = getDisplayScale();
    const rx = region.x * ds;
    const ry = region.y * ds;
    const rw = region.w * ds;
    const rh = region.h * ds;

    mainCtx.save();
    mainCtx.filter = 'blur(' + region.intensity + 'px)';
    mainCtx.beginPath();
    mainCtx.rect(rx, ry, rw, rh);
    mainCtx.clip();
    mainCtx.drawImage(mainCanvas, 0, 0);
    mainCtx.restore();
  }

  // Redraw the entire image with all blur regions applied
  function redrawWithBlur(entry) {
    if (!mainCtx || !entry) return;

    const ds = getDisplayScale();

    // Redraw clean image
    mainCtx.clearRect(0, 0, canvasW, canvasH);
    mainCtx.drawImage(entry.img, 0, 0, canvasW, canvasH);

    // Re-apply all blur regions
    (entry.blurRegions || []).forEach(region => {
      const rx = region.x * ds;
      const ry = region.y * ds;
      const rw = region.w * ds;
      const rh = region.h * ds;

      mainCtx.save();
      mainCtx.filter = 'blur(' + region.intensity + 'px)';
      mainCtx.beginPath();
      mainCtx.rect(rx, ry, rw, rh);
      mainCtx.clip();
      mainCtx.drawImage(mainCanvas, 0, 0);
      mainCtx.restore();
    });

    drawOverlay();
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
    setLockedRatio,
    resetZoom,
    setTool,
    applyBlurRegion,
    redrawWithBlur,
    get crop() { return crop; },
    get displayScale() { return getDisplayScale(); },
  };

})();
