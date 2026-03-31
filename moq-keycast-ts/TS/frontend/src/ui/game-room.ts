import type { GameSnapshot } from "../moq/publisher";
import { createLocalGame } from "../game/localGame";
import spaceshipImgSrc from "../image/spaceship.png";
import invaderImgSrc from "../image/invader.png";

const remotePlayerImage = new Image();
remotePlayerImage.src = spaceshipImgSrc;

const remoteInvaderImage = new Image();
remoteInvaderImage.src = invaderImgSrc;

type GameRoomHandlers = {
  onSnapshot: (snapshot: GameSnapshot) => void;
  onLeave: () => void;
};

type RemoteGameState = {
  username: string;
  snapshot: GameSnapshot | null;
};

let rootEl: HTMLDivElement | null = null;
let localCanvas: HTMLCanvasElement | null = null;
let remoteCanvas: HTMLCanvasElement | null = null;
let remoteCtx: CanvasRenderingContext2D | null = null;

let statusEl: HTMLDivElement | null = null;
let remoteNameEl: HTMLSpanElement | null = null;
let roomEl: HTMLSpanElement | null = null;
let localNameEl: HTMLSpanElement | null = null;

let currentRemote: RemoteGameState = {
  username: "",
  snapshot: null,
};

let currentUsers: string[] = [];
let destroyLocalGame: (() => void) | null = null;

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
        <div class="badge">ALTRO PLAYER: <span id="remotePlayerLabel">---</span></div>
      </div>

      <button id="leaveBtn" class="leave-btn">ESCI</button>
    </div>

    <div class="status-banner" id="statusBanner">
      In attesa di un altro player...
    </div>

    <div class="split-layout">
      <section class="screen-panel">
        <div class="screen-title">IL TUO GIOCO</div>
        <div class="canvas-shell">
          <div class="score-chip">Score: <span id="localScoreEl">0</span></div>
          <canvas id="localCanvas" width="1024" height="576"></canvas>
        </div>
      </section>

      <div class="divider"></div>

      <section class="screen-panel">
        <div class="screen-title">GIOCO AVVERSARIO</div>
        <div class="canvas-shell">
          <div class="score-chip score-chip--remote">Score: <span id="remoteScoreEl">0</span></div>
          <canvas id="remoteCanvas" width="1024" height="576"></canvas>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(rootEl);

  roomEl = document.querySelector("#roomLabel");
  localNameEl = document.querySelector("#localPlayerLabel");
  remoteNameEl = document.querySelector("#remotePlayerLabel");
  statusEl = document.querySelector("#statusBanner");

  localCanvas = document.querySelector("#localCanvas");
  remoteCanvas = document.querySelector("#remoteCanvas");
  remoteCtx = remoteCanvas?.getContext("2d") ?? null;

  if (roomEl) roomEl.textContent = room;
  if (localNameEl) localNameEl.textContent = username;

  const leaveBtn = document.querySelector("#leaveBtn");
  leaveBtn?.addEventListener("click", () => {
    cleanup();
    handlers.onLeave();
  });

  drawRemoteWaitingScreen();
  destroyLocalGame = mountLocalGame(localCanvas, handlers.onSnapshot);
}

export function updatePresence(users: string[]): void {
  currentUsers = users;

  const remoteUsername = users[0] ?? "";
  currentRemote.username = remoteUsername;

  if (remoteNameEl) {
    remoteNameEl.textContent = remoteUsername || "---";
  }

  if (!statusEl) return;

  if (users.length === 0) {
    statusEl.textContent = "In attesa di un altro player...";
    statusEl.style.display = "flex";
    drawRemoteWaitingScreen();
    return;
  }

  statusEl.textContent = `Connesso con ${remoteUsername}. Partita attiva.`;
  statusEl.style.display = "flex";

  window.setTimeout(() => {
    if (statusEl && currentUsers.length > 0) {
      statusEl.style.display = "none";
    }
  }, 1800);
}

export function updateRemoteGame(
  remoteUsername: string,
  snapshot: GameSnapshot,
): void {
  currentRemote = {
    username: remoteUsername,
    snapshot,
  };

  if (remoteNameEl) {
    remoteNameEl.textContent = remoteUsername;
  }

  const remoteScoreEl = document.querySelector("#remoteScoreEl");
  if (remoteScoreEl) {
    remoteScoreEl.textContent = String(snapshot.score ?? 0);
  }

  drawRemoteSnapshot(snapshot);
}

