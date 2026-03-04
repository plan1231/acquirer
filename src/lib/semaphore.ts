export class Semaphore {
  private readonly max: number;
  private counter: number;
  private readonly queue: Array<() => void>;

  constructor(max: number) {
    this.max = max;
    this.counter = 0;
    this.queue = [];
  }

  acquire(): Promise<void> {
    if (this.counter < this.max) {
      this.counter++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const resolve = this.queue.shift();
    if (resolve) {
      resolve();
      return;
    }

    if (this.counter > 0) {
      this.counter--;
    }
  }
}
