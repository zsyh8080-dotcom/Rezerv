import {
  executeMultiDayReservationRun,
  resolveTargetMealDatesForExecution,
  runSyncWithSite,
  runTestLogin,
} from './core/runner';
import { isValidJalaliString, parseTimeString } from './core/jalali';
import { normalizePolicyConfig } from './core/policy';
import { createSandboxSeedHistory, SandboxIutSiteClient } from './core/site';
import {
  buildPublicSnapshot,
  createInitialPersistentState,
  DEFAULT_SANDBOX_CREDIT_RIALS,
  normalizeScheduleConfig,
  resetSandboxLedgerInState,
  type PersistentBotState,
} from './core/state';
import type { PolicyConfig, SandboxScenario, ScheduleConfig } from './core/types';

const STORAGE_KEY = 'rezerv-preview-v1';

function loadPreviewState(): PersistentBotState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const restored = JSON.parse(saved) as PersistentBotState;
      if (restored.schedule && restored.policy && Array.isArray(restored.history)) {
        restored.liveModeEnabled = false;
        restored.encryptedPassword = null;
        restored.schedule = normalizeScheduleConfig(restored.schedule);
        restored.policy = normalizePolicyConfig(restored.policy);
        return restored;
      }
    }
  } catch {
    // A fresh preview also works when browser storage is unavailable.
  }

  const initial = createInitialPersistentState(Date.now());
  const seed = createSandboxSeedHistory();
  initial.availableCreditRials = DEFAULT_SANDBOX_CREDIT_RIALS;
  initial.reservedMeals = seed.reservedMeals;
  initial.history = seed.history;
  initial.lastMessage = 'پیش‌نمایش آزمایشی با داده‌های نمونه آماده است.';
  return initial;
}

const state = loadPreviewState();

function persistPreview(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the current interactive session usable without persistent storage.
  }
}

export async function previewRequest(url: string, init?: RequestInit) {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const ledger = {
    scenario: state.sandboxScenario,
    creditRials: state.availableCreditRials ?? DEFAULT_SANDBOX_CREDIT_RIALS,
    reservedMeals: [...state.reservedMeals],
  };
  const context = {
    state,
    encryptionKey: 'rezerv-public-sandbox-simulation-key',
    runtimeUsername: state.username,
    runtimePassword: 'sandbox-demo-only',
    siteClient: new SandboxIutSiteClient(ledger),
  };

  switch (url) {
    case '/api/state':
      break;
    case '/api/account':
      state.username = String(body.username || state.username).trim();
      state.lastMessage = 'نام کاربری پیش‌نمایش ذخیره شد. آزمایش با حساب نمونه انجام می‌شود.';
      break;
    case '/api/schedule': {
      const schedule = body as Partial<ScheduleConfig>;
      if (schedule.actionTimeTehran && !parseTimeString(schedule.actionTimeTehran)) {
        throw new Error('ساعت انتخاب‌شده نامعتبر است.');
      }
      for (const date of [schedule.onceActionDateJalali, schedule.onceTargetMealDateJalali]) {
        if (date && !isValidJalaliString(date)) {
          throw new Error('تاریخ انتخاب‌شده نامعتبر است.');
        }
      }
      state.schedule = normalizeScheduleConfig({ ...state.schedule, ...schedule });
      break;
    }
    case '/api/policy':
      state.policy = normalizePolicyConfig({ ...state.policy, ...(body as Partial<PolicyConfig>) });
      break;
    case '/api/stop-schedule':
      state.schedule.enabled = false;
      state.lastStatus = 'PAUSED';
      state.lastMessage = 'زمان‌بندی آزمایشی متوقف شد.';
      break;
    case '/api/runtime-mode':
      if (body.liveModeEnabled) {
        throw new Error('اتصال واقعی دانشگاه به استقرار Worker با Browser Run نیاز دارد. این لینک پیش‌نمایش آزمایشی است.');
      }
      break;
    case '/api/test-live-login':
      throw new Error('برای ورود واقعی، Worker اصلی پروژه را همراه Browser Run و Secrets حساب مستقر کنید.');
    case '/api/test-login':
    case '/api/test-connection':
      await runTestLogin(context);
      break;
    case '/api/sync':
      await runSyncWithSite(context);
      break;
    case '/api/reserve-now': {
      const targets = body.targetDateJalali
        ? [String(body.targetDateJalali)]
        : resolveTargetMealDatesForExecution(state, Date.now());
      if (targets.some((date) => !isValidJalaliString(date))) {
        throw new Error('تاریخ دریافت غذا نامعتبر است.');
      }
      await executeMultiDayReservationRun(context, 'MANUAL', targets);
      break;
    }
    case '/api/sandbox/scenario':
      state.sandboxScenario = body.scenario as SandboxScenario;
      break;
    case '/api/sandbox/reset':
      resetSandboxLedgerInState(state, createSandboxSeedHistory());
      break;
    default:
      throw new Error('این عملیات در پیش‌نمایش موجود نیست.');
  }

  persistPreview();
  return buildPublicSnapshot(state, {
    runtimeMode: 'SANDBOX',
    runtimeUsernameConfigured: false,
    runtimePasswordConfigured: false,
    nowUtcMs: Date.now(),
  });
}
