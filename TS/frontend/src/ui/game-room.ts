import type { GameSnapshot } from "../moq/publisher";
import { createLocalGame, type LocalGameHandle } from "../game/localGame";
import {
  MATCH_OUTCOME_LABEL,
  type GameDifficultyConfig,
  type MatchMode,
  type MatchResult,
} from "../game/localGame/types";
import { exportJSON, exportCSV } from "../metrics/metrics";
import { TESTBED_LIVES_PER_PLAYER } from "../config";

// 1v1: un'unica arena condivisa (un solo canvas) al posto dei due pannelli "IL TUO GIOCO" /
// "GIOCO AVVERSARIO" della versione a specchio: la navicella locale (rossa) e quella
// dell'avversario (blu) vengono ora disegnate insieme dallo stesso LocalGameEngine - vedi
// game/localGame/LocalGameEngine.ts. Questo file resta responsabile solo di: costruire il DOM
// attorno al canvas, il badge/HUD (punteggio, vite, timer) e inoltrare gli aggiornamenti di rete
// dell'avversario al motore.
type GameRoomHandlers = {
  onLeave: () => void;
};

let rootEl: HTMLDivElement | null = null;
let arenaCanvas: HTMLCanvasElement | null = null;
let arenaCtx: CanvasRenderingContext2D | null = null;

let statusEl: HTMLDivElement | null = null;
let remoteNameEl: HTMLSpanElement | null = null;
let roomEl: HTMLSpanElement | null = null;
let localNameEl: HTMLSpanElement | null = null;
let remoteScoreEl: HTMLElement | null = null;
let remoteLivesEl: HTMLElement | null = null;
let timerEl: HTMLElement | null = null;

let currentUsers: string[] = [];
let localGame: LocalGameHandle | null = null;

export function renderGameRoom(
  username: string,
  room: string,
  handlers: GameRoomHandlers,
): void {
  cleanup();

  document.body.innerHTML = "";
  injectStyles();

  rootEl = document.createElement("div");
  rootEl.className = "game-room";

  rootEl.innerHTML = `
    <div class="topbar">
      <div class="topbar__left">
        <div class="badge">ROOM: <span id="roomLabel"></span></div>
        <div class="badge">TU: <span id="localPlayerLabel"></span></div>
        <div class="badge">AVVERSARIO: <span id="remotePlayerLabel">---</span></div>
      </div>

      <button id="metricsBtn" class="leave-btn">ESPORTA METRICHE</button>
      <button id="leaveBtn" class="leave-btn">ESCI</button>
    </div>

    <div class="status-banner" id="statusBanner">
      In attesa di un altro player...
    </div>

    <div class="arena-layout">
      <div class="canvas-shell">
        <div class="score-chip score-chip--local">
          <span class="chip-label">TU</span>
          Score: <span id="localScoreEl">0</span> &middot; Vite: <span id="localLivesEl">3</span>
        </div>
        <div class="score-chip score-chip--remote">
          <span class="chip-label">AVVERSARIO</span>
          Score: <span id="remoteScoreEl">0</span> &middot; Vite: <span id="remoteLivesEl">3</span>
        </div>
        <div class="timer-chip" id="matchTimerEl">--:--</div>
        <canvas id="arenaCanvas" width="1024" height="576"></canvas>
      </div>
    </div>
  `;

  document.body.appendChild(rootEl);

  roomEl = document.querySelector("#roomLabel");
  localNameEl = document.querySelector("#localPlayerLabel");
  remoteNameEl = document.querySelector("#remotePlayerLabel");
  statusEl = document.querySelector("#statusBanner");
  remoteScoreEl = document.querySelector("#remoteScoreEl");
  remoteLivesEl = document.querySelector("#remoteLivesEl");
  timerEl = document.querySelector("#matchTimerEl");

  arenaCanvas = document.querySelector("#arenaCanvas");
  arenaCtx = arenaCanvas?.getContext("2d") ?? null;

  if (roomEl) roomEl.textContent = room;
  if (localNameEl) localNameEl.textContent = username;

  const leaveBtn = document.querySelector("#leaveBtn");
  leaveBtn?.addEventListener("click", () => {
    cleanup();
    handlers.onLeave();
  });

  const metricsBtn = document.querySelector("#metricsBtn");
  metricsBtn?.addEventListener("click", () => {
    exportJSON();
    exportCSV();
  });

  drawWaitingScreen();
}

