// Headshots are stored inline as a data URL in the header JSON blob (there's
// no file-upload endpoint or static-asset storage on the server) — cropping
// to a fixed square output before compressing keeps the payload small and
// predictable regardless of the original photo's size, and matches how the
// photo always renders (a circular avatar via object-fit: cover).
export const CROP_OUTPUT_SIZE = 480;
export const CROP_JPEG_QUALITY = 0.9;

export function canvasToJpegDataUrl(canvas) {
  return canvas.toDataURL('image/jpeg', CROP_JPEG_QUALITY);
}
