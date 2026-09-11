/**
 * The trade window.
 *
 * It draws what the server says is on the table and sends what the player
 * does. It decides nothing: whether an offer is allowed, whether both have
 * agreed, and whether the swap happens are all questions for the server, and
 * this window only ever shows the answer.
 *
 * The one thing it does insist on is showing both sides plainly, including
 * whether the other person has agreed — because a trade window that is unclear
 * is how people get cheated.
 */
import { useState } from 'react';
import type { InventoryItem, TradeView } from '../net/api.js';
import { strings } from './strings.js';

export interface TradeWindowProps {
  readonly trade: TradeView;
  readonly inventory: readonly InventoryItem[];
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onOffer: (itemId: string) => void;
  readonly onWithdraw: (itemId: string) => void;
  readonly onMoney: (amount: string) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function TradeWindow({
  trade,
  inventory,
  busy,
  notice,
  onOffer,
  onWithdraw,
  onMoney,
  onConfirm,
  onCancel,
}: TradeWindowProps): JSX.Element {
  const [amount, setAmount] = useState('');

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={strings.trade.title(trade.them.name)}
    >
      <div className="panel panel--wide">
        <h2 className="panel__title">{strings.trade.title(trade.them.name)}</h2>
        <p className="panel__subtitle">{strings.trade.explain}</p>

        <div className="trade__table">
          <section className="trade__side">
            <h3 className="pouch__heading">{strings.trade.yours}</h3>
            <ul className="pouch__list">
              {trade.yourItems.map((item) => (
                <li key={item.id} className="pouch__item">
                  <button
                    type="button"
                    className="trade__pick"
                    disabled={busy}
                    onClick={() => onWithdraw(item.id)}
                  >
                    {item.name} <span className="pouch__muted">{strings.trade.takeBack}</span>
                  </button>
                </li>
              ))}
              {trade.yourItems.length === 0 && (
                <li className="pouch__muted">{strings.trade.nothingYet}</li>
              )}
            </ul>
            <p className="trade__money">{trade.yourMoneyDisplay}</p>
            <p className={trade.youConfirmed ? 'trade__agreed' : 'pouch__muted'}>
              {trade.youConfirmed ? strings.trade.youAgreed : strings.trade.youHaveNot}
            </p>
          </section>

          <section className="trade__side">
            <h3 className="pouch__heading">{strings.trade.theirs(trade.them.name)}</h3>
            <ul className="pouch__list">
              {trade.theirItems.map((item) => (
                <li key={item.id} className="pouch__item">
                  {item.name}
                </li>
              ))}
              {trade.theirItems.length === 0 && (
                <li className="pouch__muted">{strings.trade.nothingYet}</li>
              )}
            </ul>
            <p className="trade__money">{trade.theirMoneyDisplay}</p>
            <p className={trade.theyConfirmed ? 'trade__agreed' : 'pouch__muted'}>
              {trade.theyConfirmed
                ? strings.trade.theyAgreed(trade.them.name)
                : strings.trade.theyHaveNot(trade.them.name)}
            </p>
          </section>
        </div>

        <h3 className="pouch__heading">{strings.trade.putOn}</h3>
        <ul className="pouch__list">
          {inventory.map((item) => (
            <li key={item.id} className="pouch__item">
              <button
                type="button"
                className="trade__pick"
                disabled={busy}
                onClick={() => onOffer(item.id)}
              >
                {item.name} <span className="pouch__muted">{strings.trade.put}</span>
              </button>
            </li>
          ))}
          {inventory.length === 0 && <li className="pouch__muted">{strings.pouch.empty}</li>}
        </ul>

        <form
          className="chat__form"
          onSubmit={(event) => {
            event.preventDefault();
            onMoney(amount.trim() === '' ? '0' : amount.trim());
          }}
        >
          <input
            className="chat__input"
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder={strings.trade.moneyPlaceholder}
            aria-label={strings.trade.moneyLabel}
            onChange={(event) => setAmount(event.target.value)}
          />
          <button type="submit" className="chat__send" disabled={busy}>
            {strings.trade.setMoney}
          </button>
        </form>
        <p className="notice notice--quiet">{strings.trade.purse(trade.purse)}</p>

        {notice !== null && <p className="notice notice--error">{notice}</p>}

        <button type="button" className="button" disabled={busy} onClick={onConfirm}>
          {trade.youConfirmed ? strings.trade.waiting : strings.trade.agree}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {strings.trade.callOff}
        </button>
      </div>
    </div>
  );
}
