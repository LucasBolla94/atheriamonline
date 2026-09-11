/**
 * How the API reaches the live city.
 *
 * The API owns what is durable — a mute, a ban, a block are rows in the
 * database. The world server owns what is happening right now. When the API
 * changes something that must take effect immediately, it says so here and the
 * world server acts on it within milliseconds.
 *
 * Everything on this link is best-effort on purpose. If Redis is down, the
 * database row is still written and the change takes effect the next time the
 * player joins; a moderator's action must never fail because a cache was
 * unavailable. That is why nothing here throws.
 */
import type { Redis } from 'ioredis';
import { WORLD_COMMAND_CHANNEL, type WorldCommand } from '@atheriam/protocol';

export interface WorldLink {
  kick(characterId: string, reason: 'kicked' | 'banned'): Promise<void>;
  mute(characterId: string, untilMs: number | null): Promise<void>;
  block(blockerId: string, blockedId: string, blocked: boolean): Promise<void>;
  /** Nudge somebody to go and look at something that changed. */
  notify(characterId: string, about: 'trade'): Promise<void>;
}

/** The real link: a Redis channel the world server listens on. */
export function redisWorldLink(redis: Redis, onError?: (error: unknown) => void): WorldLink {
  async function publish(command: WorldCommand): Promise<void> {
    try {
      await redis.publish(WORLD_COMMAND_CHANNEL, JSON.stringify(command));
    } catch (error: unknown) {
      // The durable change has already been written. Losing the live nudge
      // means it takes effect at next login instead of now, which is worth
      // logging and not worth failing a moderator's request over.
      onError?.(error);
    }
  }

  return {
    kick: (characterId, reason) => publish({ t: 'kick', characterId, reason }),
    mute: (characterId, untilMs) => publish({ t: 'mute', characterId, untilMs }),
    block: (blockerId, blockedId, blocked) =>
      publish({ t: 'block', blockerId, blockedId, blocked }),
    notify: (characterId, about) => publish({ t: 'notify', characterId, about }),
  };
}

/** A link that goes nowhere, for tests and for running the API on its own. */
export function silentWorldLink(): WorldLink {
  return {
    kick: async () => Promise.resolve(),
    mute: async () => Promise.resolve(),
    block: async () => Promise.resolve(),
    notify: async () => Promise.resolve(),
  };
}
