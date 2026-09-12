import { useEffect, useRef, useState } from 'react';
import type { ApiResult, LoungeSchedule, ReservationRequest } from '../net/api.js';
import { strings } from './strings.js';
interface Props {
  schedule: LoungeSchedule | null;
  now: number;
  canEnter: boolean;
  loading: boolean;
  error: string | null;
  onReserve: (input: ReservationRequest) => Promise<ApiResult<unknown>>;
  onInvite: (id: string, name: string, invited: boolean) => Promise<ApiResult<unknown>>;
  onCancel: (id: string) => Promise<ApiResult<unknown>>;
  onEnter: (id: string) => Promise<ApiResult<unknown>>;
  onClose: () => void;
}
function time(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
export function LoungePanel(props: Props): JSX.Element {
  const s = strings.lounge;
  const [tab, setTab] = useState<'agenda' | 'create'>('agenda');
  const [roomId, setRoomId] = useState('studio');
  const [title, setTitle] = useState('');
  const [later, setLater] = useState(false);
  const [date, setDate] = useState('');
  const [durationMinutes, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guest, setGuest] = useState('');
  const retry = useRef({ input: '', key: '' });
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const selected = props.schedule?.bookings.find((entry) => entry.id === selectedId);
  const perform = async (action: () => Promise<ApiResult<unknown>>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.ok ? success : result.message);
      if (result.ok) {
        setCancelId(null);
        setGuest('');
      }
      return result.ok;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lounge-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) props.onClose();
        if (event.key !== 'Tab') return;
        const controls = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
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
      <div className="panel panel--wide lounge-panel" tabIndex={-1} ref={panel}>
        <div className="lounge-heading">
          <h2 id="lounge-title" className="panel__title">
            {s.title}
          </h2>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={props.onClose}
          >
            {s.close}
          </button>
        </div>
        <p>{s.description}</p>
        <div className="tabs" role="group" aria-label={s.title}>
          <button
            type="button"
            className="button button--quiet"
            aria-pressed={tab === 'agenda'}
            disabled={busy}
            onClick={() => setTab('agenda')}
          >
            {s.agenda}
          </button>
          <button
            type="button"
            className="button button--quiet"
            aria-pressed={tab === 'create'}
            disabled={busy}
            onClick={() => setTab('create')}
          >
            {s.create}
          </button>
        </div>
        {(notice || props.error) && (
          <p role="status" className="notice">
            {notice ?? props.error}
          </p>
        )}
        {props.loading && <p>{s.loading}</p>}
        {tab === 'create' && (
          <>
            <p className="pouch__muted">{s.rules}</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                const startsAt = later ? new Date(date) : null;
                if (startsAt && !Number.isFinite(startsAt.getTime())) {
                  setNotice(s.badTime);
                  return;
                }
                const input = {
                  roomId,
                  title: title.trim(),
                  startsAt: startsAt?.toISOString() ?? null,
                  durationMinutes,
                };
                const identity = JSON.stringify(input);
                if (retry.current.input !== identity)
                  retry.current = { input: identity, key: crypto.randomUUID() };
                void perform(
                  () => props.onReserve({ ...input, requestKey: retry.current.key }),
                  s.saved,
                ).then((ok) => {
                  if (ok) {
                    retry.current = { input: '', key: '' };
                    setTab('agenda');
                    setTitle('');
                  }
                });
              }}
            >
              <div className="lounge-fields">
                <label>
                  {s.room}
                  <select
                    value={roomId}
                    disabled={busy}
                    onChange={(event) => setRoomId(event.target.value)}
                  >
                    {props.schedule?.rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} · {s.capacity(room.capacity)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {s.titleLabel}
                  <input
                    value={title}
                    required
                    maxLength={64}
                    disabled={busy}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  {s.when}
                  <select
                    value={later ? 'later' : 'now'}
                    disabled={busy}
                    onChange={(event) => setLater(event.target.value === 'later')}
                  >
                    <option value="now">{s.now}</option>
                    <option value="later">{s.later}</option>
                  </select>
                </label>
                <label>
                  {s.duration}
                  <select
                    value={durationMinutes}
                    disabled={busy}
                    onChange={(event) => setDuration(Number(event.target.value))}
                  >
                    {[30, 60].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {s.minutes(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
                {later && (
                  <label>
                    {s.localTime}
                    <input
                      type="datetime-local"
                      required
                      value={date}
                      disabled={busy}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </label>
                )}
              </div>
              <button type="submit" className="button" disabled={busy || !props.schedule}>
                {s.create}
              </button>
            </form>
            <h3>{s.available}</h3>
            <ul className="lounge-times">
              {props.schedule?.occupied
                .filter((slot) => slot.roomId === roomId)
                .map((slot) => (
                  <li key={slot.startsAt}>
                    {time(slot.startsAt)} – {time(slot.endsAt)}
                  </li>
                ))}
            </ul>
            {!props.schedule?.occupied.some((slot) => slot.roomId === roomId) && (
              <p>{s.noOccupied}</p>
            )}
          </>
        )}
        {tab === 'agenda' && (
          <>
            {!props.loading && props.schedule?.bookings.length === 0 && <p>{s.empty}</p>}
            <ul className="lounge-meetings">
              {props.schedule?.bookings.map((booking) => {
                const active =
                  Date.parse(booking.startsAt) <= props.now &&
                  props.now < Date.parse(booking.endsAt);
                return (
                  <li key={booking.id} className="lounge-card">
                    <button
                      type="button"
                      className="button button--quiet"
                      aria-pressed={selectedId === booking.id}
                      disabled={busy}
                      onClick={() => {
                        setSelectedId(booking.id);
                        setCancelId(null);
                        setGuest('');
                      }}
                    >
                      {booking.title}
                    </button>
                    <p>
                      {props.schedule?.rooms.find((room) => room.id === booking.roomId)?.name} ·{' '}
                      {booking.yours ? s.hosted : s.invited}
                    </p>
                    <p>
                      {time(booking.startsAt)} – {time(booking.endsAt)}
                    </p>
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !active || !props.canEnter}
                      onClick={() => void perform(() => props.onEnter(booking.id), '')}
                    >
                      {s.enter}
                    </button>
                    {!active && (
                      <p className="pouch__muted">
                        {props.now < Date.parse(booking.startsAt) ? s.future : s.ended}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {selected?.yours && (
              <section className="lounge-management" aria-label={selected.title}>
                <h3>
                  {selected.title} · {s.guests}
                </h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!busy && guest.trim())
                      void perform(
                        () => props.onInvite(selected.id, guest.trim(), true),
                        s.invitedSuccess,
                      );
                  }}
                >
                  <label>
                    {s.guestName}
                    <input
                      value={guest}
                      required
                      maxLength={24}
                      disabled={busy}
                      onChange={(event) => setGuest(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="button" disabled={busy}>
                    {s.invite}
                  </button>
                </form>
                {selected.guests.length === 0 && <p>{s.noGuests}</p>}
                <ul>
                  {selected.guests.map((name) => (
                    <li key={name}>
                      {name}{' '}
                      <button
                        type="button"
                        className="button button--quiet"
                        disabled={busy}
                        onClick={() =>
                          void perform(() => props.onInvite(selected.id, name, false), s.removed)
                        }
                      >
                        {s.remove}
                      </button>
                    </li>
                  ))}
                </ul>
                {cancelId === selected.id ? (
                  <div className="city-guide__actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void perform(() => props.onCancel(selected.id), s.cancelled)}
                    >
                      {s.confirmCancel}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy}
                      onClick={() => setCancelId(null)}
                    >
                      {s.keep}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={busy}
                    onClick={() => setCancelId(selected.id)}
                  >
                    {s.cancel}
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
