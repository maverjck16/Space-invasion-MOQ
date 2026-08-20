import type { GameSnapshot } from "../../webrtc/snapshot";
import { NETWORK_TICK_HZ } from "../../config";
import { Player } from "./entities/Player";
import { Projectile } from "./entities/Projectile";
import { Particle } from "./entities/Particle";
import { InvaderProjectile } from "./entities/InvaderProjectile";
import { Grid } from "./entities/Grid";
import { Asteroid } from "./entities/Asteroid";
import type {
  GameDifficultyConfig,
  GameFlags,
  KeysState,
  LocalGameOptions,
  RestartButton,
  Vec2,
} from "./types";

//  TESTBED: valori di default, IDENTICI a quelli hardcoded nella versione originale del motore
// (vedi i commenti storici piu' sotto), usati quando "options.gameConfig" non e' fornito - quindi
// il gioco manuale/non-Testbed continua a comportarsi esattamente come prima. Uno scenario (vedi
// src/testbed/scenario.types.ts) puo' sovrascrivere questi valori per variare il carico applicativo
// dell'esperimento (FASE 4 della tesi) senza toccare nessun altro percorso di codice.
const DEFAULT_GAME_CONFIG: GameDifficultyConfig = {
  gridSpawnIntervalFramesMin: 900,
  gridSpawnIntervalFramesMax: 1599,
  gridColumnsMin: 2,
  gridColumnsMax: 4,
  gridRowsMin: 1,
  gridRowsMax: 2,
  // Nota: la primissima istanza (nel costruttore, quando "gameConfig" non e' fornito) usa invece
  // la base storica 1200-1799, diversa da questa - vedi il costruttore per il perche'.
  asteroidSpawnIntervalFramesMin: 1400,
  asteroidSpawnIntervalFramesMax: 1999,
  asteroidsEnabled: true,
};

