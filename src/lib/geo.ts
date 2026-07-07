// Canonicalization of authored geometry into a globe's canonical frame:
// the sphere in lng/lat degrees, prime meridian fixed at 0. A CRS is a d3-geo
// projection of that sphere; geometries are authored in the projected plane,
// so canonicalizing = inverting the projection. See docs/STACK.md.

import { geoEquirectangular, geoAzimuthalEqualArea, geoAzimuthalEquidistant } from 'd3-geo';
import type { GeoProjection } from 'd3-geo';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { PayloadError } from './payloads.js';
import type { Bbox } from './artifact-util.js';

// d3-geo has no default aggregate export — map projection type → constructor.
const PROJECTIONS: Record<string, () => GeoProjection> = {
  equirectangular: geoEquirectangular,
  'azimuthal-equal-area': geoAzimuthalEqualArea,
  'azimuthal-equidistant': geoAzimuthalEquidistant,
};

export interface CrsParams {
  type: string;
  rotate?: [number, number, number] | [number, number];
  clipAngle?: number;
}

// Build a raw unit projection: scale = globe radius, translate = origin, so
// invert([x,y]) yields lng/lat directly. NOTE d3's y-axis points down —
// authored +y inverts to lower latitude.
export function buildProjection(params: CrsParams, radius: number): GeoProjection {
  const ctor = PROJECTIONS[params?.type];
  if (!ctor) throw new PayloadError(`unknown projection type '${params?.type}'`);
  const p = ctor().scale(radius).translate([0, 0]);
  if (params.rotate) p.rotate(params.rotate as [number, number, number]);
  if (params.clipAngle != null) p.clipAngle(params.clipAngle);
  return p;
}

// A path is an ordered list of [x,y] positions (a ring, a line, or a lone
// point). Collect every path out of a GeoJSON coordinate tree.
function collectPaths(coords: unknown, out: number[][][]): void {
  const arr = coords as any[];
  if (typeof arr[0] === 'number') {
    out.push([arr as number[]]); // a bare position
  } else if (typeof arr[0][0] === 'number') {
    out.push(arr as number[][]); // an array of positions
  } else {
    for (const c of arr) collectPaths(c, out);
  }
}

// Subdivide a projected segment so reprojected curvature is captured — ~1° of
// arc per step (radius * π/180 projected units per degree), capped.
function densify(a: number[], b: number[], radius: number): number[][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.hypot(dx, dy);
  const perDeg = (radius * Math.PI) / 180;
  const k = Math.min(256, Math.max(1, Math.ceil(dist / perDeg)));
  const pts: number[][] = [];
  for (let i = 0; i < k; i++) pts.push([a[0] + (dx * i) / k, a[1] + (dy * i) / k]);
  return pts; // excludes b — the next segment contributes it
}

const FULL_WIND = 360 - 1e-9;

// Is the given canonical pole a proper interior point of any authored polygon?
// Tested in the CRS's own projected plane (planar point-in-polygon), where the
// pole is a finite point and interior is unambiguous — no lat-sign guessing.
function poleIsEnclosed(features: unknown[], proj: GeoProjection, poleLat: number): boolean {
  const p = proj([0, poleLat]);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
  for (const f of features) {
    const g = (f as any).geometry;
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    if (booleanPointInPolygon(p as [number, number], g)) return true;
  }
  return false;
}

// Turn an unwrapped longitude span + latitude span into 1–2 canonical boxes.
export function splitLngBox(lngLo: number, lngHi: number, latMin: number, latMax: number): Bbox[] {
  if (lngHi - lngLo >= FULL_WIND) return [[-180, latMin, 180, latMax]];
  let lo = lngLo;
  let hi = lngHi;
  while (lo < -180) {
    lo += 360;
    hi += 360;
  }
  while (lo >= 180) {
    lo -= 360;
    hi -= 360;
  }
  if (hi <= 180) return [[lo, latMin, hi, latMax]];
  return [
    [lo, latMin, 180, latMax],
    [-180, latMin, hi - 360, latMax],
  ];
}

// Invert a geometry's authored coords to the globe's canonical lng/lat and
// return its bounding box(es): 1 normally, 2 across the antimeridian, and a
// single full-longitude box when the extent encircles a pole.
export function canonicalize(features: unknown[], params: CrsParams, radius: number): Bbox[] {
  const proj = buildProjection(params, radius);
  let latMin = Infinity;
  let latMax = -Infinity;
  let lngLo = Infinity;
  let lngHi = -Infinity;

  for (const f of features) {
    const geom = (f as any).geometry;
    const paths: number[][][] = [];
    collectPaths(geom.coordinates, paths);
    for (const path of paths) {
      // densify every segment, then append the final vertex
      const dense: number[][] = [];
      for (let i = 0; i < path.length - 1; i++) dense.push(...densify(path[i], path[i + 1], radius));
      dense.push(path[path.length - 1]);

      let offset = 0;
      let prevRaw: number | null = null;
      for (const [x, y] of dense) {
        const inv = proj.invert?.([x, y]);
        if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) {
          throw new PayloadError('geometry falls outside the globe');
        }
        const [lng, lat] = inv;
        latMin = Math.min(latMin, lat);
        latMax = Math.max(latMax, lat);
        if (prevRaw !== null) {
          const d = lng - prevRaw;
          if (d > 180) offset -= 360;
          else if (d < -180) offset += 360;
        }
        const unwrapped = lng + offset;
        lngLo = Math.min(lngLo, unwrapped);
        lngHi = Math.max(lngHi, unwrapped);
        prevRaw = lng;
      }
    }
  }

  if (!Number.isFinite(latMin)) throw new PayloadError('no coordinates found');

  // Full winding ⇒ the boundary encircles a pole. Determine which pole exactly
  // by testing it in the CRS plane, then widen latitude to it. Both/neither
  // (near-global or degenerate) → conservative full sphere.
  if (lngHi - lngLo >= FULL_WIND) {
    const north = poleIsEnclosed(features, proj, 90);
    const south = poleIsEnclosed(features, proj, -90);
    if (north && !south) return [[-180, latMin, 180, 90]];
    if (south && !north) return [[-180, -90, 180, latMax]];
    return [[-180, -90, 180, 90]];
  }
  return splitLngBox(lngLo, lngHi, latMin, latMax);
}

// Reproject a geometry's authored features to canonical lng/lat GeoJSON —
// used by the exact (turf) search pass. Curvature is not densified here; the
// exact pass re-projects into a query-local planar frame anyway.
export function toCanonicalFeatures(features: unknown[], params: CrsParams, radius: number): any[] {
  const proj = buildProjection(params, radius);
  const mapCoords = (coords: unknown): any => {
    const arr = coords as any[];
    if (typeof arr[0] === 'number') {
      const inv = proj.invert?.([arr[0], arr[1]]);
      if (!inv) throw new PayloadError('geometry falls outside the globe');
      return [inv[0], inv[1]];
    }
    return arr.map(mapCoords);
  };
  return features.map((f) => {
    const feat = f as any;
    return {
      type: 'Feature',
      properties: feat.properties ?? {},
      geometry: { type: feat.geometry.type, coordinates: mapCoords(feat.geometry.coordinates) },
    };
  });
}
