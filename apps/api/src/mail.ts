/**
 * Sending email.
 *
 * The game sends exactly one kind of message — "here is a link to choose a new
 * password" — and it must arrive, because the alternative is somebody losing
 * their account for good.
 *
 * There are three ways to send, and which one is in use is decided by the
 * settings rather than by a flag in the code:
 *
 *  - **SMTP**, in production. The credentials are read from the environment
 *    and never appear in the repository or in a log line.
 *  - **An outbox file**, in development and in the browser tests. Nothing is
 *    sent; each message is appended to a file as JSON. That is how a test can
 *    follow a reset link without a mailbox, and how somebody working on the
 *    game can see what the email says without sending themselves anything.
 *  - **Nothing at all**, when neither is configured. Then the route that would
 *    send a message refuses honestly instead of pretending to have sent one.
 */
import { appendFile } from 'node:fs/promises';
import { createTransport, type Transporter } from 'nodemailer';

export interface Message {
  readonly to: string;
  readonly subject: string;
  /** Plain text. No HTML: a password reset is a sentence and a link. */
  readonly text: string;
}

export interface Mailer {
  /** Send it, or say why it could not be sent. Never throws. */
  send(message: Message): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** False when nothing is configured, so a route can refuse early. */
  readonly configured: boolean;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly from: string;
}

/** The real thing. */
export function smtpMailer(settings: SmtpSettings, onError?: (error: unknown) => void): Mailer {
  // One connection pool for the life of the process. Opening a TLS connection
  // per message would be slow and would look like abuse to the provider.
  const transport: Transporter = createTransport({
    host: settings.host,
    port: settings.port,
    // Port 465 is TLS from the first byte; 587 starts plain and upgrades.
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.password },
    pool: true,
    maxConnections: 2,
  });

  return {
    configured: true,
    send: async (message) => {
      try {
        await transport.sendMail({
          from: settings.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        return { ok: true };
      } catch (error: unknown) {
        onError?.(error);
        // The caller must not tell the player whether an address exists, so
        // the reason goes to the log and a flat failure comes back.
        return { ok: false, reason: 'could-not-send' };
      }
    },
  };
}

/**
 * Write messages to a file instead of sending them.
 *
 * Used in development and by the browser tests, which read the file to follow
 * the link. It refuses to be used in production: an outbox nobody reads is a
 * password reset that never arrives.
 */
export function outboxMailer(path: string): Mailer {
  return {
    configured: true,
    send: async (message) => {
      try {
        await appendFile(path, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'could-not-write-outbox' };
      }
    },
  };
}

/** No way to send anything. Routes check `configured` and refuse. */
export function noMailer(): Mailer {
  return {
    configured: false,
    send: async () => Promise.resolve({ ok: false as const, reason: 'not-configured' }),
  };
}
