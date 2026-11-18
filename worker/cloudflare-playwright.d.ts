declare module '@cloudflare/playwright' {
  import type { BrowserWorker } from './env';

  export interface PlaywrightCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }

  export interface PlaywrightLocator {
    first(): PlaywrightLocator;
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    textContent(): Promise<string | null>;
    innerText(): Promise<string>;
    fill(value: string): Promise<void>;
    click(opts?: { timeout?: number }): Promise<void>;
    evaluate<T>(fn: (el: Element) => T): Promise<T>;
  }

  export interface PlaywrightPage {
    url(): string;
    goto(
      url: string,
      opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }
    ): Promise<unknown>;
    reload(opts?: {
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      timeout?: number;
    }): Promise<unknown>;
    route(
      url: string | RegExp,
      handler: (route: {
        request(): { resourceType(): string; url(): string };
        abort(): Promise<void>;
        continue(): Promise<void>;
      }) => Promise<void> | void
    ): Promise<void>;
    waitForTimeout(ms: number): Promise<void>;
    waitForLoadState(
      state?: 'load' | 'domcontentloaded' | 'networkidle',
      opts?: { timeout?: number }
    ): Promise<void>;
    locator(selector: string): PlaywrightLocator;
    evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
    content(): Promise<string>;
    close(): Promise<void>;
  }

  export interface PlaywrightBrowserContext {
    addCookies(cookies: PlaywrightCookie[]): Promise<void>;
    cookies(urls?: string[]): Promise<PlaywrightCookie[]>;
    newPage(): Promise<PlaywrightPage>;
  }

  export interface PlaywrightBrowser {
    newContext(opts?: { locale?: string; timezoneId?: string }): Promise<PlaywrightBrowserContext>;
    close(): Promise<void>;
  }

  export function launch(endpoint: BrowserWorker): Promise<PlaywrightBrowser>;
}
