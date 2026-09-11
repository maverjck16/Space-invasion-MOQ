import type { GameSnapshot } from "../../webrtc/snapshot";
import { LocalGameEngine } from "./LocalGameEngine";
import type { GameDifficultyConfig } from "./types";

// 1v1: opzioni aggiuntive dell'HUD/fine partita.
export type CreateLocalGameExtras = {
  onLivesChange?: (lives: number) => void;
  onMatchEnd?: () => void;
  onTimeRemaining?: (msRemaining: number) => void;
};

// 1v1: handle restituito da createLocalGame - oltre a poter distruggere il gioco, espone
// applyRemoteSnapshot cosi' chi riceve gli aggiornamenti di rete dell'avversario (vedi main.ts)
// puo' inoltrarli al motore per il rendering nell'arena condivisa e la riconciliazione delle
// eliminazioni (killedIds).
export type LocalGameHandle = {
  destroy: () => void;
  applyRemoteSnapshot: (snapshot: GameSnapshot) => void;
};

//funzione principale che crea e avvia il gioco locale, accettando un canvas su cui disegnare, una funzione di callback per inviare
// snapshot al publisher. Deve essere chiamata SOLO dopo l'handshake di inizio partita (seed
// deterministico gia' installato, istante di partenza condiviso raggiunto) - vedi main.ts.
export function createLocalGame(
  canvas: HTMLCanvasElement,
  onSnapshot: (snapshot: GameSnapshot) => void,
  onScoreChange?: (score: number) => void,
  gameConfig?: GameDifficultyConfig,
  extras?: CreateLocalGameExtras,
): LocalGameHandle {
  const game = new LocalGameEngine({
    canvas,
    onSnapshot,
    onScoreChange,
    onLivesChange: extras?.onLivesChange,
    onMatchEnd: extras?.onMatchEnd,
    onTimeRemaining: extras?.onTimeRemaining,
    gameConfig,
  });

  game.start();

  return {
    destroy: () => game.destroy(),
    applyRemoteSnapshot: (snapshot: GameSnapshot) => game.applyRemoteSnapshot(snapshot),
  };
}
