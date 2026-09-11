import { renderLobby } from "./ui/lobby";
import {
  renderGameRoom,
  updatePresence,
  updateRemoteGame,
  startLocalMatch,
} from "./ui/game-room";

import { connectSignaling, disconnectSignaling } from "./webrtc/connection";
import {
  startPublisher,
  stopPublisher,
  publishSnapshot,
  setLocalMatchInitHandler,
  type GameSnapshot,
  type MatchInit,
} from "./webrtc/publisher";
import { startSubscriber, stopSubscriber } from "./webrtc/subscriber";
import { startSession, endSession } from "./metrics/metrics";
import { installDeterministicRandom } from "./testbed/rng";
import { resetIdCounters } from "./game/localGame/id";
import type { GameDifficultyConfig } from "./game/localGame/types";
import { ScenarioPlayer } from "./testbed/scenarioPlayer";
import { startRun, finishRun, recordSnapshotForHash } from "./testbed/runLogger";
import { toPlayerRun, type PlayerId, type Scenario } from "./testbed/scenario.types";
import { checkDeterminism, type ActualPlayerResult } from "./testbed/determinism";

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

//  Attende che il peer remoto risulti presente nella room (tramite le notifiche di presenza gia'
// esistenti, vedi webrtc/subscriber.ts) prima di avviare lo scenario, cosi' i due client automatici
// (Player A e Player B) partono a pochi istanti l'uno dall'altro invece che a tempi arbitrariamente
// diversi (FASE 8 della tesi). Meccanismo volutamente semplice: nessun handshake/protocollo nuovo,
// solo un'attesa sulla presenza gia' disponibile, con un timeout di sicurezza per non bloccare mai
// indefinitamente un run se il secondo client non arriva (es. debug con un solo client aperto).
const PEER_READY_TIMEOUT_MS = 15000;

function waitForPeerReady(
  registerPresenceListener: (cb: (users: string[]) => void) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason: string) => {
      if (done) return;
      done = true;
      console.info(`[Testbed] avvio scenario: ${reason}`);
      resolve();
    };

    registerPresenceListener((users) => {
      if (users.length > 0) finish(`peer "${users[0]}" rilevato nella room`);
    });

    window.setTimeout(
      () => finish(`timeout di ${PEER_READY_TIMEOUT_MS}ms raggiunto, nessun peer rilevato - avvio comunque`),
      PEER_READY_TIMEOUT_MS,
    );
  });
}

