import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR } from '../shared/constants.ts';
import { carGap, collideCars, stepCar, type Controls } from '../shared/physics.ts';
import { spawnCar, updateProgress } from '../shared/race.ts';
import { HALF_WIDTH, TRACK_LENGTH, nearestOnTrack, pointAlong } from '../shared/track.ts';

function randomInputs(n: number, seed: number): Controls[] {
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, () => ({
    th: r() < 0.75 ? 1 : r() < 0.5 ? 0 : -1,
    st: r() < 0.33 ? -1 : r() < 0.5 ? 0 : 1,
    hb: r() < 0.05 ? 1 : 0,
  }));
}

test('physics is deterministic, including across JSON round-trips (what reconciliation does)', () => {
  const inputs = randomInputs(3000, 42);
  let a = spawnCar(0);
  let b = spawnCar(0);
  inputs.forEach((inp, i) => {
    stepCar(a, inp);
    if (i % 50 === 0) b = JSON.parse(JSON.stringify(b)); // the server sends state as JSON
    stepCar(b, inp);
  });
  assert.deepEqual(a, b);
  assert.ok(Math.hypot(a.x - 400, a.y - 128) > 10, 'car actually moved');
});

test('head-on bump separates the cars, bounces them, and conserves momentum', () => {
  const a = { x: 600, y: 160, vx: 200, vy: 0, a: 0 };
  const b = { x: 600 + CAR.length - 6, y: 160, vx: -200, vy: 0, a: Math.PI };
  assert.ok(carGap(a, b) < 0);
  assert.equal(collideCars(a, b), true);
  assert.ok(carGap(a, b) > -1e-9, 'still overlapping');
  assert.ok(a.vx < 0 && b.vx > 0, 'should bounce apart');
  assert.ok(Math.abs(a.vx + b.vx) < 1e-9, 'momentum not conserved');
  assert.ok(Math.abs(a.vx) < 200, 'bounce must lose energy');
});

test('walls keep the car on the tarmac', () => {
  const car = spawnCar(0);
  for (const inp of randomInputs(5000, 7)) {
    stepCar(car, inp);
    assert.ok(nearestOnTrack(car.x, car.y).dist <= HALF_WIDTH - CAR.radius + 1e-6);
  }
});

test('laps count driving forwards, never backwards', () => {
  const start = nearestOnTrack(400, 128).along;
  const fwd = spawnCar(0);
  for (let d = start; d <= start + TRACK_LENGTH + 40; d += 15) {
    Object.assign(fwd, pointAlong(d));
    updateProgress(fwd);
  }
  assert.equal(fwd.lap, 1);

  const back = spawnCar(0);
  for (let d = start; d >= start - 2 * TRACK_LENGTH; d -= 15) {
    Object.assign(back, pointAlong(d));
    updateProgress(back);
  }
  assert.equal(back.lap, 0);
});
