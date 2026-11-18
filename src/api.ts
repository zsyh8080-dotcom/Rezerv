import type {
  AppStateSnapshot,
  PolicyConfig,
  SandboxScenario,
  ScheduleConfig,
} from './core/types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.MODE === 'preview') {
    const { previewRequest } = await import('./preview-api');
    return previewRequest(url, init) as Promise<T>;
  }

  const panelToken = sessionStorage.getItem('rezerv-panel-access-token');
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(panelToken ? { 'X-Panel-Token': panelToken } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `خطای سرور (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  setPanelAccessToken: (token: string) => sessionStorage.setItem('rezerv-panel-access-token', token),
  getState: () => requestJson<AppStateSnapshot>('/api/state'),

  saveAccount: (payload: { username: string; password?: string }) =>
    requestJson<AppStateSnapshot>('/api/account', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveSchedule: (payload: Partial<ScheduleConfig>) =>
    requestJson<AppStateSnapshot>('/api/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  savePolicy: (payload: Partial<PolicyConfig>) =>
    requestJson<AppStateSnapshot>('/api/policy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  testConnection: () =>
    requestJson<AppStateSnapshot>('/api/test-connection', {
      method: 'POST',
    }),

  testLogin: () =>
    requestJson<AppStateSnapshot>('/api/test-login', {
      method: 'POST',
    }),

  testLiveLogin: () =>
    requestJson<AppStateSnapshot>('/api/test-live-login', {
      method: 'POST',
    }),

  syncWithSite: () =>
    requestJson<AppStateSnapshot>('/api/sync', {
      method: 'POST',
    }),

  setRuntimeMode: (liveModeEnabled: boolean) =>
    requestJson<AppStateSnapshot>('/api/runtime-mode', {
      method: 'POST',
      body: JSON.stringify({ liveModeEnabled }),
    }),

  reserveNow: (targetDateJalali?: string) =>
    requestJson<AppStateSnapshot>('/api/reserve-now', {
      method: 'POST',
      body: JSON.stringify({ targetDateJalali }),
    }),

  stopSchedule: () =>
    requestJson<AppStateSnapshot>('/api/stop-schedule', {
      method: 'POST',
    }),

  setSandboxScenario: (scenario: SandboxScenario) =>
    requestJson<AppStateSnapshot>('/api/sandbox/scenario', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    }),

  resetSandbox: () =>
    requestJson<AppStateSnapshot>('/api/sandbox/reset', {
      method: 'POST',
    }),
};
