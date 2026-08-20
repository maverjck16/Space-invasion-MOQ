import spaceshipImgSrc from "../../../image/spaceship.png";
import type { Vec2 } from "../types";

//Classe Player rappresenta il giocatore controllato dall'utente, gestisce la sua posizione, velocità, disegno e aggiornamento dello
// stato
export class Player {
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  image: HTMLImageElement;
  loaded: boolean;

  constructor( //accetta il contesto del canvas e l'elemento canvas per poter disegnare e gestire i limiti di movimento
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
  ) {
    this.width = 60;
    this.height = 60;
    this.position = {
      x: this.canvas.width / 2 - this.width / 2,
      y: this.canvas.height - this.height - 30,
    };
    this.velocity = { x: 0, y: 0 };
    this.rotation = 0;
    this.opacity = 1;

    this.image = new Image();
    this.image.src = spaceshipImgSrc;
    this.loaded = false;

    this.image.onload = () => {
      this.loaded = true;
      const scale = 0.18;
      this.width = this.image.width * scale;
      this.height = this.image.height * scale;
      this.position.x = this.canvas.width / 2 - this.width / 2;
      this.position.y = this.canvas.height - this.height - 30;
    };
  }

  //metodo per disegnare il giocatore sul canvas, applicando rotazione e trasparenza se necessario
  draw(): void {
    const { ctx } = this;
    const { x, y } = this.position;

    if (!this.loaded) return;

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(x + this.width / 2, y + this.height / 2);
    ctx.rotate(this.rotation);
    ctx.translate(-(x + this.width / 2), -(y + this.height / 2));

    ctx.drawImage(this.image, x, y, this.width, this.height);

    ctx.restore();
  }

  //metodo per aggiornare lo stato del giocatore, muovendolo in base alla sua velocità e assicurandosi che non esca dai limiti
  // del canvas
  update(): void {
    this.draw();

    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;

    if (this.position.x < 0) this.position.x = 0;
    if (this.position.x + this.width > this.canvas.width) {
      this.position.x = this.canvas.width - this.width;
    }

    if (this.position.y < 0) this.position.y = 0;
    if (this.position.y + this.height > this.canvas.height) {
      this.position.y = this.canvas.height - this.height;
    }
  }
}
