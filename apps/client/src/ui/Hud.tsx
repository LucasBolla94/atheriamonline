/**
 * The small readout over the game: where you are and who is near you.
 *
 * It reads state and draws it. It sends nothing and decides nothing.
 */
import { strings } from './strings.js';

export interface HudProps {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly nearbyCount: number;
  readonly touch: boolean;
  /** What is in the purse, already written out. Null until the server says. */
  readonly purse: string | null;
  readonly onOpenPouch: () => void;
  readonly onLogOut: () => void;
}

export function Hud({
  name,
  x,
  y,
  nearbyCount,
  touch,
  purse,
  onOpenPouch,
  onLogOut,
}: HudProps): JSX.Element {
  return (
    <>
      <div className="hud">
        <span className="hud__dot" aria-hidden="true" />
        <strong>{name}</strong>
        <span className="hud__muted">{strings.hud.position(x, y)}</span>
        <span className="hud__muted">{strings.hud.playersNearby(nearbyCount)}</span>
        <button type="button" className="hud__button" onClick={onOpenPouch}>
          {purse === null ? strings.pouch.open : `${strings.pouch.open} · ${purse}`}
        </button>
        <button type="button" className="hud__button" onClick={onLogOut}>
          {strings.auth.logOut}
        </button>
      </div>
      <p className="hint">{touch ? strings.hints.touch : strings.hints.desktop}</p>
    </>
  );
}
