import type { Controls } from './physics.ts';

export type Phase = 'waiting' | 'countdown' | 'racing' | 'results';

// Client -> server. Clients only ever send inputs, never positions.
export interface InputMsg extends Controls { t: 'input'; seq: number }
export interface PingMsg { t: 'ping'; c: number }
export type ClientMsg = InputMsg | PingMsg;

// Server -> client
export interface CarSnap {
  id: number; name: string;
  x: number; y: number; vx: number; vy: number; a: number;
  lap: number; cp: number;
  steps: number; // inputs simulated this race = the car's own race clock
  finish: number | null; // steps at the finish line
}
export interface Result { name: string; time: number | null; note: string }
export interface Snap {
  t: 'snap';
  tick: number;
  phase: Phase;
  phaseEnd: number;
  raceStart: number;
  raceId: number;
  collisions: boolean; // false = ghost mode
  you: number;
  role: 'player' | 'spectator';
  ack: number; // last input seq of yours the server has applied
  cars: CarSnap[];
  queue: string[];
  results: Result[] | null;
}
export interface WelcomeMsg { t: 'welcome'; id: number; name: string }
export interface PongMsg { t: 'pong'; c: number }
export type ServerMsg = Snap | WelcomeMsg | PongMsg;
