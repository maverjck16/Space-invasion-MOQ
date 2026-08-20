import { nextId } from "../id";
import type { Vec2 } from "../types";

//Classe Projectile rappresenta i proiettili sparati dal giocatore, gestisce la loro posizione, velocità, disegno e aggiornamento dello
//  stato
export class Projectile {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;

  constructor( //accetta il contesto del canvas e le proprietà iniziali del proiettile come posizione e velocità
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2; velocity: Vec2 },
  ) {
    this.id = nextId("proj");
    this.position = { ...args.position };
    this.velocity = { ...args.velocity };
    this.radius = 4;
  }

  draw(): void {
    this.ctx.beginPath();
    this.ctx.arc(this.position.x, this.position.y, this.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = "#ff4d4d";
    this.ctx.fill();
    this.ctx.closePath();
  }

  update(): void {
    this.draw();
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
  }
}
