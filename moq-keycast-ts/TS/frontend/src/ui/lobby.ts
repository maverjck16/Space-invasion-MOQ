//---AI--- lobby UI e gestione presenza utenti nella room

export function renderLobby(
  onJoin: (username: string, room: string) => void,
): void {
  document.body.innerHTML = `
    <div class="lobby-page">
      <div class="lobby-stars" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span><span></span>
      </div>

      <div class="lobby-glow lobby-glow--pink"></div>
      <div class="lobby-glow lobby-glow--cyan"></div>

      <main class="lobby-shell">
        <section class="lobby-card">
          <div class="lobby-card__header">
            <div class="lobby-kicker">MULTIPLAYER ARCADE</div>
            <h1 class="lobby-title">SPACE INVASION MOQ</h1>
            <p class="lobby-subtitle">
              Entra nella tua room e sfida un altro player in tempo reale.
            </p>
          </div>

          <div class="lobby-divider"></div>

          <form id="joinForm" class="lobby-form">
            <label class="lobby-field">
              <span class="lobby-label">NOME PILOTA</span>
              <input
                id="usernameInput"
                class="lobby-input"
                type="text"
                placeholder="es. fra"
                maxlength="20"
                autocomplete="off"
              />
            </label>

            <label class="lobby-field">
              <span class="lobby-label">ROOM ID</span>
              <input
                id="roomInput"
                class="lobby-input"
                type="text"
                placeholder="es. room-1"
                maxlength="20"
                autocomplete="off"
              />
            </label>

            <button type="submit" class="lobby-button">
              <span>GIOCA</span>
            </button>
          </form>

          <div class="lobby-footer">
            <div class="lobby-chip">MOQ</div>
            <div class="lobby-chip">2 PLAYER</div>
            <div class="lobby-chip">LIVE ROOM</div>
          </div>
        </section>
      </main>
    </div>
  `;

  injectLobbyStyles();

  const form = document.querySelector("#joinForm") as HTMLFormElement | null;
  const usernameInput = document.querySelector(
    "#usernameInput",
  ) as HTMLInputElement | null;
  const roomInput = document.querySelector(
    "#roomInput",
  ) as HTMLInputElement | null;

  usernameInput?.focus();

  form?.addEventListener("submit", (event) => {
    event.preventDefault();

    const username = usernameInput?.value.trim() ?? "";
    const room = roomInput?.value.trim() ?? "";

    if (!username || !room) {
      if (!username) usernameInput?.focus();
      else roomInput?.focus();
      return;
    }

    onJoin(username, room);
  });
}

