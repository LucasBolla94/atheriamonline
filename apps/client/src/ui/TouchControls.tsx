import { useEffect, useRef } from 'react';
import type { Direction } from '@atheriam/shared';
import { MIN_STEP_INTERVAL_MS } from '@atheriam/shared';
import { strings } from './strings.js';
import { TouchStep } from '../net/touch-step.js';

export function TouchControls({ onStep }: { onStep: (direction: Direction) => void }): JSX.Element {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const steps = useRef<TouchStep | null>(null);
  if (steps.current === null) {
    steps.current = new TouchStep((direction) => {
      if (document.querySelector('[role="dialog"]') === null) onStepRef.current(direction);
    });
  }
  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    const cancel = () => {
      stop();
      steps.current?.cancel();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', cancel);
    return () => {
      cancel();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('blur', cancel);
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
            steps.current?.request(dir);
            timer.current = setInterval(() => {
              if (document.querySelector('[role="dialog"]') === null) steps.current?.request(dir);
              else stop();
            }, MIN_STEP_INTERVAL_MS + 20);
          }}
          onPointerUp={stop}
          onPointerCancel={() => {
            stop();
            steps.current?.cancel();
          }}
          onLostPointerCapture={stop}
        >
          {arrow}
        </button>
      ))}
    </div>
  );
}
