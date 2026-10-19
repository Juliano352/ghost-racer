# Ghost Racer

2D top-down web racer with an authoritative WebSocket server: the first two connections race (opponent = no-collision ghost), everyone else spectates and queues for the next race.
Netcode: shared deterministic physics, client-side prediction + reconciliation for your car, 100 ms interpolation for the ghost, built-in lag/jitter simulator and stats panel.

- **Dev:** `npm install` then `npm run dev` → open http://localhost:5173 in two windows (press **P** in one for autopilot).
- **Prod:** `npm run build && npm start` → http://localhost:8080 (`PORT` env var to change). Node ≥ 23.6 (runs `.ts` directly).
- **Test:** `npm test` (headless full race, prediction-exactness, anti-speedhack, rotation, forfeit) · `npm run typecheck`.
- No API keys. Plan and history: vault `Projects/Ghost Racer.md`.
