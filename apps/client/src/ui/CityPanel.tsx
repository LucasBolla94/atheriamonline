import { useEffect, useRef, useState } from 'react';
import type { ApiResult, BusinessSettings, PropertyView } from '../net/api.js';
import { strings } from './strings.js';
import { Icon } from './Icon.js';

type Filter = 'all' | 'sale' | 'yours' | 'public';
interface Props {
  properties: readonly PropertyView[];
  loading: boolean;
  error: string | null;
  purse: string | null;
  canLocate: boolean;
  onReload: () => void;
  onClose: () => void;
  onLocate: (property: PropertyView) => void;
  onEnter: (property: PropertyView) => Promise<string | null>;
  onBuy: (id: string, key: string) => Promise<ApiResult<unknown>>;
  onSave: (id: string, settings: BusinessSettings) => Promise<ApiResult<unknown>>;
}

export function CityPanel(props: Props): JSX.Element {
  const s = strings.city;
  const [filter, setFilter] = useState<Filter>('all');
  const [chosen, setChosen] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKey = useRef('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const property = props.properties.find((p) => p.id === chosen);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const visible = props.properties.filter(
    (p) =>
      filter === 'all' ||
      (filter === 'sale' && !p.municipal && !p.owned) ||
      (filter === 'yours' && p.yours) ||
      (filter === 'public' && p.municipal),
  );

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) props.onClose();
        if (event.key !== 'Tab') return;
        const controls = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea',
        );
        if (controls === undefined || controls.length === 0) return;
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
      <div className="panel city-guide" ref={panelRef}>
        <header className="city-guide__header">
          <div>
            <p className="city-guide__eyebrow">{s.open}</p>
            <h2 id="city-title">{s.title}</h2>
            <p>{s.subtitle}</p>
          </div>
          <button
            className="button button--quiet"
            type="button"
            ref={closeRef}
            onClick={props.onClose}
            disabled={busy}
          >
            {s.close}
          </button>
        </header>
        <nav className="tabs" aria-label={s.open}>
          {(['all', 'sale', 'yours', 'public'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`tab ${filter === value ? 'tab--active' : ''}`}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setChosen(null);
                setBuying(false);
                setNotice(null);
              }}
              disabled={busy}
            >
              {s[value]}
            </button>
          ))}
        </nav>
        {(notice !== null || props.error !== null) && (
          <p role="status" className="notice">
            {notice ?? props.error}
          </p>
        )}
        {props.error !== null && (
          <button type="button" className="button" onClick={props.onReload}>
            {s.retry}
          </button>
        )}
        {props.loading && <p role="status">{s.loading}</p>}
        {property !== undefined && buying && (
          <section className="city-guide__confirmation" aria-label={s.purchaseTitle}>
            <h3>{s.purchaseTitle}</h3>
            <strong>{property.address.name}</strong>
            <p>{s.purchaseHelp}</p>
            <dl>
              <dt>{s.price}</dt>
              <dd>{property.priceDisplay}</dd>
              <dt>{s.balance}</dt>
              <dd>{props.purse ?? '…'}</dd>
            </dl>
            <div className="city-guide__actions">
              <button
                className="button"
                type="button"
                disabled={busy || property.owned}
                onClick={() => {
                  setBusy(true);
                  setNotice(null);
                  void props.onBuy(property.id, requestKey.current).then((result) => {
                    setBusy(false);
                    if (!result.ok) {
                      setNotice(result.message);
                      return;
                    }
                    setNotice(s.purchased);
                    setBuying(false);
                    setFilter('yours');
                  });
                }}
              >
                {busy ? strings.auth.working : s.confirm}
              </button>
              <button
                className="button button--quiet"
                type="button"
                disabled={busy}
                onClick={() => setBuying(false)}
              >
                {s.cancel}
              </button>
            </div>
          </section>
        )}
        {property?.yours === true && !buying && (
          <BusinessForm
            key={property.id}
            property={property}
            busy={busy}
            onSave={(settings) => {
              setBusy(true);
              setNotice(null);
              void props.onSave(property.id, settings).then((result) => {
                setBusy(false);
                setNotice(result.ok ? s.saved : result.message);
              });
            }}
          />
        )}
        <div className="city-guide__grid">
          {visible.map((p) => (
            <article className={`city-guide__card city-guide__card--${p.address.style}`} key={p.id}>
              <img
                className="city-guide__building"
                src={`/art/building-${p.address.use}.png`}
                alt=""
                width="128"
                height="128"
              />
              <div className="city-guide__symbol">
                <Icon name={p.municipal ? 'compass' : 'home'} />
                <span>
                  {p.yours
                    ? s.yourProperty
                    : p.municipal
                      ? s.municipal
                      : p.owned
                        ? s.owned
                        : s.sale}
                </span>
              </div>
              <h3>{p.businessName}</h3>
              <p>{p.address.name}</p>
              {p.description.length > 0 && <p>{p.description}</p>}
              {!p.municipal && !p.owned && <strong>{p.priceDisplay}</strong>}
              <div className="city-guide__actions">
                {!p.municipal && !p.owned && (
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setChosen(p.id);
                      setBuying(true);
                      setNotice(null);
                      requestKey.current = crypto.randomUUID();
                      panelRef.current?.scrollTo({ top: 0 });
                    }}
                  >
                    {s.buy}
                  </button>
                )}
                {p.yours && (
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setChosen(p.id);
                      setBuying(false);
                      setNotice(null);
                    }}
                  >
                    {s.settings}
                  </button>
                )}
                {(p.municipal || p.owned) && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy || !props.canLocate}
                    onClick={() => {
                      setBusy(true);
                      setNotice(s.entering);
                      void props.onEnter(p).then((error) => {
                        setBusy(false);
                        setNotice(error);
                      });
                    }}
                  >
                    {s.enter}
                  </button>
                )}
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy || !props.canLocate}
                  onClick={() => props.onLocate(p)}
                >
                  {s.locate}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!props.loading && visible.length === 0 && <p>{s.empty}</p>}
      </div>
    </div>
  );
}

