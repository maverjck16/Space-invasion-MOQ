import { nextId } from "../id";
import type { Vec2 } from "../types";

//Classe Particle rappresenta le particelle usate per esplosioni e stelle di sfondo, gestisce la loro posizione, velocità, disegno,
// opacità e aggiornamento dello stato
export class Particle {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  color: string;
  opacity: number;
  fades: boolean;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: {
      position: Vec2;
      velocity: Vec2;
      radius: number;
      color: string;
      fades?: boolean;
    },
  ) {
    this.id = nextId("particle");
    this.position = { ...args.position };
    this.velocity = { ...args.velocity };
    this.radius = args.radius;
    this.color = args.color;
    this.opacity = 1;
    this.fades = args.fades ?? false;
  }

  draw(): void {
    this.ctx.save();
    this.ctx.globalAlpha = this.opacity;
    this.ctx.beginPath();
    this.ctx.arc(this.position.x, this.position.y, this.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = this.color;
    this.ctx.fill();
    this.ctx.closePath();
    this.ctx.restore();
  }

  update(): void {
    this.draw();
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;

    if (this.fades) {
      this.opacity -= 0.02;
    }
  }
}
