// The build resolves this pinned upstream source from its distributed source
// map. No private synth queue is inspected or modified by this adapter.
import { WorkletSynthesizerCore } from "madrv-spessa-vendor/synthesizer/worklet/worklet_synthesizer_core.ts";
import { MadrvSoundfontScheduler } from "./madrvSoundfontScheduler";

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class MadrvSoundfontCore extends WorkletSynthesizerCore {
  private readonly scheduler: MadrvSoundfontScheduler;

  constructor(port: MessagePort, options: { oneOutput: boolean; eventsEnabled: boolean }) {
    super(sampleRate, currentTime, port, options);
    this.scheduler = new MadrvSoundfontScheduler({
      sampleRate,
      apply: event => {
        // Due events are immediate from the synthesis engine's perspective.
        // Keeping future events here makes stop/song replacement cancellable.
        this.synthesizer.processMessage(event.bytes, 0, { time: 0 });
      },
      release: event => this.synthesizer.processMessage(event.bytes, 0, { time: 0 }),
      stopAll: () => this.synthesizer.stopAllChannels(true),
      report: timing => port.postMessage(timing),
    });
  }

  protected handleMessage(message: unknown) {
    if (this.scheduler.handle(message, currentTime)) return;
    super.handleMessage(message);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // AudioContext and AudioWorklet timestamps share one output clock. The
    // stock renderer handles effects, banks, normal API messages and outputs.
    this.scheduler.process(currentTime, outputs[0]?.[0]?.length ?? 128);
    return super.process(inputs, outputs);
  }
}

class MadrvSoundfontProcessor extends AudioWorkletProcessor {
  private readonly core: MadrvSoundfontCore;

  constructor(options: { processorOptions: { oneOutput: boolean; eventsEnabled: boolean } }) {
    super();
    this.core = new MadrvSoundfontCore(this.port, options.processorOptions);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    return this.core.process(inputs, outputs);
  }
}

registerProcessor("madrv-spessasynth-worklet", MadrvSoundfontProcessor);
