import { ItemArt } from './Art.js';
/**
 * Your own four walls: who may come in, and what is standing in them.
 *
 * Arranging is deliberately two steps — pick a thing, then tap where it goes —
 * because on a phone there is no such thing as dragging something small
 * accurately.
 */
import type { HouseView, InventoryItem, PlacedItem } from '../net/api.js';
import { strings } from './strings.js';

export interface HousePanelProps {
  readonly house: HouseView;
  readonly title?: string;
  readonly accessInGuide?: boolean;
  readonly inventory: readonly InventoryItem[];
  readonly picked: InventoryItem | null;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onPick: (item: InventoryItem | null) => void;
  readonly onRotate: (item: PlacedItem) => void;
  readonly onTakeBack: (item: PlacedItem) => void;
  readonly onAccess: (access: HouseView['access']) => void;
  readonly onWelcome: (name: string) => void;
  readonly onUnwelcome: (name: string) => void;
  readonly onLeave: () => void;
  readonly onClose: () => void;
}

const ACCESS_ORDER: ReadonlyArray<HouseView['access']> = ['nobody', 'welcomed', 'everyone'];

export function HousePanel({
  house,
  title,
  accessInGuide = false,
  inventory,
  picked,
  busy,
  notice,
  onPick,
  onRotate,
  onTakeBack,
  onAccess,
  onWelcome,
  onUnwelcome,
  onLeave,
  onClose,
}: HousePanelProps): JSX.Element {
  const furniture = inventory.filter((item) => item.kind === 'furniture');

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? strings.house.title}
    >
      <div className="panel panel--wide">
        <h2 className="panel__title">
          {title ?? (house.yours ? strings.house.title : strings.house.visiting)}
        </h2>

        {house.yours && (
          <>
            <h3 className="pouch__heading">{strings.house.door}</h3>
            {accessInGuide ? (
              <p className="notice notice--quiet">{strings.city.accessInGuide}</p>
            ) : (
              <div className="tabs" role="group" aria-label={strings.house.door}>
                {ACCESS_ORDER.map((access) => (
                  <button
                    key={access}
                    type="button"
                    className={`tab ${house.access === access ? 'tab--active' : ''}`}
                    disabled={busy}
                    onClick={() => onAccess(access)}
                  >
                    {strings.house.access[access]}
                  </button>
                ))}
              </div>
            )}
            <p className="notice notice--quiet">{strings.house.accessHelp[house.access]}</p>

            {house.access === 'welcomed' && (
              <>
                <h3 className="pouch__heading">{strings.house.welcomed}</h3>
                <ul className="pouch__list">
                  {house.welcomed.map((name) => (
                    <li key={name} className="pouch__item">
                      <button
                        type="button"
                        className="trade__pick"
                        disabled={busy}
                        onClick={() => onUnwelcome(name)}
                      >
                        {name} <span className="pouch__muted">{strings.house.stopWelcoming}</span>
                      </button>
                    </li>
                  ))}
                  {house.welcomed.length === 0 && (
                    <li className="pouch__muted">{strings.house.nobodyWelcomed}</li>
                  )}
                </ul>
                <form
                  className="chat__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const field = new FormData(event.currentTarget).get('name');
                    if (typeof field === 'string' && field.trim().length > 0) {
                      onWelcome(field.trim());
                      event.currentTarget.reset();
                    }
                  }}
                >
                  <input
                    className="chat__input"
                    name="name"
                    type="text"
                    placeholder={strings.house.welcomePlaceholder}
                    aria-label={strings.house.welcomeLabel}
                  />
                  <button type="submit" className="chat__send" disabled={busy}>
                    {strings.house.welcomeSubmit}
                  </button>
                </form>
              </>
            )}

            <h3 className="pouch__heading">{strings.house.arranging}</h3>
            <p className="notice notice--quiet">
              {picked === null ? strings.house.pickSomething : strings.house.nowTap(picked.name)}
            </p>
            <ul className="pouch__list">
              {furniture.map((item) => (
                <li key={item.id} className="pouch__item">
                  <button
                    type="button"
                    className="trade__pick"
                    disabled={busy}
                    onClick={() => onPick(picked?.id === item.id ? null : item)}
                  >
                    {item.name}{' '}
                    <span className="pouch__muted">
                      {picked?.id === item.id ? strings.house.chosen : strings.house.choose}
                    </span>
                  </button>
                </li>
              ))}
              {furniture.length === 0 && (
                <li className="pouch__muted">{strings.house.noFurniture}</li>
              )}
            </ul>
          </>
        )}

        <h3 className="pouch__heading">{strings.house.standingHere}</h3>
        <ul className="pouch__list">
          {house.contents.map((item) => (
            <li key={item.id} className="pouch__item">
              <ItemArt id={item.definitionId} />
              <strong>{item.name}</strong>
              <span className="pouch__muted">{strings.house.at(item.x, item.y)}</span>
              {house.yours && (
                <span>
                  <button
                    type="button"
                    className="trade__pick"
                    disabled={busy}
                    onClick={() => onRotate(item)}
                  >
                    {strings.house.turn}
                  </button>
                  <button
                    type="button"
                    className="trade__pick"
                    disabled={busy}
                    onClick={() => onTakeBack(item)}
                  >
                    {strings.house.pickUp}
                  </button>
                </span>
              )}
            </li>
          ))}
          {house.contents.length === 0 && <li className="pouch__muted">{strings.house.bare}</li>}
        </ul>

        {notice !== null && <p className="notice notice--quiet">{notice}</p>}

        <button type="button" className="button" disabled={busy} onClick={onLeave}>
          {strings.house.leave}
        </button>
        <button type="button" className="button button--quiet" onClick={onClose}>
          {strings.pouch.close}
        </button>
      </div>
    </div>
  );
}
