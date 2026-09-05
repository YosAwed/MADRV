import { describe, expect, it } from "vitest";
import { OrderedMidiQueue } from "./orderedMidiQueue";

function makeQueue(initialTime = 10) {
  let now = initialTime;
  let nextTimer = 1;
  let timersCreated = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const dispatched: {
    event: string;
    targetAt: number;
    dispatchedAt: number;
  }[] = [];
  const queue = new OrderedMidiQueue<string>({
    now: () => now,
    schedule: (callback, delayMs) => {
      const id = nextTimer++;
      timersCreated += 1;
      timers.set(id, { at: now + delayMs / 1000, callback });
      return id;
    },
    cancel: id => {
      timers.delete(id);
    },
    dispatch: (event, targetAt) => {
      dispatched.push({ event, targetAt, dispatchedAt: now });
    },
  });
  return {
    queue,
    timers,
    dispatched,
    timersCreated: () => timersCreated,
    advanceTo(time: number) {
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= time)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = time;
    },
    jumpTo(time: number) {
      now = time;
    },
  };
}

describe("OrderedMidiQueue", () => {
  it("keeps a downward bend before its reset when a later pump moves the reset deadline earlier", () => {
    const test = makeQueue();
    test.queue.enqueue("E0 03 00", 10.143437);
    test.advanceTo(10.02);
    test.queue.enqueue("E0 00 40", 10.129167);
    test.advanceTo(10.13);
    expect(test.dispatched).toEqual([]);
    expect(test.timers.size).toBe(1);
    test.advanceTo(10.144);
    expect(test.dispatched.map(({ event }) => event)).toEqual([
      "E0 03 00",
      "E0 00 40",
    ]);
    expect(test.dispatched.map(({ targetAt }) => targetAt)).toEqual([
      10.143437, 10.143437,
    ]);
    expect(test.timersCreated()).toBe(1);
  });

  it("preserves same-time note-off, note-on and bend reset order", () => {
    const test = makeQueue();
    for (const event of ["note-off", "note-on", "bend-center"])
      test.queue.enqueue(event, 10.1);
    test.advanceTo(10.1);
    expect(test.dispatched.map(({ event }) => event)).toEqual([
      "note-off",
      "note-on",
      "bend-center",
    ]);
    expect(test.timersCreated()).toBe(1);
  });

  it("does not let an overdue event bypass an older timer after the main thread stalls", () => {
    const test = makeQueue();
    test.queue.enqueue("bend-down", 10.1);
    test.jumpTo(10.2);
    test.queue.enqueue("bend-center", 10.15);
    expect(test.dispatched).toEqual([]);
    const pending = [...test.timers.values()][0]!;
    test.timers.clear();
    pending.callback();
    expect(test.dispatched.map(({ event }) => event)).toEqual([
      "bend-down",
      "bend-center",
    ]);
  });

  it("cancels pending messages and resets the deadline when cleared", () => {
    const test = makeQueue();
    test.queue.enqueue("old-note", 20);
    const staleCallback = [...test.timers.values()][0]!.callback;
    test.queue.clear();
    expect(test.timers.size).toBe(0);
    test.queue.enqueue("new-note", 10.1);
    staleCallback();
    test.advanceTo(10.1);
    expect(test.dispatched).toEqual([
      { event: "new-note", targetAt: 10.1, dispatchedAt: 10.1 },
    ]);
    test.advanceTo(30);
    expect(test.dispatched).toHaveLength(1);
  });

  it("holds an early worklet event behind prior messages while retaining its effective timestamp", () => {
    const test = makeQueue();
    test.queue.enqueue("previous-bend", 10.1);
    test.queue.enqueue("loop-reset", 10.09, true);
    test.queue.enqueue("loop-note", 10.2, true);
    expect(test.dispatched).toEqual([]);
    test.advanceTo(10.1);
    expect(test.dispatched).toEqual([
      { event: "previous-bend", targetAt: 10.1, dispatchedAt: 10.1 },
      { event: "loop-reset", targetAt: 10.1, dispatchedAt: 10.1 },
      { event: "loop-note", targetAt: 10.2, dispatchedAt: 10.1 },
    ]);
    test.queue.enqueue("following-controller", 10.15);
    test.advanceTo(10.199);
    expect(test.dispatched).toHaveLength(3);
    test.advanceTo(10.2);
    expect(test.dispatched[3]).toEqual({
      event: "following-controller",
      targetAt: 10.2,
      dispatchedAt: 10.2,
    });
  });

  it("dispatches head worklet events immediately and handles reentrant enqueue in order", () => {
    const events: string[] = [];
    let queue: OrderedMidiQueue<string>;
    queue = new OrderedMidiQueue<string>({
      now: () => 10,
      schedule: () => {
        throw new Error("No timer expected");
      },
      cancel: () => {},
      dispatch: event => {
        events.push(event);
        if (event === "first") queue.enqueue("second", 10.5, true);
      },
    });
    queue.enqueue("first", 10.5, true);
    expect(events).toEqual(["first", "second"]);
  });
});
