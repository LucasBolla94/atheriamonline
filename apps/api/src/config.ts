/**
 * Reading the settings this process needs from the environment.
 *
 * Everything is validated once, at start-up. A missing or nonsensical setting
 * stops the server immediately with a sentence that says what to do, rather
 * than failing hours later in the middle of somebody's login.
 *
 * Secrets are read from the environment and never written down in the
 * repository.
 */
import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  host: z.string().min(1).default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65_535).default(3001),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1),
  /** Where the browser is served from. Used for CORS and cookie safety. */
  publicOrigin: z.string().url(),
  sessionSecret: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.'),

  /**
   * Requests per minute, per IP address, for ordinary routes.
   *
   * Generous on purpose. A household, an office or a mobile network shares one
   * IP address between many people, so a tight limit here locks out real
   * players rather than stopping anybody.
   */
  generalRateLimitPerMinute: z.coerce.number().int().min(1).default(300),

  /**
   * Requests per minute, per IP address, for logging in and registering.
   *
   * This is the one that matters: it is where somebody guesses passwords. It
   * is deliberately much lower than the general limit.
   */
  authRateLimitPerMinute: z.coerce.number().int().min(1).default(10),

  /*
   * Sending email, for "I have forgotten my password" and nothing else.
   *
   * All of it is optional so that the game runs on a laptop with no mail
   * account. When none of it is set, the route that would send a message says
   * plainly that password reset is not set up, rather than pretending.
   *
   * The password is read from the environment like every other secret. It is
   * never written in this repository and never appears in a log line.
   */
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65_535).default(465),
  smtpUser: z.string().min(1).optional(),
  smtpPassword: z.string().min(1).optional(),
  /** What a player sees in the "from" line. */
  mailFrom: z.string().min(3).optional(),

  /**
   * Write email to this file instead of sending it.
   *
   * For development and for the browser tests, which read the file to follow
   * the link. Ignored in production — see `buildServer`.
   */
  mailOutbox: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    nodeEnv: env['NODE_ENV'],
    host: env['API_HOST'],
    port: env['API_PORT'],
    databaseUrl: env['DATABASE_URL'],
    redisUrl: env['REDIS_URL'],
    publicOrigin: env['PUBLIC_ORIGIN'],
    sessionSecret: env['SESSION_SECRET'],
    generalRateLimitPerMinute: env['GENERAL_RATE_LIMIT_PER_MINUTE'],
    authRateLimitPerMinute: env['AUTH_RATE_LIMIT_PER_MINUTE'],
    smtpHost: env['SMTP_HOST'],
    smtpPort: env['SMTP_PORT'],
    smtpUser: env['SMTP_USER'],
    smtpPassword: env['SMTP_PASSWORD'],
    mailFrom: env['MAIL_FROM'],
    mailOutbox: env['MAIL_OUTBOX'],
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `The API cannot start because its settings are wrong:\n${problems}\n\n` +
        'Copy .env.example to .env and fill it in. Generate a session secret with:\n' +
        '  openssl rand -hex 32',
    );
  }

  return parsed.data;
}

/** True when we are running for real and must not take any shortcuts. */
export function isProduction(config: Config): boolean {
  return config.nodeEnv === 'production';
}
