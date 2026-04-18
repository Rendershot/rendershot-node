import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
  RenderShotClient,
  AuthenticationError,
  RateLimitError,
  APIError,
  JobFailedError,
} from '../src/index.js';

const API_KEY = 'test-key-123';
const BASE_URL = 'https://api.rendershot.io';
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
const FAKE_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...new Array(100).fill(0)]);
const JOB_ID = 'job-abc-123';

const BALANCE_PAYLOAD = {
  credits_remaining: 50,
  plan_id: 'free',
  status: 'active',
  current_period_end: '2026-05-01T00:00:00Z',
};

const BULK_RESPONSE = {
  submitted: 1,
  failed: 0,
  credits_used: 1,
  credits_remaining: 49,
  jobs: [
    { index: 0, job_id: JOB_ID, status: 'queued', poll_url: `/v1/jobs/${JOB_ID}` },
  ],
};

const JOB_DONE = { status: 'completed', job_id: JOB_ID };
const JOB_FAILED = { status: 'failed', job_id: JOB_ID, error_message: 'render error' };

let client: RenderShotClient;
let fetchMock: ReturnType<typeof vi.fn>;
let tmpDir: string;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function binaryResponse(data: Buffer, status = 200): Response {
  return new Response(data, { status });
}

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = new RenderShotClient({ apiKey: API_KEY });
  tmpDir = await mkdtemp(join(tmpdir(), 'rendershot-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('RenderShotClient', () => {
  describe('screenshot', () => {
    it('screenshotUrl returns bytes', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      const result = await client.screenshotUrl('https://example.com');
      expect(Buffer.compare(result, FAKE_PNG)).toBe(0);
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/screenshot`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('screenshotHtml returns bytes', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      const result = await client.screenshotHtml('<h1>Hello</h1>');
      expect(Buffer.compare(result, FAKE_PNG)).toBe(0);
    });

    it('screenshotUrlToFile saves to disk', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      const dest = join(tmpDir, 'out.png');
      const result = await client.screenshotUrlToFile('https://example.com', dest);
      expect(result).toBe(dest);
      const content = await readFile(dest);
      expect(Buffer.compare(content, FAKE_PNG)).toBe(0);
    });

    it('screenshotHtmlToFile saves to disk', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      const dest = join(tmpDir, 'out.png');
      const result = await client.screenshotHtmlToFile('<h1>Hello</h1>', dest);
      expect(result).toBe(dest);
      const content = await readFile(dest);
      expect(Buffer.compare(content, FAKE_PNG)).toBe(0);
    });
  });

  describe('pdf', () => {
    it('pdfUrl returns bytes', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
      const result = await client.pdfUrl('https://example.com');
      expect(Buffer.compare(result, FAKE_PDF)).toBe(0);
    });

    it('pdfHtml returns bytes', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
      const result = await client.pdfHtml('<h1>Invoice</h1>');
      expect(Buffer.compare(result, FAKE_PDF)).toBe(0);
    });

    it('pdfUrlToFile saves to disk', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
      const dest = join(tmpDir, 'out.pdf');
      const result = await client.pdfUrlToFile('https://example.com', dest);
      expect(result).toBe(dest);
      const content = await readFile(dest);
      expect(Buffer.compare(content, FAKE_PDF)).toBe(0);
    });

    it('pdfHtmlToFile saves to disk', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
      const dest = join(tmpDir, 'out.pdf');
      const result = await client.pdfHtmlToFile('<h1>Invoice</h1>', dest);
      expect(result).toBe(dest);
      const content = await readFile(dest);
      expect(Buffer.compare(content, FAKE_PDF)).toBe(0);
    });
  });

  describe('balance', () => {
    it('getBalance returns credit info', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(BALANCE_PAYLOAD));
      const balance = await client.getBalance();
      expect(balance.creditsRemaining).toBe(50);
      expect(balance.planId).toBe('free');
      expect(balance.currentPeriodEnd).toBe('2026-05-01T00:00:00Z');
    });
  });

  describe('errors', () => {
    it('throws AuthenticationError on 401', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ detail: 'Invalid API key' }, 401),
      );
      await expect(
        client.screenshotUrl('https://example.com'),
      ).rejects.toThrow(AuthenticationError);
    });

    it('throws RateLimitError on 429 with retryAfter', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { detail: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests', retry_after: 30 } },
          429,
        ),
      );
      try {
        await client.screenshotUrl('https://example.com');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfter).toBe(30);
      }
    });

    it('throws APIError on 500', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ detail: 'Internal server error' }, 500),
      );
      await expect(
        client.screenshotUrl('https://example.com'),
      ).rejects.toThrow(APIError);
    });
  });

  describe('api key header', () => {
    it('sends X-API-Key header', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      await client.screenshotUrl('https://example.com');
      const callHeaders = fetchMock.mock.calls[0][1].headers;
      expect(callHeaders['X-API-Key']).toBe(API_KEY);
    });
  });

  describe('timeout fallback', () => {
    it('retries with fallback wait strategy on timeout', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            { detail: { code: 'RENDER_ERROR', message: 'Page.goto: Timeout 30000ms exceeded' } },
            500,
          ),
        )
        .mockResolvedValueOnce(binaryResponse(FAKE_PNG));

      const result = await client.screenshotUrl('https://example.com', {
        timeoutFallbackTo: 'dom_content_loaded',
      });
      expect(Buffer.compare(result, FAKE_PNG)).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondBody.wait_for).toBe('dom_content_loaded');
    });

    it('throws without fallback on timeout', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { detail: { code: 'RENDER_ERROR', message: 'Page.goto: Timeout 30000ms exceeded' } },
          500,
        ),
      );
      await expect(
        client.screenshotUrl('https://example.com'),
      ).rejects.toThrow(APIError);
    });
  });

  describe('ai_cleanup', () => {
    it('sends ai_cleanup when provided on screenshot', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      await client.screenshotUrl('https://example.com', { aiCleanup: 'fast' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.ai_cleanup).toBe('fast');
    });

    it('omits ai_cleanup when not provided', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
      await client.screenshotUrl('https://example.com');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('ai_cleanup');
    });

    it('sends ai_cleanup when provided on pdf', async () => {
      fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
      await client.pdfUrl('https://example.com', { aiCleanup: 'thorough' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.ai_cleanup).toBe('thorough');
    });
  });

  describe('bulk', () => {
    it('bulkScreenshotUrls downloads and saves files', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(BULK_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(JOB_DONE))
        .mockResolvedValueOnce(binaryResponse(FAKE_PNG));

      const paths = await client.bulkScreenshotUrls(
        ['https://example.com'],
        tmpDir,
      );
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('.png');
      const content = await readFile(paths[0]);
      expect(Buffer.compare(content, FAKE_PNG)).toBe(0);
    });

    it('bulkScreenshotUrls with custom filenames', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(BULK_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(JOB_DONE))
        .mockResolvedValueOnce(binaryResponse(FAKE_PNG));

      const paths = await client.bulkScreenshotUrls(
        ['https://example.com'],
        tmpDir,
        { filenames: ['homepage.png'] },
      );
      expect(paths[0]).toContain('homepage.png');
    });

    it('bulkPdfFromTemplate renders and saves', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(BULK_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(JOB_DONE))
        .mockResolvedValueOnce(binaryResponse(FAKE_PDF));

      const paths = await client.bulkPdfFromTemplate(
        '<h1>Invoice #{{ number }}</h1>',
        [{ number: 1 }],
        tmpDir,
      );
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('.pdf');
    });

    it('throws JobFailedError on failed job', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(BULK_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(JOB_FAILED));

      await expect(
        client.bulkScreenshotUrls(['https://example.com'], tmpDir),
      ).rejects.toThrow(JobFailedError);
    });
  });
});
