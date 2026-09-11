/**
 * The first thing a player sees: pick a name, confirm you are an adult, enter.
 *
 * There is no gameplay logic here. The screen collects a name, checks it looks
 * plausible so the player gets a helpful message instead of a disconnection,
 * and hands it over. The server checks it again and has the final word.
 */
import { useState, type FormEvent } from 'react';
import { displayNameSchema } from '@atheriam/protocol';
import { strings } from './strings.js';

export interface JoinScreenProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onJoin: (name: string) => void;
}

export function JoinScreen({ busy, error, onJoin }: JoinScreenProps): JSX.Element {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();

    if (trimmed.length < 3) {
      setLocalError(strings.errors['nameTooShort'] ?? null);
      return;
    }
    if (trimmed.length > 20) {
      setLocalError(strings.errors['nameTooLong'] ?? null);
      return;
    }
    if (!displayNameSchema.safeParse(trimmed).success) {
      setLocalError(strings.errors['nameBadCharacters'] ?? null);
      return;
    }

    setLocalError(null);
    onJoin(trimmed);
  }

  const message = localError ?? error;

  return (
    <main className="screen">
      <form className="panel" onSubmit={handleSubmit}>
        <h1 className="panel__title">{strings.appName}</h1>
        <p className="panel__subtitle">{strings.tagline}</p>

        <label className="field">
          <span className="field__label">{strings.join.nameLabel}</span>
          <input
            className="field__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={strings.join.namePlaceholder}
            maxLength={20}
            autoComplete="off"
            autoFocus
            disabled={busy}
            aria-describedby="name-help"
          />
        </label>
        <p id="name-help" className="notice notice--quiet">
          {strings.join.nameHelp}
        </p>

        <button className="button" type="submit" disabled={busy}>
          {busy ? strings.join.submitting : strings.join.submit}
        </button>

        {message !== null && (
          <p className="notice notice--error" role="alert">
            {message}
          </p>
        )}

        <p className="notice notice--quiet">{strings.join.ageNotice}</p>
      </form>
    </main>
  );
}
