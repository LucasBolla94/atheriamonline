import { ItemArt } from './Art.js';
/**
 * Your purse and the things you are carrying.
 *
 * It reads what the server says and shows it. The amount arrives as a string
 * and is shown as a string: it is never turned into a number on the way,
 * because a number is exactly what the whole economy is built to avoid.
 */
import type { InventoryItem, Purse, PurseEntry } from '../net/api.js';
import { strings } from './strings.js';

export interface PouchProps {
  readonly purse: Purse | null;
  readonly items: readonly InventoryItem[];
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onClaimDaily: () => void;
  readonly onClose: () => void;
}

export function Pouch({
  purse,
  items,
  busy,
  notice,
  onClaimDaily,
  onClose,
}: PouchProps): JSX.Element {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={strings.pouch.title}>
      <div className="panel panel--small">
        <h2 className="panel__title">{strings.pouch.title}</h2>

        <p className="pouch__amount">{purse?.display ?? strings.pouch.loading}</p>

        <button type="button" className="button" disabled={busy} onClick={onClaimDaily}>
          {strings.pouch.claimDaily}
        </button>
        {notice !== null && <p className="notice notice--quiet">{notice}</p>}

        <h3 className="pouch__heading">{strings.pouch.carrying(items.length)}</h3>
        {items.length === 0 && <p className="notice notice--quiet">{strings.pouch.empty}</p>}
        <ul className="pouch__list">
          {items.map((item) => (
            <li key={item.id} className="pouch__item">
              <ItemArt id={item.definitionId} />
              <strong>{item.name}</strong>
              <span className="pouch__muted">{item.description}</span>
            </li>
          ))}
        </ul>

        {purse !== null && purse.history.length > 0 && (
          <>
            <h3 className="pouch__heading">{strings.pouch.recently}</h3>
            <ul className="pouch__list">
              {purse.history.map((entry: PurseEntry, index: number) => (
                <li key={`${entry.at}-${index}`} className="pouch__item">
                  <strong>{entry.display}</strong>
                  <span className="pouch__muted">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <button type="button" className="button button--quiet" onClick={onClose}>
          {strings.pouch.close}
        </button>
      </div>
    </div>
  );
}
