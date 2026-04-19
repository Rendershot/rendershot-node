import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RenderShotClient } from '../src/index.js';

const API_KEY = 'test-key-123';
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(100).fill(0)]);
const FAKE_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, ...new Array(100).fill(0)]);

let client: RenderShotClient;
let fetchMock: ReturnType<typeof vi.fn>;

function binaryResponse(data: Buffer, status = 200): Response {
  return new Response(data, { status });
}

function lastJsonBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = new RenderShotClient({ apiKey: API_KEY });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Authenticated render options', () => {
  it('forwards custom headers on screenshotUrl', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
    await client.screenshotUrl('https://example.com', {
      headers: { Authorization: 'Bearer abc', 'X-Tenant': 'acme' },
    });
    expect(lastJsonBody().headers).toEqual({
      Authorization: 'Bearer abc',
      'X-Tenant': 'acme',
    });
  });

  it('serialises cookies to snake_case for the wire', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
    await client.screenshotUrl('https://example.com', {
      cookies: [
        {
          name: 'sid',
          value: 'abc',
          domain: 'example.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
    });
    expect(lastJsonBody().cookies).toEqual([
      {
        name: 'sid',
        value: 'abc',
        domain: 'example.com',
        path: '/',
        http_only: true,
        secure: true,
        same_site: 'Lax',
      },
    ]);
  });

  it('forwards basicAuth on pdfUrl', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
    await client.pdfUrl('https://staging.example.com', {
      basicAuth: { username: 'u', password: 'p' },
    });
    expect(lastJsonBody().basic_auth).toEqual({ username: 'u', password: 'p' });
  });

  it('omits auth fields when unset', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
    await client.screenshotUrl('https://example.com');
    const body = lastJsonBody();
    expect(body.headers).toBeUndefined();
    expect(body.cookies).toBeUndefined();
    expect(body.basic_auth).toBeUndefined();
  });

  it('forwards headers on screenshotHtml', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
    await client.screenshotHtml('<h1>x</h1>', { headers: { 'X-A': '1' } });
    expect(lastJsonBody().headers).toEqual({ 'X-A': '1' });
  });

  it('forwards headers on pdfHtml', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PDF));
    await client.pdfHtml('<h1>x</h1>', { headers: { 'X-A': '1' } });
    expect(lastJsonBody().headers).toEqual({ 'X-A': '1' });
  });

  it('omits empty-dict headers', async () => {
    fetchMock.mockResolvedValueOnce(binaryResponse(FAKE_PNG));
    await client.screenshotUrl('https://example.com', { headers: {} });
    expect(lastJsonBody().headers).toBeUndefined();
  });
});