function randomIntervalIn(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

//Classe LocalGameEngine è la classe principale che gestisce l'intero gioco locale
export class LocalGameEngine {
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
  private networkIntervalId: number | null = null;
  private frames = 0;
  // TESTBED: intervallo di spawn di griglie/asteroidi ora derivato da "gameConfig" (vedi
  // DEFAULT_GAME_CONFIG sopra e il costruttore sotto) invece che hardcoded qui, cosi' scenari
  // diversi (src/testbed/scenario.types.ts) possono variare il carico applicativo dell'esperimento
  // (FASE 4 della tesi). Quando "gameConfig" non e' fornito (gioco manuale originale, o testbed
  // senza scenario) i valori restano IDENTICI a quelli di sempre - vedi DEFAULT_GAME_CONFIG.
  private gameConfig: GameDifficultyConfig;
  private randomInterval: number;
  private asteroidSpawnInterval: number;
  // TESTBED: conta gli asteroidi generati finora, per rispettare l'eventuale tetto opzionale
  // "gameConfig.asteroidMaxCount" (vedi types.ts) - 0 se non presente in "gameConfig".
  private asteroidsSpawned = 0;
  private game: GameFlags = { over: false, active: true };
  private score = 0;
  // TESTBED: il tick di simulazione (animate(), sotto) e' richiamato da setInterval invece che da
  // requestAnimationFrame - IDENTICO al motivo per cui il tick di rete qui sotto (networkIntervalId)
  // usa gia' setInterval: rAF viene sospeso quando la tab non sta effettivamente compositando un
  // frame (background, o un browser pilotato in automazione/headless, dove si sono osservate 0
  // chiamate a rAF anche dopo secondi) - vedi TESTBED.md. Dato che OGNI timing di gioco (spawn
  // griglie/asteroidi, cadenza spari) dipende da "this.frames", che avanzava di 1 solo ad ogni
  // rAF, un rAF che non scatta mai congela l'intera simulazione (score/posizione mai aggiornati)
  // anche se lo scenario scriptato (ScenarioPlayer) continua a "premere tasti" regolarmente.
  private gameLoopIntervalId: number | null = null;
  // TESTBED: setInterval(fn, 16.67) NON garantisce che "fn" scatti esattamente ogni 16.67ms - il
  // browser reale ha jitter (qualche ms in piu' o in meno ad ogni chiamata, di piu' sotto carico).
  // Se il numero di volte in cui animate() viene richiamato per una data finestra di tempo reale
  // varia leggermente da un caricamento di pagina all'altro, e la logica di gioco conta i frame
  // (this.frames) mentre gli input scriptati sono agganciati al tempo reale (ScenarioPlayer usa
  // setTimeout con ms assoluti), lo stesso scenario puo' eseguire un numero leggermente diverso di
  // frame di logica prima di ciascuna azione scriptata - e con finestre di collisione strette (es.
  // distruggere un asteroide in arrivo entro un certo istante) questo puo' cambiare l'esito
  // osservabile (punteggio) da un caricamento all'altro, anche restando lo stesso identico scenario.
  // Fix: "tick" (sotto) misura il tempo REALE trascorso con performance.now() e chiama animate() il
  // numero di volte necessario a recuperarlo (passo fisso, accumulatore) - cosi' il numero di frame
  // simulati per una data quantita' di tempo reale trascorso e' deterministico, indipendentemente da
  // QUANTE VOLTE il timer del browser e' effettivamente scattato nel frattempo.
  private static readonly FRAME_MS = 1000 / 60;
  // Limite di frame "di recupero" per singola chiamata di tick(), per evitare che una tab rimasta
  // sospesa a lungo (es. minimizzata per minuti) provochi un tentativo di eseguire migliaia di frame
  // in un colpo solo e blocchi la pagina - un caso estremo, non il jitter normale che questo fix
  // vuole risolvere.
  private static readonly MAX_CATCH_UP_FRAMES = 10;
  private frameAccumulatorMs = 0;
  private lastTickAtMs: number | null = null;
  private destroyed = false;
  private scoreEl: HTMLElement | null = null;

  constructor(options: LocalGameOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");

    this.ctx = ctx;
    this.onSnapshot = options.onSnapshot;
    this.onScoreChange = options.onScoreChange;

    //  Va calcolato QUI, prima di qualunque altra chiamata a Math.random() nel costruttore (es.
    // createBackgroundStars piu' sotto), per mantenere ESATTAMENTE la stessa sequenza di chiamate
    // a Math.random() - e quindi lo stesso risultato bit-per-bit dato lo stesso seed - della
    // versione precedente di questo file, dove randomInterval/asteroidSpawnInterval erano
    // inizializzatori di campo (che in JS/TS girano comunque prima del corpo del costruttore).
    this.gameConfig = options.gameConfig ?? DEFAULT_GAME_CONFIG;
    this.randomInterval = randomIntervalIn(
      this.gameConfig.gridSpawnIntervalFramesMin,
      this.gameConfig.gridSpawnIntervalFramesMax,
    );
    // TESTBED: senza "gameConfig" esplicito (gioco manuale/originale) il PRIMO intervallo asteroidi
    // usa la base 1200 storica, diversa da quella dei respawn successivi (1400, vedi animate()):
    // preservata esattamente per non alterare il comportamento fuori dalla modalita' Testbed. Con
    // "gameConfig" esplicito (scenario) si usa direttamente il range configurato, senza questa
    // asimmetria storica (non era una scelta di design, solo un dettaglio implementativo pregresso).
    this.asteroidSpawnInterval = options.gameConfig
      ? randomIntervalIn(
          this.gameConfig.asteroidSpawnIntervalFramesMin,
          this.gameConfig.asteroidSpawnIntervalFramesMax,
        )
      : randomIntervalIn(1200, 1799);

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
    this.tick = this.tick.bind(this);
  }

  //  Richiamato da setInterval (vedi start()): misura il tempo reale trascorso dall'ultima chiamata
  // e simula esattamente il numero di frame corrispondente a passo fisso (FRAME_MS ciascuno), invece
  // di limitarsi a chiamare animate() una volta per chiamata - vedi il commento su frameAccumulatorMs
  // per il motivo (jitter del timer del browser altrimenti si traduce in un numero di frame simulati
  // diverso da un caricamento di pagina all'altro, a parita' di tempo reale trascorso).
  private tick(): void {
    if (this.destroyed) return;

    const now = performance.now();
    this.frameAccumulatorMs += now - (this.lastTickAtMs ?? now);
    this.lastTickAtMs = now;

    let framesRun = 0;
    while (
      this.frameAccumulatorMs >= LocalGameEngine.FRAME_MS &&
      framesRun < LocalGameEngine.MAX_CATCH_UP_FRAMES
    ) {
      this.animate();
      this.frameAccumulatorMs -= LocalGameEngine.FRAME_MS;
      framesRun += 1;
    }

    // Se il limite di recupero e' stato raggiunto (tab rimasta sospesa a lungo), non si insegue
    // oltre: si scarta l'arretrato residuo invece di accumularlo per la prossima chiamata.
    if (framesRun >= LocalGameEngine.MAX_CATCH_UP_FRAMES) {
      this.frameAccumulatorMs = 0;
    }
  }

  //metodo per avviare il gioco, aggiungendo i listener per i tasti e il click, e avviando il ciclo di animazione
  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("click", this.handleClick);
    this.lastTickAtMs = performance.now();
    this.gameLoopIntervalId = window.setInterval(this.tick, LocalGameEngine.FRAME_MS);

    //  Il publishing verso la rete gira su un timer indipendente da requestAnimationFrame:
    // il rendering locale resta a 60fps (rAF), ma non ha senso (ed è dannoso per banda/backlog)
    // pubblicare uno snapshot ad ogni frame renderizzato. Usare setInterval invece di rAF ha
    // anche il vantaggio di continuare a girare (sia pure con un throttling del browser) quando
    // la tab passa in background, dove invece rAF viene sostanzialmente sospeso: altrimenti il
    // giocatore remoto vedrebbe il nostro avatar congelarsi non appena cambiamo tab.
    this.networkIntervalId = window.setInterval(() => {
      this.emitSnapshot();
    }, 1000 / NETWORK_TICK_HZ);
  }

  //metodo per distruggere il gioco, rimuovendo i listener e cancellando l'animazione, così da liberare risorse quando il gioco
  //non è più necessario
  destroy(): void {
    this.destroyed = true;

    if (this.gameLoopIntervalId !== null) {
      window.clearInterval(this.gameLoopIntervalId);
      this.gameLoopIntervalId = null;
    }

    if (this.networkIntervalId !== null) {
      window.clearInterval(this.networkIntervalId);
      this.networkIntervalId = null;
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

  this.asteroidsSpawned = 0;
  this.frames = 0;
  this.randomInterval = randomIntervalIn(
    this.gameConfig.gridSpawnIntervalFramesMin,
    this.gameConfig.gridSpawnIntervalFramesMax,
  );
  this.asteroidSpawnInterval = randomIntervalIn(
    this.gameConfig.asteroidSpawnIntervalFramesMin,
    this.gameConfig.asteroidSpawnIntervalFramesMax,
  );

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
    // TESTBED: richiamato da setInterval (vedi gameLoopIntervalId in start()), non piu' da
    // requestAnimationFrame - nessuna auto-schedulazione da fare qui, il timer si ripete da solo.

    //fill dello sfondo di nero ad ogni frame per cancellare il disegno precedente e ridisegnare tutto da capo, così da creare
    //l'illusione del movimento
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.game.active) {
      this.drawGameOver();
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
      // TESTBED: "this.frames > 0 &&" evita che il PRIMO sparo (e, per lo stesso motivo, il primo
      // spawn di griglia/asteroide qui sotto) scatti sempre al frame zero - 0 % N e' 0 per
      // qualunque N, quindi senza questa guardia ogni partita comincerebbe SEMPRE con una minaccia
      // istantanea, prima ancora che un input scriptato (o umano) possa reagire. Identico in
      // entrambi i testbed.
      if (this.frames > 0 && this.frames % 60 === 0 && grid.invaders.length > 0) {
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
    // TESTBED: "this.frames > 0 &&" - vedi nota sopra sullo sparo degli invasori. Ha anche
    // l'effetto collaterale (voluto) di NON far scattare piu' nella stessa iterazione anche il
    // controllo dell'asteroide qui sotto quando una griglia azzera this.frames: prima, ogni
    // respawn di griglia generava SEMPRE anche un asteroide fresco mirato alla posizione corrente
    // del giocatore nello stesso istante, un'imboscata ripetuta ad ogni nuova ondata.
    if (this.frames > 0 && this.frames % this.randomInterval === 0) {
      this.grids.push(new Grid(this.ctx, this.canvas, this.gameConfig));
      this.randomInterval = randomIntervalIn(
        this.gameConfig.gridSpawnIntervalFramesMin,
        this.gameConfig.gridSpawnIntervalFramesMax,
      );
      this.frames = 0;
    }

    //ogni tot frame, in modo casuale, creo un nuovo asteroide che si muove verso il giocatore
    // TESTBED: gli asteroidi possono essere disattivati del tutto per uno scenario (vedi
    // gameConfig.asteroidsEnabled, usato ad es. dallo scenario "stress" per ridurre una fonte di
    // variabilita' e concentrare il carico su nemici/movimento/spari - vedi TESTBED.md).
    if (
      this.gameConfig.asteroidsEnabled &&
      this.frames > 0 &&
      this.frames % this.asteroidSpawnInterval === 0 &&
      (this.gameConfig.asteroidMaxCount === undefined ||
        this.asteroidsSpawned < this.gameConfig.asteroidMaxCount)
    ) {
      this.asteroids.push(
        new Asteroid(this.ctx, this.canvas, {
          target: {
            x: this.player.position.x + this.player.width / 2,
            y: this.player.position.y + this.player.height / 2,
          },
        }),
      );
      this.asteroidsSpawned += 1;
      this.asteroidSpawnInterval = randomIntervalIn(
        this.gameConfig.asteroidSpawnIntervalFramesMin,
        this.gameConfig.asteroidSpawnIntervalFramesMax,
      );
    }

    this.frames += 1;
  }
}
