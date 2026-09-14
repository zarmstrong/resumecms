import { useRef, useState } from 'react';
import { CROP_OUTPUT_SIZE, canvasToJpegDataUrl } from './imageUtils.js';

const FRAME_SIZE = 260; // on-screen crop frame, in CSS px
const MAX_ZOOM = 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Keeps the image covering the frame with no empty edges, for any
// width/height at the current zoom.
function clampOffset(x, y, dispWidth, dispHeight) {
  const minX = Math.min(0, FRAME_SIZE - dispWidth);
  const minY = Math.min(0, FRAME_SIZE - dispHeight);
  return { x: clamp(x, minX, 0), y: clamp(y, minY, 0) };
}

// Lets someone reposition and zoom a photo within a circular frame before
// it's saved as the headshot, rather than leaving the crop to whatever
// object-fit: cover happens to center on.
export function PhotoCropper({ imageUrl, onCancel, onConfirm }) {
  const imgRef = useRef(null);
  const [natural, setNatural] = useState(null); // { width, height }
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const baseScale = natural ? FRAME_SIZE / Math.min(natural.width, natural.height) : 1;
  const scale = baseScale * zoom;
  const dispWidth = natural ? natural.width * scale : 0;
  const dispHeight = natural ? natural.height * scale : 0;

  function handleImageLoad(e) {
    const { naturalWidth, naturalHeight } = e.target;
    const initialScale = FRAME_SIZE / Math.min(naturalWidth, naturalHeight);
    const w = naturalWidth * initialScale;
    const h = naturalHeight * initialScale;
    setNatural({ width: naturalWidth, height: naturalHeight });
    setOffset(clampOffset((FRAME_SIZE - w) / 2, (FRAME_SIZE - h) / 2, w, h));
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
  }
  function handlePointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(
      clampOffset(dragRef.current.startOffset.x + dx, dragRef.current.startOffset.y + dy, dispWidth, dispHeight)
    );
  }
  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleZoomChange(e) {
    const nextZoom = Number(e.target.value);
    if (!natural) {
      setZoom(nextZoom);
      return;
    }
    const nextScale = baseScale * nextZoom;
    const nextW = natural.width * nextScale;
    const nextH = natural.height * nextScale;
    // Keep whatever point is currently at the frame's center anchored there
    // as the zoom changes, instead of zooming toward the top-left corner.
    const centerImgX = (FRAME_SIZE / 2 - offset.x) / scale;
    const centerImgY = (FRAME_SIZE / 2 - offset.y) / scale;
    setZoom(nextZoom);
    setOffset(
      clampOffset(FRAME_SIZE / 2 - centerImgX * nextScale, FRAME_SIZE / 2 - centerImgY * nextScale, nextW, nextH)
    );
  }

  function handleConfirm() {
    if (!imgRef.current || !natural) return;
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const sSize = FRAME_SIZE / scale;
    const canvas = document.createElement('canvas');
    canvas.width = CROP_OUTPUT_SIZE;
    canvas.height = CROP_OUTPUT_SIZE;
    canvas.getContext('2d').drawImage(imgRef.current, sx, sy, sSize, sSize, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
    onConfirm(canvasToJpegDataUrl(canvas));
  }

  return (
    <div className="ed-cropper-backdrop">
      <div className="ed-cropper">
        <div
          className="ed-cropper-frame"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className="ed-cropper-image"
            style={{ width: dispWidth, height: dispHeight, transform: `translate(${offset.x}px, ${offset.y}px)` }}
            onLoad={handleImageLoad}
            draggable={false}
          />
          <div className="ed-cropper-mask" />
        </div>
        <input
          type="range"
          className="ed-cropper-zoom"
          min="1"
          max={MAX_ZOOM}
          step="0.01"
          value={zoom}
          onChange={handleZoomChange}
          disabled={!natural}
          aria-label="Zoom"
        />
        <div className="ed-cropper-actions">
          <button type="button" className="ed-btn ed-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ed-btn ed-btn-primary" onClick={handleConfirm} disabled={!natural}>
            Use photo
          </button>
        </div>
      </div>
    </div>
  );
}
