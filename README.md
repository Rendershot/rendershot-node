# rendershot

[![CI](https://github.com/Rendershot/rendershot-node/actions/workflows/ci.yml/badge.svg)](https://github.com/Rendershot/rendershot-node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/rendershot)](https://www.npmjs.com/package/rendershot)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Node.js SDK for the [Rendershot](https://rendershot.io) screenshot & PDF generation API.

## Installation

```bash
npm install rendershot
```

## Quick start

```typescript
import { RenderShotClient } from 'rendershot';

const client = new RenderShotClient({ apiKey: 'your-api-key' });

// Capture a screenshot
const png = await client.screenshotUrl('https://example.com');

// Save directly to a file
await client.screenshotUrlToFile('https://example.com', 'screenshot.png');

// Render a PDF
const pdf = await client.pdfUrl('https://example.com');
await client.pdfHtmlToFile('<h1>Hello</h1>', 'output.pdf');

// Check your balance
const balance = await client.getBalance();
console.log(balance.creditsRemaining);
```

## Bulk rendering

All bulk methods submit jobs via the `/v1/bulk` endpoint, poll until complete, and save results to a folder.

```typescript
// Bulk screenshots from URLs
const paths = await client.bulkScreenshotUrls(
  ['https://example.com', 'https://github.com'],
  '/tmp/screenshots',
);

// Bulk PDFs from a template (great for invoices)
const pdfPaths = await client.bulkPdfFromTemplate(
  '<html><body><h1>Invoice #{{ invoice_id }}</h1><p>Amount: ${{ amount }}</p></body></html>',
  [
    { invoice_id: '1001', amount: '99.00' },
    { invoice_id: '1002', amount: '149.00' },
  ],
  '/tmp/invoices',
);
```

## AI cleanup (remove cookie banners & popups)

Pass `aiCleanup` to have the backend strip common cookie banners, consent overlays, and popup modals before the render. Two modes:

- `'fast'` — JS heuristics (1 credit, same as a plain render).
- `'thorough'` — adds a Claude LLM pass that snapshots the DOM and identifies remaining overlays (3 credits; backend must have an Anthropic key configured).

```typescript
const png = await client.screenshotUrl('https://example.com', {
  aiCleanup: 'fast',
});

const pdf = await client.pdfUrl('https://example.com', {
  aiCleanup: 'thorough',
});
```

Works on all single and bulk methods.

## Authenticated pages

Render pages behind a login by passing custom HTTP headers, session cookies, or HTTP Basic auth with the request. Credentials never persist — they ride on the request payload only.

```typescript
// Bearer token + session cookie
const png = await client.screenshotUrl('https://app.example.com/dashboard', {
  headers: {
    Authorization: 'Bearer sk_internal_...',
    'X-Tenant-Id': 'acme',
  },
  cookies: [
    {
      name: 'session_id',
      value: 'eyJhbGciOi...',
      domain: 'app.example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ],
});

// HTTP Basic auth
const pdf = await client.pdfUrl('https://staging.example.com/report', {
  basicAuth: { username: 'staging', password: 'hunter2' },
});
```

Reserved header names (`Host`, `Cookie`, `Content-Length`, `Sec-*`, `Connection`) are rejected server-side. Max 30 headers / 50 cookies per request; header values up to 2 KB.

## Verifying webhook signatures

Rendershot signs every outbound webhook POST with HMAC-SHA256 over `` `${timestamp}.${body}` `` using the per-endpoint secret shown on the Webhooks dashboard. Use the SDK helpers in your receiver to reject forged or replayed requests.

```typescript
import express from 'express';
import { isValidSignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from 'rendershot';

const WEBHOOK_SECRET = 'your-endpoint-secret'; // from the dashboard

const app = express();

// IMPORTANT: use the raw body, not a parsed one — the signature covers bytes.
app.post(
  '/rendershot-webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const ok = isValidSignature(
      WEBHOOK_SECRET,
      req.body,
      req.header(SIGNATURE_HEADER),
      req.header(TIMESTAMP_HEADER),
    );
    if (!ok) return res.status(400).send('bad signature');
    const payload = JSON.parse(req.body.toString('utf-8'));
    // ... handle job.completed / job.failed ...
    res.sendStatus(200);
  },
);
```

`verifySignature` throws `WebhookVerificationError` instead of returning a bool if you prefer exception-based flow. Both accept `{ maxAgeSeconds: 300 }` (default) to bound replay attacks.

## Handling network_idle timeouts

Some URLs never reach `network_idle` (e.g. sites with persistent WebSocket connections). Use `timeoutFallbackTo` to automatically retry with a different wait strategy when a timeout occurs:

```typescript
// Single URL — retries automatically on timeout
const png = await client.screenshotUrl('https://example.com', {
  waitFor: 'network_idle',
  timeoutFallbackTo: 'dom_content_loaded',
});

// Save to file
await client.screenshotUrlToFile('https://example.com', 'screenshot.png', {
  waitFor: 'network_idle',
  timeoutFallbackTo: 'dom_content_loaded',
});

// Bulk — each timed-out job is individually retried
const paths = await client.bulkScreenshotUrls(
  ['https://example.com', 'https://example2.com'],
  './screenshots',
  { waitFor: 'network_idle', timeoutFallbackTo: 'dom_content_loaded' },
);
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `apiKey` | required | Your Rendershot API key |
| `baseUrl` | `https://api.rendershot.io` | API base URL |

Bulk methods also accept `pollInterval` (seconds, default `2.0`) and `timeout` (seconds, default `300.0`).

## Error handling

```typescript
import {
  RenderShotClient,
  AuthenticationError,
  RateLimitError,
  JobFailedError,
  APIError,
} from 'rendershot';

try {
  await client.screenshotUrl('https://example.com');
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (err instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${err.retryAfter}s`);
  } else if (err instanceof JobFailedError) {
    console.log(`Job ${err.jobId} failed`);
  } else if (err instanceof APIError) {
    console.log(`API error ${err.statusCode}: ${err.detail}`);
  }
}
```

## Requirements

- Node.js 18+

## License

MIT
