// Rendering (SOLO disegno, nessuna fisica) delle entita' dell'arena condivisa - invasori,
// asteroidi, proiettili nemici. Prima di questa modifica queste entita' erano simulate in modo
// identico su entrambi i client (Invader.ts/Grid.ts/Asteroid.ts/InvaderProjectile.ts, con la
// propria fisica/collisioni, guidate dallo stesso seed pseudo-casuale): quella logica ora vive
// UNA SOLA VOLTA nel server dell'arena (vedi arena-server/simulation.js). Questo file sostituisce
// quelle quattro classi con delle semplici "viste" che si limitano a ricordare, tra un
// ArenaSnapshot e il successivo (arena/arenaClient.ts), la posizione/aspetto comunicati dal server
// e a disegnarli - esattamente come gia' avveniva per la navicella avversaria (vedi
// LocalGameEngine.drawRemotePlayer/drawRemoteProjectiles, invariate): nessuna interpolazione tra
// un aggiornamento e l'altro, il disegno scatta alla cadenza di rete (BROADCAST_HZ, 25Hz) invece
// che a 60fps a schermo - stessa scelta, stesso limite gia' accettato altrove in questo progetto.
import invaderImgSrc from "../../../image/invader.png";
import type { ArenaAsteroidView, ArenaInvaderProjectileView, ArenaInvaderView } from "../../../arena/arenaClient";

// Dimensioni misurate dello sprite (vedi arena-server/simulation.js, INVADER_WIDTH/INVADER_HEIGHT:
// devono restare uguali qui e li', essendo usate anche per il test di collisione lato server).
export const INVADER_WIDTH = 31;
export const INVADER_HEIGHT = 39;

// Idem per i proiettili degli invasori (arena-server/simulation.js, spawnati con width:3,height:10
// - il server non li manda nello snapshot, essendo costanti, vedi arenaClient.ts).
const INVADER_PROJECTILE_WIDTH = 3;
const INVADER_PROJECTILE_HEIGHT = 10;

//  Sprite condiviso da ogni invasore disegnato (un solo Image/decode per l'intera arena, invece di
// uno per invasore come nella vecchia classe Invader - qui gli invasori possono essere molti di
// piu' nello stesso frame e non hanno piu' un proprio ciclo di vita lato client).
const invaderImage = new Image();
invaderImage.src = invaderImgSrc;

//  Un asteroide non manda la propria forma poligonale irregolare nello snapshot (solo raggio,
// rotazione, salute: vedi arenaClient.ts) - la forma e' puramente estetica e puo' quindi essere
// generata in locale, una sola volta per id, la prima volta che lo si incontra, esattamente con lo
// stesso algoritmo della vecchia classe Asteroid.ts. Non c'e' piu' bisogno che sia identica tra i
// due client (nessuno confronta piu' l'aspetto di un asteroide, solo il server decide se e quando
// viene distrutto), quindi usa Math.random() semplice, senza alcun seed.
function generateAsteroidShapePoints(radius: number): number[] {
  const pointsCount = Math.floor(Math.random() * 4) + 8;
  const points: number[] = [];
  for (let i = 0; i < pointsCount; i++) {
    const variation = radius * (0.72 + Math.random() * 0.38);
    const angleStep = (Math.PI * 2 * i) / pointsCount;
    points.push(Math.cos(angleStep), Math.sin(angleStep), variation);
  }
  return points;
}

type AsteroidRenderState = ArenaAsteroidView & { shapePoints: number[] };

export type ArenaEntityRemovalCallback = (kind: "invader" | "asteroid", x: number, y: number) => void;

