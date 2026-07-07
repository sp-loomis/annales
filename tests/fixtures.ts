/** 1x1 opaque PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Axis-aligned rectangle as a GeoJSON Feature. */
export function rectFeature(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  properties: Record<string, unknown> = {}
) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
  };
}

/**
 * Right triangle with legs on the axes: (0,0) (size,0) (0,size).
 * Its bbox is [0,0,size,size] but the upper-right corner of that bbox is
 * empty — used to prove the exact (turf) pass tightens the bbox pass.
 */
export function triangleFeature(size: number, properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [size, 0],
          [0, size],
          [0, 0],
        ],
      ],
    },
  };
}

/** Minimal Excalidraw scene whose only content is the given text elements. */
export function excalidrawScene(texts: string[]) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'sheaf-tests',
    elements: texts.map((text, i) => ({
      id: `text-${i}`,
      type: 'text',
      x: 0,
      y: i * 40,
      width: 100,
      height: 30,
      text,
    })),
    appState: {},
    files: {},
  };
}
