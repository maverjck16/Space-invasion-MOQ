import { renderLobby } from "./ui/lobby";
import {
  renderGameRoom,
  updatePresence,
  updateRemoteGame,
  updateArenaState,
  applyArenaMatchEnd,
  startLocalMatch,
} from "./ui/game-room";

import { connectSignaling, disconnectSignaling } from "./webrtc/connection";
import { startPublisher, stopPublisher, publishSnapshot, type GameSnapshot } from "./webrtc/publisher";
import { startSubscriber, stopSubscriber } from "./webrtc/subscriber";
import { startSession, endSession } from "./metrics/metrics";
import type { MatchResult } from "./game/localGame/types";
import { ScenarioPlayer } from "./testbed/scenarioPlayer";
import { startRun, finishRun, recordSnapshotForHash } from "./testbed/runLogger";
import { toPlayerRun, type PlayerId, type Scenario } from "./testbed/scenario.types";
import { checkDeterminism, type ActualPlayerResult } from "./testbed/determinism";
import { connectArena, type ArenaClient } from "./arena/arenaClient";
import { ARENA_URL } from "./config";

//  TESTBED: se la pagina viene aperta con "?auto=1&scenario=...&player=A|B&room=..." nella query
// string, il gioco salta la lobby manuale ed esegue automaticamente lo scenario deterministico
// condiviso (vedi public/scenarios/*.json e src/testbed/scenarioPlayer.ts) invece di aspettare
// input da tastiera. Senza questi parametri il comportamento e' IDENTICO alla versione originale.
// Esempio: http://host:5173/?auto=1&scenario=scenario-1&player=A&room=room-test-1
type AutoRunParams = {
  scenarioId: string;
  player: PlayerId;
  room: string;
  username: string;
  runId: string;
};

// Nomi di default usati in modalita' automatica quando "username" non e' specificato in query
// string, cosi' i comandi di avvio dei 3 scenari restano quelli minimi mostrati in TESTBED.md
// (solo scenario/player/room). Scelti per rispecchiare l'esempio "Player A / Fra, Player B / Luca"
// usato nella progettazione degli scenari.
const DEFAULT_USERNAME: Record<PlayerId, string> = { A: "Fra", B: "Luca" };

function readAutoRunParams(): AutoRunParams | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auto") !== "1") return null;

  const room = params.get("room");
  const scenarioId = params.get("scenario");
  const playerParam = params.get("player");

  if (!room || !scenarioId || (playerParam !== "A" && playerParam !== "B")) {
    console.error(
      '[Testbed] "auto=1" richiede anche i parametri "scenario" (es. scenario-1), "player" (A o B) e "room" nella query string.',
    );
    return null;
  }

  const player = playerParam as PlayerId;
  const username = params.get("username") ?? DEFAULT_USERNAME[player];

  return {
    scenarioId,
    player,
    room,
    username,
    runId: params.get("runId") ?? `${scenarioId}-${player}-${Date.now()}`,
  };
}

