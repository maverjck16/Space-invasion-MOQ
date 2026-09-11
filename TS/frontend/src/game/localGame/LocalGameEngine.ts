import type { GameSnapshot } from "../../moq/publisher";
import {
  NETWORK_TICK_HZ,
  MATCH_DURATION_MS,
  LIVES_PER_PLAYER,
  RESPAWN_DELAY_MS,
  RESPAWN_INVULNERABILITY_MS,
} from "../../config";
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

// 1v1: frazione orizzontale del canvas in cui compaiono/respawnano le due navicelle - separate
// cosi' non nascono sovrapposte nell'arena condivisa (Player.ts accetta ora un "spawnXFraction"
// opzionale apposta per questo, di default 0.5 = comportamento originale invariato per qualunque
// altro chiamante che non lo passa).
const LOCAL_SPAWN_X_FRACTION = 0.35;
const REMOTE_SPAWN_X_FRACTION = 0.65;

// 1v1: colore dei proiettili dell'avversario, disegnati direttamente qui (non sono simulati
// localmente, arrivano gia' calcolati nello snapshot di rete - vedi applyRemoteSnapshot) - blu per
// restare coerenti con la navicella avversaria (vedi drawRemotePlayer), contro il rosso "#ff4d4d"
// dei propri proiettili (Projectile.ts, invariato).
const REMOTE_PROJECTILE_COLOR = "#4da6ff";

