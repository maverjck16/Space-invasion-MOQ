import { nextArenaId } from "../id";
import type { Vec2 } from "../types";
import type { GameDifficultyConfig } from "../types";
import { Invader } from "./Invader";

// TESTBED: range colonne/righe di default (era columns 5-14, rows 2-6, cioe' 10-84 invasori nella
// versione originale) - griglie piu' piccole cosi' uno scenario automatico/non reattivo puo'
// effettivamente eliminarle in tempo utile. Usati SOLO se il chiamante non passa un
// GameDifficultyConfig esplicito (vedi costruttore sotto), quindi il comportamento di ogni codice
// esistente che istanzia "new Grid(ctx, canvas)" resta identico a prima. Identico in entrambi i
// testbed (diff-verificabile).
const DEFAULT_COLUMNS_MIN = 2;
const DEFAULT_COLUMNS_MAX = 4;
const DEFAULT_ROWS_MIN = 1;
const DEFAULT_ROWS_MAX = 2;

//Classe Grid rappresenta un gruppo di invasori (distribuiti in una griglia) che si muovono insieme, gestisce la loro posizione,
//  velocità, disegno, aggiornamento dello stato e la logica di movimento (rimbalzo ai bordi del canvas e discesa verso il giocatore)
export class Grid {
  id: string;
  position: Vec2;
  velocity: Vec2;
  invaders: Invader[];
  width: number;
  // TESTBED: se false, nessun invasore di questa griglia sparera' mai (vedi ScriptedWave.canShoot
  // in game/localGame/types.ts e il ciclo di sparo in LocalGameEngine.animate()). true di default
  // cosi' ogni "new Grid(...)" esistente (gioco manuale, spawner casuale) resta invariato.
  canShoot = true;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
    config?: Pick<GameDifficultyConfig, "gridColumnsMin" | "gridColumnsMax" | "gridRowsMin" | "gridRowsMax">,
  ) {
    // 1v1: id dal contatore dedicato all'arena condivisa (vedi id.ts) - deve avanzare identico
    // sui due client per restare comparabile via GameSnapshot.killedIds.
    this.id = nextArenaId("grid");
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 3, y: 0 };
    this.invaders = [];

    const columnsMin = config?.gridColumnsMin ?? DEFAULT_COLUMNS_MIN;
    const columnsMax = config?.gridColumnsMax ?? DEFAULT_COLUMNS_MAX;
    const rowsMin = config?.gridRowsMin ?? DEFAULT_ROWS_MIN;
    const rowsMax = config?.gridRowsMax ?? DEFAULT_ROWS_MAX;

    const columns = Math.floor(Math.random() * (columnsMax - columnsMin + 1) + columnsMin);
    const rows = Math.floor(Math.random() * (rowsMax - rowsMin + 1) + rowsMin);

    this.width = columns * 30;

    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        this.invaders.push(
          new Invader(this.ctx, {
            position: { //posiziono gli invasori in una griglia con spaziatura di 30 pixel
              x: x * 30,
              y: y * 30,
            },
          }),
        );
      }
    }
  }

  update(): void {
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;

    this.velocity.y = 0;

    if (
      this.position.x + this.width >= this.canvas.width ||
      this.position.x <= 0
    ) {
      this.velocity.x = -this.velocity.x;
      this.velocity.y = 30;
    }
  }
}
