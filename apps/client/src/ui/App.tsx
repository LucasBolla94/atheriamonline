import { CityPanel } from './CityPanel.js';
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
import { AppearancePanel } from './AppearancePanel.js';
import { TouchControls } from './TouchControls.js';
import { AuthScreen } from './AuthScreen.js';
import { ChatPanel } from './ChatPanel.js';
import { Hud } from './Hud.js';
import { PlayerActions } from './PlayerActions.js';
import { Pouch } from './Pouch.js';
import { TradeWindow } from './TradeWindow.js';
import { HousePanel } from './HousePanel.js';
import type { HouseScenery } from '../game/WorldScene.js';
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
  const [pouchOpen, setPouchOpen] = useState(false);
  const [purse, setPurse] = useState<api.Purse | null>(null);
  const [items, setItems] = useState<readonly api.InventoryItem[]>([]);
  const [pouchNotice, setPouchNotice] = useState<string | null>(null);
  const [pouchBusy, setPouchBusy] = useState(false);
  const [trade, setTrade] = useState<api.TradeView | null>(null);
  const [tradeNotice, setTradeNotice] = useState<string | null>(null);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [interior, setInterior] = useState<api.InteriorView | null>(null);
  const [house, setHouse] = useState<api.HouseView | null>(null);
  const [housePanelOpen, setHousePanelOpen] = useState(false);
  const [houseNotice, setHouseNotice] = useState<string | null>(null);
  const [houseBusy, setHouseBusy] = useState(false);
  const [picked, setPicked] = useState<api.InventoryItem | null>(null);
  const [indoors, setIndoors] = useState(false);
  /**
   * The token from a password reset link, if the player arrived on one.
   *
   * Read once, when the page loads. It is not kept in the address bar any
   * longer than it has to be: leaving a working reset token in a URL is how it
   * ends up in a browser history, a shared screenshot or a chat message.
   */
  const [resetToken, setResetToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const found = new URLSearchParams(window.location.search).get('reset');
    return found !== null && found.length >= 16 ? found : null;
  });
  const [cityOpen, setCityOpen] = useState(false);
  const [entryBusy, setEntryBusy] = useState(false);
  const [properties, setProperties] = useState<readonly api.PropertyView[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);
  const refreshCity = useCallback(async () => {
    setCityLoading(true);
    setCityError(null);
    const result = await api.cityProperties();
    setCityLoading(false);
    if (result.ok) setProperties(result.data.properties);
    else setCityError(result.message);
  }, []);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);

  const connectionRef = useRef<WorldConnection | null>(null);
  const enterEnvironment = useCallback(
    async (property: api.PropertyView): Promise<string | null> => {
      const connection = connectionRef.current;
      if (!connection || connection.realm !== 'city') return strings.city.entryFailed;
      connection.stop();
      setEntryBusy(true);
      try {
        const result = await api.enterProperty(property.id);
        if (!result.ok) return result.message;
        const deadline = Date.now() + 10_000;
        while (
          Date.now() < deadline &&
          connectionRef.current === connection &&
          connection.currentState === 'playing'
        ) {
          if (connection.propertyId === property.id) return null;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        return strings.city.entryFailed;
      } finally {
        setEntryBusy(false);
      }
    },
    [],
  );
  /**
   * What the Phaser scene is told about the room it is drawing.
   *
   * Furniture comes from the API and taps go back to React, so this object is
   * the one place the two sides meet. It is a ref because the scene reads it
   * every frame and must never be handed a stale copy.
   */
  const sceneryRef = useRef<HouseScenery>({ furniture: [], revision: 0, onTileClick: null });
  /**
   * How the connection reaches the newest trade-refresher.
   *
   * The connection is made once, with the handlers it was given then. Without
   * this, a nudge arriving an hour later would call the first version of the
   * function and its stale idea of the world.
   */
  const refreshTradeRef = useRef<(() => void) | null>(null);
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
      onNotice: (about) => {
        if (about === 'trade') refreshTradeRef.current?.();
      },
      onRealm: (which, houseId, propertyId) => {
        setIndoors(which !== 'city');
        setChat([]);
        setCityOpen(false);
        setHouse(null);
        setInterior(null);
        sceneryRef.current.furniture = [];
        sceneryRef.current.floorStyle = 'oak';
        sceneryRef.current.wallStyle = 'cream';
        sceneryRef.current.revision += 1;
        setHouseNotice(null);
        setPicked(null);
        if (which === 'property' && propertyId) {
          refreshInteriorRef.current?.(propertyId);
          setHousePanelOpen(true);
        } else if (which === 'house') {
          refreshHouseRef.current?.(houseId);
          setHousePanelOpen(true);
        } else {
          setHouse(null);
          setHousePanelOpen(false);
          sceneryRef.current.furniture = [];
          sceneryRef.current.revision += 1;
        }
      },
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

  /**
   * Ask the API what trade we are in.
   *
   * Called when the world server nudges us, and when the page loads. The nudge
   * carries no detail on purpose: the API is the only thing that knows what is
   * true about a trade, so there is exactly one place to ask.
   */
  const refreshTrade = useCallback(() => {
    void (async () => {
      const result = await api.currentTrade();
      if (!result.ok) return;
      setTrade((previous) => {
        if (previous !== null && result.data.trade === null) {
          setTradeNotice(strings.trade.ended);
        }
        return result.data.trade;
      });
    })();
  }, []);

  /** Every trade action ends the same way: take the answer, or show why not. */
  const tradeAction = useCallback(
    (action: () => Promise<api.ApiResult<{ trade: api.TradeView | null }>>) => {
      setTradeBusy(true);
      setTradeNotice(null);
      void (async () => {
        interiorReadVersion.current += 1;
        const result = await action();
        setTradeBusy(false);
        if (!result.ok) {
          setTradeNotice(result.message);
          return;
        }
        setTrade(result.data.trade);
        refreshPouchRef.current?.();
      })();
    },
    [],
  );

  /** Ask the server what we own. The browser never works this out itself. */
  const refreshPouch = useCallback(() => {
    void (async () => {
      const [balance, carried] = await Promise.all([api.purse(), api.inventory()]);
      if (balance.ok) setPurse(balance.data);
      if (carried.ok) setItems(carried.data.items);
    })();
  }, []);

  // The trade actions need to refresh the purse, and the purse refresher is
  // defined below them; a ref keeps the two from having to be one function.
  const refreshPouchRef = useRef<(() => void) | null>(null);
  refreshPouchRef.current = refreshPouch;

  const handleClaimDaily = useCallback(() => {
    setPouchBusy(true);
    setPouchNotice(null);
    void (async () => {
      const result = await api.claimDailyReward();
      setPouchBusy(false);
      if (!result.ok) {
        setPouchNotice(result.message);
        return;
      }
      setPouchNotice(
        result.data.claimed
          ? strings.pouch.claimed(result.data.display)
          : strings.pouch.alreadyClaimed,
      );
      refreshPouch();
    })();
  }, [refreshPouch]);

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

  refreshTradeRef.current = refreshTrade;

  /**
   * What tapping the floor does.
   *
   * The scene asks this on every tap and walks the player there if it says no.
   * Refs rather than state, because the scene keeps one copy of this function
   * for the life of the game and must see what is true now, not what was true
   * when it was made.
   */
  const pickedRef = useRef<api.InventoryItem | null>(null);
  pickedRef.current = picked;
  const houseRef = useRef<api.HouseView | null>(null);
  houseRef.current = house;

  /** Hand the scene a new set of furniture to draw. */
  const showFurniture = useCallback((contents: readonly api.PlacedItem[]) => {
    sceneryRef.current.furniture = contents;
    sceneryRef.current.revision += 1;
  }, []);

  /** Ask the API about the house the player is standing in. */
  const refreshHouse = useCallback(
    (houseId: string | null) => {
      void (async () => {
        const connection = connectionRef.current;
        const revision = connection?.realmRevision;
        const result = houseId === null ? await api.myHouse() : await api.houseById(houseId);
        if (
          connectionRef.current !== connection ||
          connection?.realm !== 'house' ||
          connection.realmRevision !== revision
        )
          return;
        if (!result.ok) {
          setHouseNotice(result.message);
          return;
        }
        setHouse(result.data);
        showFurniture(result.data.contents);
      })();
    },
    [showFurniture],
  );

  const refreshHouseRef = useRef<((houseId: string | null) => void) | null>(null);
  refreshHouseRef.current = refreshHouse;

  const interiorReadVersion = useRef(0);
  const refreshInterior = useCallback(
    async (id: string) => {
      const requestVersion = ++interiorReadVersion.current;
      const connection = connectionRef.current;
      const revision = connection?.realmRevision;
      const result = await api.propertyInterior(id);
      if (
        connectionRef.current !== connection ||
        connection?.propertyId !== id ||
        requestVersion !== interiorReadVersion.current ||
        connection.realmRevision !== revision
      )
        return;
      if (!result.ok) {
        setHouseNotice(result.message);
        return;
      }
      setInterior(result.data);
      sceneryRef.current.floorStyle = result.data.floorStyle;
      sceneryRef.current.wallStyle = result.data.wallStyle;
      setHouse({
        id,
        yours: result.data.yours,
        access: result.data.access,
        welcomed: result.data.guests,
        contents: result.data.contents,
      });
      showFurniture(result.data.contents);
    },
    [showFurniture],
  );
  const refreshInteriorRef = useRef<((id: string) => void) | null>(null);
  refreshInteriorRef.current = (id) => {
    void refreshInterior(id);
  };

  useEffect(() => {
    if (!playing || !indoors) return;
    let running = false;
    const interval = window.setInterval(() => {
      const id = connectionRef.current?.propertyId;
      if (!id || running) return;
      running = true;
      void refreshInterior(id).finally(() => {
        running = false;
      });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [playing, indoors, refreshInterior]);

  const changePropertyGuest = useCallback((name: string, welcomed: boolean) => {
    const id = connectionRef.current?.propertyId;
    if (!id) return;
    setHouseBusy(true);
    interiorReadVersion.current += 1;
    void api.propertyGuest(id, name, welcomed).then((result) => {
      setHouseBusy(false);
      if (connectionRef.current?.propertyId !== id) return;
      setHouseNotice(result.ok ? null : result.message);
      if (result.ok) {
        interiorReadVersion.current += 1;
        setInterior((current) =>
          current?.id === id ? { ...current, guests: result.data.guests } : current,
        );
        setHouse((current) =>
          current?.id === id ? { ...current, welcomed: result.data.guests } : current,
        );
      }
    });
  }, []);

  /** Every house action ends the same way: new contents, or a reason why not. */
  const houseAction = useCallback(
    (action: () => Promise<api.ApiResult<{ contents: api.PlacedItem[] }>>) => {
      setHouseBusy(true);
      setHouseNotice(null);
      void (async () => {
        const connection = connectionRef.current;
        const revision = connection?.realmRevision;
        interiorReadVersion.current += 1;
        const result = await action();
        setHouseBusy(false);
        if (connectionRef.current !== connection || connection?.realmRevision !== revision) return;
        if (!result.ok) {
          setHouseNotice(result.message);
          return;
        }
        interiorReadVersion.current += 1;
        setHouse((previous) =>
          previous === null ? previous : { ...previous, contents: result.data.contents },
        );
        showFurniture(result.data.contents);
        refreshPouchRef.current?.();
      })();
    },
    [showFurniture],
  );

  /** If the browser is already logged in, walk straight back into the city. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await api.me();
      if (cancelled) return;
      if (who.ok) {
        refreshBlocked();
        refreshPouch();
        refreshTrade();
        await enterCity();
      } else {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterCity, refreshBlocked, refreshPouch, refreshTrade]);

  const handleCreate = useCallback(
    (input: {
      email: string;
      password: string;
      dateOfBirth: string;
      characterName: string;
      appearance?: number;
    }) => {
      setError(null);
      setBusy(true);
      void (async () => {
        const result = await api.register({ ...input, confirmsAdult: true });
        if (!result.ok) {
          setError(result.message);
          setBusy(false);
          return;
        }
        refreshPouch();
        await enterCity();
      })();
    },
    [enterCity, refreshPouch],
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
        refreshBlocked();
        refreshPouch();
        await enterCity();
      })();
    },
    [enterCity, refreshBlocked, refreshPouch],
  );

  /**
   * Ask for a link to choose a new password.
   *
   * Returns the message to show, or null when it worked. The screen itself
   * says the same thing whether or not the address is known, because the
   * server does.
   */
  const handleForgot = useCallback(async (email: string): Promise<string | null> => {
    const result = await api.forgotPassword(email);
    return result.ok ? null : result.message;
  }, []);

  /** Use the link from the email. */
  const handleReset = useCallback(
    async (token: string, password: string): Promise<string | null> => {
      const result = await api.resetPassword(token, password);
      if (!result.ok) return result.message;

      // The token is spent, so the address bar should not keep offering it —
      // a reload would only produce "that link has already been used".
      window.history.replaceState({}, '', window.location.pathname);
      setResetToken(null);
      return null;
    },
    [],
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
      setPouchOpen(false);
      setCityOpen(false);
      setProperties([]);
      setPurse(null);
      setItems([]);
      setTrade(null);
      setHouse(null);
      setInterior(null);
      setIndoors(false);
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

    gameRef.current = createGame({
      parent,
      connection,
      world,
      scenery: sceneryRef.current,
    });
  }, [playing, world]);

  // Tapping the floor while holding something puts it down there instead of
  // walking to it.
  useEffect(() => {
    sceneryRef.current.onTileClick = (x: number, y: number): boolean => {
      const item = pickedRef.current;
      if (item === null) return false;
      if (houseRef.current?.yours !== true) return false;

      const propertyId = connectionRef.current?.propertyId;
      houseAction(() =>
        propertyId
          ? api.decorateProperty(propertyId, {
              action: 'place',
              itemId: item.id,
              x,
              y,
              rotation: 0,
            })
          : api.placeFurniture(item.id, x, y, 0),
      );
      setPicked(null);
      return true;
    };
  }, [houseAction]);

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
  const nearbyEntrance =
    !indoors && you
      ? properties.find(
          (property) =>
            Math.abs(property.address.entrance.x - you.x) <= 2 &&
            Math.abs(property.address.entrance.y - you.y) <= 2 &&
            (property.municipal || property.owned),
        )
      : undefined;

  useEffect(() => {
    if (playing) void refreshCity();
  }, [playing, refreshCity]);

  return (
    <>
      {playing && <div className="stage" ref={stageRef} />}
      {playing && you !== null && (
        <Hud
          name={you.name}
          appearance={you.appearance ?? 0}
          onCity={() => {
            connectionRef.current?.stop();
            void refreshCity();
            refreshPouch();
            setCityOpen(true);
          }}
          onAppearance={() => {
            setAppearanceError(null);
            setAppearanceOpen(true);
          }}
          x={you.x}
          y={you.y}
          nearbyCount={nearbyCount}
          touch={touch}
          purse={purse?.display ?? null}
          indoors={indoors}
          {...(interior ? { environmentName: interior.name } : {})}
          onGoHome={() => {
            void (indoors ? api.leaveHouse() : api.goHome());
          }}
          onOpenPouch={() => {
            setPouchNotice(null);
            refreshPouch();
            setPouchOpen(true);
          }}
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
      {playing && touch && <TouchControls onStep={(dir) => connectionRef.current?.step(dir)} />}
      {playing && appearanceOpen && you !== null && (
        <AppearancePanel
          current={you.appearance ?? 0}
          busy={appearanceBusy}
          error={appearanceError}
          onClose={() => setAppearanceOpen(false)}
          onSave={(look) => {
            setAppearanceBusy(true);
            void api.setAppearance(look).then((result) => {
              setAppearanceBusy(false);
              if (!result.ok) {
                setAppearanceError(result.message);
                return;
              }
              setAppearanceOpen(false);
            });
          }}
        />
      )}
      {playing && nearbyEntrance && !cityOpen && (
        <button
          type="button"
          className="hud__button house__reopen"
          disabled={entryBusy}
          onClick={() => {
            void enterEnvironment(nearbyEntrance).then((message) => {
              if (message) {
                setCityError(message);
                setCityOpen(true);
              }
            });
          }}
        >
          {entryBusy
            ? strings.city.entering
            : `${strings.city.enter}: ${nearbyEntrance.businessName}`}
        </button>
      )}
      {playing && cityOpen && (
        <CityPanel
          properties={properties}
          loading={cityLoading}
          error={cityError}
          purse={purse?.display ?? null}
          canLocate={!indoors}
          onReload={() => {
            void refreshCity();
          }}
          onClose={() => setCityOpen(false)}
          onLocate={(property) => {
            if (indoors) return;
            connectionRef.current?.walkTo(property.address.entrance);
            setCityOpen(false);
          }}
          onEnter={enterEnvironment}
          onBuy={async (id, key) => {
            const result = await api.buyProperty(id, key);
            await refreshCity();
            refreshPouch();
            return result;
          }}
          onSave={async (id, settings) => {
            const result = await api.configureBusiness(id, settings);
            if (result.ok) await refreshCity();
            return result;
          }}
        />
      )}
      {pouchOpen && (
        <Pouch
          purse={purse}
          items={items}
          busy={pouchBusy}
          notice={pouchNotice}
          onClaimDaily={handleClaimDaily}
          onClose={() => setPouchOpen(false)}
        />
      )}
      {housePanelOpen && house !== null && (
        <HousePanel
          house={house}
          {...(interior ? { title: interior.name } : {})}
          accessInGuide={interior !== null}
          inventory={items}
          picked={picked}
          busy={houseBusy}
          notice={houseNotice}
          onPick={setPicked}
          onRotate={(item) =>
            houseAction(() =>
              interior
                ? api.decorateProperty(interior.id, {
                    action: 'rotate',
                    itemId: item.id,
                    rotation: (item.rotation + 90) % 360,
                  })
                : api.rotateFurniture(item.id, (item.rotation + 90) % 360),
            )
          }
          onTakeBack={(item) =>
            houseAction(() =>
              interior
                ? api.decorateProperty(interior.id, { action: 'take', itemId: item.id })
                : api.takeBackFurniture(item.id),
            )
          }
          onAccess={(access) => {
            setHouseBusy(true);
            void (async () => {
              const result = await api.setHouseAccess(access);
              setHouseBusy(false);
              if (result.ok) refreshHouse(null);
            })();
          }}
          onWelcome={(name) => {
            if (interior) {
              changePropertyGuest(name, true);
              return;
            }
            setHouseBusy(true);
            void (async () => {
              const result = await api.welcomeToHouse(name);
              setHouseBusy(false);
              setHouseNotice(result.ok ? null : result.message);
              if (result.ok) refreshHouse(null);
            })();
          }}
          onUnwelcome={(name) => {
            if (interior) {
              changePropertyGuest(name, false);
              return;
            }
            setHouseBusy(true);
            void (async () => {
              await api.unwelcomeFromHouse(name);
              setHouseBusy(false);
              refreshHouse(null);
            })();
          }}
          onLeave={() => {
            void api.leaveHouse();
          }}
          onClose={() => setHousePanelOpen(false)}
        />
      )}
      {indoors && !housePanelOpen && (
        <button
          type="button"
          className="hud__button house__reopen"
          onClick={() => setHousePanelOpen(true)}
        >
          {interior ? strings.city.environment : strings.house.open}
        </button>
      )}
      {trade !== null && (
        <TradeWindow
          trade={trade}
          inventory={items}
          busy={tradeBusy}
          notice={tradeNotice}
          onOffer={(itemId) => tradeAction(() => api.offerItem(trade.id, itemId))}
          onWithdraw={(itemId) => tradeAction(() => api.withdrawItem(trade.id, itemId))}
          onMoney={(amount) => tradeAction(() => api.offerMoney(trade.id, amount))}
          onConfirm={() => tradeAction(() => api.confirmTrade(trade.id))}
          onCancel={() => tradeAction(() => api.cancelTrade(trade.id))}
        />
      )}
      {trade === null && tradeNotice !== null && (
        <p className="chat__notice trade__ended">{tradeNotice}</p>
      )}
      {chosenPlayer !== null && (
        <PlayerActions
          name={chosenPlayer}
          blocked={blocked.includes(chosenPlayer)}
          busy={safetyBusy}
          onBlock={handleBlock}
          onUnblock={handleUnblock}
          onReport={handleReport}
          onTrade={(name) => {
            setChosenPlayer(null);
            tradeAction(() => api.startTrade(name));
          }}
          onVisit={(name) => {
            setChosenPlayer(null);
            void (async () => {
              const result = await api.visitHouse(name);
              if (!result.ok) setChatNotice(result.message);
            })();
          }}
          onClose={() => setChosenPlayer(null)}
        />
      )}
      {!playing && (
        <AuthScreen
          busy={busy || connecting}
          error={error}
          onCreate={handleCreate}
          onLogIn={handleLogIn}
          onForgot={handleForgot}
          onReset={handleReset}
          resetToken={resetToken}
        />
      )}
    </>
  );
}
