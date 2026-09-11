/**
 * The whole interface, and the one place that owns the connection.
 *
 * The split this file keeps: React draws the screen around the game, Phaser
 * draws the world inside it, and the connection is the only thing that talks
 * to the server. None of them know the game's rules — those are on the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import type { MapPatch, PlayerView } from '@atheriam/protocol';
import { connectToWorld, type ConnectionState, type WorldConnection } from '../net/connection.js';
import { createGame } from '../game/createGame.js';
import { Hud } from './Hud.js';
import { JoinScreen } from './JoinScreen.js';
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
  const [you, setYou] = useState<PlayerView | null>(null);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [map, setMap] = useState<MapPatch | null>(null);

  const connectionRef = useRef<WorldConnection | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const playing = state === 'playing' && you !== null;

  const handleJoin = useCallback((name: string) => {
    setError(null);
    const connection = connectToWorld(worldUrl(), name, {
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
        gameRef.current?.destroy(true);
        gameRef.current = null;
      },
    });
    connectionRef.current = connection;
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
  // wait for a timeout to notice.
  useEffect(() => {
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      connectionRef.current?.disconnect();
      connectionRef.current = null;
    };
  }, []);

  const busy = state === 'connecting' || state === 'joining';
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  return (
    <>
      {playing && <div className="stage" ref={stageRef} />}
      {playing && you !== null && (
        <Hud name={you.name} x={you.x} y={you.y} nearbyCount={nearbyCount} touch={touch} />
      )}
      {!playing && <JoinScreen busy={busy} error={error} onJoin={handleJoin} />}
    </>
  );
}
