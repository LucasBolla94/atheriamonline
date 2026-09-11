/**
 * What has been said near you, and the box you say things in.
 *
 * This component reads the chat log and sends what the player typed. It makes
 * no decisions about who can hear it: the server already decided that, and
 * what this browser was never sent it cannot show.
 *
 * The text is rendered by React as text, never as markup, so a remark can
 * never become part of the interface.
 */
import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH } from '@atheriam/shared';
import type { ChatEntry } from '../net/connection.js';
import { strings } from './strings.js';

export interface ChatPanelProps {
  readonly entries: readonly ChatEntry[];
  readonly myPlayerId: string | null;
  readonly notice: string | null;
  readonly onSay: (text: string) => void;
  /** Open the safety menu for somebody whose name was clicked. */
  readonly onChoosePlayer: (name: string) => void;
}

/** How many unread remarks the folded button will count up to. */
const MAX_UNREAD_SHOWN = 9;

export function ChatPanel({
  entries,
  myPlayerId,
  notice,
  onSay,
  onChoosePlayer,
}: ChatPanelProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [folded, setFolded] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const unread = folded ? entries.length - readCount : 0;

  // Enter opens the chat box from anywhere, the way it does in every game
  // with a chat box. Escape gives the keyboard back to the city, so the
  // movement keys work again.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const input = inputRef.current;
      if (input === null) return;

      if (event.key === 'Enter' && document.activeElement !== input) {
        event.preventDefault();
        // Opening the chat with the keyboard also unfolds it, or the box the
        // player just asked for would not be on screen.
        setFolded(false);
        input.focus();
        return;
      }
      if (event.key === 'Escape' && document.activeElement === input) {
        input.blur();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Always show the newest remark without stealing the scroll position from
  // somebody who has deliberately scrolled back.
  useEffect(() => {
    const log = logRef.current;
    if (log === null) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }, [entries.length, folded]);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0) return;
    onSay(text);
    setDraft('');
  }

  function toggleFolded(): void {
    setFolded((wasFolded) => {
      if (wasFolded) return false;
      setReadCount(entries.length);
      return true;
    });
  }

  return (
    <div className={folded ? 'chat chat--folded' : 'chat'}>
      <button type="button" className="chat__toggle" aria-expanded={!folded} onClick={toggleFolded}>
        {folded
          ? strings.chat.show(Math.min(unread, MAX_UNREAD_SHOWN), unread > MAX_UNREAD_SHOWN)
          : strings.chat.hide}
      </button>

      <div className="chat__log" ref={logRef} role="log" aria-label={strings.chat.logLabel}>
        {entries.length === 0 && <p className="chat__empty">{strings.chat.empty}</p>}
        {entries.map((entry) => (
          <p key={entry.id} className="chat__line">
            <button
              type="button"
              className={entry.from === myPlayerId ? 'chat__who chat__who--me' : 'chat__who'}
              onClick={() => onChoosePlayer(entry.name)}
              title={strings.chat.nameTitle(entry.name)}
            >
              {entry.name}
            </button>
            <span className="chat__text">{entry.text}</span>
          </p>
        ))}
      </div>

      {notice !== null && <p className="chat__notice">{notice}</p>}

      <form className="chat__form" onSubmit={submit}>
        <input
          ref={inputRef}
          className="chat__input"
          type="text"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={strings.chat.placeholder}
          aria-label={strings.chat.inputLabel}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="chat__send" disabled={draft.trim().length === 0}>
          {strings.chat.send}
        </button>
      </form>
    </div>
  );
}
