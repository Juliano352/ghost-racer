// Client: predicts its own car, interpolates everything else, renders, and shows netcode stats.
import { autopilot } from '../../shared/autopilot.ts';
import { DT, INTERP_DELAY_TICKS, LAPS, TICK_RATE } from '../../shared/constants.ts';
import { stepCar, type CarPhys, type Controls } from '../../shared/physics.ts';
import type { CarSnap, InputMsg, ServerMsg, Snap } from '../../shared/protocol.ts';
import { SEG_COUNT } from '../../shared/track.ts';
import { Net } from './net.ts';
import { Renderer, type DrawCar } from './render.ts';

const ORANGE = '#e28601';
const BLUE = '#009cff';
const SLOT_COLORS = [ORANGE, BLUE];
const SNAP_ERR_PX = 150; // corrections bigger than this teleport instead of smoothing

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const renderer = new Renderer($<HTMLCanvasElement>('game'));
const hudEl = $('hud');
const bannerEl = $('banner');
const statsEl = $('stats');

// --- network state
let myId = 0;
const snaps: Snap[] = [];
let latest: Snap | null = null;
let estTick = 0; // smoothed estimate of the newest server tick

// --- prediction state
let predicted: CarPhys | null = null;
let prevPredicted: CarPhys | null = null; // for render interpolation between fixed steps
let predRaceId = -1;
let pending: InputMsg[] = []; // sent but not yet acknowledged by the server
let seq = 0;
const offset = { x: 0, y: 0, a: 0 }; // visual smoothing of corrections, decays to 0

const stats = { rtt: 0, corrections: 0, lastErr: 0, maxErr: 0 };
const opts = { predict: true, showServer: false, autopilot: false };

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const net = new Net(`${proto}//${location.host}/ws`, onMessage);
setInterval(() => net.send({ t: 'ping', c: performance.now() }), 1000);

const toPhys = (c: CarSnap | CarPhys): CarPhys => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, a: c.a });
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function onMessage(m: ServerMsg): void {
  if (m.t === 'welcome') {
    myId = m.id;
    snaps.length = 0;
    predicted = prevPredicted = null;
    pending = [];
    return;
  }
  if (m.t === 'pong') {
    stats.rtt = performance.now() - m.c;
    return;
  }
  onSnap(m);
}

function onSnap(s: Snap): void {
  if (latest && s.raceId !== latest.raceId) snaps.length = 0; // cars teleported to the grid; don't blend across
  snaps.push(s);
  if (snaps.length > 60) snaps.shift();
  latest = s;
  const diff = s.tick - estTick;
  if (Math.abs(diff) > 20) estTick = s.tick;
  else estTick += diff * 0.05;

  const me = s.cars.find((c) => c.id === myId);
  if (s.role !== 'player' || s.phase !== 'racing' || !me) {
    predicted = prevPredicted = null;
    pending = [];
    return;
  }
  if (!predicted || predRaceId !== s.raceId) {
    // First racing snapshot: we haven't sent any inputs for this race yet, so the server state is exact.
    predicted = toPhys(me);
    prevPredicted = toPhys(me);
    predRaceId = s.raceId;
    pending = [];
    return;
  }

  // Reconciliation: start from the authoritative state, re-apply inputs the server hasn't seen yet.
  const before = predicted;
  const p = toPhys(me);
  pending = pending.filter((i) => i.seq > s.ack);
  for (const i of pending) stepCar(p, i);
  const dx = before.x - p.x, dy = before.y - p.y;
  const err = Math.hypot(dx, dy);
  stats.lastErr = err;
  if (err > 0.01) {
    stats.corrections++;
    stats.maxErr = Math.max(stats.maxErr, err);
  }
  if (err < SNAP_ERR_PX) {
    offset.x += dx;
    offset.y += dy;
    offset.a += wrapAngle(before.a - p.a);
  } else {
    offset.x = offset.y = offset.a = 0;
  }
  if (prevPredicted) {
    prevPredicted.x -= dx;
    prevPredicted.y -= dy;
    prevPredicted.a -= before.a - p.a;
  }
  predicted = p;
}

// --- input
const keys = new Set<string>();
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.code === 'KeyP' && !e.repeat) setAutopilot(!opts.autopilot);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readControls(car: CarPhys): Controls {
  if (opts.autopilot) return autopilot(car);
  const has = (...codes: string[]) => codes.some((c) => keys.has(c));
  return {
    th: (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0),
    st: (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0),
    hb: has('Space') ? 1 : 0,
  };
}

