/** Counting semaphore with FIFO waiters. */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  get running(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.releaser();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** One semaphore per key (e.g. hostname), created lazily and dropped when idle. */
export class HostLimiter {
  private readonly sems = new Map<string, Semaphore>();

  constructor(private readonly perHost: number) {}

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const key = host.toLowerCase();
    let sem = this.sems.get(key);
    if (!sem) {
      sem = new Semaphore(this.perHost);
      this.sems.set(key, sem);
    }
    try {
      return await sem.run(fn);
    } finally {
      if (sem.running === 0 && sem.waiting === 0) this.sems.delete(key);
    }
  }
}

/** Mutex = semaphore of 1. Used to serialise Lighthouse runs globally. */
export class Mutex extends Semaphore {
  constructor() {
    super(1);
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]);
}
