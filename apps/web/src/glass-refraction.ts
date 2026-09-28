/** Encode a capsule lens as red/green source-pixel offsets for feDisplacementMap. */
export function createGlassRefractionMap(width: number, height: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(canvas.width, canvas.height);
  const radius = canvas.height / 2;
  const halfStraight = Math.max(0, canvas.width / 2 - radius);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const dx = x + 0.5 - canvas.width / 2;
      const dy = y + 0.5 - radius;
      const nx = dx - Math.max(-halfStraight, Math.min(halfStraight, dx));
      const distance = Math.hypot(nx, dy);
      const depth = radius - distance;
      // The curved rim pulls samples inward more strongly than the lens centre.
      const rim = depth >= 0 ? Math.min(1.5, radius * 0.07) * Math.pow(distance / radius, 7) : 0;
      const offsetX = -(nx / (distance || 1)) * rim;
      const offsetY = -(dy / (distance || 1)) * rim;
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = Math.round(255 * (0.5 + offsetX / 32));
      pixels.data[i + 1] = Math.round(255 * (0.5 + offsetY / 32));
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}