export function updatePresence(users: string[]): void {
  currentUsers = users;

  const remoteUsername = users[0] ?? "";

  if (remoteNameEl) {
    remoteNameEl.textContent = remoteUsername || "---";
  }

  if (!statusEl) return;

  if (users.length === 0) {
    statusEl.textContent = "In attesa di un altro player...";
    statusEl.style.display = "flex";
    return;
  }

  // 1v1: la partita vera e propria parte solo dopo l'handshake seed/istante condiviso (vedi
  // main.ts) - questo banner segnala solo la presenza dell'avversario nella room, non l'inizio
  // effettivo del motore (che avviene poco dopo, tramite startLocalMatch()).
  statusEl.textContent = `Connesso con ${remoteUsername}. Avvio partita...`;
  statusEl.style.display = "flex";

  window.setTimeout(() => {
    if (statusEl && currentUsers.length > 0) {
      statusEl.style.display = "none";
    }
  }, 2200);
}

// Opzioni di startLocalMatch: "mode" sceglie le regole di partita (assente = partita manuale,
// "testbed" = partita automatica, vedi MatchMode), "onMatchEnd" riceve l'esito a fine partita,
// "onBeforeFrame" viene chiamata all'inizio di ogni frame simulato (input scriptati del testbed).
export type StartLocalMatchOptions = {
  mode?: MatchMode;
  onMatchEnd?: (result: MatchResult) => void;
  onBeforeFrame?: (frame: number) => void;
};

// 1v1: monta il motore di gioco locale sul canvas condiviso - va chiamato SOLO dopo l'handshake
// di inizio partita (seed deterministico installato, istante di partenza raggiunto), vedi
// main.ts. Prima di questo momento l'arena mostra solo lo schermo di attesa.
export function startLocalMatch(
  onSnapshot: (snapshot: GameSnapshot) => void,
  gameConfig?: GameDifficultyConfig,
  options: StartLocalMatchOptions = {},
): void {
  if (!arenaCanvas) return;

  const mode = options.mode ?? "timed";

  // TESTBED 1v1: niente timer di partita e una sola vita per navicella (vedi LocalGameEngine),
  // quindi il countdown non si mostra e i contatori delle vite partono da 1.
  if (mode === "testbed") {
    if (timerEl) timerEl.style.display = "none";
    const localLivesEl = document.querySelector("#localLivesEl");
    if (localLivesEl) localLivesEl.textContent = String(TESTBED_LIVES_PER_PLAYER);
    if (remoteLivesEl) remoteLivesEl.textContent = String(TESTBED_LIVES_PER_PLAYER);
  }

  localGame?.destroy();
  localGame = createLocalGame(arenaCanvas, onSnapshot, undefined, gameConfig, {
    matchMode: mode,
    onBeforeFrame: options.onBeforeFrame,
    onLivesChange: (lives) => {
      const el = document.querySelector("#localLivesEl");
      if (el) el.textContent = String(Math.max(0, lives));
    },
    onTimeRemaining: (msRemaining) => {
      if (timerEl) timerEl.textContent = formatTime(msRemaining);
    },
    onMatchEnd: (result) => {
      if (statusEl) {
        statusEl.textContent =
          mode === "testbed"
            ? `Partita terminata: ${MATCH_OUTCOME_LABEL[result.outcome]}`
            : "Partita terminata.";
        statusEl.style.display = "flex";
      }
      options.onMatchEnd?.(result);
    },
  });
  // onScoreChange e' gestito internamente dal motore su #localScoreEl (vedi
  // LocalGameEngine.updateScoreUI) - qui non serve passarlo di nuovo.
}

