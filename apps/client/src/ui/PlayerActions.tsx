/**
 * What you can do about another player: stop hearing them, or report them.
 *
 * Both are deliberately plain and always available. A block takes effect at
 * once and tells the other person nothing; a report goes to a human being and
 * silences nobody by itself.
 */
import { useState } from 'react';
import { strings } from './strings.js';

export interface PlayerActionsProps {
  readonly name: string;
  readonly blocked: boolean;
  readonly busy: boolean;
  readonly onBlock: (name: string) => void;
  readonly onUnblock: (name: string) => void;
  readonly onReport: (name: string, reason: string) => void;
  readonly onTrade: (name: string) => void;
  readonly onVisit: (name: string) => void;
  readonly onClose: () => void;
}

export function PlayerActions({
  name,
  blocked,
  busy,
  onBlock,
  onUnblock,
  onReport,
  onTrade,
  onVisit,
  onClose,
}: PlayerActionsProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [reporting, setReporting] = useState(false);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={strings.safety.title(name)}
    >
      <div className="panel panel--small">
        <h2 className="panel__title">{name}</h2>
        <p className="panel__subtitle">{strings.safety.subtitle}</p>

        {!reporting && (
          <>
            <button type="button" className="button" disabled={busy} onClick={() => onTrade(name)}>
              {strings.trade.offer}
            </button>
            <p className="notice notice--quiet">{strings.trade.explain}</p>

            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => (blocked ? onUnblock(name) : onBlock(name))}
            >
              {blocked ? strings.safety.unblock : strings.safety.block}
            </button>
            <p className="notice notice--quiet">
              {blocked ? strings.safety.unblockHelp : strings.safety.blockHelp}
            </p>

            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => onVisit(name)}
            >
              {strings.house.visit}
            </button>
            <p className="notice notice--quiet">{strings.house.accessHelp['welcomed']}</p>

            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => setReporting(true)}
            >
              {strings.safety.report}
            </button>
            <p className="notice notice--quiet">{strings.safety.reportHelp}</p>
          </>
        )}

        {reporting && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim().length < 3) return;
              onReport(name, reason.trim());
            }}
          >
            <label className="field">
              <span className="field__label">{strings.safety.reasonLabel}</span>
              <input
                className="field__input"
                type="text"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                autoFocus
              />
            </label>
            <button type="submit" className="button" disabled={busy || reason.trim().length < 3}>
              {strings.safety.sendReport}
            </button>
          </form>
        )}

        <button type="button" className="button button--quiet" onClick={onClose}>
          {strings.safety.close}
        </button>
      </div>
    </div>
  );
}
