/**
 * Building the Fastify application.
 *
 * Kept apart from `index.ts` so that a test can build the same server, point
 * it at a test database and drive it without opening a port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Redis } from 'ioredis';
import type { Database } from '@atheriam/db';
import { SessionStore } from './auth/sessions.js';
import { registerRoutes } from './routes.js';
import { redisWorldLink, type WorldLink } from './worldLink.js';
import { ensureCatalogue } from './items.js';
import type { Config } from './config.js';
import { isProduction } from './config.js';

export interface BuildOptions {
  readonly config: Config;
  readonly db: Database;
  readonly redis: Redis;
  /**
   * How to reach the live city. Left out, the API talks to the world server
   * over the same Redis it already has.
   */
  readonly world?: WorldLink;
}

export async function buildServer(options: BuildOptions): Promise<FastifyInstance> {
  const { config, db, redis } = options;

  const app = Fastify({
    logger: {
      // Tests drive this server directly; their output should be the test
      // results, not a few hundred request lines.
      level: config.nodeEnv === 'test' ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
      // A password must never reach a log file, not even by accident.
      redact: {
        paths: ['req.headers.cookie', 'req.body.password', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    trustProxy: isProduction(config),
  });

  await app.register(cookie, { secret: config.sessionSecret });

  await app.register(cors, {
    // The browser client is the only thing allowed to call this API with
    // cookies attached.
    origin: config.publicOrigin,
    credentials: true,
    methods: ['GET', 'POST'],
  });

  await app.register(rateLimit, {
    // The ceiling for ordinary traffic. Logging in and registering are held to
    // a much lower limit of their own, set on those routes.
    max: config.generalRateLimitPerMinute,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => request.ip,
  });

  // Every kind of thing the game knows about is written down at start-up, so
  // adding one is a line of code rather than a line of SQL somebody has to
  // remember to run on the server.
  await ensureCatalogue(db);

  await registerRoutes(app, {
    db,
    sessions: new SessionStore(redis),
    secureCookies: isProduction(config),
    authRateLimitPerMinute: config.authRateLimitPerMinute,
    world:
      options.world ??
      redisWorldLink(redis, (error) => {
        app.log.warn(error, 'Could not tell the world server about a change.');
      }),
  });

  return app;
}
