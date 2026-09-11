import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeServerMessage, encode, MAX_MESSAGE_BYTES } from './codec.js';
import { displayNameSchema } from './messages.js';

describe('decodeClientMessage', () => {
  it('accepts a well formed step intent', () => {
    const result = decodeClientMessage(encode({ t: 'step', seq: 1, dir: 'n' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.t).toBe('step');
    }
  });

  it('never throws on rubbish, it returns a reason', () => {
    for (const rubbish of ['', 'not json', '{', '[]', 'null', '"a string"', '42']) {
      const result = decodeClientMessage(rubbish);
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a message type it does not know', () => {
    expect(decodeClientMessage(JSON.stringify({ t: 'giveMeMoney', amount: 999 })).ok).toBe(false);
  });

  it('refuses a huge message instead of parsing it', () => {
    const huge = JSON.stringify({ t: 'join', name: 'a'.repeat(MAX_MESSAGE_BYTES) });
    const result = decodeClientMessage(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('message too large');
    }
  });

  it('refuses a fractional tile, because half a tile does not exist', () => {
    expect(
      decodeClientMessage(JSON.stringify({ t: 'walkTo', seq: 1, to: { x: 1.5, y: 2 } })).ok,
    ).toBe(false);
  });

  it('refuses a coordinate far outside the world', () => {
    expect(
      decodeClientMessage(JSON.stringify({ t: 'walkTo', seq: 1, to: { x: 1e12, y: 0 } })).ok,
    ).toBe(false);
  });

  it('refuses a negative sequence number', () => {
    expect(decodeClientMessage(JSON.stringify({ t: 'step', seq: -1, dir: 'n' })).ok).toBe(false);
  });

  it('refuses a direction that is not one of the eight', () => {
    expect(decodeClientMessage(JSON.stringify({ t: 'step', seq: 0, dir: 'up' })).ok).toBe(false);
  });

  it('refuses extra fields it was not expecting to be meaningful', () => {
    // zod strips unknown keys rather than trusting them; the point of this test
    // is that the extra key can never reach the game logic.
    const result = decodeClientMessage(
      JSON.stringify({ t: 'step', seq: 0, dir: 'n', isAdmin: true }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.message)).not.toContain('isAdmin');
    }
  });
});

describe('displayNameSchema', () => {
  it('accepts ordinary names, including non-English letters', () => {
    for (const name of ['Aldric', 'Maria Luisa', 'jo_ao', 'Ines-B', 'Aoi']) {
      expect(displayNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('refuses names that are too short or too long', () => {
    expect(displayNameSchema.safeParse('ab').success).toBe(false);
    expect(displayNameSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });

  it('refuses markup and punctuation used to fake system messages', () => {
    for (const name of ['<b>hi</b>', '[SERVER]', 'Guard: hello', 'a*b', 'hi\nthere']) {
      expect(displayNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it('refuses a name that only looks fine because of leading spaces', () => {
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(displayNameSchema.safeParse(' _x').success).toBe(false);
  });
});

describe('decodeServerMessage', () => {
  it('round-trips a snapshot', () => {
    const snapshot = {
      t: 'snapshot' as const,
      tick: 10,
      you: { id: 'p1', name: 'Aldric', x: 1, y: 2, facing: 's' as const },
      players: [{ id: 'p2', name: 'Bryn', x: 3, y: 4, facing: 'n' as const }],
      gone: ['p3'],
    };
    const result = decodeServerMessage(encode(snapshot));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(snapshot);
    }
  });

  it('refuses a snapshot with a negative tick', () => {
    expect(
      decodeServerMessage(
        JSON.stringify({
          t: 'snapshot',
          tick: -1,
          you: { id: 'p1', name: 'Aldric', x: 0, y: 0, facing: 's' },
          players: [],
        }),
      ).ok,
    ).toBe(false);
  });
});
