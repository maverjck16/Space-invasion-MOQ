import type { GameSnapshot } from "../moq/publisher";
import spaceshipImgSrc from "../image/spaceship.png";
import invaderImgSrc from "../image/invader.png";

//definisco i tipi per le entità di gioco e le loro proprietà, così come le opzioni per inizializzare il gioco locale
type LocalGameOptions = {
  canvas: HTMLCanvasElement;
  //funzione di callback per inviare snapshot del gioco al publisher
  onSnapshot: (snapshot: GameSnapshot) => void;
  //funzione di callback opzionale per notificare il publisher quando il punteggio cambia
  onScoreChange?: (score: number) => void;
};

//Vec2 è un tipo che rappresenta un vettore a due dimensioni, usato per posizioni e velocità
type Vec2 = {
  x: number;
  y: number;
};

//RestartButton rappresenta le proprietà di un pulsante di riavvio visualizzato quando il gioco è finito
type RestartButton = {
  x: number;
  y: number;
  width: number;
  height: number;
};

//KeyState tiene traccia dello stato di pressione dei tasti WASD e spazio, usati per controllare il giocatore
type KeysState = {
  a: { pressed: boolean };
  d: { pressed: boolean };
  w: { pressed: boolean };
  s: { pressed: boolean };
  space: { pressed: boolean };
};

//GameFlags tiene traccia dello stato del gioco, se è finito o attivo
type GameFlags = {
  over: boolean;
  active: boolean;
};

//i tipi "Like" rappresentano le proprietà  delle entità di gioco che vengono incluse negli snapshot inviati al publisher per tenere
//traccia dello stato del gioco lato server e sincronizzare i client connessi
type ProjectileLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
};

type InvaderProjectileLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
};

type ParticleLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  color: string;
  opacity: number;
  fades: boolean;
};

type InvaderLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
};

type GridLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  invaders: Invader[];
};

type AsteroidLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  health: number;
  maxHealth: number;
  points: number[];
};

let idCounter = 0;

