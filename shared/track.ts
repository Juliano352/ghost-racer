// One hardcoded track: a closed centreline polyline plus a constant width.
// Driving direction is point 0 -> 1 -> 2 ... (clockwise on screen). Point 0 is the start/finish line.
export const TRACK_POINTS: ReadonlyArray<readonly [number, number]> = [
  [300, 160], [1300, 160], [1480, 260], [1500, 450], [1360, 540], [1000, 520],
  [860, 600], [1000, 700], [1380, 720], [1500, 820], [1440, 980], [1200, 1040],
  [400, 1040], [200, 900], [160, 500], [200, 260],
];
export const HALF_WIDTH = 75;
export const WORLD_W = 1660;
export const WORLD_H = 1200;

export const START_GRID = [
  { x: 400, y: 128, a: 0 },
  { x: 360, y: 192, a: 0 },
];

interface Seg { ax: number; ay: number; dx: number; dy: number; len: number; len2: number; start: number }

export const SEGS: Seg[] = [];
let acc = 0;
for (let i = 0; i < TRACK_POINTS.length; i++) {
  const [ax, ay] = TRACK_POINTS[i];
  const [bx, by] = TRACK_POINTS[(i + 1) % TRACK_POINTS.length];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const len = Math.sqrt(len2);
  SEGS.push({ ax, ay, dx, dy, len, len2, start: acc });
  acc += len;
}
export const TRACK_LENGTH = acc;
export const SEG_COUNT = SEGS.length;

export interface Nearest { seg: number; px: number; py: number; dist: number; along: number }

/** Closest point on the centreline. `along` is distance from the start line. */
export function nearestOnTrack(x: number, y: number): Nearest {
  let best = Infinity, seg = 0, px = 0, py = 0, t = 0;
  for (let i = 0; i < SEGS.length; i++) {
    const s = SEGS[i];
    let u = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = s.ax + s.dx * u, qy = s.ay + s.dy * u;
    const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (d2 < best) { best = d2; seg = i; px = qx; py = qy; t = u; }
  }
  return { seg, px, py, dist: Math.sqrt(best), along: SEGS[seg].start + t * SEGS[seg].len };
}

/** Point on the centreline `d` pixels from the start line (wraps around). */
export function pointAlong(d: number): { x: number; y: number } {
  d = ((d % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  for (const s of SEGS) {
    if (d <= s.start + s.len) {
      const u = (d - s.start) / s.len;
      return { x: s.ax + s.dx * u, y: s.ay + s.dy * u };
    }
  }
  return { x: SEGS[0].ax, y: SEGS[0].ay };
}
