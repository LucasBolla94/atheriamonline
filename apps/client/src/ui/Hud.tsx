/**
 * The small readout over the game: where you are and who is near you.
 *
 * It reads state and draws it. It sends nothing and decides nothing.
 */
import { Icon } from './Icon.js';
import { Portrait } from './Art.js';
import { strings } from './strings.js';

export interface HudProps {
  readonly name: string;
  readonly appearance: number;
  readonly onAppearance: () => void;
  readonly onCity: () => void;
  readonly x: number;
  readonly y: number;
  readonly nearbyCount: number;
  readonly touch: boolean;
  /** What is in the purse, already written out. Null until the server says. */
  readonly purse: string | null;
  /** True when the player is inside a house rather than out in the city. */
  readonly indoors: boolean;
  readonly environmentName?: string;
  readonly onOpenPouch: () => void;
  readonly onGoHome: () => void;
  readonly onLogOut: () => void;
}

export function Hud({
  name,
  appearance,
  onAppearance,
  onCity,
  x,
  y,
  nearbyCount,
  touch,
  purse,
  indoors,
  environmentName,
  onOpenPouch,
  onGoHome,
  onLogOut,
}: HudProps): JSX.Element {
  return (
    <div className="hud">
      <div className="resident-card">
        <Portrait look={appearance} />
        <div>
          <strong>{name}</strong>
          <span className="hud__muted">{strings.hud.playersNearby(nearbyCount)}</span>
        </div>
        <span className="online-dot" />
      </div>
      <div className="location-card">
        <Icon name="compass" />
        <div>
          <strong>
            {indoors
              ? (environmentName ?? strings.house.title)
              : y >= 106
                ? strings.welcome.park
                : x < 39 || x > 120
                  ? strings.welcome.neighbourhood
                  : strings.welcome.world}
          </strong>
          <span className="hud__muted">{strings.hud.position(x, y)}</span>
        </div>
      </div>
      <nav className="town-dock" aria-label={strings.appName}>
        <button type="button" className="hud__button" onClick={onOpenPouch}>
          <Icon name="bag" />
          <span>{strings.pouch.open}</span>
          <small>{purse ?? '…'}</small>
        </button>
        <button type="button" className="hud__button" onClick={onCity}>
          <Icon name="compass" />
          <span>{strings.city.open}</span>
        </button>
        <button type="button" className="hud__button" onClick={onGoHome}>
          <Icon name="home" />
          <span>{indoors ? strings.house.leave : strings.house.goHome}</span>
        </button>
        <button type="button" className="hud__button" onClick={onAppearance}>
          <Icon name="shirt" />
          <span>{strings.welcome.look}</span>
        </button>
        <button type="button" className="hud__button" onClick={onLogOut}>
          <Icon name="exit" />
          <span>{strings.auth.logOut}</span>
        </button>
      </nav>
      <p className="hint">{touch ? strings.welcome.portraitHint : strings.hints.desktop}</p>
    </div>
  );
}