function injectLobbyStyles(): void {
  const existing = document.querySelector("#lobby-styles");
  if (existing) return;

  const style = document.createElement("style");
  style.id = "lobby-styles";
  style.textContent = `
    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: "Press Start 2P", monospace;
      background:
        radial-gradient(circle at top, rgba(255, 0, 153, 0.16), transparent 28%),
        radial-gradient(circle at bottom, rgba(0, 255, 255, 0.12), transparent 30%),
        linear-gradient(180deg, #08030f 0%, #020205 55%, #000000 100%);
      color: #ffffff;
    }

    body {
      position: relative;
    }

    .lobby-page {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .lobby-shell {
      position: relative;
      z-index: 2;
      width: min(100%, 760px);
    }

    .lobby-card {
      position: relative;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(8, 8, 18, 0.78);
      backdrop-filter: blur(8px);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.03) inset,
        0 0 28px rgba(0, 255, 255, 0.08),
        0 0 42px rgba(255, 0, 153, 0.08);
      padding: 38px 34px 28px;
    }

    .lobby-card::before {
      content: "";
      position: absolute;
      inset: 10px;
      border: 1px solid rgba(0, 255, 255, 0.12);
      pointer-events: none;
    }

    .lobby-card__header {
      text-align: center;
    }

    .lobby-kicker {
      color: #00f6ff;
      font-size: 10px;
      letter-spacing: 2px;
      margin-bottom: 18px;
      text-shadow: 0 0 10px rgba(0, 246, 255, 0.7);
    }

    .lobby-title {
      margin: 0;
      font-size: clamp(22px, 3vw, 42px);
      line-height: 1.35;
      color: #ffffff;
      text-shadow:
        0 0 8px rgba(255, 255, 255, 0.3),
        0 0 18px rgba(255, 0, 153, 0.35),
        0 0 24px rgba(0, 255, 255, 0.22);
    }

    .lobby-subtitle {
      margin: 22px auto 0;
      max-width: 560px;
      color: #c9d7ff;
      font-size: 11px;
      line-height: 1.9;
    }

    .lobby-divider {
      height: 2px;
      margin: 28px 0 30px;
      background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 0, 153, 0.9),
        rgba(0, 255, 255, 0.9),
        transparent
      );
      box-shadow: 0 0 14px rgba(0, 255, 255, 0.35);
    }

    .lobby-form {
      display: grid;
      gap: 18px;
    }

    .lobby-field {
      display: grid;
      gap: 10px;
    }

    .lobby-label {
      color: #8ef8ff;
      font-size: 10px;
      letter-spacing: 1px;
      text-shadow: 0 0 8px rgba(0, 255, 255, 0.45);
    }

    .lobby-input {
      width: 100%;
      border: 2px solid rgba(255, 255, 255, 0.14);
      background: rgba(0, 0, 0, 0.55);
      color: #ffffff;
      padding: 18px 16px;
      font: inherit;
      font-size: 12px;
      outline: none;
      transition:
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        transform 0.18s ease;
    }

    .lobby-input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .lobby-input:focus {
      border-color: #00f6ff;
      box-shadow:
        0 0 0 2px rgba(0, 246, 255, 0.08),
        0 0 16px rgba(0, 246, 255, 0.22);
      transform: translateY(-1px);
    }

    .lobby-button {
      margin-top: 8px;
      border: 2px solid #ff3ccf;
      background:
        linear-gradient(180deg, rgba(255, 60, 207, 0.18), rgba(0, 255, 255, 0.08)),
        rgba(0, 0, 0, 0.4);
      color: #ffffff;
      padding: 18px 22px;
      font: inherit;
      font-size: 13px;
      letter-spacing: 1px;
      cursor: pointer;
      transition:
        transform 0.16s ease,
        box-shadow 0.16s ease,
        border-color 0.16s ease;
      box-shadow:
        0 0 12px rgba(255, 60, 207, 0.22),
        0 0 22px rgba(0, 255, 255, 0.1);
    }

    .lobby-button:hover {
      transform: translateY(-2px) scale(1.01);
      border-color: #00f6ff;
      box-shadow:
        0 0 16px rgba(255, 60, 207, 0.28),
        0 0 28px rgba(0, 255, 255, 0.16);
    }

    .lobby-button:active {
      transform: translateY(0);
    }

    .lobby-footer {
      margin-top: 24px;
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    .lobby-chip {
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.04);
      color: #dffcff;
      padding: 8px 12px;
      font-size: 9px;
      line-height: 1.4;
    }

    .lobby-glow {
      position: absolute;
      width: 420px;
      height: 420px;
      border-radius: 50%;
      filter: blur(90px);
      opacity: 0.22;
      pointer-events: none;
      z-index: 0;
    }

    .lobby-glow--pink {
      top: -120px;
      left: -100px;
      background: #ff00a6;
    }

    .lobby-glow--cyan {
      right: -120px;
      bottom: -120px;
      background: #00f6ff;
    }

    .lobby-stars {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }

    .lobby-stars span {
      position: absolute;
      width: 2px;
      height: 2px;
      border-radius: 999px;
      background: white;
      opacity: 0.9;
      box-shadow: 0 0 8px rgba(255,255,255,0.7);
      animation: lobbyTwinkle 2.8s infinite ease-in-out;
    }

    .lobby-stars span:nth-child(1)  { top: 8%;  left: 10%; animation-delay: 0s; }
    .lobby-stars span:nth-child(2)  { top: 16%; left: 74%; animation-delay: .3s; }
    .lobby-stars span:nth-child(3)  { top: 28%; left: 22%; animation-delay: .8s; }
    .lobby-stars span:nth-child(4)  { top: 34%; left: 84%; animation-delay: .4s; }
    .lobby-stars span:nth-child(5)  { top: 43%; left: 12%; animation-delay: 1.2s; }
    .lobby-stars span:nth-child(6)  { top: 52%; left: 67%; animation-delay: .7s; }
    .lobby-stars span:nth-child(7)  { top: 61%; left: 30%; animation-delay: 1.6s; }
    .lobby-stars span:nth-child(8)  { top: 72%; left: 80%; animation-delay: .9s; }
    .lobby-stars span:nth-child(9)  { top: 78%; left: 14%; animation-delay: .2s; }
    .lobby-stars span:nth-child(10) { top: 83%; left: 56%; animation-delay: 1.1s; }
    .lobby-stars span:nth-child(11) { top: 12%; left: 48%; animation-delay: .5s; }
    .lobby-stars span:nth-child(12) { top: 24%; left: 58%; animation-delay: 1.4s; }
    .lobby-stars span:nth-child(13) { top: 39%; left: 40%; animation-delay: .6s; }
    .lobby-stars span:nth-child(14) { top: 49%; left: 90%; animation-delay: 1.7s; }
    .lobby-stars span:nth-child(15) { top: 58%; left: 6%;  animation-delay: 1s; }
    .lobby-stars span:nth-child(16) { top: 69%; left: 44%; animation-delay: .1s; }
    .lobby-stars span:nth-child(17) { top: 76%; left: 66%; animation-delay: 1.5s; }
    .lobby-stars span:nth-child(18) { top: 86%; left: 88%; animation-delay: .45s; }
    .lobby-stars span:nth-child(19) { top: 19%; left: 92%; animation-delay: 1.9s; }
    .lobby-stars span:nth-child(20) { top: 90%; left: 26%; animation-delay: .95s; }

    @keyframes lobbyTwinkle {
      0%, 100% {
        transform: scale(1);
        opacity: 0.35;
      }
      50% {
        transform: scale(1.8);
        opacity: 1;
      }
    }

    @media (max-width: 720px) {
      .lobby-page {
        padding: 16px;
      }

      .lobby-card {
        padding: 24px 18px 20px;
      }

      .lobby-subtitle {
        font-size: 10px;
      }

      .lobby-input,
      .lobby-button {
        font-size: 11px;
        padding: 16px 14px;
      }

      .lobby-footer {
        gap: 8px;
      }
    }
  `;
  document.head.appendChild(style);
}