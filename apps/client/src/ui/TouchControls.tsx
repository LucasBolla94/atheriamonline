import { useEffect, useRef } from 'react';
import type { Direction } from '@atheriam/shared';
import { MIN_STEP_INTERVAL_MS } from '@atheriam/shared';
import { strings } from './strings.js';

export function TouchControls({ onStep }: { onStep: (direction: Direction) => void }): JSX.Element {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', stop);
    return () => {
      stop();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);
  const directions: Array<[Direction, string, string]> = [
    ['n', strings.welcome.north, '↑'],
    ['w', strings.welcome.west, '←'],
    ['e', strings.welcome.east, '→'],
    ['s', strings.welcome.south, '↓'],
  ];
  return (
    <div className="touch-walk" aria-label={strings.welcome.controls}>
      {directions.map(([dir, label, arrow]) => (
        <button
          key={dir}
          type="button"
          className={`touch-walk__${dir}`}
          aria-label={label}
          onPointerDown={(event) => {
            event.preventDefault();
            stop();
            event.currentTarget.setPointerCapture(event.pointerId);
            onStep(dir);
            timer.current = setInterval(() => {
              if (document.querySelector('[role="dialog"]') === null) onStep(dir);
              else stop();
            }, MIN_STEP_INTERVAL_MS + 20);
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
        >
          {arrow}
        </button>
      ))}
    </div>
  );
}
