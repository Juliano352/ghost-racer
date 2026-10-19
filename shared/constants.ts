// Timing — the server simulates at TICK_RATE and broadcasts every SNAPSHOT_EVERY ticks.
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3; // 20 Hz

// Race rules
export const LAPS = 3;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const RESULTS_TICKS = 6 * TICK_RATE;
export const DNF_TICKS = 15 * TICK_RATE; // after the first finisher, others get this long
export const MAX_RACE_TICKS = 5 * 60 * TICK_RATE;

// Anti-speedhack: a client can't be simulated faster than real time (plus a little slack).
export const MAX_INPUTS_PER_TICK = 4;
export const INPUT_SLACK = 12;

// Remote cars are drawn this far in the past so there are always two snapshots to blend.
export const INTERP_DELAY_TICKS = 6; // 100 ms

// Arcade handling. Units: pixels, seconds, radians.
export const CAR = {
  maxSpeed: 520,
  accel: 430,
  brake: 900,
  reverseAccel: 260,
  maxReverse: 160,
  drag: 0.55, // fraction of speed lost per second
  rolling: 140, // speed lost per second off-throttle
  grip: 7, // how fast sideways slide is killed
  handbrakeGrip: 1.2,
  steerRate: 3.1,
  radius: 12,
  length: 34,
  width: 18,
  wallBounce: 0.3,
  wallFriction: 0.9,
  carBounce: 0.4, // restitution between cars (equal mass)
} as const;

// With collisions on, the client draws/predicts the opponent this many steps ahead at most.
export const MAX_EXTRAPOLATE_STEPS = 30;