function drawRemoteWaitingScreen(): void {
  if (!remoteCtx || !remoteCanvas) return;

  remoteCtx.fillStyle = "black";
  remoteCtx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);

  drawStars(remoteCtx, remoteCanvas.width, remoteCanvas.height, 80);

  remoteCtx.fillStyle = "#00ffff";
  remoteCtx.font = '20px "Press Start 2P", monospace';
  remoteCtx.textAlign = "center";
  remoteCtx.fillText(
    "WAITING FOR PLAYER 2",
    remoteCanvas.width / 2,
    remoteCanvas.height / 2 - 10,
  );

  remoteCtx.fillStyle = "#ffffff";
  remoteCtx.font = '12px "Press Start 2P", monospace';
  remoteCtx.fillText(
    "la schermata remota apparira qui",
    remoteCanvas.width / 2,
    remoteCanvas.height / 2 + 30,
  );
}

function drawRemoteSnapshot(snapshot: GameSnapshot): void {
  if (!remoteCtx || !remoteCanvas) return;

  remoteCtx.fillStyle = "black";
  remoteCtx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);

  drawRemoteParticles(snapshot.particles);
  drawRemotePlayer(snapshot.player);
  drawRemoteProjectiles(snapshot.projectiles);
  drawRemoteInvaderProjectiles(snapshot.invaderProjectiles);
  drawRemoteGrids(snapshot.grids);
  drawRemoteAsteroids(snapshot.asteroids);

  if (snapshot.gameOver || !snapshot.gameActive) {
    drawRemoteGameOver(snapshot.score);
  }
}

function drawRemotePlayer(player: GameSnapshot["player"]): void {
  if (!remoteCtx) return;

  const width = player?.width ?? 60;
  const height = player?.height ?? 60;
  const x = player?.x ?? 0;
  const y = player?.y ?? 0;
  const rotation = player?.rotation ?? 0;
  const opacity = player?.opacity ?? 1;

  if (!remotePlayerImage.complete) return;

  remoteCtx.save();
  remoteCtx.globalAlpha = opacity;
  remoteCtx.translate(x + width / 2, y + height / 2);
  remoteCtx.rotate(rotation);
  remoteCtx.translate(-(x + width / 2), -(y + height / 2));

  remoteCtx.drawImage(remotePlayerImage, x, y, width, height);
  remoteCtx.restore();
}

function drawRemoteProjectiles(projectiles: GameSnapshot["projectiles"]): void {
  if (!remoteCtx || !Array.isArray(projectiles)) return;

  for (const projectile of projectiles) {
    remoteCtx.beginPath();
    remoteCtx.arc(
      projectile?.x ?? 0,
      projectile?.y ?? 0,
      projectile?.radius ?? 4,
      0,
      Math.PI * 2,
    );
    remoteCtx.fillStyle = "#ff4d4d";
    remoteCtx.fill();
    remoteCtx.closePath();
  }
}

function drawRemoteInvaderProjectiles(
  projectiles: GameSnapshot["invaderProjectiles"],
): void {
  if (!remoteCtx || !Array.isArray(projectiles)) return;

  for (const projectile of projectiles) {
    const x = projectile?.x ?? 0;
    const y = projectile?.y ?? 0;
    const width = projectile?.width ?? 4;
    const height = projectile?.height ?? 10;

    remoteCtx.fillStyle = "#ffffff";
    remoteCtx.fillRect(x, y, width, height);
  }
}

function drawRemoteGrids(grids: GameSnapshot["grids"]): void {
  if (!remoteCtx || !Array.isArray(grids)) return;

  for (const grid of grids) {
    if (!Array.isArray(grid.invaders)) continue;

    for (const invader of grid.invaders) {
      drawRemoteInvader(invader);
    }
  }
}

function drawRemoteInvader(invader: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  if (!remoteCtx) return;

  const x = invader?.x ?? 0;
  const y = invader?.y ?? 0;
  const width = invader?.width ?? 30;
  const height = invader?.height ?? 30;

  if (!remoteInvaderImage.complete) return;

  remoteCtx.drawImage(remoteInvaderImage, x, y, width, height);
}

function drawRemoteParticles(particles: GameSnapshot["particles"]): void {
  if (!remoteCtx || !Array.isArray(particles)) return;

  for (const particle of particles) {
    const opacity = particle?.opacity ?? 1;
    if (opacity <= 0) continue;

    remoteCtx.save();
    remoteCtx.globalAlpha = opacity;
    remoteCtx.beginPath();
    remoteCtx.arc(
      particle?.x ?? 0,
      particle?.y ?? 0,
      particle?.radius ?? 2,
      0,
      Math.PI * 2,
    );
    remoteCtx.fillStyle = particle?.color ?? "#ffffff";
    remoteCtx.fill();
    remoteCtx.closePath();
    remoteCtx.restore();
  }
}

