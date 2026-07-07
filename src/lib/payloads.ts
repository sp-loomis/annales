// Semantic validation of uploaded artifact payloads, run at finalize time.
// Each parser throws PayloadError with a human-readable reason.

export class PayloadError extends Error {}

export interface ParsedGeoJson {
  bbox: [number, number, number, number];
  properties: Record<string, unknown> | null;
  /** Feature list — a bare Feature becomes a one-element list. */
  features: unknown[];
}

export function parseGeoJson(text: string): ParsedGeoJson {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new PayloadError('not valid JSON');
  }

  let features: any[];
  if (doc?.type === 'Feature') {
    features = [doc];
  } else if (doc?.type === 'FeatureCollection') {
    if (!Array.isArray(doc.features) || doc.features.length === 0) {
      throw new PayloadError('FeatureCollection has no features');
    }
    features = doc.features;
  } else {
    throw new PayloadError('expected a GeoJSON Feature or FeatureCollection');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) throw new PayloadError('malformed coordinates');
    if (typeof coords[0] === 'number') {
      const [x, y] = coords as number[];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new PayloadError('non-numeric coordinates');
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    for (const c of coords) visit(c);
  };

  for (const f of features) {
    if (f?.type !== 'Feature' || typeof f?.geometry?.type !== 'string') {
      throw new PayloadError('every feature needs a geometry');
    }
    if (f.geometry.type === 'GeometryCollection') {
      throw new PayloadError('GeometryCollection is not supported');
    }
    visit(f.geometry.coordinates);
  }
  if (!Number.isFinite(minX)) throw new PayloadError('no coordinates found');

  const properties =
    features.length === 1 && features[0].properties && typeof features[0].properties === 'object'
      ? features[0].properties
      : null;

  return { bbox: [minX, minY, maxX, maxY], properties, features };
}

export function parseExcalidraw(text: string): { texts: string[] } {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new PayloadError('not valid JSON');
  }
  if (doc?.type !== 'excalidraw' || !Array.isArray(doc.elements)) {
    throw new PayloadError('expected an Excalidraw scene (type "excalidraw" with elements)');
  }
  const texts = doc.elements
    .filter((e: any) => e?.type === 'text' && typeof e.text === 'string')
    .map((e: any) => e.text as string);
  return { texts };
}

export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export function checkImageBytes(bytes: Buffer, contentType: string): void {
  const ok = (() => {
    switch (contentType) {
      case 'image/png':
        return bytes.length > 8 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      case 'image/jpeg':
        return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      case 'image/webp':
        return (
          bytes.length > 12 &&
          bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
          bytes.subarray(8, 12).toString('ascii') === 'WEBP'
        );
      case 'image/svg+xml': {
        const head = bytes.subarray(0, 1024).toString('utf8').trimStart();
        return head.startsWith('<') && head.includes('<svg');
      }
      default:
        return false;
    }
  })();
  if (!ok) throw new PayloadError(`bytes do not look like ${contentType}`);
}
