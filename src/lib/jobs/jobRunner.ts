import assert from 'node:assert/strict';
import { Job } from './job';
import { Semaphore } from '@/lib/semaphore';

export interface JobRunnerOptions {
  concurrency: number;
}

export class JobRunner {
  private readonly jobs = new Set<Job<object>>();
  private readonly semaphore: Semaphore;

  constructor(options: JobRunnerOptions) {
    this.semaphore = new Semaphore(options.concurrency);
  }

  enqueue<TInput extends object>(job: Job<TInput>): void {
    const typedJob = job as Job<object>;
    this.jobs.add(typedJob);
    void this.runWithSemaphore(typedJob);
  }


  getJobs(): readonly Job<object>[] {
    return Array.from(this.jobs);
  }

  private async runWithSemaphore(job: Job<object>): Promise<void> {
    await this.semaphore.acquire();
    try {
      await job.run();
      assert.notEqual(job.status, 'pending', `Job ${job.id} should not be pending after run`);
    } finally {
      this.jobs.delete(job);
      this.semaphore.release();
    }
  }
}
