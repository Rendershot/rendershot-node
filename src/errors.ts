export class RenderShotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderShotError';
  }
}

export class APIError extends RenderShotError {
  readonly statusCode: number;
  readonly detail: string;

  constructor(statusCode: number, detail: string) {
    super(`HTTP ${statusCode}: ${detail}`);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class AuthenticationError extends APIError {
  constructor(statusCode: number, detail: string) {
    super(statusCode, detail);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends APIError {
  readonly retryAfter: number;

  constructor(statusCode: number, detail: string, retryAfter: number) {
    super(statusCode, detail);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class JobFailedError extends RenderShotError {
  readonly jobId: string;

  constructor(jobId: string, message: string) {
    super(`Job ${jobId} failed: ${message}`);
    this.name = 'JobFailedError';
    this.jobId = jobId;
  }
}

export class JobTimeoutError extends RenderShotError {
  readonly jobId: string;
  readonly timeout: number;

  constructor(jobId: string, timeout: number) {
    super(`Job ${jobId} did not complete within ${timeout}s`);
    this.name = 'JobTimeoutError';
    this.jobId = jobId;
    this.timeout = timeout;
  }
}