// One fixed 1/60 s step: sample input, send it, apply it locally right away (prediction).
function fixedStep(): void {
  if (!predicted || latest?.phase !== 'racing') return;
  const c = readControls(predicted);
  const inp: InputMsg = { t: 'input', seq: ++seq, th: c.th, st: c.st, hb: c.hb };
  net.send(inp);
  pending.push(inp);
  if (pending.length > 600) pending.shift();
  prevPredicted = toPhys(predicted);
  stepCar(predicted, c);
}

// --- interpolation of server snapshots (remote cars, spectators, and you with prediction off)
function interpolated(): Map<number, CarPhys> {
  const out = new Map<number, CarPhys>();
  if (snaps.length === 0) return out;
  const rt = estTick - INTERP_DELAY_TICKS;
  let i = snaps.length - 1;
  while (i > 0 && snaps[i].tick > rt) i--;
  const a = snaps[i];
  const b = snaps[i + 1];
  if (!b || rt <= a.tick) {
    for (const c of a.cars) out.set(c.id, toPhys(c));
    return out;
  }
  const t = Math.min(1, (rt - a.tick) / (b.tick - a.tick));
  for (const cb of b.cars) {
    const ca = a.cars.find((c) => c.id === cb.id) ?? cb;
    out.set(cb.id, {
      x: ca.x + (cb.x - ca.x) * t,
      y: ca.y + (cb.y - ca.y) * t,
      vx: cb.vx, vy: cb.vy,
      a: ca.a + wrapAngle(cb.a - ca.a) * t,
    });
  }
  return out;
}

function draw(alpha: number): void {
  const s = latest;
  if (!s) return renderer.draw([]);
  const interp = interpolated();
  const cars: DrawCar[] = [];
  const isPlayer = s.role === 'player';
  s.cars.forEach((c, slot) => {
    const mine = c.id === myId;
    if (mine && opts.predict && predicted && prevPredicted) {
      cars.push({
        x: prevPredicted.x + (predicted.x - prevPredicted.x) * alpha + offset.x,
        y: prevPredicted.y + (predicted.y - prevPredicted.y) * alpha + offset.y,
        a: prevPredicted.a + wrapAngle(predicted.a - prevPredicted.a) * alpha + offset.a,
        color: ORANGE, alpha: 1, label: 'You',
      });
    } else {
      const p = interp.get(c.id) ?? toPhys(c);
      cars.push({
        ...p,
        color: mine ? ORANGE : isPlayer ? BLUE : SLOT_COLORS[slot % 2],
        alpha: !mine && isPlayer ? 0.45 : 1, // the opponent is a ghost
        label: mine ? 'You' : c.name,
      });
    }
    if (mine && opts.showServer) cars.push({ x: c.x, y: c.y, a: c.a, color: '#ffffff', alpha: 0.9, outline: true });
  });
  cars.sort((p, q) => p.alpha - q.alpha); // ghosts underneath
  renderer.draw(cars);
}

// --- HUD
const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const progress = (c: CarSnap) => (c.finish !== null ? 1e9 - c.finish : c.lap * SEG_COUNT + ((c.cp - 1 + SEG_COUNT) % SEG_COUNT));

let lastBanner = '';
function setBanner(html: string, small = false): void {
  const key = html + small;
  if (key === lastBanner) return;
  lastBanner = key;
  bannerEl.innerHTML = html;
  bannerEl.classList.toggle('small', small);
}
let lastHud = '';
function setHud(text: string): void {
  if (text !== lastHud) hudEl.textContent = lastHud = text;
}

