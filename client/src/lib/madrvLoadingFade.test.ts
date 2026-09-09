import { afterEach, describe, expect, it, vi } from "vitest";
import { SignalDeckAudio } from "./madrvEngine";

function harness() {
  const nodes: ReturnType<typeof makeGain>[] = [];
  function makeGain() {
    return {
      gain: {
        value: 1,
        cancelAndHoldAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }
  const context = {
    currentTime: 10,
    sampleRate: 48_000,
    destination: {},
    createGain: () => { const gain = makeGain(); nodes.push(gain); return gain; },
  };
  vi.stubGlobal("AudioContext", class { constructor() { return context; } });
  const engine = new SignalDeckAudio();
  engine.getSampleRate();
  return { engine, context, master: nodes[0]!, loading: nodes[1]!, nodes };
}

afterEach(() => vi.unstubAllGlobals());

describe("source-loading audio fade", () => {
  it("fades browser output while retaining the user's master and bus levels", () => {
    const { engine, context, master, loading, nodes } = harness();
    expect(master.connect).toHaveBeenCalledWith(loading);
    expect(loading.connect).toHaveBeenCalledWith(context.destination);
    engine.setMaster(42);
    engine.setLoadingFade(true);
    expect(loading.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(10);
    expect(loading.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.6);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.42, 10, 0.015);
    for (const bus of nodes.slice(2)) expect(bus.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    engine.setMaster(61);
    expect(loading.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.61, 10, 0.015);
  });

  it("cancels a pending fade on stop so the next song returns to normal volume", () => {
    const { engine, context, loading } = harness();
    engine.setLoadingFade(true);
    context.currentTime = 10.2;
    engine.stop();
    expect(loading.gain.cancelAndHoldAtTime).toHaveBeenLastCalledWith(10.2);
    expect(loading.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10.2 + 0.03);
  });

  it("does not create an audio context just to change a loading preference", () => {
    const create = vi.fn();
    vi.stubGlobal("AudioContext", create);
    new SignalDeckAudio().setLoadingFade(true);
    expect(create).not.toHaveBeenCalled();
  });
});