//Classe LocalGameEngine è la classe principale che gestisce l'intero gioco: l'arena condivisa
//(invasori/asteroidi/proiettili nemici, simulata in modo deterministico e identico su entrambi i
//client - vedi testbed/rng.ts) e le DUE navicelle nello stesso canvas: quella locale (pilotata da
//tastiera, fisica reale) e quella remota (nessuna fisica locale, disegnata alla posizione ricevuta
//nell'ultimo GameSnapshot dall'avversario - vedi applyRemoteSnapshot).
export class LocalGameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onSnapshot: (snapshot: GameSnapshot) => void;
  private onScoreChange?: (score: number) => void;
  private onLivesChange?: (lives: number) => void;
  private onMatchEnd?: () => void;
  private onTimeRemaining?: (msRemaining: number) => void;

  private localPlayer: Player;
  private remotePlayer: Player;
  // 1v1: true dopo il primo GameSnapshot ricevuto dall'avversario - prima di allora non c'e' nulla
  // di reale da disegnare per la navicella remota (evita di mostrare un fantasma alla posizione di
  // spawn di default prima che l'avversario abbia effettivamente pubblicato qualcosa).
  private remoteHasData = false;
  private remoteScore = 0;
  private remoteLives = LIVES_PER_PLAYER;
  // 1v1: proiettili dell'avversario, presi cosi' come sono nell'ultimo snapshot ricevuto (nessuna
  // simulazione locale, nessuna interpolazione tra un tick di rete e l'altro - stesso limite gia'
  // presente nella versione "a specchio" precedente).
  private remoteProjectiles: GameSnapshot["projectiles"] = [];

  // Proiettili, particelle: SOLO della propria navicella/dei propri eventi locali (id da nextId,
  // vedi id.ts). Grid/invasori/asteroidi/proiettili nemici: campo condiviso deterministico (id da
  // nextArenaId) - identico sui due client, MAI trasmesso in rete (vedi moq/publisher.ts).
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
  // TESTBED: usati SOLO quando gameConfig.scriptedWaves/scriptedAsteroids sono presenti (vedi
  // animate() e types.ts) - indice della prossima ondata/asteroide scriptato da generare, e un
  // contatore di frame dedicato che, a differenza di "this.frames", non si azzera MAI (this.frames
  // viene azzerato ad ogni spawno di griglia per lo spawner casuale legacy - vedi piu' sotto - il
  // che lo rende inadatto a un "non prima di X secondi dall'inizio partita" assoluto).
  private nextScriptedWaveIndex = 0;
  private nextScriptedAsteroidIndex = 0;
  private scriptedClock = 0;

  // 1v1: stato della PROPRIA navicella/della partita - vedi GameFlags in types.ts per la semantica
  // dei tre flag (respawning/eliminated/active), ridefinita rispetto alla versione a singolo
  // giocatore (non c'e' piu' un game over immediato al primo colpo).
  private game: GameFlags = { respawning: false, eliminated: false, active: true };
  private score = 0;
  private lives = LIVES_PER_PLAYER;
  // 1v1: id delle entita' condivise eliminate da un proprio colpo dall'ultimo snapshot inviato -
  // svuotato ad ogni emitSnapshot(), vedi moq/publisher.ts (GameSnapshot.killedIds).
  private pendingKilledIds: string[] = [];
  // 1v1: timestamp (performance.now()) fino al quale la propria navicella e' invulnerabile dopo un
  // respawn - vedi respawnLocalPlayer()/RESPAWN_INVULNERABILITY_MS.
  private invulnerableUntilMs = 0;
  // 1v1: istante di inizio partita (performance.now()) - il tempo rimanente si calcola sempre come
  // MATCH_DURATION_MS meno il tempo reale trascorso da qui, non contando i frame simulati: cosi'
  // il timer scade allo stesso istante di orologio su entrambi i client anche se le due
  // simulazioni dovessero leggermente disallinearsi in frame (vedi nota in fondo al file).
  private matchStartAtMs = 0;
  private matchEndNotified = false;
  private lastShownRemainingSec = -1;

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
  // Fix: "tick" (sotto) misura il tempo REALE trascorso con performance.now() e chiama animate() il
  // numero di volte necessario a recuperarlo (passo fisso, accumulatore) - cosi' il numero di frame
  // simulati per una data quantita' di tempo reale trascorso e' deterministico, indipendentemente da
  // QUANTE VOLTE il timer del browser e' effettivamente scattato nel frattempo. Nel 1v1 questo e'
  // ANCHE cio' che tiene allineate le due simulazioni dell'arena condivisa tra i due client (stesso
  // seed + stesso numero di frame dallo stesso istante di partenza, vedi main.ts) - vedi pero' la
  // nota su MAX_CATCH_UP_FRAMES qui sotto per il limite noto di questo meccanismo.
  private static readonly FRAME_MS = 1000 / 60;
  // Limite di frame "di recupero" per singola chiamata di tick(), per evitare che una tab rimasta
  // sospesa a lungo (es. minimizzata per minuti) provochi un tentativo di eseguire migliaia di frame
  // in un colpo solo e blocchi la pagina. NOTA 1v1: se questo limite scatta davvero (tab minimizzata
  // a lungo durante una partita), i frame "persi" NON sono identici tra i due client, e le due copie
  // dell'arena condivisa possono da quel momento divergere leggermente - vedi il meccanismo di
  // riconciliazione in applyRemoteSnapshot()/reconcileKilledIds(), che maschera le derive minori ma
  // non le risolve del tutto. Limite noto e accettato per un progetto di tesi con partite brevi.
  private static readonly MAX_CATCH_UP_FRAMES = 10;
  private frameAccumulatorMs = 0;
  private lastTickAtMs: number | null = null;
  private destroyed = false;
  private scoreEl: HTMLElement | null = null;
  private livesEl: HTMLElement | null = null;

  constructor(options: LocalGameOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");

    this.ctx = ctx;
    this.onSnapshot = options.onSnapshot;
    this.onScoreChange = options.onScoreChange;
    this.onLivesChange = options.onLivesChange;
    this.onMatchEnd = options.onMatchEnd;
    this.onTimeRemaining = options.onTimeRemaining;

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

    // 1v1: due navicelle nello stesso canvas, separate orizzontalmente cosi' non nascono
    // sovrapposte (vedi LOCAL_SPAWN_X_FRACTION/REMOTE_SPAWN_X_FRACTION sopra).
    this.localPlayer = new Player(this.ctx, this.canvas, { spawnXFraction: LOCAL_SPAWN_X_FRACTION });
    this.remotePlayer = new Player(this.ctx, this.canvas, { spawnXFraction: REMOTE_SPAWN_X_FRACTION });

    this.scoreEl = document.querySelector("#localScoreEl");
    this.livesEl = document.querySelector("#localLivesEl");
    this.updateScoreUI();
    this.updateLivesUI();
    this.createBackgroundStars();

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.animate = this.animate.bind(this);
    this.tick = this.tick.bind(this);
  }

  //  Richiamato da setInterval (vedi start()): misura il tempo reale trascorso dall'ultima chiamata
  // e simula esattamente il numero di frame corrispondente a passo fisso (FRAME_MS ciascuno), invece
  // di limitarsi a chiamare animate() una volta per chiamata - vedi il commento su frameAccumulatorMs
  // per il motivo.
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

  //metodo per avviare il gioco, aggiungendo i listener per i tasti e avviando il ciclo di animazione.
  // 1v1: da chiamare SOLO dopo che Math.random e' gia' stato installato in modo deterministico
  // (installDeterministicRandom) e all'istante concordato con l'avversario - vedi main.ts.
  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.lastTickAtMs = performance.now();
    this.matchStartAtMs = performance.now();
    this.gameLoopIntervalId = window.setInterval(this.tick, LocalGameEngine.FRAME_MS);

    //  Il publishing verso la rete gira su un timer indipendente da requestAnimationFrame:
    // il rendering locale resta a 60fps (rAF/setInterval), ma non ha senso (ed è dannoso per
    // banda/backlog) pubblicare uno snapshot ad ogni frame renderizzato.
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
  }

  private updateScoreUI(): void {
    if (this.scoreEl) {
      this.scoreEl.textContent = String(this.score);
    }
    this.onScoreChange?.(this.score);
  }

  private updateLivesUI(): void {
    if (this.livesEl) {
      this.livesEl.textContent = String(Math.max(0, this.lives));
    }
    this.onLivesChange?.(this.lives);
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

  // 1v1: true mentre la propria navicella non e' ne' pilotabile ne' collidibile - durante il breve
  // intervallo di respawn, o in modo permanente per il resto della partita se le vite sono a 0, o
  // durante l'invulnerabilita' post-respawn.
  private isLocalPlayerVulnerable(): boolean {
    return (
      !this.game.respawning &&
      !this.game.eliminated &&
      performance.now() >= this.invulnerableUntilMs
    );
  }

  // 1v1: sostituisce la vecchia playerDeath() (che terminava subito la partita). Ora un colpo
  // subito costa UNA vita: se ne restano, la navicella sparisce per RESPAWN_DELAY_MS e poi
  // ricompare con una breve invulnerabilita'; a vite esaurite resta fuori gioco per il resto della
  // partita, ma l'arena condivisa e la navicella avversaria continuano a essere simulate/disegnate
  // normalmente (vedi animate()) fino allo scadere del timer.
  private loseLife(): void {
    if (this.game.respawning || this.game.eliminated) return;

    this.localPlayer.opacity = 0;
    this.lives -= 1;

    this.createParticles({
      object: this.localPlayer,
      color: "#ffffff",
      fades: true,
      count: 30,
    });

    if (this.lives <= 0) {
      this.game.eliminated = true;
      this.updateLivesUI();
      return;
    }

    this.game.respawning = true;
    this.updateLivesUI();

    window.setTimeout(() => {
      if (this.destroyed || this.game.eliminated) return;
      this.respawnLocalPlayer();
    }, RESPAWN_DELAY_MS);
  }

  private respawnLocalPlayer(): void {
    this.localPlayer.position = {
      x: this.canvas.width * LOCAL_SPAWN_X_FRACTION - this.localPlayer.width / 2,
      y: this.canvas.height - this.localPlayer.height - 30,
    };
    this.localPlayer.velocity = { x: 0, y: 0 };
    this.localPlayer.rotation = 0;
    this.localPlayer.opacity = 1;

    this.game.respawning = false;
    this.invulnerableUntilMs = performance.now() + RESPAWN_INVULNERABILITY_MS;
  }

  // 1v1: schermata di fine partita - mostra entrambi i punteggi e chi ha vinto (o il pareggio),
  // al posto del vecchio "GAME OVER" a singolo giocatore con pulsante di restart (qui non c'e' un
  // restart: una nuova partita richiede un nuovo handshake, vedi main.ts).
  private drawMatchEnd(): void {
    this.ctx.save();

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    let outcome = "PAREGGIO";
    let outcomeColor = "#ffffff";
    if (this.score > this.remoteScore) {
      outcome = "HAI VINTO!";
      outcomeColor = "#66ff99";
    } else if (this.score < this.remoteScore) {
      outcome = "HAI PERSO";
      outcomeColor = "#ff6666";
    }

    this.ctx.shadowColor = "#ff00ff";
    this.ctx.shadowBlur = 22;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 56px Impact, sans-serif";
    this.ctx.fillText("TEMPO SCADUTO", this.canvas.width / 2, this.canvas.height / 2 - 90);

    this.ctx.shadowColor = outcomeColor;
    this.ctx.shadowBlur = 20;
    this.ctx.fillStyle = outcomeColor;
    this.ctx.font = "bold 40px Impact, sans-serif";
    this.ctx.fillText(outcome, this.canvas.width / 2, this.canvas.height / 2 - 30);

    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = "#ff8080";
    this.ctx.font = '18px "Press Start 2P", monospace';
    this.ctx.fillText(
      `TU: ${this.score}`,
      this.canvas.width / 2,
      this.canvas.height / 2 + 30,
    );
    this.ctx.fillStyle = "#80c2ff";
    this.ctx.fillText(
      `AVVERSARIO: ${this.remoteScore}`,
      this.canvas.width / 2,
      this.canvas.height / 2 + 62,
    );

    this.ctx.restore();
  }

  //Metodo per emettere uno snapshot dello stato attuale della PROPRIA navicella/dei propri
  //proiettili, impacchettandolo in un GameSnapshot e inviandolo tramite la callback onSnapshot.
  //Il campo condiviso (griglie/asteroidi/proiettili nemici) NON viene piu' incluso: ogni client lo
  //simula in locale in modo identico (stesso seed) - vedi moq/publisher.ts.
  private emitSnapshot(): void {
    const snapshot: GameSnapshot = {
      tick: this.frames,
      player: {
        x: this.localPlayer.position.x,
        y: this.localPlayer.position.y,
        width: this.localPlayer.width,
        height: this.localPlayer.height,
        vx: this.localPlayer.velocity.x,
        vy: this.localPlayer.velocity.y,
        rotation: this.localPlayer.rotation,
        opacity: this.localPlayer.opacity,
      },
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        radius: p.radius,
      })),
      score: this.score,
      lives: this.lives,
      gameOver: this.game.eliminated,
      gameActive: this.game.active,
    };

    if (this.pendingKilledIds.length > 0) {
      snapshot.killedIds = this.pendingKilledIds;
      this.pendingKilledIds = [];
    }

    this.onSnapshot(snapshot);
  }

  //  1v1: applica l'ultimo GameSnapshot ricevuto dall'avversario - aggiorna la navicella remota
  // (nessuna fisica locale, si disegna direttamente alla posizione ricevuta, vedi animate()), i
  // suoi proiettili (idem), punteggio/vite per l'HUD, e riconcilia le entita' del campo condiviso
  // che l'avversario ha eliminato (killedIds) cosi' spariscono anche dalla nostra copia locale.
  applyRemoteSnapshot(snapshot: GameSnapshot): void {
    this.remoteHasData = true;
    this.remotePlayer.position.x = snapshot.player.x;
    this.remotePlayer.position.y = snapshot.player.y;
    this.remotePlayer.velocity.x = snapshot.player.vx;
    this.remotePlayer.velocity.y = snapshot.player.vy;
    this.remotePlayer.rotation = snapshot.player.rotation;
    this.remotePlayer.opacity = snapshot.player.opacity;
    if (snapshot.player.width) this.remotePlayer.width = snapshot.player.width;
    if (snapshot.player.height) this.remotePlayer.height = snapshot.player.height;

    this.remoteProjectiles = Array.isArray(snapshot.projectiles) ? snapshot.projectiles : [];
    this.remoteScore = snapshot.score ?? 0;
    this.remoteLives = snapshot.lives ?? 0;

    if (snapshot.killedIds && snapshot.killedIds.length > 0) {
      this.reconcileKilledIds(snapshot.killedIds);
    }
  }

  //  1v1: rimuove dalla PROPRIA copia locale del campo condiviso le entita' che l'avversario ha
  // segnalato come eliminate da un SUO colpo (GameSnapshot.killedIds) - non assegna punteggio (gia'
  // contato sul suo lato), serve solo a far convergere le due viste della stessa arena.
  private reconcileKilledIds(ids: string[]): void {
    const idSet = new Set(ids);

    for (let gridIndex = this.grids.length - 1; gridIndex >= 0; gridIndex--) {
      const grid = this.grids[gridIndex];
      let changed = false;

      for (let i = grid.invaders.length - 1; i >= 0; i--) {
        const invader = grid.invaders[i];
        if (idSet.has(invader.id)) {
          this.createParticles({
            object: invader,
            color: "#baa0de",
            fades: true,
            count: 15,
          });
          grid.invaders.splice(i, 1);
          changed = true;
        }
      }

      if (!changed) continue;

      if (grid.invaders.length > 0) {
        const firstInvader = grid.invaders[0];
        const lastInvader = grid.invaders[grid.invaders.length - 1];
        grid.width = lastInvader.position.x - firstInvader.position.x + lastInvader.width;
        grid.position.x = firstInvader.position.x;
      } else {
        this.grids.splice(gridIndex, 1);
      }
    }

    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const asteroid = this.asteroids[i];
      if (idSet.has(asteroid.id)) {
        this.createAsteroidExplosion(asteroid);
        this.asteroids.splice(i, 1);
      }
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // 1v1: navicella non pilotabile mentre e' in respawn o fuori gioco (vite esaurite) - vedi
    // loseLife()/GameFlags in types.ts.
    if (this.game.respawning || this.game.eliminated) return;

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
                x: this.localPlayer.position.x + this.localPlayer.width / 2,
                y: this.localPlayer.position.y - 5,
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

  private drawRemotePlayer(): void {
    if (!this.remoteHasData || this.remotePlayer.opacity <= 0) return;
    // Nessuna fisica: la navicella remota si disegna esattamente dove l'ultimo snapshot dice che
    // si trova (vedi applyRemoteSnapshot) - stesso comportamento/limite gia' presente nella
    // versione "a specchio" precedente (drawRemotePlayer in ui/game-room.ts).
    //
    // 1v1: stesso sprite rosso (Player.ts, invariato) di quello locale, tinto di blu con un filtro
    // canvas invece di caricare un secondo asset immagine da mantenere in sync tra i due progetti -
    // ctx.filter si applica solo dentro questo save()/restore(), Player.draw() fa il suo
    // save()/restore() interno senza toccare "filter", quindi non ha effetto su nient'altro.
    this.ctx.save();
    this.ctx.filter = "hue-rotate(200deg) saturate(1.7) brightness(1.05)";
    this.remotePlayer.draw();
    this.ctx.restore();
  }

  private drawRemoteProjectiles(): void {
    for (const projectile of this.remoteProjectiles) {
      this.ctx.beginPath();
      this.ctx.arc(
        projectile?.x ?? 0,
        projectile?.y ?? 0,
        projectile?.radius ?? 4,
        0,
        Math.PI * 2,
      );
      this.ctx.fillStyle = REMOTE_PROJECTILE_COLOR;
      this.ctx.fill();
      this.ctx.closePath();
    }
  }

  private animate(): void {
    if (this.destroyed) return;

    //fill dello sfondo di nero ad ogni frame per cancellare il disegno precedente e ridisegnare tutto da capo, così da creare
    //l'illusione del movimento
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 1v1: il timer di partita si basa sul tempo reale trascorso, non sui frame simulati (vedi
    // commento su matchStartAtMs) - cosi' scade allo stesso istante su entrambi i client anche in
    // caso di lieve disallineamento dei frame.
    const remainingMs = Math.max(0, MATCH_DURATION_MS - (performance.now() - this.matchStartAtMs));
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec !== this.lastShownRemainingSec) {
      this.lastShownRemainingSec = remainingSec;
      this.onTimeRemaining?.(remainingMs);
    }

    if (remainingMs <= 0 && this.game.active) {
      this.game.active = false;
    }

    if (!this.game.active) {
      this.drawMatchEnd();
      if (!this.matchEndNotified) {
        this.matchEndNotified = true;
        this.onMatchEnd?.();
      }
      return;
    }

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

    const localVulnerable = this.isLocalPlayerVulnerable();

    //ciclo inverso per iterare sugli asteroidi, aggiornare il loro stato, gestire la logica di rimozione quando escono dallo schermo
    //  o quando colpiscono la propria navicella, o quando vengono colpiti dai propri proiettili
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

      if (localVulnerable && this.asteroidHitsPlayer(asteroid, this.localPlayer)) {
        this.asteroids.splice(asteroidIndex, 1);
        this.loseLife();
        continue;
      }

      //ciclo inverso per iterare sui propri proiettili e verificare se colpiscono l'asteroide, gestendo la logica di danno,
      // rimozione del proiettile, creazione di particelle di impatto e, se la salute dell'asteroide arriva a 0,
      // creazione dell'esplosione, aumento del punteggio e segnalazione dell'eliminazione all'avversario.
      for (let projectileIndex = this.projectiles.length - 1; projectileIndex >= 0; projectileIndex--) {
        const projectile = this.projectiles[projectileIndex];

        if (this.projectileHitsAsteroid(projectile, asteroid)) {
          this.projectiles.splice(projectileIndex, 1);
          asteroid.health -= 1;

          this.createAsteroidHitParticles(projectile);

          if (asteroid.health <= 0) {
            this.createAsteroidExplosion(asteroid);
            this.score += asteroid.maxHealth * 70;
            this.pendingKilledIds.push(asteroid.id);
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
        localVulnerable &&
        invaderProjectile.position.y + invaderProjectile.height >= this.localPlayer.position.y &&
        invaderProjectile.position.x + invaderProjectile.width >= this.localPlayer.position.x &&
        invaderProjectile.position.x <= this.localPlayer.position.x + this.localPlayer.width
      ) {
        this.invaderProjectiles.splice(i, 1);
        this.loseLife();
      }
    }

    //ciclo inverso per iterare sui propri proiettili, aggiornare il loro stato e rimuovere quelli che sono usciti dallo schermo
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
      // spawn di griglia/asteroide qui sotto) scatti sempre al frame zero.
      if (this.frames > 0 && this.frames % 60 === 0 && grid.invaders.length > 0 && grid.canShoot) {
        grid.invaders[
          Math.floor(Math.random() * grid.invaders.length) //scelgo un invasore a caso dalla griglia
        ]?.shoot(this.invaderProjectiles);
      }

      //gestione collisione tra invasore e propria navicella
      for (let i = grid.invaders.length - 1; i >= 0; i--) {
        const invader = grid.invaders[i];

        invader.update({ velocity: grid.velocity });

        if (
          localVulnerable &&
          this.localPlayer.position.x < invader.position.x + invader.width &&
          this.localPlayer.position.x + this.localPlayer.width > invader.position.x &&
          this.localPlayer.position.y < invader.position.y + invader.height &&
          this.localPlayer.position.y + this.localPlayer.height > invader.position.y
        ) {
          grid.invaders.splice(i, 1);
          this.pendingKilledIds.push(invader.id);
          this.loseLife();

          this.createParticles({
            object: invader,
            color: "#d8d8ff",
            fades: true,
            count: 15,
          });

          continue;
        }

        //gestione collisione tra invasore e proprio proiettile, con rimozione di entrambi, creazione di particelle di impatto,
        //assegnazione del punteggio e segnalazione dell'eliminazione all'avversario (killedIds)
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
                this.pendingKilledIds.push(invader.id);
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

    // 1v1: la propria navicella si muove/disegna SOLO se pilotabile in questo momento (non in
    // respawn, non fuori gioco) - durante il resto del tempo resta semplicemente assente dal
    // frame (il canvas e' comunque ripulito ad ogni giro, vedi cima del metodo).
    if (!this.game.respawning && !this.game.eliminated) {
      this.localPlayer.velocity.x = 0;
      this.localPlayer.velocity.y = 0;

      if (this.keys.a.pressed) {
        this.localPlayer.velocity.x = -7;
        this.localPlayer.rotation = -0.15;
      } else if (this.keys.d.pressed) {
        this.localPlayer.velocity.x = 7;
        this.localPlayer.rotation = 0.15;
      } else {
        this.localPlayer.rotation = 0;
      }

      if (this.keys.w.pressed) {
        this.localPlayer.velocity.y = -3;
      }

      if (this.keys.s.pressed) {
        this.localPlayer.velocity.y = 3;
      }

      this.localPlayer.update();
    }

    // Navicella e proiettili dell'avversario: nessuna simulazione, si disegnano cosi' come
    // arrivati nell'ultimo GameSnapshot (vedi applyRemoteSnapshot).
    this.drawRemotePlayer();
    this.drawRemoteProjectiles();

    //ogni tot frame, in modo casuale, creo una nuova griglia di invasori e la aggiungo all'array delle griglie, così da far apparire
    // nuovi invasori
    if (this.gameConfig.scriptedWaves && this.gameConfig.scriptedWaves.length > 0) {
      const nextWave = this.gameConfig.scriptedWaves[this.nextScriptedWaveIndex];
      if (nextWave && this.grids.length === 0 && this.scriptedClock >= nextWave.minStartFrame) {
        const grid = new Grid(this.ctx, this.canvas, {
          gridColumnsMin: nextWave.columns,
          gridColumnsMax: nextWave.columns,
          gridRowsMin: nextWave.rows,
          gridRowsMax: nextWave.rows,
        });
        grid.canShoot = nextWave.canShoot;
        this.grids.push(grid);
        if (nextWave.spawnAsteroid) {
          this.asteroids.push(
            new Asteroid(this.ctx, this.canvas, {
              target: {
                x: this.localPlayer.position.x + this.localPlayer.width / 2,
                y: this.localPlayer.position.y + this.localPlayer.height / 2,
              },
            }),
          );
        }
        this.nextScriptedWaveIndex += 1;
      }
    } else if (this.frames > 0 && this.frames % this.randomInterval === 0) {
      this.grids.push(new Grid(this.ctx, this.canvas, this.gameConfig));
      this.randomInterval = randomIntervalIn(
        this.gameConfig.gridSpawnIntervalFramesMin,
        this.gameConfig.gridSpawnIntervalFramesMax,
      );
      this.frames = 0;
    }

    // TESTBED: asteroidi scriptati, indipendenti dall'eventuale spawner casuale sopra.
    if (this.gameConfig.scriptedAsteroids) {
      const nextAsteroidEvent = this.gameConfig.scriptedAsteroids[this.nextScriptedAsteroidIndex];
      if (nextAsteroidEvent && this.scriptedClock >= nextAsteroidEvent.minStartFrame) {
        this.asteroids.push(
          new Asteroid(this.ctx, this.canvas, {
            target: {
              x: this.localPlayer.position.x + this.localPlayer.width / 2,
              y: this.localPlayer.position.y + this.localPlayer.height / 2,
            },
          }),
        );
        this.nextScriptedAsteroidIndex += 1;
      }
    }
    this.scriptedClock += 1;

    //ogni tot frame, in modo casuale, creo un nuovo asteroide che si muove verso la propria navicella
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
            x: this.localPlayer.position.x + this.localPlayer.width / 2,
            y: this.localPlayer.position.y + this.localPlayer.height / 2,
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
