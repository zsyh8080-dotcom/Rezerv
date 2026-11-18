export interface CloudflareEnv {
  MYBROWSER?: BrowserWorker;
  SCHEDULER_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  IUT_USERNAME?: string;
  IUT_PASSWORD?: string;
  APP_ENCRYPTION_KEY?: string;
  PANEL_ACCESS_TOKEN?: string;
  SETUP_KEY?: string;
  SANDBOX_FALLBACK?: string;
}

export interface BrowserWorker {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface SqlStorageCursor<T = Record<string, unknown>> {
  toArray(): T[];
  one(): T;
}

export interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
}

export interface DurableObjectStorage {
  sql: SqlStorage;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectState {
  id: DurableObjectId;
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
