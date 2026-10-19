// The authoritative race. Pure logic, no sockets — index.ts wires it to WebSockets, tests drive it directly.
import {
  COUNTDOWN_TICKS, DNF_TICKS, DT, INPUT_SLACK, LAPS, MAX_INPUTS_PER_TICK,
  MAX_RACE_TICKS, RESULTS_TICKS, SNAPSHOT_EVERY,
} from '../shared/constants.ts';
import { collideCars, stepCar } from '../shared/physics.ts';
import { spawnCar, updateProgress, type CarState } from '../shared/race.ts';
import type { CarSnap, InputMsg, Phase, Result, ServerMsg } from '../shared/protocol.ts';

export interface Conn { id: number; name: string; send(msg: ServerMsg): void }

interface Racer {
  conn: Conn;
  car: CarState;
  queue: InputMsg[];
  steps: number;
  finish: number | null;
  left: boolean;
}

const MAX_QUEUE = 240;

export class Game {
  readonly collisions: boolean;
  tick = 0;
  phase: Phase = 'waiting';
  phaseEnd = 0;
  raceStart = 0;
  raceId = 0;
  results: Result[] | null = null;
  order: Conn[] = []; // everyone connected, in queue order; the first two race
  racers: Racer[] = [];
  private acks = new Map<number, number>(); // last applied input seq per connection
  private lastSeq = new Map<number, number>(); // last received seq (rejects replays)
  private firstFinish: number | null = null;

  constructor(opts: { collisions?: boolean } = {}) {
    this.collisions = opts.collisions ?? true;
  }

  join(conn: Conn): void {
    this.order.push(conn);
    this.acks.set(conn.id, 0);
    this.lastSeq.set(conn.id, 0);
  }

  leave(id: number): void {
    this.order = this.order.filter((c) => c.id !== id);
    this.acks.delete(id);
    this.lastSeq.delete(id);
    const r = this.racers.find((r) => r.conn.id === id);
    if (!r) return;
    if (this.phase === 'countdown') {
      this.racers = [];
      this.phase = 'waiting';
    } else if (this.phase === 'racing') {
      r.left = true;
      this.endRace();
    }
  }

  onInput(id: number, inp: InputMsg): void {
    const last = this.lastSeq.get(id);
    if (last === undefined || inp.seq <= last) return;
    this.lastSeq.set(id, inp.seq);
    const r = this.racers.find((r) => r.conn.id === id);
    if (r && this.phase === 'racing' && !r.left) {
      if (r.queue.length < MAX_QUEUE) r.queue.push(inp);
    } else {
      this.acks.set(id, inp.seq); // not racing: acknowledged and ignored
    }
  }

  step(): void {
    this.tick++;
    if (this.phase === 'waiting') {
      if (this.order.length >= 2) this.startCountdown();
    } else if (this.phase === 'countdown') {
      if (this.tick >= this.phaseEnd) {
        this.phase = 'racing';
        this.raceStart = this.tick;
      }
    } else if (this.phase === 'racing') {
      this.simulate();
      this.checkEnd();
    } else if (this.tick >= this.phaseEnd) {
      // results over: racers go to the back of the queue, next two step up
      const raced = new Set(this.racers.map((r) => r.conn.id));
      this.order = [...this.order.filter((c) => !raced.has(c.id)), ...this.order.filter((c) => raced.has(c.id))];
      this.racers = [];
      this.results = null;
      this.phase = 'waiting';
      if (this.order.length >= 2) this.startCountdown();
    }
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcast();
  }

  private startCountdown(): void {
    this.raceId++;
    this.racers = this.order.slice(0, 2).map((conn, i) => ({
      conn, car: spawnCar(i), queue: [], steps: 0, finish: null, left: false,
    }));
    this.firstFinish = null;
    this.phase = 'countdown';
    this.phaseEnd = this.tick + COUNTDOWN_TICKS;
  }

  // Each input is exactly one DT of driving, applied in order — the same sequence the client predicted.
  // A car's clock is its own input count, so finish times don't depend on network latency.
  // Cars catching up on queued inputs step in rounds so collisions are checked after every sub-step.
  private simulate(): void {
    const elapsed = this.tick - this.raceStart;
    const budgets = this.racers.map((r) =>
      r.left ? 0 : Math.min(MAX_INPUTS_PER_TICK, elapsed + INPUT_SLACK - r.steps));
    for (let round = 0; round < MAX_INPUTS_PER_TICK; round++) {
      let moved = false;
      this.racers.forEach((r, i) => {
        if (round >= budgets[i] || r.queue.length === 0) return;
        const inp = r.queue.shift()!;
        stepCar(r.car, inp);
        r.steps++;
        if (r.finish === null && updateProgress(r.car) && r.car.lap >= LAPS) {
          r.finish = r.steps;
          this.firstFinish ??= this.tick;
        }
        this.acks.set(r.conn.id, inp.seq);
        moved = true;
      });
      if (!moved) break;
      this.collide();
    }
  }

  // Finished cars turn back into ghosts so they can't block anyone still racing.
  private collide(): void {
    const [a, b] = this.racers;
    if (!this.collisions || !a || !b || a.left || b.left || a.finish !== null || b.finish !== null) return;
    collideCars(a.car, b.car);
  }

  private checkEnd(): void {
    if (this.phase !== 'racing') return;
    const active = this.racers.filter((r) => !r.left);
    if (active.every((r) => r.finish !== null)) this.endRace();
    else if (this.firstFinish !== null && this.tick - this.firstFinish >= DNF_TICKS) this.endRace();
    else if (this.tick - this.raceStart >= MAX_RACE_TICKS) this.endRace();
  }

  private endRace(): void {
    const forfeit = this.racers.some((r) => r.left);
    const rank = (r: Racer) => (r.finish !== null ? r.finish : r.left ? 2e12 : forfeit ? -1 : 1e12);
    this.results = [...this.racers].sort((a, b) => rank(a) - rank(b)).map((r) => ({
      name: r.conn.name,
      time: r.finish === null ? null : r.finish * DT,
      note: r.left ? 'disconnected' : r.finish !== null ? '' : forfeit ? 'won by forfeit' : 'DNF',
    }));
    for (const r of this.racers) {
      const lastQueued = r.queue.at(-1);
      if (lastQueued) this.acks.set(r.conn.id, lastQueued.seq);
      r.queue = [];
    }
    this.phase = 'results';
    this.phaseEnd = this.tick + RESULTS_TICKS;
  }

  private broadcast(): void {
    const racing = this.racers.filter((r) => !r.left);
    const ids = new Set(racing.map((r) => r.conn.id));
    const cars: CarSnap[] = racing.map((r) => ({
      id: r.conn.id, name: r.conn.name,
      x: r.car.x, y: r.car.y, vx: r.car.vx, vy: r.car.vy, a: r.car.a,
      lap: r.car.lap, cp: r.car.cp, steps: r.steps, finish: r.finish,
    }));
    const queue = this.order.filter((c) => !ids.has(c.id)).map((c) => c.name);
    for (const conn of this.order) {
      conn.send({
        t: 'snap', tick: this.tick, phase: this.phase, phaseEnd: this.phaseEnd,
        raceStart: this.raceStart, raceId: this.raceId, collisions: this.collisions, you: conn.id,
        role: ids.has(conn.id) ? 'player' : 'spectator',
        ack: this.acks.get(conn.id) ?? 0, cars, queue, results: this.results,
      });
    }
  }
}
