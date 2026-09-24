import type { GameSnapshot } from "../../webrtc/snapshot";
import { NETWORK_TICK_HZ, LIVES_PER_PLAYER, RESPAWN_DELAY_MS, RESPAWN_INVULNERABILITY_MS, TESTBED_LIVES_PER_PLAYER } from "../../config";
import { Player } from "./entities/Player";
import { Projectile } from "./entities/Projectile";
import { Particle } from "./entities/Particle";
import { ArenaEntityRenderer } from "./entities/ArenaEntities";
import type { ArenaMatchResult, ArenaSnapshot } from "../../arena/arenaClient";
import {
  MATCH_OUTCOME_LABEL,
  type KeysState,
  type LocalGameOptions,
  type MatchOutcome,
  type MatchResult,
  type Vec2,
} from "./types";

// 1v1: frazione orizzontale del canvas in cui compaiono/respawnano le due navicelle - separate
// cosi' non nascono sovrapposte nell'arena condivisa (Player.ts accetta ora un "spawnXFraction"
// opzionale apposta per questo, di default 0.5 = comportamento originale invariato per qualunque
// altro chiamante che non lo passa).
const LOCAL_SPAWN_X_FRACTION = 0.35;
const REMOTE_SPAWN_X_FRACTION = 0.65;

// 1v1: colore dei proiettili dell'avversario, disegnati direttamente qui (arrivano gia' calcolati
// nello snapshot P2P cosmetico - vedi applyRemoteSnapshot) - blu per restare coerenti con la
// navicella avversaria (vedi drawRemotePlayer), contro il rosso "#ff4d4d" dei propri proiettili
// (Projectile.ts, invariato).
const REMOTE_PROJECTILE_COLOR = "#4da6ff";

// TESTBED 1v1: colori della schermata finale per ciascun esito (DRAW in argento).
const TESTBED_OUTCOME_COLORS: Record<MatchOutcome, { fill: string; glow: string }> = {
  win: { fill: "#66ff99", glow: "#66ff99" },
  lose: { fill: "#ff5c5c", glow: "#ff5c5c" },
  draw: { fill: "#c0c0c0", glow: "#f2f2f2" },
};

function outcomeByScore(localScore: number, remoteScore: number): MatchOutcome {
  if (localScore > remoteScore) return "win";
  if (localScore < remoteScore) return "lose";
  return "draw";
}

// TESTBED 1v1: riga di spiegazione sotto l'esito nella schermata finale.
function describeTestbedOutcome(result: MatchResult): string {
  if (result.decidedBy === "eliminationOrder") {
    if (result.outcome === "win") return "L'avversario e' stato eliminato per primo";
    if (result.outcome === "lose") return "Sei stato eliminato per primo";
    return "Eliminati nello stesso istante";
  }
  if (result.decidedBy === "survival") {
    return result.outcome === "win"
      ? "Sei l'unico sopravvissuto"
      : "L'avversario e' l'unico sopravvissuto";
  }
  if (result.outcome === "win") return "Entrambi sopravvissuti: punteggio piu' alto";
  if (result.outcome === "lose") return "Entrambi sopravvissuti: punteggio piu' basso";
  return "Entrambi sopravvissuti: stesso punteggio";
}

