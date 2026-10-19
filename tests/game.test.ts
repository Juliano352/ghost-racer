import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, type Conn } from '../server/game.ts';
import { autopilot } from '../shared/autopilot.ts';
import { INPUT_SLACK, MAX_INPUTS_PER_TICK, RESULTS_TICKS } from '../shared/constants.ts';
import { stepCar, type CarPhys } from '../shared/physics.ts';
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
    }
    return false;
  });
  return maxErr;
}

test('two connections race to the finish and prediction matches the server exactly', () => {
  const g = new Game();
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
