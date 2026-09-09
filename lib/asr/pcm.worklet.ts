import { PcmFramer } from './pcm';
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
class PcmProcessor extends AudioWorkletProcessor {
  encoder = new PcmFramer(sampleRate);
  enabled = false;
  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type === 'start') this.enabled = true;
      if (event.data.type === 'flush') {
        this.enabled = false;
        const tail = this.encoder.flush();
        if (tail) this.emit(tail);
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  emit(samples: Int16Array) {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);
    samples.forEach((value, i) => view.setInt16(i * 2, value, true));
    this.port.postMessage(buffer, [buffer]);
  }
  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (this.enabled && channels?.length) {
      const mono = new Float32Array(channels[0].length);
      channels.forEach((channel) =>
        channel.forEach((v, i) => {
          mono[i] += v / channels.length;
        }),
      );
      this.encoder.push(mono).forEach((frame) => this.emit(frame));
    }
    return true;
  }
}
registerProcessor('interview-pcm', PcmProcessor);
