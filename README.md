# Ghost Racer

2D top-down web racer with an authoritative WebSocket server: the first two connections race with car-to-car collisions (`GHOST=1` for no-collision ghost mode), everyone else spectates and queues.
Netcode: shared deterministic physics, client-side prediction + reconciliation for your car, 100 ms interpolation for the ghost, built-in lag/jitter simulator and stats panel.

- **Dev:** `npm install` then `npm run dev` → open http://localhost:5173 in two windows (press **P** in one for autopilot).
- **Prod:** `npm run build && npm start` → http://localhost:8080 (`PORT` env var to change). Node ≥ 23.6 (runs `.ts` directly).
- **Test:** `npm test` (headless full race, prediction-exactness, anti-speedhack, rotation, forfeit) · `npm run typecheck`.
- Free all slots: `curl -X POST http://127.0.0.1:8080/admin/kick` (localhost only). No API keys. Plan and history: vault `Projects/Ghost Racer.md`.