//  Tiene la vista corrente di ciascuna categoria di entita' condivisa (chiave: id assegnato dal
// server), aggiornata a ogni ArenaSnapshot ricevuto (vedi LocalGameEngine.applyArenaSnapshot). Un
// id che sparisce da uno snapshot all'altro viene considerato "eliminato" e segnalato tramite
// onRemoved (usato da LocalGameEngine per generare le particelle di impatto, purche' la posizione
// nota fosse ancora dentro/vicino al canvas - un asteroide uscito dallo schermo genera comunque
// l'evento, ma le particelle fuori vista non sono visibili, quindi innocuo).
export class ArenaEntityRenderer {
  private readonly invaders = new Map<string, ArenaInvaderView>();
  private readonly asteroids = new Map<string, AsteroidRenderState>();
  private readonly invaderProjectiles = new Map<string, ArenaInvaderProjectileView>();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly onRemoved: ArenaEntityRemovalCallback,
  ) {}

  sync(
    invaders: ArenaInvaderView[],
    asteroids: ArenaAsteroidView[],
    invaderProjectiles: ArenaInvaderProjectileView[],
  ): void {
    const seenInvaders = new Set(invaders.map((i) => i.id));
    for (const [id, inv] of this.invaders) {
      if (!seenInvaders.has(id)) {
        this.onRemoved("invader", inv.x + INVADER_WIDTH / 2, inv.y + INVADER_HEIGHT / 2);
        this.invaders.delete(id);
      }
    }
    for (const inv of invaders) this.invaders.set(inv.id, inv);

    const seenAsteroids = new Set(asteroids.map((a) => a.id));
    for (const [id, a] of this.asteroids) {
      if (!seenAsteroids.has(id)) {
        this.onRemoved("asteroid", a.x, a.y);
        this.asteroids.delete(id);
      }
    }
    for (const a of asteroids) {
      const existing = this.asteroids.get(a.id);
      this.asteroids.set(a.id, {
        ...a,
        shapePoints: existing?.shapePoints ?? generateAsteroidShapePoints(a.radius),
      });
    }

    this.invaderProjectiles.clear();
    for (const p of invaderProjectiles) this.invaderProjectiles.set(p.id, p);
  }

  clear(): void {
    this.invaders.clear();
    this.asteroids.clear();
    this.invaderProjectiles.clear();
  }

  // Ordine di disegno (dal basso: prima cio' che nel motore originale veniva aggiornato/disegnato
  // per primo in animate()): asteroidi, poi proiettili nemici, infine invasori in cima al gruppo -
  // i proiettili/la navicella propri restano sopra a tutto questo (disegnati da LocalGameEngine
  // subito dopo aver chiamato questo metodo).
  draw(): void {
    for (const a of this.asteroids.values()) this.drawAsteroid(a);

    for (const p of this.invaderProjectiles.values()) {
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(p.x, p.y, INVADER_PROJECTILE_WIDTH, INVADER_PROJECTILE_HEIGHT);
    }

    if (invaderImage.complete && invaderImage.naturalWidth > 0) {
      for (const inv of this.invaders.values()) {
        this.ctx.drawImage(invaderImage, inv.x, inv.y, INVADER_WIDTH, INVADER_HEIGHT);
      }
    }
  }

  //---AI--- disegno dell'asteroide: stessa forma poligonale irregolare e stessa barra della
  //salute della vecchia classe Asteroid.ts, qui applicate a un oggetto puramente "dati" (nessuna
  //fisica: posizione/rotazione/salute arrivano gia' calcolate dal server).
  private drawAsteroid(asteroid: AsteroidRenderState): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(asteroid.x, asteroid.y);
    ctx.rotate(asteroid.rotation);

    ctx.beginPath();
    const points = asteroid.shapePoints;
    if (points.length >= 3) {
      const firstRadius = points[2];
      ctx.moveTo(points[0] * firstRadius, points[1] * firstRadius);
      for (let i = 3; i < points.length; i += 3) {
        ctx.lineTo(points[i] * points[i + 2], points[i + 1] * points[i + 2]);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, asteroid.radius, 0, Math.PI * 2);
    }

    ctx.fillStyle = "#9f9f9f";
    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const width = asteroid.radius * 1.8;
    const height = 5;
    const left = asteroid.x - width / 2;
    const top = asteroid.y - asteroid.radius - 14;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(left, top, width, height);
    ctx.fillStyle = "#00ffff";
    ctx.fillRect(left, top, width * (asteroid.health / asteroid.maxHealth), height);
  }
}
