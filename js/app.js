/* ============================================================
   PixelGrid -- App State & UI Logic
   Manages image loading, gallery, crop state, and panel controls
   ============================================================ */

'use strict';

const App = (() => {

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  const state = {
    images: [],           // { id, name, file, img, status: 'pending'|'cropped'|'done', crop: null, pad: null }
    activeIndex: -1,
    targetW: 1280,
    targetH: 720,
    gridFlags: {
      thirds: true,
      center: true,
      diagonals: true,
      centerRect: false,
    },
    previewMode: 'result', // 'original' | 'result'
  };

  // ----------------------------------------------------------
  // DOM refs (cached on init)
  // ----------------------------------------------------------
  let dom = {};

  function cacheDom() {
    dom = {
      dropzone:      document.getElementById('dropzone'),
      fileInput:     document.getElementById('fileInput'),
      fileInputMore: document.getElementById('fileInputMore'),
      workspace:     document.getElementById('workspace'),
      canvasWrap:    document.getElementById('canvasWrap'),
      gallery:       document.getElementById('gallery'),
      imageCount:    document.getElementById('imageCount'),
      addMoreBtn:    document.getElementById('addMoreBtn'),
      sidebar:       document.getElementById('sidebar'),
      panel:         document.getElementById('panel'),
      editor:        document.getElementById('editor'),

      targetW:       document.getElementById('targetWidth'),
      targetH:       document.getElementById('targetHeight'),
      aspectRatio:   document.getElementById('aspectRatio'),

      infoOrigSize:  document.getElementById('infoOrigSize'),
      infoCropSize:  document.getElementById('infoCropSize'),
      infoZoom:      document.getElementById('infoZoom'),

      cropX: document.getElementById('cropX'),
      cropY: document.getElementById('cropY'),
      cropW: document.getElementById('cropW'),
      cropH: document.getElementById('cropH'),
      resetCropBtn: document.getElementById('resetCropBtn'),

      padMessage:   document.getElementById('padMessage'),
      padControls:  document.getElementById('padControls'),
      padSides:     document.getElementById('padSides'),
      padTop:       document.getElementById('padTop'),
      padBottom:    document.getElementById('padBottom'),
      padSidesHint: document.getElementById('padSidesHint'),
      padTopHint:   document.getElementById('padTopHint'),
      padBottomHint:document.getElementById('padBottomHint'),
      autoPadBtn:   document.getElementById('autoPadBtn'),
      padWarning:   document.getElementById('padWarning'),
      padWarningText: document.getElementById('padWarningText'),

      previewOrigBtn:   document.getElementById('previewOrigBtn'),
      previewResultBtn: document.getElementById('previewResultBtn'),
      previewCanvas:    document.getElementById('previewCanvas'),

      exportFormat:  document.getElementById('exportFormat'),
      qualityRow:    document.getElementById('qualityRow'),
      qualitySlider: document.getElementById('qualitySlider'),
      qualityValue:  document.getElementById('qualityValue'),
      exportBtn:     document.getElementById('exportBtn'),
      exportAllBtn:  document.getElementById('exportAllBtn'),

      gridToggles: document.querySelectorAll('[data-grid]'),
    };
  }

  // ----------------------------------------------------------
  // Init
  // ----------------------------------------------------------
  function init() {
    cacheDom();
    bindEvents();
    loadPersistedSize();
    updateAspectRatio();
  }

  // ----------------------------------------------------------
  // Event Binding
  // ----------------------------------------------------------
  function bindEvents() {
    // File input & drop
    dom.dropzone.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', handleFileSelect);
    dom.fileInputMore.addEventListener('change', handleFileSelect);
    dom.addMoreBtn.addEventListener('click', () => dom.fileInputMore.click());

    // Drag & drop
    dom.editor.addEventListener('dragover', onDragOver);
    dom.editor.addEventListener('dragleave', onDragLeave);
    dom.editor.addEventListener('drop', onDrop);

    // Target size
    dom.targetW.addEventListener('input', onTargetSizeChange);
    dom.targetH.addEventListener('input', onTargetSizeChange);

    // Grid toggles
    dom.gridToggles.forEach(btn => {
      btn.addEventListener('click', () => toggleGrid(btn.dataset.grid));
    });

    // Crop fields
    ['cropX', 'cropY', 'cropW', 'cropH'].forEach(id => {
      dom[id].addEventListener('input', onCropFieldChange);
    });
    dom.resetCropBtn.addEventListener('click', resetCrop);

    // Pad fields
    dom.padSides.addEventListener('input', onPadChange);
    dom.padTop.addEventListener('input', onPadChange);
    dom.padBottom.addEventListener('input', onPadChange);
    dom.autoPadBtn.addEventListener('click', autoFillPad);

    // Preview toggle
    dom.previewOrigBtn.addEventListener('click', () => setPreviewMode('original'));
    dom.previewResultBtn.addEventListener('click', () => setPreviewMode('result'));

    // Export
    dom.exportFormat.addEventListener('change', onFormatChange);
    dom.qualitySlider.addEventListener('input', () => {
      dom.qualityValue.textContent = dom.qualitySlider.value;
    });
    dom.exportBtn.addEventListener('click', () => Exporter.exportCurrent());
    dom.exportAllBtn.addEventListener('click', () => Exporter.exportAll());
  }

  // ----------------------------------------------------------
  // Drag & Drop
  // ----------------------------------------------------------
  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dom.dropzone?.classList.add('dropzone--dragover');
  }

  function onDragLeave(e) {
    e.preventDefault();
    dom.dropzone?.classList.remove('dropzone--dragover');
  }

  function onDrop(e) {
    e.preventDefault();
    dom.dropzone?.classList.remove('dropzone--dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) addImages(files);
  }

  // ----------------------------------------------------------
  // File Handling
  // ----------------------------------------------------------
  function handleFileSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (files.length) addImages(files);
    e.target.value = '';
  }

  function addImages(files) {
    const startIdx = state.images.length;
    let loaded = 0;

    files.forEach((file, i) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const entry = {
          id: Date.now() + '_' + (startIdx + i),
          name: file.name,
          file,
          img,
          url,
          status: 'pending',
          crop: null,
          pad: { sides: 0, top: 0, bottom: 0 },
        };
        state.images.push(entry);
        loaded++;

        if (loaded === files.length) {
          onImagesAdded(startIdx);
        }
      };

      img.src = url;
    });
  }

  function onImagesAdded(startIdx) {
    renderGallery();
    if (state.activeIndex < 0) {
      selectImage(0);
    }
    showWorkspace();
  }

  // ----------------------------------------------------------
  // Gallery (safe DOM construction -- no innerHTML)
  // ----------------------------------------------------------
  function renderGallery() {
    dom.gallery.textContent = '';
    dom.imageCount.textContent = state.images.length;

    state.images.forEach((entry, idx) => {
      const div = document.createElement('div');
      div.className = 'thumb animate-fade' + (idx === state.activeIndex ? ' thumb--active' : '');
      div.style.animationDelay = (idx * 30) + 'ms';

      const img = document.createElement('img');
      img.className = 'thumb__img';
      img.src = entry.url;
      img.alt = entry.name;

      const statusSpan = document.createElement('span');
      statusSpan.className = 'thumb__status thumb__status--' + entry.status;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'thumb__name';
      nameSpan.textContent = entry.name;

      div.appendChild(img);
      div.appendChild(statusSpan);
      div.appendChild(nameSpan);

      div.addEventListener('click', () => selectImage(idx));
      dom.gallery.appendChild(div);
    });

    // Show/hide export all
    dom.exportAllBtn.style.display = state.images.length > 1 ? 'flex' : 'none';
  }

  function selectImage(idx) {
    if (idx < 0 || idx >= state.images.length) return;
    state.activeIndex = idx;
    renderGallery();
    loadImageToCanvas();
    updatePanel();
  }

  // ----------------------------------------------------------
  // Workspace
  // ----------------------------------------------------------
  function showWorkspace() {
    dom.dropzone.style.display = 'none';
    dom.workspace.style.display = 'flex';
    dom.panel.style.display = 'flex';
    dom.panel.classList.add('animate-slide-right');
  }

  function loadImageToCanvas() {
    const entry = state.images[state.activeIndex];
    if (!entry) return;

    dom.infoOrigSize.textContent = entry.img.naturalWidth + ' x ' + entry.img.naturalHeight;

    CanvasEditor.loadImage(entry);
  }

  // ----------------------------------------------------------
  // Target Size
  // ----------------------------------------------------------
  function onTargetSizeChange() {
    state.targetW = Math.max(1, parseInt(dom.targetW.value) || 1);
    state.targetH = Math.max(1, parseInt(dom.targetH.value) || 1);
    updateAspectRatio();
    persistSize();

    // Recalculate pad hints if crop exists
    if (getActiveEntry()?.crop) {
      recalcPadHints();
    }
  }

  function updateAspectRatio() {
    const g = gcd(state.targetW, state.targetH);
    const rw = state.targetW / g;
    const rh = state.targetH / g;
    // Only show simple ratios
    if (rw <= 32 && rh <= 32) {
      dom.aspectRatio.textContent = rw + ':' + rh;
    } else {
      dom.aspectRatio.textContent = (state.targetW / state.targetH).toFixed(2);
    }
  }

  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  function persistSize() {
    try {
      localStorage.setItem('pixelgrid_targetW', state.targetW);
      localStorage.setItem('pixelgrid_targetH', state.targetH);
    } catch (_) {}
  }

  function loadPersistedSize() {
    try {
      const w = localStorage.getItem('pixelgrid_targetW');
      const h = localStorage.getItem('pixelgrid_targetH');
      if (w) { state.targetW = parseInt(w); dom.targetW.value = state.targetW; }
      if (h) { state.targetH = parseInt(h); dom.targetH.value = state.targetH; }
    } catch (_) {}
  }

  // ----------------------------------------------------------
  // Grid
  // ----------------------------------------------------------
  function toggleGrid(key) {
    state.gridFlags[key] = !state.gridFlags[key];
    dom.gridToggles.forEach(btn => {
      const k = btn.dataset.grid;
      btn.classList.toggle('toggle--active', state.gridFlags[k]);
    });
    CanvasEditor.drawOverlay();
  }

  // ----------------------------------------------------------
  // Crop Panel
  // ----------------------------------------------------------
  function onCropFieldChange() {
    const entry = getActiveEntry();
    if (!entry) return;

    const x = parseInt(dom.cropX.value) || 0;
    const y = parseInt(dom.cropY.value) || 0;
    const w = parseInt(dom.cropW.value) || 0;
    const h = parseInt(dom.cropH.value) || 0;

    entry.crop = { x, y, w, h };
    entry.status = 'cropped';

    CanvasEditor.setCrop(entry.crop);
    CanvasEditor.drawOverlay();
    recalcPadHints();
    renderGallery();
  }

  function resetCrop() {
    const entry = getActiveEntry();
    if (!entry) return;

    entry.crop = null;
    entry.status = 'pending';
    entry.pad = { sides: 0, top: 0, bottom: 0 };

    dom.cropX.value = 0;
    dom.cropY.value = 0;
    dom.cropW.value = 0;
    dom.cropH.value = 0;

    CanvasEditor.clearCrop();
    CanvasEditor.drawOverlay();
    updatePadUI();
    renderGallery();
  }

  function updatePanel() {
    const entry = getActiveEntry();
    if (!entry) return;

    if (entry.crop) {
      dom.cropX.value = entry.crop.x;
      dom.cropY.value = entry.crop.y;
      dom.cropW.value = entry.crop.w;
      dom.cropH.value = entry.crop.h;
    } else {
      dom.cropX.value = 0;
      dom.cropY.value = 0;
      dom.cropW.value = 0;
      dom.cropH.value = 0;
    }

    dom.padSides.value = entry.pad?.sides || 0;
    dom.padTop.value = entry.pad?.top || 0;
    dom.padBottom.value = entry.pad?.bottom || 0;

    updatePadUI();
    updatePreview();
  }

  // ----------------------------------------------------------
  // Auto-Pad Logic
  // ----------------------------------------------------------
  function updatePadUI() {
    const entry = getActiveEntry();
    const hasCrop = entry?.crop && entry.crop.w > 0 && entry.crop.h > 0;

    dom.padMessage.style.display = hasCrop ? 'none' : 'block';
    dom.padControls.style.display = hasCrop ? 'block' : 'none';

    if (hasCrop) {
      recalcPadHints();
    }
  }

  function recalcPadHints() {
    const entry = getActiveEntry();
    if (!entry?.crop) return;

    const crop = entry.crop;
    const pad = entry.pad;

    const currentW = crop.w + (pad.sides * 2);
    const currentH = crop.h + pad.top + pad.bottom;

    dom.padSidesHint.textContent = '+' + pad.sides + 'px each side | total W: ' + currentW + 'px';
    dom.padTopHint.textContent = '+' + pad.top + 'px';
    dom.padBottomHint.textContent = '+' + pad.bottom + 'px';

    dom.infoCropSize.textContent = currentW + ' x ' + currentH + ' (target: ' + state.targetW + ' x ' + state.targetH + ')';

    // Check if enough original pixels
    checkPadBounds(entry);
  }

  function checkPadBounds(entry) {
    if (!entry?.crop || !entry.img) return;

    const crop = entry.crop;
    const pad = entry.pad;
    const imgW = entry.img.naturalWidth;
    const imgH = entry.img.naturalHeight;

    const left  = crop.x - pad.sides;
    const right = crop.x + crop.w + pad.sides;
    const top   = crop.y - pad.top;
    const bottom = crop.y + crop.h + pad.bottom;

    const overflow = left < 0 || top < 0 || right > imgW || bottom > imgH;

    dom.padWarning.style.display = overflow ? 'flex' : 'none';
    if (overflow) {
      const msgs = [];
      if (left < 0) msgs.push('left: ' + Math.abs(left) + 'px over');
      if (right > imgW) msgs.push('right: ' + (right - imgW) + 'px over');
      if (top < 0) msgs.push('top: ' + Math.abs(top) + 'px over');
      if (bottom > imgH) msgs.push('bottom: ' + (bottom - imgH) + 'px over');
      dom.padWarningText.textContent = 'Out of bounds: ' + msgs.join(', ');
    }
  }

  function onPadChange() {
    const entry = getActiveEntry();
    if (!entry) return;

    entry.pad = {
      sides:  Math.max(0, parseInt(dom.padSides.value) || 0),
      top:    Math.max(0, parseInt(dom.padTop.value) || 0),
      bottom: Math.max(0, parseInt(dom.padBottom.value) || 0),
    };

    recalcPadHints();
    CanvasEditor.drawOverlay();
    updatePreview();
  }

  function autoFillPad() {
    const entry = getActiveEntry();
    if (!entry?.crop) return;

    const crop = entry.crop;
    const diffW = state.targetW - crop.w;
    const diffH = state.targetH - crop.h;

    if (diffW < 0 || diffH < 0) {
      // Crop is larger than target -- can't auto-pad
      dom.padWarning.style.display = 'flex';
      dom.padWarningText.textContent = 'Crop area is larger than target size. Reduce the crop first.';
      return;
    }

    const sidesPad = Math.floor(diffW / 2);
    // Distribute remaining vertical space: try to center, with extra going to bottom
    const topPad = Math.floor(diffH / 2);
    const bottomPad = diffH - topPad;

    entry.pad = { sides: sidesPad, top: topPad, bottom: bottomPad };

    dom.padSides.value = sidesPad;
    dom.padTop.value = topPad;
    dom.padBottom.value = bottomPad;

    // Handle odd width pixel
    if (diffW % 2 !== 0) {
      entry.pad.sidesExtra = 1;
    }

    entry.status = 'done';
    recalcPadHints();
    CanvasEditor.drawOverlay();
    updatePreview();
    renderGallery();
  }

  // ----------------------------------------------------------
  // Preview
  // ----------------------------------------------------------
  function setPreviewMode(mode) {
    state.previewMode = mode;
    dom.previewOrigBtn.classList.toggle('btn--active', mode === 'original');
    dom.previewResultBtn.classList.toggle('btn--active', mode === 'result');
    updatePreview();
  }

  function updatePreview() {
    const entry = getActiveEntry();
    if (!entry) return;

    const canvas = dom.previewCanvas;
    const ctx = canvas.getContext('2d');

    if (state.previewMode === 'original') {
      canvas.width = entry.img.naturalWidth;
      canvas.height = entry.img.naturalHeight;
      ctx.drawImage(entry.img, 0, 0);
    } else {
      // Draw result with crop + padding
      if (entry.crop && entry.crop.w > 0 && entry.crop.h > 0) {
        const pad = entry.pad || { sides: 0, top: 0, bottom: 0 };
        const outW = entry.crop.w + (pad.sides * 2) + (pad.sidesExtra || 0);
        const outH = entry.crop.h + pad.top + pad.bottom;

        canvas.width = outW;
        canvas.height = outH;
        ctx.clearRect(0, 0, outW, outH);

        // Source rect from original image
        const sx = entry.crop.x - pad.sides;
        const sy = entry.crop.y - pad.top;

        // Clamp to image bounds
        const csx = Math.max(0, sx);
        const csy = Math.max(0, sy);
        const csr = Math.min(entry.img.naturalWidth, sx + outW);
        const csb = Math.min(entry.img.naturalHeight, sy + outH);
        const csw = csr - csx;
        const csh = csb - csy;

        const dx = csx - sx;
        const dy = csy - sy;

        if (csw > 0 && csh > 0) {
          ctx.drawImage(entry.img, csx, csy, csw, csh, dx, dy, csw, csh);
        }
      } else {
        canvas.width = entry.img.naturalWidth;
        canvas.height = entry.img.naturalHeight;
        ctx.drawImage(entry.img, 0, 0);
      }
    }
  }

  // ----------------------------------------------------------
  // Export Format
  // ----------------------------------------------------------
  function onFormatChange() {
    const fmt = dom.exportFormat.value;
    dom.qualityRow.style.display = (fmt === 'jpeg' || fmt === 'webp') ? 'flex' : 'none';
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  function getActiveEntry() {
    return state.images[state.activeIndex] || null;
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------
  return {
    init,
    state,
    getActiveEntry,
    updatePanel,
    updatePreview,
    recalcPadHints,
    renderGallery,
    get dom() { return dom; },
  };

})();

document.addEventListener('DOMContentLoaded', App.init);
