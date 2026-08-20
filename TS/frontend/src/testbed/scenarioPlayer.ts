//  Esecutore dello scenario deterministico: sostituisce il controllo manuale da tastiera con una
// timeline di input predefinita, identica per il testbed MoQ e quello WebRTC (stesso file
// scenario.json, vedi frontend/public/scenario.json).
//
//  Dispatcha veri KeyboardEvent su window, esattamente come farebbe una pressione di tasto reale:
// game/localGame/LocalGameEngine.ts (identico e NON modificato in nessuno dei due testbed) ascolta
// "keydown"/"keyup" su window tramite addEventListener e non ha modo di distinguere un evento
// sintetico da uno generato da una tastiera vera. Questo e' il motivo per cui il motore di gioco
// non ha bisogno di nessuna modifica per essere pilotato automaticamente.
//
//  LIMITE NOTO (onesto, non nascosto): window.setTimeout e requestAnimationFrame nel browser non
// hanno una risoluzione perfetta - sono soggetti al normale jitter del sistema operativo/del motore
// JS (tipicamente sub-millisecondo, di piu' sotto carico). Questo significa che la sequenza LOGICA
// di eventi (stessi spawn, stesse scelte, stessi input, nello stesso ordine) e' garantita identica
// run dopo run grazie al seed del generatore casuale (vedi rng.ts) e a questa timeline fissa, ma il
// timestamp esatto al millisecondo di ciascun evento puo' variare leggermente tra un'esecuzione e
// l'altra. Per il confronto MoQ/WebRTC questo e' accettabile (anzi corretto): l'obiettivo e' un
// carico di lavoro di rete identico e riproducibile, non una simulazione lockstep a frame fisso.

//  I tipi Scenario/ScenarioAction vivono ora in scenario.types.ts (schema condiviso multi-player,
// vedi FASE 5/FASE 3 della tesi): questo file continua a lavorare solo su un "PlayerRun" (seed +
// durata + timeline di UN giocatore), esattamente come prima - zero altre modifiche qui sotto.
import type { PlayerRun, ScenarioAction } from "./scenario.types";
export type { ScenarioAction } from "./scenario.types";
export type Scenario = PlayerRun;

export type ScenarioLogEntry = {
  actionId: string;
  scheduledAtMs: number;
  dispatchedAtMs: number; // performance.now() relativo all'avvio dello scenario
  type: ScenarioAction["type"];
};

// Tempo tra il keydown e il keyup sintetico di "spazio" per simulare un singolo colpo (il motore
// di gioco spara un proiettile al keydown e ignora la ripetizione finche' il tasto resta premuto).
const SHOOT_RELEASE_DELAY_MS = 60;

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

  constructor(scenario: Scenario) {
    this.scenario = scenario;
  }

  start(onDone?: () => void): void {
    this.onDone = onDone ?? null;
    this.startedAt = performance.now();

    for (const action of this.scenario.actions) {
      const timerId = window.setTimeout(() => this.runAction(action), action.timeMs);
      this.timers.push(timerId);
    }

    const endTimerId = window.setTimeout(() => {
      // Rilascia qualunque tasto direzionale/spazio ancora "premuto" a fine scenario, cosi' il
      // giocatore non continua a muoversi/sparare dopo la fine della sequenza scriptata.
      this.releaseAll();
      this.onDone?.();
    }, this.scenario.durationMs);
    this.timers.push(endTimerId);
  }

  stop(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    this.releaseAll();
  }

  getLog(): ScenarioLogEntry[] {
    return [...this.log];
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

  private runAction(action: ScenarioAction): void {
    this.log.push({
      actionId: action.id,
      scheduledAtMs: action.timeMs,
      dispatchedAtMs: performance.now() - this.startedAt,
      type: action.type,
    });

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
      window.setTimeout(() => dispatchKey("keyup", " "), SHOOT_RELEASE_DELAY_MS);
      return;
    }
  }
}
