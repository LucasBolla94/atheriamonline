import { describe, expect, it } from 'vitest';
import { CHAT_BURST, CHAT_TOKEN_REFILL_MS, MAX_CHAT_LENGTH } from '@atheriam/shared';
import { cleanChatText, newChatAllowance, takeChatToken } from './chat.js';

describe('cleanChatText', () => {
  it('keeps an ordinary sentence as it was typed', () => {
    expect(cleanChatText('Good evening, Aldric!')).toBe('Good evening, Aldric!');
  });

  it('trims the ends and flattens runs of spaces', () => {
    expect(cleanChatText('  hello    there  ')).toBe('hello there');
  });

  it('refuses a message that is only whitespace', () => {
    expect(cleanChatText('   ')).toBeNull();
    expect(cleanChatText('')).toBeNull();
  });

  it('turns a newline into a space, so nobody can fake several lines', () => {
    expect(cleanChatText('one\ntwo\r\nthree')).toBe('one two three');
  });

  it('strips the invisible characters used to spoof a name', () => {
    // A zero-width space inside a word must not glue it back together.
    expect(cleanChatText('Ald​ric')).toBe('Ald ric');
    expect(cleanChatText('​​')).toBeNull();
  });

  it('strips the marks that reverse the direction of a line', () => {
    expect(cleanChatText('hello‮world')).toBe('hello world');
  });

  it('cuts a message that is far too long', () => {
    const long = 'a'.repeat(MAX_CHAT_LENGTH * 3);
    expect(cleanChatText(long)).toHaveLength(MAX_CHAT_LENGTH);
  });

  it('leaves accents and other languages alone', () => {
    expect(cleanChatText('Olá, tudo bem? 你好')).toBe('Olá, tudo bem? 你好');
  });
});

describe('the chat rate limit', () => {
  it('lets a player say several things in a row', () => {
    const allowance = newChatAllowance(0);
    for (let i = 0; i < CHAT_BURST; i += 1) {
      expect(takeChatToken(allowance, 0)).toBe(true);
    }
  });

  it('stops them once the burst is spent', () => {
    const allowance = newChatAllowance(0);
    for (let i = 0; i < CHAT_BURST; i += 1) takeChatToken(allowance, 0);
    expect(takeChatToken(allowance, 0)).toBe(false);
  });

  it('gives a token back after a pause', () => {
    const allowance = newChatAllowance(0);
    for (let i = 0; i < CHAT_BURST; i += 1) takeChatToken(allowance, 0);

    expect(takeChatToken(allowance, CHAT_TOKEN_REFILL_MS - 1)).toBe(false);
    expect(takeChatToken(allowance, CHAT_TOKEN_REFILL_MS)).toBe(true);
  });

  it('never banks more than one burst, however long the silence', () => {
    const allowance = newChatAllowance(0);
    const hourLater = 60 * 60 * 1000;

    let allowed = 0;
    for (let i = 0; i < 50; i += 1) {
      if (takeChatToken(allowance, hourLater)) allowed += 1;
    }
    expect(allowed).toBe(CHAT_BURST);
  });

  it('is not fooled by a clock that goes backwards', () => {
    const allowance = newChatAllowance(1000);
    for (let i = 0; i < CHAT_BURST; i += 1) takeChatToken(allowance, 1000);
    expect(takeChatToken(allowance, 0)).toBe(false);
  });
});