//Classe LocalGameEngine gestisce il disegno dell'arena condivisa (invasori/asteroidi/proiettili
//nemici, punteggio, vite, fine partita - tutto DECISO dal server dell'arena, vedi
//arena/arenaClient.ts e arena-server/simulation.js) e le DUE navicelle nello stesso canvas: quella
//locale (pilotata da tastiera, fisica reale, il cui stato viene mandato al server per le
//collisioni) e quella remota (nessuna fisica locale, disegnata alla posizione ricevuta
//nell'ultimo GameSnapshot P2P cosmetico dall'avversario - vedi applyRemoteSnapshot).
//
// 1v1 - server autoritativo: rispetto alla versione precedente (due client che simulavano in
// locale, in modo identico, l'INTERA arena condivisa a partire da un seed pseudo-casuale comune),
// questo motore non possiede piu' alcuna copia dell'arena: si limita a disegnare l'ultimo
// ArenaSnapshot ricevuto (vedi applyArenaSnapshot) e a inoltrare al server la posizione della
// propria navicella e i propri colpi (vedi sendArenaState/sendArenaFire in LocalGameOptions). Il
// vantaggio, oltre a togliere di mezzo il seed condiviso contestato dal tutor, e' che gran parte
// della logica di gioco che prima viveva qui (spawn di ondate/asteroidi, collisioni, punteggio,
// regole di fine partita) e' semplicemente SPARITA da questo file: vive ora in un unico posto,
// arena-server/simulation.js, invece che duplicata (e tenuta sincronizzata a mano) su due client.
export class LocalGameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly username: string;
  private onSnapshot: (snapshot: GameSnapshot) => void;
  private readonly sendArenaState: (state: { x: number; y: number; width: number; height: number }) => void;
  private readonly sendArenaFire: (shot: { id: string; x: number; y: number; vx: number; vy: number; radius: number }) => void;
  private onScoreChange?: (score: number) => void;
  private onLivesChange?: (lives: number) => void;
  private onMatchEnd?: (result: MatchResult) => void;
  private onTimeRemaining?: (msRemaining: number) => void;
  private onBeforeFrame?: (frame: number) => void;

  private localPlayer: Player;
  private remotePlayer: Player;
  // 1v1: true dopo il primo GameSnapshot P2P ricevuto dall'avversario - prima di allora non c'e'
  // nulla di reale da disegnare per la navicella remota.
  private remoteHasData = false;
  // 1v1: proiettili dell'avversario, presi cosi' come sono nell'ultimo snapshot P2P ricevuto
  // (nessuna simulazione locale, nessuna interpolazione - stesso limite gia' presente da sempre).
  private remoteProjectiles: GameSnapshot["projectiles"] = [];

  // Proiettili e particelle: SOLO della propria navicella/dei propri eventi locali (id da nextId,
  // vedi id.ts) - puramente cosmetici, il server decide da solo se e quando un colpo ha effetto
  // (vedi sendArenaFire). L'arena condivisa vera e propria (invasori/asteroidi/proiettili nemici)
  // e' un semplice render cache alimentato dal server - vedi ArenaEntityRenderer.
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private readonly arenaRenderer: ArenaEntityRenderer;

  private keys: KeysState = {
    a: { pressed: false },
    d: { pressed: false },
    w: { pressed: false },
    s: { pressed: false },
    space: { pressed: false },
  };

  private networkIntervalId: number | null = null;
  // Contatore di frame puramente LOCALE (a differenza del vecchio "scriptedClock", che doveva
  // avanzare in modo identico sui due client perche' scandiva anche lo spawn dell'arena
  // condivisa): serve solo a guidare gli input scriptati del testbed (onBeforeFrame, vedi
  // testbed/scenarioPlayer.ts), che restano una responsabilita' di QUESTO client.
  private frames = 0;

  // 1v1: stato della PROPRIA navicella - vedi GameFlags in types.ts. Punteggio/vite/eliminazione
  // sono ora un riflesso di quanto comunicato dal server in ogni ArenaSnapshot (vedi
  // applyArenaSnapshot), non piu' calcolati qui.
  private game = { respawning: false, eliminated: false };
  private score = 0;
  private lives: number;
  // 1v1: ultimo valore di "vite" noto dal server per la propria navicella - confrontato con quello
  // nuovo ad ogni ArenaSnapshot per accorgersi di un colpo subito e avviare l'animazione cosmetica
  // di respawn (vedi applyOwnArenaState()). Puramente cosmetico: la vulnerabilita' reale e' decisa
  // dal server indipendentemente da questa animazione.
  private lastKnownLives: number;
  private remoteScore = 0;
  private remoteLives: number;
  // 1v1: timestamp (performance.now()) fino al quale la propria navicella e' invulnerabile dopo un
  // respawn - vedi respawnLocalPlayer()/RESPAWN_INVULNERABILITY_MS. Solo cosmetico (vedi sopra).
  private invulnerableUntilMs = 0;
  private matchEndNotified = false;
  private lastShownRemainingSec = -1;

  // Regole di partita applicate da questo motore (vedi MatchMode in types.ts): "timed" per la
  // partita manuale, "testbed" per quella automatica. In entrambi i casi la fine partita e'
  // decisa dal server dell'arena (vedi matchResult sotto).
  private readonly matchMode: "timed" | "testbed";

  // Esito autoritativo ricevuto dal server (arena/arenaClient.ts, evento matchEnd) - null finche'
  // la partita e' in corso. Una volta impostato il motore non disegna piu' altro che la schermata
  // finale (vedi animate()).
  private matchResult: MatchResult | null = null;

  private gameLoopIntervalId: number | null = null;
  private static readonly FRAME_MS = 1000 / 60;
  // Limite di frame "di recupero" per singola chiamata di tick(), per evitare che una tab rimasta
  // sospesa a lungo (es. minimizzata per minuti) provochi un tentativo di eseguire migliaia di
  // frame in un colpo solo e blocchi la pagina. A differenza della vecchia architettura P2P, qui
  // scartare frame di recupero NON puo' piu' far divergere l'arena condivisa tra i due client:
  // l'unica fonte di verita' e' il server, che continua a girare al proprio ritmo indipendentemente
  // da quanti frame QUESTO client riesce a renderizzare - l'unico effetto di questo limite e' un
  // rendering locale un po' piu' "a scatti" dopo una lunga sospensione, mai un risultato diverso.
  private static readonly MAX_CATCH_UP_FRAMES = 10;
  private frameAccumulatorMs = 0;
  private lastTickAtMs: number | null = null;
  private destroyed = false;
  private scoreEl: HTMLElement | null = null;
  private livesEl: HTMLElement | null = null;
  private remoteScoreEl: HTMLElement | null = null;
  private remoteLivesEl: HTMLElement | null = null;

  constructor(options: LocalGameOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");

    this.ctx = ctx;
    this.username = options.username;
    this.onSnapshot = options.onSnapshot;
    this.sendArenaState = options.sendArenaState;
    this.sendArenaFire = options.sendArenaFire;
    this.onScoreChange = options.onScoreChange;
    this.onLivesChange = options.onLivesChange;
    this.onMatchEnd = options.onMatchEnd;
    this.onTimeRemaining = options.onTimeRemaining;
    this.onBeforeFrame = options.onBeforeFrame;

    // Nel testbed ogni navicella ha una sola vita (nessun respawn), nella partita manuale restano
    // LIVES_PER_PLAYER - valori di visualizzazione INIZIALE (vedi config.ts): il primo
    // ArenaSnapshot in arrivo dal server porta gia' i valori reali e li sovrascrive.
    this.matchMode = options.matchMode ?? "timed";
    const initialLives = this.matchMode === "testbed" ? TESTBED_LIVES_PER_PLAYER : LIVES_PER_PLAYER;
    this.lives = initialLives;
    this.lastKnownLives = initialLives;
    this.remoteLives = initialLives;

    // 1v1: due navicelle nello stesso canvas, separate orizzontalmente cosi' non nascono
    // sovrapposte (vedi LOCAL_SPAWN_X_FRACTION/REMOTE_SPAWN_X_FRACTION sopra).
    this.localPlayer = new Player(this.ctx, this.canvas, { spawnXFraction: LOCAL_SPAWN_X_FRACTION });
    this.remotePlayer = new Player(this.ctx, this.canvas, { spawnXFraction: REMOTE_SPAWN_X_FRACTION });
    this.arenaRenderer = new ArenaEntityRenderer(this.ctx, (kind, x, y) => {
      if (kind === "invader") {
        this.createParticles({ object: { position: { x, y }, width: 0, height: 0 }, color: "#c7c0e8", fades: true, count: 15 });
      } else {
        this.createAsteroidExplosionAt(x, y);
      }
    });

    this.scoreEl = document.querySelector("#localScoreEl");
    this.livesEl = document.querySelector("#localLivesEl");
    this.remoteScoreEl = document.querySelector("#remoteScoreEl");
    this.remoteLivesEl = document.querySelector("#remoteLivesEl");
    this.updateScoreUI();
    this.updateLivesUI();
    this.updateRemoteUI();
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

    if (framesRun >= LocalGameEngine.MAX_CATCH_UP_FRAMES) {
      this.frameAccumulatorMs = 0;
    }
  }

  //metodo per avviare il gioco, aggiungendo i listener per i tasti e avviando il ciclo di animazione.
  // Da chiamare SOLO dopo che il server dell'arena ha comunicato matchStart (vedi main.ts).
  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.lastTickAtMs = performance.now();
    this.gameLoopIntervalId = window.setInterval(this.tick, LocalGameEngine.FRAME_MS);

    //  Il publishing verso la rete gira su un timer indipendente da requestAnimationFrame: il
    // rendering locale resta a 60fps (setInterval), ma non ha senso (ed e' dannoso per
    // banda/backlog) pubblicare uno snapshot P2P o un aggiornamento di stato al server ad ogni
    // frame renderizzato.
    this.networkIntervalId = window.setInterval(() => {
      this.emitSnapshot();
      this.sendArenaState({
        x: this.localPlayer.position.x,
        y: this.localPlayer.position.y,
        width: this.localPlayer.width,
        height: this.localPlayer.height,
      });
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

  // 1v1: aggiorna direttamente l'HUD dell'avversario (score/vite) - prima viaggiavano nello
  // snapshot P2P cosmetico, ora vengono letti dall'ArenaSnapshot (identico per costruzione sui due
  // client, vedi applyArenaSnapshot), quindi il motore se li gestisce da solo esattamente come gia'
  // faceva per i propri.
  private updateRemoteUI(): void {
    if (this.remoteScoreEl) this.remoteScoreEl.textContent = String(this.remoteScore);
    if (this.remoteLivesEl) this.remoteLivesEl.textContent = String(Math.max(0, this.remoteLives));
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

  private createAsteroidExplosionAt(x: number, y: number): void {
    for (let i = 0; i < 24; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: { x, y },
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

  // 1v1: sostituisce la vecchia loseLife() - non decrementa piu' nulla (le vite sono decise dal
  // server, vedi applyOwnArenaState()), si limita ad avviare l'animazione cosmetica: la navicella
  // sparisce per RESPAWN_DELAY_MS e poi ricompare con una breve invulnerabilita' visiva.
  private triggerCosmeticRespawnCycle(): void {
    this.game.respawning = true;
    this.localPlayer.opacity = 0;
    this.createParticles({
      object: this.localPlayer,
      color: "#ffffff",
      fades: true,
      count: 30,
    });

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

  // Schermata di fine partita, unica per entrambe le modalita' (prima erano due disegni separati:
  // drawMatchEnd per il timer scaduto e drawTestbedMatchEnd per l'esito del testbed - con un solo
  // server autoritativo che decide la fine in ENTRAMBI i casi, la differenza si riduce al solo
  // titolo mostrato).
  private drawMatchEndScreen(result: MatchResult): void {
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    this.ctx.save();
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    if (result.mode === "timed") {
      let outcome = "PAREGGIO";
      let outcomeColor = "#ffffff";
      if (result.outcome === "win") {
        outcome = "HAI VINTO!";
        outcomeColor = "#66ff99";
      } else if (result.outcome === "lose") {
        outcome = "HAI PERSO";
        outcomeColor = "#ff6666";
      }

      this.ctx.shadowColor = "#ff00ff";
      this.ctx.shadowBlur = 22;
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = "bold 56px Impact, sans-serif";
      this.ctx.fillText("TEMPO SCADUTO", centerX, centerY - 90);

      this.ctx.shadowColor = outcomeColor;
      this.ctx.shadowBlur = 20;
      this.ctx.fillStyle = outcomeColor;
      this.ctx.font = "bold 40px Impact, sans-serif";
      this.ctx.fillText(outcome, centerX, centerY - 30);

      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = "#ff8080";
      this.ctx.font = '18px "Press Start 2P", monospace';
      this.ctx.fillText(`TU: ${result.localScore}`, centerX, centerY + 30);
      this.ctx.fillStyle = "#80c2ff";
      this.ctx.fillText(`AVVERSARIO: ${result.remoteScore}`, centerX, centerY + 62);
    } else {
      const colors = TESTBED_OUTCOME_COLORS[result.outcome];

      this.ctx.shadowColor = colors.glow;
      this.ctx.shadowBlur = 24;
      this.ctx.fillStyle = colors.fill;
      this.ctx.font = "bold 72px Impact, sans-serif";
      this.ctx.fillText(MATCH_OUTCOME_LABEL[result.outcome], centerX, centerY - 80);

      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = '14px "Press Start 2P", monospace';
      this.ctx.fillText(describeTestbedOutcome(result), centerX, centerY - 10);

      this.ctx.font = '18px "Press Start 2P", monospace';
      this.ctx.fillStyle = "#ff8080";
      this.ctx.fillText(`TU: ${result.localScore}`, centerX, centerY + 40);
      this.ctx.fillStyle = "#80c2ff";
      this.ctx.fillText(`AVVERSARIO: ${result.remoteScore}`, centerX, centerY + 72);
    }

    this.ctx.restore();
  }

  // TESTBED 1v1: avviso per chi e' gia' stato eliminato mentre l'avversario continua a giocare. La
  // schermata finale compare solo quando il server comunica matchEnd per entrambi.
  private drawEliminatedNotice(): void {
    this.ctx.save();
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    const noticeY = this.canvas.height * 0.33;
    this.ctx.fillStyle = "rgba(255, 92, 92, 0.9)";
    this.ctx.font = '16px "Press Start 2P", monospace';
    this.ctx.fillText("SEI STATO ELIMINATO", this.canvas.width / 2, noticeY);
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    this.ctx.font = '10px "Press Start 2P", monospace';
    this.ctx.fillText("la partita prosegue per l'avversario", this.canvas.width / 2, noticeY + 26);
    this.ctx.restore();
  }

  //Metodo per emettere uno snapshot P2P COSMETICO della PROPRIA navicella/dei propri proiettili -
  //il campo condiviso (griglie/asteroidi/proiettili nemici) e punteggio/vite/esito NON viaggiano
  //piu' qui: sono decisi dal server dell'arena (vedi arena/arenaClient.ts) e arrivano identici a
  //entrambi i client, non c'e' piu' nulla da riconciliare via rete P2P.
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
    };

    this.onSnapshot(snapshot);
  }

  //  1v1: applica l'ultimo GameSnapshot P2P COSMETICO ricevuto dall'avversario - aggiorna solo la
  // navicella remota (nessuna fisica locale, si disegna direttamente alla posizione ricevuta) e i
  // suoi proiettili in volo. Punteggio/vite/eliminazione dell'avversario arrivano invece
  // dall'ArenaSnapshot del server (vedi applyArenaSnapshot), identici per entrambi i client.
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
  }

  // 1v1: applica l'ultimo ArenaSnapshot ricevuto dal server dell'arena (vedi
  // arena/arenaClient.ts) - aggiorna il render cache delle entita' condivise, il proprio
  // punteggio/vite/eliminazione (con la relativa animazione cosmetica di respawn), l'HUD
  // dell'avversario e il tempo rimanente di partita.
  applyArenaSnapshot(snapshot: ArenaSnapshot): void {
    this.arenaRenderer.sync(snapshot.invaders, snapshot.asteroids, snapshot.invaderProjectiles);

    const mine = snapshot.players[this.username];
    if (mine) this.applyOwnArenaState(mine);

    const otherEntry = Object.entries(snapshot.players).find(([name]) => name !== this.username);
    if (otherEntry) {
      const [, other] = otherEntry;
      this.remoteScore = other.score;
      this.remoteLives = other.lives;
      this.updateRemoteUI();
    }

    if (snapshot.remainingMs !== null) {
      const remainingSec = Math.ceil(snapshot.remainingMs / 1000);
      if (remainingSec !== this.lastShownRemainingSec) {
        this.lastShownRemainingSec = remainingSec;
        this.onTimeRemaining?.(snapshot.remainingMs);
      }
    }
  }

  private applyOwnArenaState(mine: { score: number; lives: number; eliminated: boolean }): void {
    if (mine.score !== this.score) {
      this.score = mine.score;
      this.updateScoreUI();
    }

    if (mine.eliminated && !this.game.eliminated) {
      this.game.eliminated = true;
      this.game.respawning = false;
      this.localPlayer.opacity = 0;
      this.createParticles({ object: this.localPlayer, color: "#ffffff", fades: true, count: 30 });
    } else if (!mine.eliminated && mine.lives < this.lastKnownLives && !this.game.respawning) {
      this.triggerCosmeticRespawnCycle();
    }

    this.lastKnownLives = mine.lives;
    this.lives = mine.lives;
    this.updateLivesUI();
  }

  // 1v1: applica l'esito autoritativo ricevuto dal server (arena/arenaClient.ts, evento
  // matchEnd) - identico per entrambi i client per costruzione, non c'e' piu' nulla da decidere
  // qui: ci si limita a riformattarlo dal punto di vista del giocatore locale (vedi MatchResult in
  // types.ts) per disegnarlo e per il report del testbed.
  applyArenaMatchEnd(result: ArenaMatchResult): void {
    if (this.matchResult) return;

    const mine = result.players.find((p) => p.username === this.username);
    const other = result.players.find((p) => p.username !== this.username);

    const mapped: MatchResult = {
      mode: result.mode,
      outcome: mine?.outcome ?? outcomeByScore(mine?.score ?? this.score, other?.score ?? this.remoteScore),
      endReason: result.endReason,
      decidedBy: result.decidedBy,
      localScore: mine?.score ?? this.score,
      remoteScore: other?.score ?? this.remoteScore,
      localEliminated: mine?.eliminated ?? this.game.eliminated,
      remoteEliminated: other?.eliminated ?? false,
      localEliminatedAtFrame: mine?.eliminatedAtFrame ?? null,
      remoteEliminatedAtFrame: other?.eliminatedAtFrame ?? null,
      lastWaveClearedAtFrame: result.lastWaveClearedAtFrame,
      endFrame: result.endFrame,
      finalPositionX: mine?.finalPositionX ?? this.localPlayer.position.x,
      finalPositionY: mine?.finalPositionY ?? this.localPlayer.position.y,
    };

    this.matchResult = mapped;

    if (!this.matchEndNotified) {
      this.matchEndNotified = true;
      this.onMatchEnd?.(mapped);
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // 1v1: navicella non pilotabile mentre e' in respawn, fuori gioco o a partita conclusa.
    if (this.game.respawning || this.game.eliminated || this.matchResult) return;

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
          const projectile = new Projectile(this.ctx, {
            position: {
              x: this.localPlayer.position.x + this.localPlayer.width / 2,
              y: this.localPlayer.position.y - 5,
            },
            velocity: {
              x: 0,
              y: -10,
            },
          });
          this.projectiles.push(projectile);
          // 1v1: il colpo viene inviato SUBITO al server, che ne simula per intero traiettoria e
          // collisioni (vedi arena-server/simulation.js) - il client continua a disegnarlo in
          // locale in modo puramente cosmetico (vedi animate()), senza attendere conferma.
          this.sendArenaFire({
            id: projectile.id,
            x: projectile.position.x,
            y: projectile.position.y,
            vx: projectile.velocity.x,
            vy: projectile.velocity.y,
            radius: projectile.radius,
          });
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
    // Nessuna fisica: la navicella remota si disegna esattamente dove l'ultimo snapshot P2P dice
    // che si trova (vedi applyRemoteSnapshot).
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

    // TESTBED: input scriptati del frame che sta per essere simulato (vedi LocalGameOptions) -
    // guidati da un contatore puramente locale (vedi il commento su "frames" in cima al file).
    this.onBeforeFrame?.(this.frames);

    //fill dello sfondo di nero ad ogni frame per cancellare il disegno precedente e ridisegnare tutto da capo, così da creare
    //l'illusione del movimento
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 1v1: a partita conclusa (esito ricevuto dal server) non si disegna altro che la schermata
    // finale - stesso comportamento di sempre, ora unificato tra le due modalita' (vedi
    // drawMatchEndScreen()).
    if (this.matchResult) {
      this.drawMatchEndScreen(this.matchResult);
      this.frames += 1;
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

    //ciclo inverso per iterare sui propri proiettili, aggiornare il loro stato e rimuovere quelli usciti dallo schermo. Le
    //collisioni con invasori/asteroidi sono decise dal server (vedi sendArenaFire): qui il proiettile continua semplicemente
    //a volare in linea retta, in modo puramente cosmetico, finche' non esce dal bordo superiore.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];

      if (projectile.position.y + projectile.radius <= 0) {
        this.projectiles.splice(i, 1);
      } else {
        projectile.update();
      }
    }

    // 1v1: la propria navicella si muove/disegna SOLO se pilotabile in questo momento (non in
    // respawn, non fuori gioco).
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
    // arrivati nell'ultimo GameSnapshot P2P (vedi applyRemoteSnapshot).
    this.drawRemotePlayer();
    this.drawRemoteProjectiles();

    // Arena condivisa (invasori/asteroidi/proiettili nemici): render cache alimentato dall'ultimo
    // ArenaSnapshot del server (vedi applyArenaSnapshot) - nessuno spawn/collisione/movimento
    // deciso qui.
    this.arenaRenderer.draw();

    if (this.matchMode === "testbed" && this.game.eliminated) {
      this.drawEliminatedNotice();
    }

    this.frames += 1;
  }
}
