import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  hashPassword,
  verifyPassword,
} from './password.js';

describe('checkPassword', () => {
  it('accepts an ordinary long password', () => {
    expect(checkPassword('correct horse battery staple', 'a@example.com')).toBeNull();
  });

  it('refuses a password that is too short', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1), 'a@example.com')).toBe('too-short');
  });

  it('refuses a password that is absurdly long', () => {
    expect(checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1), 'a@example.com')).toBe('too-long');
  });

  it('refuses a password that is just the email address', () => {
    expect(checkPassword('Aldric@Example.com', 'aldric@example.com')).toBe('same-as-email');
  });
});

describe('hashing', () => {
  it('never stores the password itself', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('gives a different hash every time, so equal passwords do not look equal', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
  });

  it('accepts the right password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('refuses the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('refuses everything when the stored value is not a hash', async () => {
    // A corrupt or tampered row must never become a way in.
    for (const broken of ['', 'not a hash', '$argon2id$broken', '*']) {
      expect(await verifyPassword(broken, 'anything at all')).toBe(false);
    }
  });
}, 20_000);
