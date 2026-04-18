import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  APIError,
  AuthenticationError,
  JobFailedError,
  JobTimeoutError,
  RateLimitError,
} from './errors.js';
import type {
  AICleanupMode,
  BulkJobResult,
  BulkOptions,
  BulkRenderResponse,
  ClipParams,
  ClientOptions,
  CreditBalance,
  MarginParams,
  PDFFormat,
  PDFOptions,
  PDFOrientation,
  ScreenshotFormat,
  ScreenshotOptions,
  ViewportParams,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.rendershot.io';
const BULK_BATCH_SIZE = 20;
const HTTP_TIMEOUT_MS = 120_000;

function buildScreenshotPayload(options: {
  url?: string;
  html?: string;
  format: ScreenshotFormat;
  quality: number;
  viewport: ViewportParams;
  fullPage: boolean;
  clip?: ClipParams;
  waitFor: string;
  delayMs: number;
  aiCleanup?: AICleanupMode;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    format: options.format,
    quality: options.quality,
    viewport: {
      width: options.viewport.width ?? 1280,
      height: options.viewport.height ?? 720,
      device_scale_factor: options.viewport.deviceScaleFactor ?? 1.0,
    },
    full_page: options.fullPage,
    wait_for: options.waitFor,
    delay_ms: options.delayMs,
  };
  if (options.url !== undefined) payload.url = options.url;
  if (options.html !== undefined) payload.html = options.html;
  if (options.clip !== undefined) payload.clip = options.clip;
  if (options.aiCleanup !== undefined) payload.ai_cleanup = options.aiCleanup;
  return payload;
}

function buildPdfPayload(options: {
  url?: string;
  html?: string;
  format: PDFFormat;
  orientation: PDFOrientation;
  margin: MarginParams;
  printBackground: boolean;
  waitFor: string;
  delayMs: number;
  aiCleanup?: AICleanupMode;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    format: options.format,
    orientation: options.orientation,
    margin: {
      top: options.margin.top ?? '1cm',
      right: options.margin.right ?? '1cm',
      bottom: options.margin.bottom ?? '1cm',
      left: options.margin.left ?? '1cm',
    },
    print_background: options.printBackground,
    wait_for: options.waitFor,
    delay_ms: options.delayMs,
  };
  if (options.url !== undefined) payload.url = options.url;
  if (options.html !== undefined) payload.html = options.html;
  if (options.aiCleanup !== undefined) payload.ai_cleanup = options.aiCleanup;
  return payload;
}

function isTimeoutError(err: APIError): boolean {
  return err.statusCode === 500 && err.detail.includes('Timeout');
}

function parseBulkResponse(raw: Record<string, unknown>): BulkRenderResponse {
  const jobs = (raw.jobs as Record<string, unknown>[]).map(
    (j): BulkJobResult => ({
      index: j.index as number,
      jobId: (j.job_id as string) ?? null,
      status: (j.status as string) ?? null,
      pollUrl: (j.poll_url as string) ?? null,
      errorCode: (j.error_code as string) ?? null,
      errorMessage: (j.error_message as string) ?? null,
    }),
  );
  return {
    submitted: raw.submitted as number,
    failed: raw.failed as number,
    jobs,
    creditsUsed: raw.credits_used as number,
    creditsRemaining: raw.credits_remaining as number,
  };
}

export class RenderShotClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.headers = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // --- internal helpers ---

  private async post(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    await this.raiseForStatus(response);
    return response;
  }

  private async get(path: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    await this.raiseForStatus(response);
    return response;
  }

  private async raiseForStatus(response: Response): Promise<void> {
    if (response.status < 400) return;

    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    let detail = body.detail ?? response.statusText;
    if (typeof detail === 'object' && detail !== null) {
      const d = detail as Record<string, unknown>;
      if (response.status === 429) {
        const retryAfter = Number(d.retry_after ?? 0);
        const message = String(d.message ?? JSON.stringify(detail));
        throw new RateLimitError(response.status, message, retryAfter);
      }
      detail = d.message ?? JSON.stringify(detail);
    }

    const detailStr = String(detail);
    if (response.status === 401) {
      throw new AuthenticationError(response.status, detailStr);
    }
    if (response.status === 429) {
      throw new RateLimitError(response.status, detailStr, 0);
    }
    throw new APIError(response.status, detailStr);
  }

  private async pollJob(
    jobId: string,
    pollInterval: number = 2.0,
    timeout: number = 300.0,
  ): Promise<void> {
    const deadline = Date.now() + timeout * 1000;
    while (true) {
      if (Date.now() > deadline) {
        throw new JobTimeoutError(jobId, timeout);
      }
      const response = await this.get(`/v1/jobs/${jobId}`);
      const data = (await response.json()) as Record<string, unknown>;
      const status = data.status as string;
      if (status === 'completed') return;
      if (status === 'failed') {
        throw new JobFailedError(
          jobId,
          (data.error_message as string) ?? 'unknown error',
        );
      }
      await new Promise((r) => setTimeout(r, pollInterval * 1000));
    }
  }

  private async bulkRenderAndSave(
    jobsPayload: Record<string, unknown>[],
    outputDir: string,
    ext: string,
    prefix: string,
    pollInterval: number = 2.0,
    timeout: number = 300.0,
    filenames?: string[],
    timeoutFallbackTo?: string,
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });

    const batches: Record<string, unknown>[][] = [];
    for (let i = 0; i < jobsPayload.length; i += BULK_BATCH_SIZE) {
      batches.push(jobsPayload.slice(i, i + BULK_BATCH_SIZE));
    }

    const jobEntries: Array<{
      originalIndex: number;
      jobId: string;
      payload: Record<string, unknown>;
    }> = [];
    let globalOffset = 0;

    for (const batch of batches) {
      const response = await this.post('/v1/bulk', { jobs: batch });
      const bulk = parseBulkResponse(
        (await response.json()) as Record<string, unknown>,
      );
      for (const result of bulk.jobs) {
        const originalIndex = globalOffset + result.index;
        if (result.jobId) {
          jobEntries.push({
            originalIndex,
            jobId: result.jobId,
            payload: jobsPayload[originalIndex],
          });
        }
      }
      globalOffset += batch.length;
    }

    const outputPaths: (string | null)[] = new Array(jobsPayload.length).fill(
      null,
    );

    const fetchOne = async (entry: {
      originalIndex: number;
      jobId: string;
      payload: Record<string, unknown>;
    }): Promise<void> => {
      let fileBytes: ArrayBuffer;
      try {
        await this.pollJob(entry.jobId, pollInterval, timeout);
        const result = await this.get(`/v1/jobs/${entry.jobId}/result`);
        fileBytes = await result.arrayBuffer();
      } catch (err) {
        if (
          err instanceof JobFailedError &&
          timeoutFallbackTo !== undefined &&
          err.message.includes('Timeout')
        ) {
          const retryResponse = await this.post('/v1/bulk', {
            jobs: [{ ...entry.payload, wait_for: timeoutFallbackTo }],
          });
          const retryBulk = parseBulkResponse(
            (await retryResponse.json()) as Record<string, unknown>,
          );
          const retryJobId = retryBulk.jobs[0]?.jobId;
          if (!retryJobId) {
            throw new JobFailedError('unknown', 'Retry job has no job_id');
          }
          await this.pollJob(retryJobId, pollInterval, timeout);
          const retryResult = await this.get(`/v1/jobs/${retryJobId}/result`);
          fileBytes = await retryResult.arrayBuffer();
        } else {
          throw err;
        }
      }
      const filename = filenames
        ? filenames[entry.originalIndex]
        : `${prefix}_${String(entry.originalIndex).padStart(4, '0')}.${ext}`;
      const dest = join(outputDir, filename);
      await writeFile(dest, Buffer.from(fileBytes));
      outputPaths[entry.originalIndex] = dest;
    };

    await Promise.all(jobEntries.map(fetchOne));

    return outputPaths.filter((p): p is string => p !== null);
  }

  // --- screenshot methods ---

  async screenshotUrl(
    url: string,
    options: ScreenshotOptions = {},
  ): Promise<Buffer> {
    const payload = buildScreenshotPayload({
      url,
      format: options.format ?? 'png',
      quality: options.quality ?? 85,
      viewport: options.viewport ?? {},
      fullPage: options.fullPage ?? false,
      clip: options.clip,
      waitFor: options.waitFor ?? 'dom_content_loaded',
      delayMs: options.delayMs ?? 0,
      aiCleanup: options.aiCleanup,
    });
    try {
      const response = await this.post('/v1/screenshot', payload);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (
        err instanceof APIError &&
        options.timeoutFallbackTo !== undefined &&
        isTimeoutError(err)
      ) {
        payload.wait_for = options.timeoutFallbackTo;
        const response = await this.post('/v1/screenshot', payload);
        return Buffer.from(await response.arrayBuffer());
      }
      throw err;
    }
  }

  async screenshotUrlToFile(
    url: string,
    outputPath: string,
    options: ScreenshotOptions = {},
  ): Promise<string> {
    const data = await this.screenshotUrl(url, options);
    await writeFile(outputPath, data);
    return outputPath;
  }

  async screenshotHtml(
    html: string,
    options: Omit<ScreenshotOptions, 'timeoutFallbackTo'> = {},
  ): Promise<Buffer> {
    const payload = buildScreenshotPayload({
      html,
      format: options.format ?? 'png',
      quality: options.quality ?? 85,
      viewport: options.viewport ?? {},
      fullPage: options.fullPage ?? false,
      clip: options.clip,
      waitFor: options.waitFor ?? 'dom_content_loaded',
      delayMs: options.delayMs ?? 0,
      aiCleanup: options.aiCleanup,
    });
    const response = await this.post('/v1/screenshot', payload);
    return Buffer.from(await response.arrayBuffer());
  }

  async screenshotHtmlToFile(
    html: string,
    outputPath: string,
    options: Omit<ScreenshotOptions, 'timeoutFallbackTo'> = {},
  ): Promise<string> {
    const data = await this.screenshotHtml(html, options);
    await writeFile(outputPath, data);
    return outputPath;
  }

  // --- pdf methods ---

  async pdfUrl(url: string, options: PDFOptions = {}): Promise<Buffer> {
    const payload = buildPdfPayload({
      url,
      format: options.format ?? 'A4',
      orientation: options.orientation ?? 'portrait',
      margin: options.margin ?? {},
      printBackground: options.printBackground ?? true,
      waitFor: options.waitFor ?? 'dom_content_loaded',
      delayMs: options.delayMs ?? 0,
      aiCleanup: options.aiCleanup,
    });
    try {
      const response = await this.post('/v1/pdf', payload);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (
        err instanceof APIError &&
        options.timeoutFallbackTo !== undefined &&
        isTimeoutError(err)
      ) {
        payload.wait_for = options.timeoutFallbackTo;
        const response = await this.post('/v1/pdf', payload);
        return Buffer.from(await response.arrayBuffer());
      }
      throw err;
    }
  }

  async pdfUrlToFile(
    url: string,
    outputPath: string,
    options: PDFOptions = {},
  ): Promise<string> {
    const data = await this.pdfUrl(url, options);
    await writeFile(outputPath, data);
    return outputPath;
  }

  async pdfHtml(
    html: string,
    options: Omit<PDFOptions, 'timeoutFallbackTo'> = {},
  ): Promise<Buffer> {
    const payload = buildPdfPayload({
      html,
      format: options.format ?? 'A4',
      orientation: options.orientation ?? 'portrait',
      margin: options.margin ?? {},
      printBackground: options.printBackground ?? true,
      waitFor: options.waitFor ?? 'dom_content_loaded',
      delayMs: options.delayMs ?? 0,
      aiCleanup: options.aiCleanup,
    });
    const response = await this.post('/v1/pdf', payload);
    return Buffer.from(await response.arrayBuffer());
  }

  async pdfHtmlToFile(
    html: string,
    outputPath: string,
    options: Omit<PDFOptions, 'timeoutFallbackTo'> = {},
  ): Promise<string> {
    const data = await this.pdfHtml(html, options);
    await writeFile(outputPath, data);
    return outputPath;
  }

  // --- balance ---

  async getBalance(): Promise<CreditBalance> {
    const response = await this.get('/v1/balance');
    const raw = (await response.json()) as Record<string, unknown>;
    return {
      creditsRemaining: raw.credits_remaining as number,
      planId: raw.plan_id as string,
      status: raw.status as string,
      currentPeriodEnd: raw.current_period_end as string,
    };
  }

  // --- bulk methods ---

  async bulkScreenshotUrls(
    urls: string[],
    outputDir: string,
    options: Omit<ScreenshotOptions, 'timeoutFallbackTo'> & BulkOptions = {},
  ): Promise<string[]> {
    const jobs = urls.map((url) => ({
      ...buildScreenshotPayload({
        url,
        format: options.format ?? 'png',
        quality: options.quality ?? 85,
        viewport: options.viewport ?? {},
        fullPage: options.fullPage ?? false,
        clip: options.clip,
        waitFor: options.waitFor ?? 'dom_content_loaded',
        delayMs: options.delayMs ?? 0,
        aiCleanup: options.aiCleanup,
      }),
      type: 'screenshot',
    }));
    return this.bulkRenderAndSave(
      jobs,
      outputDir,
      options.format ?? 'png',
      'screenshot',
      options.pollInterval,
      options.timeout,
      options.filenames,
      options.timeoutFallbackTo,
    );
  }

  async bulkScreenshotHtmls(
    htmls: string[],
    outputDir: string,
    options: Omit<ScreenshotOptions, 'timeoutFallbackTo'> & BulkOptions = {},
  ): Promise<string[]> {
    const jobs = htmls.map((html) => ({
      ...buildScreenshotPayload({
        html,
        format: options.format ?? 'png',
        quality: options.quality ?? 85,
        viewport: options.viewport ?? {},
        fullPage: options.fullPage ?? false,
        clip: options.clip,
        waitFor: options.waitFor ?? 'dom_content_loaded',
        delayMs: options.delayMs ?? 0,
        aiCleanup: options.aiCleanup,
      }),
      type: 'screenshot',
    }));
    return this.bulkRenderAndSave(
      jobs,
      outputDir,
      options.format ?? 'png',
      'screenshot',
      options.pollInterval,
      options.timeout,
      options.filenames,
    );
  }

  async bulkPdfUrls(
    urls: string[],
    outputDir: string,
    options: Omit<PDFOptions, 'timeoutFallbackTo'> & BulkOptions = {},
  ): Promise<string[]> {
    const jobs = urls.map((url) => ({
      ...buildPdfPayload({
        url,
        format: options.format ?? 'A4',
        orientation: options.orientation ?? 'portrait',
        margin: options.margin ?? {},
        printBackground: options.printBackground ?? true,
        waitFor: options.waitFor ?? 'dom_content_loaded',
        delayMs: options.delayMs ?? 0,
        aiCleanup: options.aiCleanup,
      }),
      type: 'pdf',
    }));
    return this.bulkRenderAndSave(
      jobs,
      outputDir,
      'pdf',
      'pdf',
      options.pollInterval,
      options.timeout,
      options.filenames,
      options.timeoutFallbackTo,
    );
  }

  async bulkPdfHtmls(
    htmls: string[],
    outputDir: string,
    options: Omit<PDFOptions, 'timeoutFallbackTo'> & BulkOptions = {},
  ): Promise<string[]> {
    const jobs = htmls.map((html) => ({
      ...buildPdfPayload({
        html,
        format: options.format ?? 'A4',
        orientation: options.orientation ?? 'portrait',
        margin: options.margin ?? {},
        printBackground: options.printBackground ?? true,
        waitFor: options.waitFor ?? 'dom_content_loaded',
        delayMs: options.delayMs ?? 0,
        aiCleanup: options.aiCleanup,
      }),
      type: 'pdf',
    }));
    return this.bulkRenderAndSave(
      jobs,
      outputDir,
      'pdf',
      'pdf',
      options.pollInterval,
      options.timeout,
      options.filenames,
    );
  }

  async bulkPdfFromTemplate(
    templateStr: string,
    contexts: Record<string, unknown>[],
    outputDir: string,
    options: Omit<PDFOptions, 'timeoutFallbackTo'> & BulkOptions = {},
  ): Promise<string[]> {
    const htmls = contexts.map((ctx) =>
      templateStr.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_, key: string) => String(ctx[key] ?? ''),
      ),
    );
    return this.bulkPdfHtmls(htmls, outputDir, options);
  }
}