function updateHud(): void {
  const s = latest;
  if (!s) {
    setHud('');
    return setBanner(net.connected ? 'Joining…' : 'Connecting…', true);
  }
  const me = s.cars.find((c) => c.id === myId);
  const queuePos = s.queue.indexOf(`Racer ${myId}`) + 1;
  const sinceStart = estTick - s.raceStart;

  if (me && (s.phase === 'racing' || s.phase === 'countdown')) {
    const steps = me.finish ?? me.steps + (predicted ? pending.length : 0);
    const others = s.cars.filter((c) => c.id !== me.id);
    const pos = 1 + others.filter((o) => progress(o) > progress(me)).length;
    setHud(`Lap ${Math.min(me.lap + 1, LAPS)}/${LAPS}   P${pos}/${s.cars.length}\n${fmtTime(steps * DT)}`);
  } else if (s.role === 'spectator') {
    setHud(queuePos ? `Spectating · #${queuePos} in queue` : 'Spectating');
  } else setHud('');

  if (s.phase === 'waiting') {
    setBanner('Waiting for an opponent<br><span class="sub">Open this page in a second window to race yourself — press P there for autopilot</span>', true);
  } else if (s.phase === 'countdown') {
    setBanner(String(Math.max(1, Math.ceil((s.phaseEnd - estTick) / TICK_RATE))));
  } else if (s.phase === 'racing') {
    if (me?.finish != null) setBanner(`Finished · ${fmtTime(me.finish * DT)}<br><span class="sub">Waiting for the others</span>`, true);
    else if (me && sinceStart < TICK_RATE) setBanner('GO!');
    else setBanner('');
  } else if (s.results) {
    const rows = s.results.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}${r.name === `Racer ${myId}` ? ' (you)' : ''}</td>` +
      `<td>${r.time === null ? '—' : fmtTime(r.time)}</td><td>${escapeHtml(r.note)}</td></tr>`).join('');
    const next = Math.max(0, Math.ceil((s.phaseEnd - estTick) / TICK_RATE));
    setBanner(`<div class="results"><h2>Results</h2><table>${rows}</table><p class="sub">Next race in ${next}s</p></div>`, true);
  }
}

function updateStats(): void {
  const s = latest;
  const lines = [
    `RTT          ${net.connected ? `${Math.round(stats.rtt)} ms` : 'offline'}`,
    `Server tick  ${s ? s.tick : '—'}`,
    `Phase        ${s ? `${s.phase} (${s.role})` : '—'}`,
    `Snapshots    ${snaps.length} buffered @ 20 Hz`,
    `Interp delay ${Math.round((INTERP_DELAY_TICKS / TICK_RATE) * 1000)} ms`,
    `Unacked      ${pending.length} inputs`,
    `Corrections  ${stats.corrections}`,
    `  last/max   ${stats.lastErr.toFixed(2)} / ${stats.maxErr.toFixed(2)} px`,
  ];
  statsEl.textContent = lines.join('\n');
}

// --- debug controls
const predictBox = $<HTMLInputElement>('opt-predict');
const serverBox = $<HTMLInputElement>('opt-server');
const autoBox = $<HTMLInputElement>('opt-auto');
const latSlider = $<HTMLInputElement>('opt-lat');
const jitSlider = $<HTMLInputElement>('opt-jit');
function setAutopilot(on: boolean): void {
  opts.autopilot = on;
  autoBox.checked = on;
}
predictBox.addEventListener('change', () => (opts.predict = predictBox.checked));
serverBox.addEventListener('change', () => (opts.showServer = serverBox.checked));
autoBox.addEventListener('change', () => setAutopilot(autoBox.checked));
latSlider.addEventListener('input', () => {
  net.latencyMs = Number(latSlider.value);
  $('lat-val').textContent = `${latSlider.value} ms`;
});
jitSlider.addEventListener('input', () => {
  net.jitterMs = Number(jitSlider.value);
  $('jit-val').textContent = `${jitSlider.value} ms`;
});
// Keep arrow keys / space driving the car, not the last-clicked control.
$('debug').addEventListener('change', (e) => (e.target as HTMLElement).blur());
$('debug').addEventListener('pointerup', (e) => setTimeout(() => (e.target as HTMLElement).blur?.(), 0));

// --- main loop: fixed-step simulation, render every frame
let acc = 0;
let lastT = performance.now();
let statsAt = 0;
function frame(now: number): void {
  const dtMs = Math.min(250, now - lastT);
  lastT = now;
  estTick += (dtMs / 1000) * TICK_RATE;
  acc += dtMs / 1000;
  let n = 0;
  while (acc >= DT && n < 8) {
    fixedStep();
    acc -= DT;
    n++;
  }
  if (n === 8) acc = 0;
  const k = Math.exp((-dtMs / 1000) * 10);
  offset.x *= k;
  offset.y *= k;
  offset.a *= k;
  draw(acc / DT);
  updateHud();
  if (now - statsAt > 250) {
    statsAt = now;
    updateStats();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only hook for automated tests.
Object.assign(window, {
  __ghostRacer: {
    stats,
    state: () => ({ myId, phase: latest?.phase, role: latest?.role, pending: pending.length, predicted, lap: latest?.cars.find((c) => c.id === myId)?.lap }),
  },
});
