import * as assert from 'assert';
import { StatePublisher, type StatePublisherScheduler } from '../../controller/statePublisher';

suite('StatePublisher', () => {
  test('coalesces multiple scheduled updates into one post', () => {
    const scheduler = new FakeStateScheduler();
    const states: string[] = [];
    let currentState = 'initial';
    const publisher = new StatePublisher(
      () => currentState,
      (state) => states.push(state),
      scheduler
    );

    currentState = 'first';
    publisher.schedule();
    currentState = 'second';
    publisher.schedule();
    currentState = 'third';
    publisher.schedule();

    assert.strictEqual(scheduler.pendingCount, 1);
    assert.deepStrictEqual(states, []);

    scheduler.runAll();

    assert.deepStrictEqual(states, ['third']);
  });

  test('flush cancels a pending update and posts the latest state immediately', () => {
    const scheduler = new FakeStateScheduler();
    const states: string[] = [];
    let currentState = 'initial';
    const publisher = new StatePublisher(
      () => currentState,
      (state) => states.push(state),
      scheduler
    );

    currentState = 'streaming';
    publisher.schedule();
    currentState = 'final';
    publisher.flush();

    assert.strictEqual(scheduler.pendingCount, 0);
    assert.deepStrictEqual(states, ['final']);

    scheduler.runAll();

    assert.deepStrictEqual(states, ['final']);
  });

  test('dispose cancels a pending update', () => {
    const scheduler = new FakeStateScheduler();
    const states: string[] = [];
    let currentState = 'initial';
    const publisher = new StatePublisher(
      () => currentState,
      (state) => states.push(state),
      scheduler
    );

    currentState = 'streaming';
    publisher.schedule();
    publisher.dispose();
    scheduler.runAll();

    assert.deepStrictEqual(states, []);
  });
});

class FakeStateScheduler implements StatePublisherScheduler {
  private nextId = 0;
  private readonly callbacks = new Map<number, () => void>();

  public get pendingCount(): number {
    return this.callbacks.size;
  }

  public schedule(callback: () => void): { dispose(): void } {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);

    return {
      dispose: () => {
        this.callbacks.delete(id);
      }
    };
  }

  public runAll(): void {
    while (this.callbacks.size > 0) {
      const next = this.callbacks.entries().next().value;

      if (!next) {
        return;
      }

      const [id, callback] = next;
      this.callbacks.delete(id);
      callback();
    }
  }
}
