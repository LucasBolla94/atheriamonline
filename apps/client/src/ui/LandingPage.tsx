import { strings } from './strings.js';
import './landing.css';

/** Public, scrollable entry to the city; the game is loaded only at /play. */
export function LandingPage(): JSX.Element {
  const s = strings.landing;
  return (
    <main className="landing" id="top">
      <a className="landing__skip" href="#discover">
        {s.skip}
      </a>
      <header className="landing__nav">
        <a className="landing__brand" href="/" aria-label={strings.appName}>
          <span aria-hidden="true">a.</span>
          {strings.appName}
        </a>
        <nav aria-label={s.navigation}>
          <a href="#discover">{s.discover}</a>
          <a href="#create">{s.create}</a>
          <a href="#questions">{s.questions}</a>
        </nav>
        <a className="landing__login" href="/play/">
          {s.login}
          <span aria-hidden="true">↗</span>
        </a>
      </header>
      <section className="landing__hero" aria-labelledby="landing-title">
        <div className="landing__intro">
          <span className="landing__eyebrow">
            <span aria-hidden="true" className="landing__dot" />
            {s.eyebrow}
          </span>
          <h1 id="landing-title">
            {s.title}
            <em>{s.titleAccent}</em>
          </h1>
          <p>{s.description}</p>
          <div className="landing__actions">
            <a className="landing__cta" href="/play/?create=1">
              {s.join}
              <span aria-hidden="true">↗</span>
            </a>
            <a href="#discover" className="landing__text-link">
              {s.takeLook}
              <span aria-hidden="true">↓</span>
            </a>
          </div>
          <small>{s.requirements}</small>
        </div>
        <figure className="landing__city">
          <img
            src="/art/central-hero.png"
            alt={s.heroAlt}
            width="1536"
            height="1024"
            fetchPriority="high"
          />
          <figcaption>
            <span className="landing__dot" aria-hidden="true" />
            <div>
              <strong>{s.cityName}</strong>
              <span>{s.cityCaption}</span>
            </div>
            <span className="landing__city-number" aria-hidden="true">
              01
            </span>
          </figcaption>
        </figure>
      </section>
      <div className="landing__ribbon" aria-label={s.cityFacts}>
        {s.facts.map((fact) => (
          <span key={fact}>
            <span aria-hidden="true">✦</span>
            <span>{fact}</span>
          </span>
        ))}
      </div>
      <section className="landing__section" id="discover" aria-labelledby="discover-title">
        <div className="landing__section-heading">
          <div>
            <span className="landing__eyebrow">{s.discoverEyebrow}</span>
            <h2 id="discover-title">{s.discoverTitle}</h2>
          </div>
          <p>{s.discoverCopy}</p>
        </div>
        <div className="landing__features">
          {s.features.map((feature, i) => (
            <article key={feature.title} className={`landing__feature landing__feature--${i}`}>
              <span className="landing__number">0{i + 1}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
              <span className="landing__feature-note">{feature.note}</span>
            </article>
          ))}
        </div>
      </section>
      <section
        className="landing__create landing__section"
        id="create"
        aria-labelledby="create-title"
      >
        <div className="landing__shop-picture">
          <img
            src="/art/central-hero.png"
            alt={s.shopAlt}
            width="1536"
            height="1024"
            loading="lazy"
          />
          <span>{s.shopCaption}</span>
        </div>
        <div className="landing__create-copy">
          <span className="landing__eyebrow">{s.createEyebrow}</span>
          <h2 id="create-title">{s.createTitle}</h2>
          <p>{s.createCopy}</p>
          <ol>
            {s.steps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
          <a className="landing__text-link" href="/play/?create=1">
            {s.startCreating}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
      <section
        className="landing__section landing__questions"
        id="questions"
        aria-labelledby="questions-title"
      >
        <div>
          <span className="landing__eyebrow">{s.questionsEyebrow}</span>
          <h2 id="questions-title">{s.questionsTitle}</h2>
        </div>
        <div>
          {s.faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="landing__invite">
        <span className="landing__eyebrow">{s.inviteEyebrow}</span>
        <h2>{s.inviteTitle}</h2>
        <p>{s.inviteCopy}</p>
        <a className="landing__cta" href="/play/?create=1">
          {s.join}
          <span aria-hidden="true">↗</span>
        </a>
      </section>
      <footer className="landing__footer">
        <a className="landing__brand" href="#top">
          <span aria-hidden="true">a.</span>
          {strings.appName}
        </a>
        <p>{s.footer}</p>
        <div>
          <a href="/credits.html">{strings.welcome.credits}</a>
          <a href="/play/">{s.login}</a>
        </div>
      </footer>
    </main>
  );
}
