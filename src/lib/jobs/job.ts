export type JobStatus = 'pending' | 'running' | 'complete' | 'failed';

let nextJobId = 1;

export abstract class Job<TInput extends object> {
  readonly id: number;
  readonly input: TInput;
  status: JobStatus = 'pending';
  readonly createdAt: Date;
  startedAt: Date | null = null;
  finishedAt: Date | null = null;
  errorMessage: string | null = null;

  constructor(input: TInput) {
    this.id = nextJobId++;
    this.input = input;
    this.createdAt = new Date();
  }

  abstract describe(): string;

  async run(): Promise<void> {
    if (this.status !== 'pending') {
      throw new Error(`Job ${this.id} cannot start from status "${this.status}"`);
    }

    this.status = 'running';
    this.startedAt = new Date();

    try {
      await this.runInternal();
      this.status = 'complete';
    } catch (error) {
      this.status = 'failed';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Job failed (${this.constructor.name}#${this.id}): ${this.describe()}`, error);
    } finally {
      this.finishedAt = new Date();
    }
  }

  protected abstract runInternal(): Promise<void>;
}
