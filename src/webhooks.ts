/**
 * Webhook receiver utilities.
 *
 * Rendershot signs every outbound webhook POST with HMAC-SHA256 over
 * `${timestamp}.${body}` using the per-endpoint secret shown on the
 * Webhooks dashboard page. Use {@link isValidSignature} in your receiver
 * to reject forged or replayed requests before acting on them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Rendershot-Signature';
export const TIMESTAMP_HEADER = 'X-Rendershot-Timestamp';
export const EVENT_HEADER = 'X-Rendershot-Event';
export const DELIVERY_HEADER = 'X-Rendershot-Delivery';

export const DEFAULT_MAX_AGE_SECONDS = 300;

export class WebhookVerificationError extends Error {
  constructor(message: string = 'webhook signature verification failed') {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface VerifyOptions {
  maxAgeSeconds?: number;
  /** Inject a clock for testing. Defaults to `Date.now() / 1000`. */
  now?: number;
}

function computeExpected(secret: string, timestamp: string, body: Buffer): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.`);
  mac.update(body);
  return `sha256=${mac.digest('hex')}`;
}

function safeEqualStrings(a: string, b: string): boolean {
  // `timingSafeEqual` requires equal-length buffers — bail early on length
  // mismatch so we don't throw before the comparison runs.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Returns `true` iff the HMAC signature matches and is within the age window.
 * Never throws — designed for "if (!ok) return 400" flows.
 */
export function isValidSignature(
  secret: string,
  body: Buffer | string,
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  options: VerifyOptions = {},
): boolean {
  if (!signatureHeader || !timestampHeader) return false;

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;

  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const now = options.now ?? Date.now() / 1000;
  if (Math.abs(now - ts) > maxAge) return false;

  const bodyBuf = typeof body === 'string' ? Buffer.from(body) : body;
  const expected = computeExpected(secret, timestampHeader, bodyBuf);
  return safeEqualStrings(expected, signatureHeader);
}

/**
 * Throws {@link WebhookVerificationError} on any failure. Use when you'd
 * rather let an exception bubble up than branch on a bool.
 */
export function verifySignature(
  secret: string,
  body: Buffer | string,
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  options: VerifyOptions = {},
): void {
  if (!isValidSignature(secret, body, signatureHeader, timestampHeader, options)) {
    throw new WebhookVerificationError();
  }
}