//funzione di supporto che genera ID univoci per le entità di gioco così da poterle identificare negli snapshot inviati al publisher
//e gestire correttamente le collisioni e gli aggiornamenti dello stato del gioco
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`; //esempio: "proj-1", "invader-3", "asteroid-5"
}

//funzione principale che crea e avvia il gioco locale, accettando un canvas su cui disegnare, una funzione di callback per inviare 
// snapshot al publisher
export function createLocalGame(
  canvas: HTMLCanvasElement,
  onSnapshot: (snapshot: GameSnapshot) => void,
  onScoreChange?: (score: number) => void,
): () => void {
  const game = new LocalGameEngine({
    canvas,
    onSnapshot,
    onScoreChange,
  });

  game.start();
  //funzione che permette di distruggere il gioco quando il giocatore si disconnette o chiude la finestra.
  return () => game.destroy(); 
}

//Classe Player rappresenta il giocatore controllato dall'utente, gestisce la sua posizione, velocità, disegno e aggiornamento dello 
// stato
class Player {
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

//Classe Projectile rappresenta i proiettili sparati dal giocatore, gestisce la loro posizione, velocità, disegno e aggiornamento dello
//  stato
class Projectile {
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

//Classe Particle rappresenta le particelle usate per esplosioni e stelle di sfondo, gestisce la loro posizione, velocità, disegno, 
// opacità e aggiornamento dello stato
class Particle {
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

//Classe InvaderProjectile rappresenta i proiettili sparati dagli invasori, gestisce la loro posizione, velocità, disegno e 
// aggiornamento dello stato. Differiscono dai proiettili del giocatore per forma e velocità.
class InvaderProjectile {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2; velocity: Vec2 },
  ) {
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

//Classe Invader rappresenta gli invasori nemici, gestisce la loro posizione, velocità, disegno, aggiornamento dello stato
//e la capacità di sparare
class Invader {
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

//Classe Grid rappresenta un gruppo di invasori (distribuiti in una griglia) che si muovono insieme, gestisce la loro posizione,
//  velocità, disegno, aggiornamento dello stato e la logica di movimento (rimbalzo ai bordi del canvas e discesa verso il giocatore)
class Grid {
  id: string;
  position: Vec2;
  velocity: Vec2;
  invaders: Invader[];
  width: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
  ) {
    this.id = nextId("grid");
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 3, y: 0 };
    this.invaders = [];

    const columns = Math.floor(Math.random() * 10 + 5);
    const rows = Math.floor(Math.random() * 5 + 2);

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

//---AI--- Classe Asteroid rappresenta gli asteroidi che appaiono casualmente e si muovono verso il giocatore, gestisce la loro posizione,
//velocità, disegno, aggiornamento dello stato, rotazione e logica di collisione con il giocatore e i proiettili.
//Gli asteroidi hanno anche una barra della salute che diminuisce quando vengono colpiti dai proiettili del giocatore.
class Asteroid {
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
    this.id = nextId("asteroid");

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

//Classe LocalGameEngine è la classe principale che gestisce l'intero gioco locale
class LocalGameEngine {
//definisce tutte le proprietà necessarie per gestire il gioco, come il canvas, il contesto, le entità di gioco, lo stato dei tasti,
//il punteggio, lo stato del gioco e le funzioni di callback per comunicare con il publisher
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onSnapshot: (snapshot: GameSnapshot) => void;
  private onScoreChange?: (score: number) => void;

  private player: Player;
  private projectiles: Projectile[] = [];
  private grids: Grid[] = [];
  private invaderProjectiles: InvaderProjectile[] = [];
  private particles: Particle[] = [];
  private asteroids: Asteroid[] = [];

  private keys: KeysState = {
    a: { pressed: false },
    d: { pressed: false },
    w: { pressed: false },
    s: { pressed: false },
    space: { pressed: false },
  };

  private restartButton: RestartButton;
  private frames = 0;
  private randomInterval = Math.floor(Math.random() * 500 + 500);
  private asteroidSpawnInterval = Math.floor(Math.random() * 260 + 360);
  private game: GameFlags = { over: false, active: true };
  private score = 0;
  private animationId: number | null = null;
  private destroyed = false;
  private scoreEl: HTMLElement | null = null;

  constructor(options: LocalGameOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");

    this.ctx = ctx;
    this.onSnapshot = options.onSnapshot;
    this.onScoreChange = options.onScoreChange;

    this.player = new Player(this.ctx, this.canvas);
    this.restartButton = {
      x: this.canvas.width / 2 - 160,
      y: this.canvas.height / 2 + 100,
      width: 320,
      height: 70,
    };

    this.scoreEl = document.querySelector("#localScoreEl");
    this.updateScoreUI();
    this.createBackgroundStars();

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.animate = this.animate.bind(this);
  }

  //metodo per avviare il gioco, aggiungendo i listener per i tasti e il click, e avviando il ciclo di animazione
  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("click", this.handleClick);
    this.animate();
  }

  //metodo per distruggere il gioco, rimuovendo i listener e cancellando l'animazione, così da liberare risorse quando il gioco
  //non è più necessario
  destroy(): void {
    this.destroyed = true;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("click", this.handleClick);
  }

  private updateScoreUI(): void {
    if (this.scoreEl) {
      this.scoreEl.textContent = String(this.score);
    }
    this.onScoreChange?.(this.score);
  }

  private createBackgroundStars(): void {
    for (let i = 0; i < 100; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
          },
          velocity: {
            x: 0,
            y: 0.3,
          },
          radius: Math.random() * 2,
          color: "white",
        }),
      );
    }
  }

  private createParticles(args: {
    object: { position: Vec2; width: number; height: number };
    color: string;
    fades: boolean;
    count?: number;
  }): void {
    const count = args.count ?? 15;

    for (let i = 0; i < count; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: args.object.position.x + args.object.width / 2,
            y: args.object.position.y + args.object.height / 2,
          },
          velocity: {
            x: (Math.random() - 0.5) * 3,
            y: (Math.random() - 0.5) * 3,
          },
          radius: Math.random() * 3 + 1,
          color: args.color,
          fades: args.fades,
        }),
      );
    }
  }

  private createAsteroidHitParticles(projectile: Projectile): void {
    for (let i = 0; i < 10; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: projectile.position.x,
            y: projectile.position.y,
          },
          velocity: {
            x: (Math.random() - 0.5) * 2.5,
            y: (Math.random() - 0.5) * 2.5,
          },
          radius: Math.random() * 2 + 1,
          color: "#cfcfcf",
          fades: true,
        }),
      );
    }
  }

  private createAsteroidExplosion(asteroid: Asteroid): void {
    for (let i = 0; i < 24; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: asteroid.position.x,
            y: asteroid.position.y,
          },
          velocity: {
            x: (Math.random() - 0.5) * 4.5,
            y: (Math.random() - 0.5) * 4.5,
          },
          radius: Math.random() * 2.5 + 1,
          color: "#d8d8d8",
          fades: true,
        }),
      );
    }
  }

  private asteroidHitsPlayer(asteroid: Asteroid, player: Player): boolean {
    const playerCenterX = player.position.x + player.width / 2;
    const playerCenterY = player.position.y + player.height / 2;

    const distX = asteroid.position.x - playerCenterX;
    const distY = asteroid.position.y - playerCenterY;
    const distance = Math.hypot(distX, distY);

    const playerRadiusApprox = Math.max(player.width, player.height) / 2.5;

    return distance < asteroid.radius + playerRadiusApprox;
  }

  private projectileHitsAsteroid(
    projectile: Projectile,
    asteroid: Asteroid,
  ): boolean {
    const distX = projectile.position.x - asteroid.position.x;
    const distY = projectile.position.y - asteroid.position.y;
    const distance = Math.hypot(distX, distY);

    return distance < projectile.radius + asteroid.radius;
  }

  private playerDeath(): void {
    this.player.opacity = 0;
    this.game.over = true;

    this.createParticles({
      object: this.player,
      color: "#ffffff",
      fades: true,
      count: 30,
    });

    //dopo 2 secondi, se il gioco non è stato distrutto nel frattempo, imposto lo stato del gioco su inattivo per fermare
    //l'animazione e le logiche di gioco
    window.setTimeout(() => {
      if (!this.destroyed) {
        this.game.active = false;
      }
    }, 2000);
  }

  //---AI--- metodo per disegnare la schermata di game over, mostrando il punteggio finale e un pulsante per riavviare il gioco
  private drawGameOver(): void {
    this.ctx.save();

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    this.ctx.shadowColor = "#ff00ff";
    this.ctx.shadowBlur = 25;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 80px Impact, sans-serif";
    this.ctx.fillText("GAME OVER", this.canvas.width / 2, this.canvas.height / 2 - 50);

    this.ctx.shadowColor = "#00ffff";
    this.ctx.shadowBlur = 18;
    this.ctx.fillStyle = "#00ffff";
    this.ctx.font = '18px "Press Start 2P", monospace';
    this.ctx.fillText(
      `SCORE: ${this.score}`,
      this.canvas.width / 2,
      this.canvas.height / 2 + 24,
    );

    this.ctx.fillStyle = "#111111";
    this.ctx.strokeStyle = "#ffffff";
    this.ctx.lineWidth = 3;
    this.ctx.fillRect(
      this.restartButton.x,
      this.restartButton.y,
      this.restartButton.width,
      this.restartButton.height,
    );
    this.ctx.strokeRect(
      this.restartButton.x,
      this.restartButton.y,
      this.restartButton.width,
      this.restartButton.height,
    );

    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = '20px "Press Start 2P", monospace';
    this.ctx.fillText(
      "RESTART",
      this.restartButton.x + this.restartButton.width / 2,
      this.restartButton.y + this.restartButton.height / 2 + 2,
    );

    this.ctx.restore();
  }

  //Metodo per riavviare il gioco, resettando tutte le entità, lo stato e il punteggio, e inviando un nuovo snapshot al publisher
  private restartGame(): void {
  this.player = new Player(this.ctx, this.canvas);
  this.player.opacity = 1;

  this.projectiles = [];
  this.grids = [];
  this.invaderProjectiles = [];
  this.particles = [];
  this.asteroids = [];

  this.keys = {
    a: { pressed: false },
    d: { pressed: false },
    w: { pressed: false },
    s: { pressed: false },
    space: { pressed: false },
  };

  this.createBackgroundStars();

  this.score = 0;
  this.updateScoreUI();

  this.frames = 0;
  this.randomInterval = Math.floor(Math.random() * 500 + 500);
  this.asteroidSpawnInterval = Math.floor(Math.random() * 260 + 360);

  this.game = {
    over: false,
    active: true,
  };

  this.emitSnapshot();
}

//Metodo per emettere uno snapshot dello stato attuale del gioco, raccogliendo tutte le informazioni rilevanti sulle entità di gioco
//e lo stato del gioco in un oggetto GameSnapshot e inviandolo al publisher tramite la funzione di callback onSnapshot.
//Prendo tutto quello che esiste nel gioco e lo impacchetto in un oggetto che rappresenta lo stato completo del gioco in quel momento,
//così da poterlo inviare al publisher e sincronizzare i client connessi
  private emitSnapshot(): void {
    const snapshot: GameSnapshot = {
      tick: this.frames,
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        width: this.player.width,
        height: this.player.height,
        vx: this.player.velocity.x,
        vy: this.player.velocity.y,
        rotation: this.player.rotation,
        opacity: this.player.opacity,
      },
      //per ciascun...
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        radius: p.radius,
      })),
      invaderProjectiles: this.invaderProjectiles.map((p) => ({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        width: p.width,
        height: p.height,
      })),
      grids: this.grids.map((grid) => ({
        id: grid.id,
        x: grid.position.x,
        y: grid.position.y,
        vx: grid.velocity.x,
        vy: grid.velocity.y,
        width: grid.width,
        invaders: grid.invaders.map((invader) => ({
          id: invader.id,
          x: invader.position.x,
          y: invader.position.y,
          width: invader.width,
          height: invader.height,
        })),
      })),
      particles: this.particles.map((particle) => ({
        id: particle.id,
        x: particle.position.x,
        y: particle.position.y,
        vx: particle.velocity.x,
        vy: particle.velocity.y,
        radius: particle.radius,
        color: particle.color,
        opacity: particle.opacity,
        fades: particle.fades,
      })),
      asteroids: this.asteroids.map((asteroid) => ({
        id: asteroid.id,
        x: asteroid.position.x,
        y: asteroid.position.y,
        vx: asteroid.velocity.x,
        vy: asteroid.velocity.y,
        radius: asteroid.radius,
        rotation: asteroid.rotation,
        health: asteroid.health,
        maxHealth: asteroid.maxHealth,
        points: asteroid.points,
      })),
      //invio anche lo stato del gioco e il punteggio attuale
      score: this.score,
      gameOver: this.game.over,
      gameActive: this.game.active,
    };

    this.onSnapshot(snapshot);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.game.over) return;

    switch (event.key) {
      case "a":
      case "A":
        this.keys.a.pressed = true;
        break;
      case "d":
      case "D":
        this.keys.d.pressed = true;
        break;
      case "w":
      case "W":
        this.keys.w.pressed = true;
        break;
      case "s":
      case "S":
        this.keys.s.pressed = true;
        break;
      case " ":
        if (!this.keys.space.pressed) {
          this.keys.space.pressed = true;
          this.projectiles.push(
            new Projectile(this.ctx, {
              position: {
                x: this.player.position.x + this.player.width / 2,
                y: this.player.position.y - 5,
              },
              velocity: {
                x: 0,
                y: -10,
              },
            }),
          );
        }
        break;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    switch (event.key) {
      case "a":
      case "A":
        this.keys.a.pressed = false;
        break;
      case "d":
      case "D":
        this.keys.d.pressed = false;
        break;
      case "w":
      case "W":
        this.keys.w.pressed = false;
        break;
      case "s":
      case "S":
        this.keys.s.pressed = false;
        break;
      case " ":
        this.keys.space.pressed = false;
        break;
    }
  }
//per il restartButton
  private handleClick(event: MouseEvent): void { 
  if (this.game.active || !this.game.over) return;

  const rect = this.canvas.getBoundingClientRect();

  const scaleX = this.canvas.width / rect.width;
  const scaleY = this.canvas.height / rect.height;

  const mouse = {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };

  if (
    mouse.x >= this.restartButton.x &&
    mouse.x <= this.restartButton.x + this.restartButton.width &&
    mouse.y >= this.restartButton.y &&
    mouse.y <= this.restartButton.y + this.restartButton.height
  ) {
    this.restartGame();
  }
}

  private animate(): void {
    if (this.destroyed) return;
    //chiedo al browser di chiamare nuovamente questo metodo al prossimo frame, creando un ciclo di animazione continuo
    this.animationId = requestAnimationFrame(this.animate);

    //fill dello sfondo di nero ad ogni frame per cancellare il disegno precedente e ridisegnare tutto da capo, così da creare
    //l'illusione del movimento
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.game.active) {
      this.drawGameOver();
      this.emitSnapshot();
      return;
    }

    this.player.update();

    //ciclo inverso per iterare sulle particelle, aggiornare il loro stato e rimuovere quelle che sono completamente trasparenti 
    // o che sono uscite dallo schermo (per le particelle che non svaniscono)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];

      if (
        !particle.fades &&
        particle.position.y - particle.radius >= this.canvas.height
      ) {
        particle.position.x = Math.random() * this.canvas.width;
        particle.position.y = -particle.radius;
      }

      if (particle.opacity <= 0) {
        this.particles.splice(i, 1);
      } else {
        particle.update();
      }
    }

    //ciclo inverso per iterare sugli asteroidi, aggiornare il loro stato, gestire la logica di rimozione quando escono dallo schermo
    //  o quando colpiscono il giocatore,
    for (let asteroidIndex = this.asteroids.length - 1; asteroidIndex >= 0; asteroidIndex--) {
      const asteroid = this.asteroids[asteroidIndex];
      asteroid.update();

      if (
        asteroid.position.y - asteroid.radius > this.canvas.height + 60 ||
        asteroid.position.y + asteroid.radius < -60 ||
        asteroid.position.x - asteroid.radius > this.canvas.width + 60 ||
        asteroid.position.x + asteroid.radius < -60
      ) {
        this.asteroids.splice(asteroidIndex, 1);
        continue;
      }

      if (
        !this.game.over &&
        this.player.opacity > 0 &&
        this.asteroidHitsPlayer(asteroid, this.player)
      ) {
        this.asteroids.splice(asteroidIndex, 1);
        this.playerDeath();
        continue;
      }

      //ciclo inverso per iterare sui proiettili del giocatore e verificare se colpiscono l'asteroide, gestendo la logica di danno,
      // rimozione del proiettile, creazione di particelle di impatto e, se la salute dell'asteroide arriva a 0, 
      // creazione dell'esplosione, aumento del punteggio.
      for (let projectileIndex = this.projectiles.length - 1; projectileIndex >= 0; projectileIndex--) {
        const projectile = this.projectiles[projectileIndex];

        if (this.projectileHitsAsteroid(projectile, asteroid)) {
          this.projectiles.splice(projectileIndex, 1);
          asteroid.health -= 1;

          this.createAsteroidHitParticles(projectile);

          if (asteroid.health <= 0) {
            this.createAsteroidExplosion(asteroid);
            this.score += asteroid.maxHealth * 70;
            this.updateScoreUI();
            this.asteroids.splice(asteroidIndex, 1);
          }

          break;
        }
      }
    }

    //ciclo inverso per iterare sui proiettili degli invasori, aggiornare il loro stato
    for (let i = this.invaderProjectiles.length - 1; i >= 0; i--) {
      const invaderProjectile = this.invaderProjectiles[i];

      if (invaderProjectile.position.y > this.canvas.height) {
        this.invaderProjectiles.splice(i, 1);
        continue;
      }

      invaderProjectile.update();

      if (
        !this.game.over &&
        invaderProjectile.position.y + invaderProjectile.height >= this.player.position.y &&
        invaderProjectile.position.x + invaderProjectile.width >= this.player.position.x &&
        invaderProjectile.position.x <= this.player.position.x + this.player.width
      ) {
        this.invaderProjectiles.splice(i, 1);
        this.playerDeath();
      }
    }

    //ciclo inverso per iterare sui proiettili del giocatore, aggiornare il loro stato e rimuovere quelli che sono usciti dallo schermo
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];

      if (projectile.position.y + projectile.radius <= 0) {
        this.projectiles.splice(i, 1);
      } else {
        projectile.update();
      }
    }

    //ciclo inverso per iterare sulle griglie di invasori, aggiornare lo stato di ciascuna griglia e dei suoi invasori
    for (let gridIndex = this.grids.length - 1; gridIndex >= 0; gridIndex--) {
      const grid = this.grids[gridIndex];
      grid.update();

      //ogni 60 frame, se ci sono invasori nella griglia, ne scelgo uno a caso per farlo sparare un proiettile verso il basso
      if (this.frames % 60 === 0 && grid.invaders.length > 0) {
        grid.invaders[ 
          Math.floor(Math.random() * grid.invaders.length) //scelgo un invasore a caso dalla griglia
        ]?.shoot(this.invaderProjectiles);
      }

      //gestione collisione tra invasore e giocatore che porta alla morte del giocatore
      for (let i = grid.invaders.length - 1; i >= 0; i--) {
        const invader = grid.invaders[i];

        invader.update({ velocity: grid.velocity });

        if (
          !this.game.over &&
          this.player.opacity > 0 &&
          this.player.position.x < invader.position.x + invader.width &&
          this.player.position.x + this.player.width > invader.position.x &&
          this.player.position.y < invader.position.y + invader.height &&
          this.player.position.y + this.player.height > invader.position.y
        ) {
          grid.invaders.splice(i, 1);
          this.playerDeath();

          this.createParticles({
            object: invader,
            color: "#d8d8ff",
            fades: true,
            count: 15,
          });

          continue;
        }

        //gestione collisione tra invasore e proiettile del giocatore, con rimozione di entrambi, creazione di particelle di impatto
        for (let j = this.projectiles.length - 1; j >= 0; j--) {
          const projectile = this.projectiles[j];

          if (
            projectile.position.y - projectile.radius <= invader.position.y + invader.height &&
            projectile.position.x + projectile.radius >= invader.position.x &&
            projectile.position.x - projectile.radius <= invader.position.x + invader.width &&
            projectile.position.y + projectile.radius >= invader.position.y
          ) {
            setTimeout(() => {
              //---AI--- utilizzo un timeout a 0 per posticipare l'esecuzione di questo blocco di codice alla fine del ciclo corrente,
             //  così da evitare problemi di sincronizzazione quando rimuovo l'invasore e il proiettile dagli array durante l'iterazione
              const invaderFound = grid.invaders.find((candidate) => candidate === invader);
              const projectileFound = this.projectiles.find((candidate) => candidate === projectile);

              if (invaderFound && projectileFound) {
                this.score += 100;
                this.updateScoreUI();

                this.createParticles({
                  object: invader,
                  color: "#baa0de",
                  fades: true,
                  count: 15,
                });

                grid.invaders.splice(i, 1);
                this.projectiles.splice(j, 1);

                if (grid.invaders.length > 0) {
                  const firstInvader = grid.invaders[0];
                  const lastInvader = grid.invaders[grid.invaders.length - 1];

                  grid.width =
                    lastInvader.position.x - firstInvader.position.x + lastInvader.width;
                  grid.position.x = firstInvader.position.x;
                } else {
                  this.grids.splice(gridIndex, 1);
                }
              }
            }, 0);
          }
        }
      }
    }


    this.player.velocity.x = 0;
    this.player.velocity.y = 0;

    if (this.keys.a.pressed) {
      this.player.velocity.x = -7;
      this.player.rotation = -0.15;
    } else if (this.keys.d.pressed) {
      this.player.velocity.x = 7;
      this.player.rotation = 0.15;
    } else {
      this.player.rotation = 0;
    }

    if (this.keys.w.pressed) {
      this.player.velocity.y = -3;
    }

    if (this.keys.s.pressed) {
      this.player.velocity.y = 3;
    }

    //ogni tot frame, in modo casuale, creo una nuova griglia di invasori e la aggiungo all'array delle griglie, così da far apparire 
    // nuovi invasori
    if (this.frames % this.randomInterval === 0) {
      this.grids.push(new Grid(this.ctx, this.canvas));
      this.randomInterval = Math.floor(Math.random() * 500 + 500);
      this.frames = 0;
    }

    //ogni tot frame, in modo casuale, creo un nuovo asteroide che si muove verso il giocatore
    if (this.frames % this.asteroidSpawnInterval === 0) {
      this.asteroids.push(
        new Asteroid(this.ctx, this.canvas, {
          target: {
            x: this.player.position.x + this.player.width / 2,
            y: this.player.position.y + this.player.height / 2,
          },
        }),
      );
      this.asteroidSpawnInterval = Math.floor(Math.random() * 260 + 360);
    }

    this.frames += 1;
    this.emitSnapshot();
  }
}