import { nextArenaId } from "../id";
import type { Vec2 } from "../types";

//Classe InvaderProjectile rappresenta i proiettili sparati dagli invasori, gestisce la loro posizione, velocità, disegno e
// aggiornamento dello stato. Differiscono dai proiettili del giocatore per forma e velocità.
export class InvaderProjectile {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2; velocity: Vec2 },
  ) {
    // 1v1: id dal contatore dedicato all'arena condivisa (vedi id.ts) - i proiettili nemici fanno
    // parte della simulazione deterministica condivisa (vedi LocalGameEngine.ts).
    this.id = nextArenaId("invproj");
    this.position = { ...args.position };
    this.velocity = { ...args.velocity };
    this.width = 3;
    this.height = 10;
  }

  draw(): void {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(this.position.x, this.position.y, this.width, this.height);
  }

  update(): void {
    this.draw();
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
  }
}
