export type DisposableLike = {
  dispose(): void;
};

export type StatePublisherScheduler = {
  schedule(callback: () => void): DisposableLike;
};

const defaultScheduler: StatePublisherScheduler = createTimeoutStatePublisherScheduler();

export class StatePublisher<TState> implements DisposableLike {
  private pending: DisposableLike | undefined;
  private disposed = false;

  public constructor(
    private readonly getState: () => TState,
    private readonly postState: (state: TState) => void,
    private readonly scheduler: StatePublisherScheduler = defaultScheduler
  ) {}

  public schedule(): void {
    if (this.disposed || this.pending) {
      return;
    }

    this.pending = this.scheduler.schedule(() => {
      this.pending = undefined;

      if (!this.disposed) {
        this.postState(this.getState());
      }
    });
  }

  public flush(): void {
    if (this.disposed) {
      return;
    }

    this.cancelPending();
    this.postState(this.getState());
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelPending();
  }

  private cancelPending(): void {
    this.pending?.dispose();
    this.pending = undefined;
  }
}

export function createTimeoutStatePublisherScheduler(delayMs = 16): StatePublisherScheduler {
  return {
    schedule(callback) {
      const handle = setTimeout(callback, delayMs);

      return {
        dispose: () => clearTimeout(handle)
      };
    }
  };
}