export function updateRemoteGame(
  remoteUsername: string,
  snapshot: GameSnapshot,
): void {
  if (remoteNameEl) {
    remoteNameEl.textContent = remoteUsername;
  }

  if (remoteScoreEl) {
    remoteScoreEl.textContent = String(snapshot.score ?? 0);
  }
  if (remoteLivesEl) {
    remoteLivesEl.textContent = String(Math.max(0, snapshot.lives ?? 0));
  }

  // Il motore gestisce il rendering della navicella/proiettili dell'avversario e la
  // riconciliazione delle eliminazioni condivise (killedIds) - vedi applyRemoteSnapshot() in
  // LocalGameEngine.ts.
  localGame?.applyRemoteSnapshot(snapshot);
}

function formatTime(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function drawWaitingScreen(): void {
  if (!arenaCtx || !arenaCanvas) return;

  arenaCtx.fillStyle = "black";
  arenaCtx.fillRect(0, 0, arenaCanvas.width, arenaCanvas.height);

  drawStars(arenaCtx, arenaCanvas.width, arenaCanvas.height, 120);

  arenaCtx.fillStyle = "#00ffff";
  arenaCtx.font = '20px "Press Start 2P", monospace';
  arenaCtx.textAlign = "center";
  arenaCtx.fillText(
    "IN ATTESA DI UN AVVERSARIO",
    arenaCanvas.width / 2,
    arenaCanvas.height / 2 - 10,
  );

  arenaCtx.fillStyle = "#ffffff";
  arenaCtx.font = '12px "Press Start 2P", monospace';
  arenaCtx.fillText(
    "la partita 1v1 iniziera' appena si connette",
    arenaCanvas.width / 2,
    arenaCanvas.height / 2 + 30,
  );
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = (i * 127) % width;
    const y = (i * 89) % height;
    const r = (i % 3) + 1;

    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.closePath();
  }
}

function cleanup(): void {
  localGame?.destroy();
  localGame = null;
  const style = document.querySelector("#game-room-styles");
  style?.remove();
  currentUsers = [];
  rootEl = null;
  arenaCanvas = null;
  arenaCtx = null;
  statusEl = null;
  remoteNameEl = null;
  roomEl = null;
  localNameEl = null;
  remoteScoreEl = null;
  remoteLivesEl = null;
  timerEl = null;
}

function injectStyles(): void {
  if (document.querySelector("#game-room-styles")) return;

  const style = document.createElement("style");
  style.id = "game-room-styles";
  style.textContent = `
    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #000;
      color: white;
      font-family: "Press Start 2P", monospace;
      overflow: hidden;
    }

    .game-room {
      width: 100vw;
      height: 100vh;
      background:
        radial-gradient(circle at top, rgba(255,0,255,0.08), transparent 30%),
        radial-gradient(circle at bottom, rgba(0,255,255,0.06), transparent 30%),
        #000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 56px;
      padding: 8px 12px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.04);
    }

    .topbar__left {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .badge {
      font-size: 11px;
      line-height: 1.7;
      color: #e8ffff;
    }

    .leave-btn {
      border: 2px solid #ff4df8;
      background: transparent;
      color: white;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
    }

    .status-banner {
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00ffff;
      background: rgba(0,255,255,0.08);
      border: 1px solid rgba(0,255,255,0.3);
      font-size: 11px;
      text-align: center;
      padding: 0 12px;
    }

    .arena-layout {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .canvas-shell {
      position: relative;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;

      aspect-ratio: 1024 / 576;

      border: 1px solid rgba(255,255,255,0.15);
      background: #000;

      display: flex;
      align-items: center;
      justify-content: center;
    }

    .score-chip {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 2;
      font-size: 11px;
      line-height: 1.8;
      color: #ffb3b3;
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,120,120,0.4);
      padding: 8px 10px;
    }

    .score-chip--local .chip-label {
      color: #ff8080;
    }

    .score-chip--remote {
      left: auto;
      right: 10px;
      color: #b3d9ff;
      border-color: rgba(120,170,255,0.4);
    }

    .score-chip--remote .chip-label {
      color: #80c2ff;
    }

    .chip-label {
      display: block;
      font-size: 10px;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }

    .timer-chip {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      font-size: 14px;
      color: #ffffff;
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.25);
      padding: 8px 14px;
    }

    canvas {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
    }
  `;
  document.head.appendChild(style);
}
