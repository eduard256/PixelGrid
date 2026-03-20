/* ============================================================
   PixelGrid -- Export Module
   Handles image export in PNG / JPG / WebP formats
   ============================================================ */

'use strict';

const Exporter = (() => {

  // ----------------------------------------------------------
  // Build final canvas from entry's crop + padding
  // ----------------------------------------------------------
  function buildResult(entry) {
    if (!entry?.crop || entry.crop.w <= 0 || entry.crop.h <= 0) {
      return null;
    }

    const crop = entry.crop;
    const pad = entry.pad || { sides: 0, top: 0, bottom: 0 };
    const extra = pad.sidesExtra || 0;

    const outW = crop.w + (pad.sides * 2) + extra;
    const outH = crop.h + pad.top + pad.bottom;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');

    // Fill with transparent initially
    ctx.clearRect(0, 0, outW, outH);

    // Calculate source coordinates in the original image
    const sx = crop.x - pad.sides;
    const sy = crop.y - pad.top;

    // Clamp to original image bounds to avoid reading outside
    const csx = Math.max(0, sx);
    const csy = Math.max(0, sy);
    const csr = Math.min(entry.img.naturalWidth, sx + outW);
    const csb = Math.min(entry.img.naturalHeight, sy + outH);
    const csw = csr - csx;
    const csh = csb - csy;

    // Destination offset (accounts for the case when we're reading from
    // outside the image on the left/top side)
    const dx = csx - sx;
    const dy = csy - sy;

    if (csw > 0 && csh > 0) {
      ctx.drawImage(entry.img, csx, csy, csw, csh, dx, dy, csw, csh);
    }

    // Apply blur regions (coordinates are in original image space,
    // offset by the crop/pad origin)
    if (entry.blurRegions && entry.blurRegions.length > 0) {
      entry.blurRegions.forEach(r => {
        const rx = r.x - sx;
        const ry = r.y - sy;

        ctx.save();
        ctx.filter = 'blur(' + r.intensity + 'px)';
        ctx.beginPath();
        ctx.rect(rx, ry, r.w, r.h);
        ctx.clip();
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
      });
    }

    return canvas;
  }

  // ----------------------------------------------------------
  // Get export MIME type and extension
  // ----------------------------------------------------------
  function getFormat() {
    const fmt = App.dom.exportFormat.value;
    const quality = parseInt(App.dom.qualitySlider.value) / 100;

    switch (fmt) {
      case 'jpeg': return { mime: 'image/jpeg', ext: '.jpg', quality };
      case 'webp': return { mime: 'image/webp', ext: '.webp', quality };
      default:     return { mime: 'image/png',  ext: '.png', quality: undefined };
    }
  }

  // ----------------------------------------------------------
  // Get export resize dimensions (null if not set)
  // ----------------------------------------------------------
  function getResizeSize() {
    const w = parseInt(App.dom.exportW.value) || 0;
    const h = parseInt(App.dom.exportH.value) || 0;
    if (w > 0 && h > 0) return { w, h };
    return null;
  }

  // ----------------------------------------------------------
  // Resize a canvas to target dimensions via high-quality scaling
  // ----------------------------------------------------------
  function resizeCanvas(srcCanvas, targetW, targetH) {
    if (srcCanvas.width === targetW && srcCanvas.height === targetH) {
      return srcCanvas;
    }

    const dst = document.createElement('canvas');
    dst.width = targetW;
    dst.height = targetH;
    const ctx = dst.getContext('2d');

    // Use smooth scaling for downscale
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);

    return dst;
  }

  // ----------------------------------------------------------
  // Download helper
  // ----------------------------------------------------------
  function download(canvas, filename, format) {
    const dataUrl = canvas.toDataURL(format.mime, format.quality);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ----------------------------------------------------------
  // Export current image
  // ----------------------------------------------------------
  function exportCurrent() {
    const entry = App.getActiveEntry();
    if (!entry) return;

    let canvas = buildResult(entry);
    if (!canvas) {
      // No crop -- export original (with blur if any)
      canvas = document.createElement('canvas');
      canvas.width = entry.img.naturalWidth;
      canvas.height = entry.img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(entry.img, 0, 0);

      // Apply blur regions
      if (entry.blurRegions && entry.blurRegions.length > 0) {
        entry.blurRegions.forEach(r => {
          ctx.save();
          ctx.filter = 'blur(' + r.intensity + 'px)';
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();
          ctx.drawImage(canvas, 0, 0);
          ctx.restore();
        });
      }
    }

    // Apply resize if specified
    const resize = getResizeSize();
    if (resize) {
      canvas = resizeCanvas(canvas, resize.w, resize.h);
    }

    const format = getFormat();
    const baseName = entry.name.replace(/\.[^.]+$/, '');
    download(canvas, baseName + '_pixelgrid' + format.ext, format);
  }

  // ----------------------------------------------------------
  // Export all images
  // ----------------------------------------------------------
  function exportAll() {
    const format = getFormat();
    const resize = getResizeSize();

    App.state.images.forEach((entry, idx) => {
      let canvas = buildResult(entry);
      if (!canvas) return; // skip non-cropped

      if (resize) {
        canvas = resizeCanvas(canvas, resize.w, resize.h);
      }

      const baseName = entry.name.replace(/\.[^.]+$/, '');
      // Stagger downloads slightly so browser doesn't block them
      setTimeout(() => {
        download(canvas, baseName + '_pixelgrid' + format.ext, format);
      }, idx * 200);
    });
  }

  // ----------------------------------------------------------
  // Public
  // ----------------------------------------------------------
  return {
    exportCurrent,
    exportAll,
    buildResult,
  };

})();
