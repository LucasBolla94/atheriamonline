import { useEffect, useRef, useState } from 'react';
import type { ApiResult, InventoryItem, ShopItem } from '../net/api.js';
import { ItemArt } from './Art.js';
import { strings } from './strings.js';

interface Props {
  name: string;
  yours: boolean;
  items: readonly ShopItem[];
  inventory: readonly InventoryItem[];
  purse: string | null;
  loading: boolean;
  error: string | null;
  onCreate: (itemId: string, price: string, key: string) => Promise<ApiResult<unknown>>;
  onBuy: (id: string, key: string) => Promise<ApiResult<unknown>>;
  onCancel: (id: string) => Promise<ApiResult<unknown>>;
  onClose: () => void;
}
export function ShopPanel(props: Props): JSX.Element {
  const s = strings.shop;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<ShopItem | null>(null);
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const listingKey = useRef({ input: '', key: '' });
  const purchaseKey = useRef('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const perform = async (action: () => Promise<ApiResult<unknown>>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.ok ? success : result.message);
      if (result.ok) {
        setReview(null);
        listingKey.current = { input: '', key: '' };
        setItemId('');
        setPrice('');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shop-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) props.onClose();
        if (event.key !== 'Tab') return;
        const controls = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select',
        );
        if (!controls?.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="panel panel--wide shop-panel" tabIndex={-1} ref={panel}>
        <h2 id="shop-title" className="panel__title">
          {s.title}
        </h2>
        <p>
          {props.name}
          {review === null ? ` · ${s.subtitle}` : ''}
        </p>
        <p>
          <strong>
            {s.balance}: {props.purse ?? '…'}
          </strong>
        </p>
        {(notice || props.error) && (
          <p role="status" className="notice">
            {notice ?? props.error}
          </p>
        )}
        {props.loading && <p>{s.loading}</p>}
        {review && (
          <section className="city-guide__confirmation" aria-label={s.review}>
            <div className="shop-review__item">
              <ItemArt id={review.definitionId} />
              <div>
                <h3>{review.name}</h3>
                <strong>{review.priceDisplay}</strong>
                <p>{review.description}</p>
              </div>
            </div>
            <p>{s.reviewHelp}</p>
            <div className="city-guide__actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  void perform(() => props.onBuy(review.id, purchaseKey.current), s.bought);
                }}
              >
                {s.confirm}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                {s.cancel}
              </button>
            </div>
          </section>
        )}
        {props.yours && (
          <form
            className="city-guide__form"
            onSubmit={(event) => {
              event.preventDefault();
              const input = JSON.stringify([itemId, price]);
              if (listingKey.current.input !== input)
                listingKey.current = { input, key: crypto.randomUUID() };
              void perform(() => props.onCreate(itemId, price, listingKey.current.key), s.listed);
            }}
          >
            <h3>{s.listTitle}</h3>
            <label htmlFor="shop-item">{s.item}</label>
            <select
              id="shop-item"
              required
              value={itemId}
              disabled={busy}
              onChange={(event) => setItemId(event.target.value)}
            >
              <option value="">{s.choose}</option>
              {props.inventory.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <label htmlFor="shop-price">{s.price}</label>
            <input
              id="shop-price"
              required
              inputMode="decimal"
              maxLength={20}
              value={price}
              disabled={busy}
              onChange={(event) => setPrice(event.target.value)}
              aria-describedby="shop-price-help"
            />
            <p id="shop-price-help" className="notice notice--quiet">
              {s.priceHelp}
            </p>
            <button type="submit" className="button" disabled={busy || !itemId || !price}>
              {s.list}
            </button>
            {props.inventory.length === 0 && <p>{s.noInventory}</p>}
          </form>
        )}
        {review === null && (
          <ul className="pouch__list">
            {props.items.map((item) => (
              <li key={item.id} className="pouch__item">
                <ItemArt id={item.definitionId} />
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                  <strong>{item.priceDisplay}</strong>
                </div>
                {props.yours ? (
                  <button
                    type="button"
                    className="trade__pick"
                    disabled={busy}
                    onClick={() => {
                      void perform(() => props.onCancel(item.id), s.withdrawn);
                    }}
                  >
                    {s.withdraw}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="trade__pick"
                    disabled={busy}
                    onClick={() => {
                      setReview(item);
                      setNotice(null);
                      purchaseKey.current = crypto.randomUUID();
                      panel.current?.scrollTo({ top: 0 });
                    }}
                  >
                    {s.review}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!props.loading && props.items.length === 0 && <p>{s.empty}</p>}
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={props.onClose}
        >
          {s.close}
        </button>
      </div>
    </div>
  );
}
