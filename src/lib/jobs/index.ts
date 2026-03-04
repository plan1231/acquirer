import { JobRunner } from './jobRunner';

export { Job, type JobStatus } from './job';
export { ProcessMovie, type ProcessMovieInput } from './processMovie';
export { ProcessEpisode, type ProcessEpisodeInput } from './processEpisode';

const JOB_RUNNER_CONCURRENCY = 2;

export const jobRunner = new JobRunner({ concurrency: JOB_RUNNER_CONCURRENCY });
