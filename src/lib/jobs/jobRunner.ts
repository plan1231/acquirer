import assert from 'node:assert/strict';
import { Job } from './job';
import { Semaphore } from '@/lib/semaphore';

export interface JobRunnerOptions {
  concurrency: number;
}

export class JobRunner {
  private readonly jobs = new Set<Job<object>>();
  private readonly semaphore: Semaphore;
  private completedCount = 0;
  private failedCount = 0;

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

  getCompletedCount(): number {
    return this.completedCount;
  }

  getFailedCount(): number {
    return this.failedCount;
  }

  getTotalCount(): number {
    return this.jobs.size + this.completedCount + this.failedCount;
  }

  private async runWithSemaphore(job: Job<object>): Promise<void> {
    await this.semaphore.acquire();
    try {
      await job.run();
      assert.notEqual(job.status, 'pending', `Job ${job.id} should not be pending after run`);
    } finally {
      if (job.status === 'complete') {
        this.completedCount += 1;
      } else if (job.status === 'failed') {
        this.failedCount += 1;
      }
      this.jobs.delete(job);
      this.semaphore.release();
    }
  }
}
