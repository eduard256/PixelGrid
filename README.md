# PixelGrid

Precision image cropping tool with grid overlay, auto-padding, and batch processing. Built for preparing screenshots to exact size requirements (Umbrel, CasaOS, etc.).

**Live:** https://eduard256.github.io/PixelGrid/

## Features

- Drag & drop multi-image upload
- Grid overlays: rule of thirds, center point, diagonals, center rectangle
- Interactive crop with resize handles
- Auto-pad: crop to your subject, then auto-fill to target size using original image pixels
- Symmetric side padding, independent top/bottom controls
- Before/after preview
- Export to PNG / JPG / WebP with quality control
- Runs entirely in the browser -- no server, no uploads, fully offline-capable

## Usage

1. Set your target size (e.g. 1280x720)
2. Drop your screenshots
3. Draw a crop around the main subject
4. Click "Auto-fill to target size" -- padding is added from the original image
5. Adjust padding manually if needed
6. Export

## Tech

Pure HTML / CSS / JavaScript. No dependencies, no build step. Open `index.html` in a browser.
