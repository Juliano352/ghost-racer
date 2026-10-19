import type { CarPhys } from './physics.ts';
import { SEG_COUNT, START_GRID, nearestOnTrack } from './track.ts';

/** cp = index of the next track segment the car must reach. Segments must be hit in order. */
export interface CarState extends CarPhys { lap: number; cp: number }

export function spawnCar(slot: number): CarState {
  const g = START_GRID[slot % START_GRID.length];
  return { x: g.x, y: g.y, vx: 0, vy: 0, a: g.a, lap: 0, cp: 1 };
}

/** Advance checkpoints. Returns true when a lap was just completed. Wrong-way driving never matches cp. */
export function updateProgress(c: CarState): boolean {
  const seg = nearestOnTrack(c.x, c.y).seg;
  if (seg !== c.cp) return false;
  c.cp = (c.cp + 1) % SEG_COUNT;
  if (c.cp === 1) {
    c.lap++;
    return true;
  }
  return false;
}
