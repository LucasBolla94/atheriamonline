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
import { Portrait } from './Art.js';
import { Icon } from './Icon.js';

/**
 * The four things this screen can be doing.
 *
 * `reset` is not reached by a button: the player arrives on it by opening the
 * link in their email, which carries a token in the address bar.
 */
export type AuthMode = 'create' | 'login' | 'forgot' | 'reset';

export interface AuthScreenProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCreate: (input: {
    email: string;
    password: string;
    dateOfBirth: string;
    characterName: string;
    appearance?: number;
  }) => void;
  readonly onLogIn: (email: string, password: string) => void;
  /** Ask for a link to choose a new password. */
  readonly onForgot: (email: string) => Promise<string | null>;
  /** Use the link from the email. Returns an error to show, or null. */
  readonly onReset: (token: string, password: string) => Promise<string | null>;
  /**
   * The token from the address bar, when the player arrived from their email.
   * Its presence is what puts this screen into `reset`.
   */
  readonly resetToken: string | null;
}

export function AuthScreen({
  busy,
  error,
  onCreate,
  onLogIn,
  onForgot,
  onReset,
  resetToken,
}: AuthScreenProps): JSX.Element {
  const [appearance, setAppearance] = useState(0);
  const [mode, setMode] = useState<AuthMode>(resetToken === null ? 'login' : 'reset');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [confirmsAdult, setConfirmsAdult] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [repeated, setRepeated] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  function fail(key: keyof typeof strings.errors): void {
    setLocalError(strings.errors[key] ?? null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setLocalError(null);
    setDone(null);

    // Choosing a new password from an emailed link. There is no address to
    // check here: the link itself says who this is.
    if (mode === 'reset') {
      if (password.length < 10) {
        fail('passwordTooShort');
        return;
      }
      if (password !== repeated) {
        fail('passwordsDiffer');
        return;
      }
      setWorking(true);
      void (async () => {
        const problem = await onReset(resetToken ?? '', password);
        setWorking(false);
        if (problem !== null) {
          setLocalError(problem);
          return;
        }
        setDone(strings.auth.resetDone);
        setPassword('');
        setRepeated('');
        setMode('login');
      })();
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@') || trimmedEmail.length < 3) {
      fail('notAnEmail');
      return;
    }

    // Asking for the link. The answer is the same either way, so there is
    // nothing here that could tell somebody whether an address has an account.
    if (mode === 'forgot') {
      setWorking(true);
      void (async () => {
        const problem = await onForgot(trimmedEmail);
        setWorking(false);
        if (problem !== null) {
          setLocalError(problem);
          return;
        }
        setDone(strings.auth.forgotSent);
      })();
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

    onCreate({
      email: trimmedEmail,
      password,
      dateOfBirth,
      characterName: trimmedName,
      appearance,
    });
  }

  const creating = mode === 'create';
  const resetting = mode === 'reset';
  const forgetting = mode === 'forgot';
  /** True while either half of the screen is waiting on the server. */
  const waiting = busy || working;
  const message = localError ?? error;

  /** Go back to the ordinary login form, forgetting whatever was half typed. */
  function backToLogin(): void {
    setMode('login');
    setLocalError(null);
    setPassword('');
    setRepeated('');
  }

  return (
    <main className="screen welcome-screen">
      <section className="welcome-art" aria-label={strings.welcome.town}>
        <img className="welcome-art__image" src="/art/welcome.png" alt="" />
        <div className="welcome-art__shade" />
        <a className="brand" href="/" aria-label={strings.appName}>
          <Icon name="castle" />
          <span>
            {strings.appName}
            <small>{strings.welcome.eyebrow}</small>
          </span>
        </a>
        <div className="welcome-story">
          <span className="eyebrow">{strings.welcome.version}</span>
          <h2>{strings.welcome.title}</h2>
          <p>{strings.welcome.description}</p>
          <div className="welcome-features">
            <span>
              <Icon name="compass" />
              {strings.welcome.explore}
            </span>
            <span>
              <Icon name="chat" />
              {strings.welcome.talk}
            </span>
            <span>
              <Icon name="home" />
              {strings.welcome.decorate}
            </span>
          </div>
        </div>
      </section>
      <section className="welcome-form">
        <header className="welcome-form__brand">
          <Icon name="leaf" />
          <h1>{strings.appName}</h1>
          <span>{strings.welcome.version}</span>
        </header>
        <form className="panel auth-panel" onSubmit={handleSubmit}>
          <div className="auth-emblem">
            <Icon name={creating ? 'leaf' : 'home'} />
          </div>
          <h2 className="auth-title">
            {resetting
              ? strings.auth.resetTitle
              : forgetting
                ? strings.auth.forgotTitle
                : creating
                  ? strings.welcome.createTitle
                  : strings.welcome.loginTitle}
          </h2>
          <p className="panel__subtitle">
            {resetting
              ? strings.auth.resetCopy
              : forgetting
                ? strings.auth.forgotCopy
                : creating
                  ? strings.welcome.createCopy
                  : strings.welcome.loginCopy}
          </p>

          {!resetting && !forgetting && (
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
          )}

          {creating && (
            <fieldset className="starter-looks">
              <legend>{strings.welcome.chooseLook}</legend>
              <div>
                {strings.welcome.lookNames.slice(0, 3).map((name, look) => (
                  <button
                    type="button"
                    key={name}
                    aria-label={name}
                    aria-pressed={appearance === look}
                    className={appearance === look ? 'starter-look selected' : 'starter-look'}
                    onClick={() => setAppearance(look)}
                    disabled={busy}
                  >
                    <Portrait look={look} />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {!resetting && (
            <label className="field">
              <span className="field__label">{strings.auth.emailLabel}</span>
              <input
                className="field__input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={strings.auth.emailPlaceholder}
                autoComplete="email"
                disabled={waiting}
                required
              />
            </label>
          )}

          {!forgetting && (
            <label className="field">
              <span className="field__label">
                {resetting ? strings.auth.newPasswordLabel : strings.auth.passwordLabel}
              </span>
              <input
                className="field__input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={creating || resetting ? 'new-password' : 'current-password'}
                disabled={waiting}
                required
              />
            </label>
          )}
          {(creating || resetting) && (
            <p className="notice notice--quiet">{strings.auth.passwordHelp}</p>
          )}

          {resetting && (
            <label className="field">
              <span className="field__label">{strings.auth.repeatPasswordLabel}</span>
              <input
                className="field__input"
                type="password"
                value={repeated}
                onChange={(event) => setRepeated(event.target.value)}
                autoComplete="new-password"
                disabled={waiting}
                required
              />
            </label>
          )}

          {creating && !resetting && (
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

          <button className="button" type="submit" disabled={waiting}>
            {waiting
              ? strings.auth.working
              : resetting
                ? strings.auth.resetSubmit
                : forgetting
                  ? strings.auth.forgotSubmit
                  : creating
                    ? strings.auth.createSubmit
                    : strings.auth.loginSubmit}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              className="auth-link"
              disabled={waiting}
              onClick={() => {
                setMode('forgot');
                setLocalError(null);
                setDone(null);
              }}
            >
              {strings.auth.forgotLink}
            </button>
          )}

          {(forgetting || resetting) && (
            <button type="button" className="auth-link" disabled={waiting} onClick={backToLogin}>
              {strings.auth.backToLogin}
            </button>
          )}

          {done !== null && (
            <p className="notice notice--good" role="status">
              {done}
            </p>
          )}

          {message !== null && (
            <p className="notice notice--error" role="alert">
              {message}
            </p>
          )}

          <p className="notice notice--quiet">{strings.auth.ageNotice}</p>
        </form>
        <footer className="welcome-footer">
          <span>{strings.welcome.footer}</span>
          <a href="/credits.html" target="_blank" rel="noreferrer">
            {strings.welcome.credits}
          </a>
        </footer>
      </section>
    </main>
  );
}