function drawRemoteAsteroids(asteroids: GameSnapshot["asteroids"]): void {
  if (!remoteCtx || !Array.isArray(asteroids)) return;

  for (const asteroid of asteroids) {
    const x = asteroid?.x ?? 0;
    const y = asteroid?.y ?? 0;
    const radius = asteroid?.radius ?? 20;
    const rotation = asteroid?.rotation ?? 0;
    const points = Array.isArray(asteroid?.points) ? asteroid.points : [];

    remoteCtx.save();
    remoteCtx.translate(x, y);
    remoteCtx.rotate(rotation);

  if (points.length >= 3) {
  remoteCtx.beginPath();

  const firstX = points[0];
  const firstY = points[1];
  const firstR = points[2];
  remoteCtx.moveTo(firstX * firstR, firstY * firstR);

  for (let i = 3; i < points.length; i += 3) {
    const px = points[i];
    const py = points[i + 1];
    const pr = points[i + 2];
    remoteCtx.lineTo(px * pr, py * pr);
  }

  remoteCtx.closePath();
} else {
  remoteCtx.beginPath();
  remoteCtx.arc(0, 0, radius, 0, Math.PI * 2);
}

    remoteCtx.fillStyle = "#9f9f9f";
    remoteCtx.strokeStyle = "#d0d0d0";
    remoteCtx.lineWidth = 2;
    remoteCtx.fill();
    remoteCtx.stroke();

    remoteCtx.restore();

    drawAsteroidHealthBar(asteroid);
  }
}

function drawAsteroidHealthBar(
  asteroid: GameSnapshot["asteroids"][number],
): void {
  if (!remoteCtx) return;

  const x = asteroid?.x ?? 0;
  const y = asteroid?.y ?? 0;
  const radius = asteroid?.radius ?? 20;
  const health = Math.max(0, asteroid?.health ?? 0);
  const maxHealth = Math.max(1, asteroid?.maxHealth ?? 1);

  const width = radius * 1.8;
  const height = 5;
  const left = x - width / 2;
  const top = y - radius - 14;

  remoteCtx.fillStyle = "rgba(255,255,255,0.18)";
  remoteCtx.fillRect(left, top, width, height);

  remoteCtx.fillStyle = "#00ffff";
  remoteCtx.fillRect(left, top, width * (health / maxHealth), height);
}

function drawRemoteGameOver(score: number): void {
  if (!remoteCtx || !remoteCanvas) return;

  remoteCtx.save();
  remoteCtx.fillStyle = "rgba(0, 0, 0, 0.75)";
  remoteCtx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);

  remoteCtx.textAlign = "center";
  remoteCtx.textBaseline = "middle";

  remoteCtx.shadowColor = "#ff00ff";
  remoteCtx.shadowBlur = 24;
  remoteCtx.fillStyle = "#ffffff";
  remoteCtx.font = 'bold 72px Impact, sans-serif';
  remoteCtx.fillText(
    "GAME OVER",
    remoteCanvas.width / 2,
    remoteCanvas.height / 2 - 40,
  );

  remoteCtx.shadowColor = "#00ffff";
  remoteCtx.shadowBlur = 14;
  remoteCtx.fillStyle = "#00ffff";
  remoteCtx.font = '18px "Press Start 2P", monospace';
  remoteCtx.fillText(
    `SCORE: ${score}`,
    remoteCanvas.width / 2,
    remoteCanvas.height / 2 + 30,
  );

  remoteCtx.restore();
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

function mountLocalGame(
  canvas: HTMLCanvasElement | null,
  onSnapshot: (snapshot: GameSnapshot) => void,
): (() => void) | null {
  if (!canvas) return null;

  const scoreEl = document.querySelector("#localScoreEl") as HTMLElement | null;

  return createLocalGame(
    canvas,
    onSnapshot,
    (score) => {
      if (scoreEl) scoreEl.textContent = String(score);
    },
  );
}

function cleanup(): void {
  destroyLocalGame?.();
  destroyLocalGame = null;
const style = document.querySelector("#game-room-styles");
  style?.remove(); // 🔥 QUESTO RISOLVE
 currentRemote = { username: "", snapshot: null };
  currentUsers = [];
  rootEl = null;
  localCanvas = null;
  remoteCanvas = null;
  remoteCtx = null;
  statusEl = null;
  remoteNameEl = null;
  roomEl = null;
  localNameEl = null;
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

    .split-layout {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr 8px 1fr;
      gap: 12px;
      align-items: center;
    }

    .divider {
      background: linear-gradient(
        to bottom,
        transparent,
        rgba(255,255,255,0.65),
        transparent
      );
      opacity: 0.45;
      border-radius: 999px;
    }

    .screen-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  align-items: center;
  height: 100%;
}

    .screen-title {
      text-align: center;
      font-size: 12px;
      color: #ffffff;
      letter-spacing: 1px;
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
      font-size: 12px;
      color: white;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(255,255,255,0.18);
      padding: 8px 10px;
    }

    .score-chip--remote {
      left: auto;
      right: 10px;
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