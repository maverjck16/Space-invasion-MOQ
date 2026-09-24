import type { GameSnapshot } from "../../webrtc/snapshot";
import type { ArenaMatchResult, ArenaSnapshot } from "../../arena/arenaClient";
import { LocalGameEngine } from "./LocalGameEngine";
import type { MatchMode, MatchResult } from "./types";

// 1v1: opzioni aggiuntive dell'HUD/fine partita/rete verso il server dell'arena. "matchMode"
// sceglie le regole di partita (vedi MatchMode in types.ts): assente = partita manuale di sempre,
// "testbed" = partita automatica.
export type CreateLocalGameExtras = {
  onLivesChange?: (lives: number) => void;
  onMatchEnd?: (result: MatchResult) => void;
  onTimeRemaining?: (msRemaining: number) => void;
  matchMode?: MatchMode;
  onBeforeFrame?: (frame: number) => void;
};

// 1v1: handle restituito da createLocalGame - oltre a poter distruggere il gioco, espone
// applyRemoteSnapshot (aggiornamenti P2P cosmetici dell'avversario) e applyArenaSnapshot/
// applyArenaMatchEnd (aggiornamenti autoritativi dal server dell'arena, vedi
// arena/arenaClient.ts) cosi' chi riceve questi eventi di rete (vedi main.ts) puo' inoltrarli al
// motore.
export type LocalGameHandle = {
  destroy: () => void;
  applyRemoteSnapshot: (snapshot: GameSnapshot) => void;
  applyArenaSnapshot: (snapshot: ArenaSnapshot) => void;
  applyArenaMatchEnd: (result: ArenaMatchResult) => void;
};

//funzione principale che crea e avvia il gioco locale, accettando un canvas su cui disegnare e le
// funzioni di callback verso i due canali di rete (P2P cosmetico e server dell'arena). Deve essere
// chiamata SOLO dopo che il server dell'arena ha comunicato matchStart - vedi main.ts.
export function createLocalGame(
  canvas: HTMLCanvasElement,
  username: string,
  onSnapshot: (snapshot: GameSnapshot) => void,
  sendArenaState: (state: { x: number; y: number; width: number; height: number }) => void,
  sendArenaFire: (shot: { id: string; x: number; y: number; vx: number; vy: number; radius: number }) => void,
  onScoreChange?: (score: number) => void,
  extras?: CreateLocalGameExtras,
): LocalGameHandle {
  const game = new LocalGameEngine({
    canvas,
    username,
    onSnapshot,
    sendArenaState,
    sendArenaFire,
    onScoreChange,
    onLivesChange: extras?.onLivesChange,
    onMatchEnd: extras?.onMatchEnd,
    onTimeRemaining: extras?.onTimeRemaining,
    matchMode: extras?.matchMode,
    onBeforeFrame: extras?.onBeforeFrame,
  });

  game.start();

  return {
    destroy: () => game.destroy(),
    applyRemoteSnapshot: (snapshot: GameSnapshot) => game.applyRemoteSnapshot(snapshot),
    applyArenaSnapshot: (snapshot: ArenaSnapshot) => game.applyArenaSnapshot(snapshot),
    applyArenaMatchEnd: (result: ArenaMatchResult) => game.applyArenaMatchEnd(result),
  };
}
