// Shared car simulation. The server and the client run this exact code, which is what makes
// client-side prediction land on the same answer as the authoritative server.
import { CAR, DT } from './constants.ts';
import { HALF_WIDTH, nearestOnTrack } from './track.ts';

export interface CarPhys { x: number; y: number; vx: number; vy: number; a: number }
/** th: -1 brake/reverse, 0 coast, 1 throttle. st: -1 left, 1 right. hb: handbrake. */
export interface Controls { th: number; st: number; hb: number }

export function stepCar(c: CarPhys, inp: Controls, dt = DT): void {
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  // Split velocity into forward and sideways (right = (-fy, fx)) components.
  let fwd = c.vx * fx + c.vy * fy;
  let lat = -c.vx * fy + c.vy * fx;

  if (inp.th > 0) fwd += CAR.accel * dt;
  else if (inp.th < 0) fwd -= (fwd > 0 ? CAR.brake : CAR.reverseAccel) * dt;
  else {
    const r = CAR.rolling * dt;
    fwd = Math.abs(fwd) <= r ? 0 : fwd - Math.sign(fwd) * r;
  }
  fwd -= fwd * CAR.drag * dt;
  if (fwd > CAR.maxSpeed) fwd = CAR.maxSpeed;
  if (fwd < -CAR.maxReverse) fwd = -CAR.maxReverse;

  // Grip kills sideways slide; the handbrake mostly removes it, which is what makes drifts.
  lat -= lat * Math.min(1, (inp.hb ? CAR.handbrakeGrip : CAR.grip) * dt);
  if (inp.hb) fwd -= fwd * 0.8 * dt;

  // No steering when stopped, reversed steering in reverse, slightly duller at top speed.
  const speedFactor = Math.max(-1, Math.min(1, fwd / 120));
  const highSpeedDamp = 1 - 0.3 * Math.min(1, Math.abs(fwd) / CAR.maxSpeed);
  c.a += inp.st * CAR.steerRate * speedFactor * highSpeedDamp * dt;
  if (c.a > Math.PI) c.a -= 2 * Math.PI;
  else if (c.a < -Math.PI) c.a += 2 * Math.PI;

  // Rebuild velocity in the OLD heading basis: the car turns, its momentum lags = drift.
  c.vx = fx * fwd - fy * lat;
  c.vy = fy * fwd + fx * lat;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  collideWalls(c);
}

export function collideWalls(c: CarPhys): void {
  const n = nearestOnTrack(c.x, c.y);
  const limit = HALF_WIDTH - CAR.radius;
  if (n.dist <= limit || n.dist === 0) return;
  const nx = (c.x - n.px) / n.dist, ny = (c.y - n.py) / n.dist;
  c.x = n.px + nx * limit;
  c.y = n.py + ny * limit;
  const vn = c.vx * nx + c.vy * ny;
  if (vn > 0) {
    c.vx = (c.vx - nx * vn * (1 + CAR.wallBounce)) * CAR.wallFriction;
    c.vy = (c.vy - ny * vn * (1 + CAR.wallBounce)) * CAR.wallFriction;
  }
}
