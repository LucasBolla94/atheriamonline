import { describe, expect, it } from 'vitest';
import { emailSchema, normaliseEmail } from './email.js';

describe('emailSchema', () => {
  it('accepts ordinary addresses', () => {
    for (const value of ['a@example.com', 'first.last+tag@sub.example.co.uk']) {
      expect(emailSchema.safeParse(value).success).toBe(true);
    }
  });

  it('refuses things that are not addresses', () => {
    for (const value of ['', 'nope', 'a@', '@example.com', 'a b@example.com']) {
      expect(emailSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('normaliseEmail', () => {
  it('makes two spellings of one address the same', () => {
    expect(normaliseEmail('  Aldric@Example.COM ')).toBe('aldric@example.com');
  });

  it('leaves a plain address alone', () => {
    expect(normaliseEmail('aldric@example.com')).toBe('aldric@example.com');
  });
});
