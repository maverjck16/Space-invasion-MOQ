import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME, TRACK_PRIORITY } from "../config";
import { connectToRelay, type MoqConnection } from "./connection";
import type { GameSnapshot } from "./publisher";

let abortController: AbortController | null = null;

//  Mantengo una piccola mappa degli utenti remoti presenti nella room,
// utile più avanti per lobby / waiting room / gestione presenza.
let remoteUsers: string[] = [];

export async function startSubscriber(
  room: string,
  username: string,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  const connection = await connectToRelay();

  abortController = new AbortController();
  const { signal } = abortController;

  remoteUsers = [];
  onPresenceUpdate?.([...remoteUsers]);

  const roomPrefix = Moq.Path.from(`${APP_PREFIX}/${room}/`);
  const announced = connection.announced(roomPrefix);

  void watchAnnouncements(
    connection,
    announced,
    username,
    signal,
    onGameUpdate,
    onPresenceUpdate,
  );
}

export function stopSubscriber(): void {
  abortController?.abort();
  abortController = null;
  remoteUsers = [];
}

async function watchAnnouncements(
  connection: MoqConnection,
  announced: Moq.Announced,
  localUsername: string,
  signal: AbortSignal,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  const userControllers = new Map<string, AbortController>();

  for (;;) {
    if (signal.aborted) break;

    const entry = await announced.next();
    if (!entry) break;

    const pathStr = entry.path.toString();
    const remoteUsername = pathStr.split("/").at(-1) ?? "";

    if (!remoteUsername || remoteUsername === localUsername) continue;

    if (entry.active) {
      userControllers.get(remoteUsername)?.abort();

      const ctrl = new AbortController();
      userControllers.set(remoteUsername, ctrl);

      ensureRemoteUser(remoteUsername);
      onPresenceUpdate?.([...remoteUsers]);

      const remoteBroadcast = connection.consume(entry.path);
      const gameTrack = remoteBroadcast.subscribe(TRACK_GAME, TRACK_PRIORITY);

      void readGameTrack(
        gameTrack,
        remoteUsername,
        ctrl.signal,
        onGameUpdate,
        onPresenceUpdate,
      );
    } else {
      userControllers.get(remoteUsername)?.abort();
      userControllers.delete(remoteUsername);

      remoteUsers = remoteUsers.filter((u) => u !== remoteUsername);
      onPresenceUpdate?.([...remoteUsers]);
    }
  }

  for (const ctrl of userControllers.values()) {
    ctrl.abort();
  }
}

async function readGameTrack(
  track: Moq.Track,
  username: string,
  signal: AbortSignal,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  for (;;) {
    if (signal.aborted) break;

    const group = await track.nextGroup();
    if (!group) {
      remoteUsers = remoteUsers.filter((u) => u !== username);
      onPresenceUpdate?.([...remoteUsers]);
      break;
    }

    const payload = (await group.readJson()) as GameSnapshot | undefined;
    if (!payload) continue;

    ensureRemoteUser(username);
    onGameUpdate(username, payload);
  }
}

function ensureRemoteUser(username: string): string {
  const existing = remoteUsers.find((u) => u === username);

  if (existing) return existing;

  remoteUsers.push(username);
  return username;
}