// A simple line-follower that produces ordinary Controls. It goes through the same input
// pipeline as a human, so it's useful for solo testing (race yourself in another tab) and in tests.
import type { CarPhys, Controls } from './physics.ts';
import { nearestOnTrack, pointAlong } from './track.ts';

function angleTo(fromX: number, fromY: number, to: { x: number; y: number }): number {
  return Math.atan2(to.y - fromY, to.x - fromX);
}
function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function autopilot(c: CarPhys): Controls {
  const n = nearestOnTrack(c.x, c.y);
  const speed = Math.hypot(c.vx, c.vy);
  const look = 70 + speed * 0.3;
  const target = pointAlong(n.along + look);
  const diff = wrap(angleTo(c.x, c.y, target) - c.a);
  const st = diff > 0.04 ? 1 : diff < -0.04 ? -1 : 0;

  // Brake for the corner that's coming, not just the one we're in.
  const near = pointAlong(n.along + 60);
  const far = pointAlong(n.along + 60 + 220);
  const bend = Math.abs(wrap(angleTo(near.x, near.y, far) - angleTo(n.px, n.py, near)));
  // Floor: below ~120 px/s steering fades out (see physics), so crawling into a hairpin gets stuck.
  const safe = Math.max(170, 520 - bend * 260);
  const th = speed > safe + 40 ? -1 : speed > safe ? 0 : 1;
  return { th, st, hb: 0 };
}
