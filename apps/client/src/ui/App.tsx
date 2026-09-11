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
import type { MapPatch, PlayerView } from '@atheriam/protocol';
import * as api from '../net/api.js';
import { connectToWorld, type ConnectionState, type WorldConnection } from '../net/connection.js';
import { createGame } from '../game/createGame.js';
import { AuthScreen } from './AuthScreen.js';
import { Hud } from './Hud.js';
import { errorMessage } from './strings.js';

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
  const [map, setMap] = useState<MapPatch | null>(null);

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
      onWelcome: (worldMap) => setMap(worldMap),
      onClosed: (reason) => {
        setError(errorMessage(reason));
        setYou(null);
        setMap(null);
        setBusy(false);
        gameRef.current?.destroy(true);
        gameRef.current = null;
      },
    });
  }, []);

  /** If the browser is already logged in, walk straight back into the city. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await api.me();
      if (cancelled) return;
      if (who.ok) {
        await enterCity();
      } else {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterCity]);

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
      setMap(null);
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
    if (!playing || map === null) return;
    const parent = stageRef.current;
    const connection = connectionRef.current;
    if (parent === null || connection === null || gameRef.current !== null) return;

    gameRef.current = createGame({ parent, connection, map });
  }, [playing, map]);

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
