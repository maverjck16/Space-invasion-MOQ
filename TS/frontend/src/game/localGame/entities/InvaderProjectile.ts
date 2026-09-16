import { nextId } from "../id";
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
    // Id dal contatore locale (vedi id.ts): i proiettili nemici fanno parte dell'arena simulata su
    // entrambi i client, ma non vengono mai eliminati da un colpo ne' citati in
    // GameSnapshot.killedIds, quindi il loro id non deve coincidere tra i due lati. Tenerli fuori
    // dal contatore dell'arena evita che uno sparo in piu' su un solo client (ondata eliminata con
    // qualche frame di ritardo) sposti gli id di tutte le griglie/invasori/asteroidi successivi.
    this.id = nextId("invproj");
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