//  Esegue il join a una room (manuale o automatico) e avvia publisher/subscriber P2P (rendering
// cosmetico dell'avversario, vedi webrtc/peerManager.ts) e la connessione al server dell'arena
// (vedi arena/arenaClient.ts), che decide da solo invasori/asteroidi/proiettili nemici, punteggio,
// vite e la fine partita per entrambi i client. Il motore di gioco locale viene montato quando il
// server dell'arena comunica "matchStart" (entrambi i giocatori sono nella stanza), sia per la
// partita manuale sia per il testbed automatico - un solo percorso di codice per entrambe le
// modalita', a differenza della vecchia architettura P2P dove la partita manuale partiva da un
// handshake scambiato tra i client e il testbed aspettava invece la presenza dell'avversario.
async function join(
  username: string,
  room: string,
  auto: AutoRunParams | null,
): Promise<void> {
  let scenario: Scenario | null = null;
  let arena: ArenaClient | null = null;

  const onSnapshot = (snapshot: GameSnapshot) => {
    publishSnapshot(snapshot);
  };

  try {
    //  TESTBED: il download dello scenario va dentro il try/catch che segue - prima stava fuori
    // e un fallimento (es. HTTP 403/404, file non presente/non servito dal deployment) veniva solo
    // loggato in console senza interrompere nulla. Ora un fallimento qui produce lo stesso errore
    // visibile a schermo del blocco catch sotto.
    if (auto) {
      const res = await fetch(`/scenarios/${auto.scenarioId}.json`);
      if (!res.ok) {
        throw new Error(
          `Impossibile scaricare lo scenario "${auto.scenarioId}" (HTTP ${res.status}) da /scenarios/${auto.scenarioId}.json. ` +
            `Verifica che il file sia presente ed effettivamente servito dal deployment del frontend.`,
        );
      }
      scenario = (await res.json()) as Scenario;
      startRun({
        runId: auto.runId,
        protocol: "webrtc",
        scenarioId: scenario.scenarioId,
        scenarioSeed: scenario.seed,
        scenarioDurationMs: scenario.durationMs,
        player: auto.player,
        username,
        room,
      });
    }

    await connectSignaling();
    await startPublisher(room, username);
    startSession(username, room);

    let scenarioPlayer: ScenarioPlayer | null = null;
    let onTestbedMatchEnd: ((result: MatchResult) => void) | null = null;
    let scenarioStartedAtMs = 0;

    renderGameRoom(username, room, {
      onLeave: () => {
        scenarioPlayer?.stop();
        arena?.close();
        endSession();
        stopSubscriber();
        stopPublisher();
        disconnectSignaling();
        start();
      },
    });

    await startSubscriber(
      room,
      username,
      (remoteUsername, snapshot) => {
        updateRemoteGame(remoteUsername, snapshot);
      },
      (users) => {
        updatePresence(users);
      },
    );

    if (scenario && auto) {
      const activeScenario = scenario;
      const player = new ScenarioPlayer(toPlayerRun(activeScenario, auto.player));
      scenarioPlayer = player;
      let runFinished = false;

      onTestbedMatchEnd = (result: MatchResult) => {
        if (runFinished) return;
        runFinished = true;
        player.stop();

        const actualDurationMs = performance.now() - scenarioStartedAtMs;
        console.info(
          `[Testbed] partita conclusa (run "${auto.runId}"): ${result.outcome} (${result.decidedBy}), ` +
            `punteggio ${result.localScore} - ${result.remoteScore}.`,
        );

        const actual: ActualPlayerResult = {
          finalScore: result.localScore,
          survived: !result.localEliminated,
          finalPositionX: result.finalPositionX,
          finalPositionY: result.finalPositionY,
          actualDurationMs,
          outcome: result.outcome,
          endReason: result.endReason,
          decidedBy: result.decidedBy,
          opponentScore: result.remoteScore,
          opponentSurvived: !result.remoteEliminated,
          eliminatedAtFrame: result.localEliminatedAtFrame,
          opponentEliminatedAtFrame: result.remoteEliminatedAtFrame,
          lastWaveClearedAtFrame: result.lastWaveClearedAtFrame,
          endFrame: result.endFrame,
          // 1v1 - server autoritativo: lo stato finale dell'avversario e' SEMPRE noto (arriva dallo
          // stesso messaggio matchEnd del server, che ha per definizione lo stato di entrambi), a
          // differenza della vecchia architettura P2P dove poteva mancare per un pacchetto perso o
          // per un avversario disconnesso proprio in quel momento (vedi il vecchio
          // TESTBED_FINAL_STATE_TIMEOUT_MS, rimosso).
          opponentFinalStateReceived: true,
        };
        const determinismCheck = checkDeterminism(activeScenario, auto.player, actual);
        console.info(
          `[Testbed] determinismCheck: ${determinismCheck.status}`,
          determinismCheck,
        );

        void finishRun(player.getLog(), [], actual, determinismCheck);
      };
    }

    //  1v1: connessione al server autoritativo dell'arena (vedi arena/arenaClient.ts) - la stanza
    // viene creata dal primo client che arriva, con matchMode/gameConfig/seed (questi ultimi due
    // rilevanti solo per il testbed: la partita manuale non li manda, la stanza usa i valori di
    // default lato server, vedi arena-server/simulation.js). "matchStart" arriva quando ENTRAMBI i
    // giocatori sono nella stanza: e' il momento in cui costruire e avviare il motore locale,
    // esattamente all'istante concordato (Date.now(), confrontabile tra le due macchine).
    arena = connectArena(
      ARENA_URL,
      room,
      username,
      {
        matchMode: auto ? "testbed" : "timed",
        gameConfig: auto ? (scenario as Scenario).gameConfig : undefined,
        seed: auto ? (scenario as Scenario).seed : undefined,
      },
      {
        onMatchStart: (startAtEpochMs, matchMode) => {
          const delayMs = Math.max(0, startAtEpochMs - Date.now());
          window.setTimeout(() => {
            if (!arena) return;
            scenarioStartedAtMs = performance.now();
            startLocalMatch(username, onSnapshot, arena.sendState, arena.sendFire, {
              mode: matchMode,
              onMatchEnd: onTestbedMatchEnd ?? undefined,
              onBeforeFrame: scenarioPlayer ? (frame) => scenarioPlayer?.onFrame(frame) : undefined,
            });
            scenarioPlayer?.start(() => {
              console.info(
                `[Testbed] timeline di input terminata (run "${auto?.runId}"): la partita prosegue fino all'esito.`,
              );
            });
          }, delayMs);
        },
        onSnapshot: (snapshot) => {
          // TESTBED: accumula l'hash deterministico sulla sequenza di stati AUTORITATIVI
          // dell'arena (non piu' sul semplice snapshot P2P cosmetico, che non porta piu' punteggio
          // /vite/entita' condivise) - vedi testbed/stateHash.ts e TESTBED.md.
          if (auto) recordSnapshotForHash(snapshot);
          updateArenaState(snapshot);
        },
        onMatchEnd: (result) => {
          applyArenaMatchEnd(result);
        },
        onPeerLeft: () => {
          console.info("[Arena] L'avversario ha lasciato la stanza dell'arena.");
        },
        onError: (message) => {
          console.error("[Arena] Errore dal server dell'arena:", message);
        },
      },
    );
  } catch (err) {
    console.error("ERRORE DURANTE LA CONNESSIONE:", err);

    if (auto) {
      // A differenza della modalita' manuale (che torna alla lobby con un alert, vedi sotto),
      // qui nessuna schermata viene mai montata prima di questo punto: senza un feedback visibile
      // un errore di connessione (es. SIGNALING_URL/ARENA_URL non raggiungibile) e' indistinguibile
      // da una pagina che sta ancora caricando, restando bianca a tempo indefinito.
      const appEl = document.getElementById("app");
      if (appEl) {
        appEl.innerHTML = `<pre style="color:#f55;background:#111;padding:1rem;font-family:monospace;white-space:pre-wrap;">[Testbed] Errore di connessione:\n${String(err)}</pre>`;
      }
      void finishRun([], [String(err)]);
    } else {
      alert("Errore di connessione: " + err);
    }

    endSession();
    stopSubscriber();
    stopPublisher();
    disconnectSignaling();
    arena?.close();

    if (!auto) start();
  }
}

//allo start dell'applicazione mostro la lobby, da cui l'utente può inserire username e room a cui connettersi.
//  Una volta connesso, mostro la schermata di gioco, e avvio publisher e subscriber. Se l'utente lascia la room,
//o se c'è un errore di connessione, torno alla lobby. In modalita' testbed automatica, salto la lobby.
function start() {
  const auto = readAutoRunParams();

  if (auto) {
    void join(auto.username, auto.room, auto);
    return;
  }

  renderLobby((username, room) => {
    void join(username, room, null);
  });
}

start();
