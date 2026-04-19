import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

import {
  WebhookVerificationError,
  isValidSignature,
  verifySignature,
} from '../src/index.js';

const SECRET = 'supersecret';
const BODY = '{"event":"job.completed","job_id":"abc"}';
const TS = '1776540000';

function makeSig(ts: string, body: string | Buffer, secret = SECRET): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${ts}.`);
  mac.update(body);
  return `sha256=${mac.digest('hex')}`;
}

describe('isValidSignature', () => {
  it('accepts a matching signature', () => {
    expect(isValidSignature(SECRET, BODY, makeSig(TS, BODY), TS, { now: Number(TS) + 1 })).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(isValidSignature(SECRET, 'tampered', makeSig(TS, BODY), TS, { now: Number(TS) + 1 })).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(
      isValidSignature(SECRET, BODY, makeSig(TS, BODY, 'other'), TS, { now: Number(TS) + 1 }),
    ).toBe(false);
  });

  it('rejects a stale timestamp (past)', () => {
    expect(isValidSignature(SECRET, BODY, makeSig(TS, BODY), TS, { now: Number(TS) + 600 })).toBe(false);
  });

  it('rejects a future-skewed timestamp', () => {
    expect(isValidSignature(SECRET, BODY, makeSig(TS, BODY), TS, { now: Number(TS) - 600 })).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(isValidSignature(SECRET, BODY, null, TS)).toBe(false);
    expect(isValidSignature(SECRET, BODY, makeSig(TS, BODY), null)).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(
      isValidSignature(SECRET, BODY, makeSig(TS, BODY), 'nope', { now: Number(TS) }),
    ).toBe(false);
  });

  it('accepts a Buffer body', () => {
    const body = Buffer.from(BODY);
    expect(isValidSignature(SECRET, body, makeSig(TS, body), TS, { now: Number(TS) + 1 })).toBe(true);
  });

  it('rejects signature with wrong length (defends against timingSafeEqual throw)', () => {
    expect(isValidSignature(SECRET, BODY, 'sha256=short', TS, { now: Number(TS) + 1 })).toBe(false);
  });
});

describe('verifySignature', () => {
  it('returns void on success', () => {
    expect(() =>
      verifySignature(SECRET, BODY, makeSig(TS, BODY), TS, { now: Number(TS) + 1 }),
    ).not.toThrow();
  });

  it('throws WebhookVerificationError on failure', () => {
    expect(() =>
      verifySignature(SECRET, BODY, 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', TS, {
        now: Number(TS) + 1,
      }),
    ).toThrow(WebhookVerificationError);
  });
});
