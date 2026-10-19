// WebSocket wrapper with a built-in lag simulator. WebSockets run over TCP, so simulated
// delay must keep messages in order (no reordering, no loss) — exactly what real TCP lag looks like.
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts';

export class Net {
  latencyMs = 0; // added round trip; half applied each way
  jitterMs = 0;
  connected = false;
  private url: string;
  private onMsg: (m: ServerMsg) => void;
  private ws: WebSocket | null = null;
  private outQ = new DelayQueue();
  private inQ = new DelayQueue();

  constructor(url: string, onMsg: (m: ServerMsg) => void) {
    this.url = url;
    this.onMsg = onMsg;
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as ServerMsg;
      this.inQ.push(this.delay(), () => this.onMsg(m));
    };
    ws.onclose = () => {
      this.connected = false;
      setTimeout(() => this.connect(), 1000);
    };
  }

  send(m: ClientMsg): void {
    const ws = this.ws;
    const data = JSON.stringify(m);
    this.outQ.push(this.delay(), () => { if (ws?.readyState === WebSocket.OPEN) ws.send(data); });
  }

  private delay(): number {
    return this.latencyMs / 2 + Math.random() * this.jitterMs;
  }
}

/**
 * FIFO with per-message delays. One timer drains the queue in order — separate setTimeouts per
 * message can fire out of order (browsers round delays to whole ms), which TCP never does.
 */
class DelayQueue {
  private q: { at: number; fn: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(delayMs: number, fn: () => void): void {
    const now = performance.now();
    const at = Math.max(now + delayMs, this.q.at(-1)?.at ?? 0);
    if (this.q.length === 0 && at <= now) return fn();
    this.q.push({ at, fn });
    this.arm();
  }

  private arm(): void {
    if (this.timer !== null || this.q.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while (this.q.length && this.q[0].at <= now + 0.5) this.q.shift()!.fn();
      this.arm();
    }, Math.max(0, this.q[0].at - performance.now()));
  }
}
