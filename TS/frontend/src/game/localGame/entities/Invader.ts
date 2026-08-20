import invaderImgSrc from "../../../image/invader.png";
import { nextId } from "../id";
import type { Vec2 } from "../types";
import { InvaderProjectile } from "./InvaderProjectile";

//Classe Invader rappresenta gli invasori nemici, gestisce la loro posizione, velocità, disegno, aggiornamento dello stato
//e la capacità di sparare
export class Invader {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
  image: HTMLImageElement;
  loaded: boolean;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2 },
  ) {
    this.id = nextId("invader");
    this.position = { ...args.position };
    this.velocity = { x: 0, y: 0 };
    this.width = 30;
    this.height = 30;

    this.image = new Image();
    this.image.src = invaderImgSrc;
    this.loaded = false;

    this.image.onload = () => {
      this.loaded = true;
      const scale = 1;
      this.width = this.image.width * scale;
      this.height = this.image.height * scale;
    };
  }

  draw(): void {
    if (!this.loaded) return;
    this.ctx.drawImage(
      this.image,
      this.position.x,
      this.position.y,
      this.width,
      this.height,
    );
  }

  update(args: { velocity: Vec2 }): void {
    this.draw();
    this.position.x += args.velocity.x;
    this.position.y += args.velocity.y;
  }

  //metodo per far sparare l'invasore, creando un nuovo proiettile che si muove verso il basso
  shoot(invaderProjectiles: InvaderProjectile[]): void {
    invaderProjectiles.push(
      new InvaderProjectile(this.ctx, {
        position: {
          x: this.position.x + this.width / 2,
          y: this.position.y + this.height,
        },
        velocity: {
          x: 0,
          y: 6,
        },
      }),
    );
  }
}
