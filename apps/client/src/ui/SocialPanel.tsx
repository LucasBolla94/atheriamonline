import { strings } from './strings.js';

export function SocialPanel({
  seated,
  canSit,
  onAction,
  onClose,
}: {
  seated: boolean;
  canSit: boolean;
  onAction: (action: 'wave' | 'sit' | 'stand') => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="overlay">
      <section className="panel" role="dialog" aria-modal="true" aria-label={strings.social.title}>
        <h2 className="panel__title">{strings.social.title}</h2>
        <p className="panel__subtitle">{strings.social.help}</p>
        <button type="button" className="button" onClick={() => onAction('wave')}>
          {strings.social.wave}
        </button>
        {seated ? (
          <button type="button" className="button" onClick={() => onAction('stand')}>
            {strings.social.stand}
          </button>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!canSit}
            onClick={() => onAction('sit')}
          >
            {strings.social.sit}
          </button>
        )}
        {!canSit && !seated && <p className="panel__subtitle">{strings.social.noSeat}</p>}
        <button type="button" className="button button--quiet" onClick={onClose}>
          {strings.pouch.close}
        </button>
      </section>
    </div>
  );
}
