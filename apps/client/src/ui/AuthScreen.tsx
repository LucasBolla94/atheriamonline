/**
 * Creating an account, or logging in to one.
 *
 * This screen collects what the API needs and shows what the API says back.
 * It checks the obvious things first — a password that is plainly too short,
 * a missing birthday — so that a person gets a helpful sentence instead of a
 * round trip. The server checks everything again and has the final word.
 *
 * The 18+ rule appears twice on purpose: as a tick box the person must tick,
 * and as a date the server checks. The box alone would be a promise; the date
 * is what `docs/SPEC.md` section 8 actually asks us to record.
 */
import { useState, type FormEvent } from 'react';
import { displayNameSchema } from '@atheriam/protocol';
import { strings } from './strings.js';

export type AuthMode = 'create' | 'login';

export interface AuthScreenProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCreate: (input: {
    email: string;
    password: string;
    dateOfBirth: string;
    characterName: string;
  }) => void;
  readonly onLogIn: (email: string, password: string) => void;
}

export function AuthScreen({ busy, error, onCreate, onLogIn }: AuthScreenProps): JSX.Element {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [confirmsAdult, setConfirmsAdult] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function fail(key: keyof typeof strings.errors): void {
    setLocalError(strings.errors[key] ?? null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setLocalError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@') || trimmedEmail.length < 3) {
      fail('notAnEmail');
      return;
    }

    if (mode === 'login') {
      if (password.length === 0) {
        fail('passwordTooShort');
        return;
      }
      onLogIn(trimmedEmail, password);
      return;
    }

    const trimmedName = characterName.trim();
    if (trimmedName.length < 3) {
      fail('nameTooShort');
      return;
    }
    if (trimmedName.length > 20) {
      fail('nameTooLong');
      return;
    }
    if (!displayNameSchema.safeParse(trimmedName).success) {
      fail('nameBadCharacters');
      return;
    }
    if (password.length < 10) {
      fail('passwordTooShort');
      return;
    }
    if (dateOfBirth.length === 0) {
      fail('noBirthday');
      return;
    }
    if (!confirmsAdult) {
      fail('notConfirmedAdult');
      return;
    }

    onCreate({ email: trimmedEmail, password, dateOfBirth, characterName: trimmedName });
  }

  const creating = mode === 'create';
  const message = localError ?? error;

  return (
    <main className="screen">
      <form className="panel" onSubmit={handleSubmit}>
        <h1 className="panel__title">{strings.appName}</h1>
        <p className="panel__subtitle">{strings.tagline}</p>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!creating}
            className={`tab ${creating ? '' : 'tab--active'}`}
            onClick={() => {
              setMode('login');
              setLocalError(null);
            }}
          >
            {strings.auth.loginTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={creating}
            className={`tab ${creating ? 'tab--active' : ''}`}
            onClick={() => {
              setMode('create');
              setLocalError(null);
            }}
          >
            {strings.auth.createTab}
          </button>
        </div>

        <label className="field">
          <span className="field__label">{strings.auth.emailLabel}</span>
          <input
            className="field__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={strings.auth.emailPlaceholder}
            autoComplete="email"
            disabled={busy}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">{strings.auth.passwordLabel}</span>
          <input
            className="field__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={creating ? 'new-password' : 'current-password'}
            disabled={busy}
            required
          />
        </label>
        {creating && <p className="notice notice--quiet">{strings.auth.passwordHelp}</p>}

        {creating && (
          <>
            <label className="field">
              <span className="field__label">{strings.auth.nameLabel}</span>
              <input
                className="field__input"
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
                placeholder={strings.auth.namePlaceholder}
                maxLength={20}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <p className="notice notice--quiet">{strings.auth.nameHelp}</p>

            <label className="field">
              <span className="field__label">{strings.auth.birthdayLabel}</span>
              <input
                className="field__input"
                type="date"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
                disabled={busy}
              />
            </label>
            <p className="notice notice--quiet">{strings.auth.birthdayHelp}</p>

            <label className="check">
              <input
                type="checkbox"
                checked={confirmsAdult}
                onChange={(event) => setConfirmsAdult(event.target.checked)}
                disabled={busy}
              />
              <span>{strings.auth.adultLabel}</span>
            </label>
          </>
        )}

        <button className="button" type="submit" disabled={busy}>
          {busy
            ? strings.auth.working
            : creating
              ? strings.auth.createSubmit
              : strings.auth.loginSubmit}
        </button>

        {message !== null && (
          <p className="notice notice--error" role="alert">
            {message}
          </p>
        )}

        <p className="notice notice--quiet">{strings.auth.ageNotice}</p>
      </form>
    </main>
  );
}
