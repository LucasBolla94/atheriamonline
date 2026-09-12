import { useState } from 'react';
import { Portrait } from './Art.js';
import { strings } from './strings.js';

export function AppearancePanel({
  current,
  busy,
  error,
  onSave,
  onClose,
}: {
  current: number;
  busy: boolean;
  error: string | null;
  onSave: (look: number) => void;
  onClose: () => void;
}): JSX.Element {
  const [selected, setSelected] = useState(current);
  return (
    <div className="overlay">
      <section
        className="panel appearance-panel"
        role="dialog"
        aria-modal="true"
        aria-label={strings.welcome.chooseLook}
      >
        <h2 className="panel__title">{strings.welcome.chooseLook}</h2>
        <p className="panel__subtitle">{strings.welcome.lookHelp}</p>
        <div className="look-grid">
          {strings.welcome.lookNames.map((name, i) => (
            <button
              key={name}
              type="button"
              className={`look-option ${selected === i ? 'look-option--selected' : ''}`}
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
              disabled={busy}
            >
              <Portrait look={i} />
              <span>{name}</span>
            </button>
          ))}
        </div>
        {error !== null && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="button" onClick={() => onSave(selected)} disabled={busy}>
          {busy ? strings.auth.working : strings.welcome.saveLook}
        </button>
        <button type="button" className="button button--quiet" onClick={onClose}>
          {strings.pouch.close}
        </button>
      </section>
    </div>
  );
}
