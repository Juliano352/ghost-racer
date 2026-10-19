import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, type Conn } from '../server/game.ts';
import { autopilot } from '../shared/autopilot.ts';
import { INPUT_SLACK, MAX_INPUTS_PER_TICK, RESULTS_TICKS } from '../shared/constants.ts';
import { carGap, stepCar, type CarPhys } from '../shared/physics.ts';
import type { ServerMsg, Snap } from '../shared/protocol.ts';
import { spawnCar } from '../shared/race.ts';

function client(id: number) {
  const msgs: ServerMsg[] = [];
  const conn: Conn = { id, name: `Racer ${id}`, send: (m) => msgs.push(m) };
  return { conn, lastSnap: () => msgs.findLast((m): m is Snap => m.t === 'snap') };
}

function stepUntil(g: Game, done: () => boolean, max = 100_000) {
  for (let i = 0; !done(); i++) {
    assert.ok(i < max, `timed out waiting in phase ${g.phase}`);
    g.step();
  }
}

/** Plays a whole race with autopilot "clients" that predict locally, exactly like the browser does. */
function race(g: Game) {
  stepUntil(g, () => g.phase === 'racing');
  const mirrors = new Map<number, CarPhys>(g.racers.map((r, i) => [r.conn.id, spawnCar(i)]));
  const seqs = new Map<number, number>();
  let maxErr = 0;
  stepUntil(g, () => {
    if (g.phase !== 'racing') return true;
    for (const [id, m] of mirrors) {
      const c = autopilot(m);
      stepCar(m, c); // client-side prediction
      const seq = (seqs.get(id) ?? 1000) + 1;
      seqs.set(id, seq);
      g.onInput(id, { t: 'input', seq, ...c });
    }
    g.step();
    for (const r of g.racers) {
      const m = mirrors.get(r.conn.id)!;
      if (g.phase === 'racing') maxErr = Math.max(maxErr, Math.hypot(r.car.x - m.x, r.car.y - m.y));
      // Zero-latency reconciliation: the client adopts the server's state (bumps make them differ).
      Object.assign(m, { x: r.car.x, y: r.car.y, vx: r.car.vx, vy: r.car.vy, a: r.car.a });
    }
    return false;
  });
  return maxErr;
}

test('ghost mode: two connections race to the finish and prediction matches the server exactly', () => {
  const g = new Game({ collisions: false });
  const a = client(1), b = client(2);
  g.join(a.conn);
  g.join(b.conn);
  const maxErr = race(g);
  assert.equal(g.phase, 'results');
  assert.equal(maxErr, 0, 'client prediction drifted from the server');
  assert.ok(g.results);
  for (const r of g.results) {
    assert.equal(r.note, '');
    assert.ok(r.time !== null && r.time > 10 && r.time < 120, `lap time ${r.time}`);
  }
  console.log('race results:', g.results);
});

test('collisions: cars never end a tick overlapping, and a bumping race still finishes', () => {
  const g = new Game({ collisions: true });
  [client(1), client(2)].forEach((x) => g.join(x.conn));
  stepUntil(g, () => g.phase === 'racing');
  // Steer car 1 straight into car 2 on the grid.
  let minGap = Infinity, contacts = 0;
  for (let s = 1; s <= 90; s++) {
    g.onInput(1, { t: 'input', seq: s, th: 1, st: s < 20 ? 1 : 0, hb: 0 });
    g.onInput(2, { t: 'input', seq: s, th: 1, st: 0, hb: 0 });
    g.step();
    const gap = carGap(g.racers[0].car, g.racers[1].car);
    minGap = Math.min(minGap, gap);
    if (gap < 0.5) contacts++;
  }
  assert.ok(contacts > 0, 'the cars should have touched');
  assert.ok(minGap > -1, `cars overlapped by ${-minGap}px after resolution`);

  const g2 = new Game({ collisions: true });
  [client(1), client(2)].forEach((x) => g2.join(x.conn));
  race(g2);
  assert.equal(g2.phase, 'results');
  assert.ok(g2.results!.every((r) => r.time !== null), `someone got stuck: ${JSON.stringify(g2.results)}`);
  console.log('bumping race results:', g2.results);
});

test('ghost mode: cars pass straight through each other', () => {
  const g = new Game({ collisions: false });
  [client(1), client(2)].forEach((x) => g.join(x.conn));
  stepUntil(g, () => g.phase === 'racing');
  Object.assign(g.racers[1].car, { x: g.racers[0].car.x + 5, y: g.racers[0].car.y });
  g.onInput(1, { t: 'input', seq: 1, th: 1, st: 0, hb: 0 });
  g.step();
  assert.ok(carGap(g.racers[0].car, g.racers[1].car) < -10);
});

test('a third connection spectates, then races in the next round', () => {
  const g = new Game();
  const [a, b, c] = [client(1), client(2), client(3)];
  [a, b, c].forEach((x) => g.join(x.conn));
  stepUntil(g, () => g.phase === 'countdown' && c.lastSnap() !== undefined);
  assert.equal(c.lastSnap()!.role, 'spectator');
  assert.deepEqual(c.lastSnap()!.queue, ['Racer 3']);
  race(g);
  stepUntil(g, () => g.phase === 'countdown', RESULTS_TICKS + 10);
  assert.deepEqual(g.racers.map((r) => r.conn.name), ['Racer 3', 'Racer 1']);
  g.step(); g.step(); g.step();
  assert.equal(c.lastSnap()!.role, 'player');
  assert.equal(b.lastSnap()!.role, 'spectator');
});

test('flooding inputs cannot make a car faster than real time', () => {
  const g = new Game();
  [client(1), client(2)].forEach((x) => g.join(x.conn));
  stepUntil(g, () => g.phase === 'racing');
  for (let s = 1; s <= 1000; s++) g.onInput(1, { t: 'input', seq: s, th: 1, st: 0, hb: 0 });
  g.step();
  assert.ok(g.racers[0].steps <= MAX_INPUTS_PER_TICK);
  for (let i = 0; i < 100; i++) g.step();
  assert.ok(g.racers[0].steps <= 101 + INPUT_SLACK, `steps=${g.racers[0].steps}`);
});

test('a disconnect mid-race ends it as a forfeit win', () => {
  const g = new Game();
  [client(1), client(2)].forEach((x) => g.join(x.conn));
  stepUntil(g, () => g.phase === 'racing');
  g.leave(2);
  assert.equal(g.phase, 'results');
  assert.deepEqual(g.results!.map((r) => [r.name, r.note]), [['Racer 1', 'won by forfeit'], ['Racer 2', 'disconnected']]);
});
