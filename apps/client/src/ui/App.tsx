/**
 * The whole interface, and the one place that owns the connection.
 *
 * The split this file keeps: React draws the screen around the game, Phaser
 * draws the world inside it, and the connection is the only thing that talks
 * to the world server. None of them know the game's rules — those are on the
 * server.
 *
 * Entering the city takes three steps, and they are separate on purpose:
 *   1. log in, which gives the browser a session cookie it cannot read;
 *   2. ask the API for a world ticket, which lasts thirty seconds;
 *   3. open the WebSocket with that ticket.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import type { PlayerView, WorldInfo } from '@atheriam/protocol';
import * as api from '../net/api.js';
import {
  connectToWorld,
  type ChatEntry,
  type ConnectionState,
  type WorldConnection,
} from '../net/connection.js';
import { createGame } from '../game/createGame.js';
import { AuthScreen } from './AuthScreen.js';
import { ChatPanel } from './ChatPanel.js';
import { Hud } from './Hud.js';
import { PlayerActions } from './PlayerActions.js';
import { errorMessage, strings } from './strings.js';

/** Where the world server is. In production Caddy serves it under /ws. */
function worldUrl(): string {
  const fromEnv = import.meta.env['VITE_WORLD_URL'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) return `${protocol}//${window.location.hostname}:3002`;
  return `${protocol}//${window.location.host}/ws`;
}

export function App(): JSX.Element {
  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [you, setYou] = useState<PlayerView | null>(null);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [world, setWorld] = useState<WorldInfo | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [chosenPlayer, setChosenPlayer] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<readonly string[]>([]);
  const [safetyBusy, setSafetyBusy] = useState(false);

  const connectionRef = useRef<WorldConnection | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const playing = state === 'playing' && you !== null;

  /** Steps 2 and 3: get a ticket, then open the socket with it. */
  const enterCity = useCallback(async () => {
    const ticket = await api.worldTicket();
    if (!ticket.ok) {
      setError(ticket.message);
      setBusy(false);
      return;
    }

    connectionRef.current = connectToWorld(worldUrl(), ticket.data.ticket, {
      onStateChange: setState,
      onSnapshot: (self, others) => {
        setYou(self);
        setNearbyCount(others.length);
      },
      onWelcome: (info) => setWorld(info),
      onChat: (entry) => setChat((previous) => [...previous, entry]),
      onReject: (reason) => {
        // Most refusals are ordinary and the next snapshot corrects them. The
        // two about talking are the exception: the player needs to know why
        // what they typed did not appear.
        if (reason === 'muted') setChatNotice(strings.chat.muted);
        else if (reason === 'too-chatty') setChatNotice(strings.chat.tooChatty);
      },
      onClosed: (reason) => {
        setError(errorMessage(reason));
        setYou(null);
        setWorld(null);
        setChat([]);
        setBusy(false);
        gameRef.current?.destroy(true);
        gameRef.current = null;
      },
    });
  }, []);

  /** The list of people this player has chosen not to hear. */
  const refreshBlocked = useCallback(() => {
    void (async () => {
      const result = await api.blockedPlayers();
      if (result.ok) setBlocked(result.data.names);
    })();
  }, []);

  const handleSay = useCallback((text: string) => {
    setChatNotice(null);
    connectionRef.current?.say(text);
  }, []);

  const handleBlock = useCallback(
    (name: string) => {
      setSafetyBusy(true);
      void (async () => {
        const result = await api.blockPlayer(name);
        setSafetyBusy(false);
        if (!result.ok) {
          setChatNotice(result.message);
          return;
        }
        setChatNotice(strings.safety.blocked(name));
        setChosenPlayer(null);
        refreshBlocked();
      })();
    },
    [refreshBlocked],
  );

  const handleUnblock = useCallback(
    (name: string) => {
      setSafetyBusy(true);
      void (async () => {
        const result = await api.unblockPlayer(name);
        setSafetyBusy(false);
        if (!result.ok) {
          setChatNotice(result.message);
          return;
        }
        setChatNotice(strings.safety.unblocked(name));
        setChosenPlayer(null);
        refreshBlocked();
      })();
    },
    [refreshBlocked],
  );

  const handleReport = useCallback((name: string, reason: string) => {
    setSafetyBusy(true);
    void (async () => {
      const result = await api.reportPlayer(name, reason);
      setSafetyBusy(false);
      setChatNotice(result.ok ? strings.safety.reportSent : result.message);
      setChosenPlayer(null);
    })();
  }, []);

  /** If the browser is already logged in, walk straight back into the city. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await api.me();
      if (cancelled) return;
      if (who.ok) {
        refreshBlocked();
        await enterCity();
      } else {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterCity, refreshBlocked]);

  const handleCreate = useCallback(
    (input: { email: string; password: string; dateOfBirth: string; characterName: string }) => {
      setError(null);
      setBusy(true);
      void (async () => {
        const result = await api.register({ ...input, confirmsAdult: true });
        if (!result.ok) {
          setError(result.message);
          setBusy(false);
          return;
        }
        await enterCity();
      })();
    },
    [enterCity],
  );

  const handleLogIn = useCallback(
    (email: string, password: string) => {
      setError(null);
      setBusy(true);
      void (async () => {
        const result = await api.logIn(email, password);
        if (!result.ok) {
          setError(result.message);
          setBusy(false);
          return;
        }
        await enterCity();
      })();
    },
    [enterCity],
  );

  const handleLogOut = useCallback(() => {
    void (async () => {
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
      await api.logOut();
      setYou(null);
      setWorld(null);
      setChat([]);
      setChosenPlayer(null);
      setState('idle');
      setError(null);
      setBusy(false);
    })();
  }, []);

  /**
   * Start Phaser only once the stage is actually on screen.
   *
   * This is not a detail. Phaser measures its parent when it starts, and a
   * parent that is still hidden measures zero, which leaves a 0x0 canvas that
   * never recovers — the game looks like it failed to load.
   */
  useEffect(() => {
    if (!playing || world === null) return;
    const parent = stageRef.current;
    const connection = connectionRef.current;
    if (parent === null || connection === null || gameRef.current !== null) return;

    gameRef.current = createGame({ parent, connection, world });
  }, [playing, world]);

  // Leave the city tidily if the tab goes away, so the server does not have to
  // wait for a timeout to notice — and so the player's position is saved.
  useEffect(() => {
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      connectionRef.current?.disconnect();
      connectionRef.current = null;
    };
  }, []);

  const connecting = state === 'connecting' || state === 'joining';
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  return (
    <>
      {playing && <div className="stage" ref={stageRef} />}
      {playing && you !== null && (
        <Hud
          name={you.name}
          x={you.x}
          y={you.y}
          nearbyCount={nearbyCount}
          touch={touch}
          onLogOut={handleLogOut}
        />
      )}
      {playing && (
        <ChatPanel
          entries={chat}
          myPlayerId={connectionRef.current?.playerId ?? null}
          notice={chatNotice}
          onSay={handleSay}
          onChoosePlayer={setChosenPlayer}
        />
      )}
      {chosenPlayer !== null && (
        <PlayerActions
          name={chosenPlayer}
          blocked={blocked.includes(chosenPlayer)}
          busy={safetyBusy}
          onBlock={handleBlock}
          onUnblock={handleUnblock}
          onReport={handleReport}
          onClose={() => setChosenPlayer(null)}
        />
      )}
      {!playing && (
        <AuthScreen
          busy={busy || connecting}
          error={error}
          onCreate={handleCreate}
          onLogIn={handleLogIn}
        />
      )}
    </>
  );
}
