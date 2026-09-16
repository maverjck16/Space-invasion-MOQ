//  Esecutore dello scenario deterministico: sostituisce il controllo manuale da tastiera con una
// timeline di input predefinita, identica per il testbed MoQ e quello WebRTC (stesso file
// scenario.json, vedi frontend/public/scenario.json).
//
//  Dispatcha veri KeyboardEvent su window, esattamente come farebbe una pressione di tasto reale:
// game/localGame/LocalGameEngine.ts ascolta "keydown"/"keyup" su window tramite addEventListener e
// non ha modo di distinguere un evento sintetico da uno generato da una tastiera vera.
//
//  Due modalita' di esecuzione:
// - A FRAME (TESTBED 1v1, usata quando tutte le azioni hanno il campo "frame"): ScenarioPlayer non
//   usa timer propri. Il motore di gioco chiama onFrame(frame) all'inizio di ogni frame simulato
//   (opzione onBeforeFrame, vedi main.ts) e qui vengono inviate le azioni di quel frame. Ogni
//   comando agisce quindi esattamente sul frame previsto dalla timeline, qualunque sia il ritardo
//   dei timer del browser: con una sola vita e schivate calcolate al frame (vedi
//   scripts/generate-scenario.mjs), anche un solo frame di differenza puo' cambiare la partita.
// - A TEMPO (timeline senza "frame", come nelle versioni precedenti): ogni azione parte con
//   window.setTimeout(timeMs).
//
//  LIMITE NOTO (onesto, non nascosto) della modalita' a tempo: window.setTimeout nel browser non ha
// una risoluzione perfetta - e' soggetto al normale jitter del sistema operativo/del motore JS (da
// meno di un millisecondo a qualche decina sotto carico), quindi un'azione puo' agire un frame
// prima o dopo il previsto. La modalita' a frame elimina questo problema per gli input; resta
// invece il jitter delle informazioni che arrivano dall'avversario via rete, che e' proprio cio'
// che il testbed misura.

//  I tipi Scenario/ScenarioAction vivono ora in scenario.types.ts (schema condiviso multi-player,
// vedi FASE 5/FASE 3 della tesi): questo file continua a lavorare solo su un "PlayerRun" (seed +
// durata + timeline di UN giocatore).
import type { PlayerRun, ScenarioAction } from "./scenario.types";
export type { ScenarioAction } from "./scenario.types";
export type Scenario = PlayerRun;

export type ScenarioLogEntry = {
  actionId: string;
  scheduledAtMs: number;
  dispatchedAtMs: number; // performance.now() relativo all'avvio dello scenario
  type: ScenarioAction["type"];
  // Solo in modalita' a frame: frame previsto e frame in cui l'azione e' stata inviata.
  scheduledFrame?: number;
  dispatchedFrame?: number;
};

// Tempo tra il keydown e il keyup sintetico di "spazio" per simulare un singolo colpo (il motore
// di gioco spara un proiettile al keydown e ignora la ripetizione finche' il tasto resta premuto).
// In modalita' a frame il keyup segue subito il keydown: il colpo e' gia' partito e il tasto torna
// libero per il colpo successivo.
const SHOOT_RELEASE_DELAY_MS = 60;

// Durata di un frame del motore di gioco (60 frame al secondo).
const FRAME_MS = 1000 / 60;

function dispatchKey(type: "keydown" | "keyup", key: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
}

export class ScenarioPlayer {
  private readonly scenario: Scenario;
  private readonly log: ScenarioLogEntry[] = [];
  private timers: number[] = [];
  private startedAt = 0;
  private currentX: "left" | "right" | "none" = "none";
  private currentY: "up" | "down" | "none" = "none";
  private onDone: (() => void) | null = null;

