export class RecordingClock {
  private accumulated = 0;
  private startedAt: number | null = null;
  private now: () => number;
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }
  start() {
    if (this.startedAt === null) this.startedAt = this.now();
  }
  pause() {
    if (this.startedAt !== null)
      this.accumulated += this.now() - this.startedAt;
    this.startedAt = null;
  }
  reset() {
    this.accumulated = 0;
    this.startedAt = null;
  }
  seconds() {
    return Math.floor(
      (this.accumulated +
        (this.startedAt === null ? 0 : this.now() - this.startedAt)) /
        1000,
    );
  }
}