//  Esegue il join a una room (manuale o automatico) e avvia publisher/subscriber. In modalita'
// automatica, prima di fare qualunque altra cosa: scarica lo scenario condiviso e installa il
// generatore di numeri casuali seedato (deve succedere PRIMA che venga montato il
// LocalGameEngine, perche' Math.random() viene gia' chiamato negli inizializzatori dei suoi
// campi). In modalita' manuale (1v1 reale), il seed condiviso non e' noto in anticipo: arriva
// tramite l'handshake matchInit scambiato sul canale "game" gia' esistente (vedi
// webrtc/peerManager.ts) - il motore locale viene montato solo dopo che l'handshake e' completo,
// vedi applyMatchInit() sotto.
async function join(
  username: string,
  room: string,
  auto: AutoRunParams | null,
): Promise<void> {
  let scenario: Scenario | null = null;

  if (auto) {
    const res = await fetch(`/scenarios/${auto.scenarioId}.json`);
    if (!res.ok) {
      console.error(`[Testbed] impossibile scaricare scenario "${auto.scenarioId}" (HTTP ${res.status}).`);
    } else {
      scenario = (await res.json()) as Scenario;
      installDeterministicRandom(scenario.seed);
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
  }

  let lastLocalSnapshot: GameSnapshot | null = null;
  let presenceListener: ((users: string[]) => void) | null = null;

  //  1v1: true non appena il motore locale e' stato montato (via scenario automatico o via
  // handshake matchInit) - evita di montarlo due volte se sia l'evento "sono iniziatore" sia un
  // matchInit ricevuto dal peer arrivassero entrambi (non dovrebbe succedere, ma resta innocuo).
  let matchStarted = false;

  const onSnapshot = (snapshot: GameSnapshot) => {
    lastLocalSnapshot = snapshot;
    recordSnapshotForHash(snapshot);
    publishSnapshot(snapshot);
  };

  //  1v1: installa il seed deterministico condiviso e programma l'avvio del motore locale
  // esattamente all'istante concordato (Date.now(), confrontabile tra le due macchine) - sia che
  // il matchInit sia stato generato da QUESTO client (siamo iniziatori, vedi
  // setLocalMatchInitHandler piu' sotto) sia che sia stato ricevuto dall'avversario (vedi
  // callback onGameUpdate passata a startSubscriber).
  const applyMatchInit = (init: MatchInit, gameConfig?: GameDifficultyConfig) => {
    if (matchStarted) return;
    matchStarted = true;

    installDeterministicRandom(init.seed);
    resetIdCounters();

    const delayMs = Math.max(0, init.startAtEpochMs - Date.now());
    window.setTimeout(() => {
      startLocalMatch(onSnapshot, gameConfig);
    }, delayMs);
  };

  try {
    await connectSignaling();

    if (!auto) {
      //  Solo in modalita' manuale: questo client puo' diventare iniziatore dell'handshake verso
      // un peer gia' presente nella room (stessa regola anti-glare della negoziazione WebRTC, vedi
      // peerManager.ts). L'evento arriva in modo puramente locale, non e' un messaggio di rete: il
      // messaggio vero e proprio (che porta lo stesso seed/istante all'avversario) viene inviato
      // da peerManager.ts stesso sul canale "game" gia' esistente.
      setLocalMatchInitHandler((init) => applyMatchInit(init));
    }

    await startPublisher(room, username);
    startSession(username, room);

    let scenarioPlayer: ScenarioPlayer | null = null;

    renderGameRoom(username, room, {
      onLeave: () => {
        scenarioPlayer?.stop();
        endSession();
        stopSubscriber();
        stopPublisher();
        disconnectSignaling();
        start();
      },
    });

    if (auto && scenario) {
      //  Modalita' automatica: seed gia' installato sopra, nessun handshake da attendere - il
      // motore locale viene montato subito con la configurazione di difficolta' dello scenario.
      startLocalMatch(onSnapshot, scenario.gameConfig);
    }

    await startSubscriber(
      room,
      username,
      (remoteUsername, snapshot) => {
        if (!auto && snapshot.matchInit) {
          applyMatchInit(snapshot.matchInit);
        }
        updateRemoteGame(remoteUsername, snapshot);
      },
      (users) => {
        updatePresence(users);
        presenceListener?.(users);
      },
    );

    if (scenario && auto) {
      await waitForPeerReady((cb) => {
        presenceListener = cb;
      });
      presenceListener = null;

      const scenarioStartedAt = performance.now();
      scenarioPlayer = new ScenarioPlayer(toPlayerRun(scenario, auto.player));
      scenarioPlayer.start(() => {
        const actualDurationMs = performance.now() - scenarioStartedAt;
        console.info(`[Testbed] scenario completato (run "${auto.runId}").`);

        const actual: ActualPlayerResult = {
          finalScore: lastLocalSnapshot?.score ?? 0,
          survived: !(lastLocalSnapshot?.gameOver ?? false),
          finalPositionX: lastLocalSnapshot?.player.x ?? 0,
          finalPositionY: lastLocalSnapshot?.player.y ?? 0,
          actualDurationMs,
        };
        const determinismCheck = checkDeterminism(scenario, auto.player, actual);
        console.info(
          `[Testbed] determinismCheck: ${determinismCheck.status}`,
          determinismCheck,
        );

        void finishRun(scenarioPlayer?.getLog() ?? [], [], actual, determinismCheck);
      });
    }
  } catch (err) {
    console.error("ERRORE DURANTE LA CONNESSIONE:", err);

    if (auto) {
      void finishRun([], [String(err)]);
    } else {
      alert("Errore di connessione: " + err);
    }

    endSession();
    stopSubscriber();
    stopPublisher();
    disconnectSignaling();

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