  // Modalita' a frame: azioni ordinate per frame (a parita', nell'ordine della timeline), indice
  // della prossima da inviare e frame a cui la timeline e' finita.
  private readonly frameSynced: boolean;
  private readonly frameActions: ScenarioAction[];
  private nextFrameAction = 0;
  private readonly endFrame: number;
  private running = false;
  private finished = false;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.frameSynced =
      scenario.actions.length > 0 && scenario.actions.every((action) => typeof action.frame === "number");
    this.frameActions = this.frameSynced
      ? scenario.actions
          .map((action, index) => ({ action, index }))
          .sort((a, b) => (a.action.frame ?? 0) - (b.action.frame ?? 0) || a.index - b.index)
          .map((entry) => entry.action)
      : [];
    this.endFrame = Math.ceil(scenario.durationMs / FRAME_MS);
  }

  // true se la timeline va eseguita a frame: in quel caso chi crea il motore di gioco deve
  // inoltrare a onFrame() ogni frame simulato (opzione onBeforeFrame).
  isFrameSynced(): boolean {
    return this.frameSynced;
  }

  start(onDone?: () => void): void {
    this.onDone = onDone ?? null;
    this.startedAt = performance.now();
    this.running = true;

    if (this.frameSynced) return;

    for (const action of this.scenario.actions) {
      const timerId = window.setTimeout(() => this.runAction(action), action.timeMs);
      this.timers.push(timerId);
    }

    const endTimerId = window.setTimeout(() => this.finish(), this.scenario.durationMs);
    this.timers.push(endTimerId);
  }

  //  Modalita' a frame: chiamata dal motore all'inizio del frame "frame" (0 = primo frame della
  // partita), prima che legga i tasti. Invia le azioni previste fino a quel frame compreso.
  onFrame(frame: number): void {
    if (!this.frameSynced || !this.running) return;

    while (this.nextFrameAction < this.frameActions.length) {
      const action = this.frameActions[this.nextFrameAction];
      if ((action.frame ?? 0) > frame) break;
      this.nextFrameAction += 1;
      this.runAction(action, frame);
    }

    if (frame >= this.endFrame) this.finish();
  }

  stop(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    this.running = false;
    this.releaseAll();
  }

  getLog(): ScenarioLogEntry[] {
    return [...this.log];
  }

  // Fine della timeline: rilascia qualunque tasto direzionale ancora "premuto", cosi' il giocatore
  // non continua a muoversi dopo la fine della sequenza scriptata.
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.releaseAll();
    this.onDone?.();
  }

  private releaseAll(): void {
    if (this.currentX !== "none") {
      dispatchKey("keyup", this.currentX === "left" ? "a" : "d");
      this.currentX = "none";
    }
    if (this.currentY !== "none") {
      dispatchKey("keyup", this.currentY === "up" ? "w" : "s");
      this.currentY = "none";
    }
  }

  private runAction(action: ScenarioAction, frame?: number): void {
    const entry: ScenarioLogEntry = {
      actionId: action.id,
      scheduledAtMs: action.timeMs,
      dispatchedAtMs: performance.now() - this.startedAt,
      type: action.type,
    };
    if (frame !== undefined) {
      entry.scheduledFrame = action.frame;
      entry.dispatchedFrame = frame;
    }
    this.log.push(entry);

    if (action.type === "moveX") {
      if (this.currentX !== "none") {
        dispatchKey("keyup", this.currentX === "left" ? "a" : "d");
      }
      this.currentX = action.dir;
      if (action.dir !== "none") {
        dispatchKey("keydown", action.dir === "left" ? "a" : "d");
      }
      return;
    }

    if (action.type === "moveY") {
      if (this.currentY !== "none") {
        dispatchKey("keyup", this.currentY === "up" ? "w" : "s");
      }
      this.currentY = action.dir;
      if (action.dir !== "none") {
        dispatchKey("keydown", action.dir === "up" ? "w" : "s");
      }
      return;
    }

    if (action.type === "shoot") {
      dispatchKey("keydown", " ");
      if (this.frameSynced) {
        dispatchKey("keyup", " ");
      } else {
        window.setTimeout(() => dispatchKey("keyup", " "), SHOOT_RELEASE_DELAY_MS);
      }
      return;
    }
  }
}
