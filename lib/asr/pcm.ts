export class PcmFramer {
  private ratio: number;
  private weight = 0;
  private sum = 0;
  private samples: number[] = [];
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 16000)
      throw new Error('不支持的采样率');
    this.ratio = sampleRate / 16000;
  }
  push(input: Float32Array): Int16Array[] {
    const frames: Int16Array[] = [];
    for (const sample of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const step = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * step;
        this.weight += step;
        remaining -= step;
        if (this.weight >= this.ratio - 1e-8) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.sum = 0;
          this.weight = 0;
          if (this.samples.length === 3200) {
            frames.push(new Int16Array(this.samples));
            this.samples = [];
          }
        }
      }
    }
    return frames;
  }
  flush(): Int16Array | null {
    const result = this.samples.length ? new Int16Array(this.samples) : null;
    this.samples = [];
    this.weight = 0;
    this.sum = 0;
    return result;
  }
}
