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

## Handling networkidle timeouts

Some URLs never reach `networkidle` (e.g. sites with persistent WebSocket connections). Use `timeoutFallbackTo` to automatically retry with a different wait strategy when a timeout occurs:

```typescript
// Single URL — retries automatically on timeout
const png = await client.screenshotUrl('https://example.com', {
  timeoutFallbackTo: 'domcontentloaded',
});

// Save to file
await client.screenshotUrlToFile('https://example.com', 'screenshot.png', {
  timeoutFallbackTo: 'domcontentloaded',
});

// Bulk — each timed-out job is individually retried
const paths = await client.bulkScreenshotUrls(
  ['https://example.com', 'https://example2.com'],
  './screenshots',
  { timeoutFallbackTo: 'domcontentloaded' },
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
