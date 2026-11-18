declare module '@cloudflare/playwright' {
  export type PlaywrightBrowser = import('playwright-core').Browser;
  export type PlaywrightBrowserContext = import('playwright-core').BrowserContext;
  export type PlaywrightCookie = import('playwright-core').Cookie;
  export type PlaywrightPage = import('playwright-core').Page;
  export type PlaywrightLocator = import('playwright-core').Locator;
  export function launch(endpoint: import('./env').BrowserWorker): Promise<PlaywrightBrowser>;
}
