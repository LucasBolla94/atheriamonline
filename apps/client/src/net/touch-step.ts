import { MIN_STEP_INTERVAL_MS, type Direction } from '@atheriam/shared';

/** Keep one recent tap until walking is allowed again, without building a route. */
export class TouchStep {
  private lastSent = -Infinity;
  private pending: Direction | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: (direction: Direction) => void) {}

  request(direction: Direction): void {
    this.pending = direction;
    if (this.timer !== null) return;
    const delay = this.lastSent + MIN_STEP_INTERVAL_MS + 20 - performance.now();
    if (delay <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), delay);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private flush(): void {
    this.timer = null;
    const direction = this.pending;
    this.pending = null;
    if (direction === null) return;
    this.lastSent = performance.now();
    this.send(direction);
  }
}
