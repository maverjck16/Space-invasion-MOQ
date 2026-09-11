import { nextArenaId } from "../id";
import type { Vec2 } from "../types";

//---AI--- Classe Asteroid rappresenta gli asteroidi che appaiono casualmente e si muovono verso il giocatore, gestisce la loro posizione,
//velocità, disegno, aggiornamento dello stato, rotazione e logica di collisione con il giocatore e i proiettili.
//Gli asteroidi hanno anche una barra della salute che diminuisce quando vengono colpiti dai proiettili del giocatore.
export class Asteroid {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  health: number;
  maxHealth: number;
  points: number[];

  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
    args: { target: Vec2 },
  ) {
    // 1v1: id dal contatore dedicato all'arena condivisa (vedi id.ts).
    this.id = nextArenaId("asteroid");

    this.radius = Math.random() * 24 + 18; // raggio casuale tra 18 e 42 pixel

    if (this.radius < 26) this.maxHealth = 2;
    else if (this.radius < 34) this.maxHealth = 3;
    else this.maxHealth = 4;

    this.health = this.maxHealth;
    this.rotation = 0;
    this.rotationSpeed = (Math.random() - 0.5) * 0.05;

    //posiziono l'asteroide in modo casuale fuori dallo schermo, scegliendo un lato a caso da cui farlo entrare
    const spawnSide = Math.floor(Math.random() * 4);
    let startX = 0;
    let startY = 0;

    //spawnSide: 0 = sopra, 1 = destra, 3 = sinistra
    if (spawnSide === 0) {
      startX = Math.random() * this.canvas.width;
      startY = -this.radius - 20;
    } else if (spawnSide === 1) {
      startX = this.canvas.width + this.radius + 20;
      startY = Math.random() * this.canvas.height;
    } else {
      startX = -this.radius - 20;
      startY = Math.random() * this.canvas.height;
    }

    this.position = { x: startX, y: startY };

    //calcolo l'angolo di movimento verso il target (posizione del giocatore) e una velocità casuale per l'asteroide
    const angle = Math.atan2(args.target.y - startY, args.target.x - startX);
    const speed = Math.random() * 1.1 + 1.2;

    this.velocity = {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    };

    //per cambiare il numero di asteoridi generati devo cambiare

   //---AI--- generazione asteroide con forma irregolare
    const pointsCount = Math.floor(Math.random() * 4) + 8;
    this.points = [];

    for (let i = 0; i < pointsCount; i++) {
      const variation = this.radius * (0.72 + Math.random() * 0.38);
      const angleStep = (Math.PI * 2 * i) / pointsCount;
      this.points.push(Math.cos(angleStep), Math.sin(angleStep), variation);
    }
  }


  //---AI--- metodo per disegnare la barra della salute sopra l'asteroide, mostrando la salute residua in modo visivo
  private drawHealthBar(): void {
    const width = this.radius * 1.8;
    const height = 5;
    const left = this.position.x - width / 2;
    const top = this.position.y - this.radius - 14;

    this.ctx.fillStyle = "rgba(255,255,255,0.18)";
    this.ctx.fillRect(left, top, width, height);

    this.ctx.fillStyle = "#00ffff";
    this.ctx.fillRect(left, top, width * (this.health / this.maxHealth), height);
  }

  update(): void {
    this.rotation += this.rotationSpeed;
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
    this.draw();
  }

  //---AI--- metodo per disegnare l'asteroide, applicando rotazione e disegnando una forma irregolare basata sui punti generati
  //casualmente
  draw(): void {
    this.ctx.save();
    this.ctx.translate(this.position.x, this.position.y);
    this.ctx.rotate(this.rotation);

    this.ctx.beginPath();

    if (this.points.length >= 3) {
      const firstRadius = this.points[2];
      this.ctx.moveTo(this.points[0] * firstRadius, this.points[1] * firstRadius);

      for (let i = 3; i < this.points.length; i += 3) {
        const nx = this.points[i];
        const ny = this.points[i + 1];
        const nr = this.points[i + 2];
        this.ctx.lineTo(nx * nr, ny * nr);
      }

      this.ctx.closePath();
    } else {
      this.ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    }

    this.ctx.fillStyle = "#9f9f9f";
    this.ctx.strokeStyle = "#d0d0d0";
    this.ctx.lineWidth = 2;
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.restore();

    this.drawHealthBar();
  }

}
