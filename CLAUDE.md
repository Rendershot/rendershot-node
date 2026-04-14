# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js SDK for the Rendershot screenshot & PDF generation API. Zero runtime dependencies, ESM-only, TypeScript with strict mode. Requires Node.js 18+.

## Commands

- `npm run build` — compile TypeScript to `dist/` (ES2022, Node16 module resolution)
- `npm test` — run all tests once with Vitest
- `npm run test:watch` — run tests in watch mode
- `npx vitest run tests/client.test.ts -t "test name"` — run a single test by name
- `npm run lint` — ESLint on `src/`
- `npm run type-check` — `tsc --noEmit`

## Architecture

Four source files in `src/`:

- **`client.ts`** — `RenderShotClient` class. All SDK functionality lives here: single renders (`screenshotUrl`, `screenshotHtml`, `pdfUrl`, `pdfHtml`), file-saving variants (`*ToFile`), bulk operations (`bulkScreenshotUrls`, `bulkPdfFromTemplate`, etc.), and `getBalance()`. Internal helpers handle HTTP requests, job polling with timeout, error mapping, and batch processing (20 jobs per batch).

- **`types.ts`** — All TypeScript interfaces and type aliases (`ScreenshotOptions`, `PDFOptions`, `BulkOptions`, `ClientOptions`, format/orientation unions, viewport/clip/margin params).

- **`errors.ts`** — Error class hierarchy: `RenderShotError` (base) → `APIError`, `AuthenticationError`, `RateLimitError`, `JobFailedError`, `JobTimeoutError`.

- **`index.ts`** — Public API barrel exports.

## Key Conventions

- SDK uses **camelCase** externally; payloads are converted to **snake_case** for the REST API internally in `client.ts`.
- Tests mock `global.fetch` via `vi.fn()` — no real HTTP calls in tests.
- Package has zero runtime dependencies; only dev dependencies (typescript, vitest, eslint, @types/node).
