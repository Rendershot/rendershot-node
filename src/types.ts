export type ScreenshotFormat = 'png' | 'jpeg';

export type PDFFormat = 'A3' | 'A4' | 'Letter' | 'Legal';

export type PDFOrientation = 'portrait' | 'landscape';

export type AICleanupMode = 'fast' | 'thorough';

export interface ViewportParams {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

export interface ClipParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarginParams {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export type SameSite = 'Lax' | 'Strict' | 'None';

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSite;
}

export interface BasicAuth {
  username: string;
  password: string;
}

/**
 * Optional fields for rendering pages behind a login.
 *
 * Credentials are never persisted by the backend — they live only on the
 * request payload for the duration of the render.
 */
export interface AuthRenderOptions {
  headers?: Record<string, string>;
  cookies?: Cookie[];
  basicAuth?: BasicAuth;
}

export interface ScreenshotOptions extends AuthRenderOptions {
  format?: ScreenshotFormat;
  quality?: number;
  viewport?: ViewportParams;
  fullPage?: boolean;
  clip?: ClipParams;
  waitFor?: string;
  delayMs?: number;
  aiCleanup?: AICleanupMode;
  timeoutFallbackTo?: string;
}

export interface PDFOptions extends AuthRenderOptions {
  format?: PDFFormat;
  orientation?: PDFOrientation;
  margin?: MarginParams;
  printBackground?: boolean;
  waitFor?: string;
  delayMs?: number;
  aiCleanup?: AICleanupMode;
  timeoutFallbackTo?: string;
}

export interface BulkOptions {
  pollInterval?: number;
  timeout?: number;
  filenames?: string[];
  timeoutFallbackTo?: string;
}

export interface CreditBalance {
  creditsRemaining: number;
  planId: string;
  status: string;
  currentPeriodEnd: string;
}

export interface BulkJobResult {
  index: number;
  jobId: string | null;
  status: string | null;
  pollUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface BulkRenderResponse {
  submitted: number;
  failed: number;
  jobs: BulkJobResult[];
  creditsUsed: number;
  creditsRemaining: number;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
}