function BusinessForm({
  property,
  busy,
  onSave,
}: {
  property: PropertyView;
  busy: boolean;
  onSave: (settings: BusinessSettings) => void;
}): JSX.Element {
  const s = strings.city;
  const [settings, setSettings] = useState<BusinessSettings>({
    businessName: property.businessName,
    description: property.description,
    access: property.access,
    published: property.published,
    floorStyle: property.floorStyle,
    wallStyle: property.wallStyle,
  });
  return (
    <form
      className="city-guide__form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(settings);
      }}
    >
      <h3>{s.settings}</h3>
      <label>
        {s.name}
        <input
          required
          minLength={3}
          maxLength={48}
          value={settings.businessName}
          onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
        />
      </label>
      <label>
        {s.description}
        <textarea
          maxLength={300}
          value={settings.description}
          onChange={(e) => setSettings({ ...settings, description: e.target.value })}
        />
      </label>
      <label>
        {s.access}
        <select
          aria-label={s.access}
          value={settings.access}
          onChange={(e) =>
            setSettings({ ...settings, access: e.target.value as BusinessSettings['access'] })
          }
        >
          {(['nobody', 'welcomed', 'everyone'] as const).map((v) => (
            <option key={v} value={v}>
              {strings.house.access[v]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {s.floor}
        <select
          aria-label={s.floor}
          value={settings.floorStyle}
          onChange={(e) =>
            setSettings({
              ...settings,
              floorStyle: e.target.value as BusinessSettings['floorStyle'],
            })
          }
        >
          {(['oak', 'stone', 'tile'] as const).map((v) => (
            <option key={v} value={v}>
              {s[v]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {s.wall}
        <select
          aria-label={s.wall}
          value={settings.wallStyle}
          onChange={(e) =>
            setSettings({ ...settings, wallStyle: e.target.value as BusinessSettings['wallStyle'] })
          }
        >
          {(['cream', 'teal', 'rose'] as const).map((v) => (
            <option key={v} value={v}>
              {s[v]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.published}
          onChange={(e) => setSettings({ ...settings, published: e.target.checked })}
        />
        {s.publish}
      </label>
      <button className="button" disabled={busy}>
        {busy ? strings.auth.working : s.save}
      </button>
    </form>
  );
}
