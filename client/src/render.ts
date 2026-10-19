import { CAR } from '../../shared/constants.ts';
import { HALF_WIDTH, TRACK_POINTS, WORLD_H, WORLD_W } from '../../shared/track.ts';

export interface DrawCar {
  x: number; y: number; a: number;
  color: string; alpha: number;
  label?: string;
  outline?: boolean;
}

const MARGIN = 16;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private track = document.createElement('canvas');
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    this.dpr = devicePixelRatio || 1;
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    const panel = w > 1000 ? 280 : 0; // keep the track clear of the netcode panel on wide screens
    this.scale = Math.min((w - panel - 2 * MARGIN) / WORLD_W, (h - 2 * MARGIN) / WORLD_H);
    this.ox = (w - panel - WORLD_W * this.scale) / 2;
    this.oy = (h - WORLD_H * this.scale) / 2;
    this.buildTrack();
  }

  private toWorld(g: CanvasRenderingContext2D): void {
    const k = this.dpr * this.scale;
    g.setTransform(k, 0, 0, k, this.dpr * this.ox, this.dpr * this.oy);
  }

  // The track never changes, so it's drawn once per resize into an offscreen canvas.
  private buildTrack(): void {
    const t = this.track;
    t.width = this.canvas.width;
    t.height = this.canvas.height;
    const g = t.getContext('2d')!;
    g.fillStyle = '#12261a';
    g.fillRect(0, 0, t.width, t.height);
    this.toWorld(g);
    g.fillStyle = '#1e4429';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let x = 0; x < WORLD_W; x += 80) g.fillRect(x, 0, 40, WORLD_H);

    const path = new Path2D();
    TRACK_POINTS.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // kerbs
    g.lineWidth = HALF_WIDTH * 2 + 12;
    g.strokeStyle = '#eeeeee';
    g.stroke(path);
    g.setLineDash([22, 22]);
    g.strokeStyle = '#c8322c';
    g.stroke(path);
    g.setLineDash([]);
    // tarmac (same width as the physics collision band — round joins match nearest-point walls)
    g.lineWidth = HALF_WIDTH * 2;
    g.strokeStyle = '#3a3e44';
    g.stroke(path);
    g.lineWidth = 2;
    g.setLineDash([18, 26]);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.stroke(path);
    g.setLineDash([]);

    // start/finish chequers across point 0
    const [sx, sy] = TRACK_POINTS[0];
    const [nx, ny] = TRACK_POINTS[1];
    g.save();
    g.translate(sx, sy);
    g.rotate(Math.atan2(ny - sy, nx - sx));
    const sq = 10;
    for (let row = 0; row * sq < HALF_WIDTH * 2; row++) {
      for (let col = 0; col < 2; col++) {
        g.fillStyle = (row + col) % 2 ? '#111' : '#fff';
        g.fillRect(col * sq - sq, -HALF_WIDTH + row * sq, sq, sq);
      }
    }
    g.restore();
  }

  draw(cars: DrawCar[]): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.track, 0, 0);
    this.toWorld(ctx);
    const L = CAR.length, W = CAR.width;
    for (const c of cars) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.globalAlpha = c.alpha;
      if (c.outline) {
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.color;
        ctx.strokeRect(-L / 2, -W / 2, L, W);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.roundRect(-L / 2 + 2, -W / 2 + 3, L, W, 5);
        ctx.fill();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.roundRect(-L / 2, -W / 2, L, W, 5);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(L / 2 - 14, -W / 2 + 3, 6, W - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(L / 2 - 3, -W / 2 + 2, 2, 4);
        ctx.fillRect(L / 2 - 3, W / 2 - 6, 2, 4);
      }
      ctx.restore();
    }
    // labels in screen space so they stay readable at any zoom
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const c of cars) {
      if (!c.label) continue;
      const sx = this.ox + c.x * this.scale, sy = this.oy + c.y * this.scale - 20;
      ctx.globalAlpha = Math.max(c.alpha, 0.6);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(c.label, sx + 1, sy + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(c.label, sx, sy);
    }
    ctx.globalAlpha = 1;
  }
}
