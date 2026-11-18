import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { encryptSecret } from './src/core/crypto';
import {
  computeNextRunDetails,
  isValidJalaliString,
  parseTimeString,
} from './src/core/jalali';
import {
  executeMultiDayReservationRun,
  resolveTargetMealDatesForExecution,
  runEarlyLoginPreparation,
  runKeepAliveRefresh,
  runStandbyAndPrecisionExecuteMulti,
  runSyncWithSite,
  runTestLogin,
} from './src/core/runner';
import { normalizePolicyConfig } from './src/core/policy';
import {
  createSandboxSeedHistory,
  SandboxIutSiteClient,
  type IutSiteClient,
  type SandboxLedger,
} from './src/core/site';
import {
  buildPublicSnapshot,
  createInitialPersistentState,
  DEFAULT_SANDBOX_CREDIT_RIALS,
  extractRuntimeLedgerSlice,
  migrateLegacyMixedState,
  normalizeScheduleConfig,
  resetSandboxLedgerInState,
  switchRuntimeEnvironment,
  type PersistentBotState,
} from './src/core/state';
import type { PolicyConfig, SandboxScenario, ScheduleConfig } from './src/core/types';
import { LocalBrowserIutClient } from './server-live-iut';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'scheduler.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alarm_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    scheduled_utc_ms INTEGER,
    phase TEXT,
    target_date_jalali TEXT
  );
`);

function getServerEncryptionKey(): string {
  if (process.env.APP_ENCRYPTION_KEY && process.env.APP_ENCRYPTION_KEY.length >= 16) {
    return process.env.APP_ENCRYPTION_KEY;
  }
  const row = db
    .prepare(`SELECT value FROM kv_store WHERE key = 'local_dev_enc_key'`)
    .get() as { value: string } | undefined;
  if (row?.value) return row.value;
  const generated = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO kv_store (key, value) VALUES ('local_dev_enc_key', ?)`).run(generated);
  return generated;
}

const ENCRYPTION_KEY = getServerEncryptionKey();

function loadState(): PersistentBotState {
  const row = db
    .prepare(`SELECT value FROM kv_store WHERE key = 'bot_state'`)
    .get() as { value: string } | undefined;
  const seed = createSandboxSeedHistory();
  if (row?.value) {
    const parsed = JSON.parse(row.value) as PersistentBotState;
    parsed.policy = normalizePolicyConfig(parsed.policy);
    parsed.schedule = normalizeScheduleConfig(parsed.schedule);
    if (migrateLegacyMixedState(parsed, seed)) {
      saveState(parsed);
    }
    return parsed;
  }
  const initial = createInitialPersistentState(Date.now());
  initial.reservedMeals = seed.reservedMeals;
  initial.history = seed.history;
  initial.availableCreditRials = DEFAULT_SANDBOX_CREDIT_RIALS;
  if (process.env.IUT_USERNAME) {
    initial.username = process.env.IUT_USERNAME;
  }
  migrateLegacyMixedState(initial, seed);
  saveState(initial);
  return initial;
}

function saveState(state: PersistentBotState): void {
  db.prepare(
    `INSERT INTO kv_store (key, value) VALUES ('bot_state', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(state));
}

const initialState = loadState();
let sandboxLedger: SandboxLedger = {
  scenario: initialState.sandboxScenario,
  creditRials:
    (!initialState.liveModeEnabled
      ? initialState.availableCreditRials
      : initialState.sandboxData?.availableCreditRials) ?? DEFAULT_SANDBOX_CREDIT_RIALS,
  reservedMeals: [
    ...(!initialState.liveModeEnabled
      ? initialState.reservedMeals
      : initialState.sandboxData?.reservedMeals ?? []),
  ],
};

function getSandboxClient(state: PersistentBotState): SandboxIutSiteClient {
  sandboxLedger.scenario = state.sandboxScenario;
  if (!state.liveModeEnabled) {
    if (typeof state.availableCreditRials === 'number') {
      sandboxLedger.creditRials = state.availableCreditRials;
    }
    sandboxLedger.reservedMeals = [...state.reservedMeals];
  }
  return new SandboxIutSiteClient(sandboxLedger);
}

function getActiveSiteClient(state: PersistentBotState): {
  client: IutSiteClient;
  runtimeMode: 'SANDBOX' | 'LIVE_LOCAL_BROWSER';
} {
  if (state.liveModeEnabled) {
    return {
      client: new LocalBrowserIutClient(),
      runtimeMode: 'LIVE_LOCAL_BROWSER',
    };
  }
  return {
    client: getSandboxClient(state),
    runtimeMode: 'SANDBOX',
  };
}

let activeTimer: NodeJS.Timeout | null = null;

function scheduleAlarmTimer(
  scheduledUtcMs: number,
  phase: 'EARLY_LOGIN' | 'KEEP_ALIVE' | 'STANDBY_EXECUTE' | 'EXECUTE',
  targetMealDateJalali: string,
  actionUtcMs: number,
  nowUtcMs: number
): void {
  db.prepare(
    `INSERT INTO alarm_state (id, scheduled_utc_ms, phase, target_date_jalali)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       scheduled_utc_ms = excluded.scheduled_utc_ms,
       phase = excluded.phase,
       target_date_jalali = excluded.target_date_jalali`
  ).run(scheduledUtcMs, `${phase}|${actionUtcMs}`, targetMealDateJalali);

  const delayMs = Math.max(250, scheduledUtcMs - nowUtcMs);
  const safeDelay = Math.min(delayMs, 2147483647);
  activeTimer = setTimeout(() => {
    void handleAlarmTick();
  }, safeDelay);
  activeTimer.unref?.();
}

function syncBackgroundAlarm(state: PersistentBotState, nowUtcMs = Date.now()): void {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  if (!state.schedule.enabled || state.schedule.mode === 'now') {
    db.prepare(`DELETE FROM alarm_state WHERE id = 1`).run();
    return;
  }

  const next = computeNextRunDetails(state.schedule, nowUtcMs);
  if (!next.nextActionUtcMs || !next.targetMealDateJalali) {
    db.prepare(`DELETE FROM alarm_state WHERE id = 1`).run();
    return;
  }

  const actionUtcMs = next.nextActionUtcMs;
  const standbyUtcMs = state.schedule.subsecondExecution
    ? actionUtcMs - 35 * 1000
    : actionUtcMs;

  if (
    next.earlyLoginUtcMs &&
    next.earlyLoginUtcMs > nowUtcMs &&
    state.schedule.earlyLoginMinutes > 0
  ) {
    scheduleAlarmTimer(
      next.earlyLoginUtcMs,
      'EARLY_LOGIN',
      next.targetMealDateJalali,
      actionUtcMs,
      nowUtcMs
    );
    return;
  }

  if (state.schedule.keepSessionWarm && actionUtcMs - nowUtcMs > 4 * 60 * 1000) {
    scheduleAlarmTimer(
      actionUtcMs - 4 * 60 * 1000,
      'KEEP_ALIVE',
      next.targetMealDateJalali,
      actionUtcMs,
      nowUtcMs
    );
    return;
  }

  if (state.schedule.subsecondExecution && standbyUtcMs > nowUtcMs) {
    scheduleAlarmTimer(
      standbyUtcMs,
      'STANDBY_EXECUTE',
      next.targetMealDateJalali,
      actionUtcMs,
      nowUtcMs
    );
    return;
  }

  scheduleAlarmTimer(
    actionUtcMs,
    state.schedule.subsecondExecution ? 'STANDBY_EXECUTE' : 'EXECUTE',
    next.targetMealDateJalali,
    actionUtcMs,
    nowUtcMs
  );
}

async function handleAlarmTick(): Promise<void> {
  const row = db
    .prepare(`SELECT scheduled_utc_ms, phase, target_date_jalali FROM alarm_state WHERE id = 1`)
    .get() as
    | { scheduled_utc_ms: number; phase: string; target_date_jalali: string }
    | undefined;

  const state = loadState();
  if (!row || !state.schedule.enabled) return;

  if (Date.now() + 250 < row.scheduled_utc_ms) {
    syncBackgroundAlarm(state, Date.now());
    return;
  }

  const [phase, actionUtcStr] = row.phase.split('|');
  const targetActionUtcMs = Number(actionUtcStr) || Date.now();
  const { client } = getActiveSiteClient(state);
  const runnerCtx = {
    state,
    encryptionKey: ENCRYPTION_KEY,
    runtimeUsername: process.env.IUT_USERNAME,
    runtimePassword: process.env.IUT_PASSWORD,
    siteClient: client,
    nowUtcMs: Date.now(),
  };

  if (phase === 'EARLY_LOGIN') {
    await runEarlyLoginPreparation(runnerCtx);
    saveState(state);
    const now = Date.now();
    if (state.schedule.keepSessionWarm && targetActionUtcMs - now > 4 * 60 * 1000) {
      scheduleAlarmTimer(
        targetActionUtcMs - 4 * 60 * 1000,
        'KEEP_ALIVE',
        row.target_date_jalali,
        targetActionUtcMs,
        now
      );
    } else {
      const standbyAt = state.schedule.subsecondExecution
        ? Math.max(now + 250, targetActionUtcMs - 35 * 1000)
        : targetActionUtcMs;
      scheduleAlarmTimer(
        standbyAt,
        state.schedule.subsecondExecution ? 'STANDBY_EXECUTE' : 'EXECUTE',
        row.target_date_jalali,
        targetActionUtcMs,
        now
      );
    }
    return;
  }

  if (phase === 'KEEP_ALIVE') {
    await runKeepAliveRefresh(runnerCtx);
    saveState(state);
    const now = Date.now();
    const standbyAt = state.schedule.subsecondExecution
      ? Math.max(now + 250, targetActionUtcMs - 35 * 1000)
      : targetActionUtcMs;
    scheduleAlarmTimer(
      standbyAt,
      state.schedule.subsecondExecution ? 'STANDBY_EXECUTE' : 'EXECUTE',
      row.target_date_jalali,
      targetActionUtcMs,
      now
    );
    return;
  }

  const targetDates = resolveTargetMealDatesForExecution(state, targetActionUtcMs);

  if (phase === 'STANDBY_EXECUTE') {
    await runStandbyAndPrecisionExecuteMulti(
      runnerCtx,
      'SCHEDULED',
      targetActionUtcMs,
      targetDates,
      () => saveState(state)
    );
  } else {
    await executeMultiDayReservationRun(runnerCtx, 'SCHEDULED', targetDates);
  }

  if (state.schedule.mode === 'once') {
    state.schedule.enabled = false;
  }
  saveState(state);
  syncBackgroundAlarm(state, Date.now() + 1000);
}

function makeSnapshot(state: PersistentBotState) {
  return buildPublicSnapshot(state, {
    runtimeMode: state.liveModeEnabled ? 'LIVE_LOCAL_BROWSER' : 'SANDBOX',
    runtimeUsernameConfigured: Boolean(process.env.IUT_USERNAME),
    runtimePasswordConfigured: Boolean(process.env.IUT_PASSWORD),
    nowUtcMs: Date.now(),
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/state', (_req, res) => {
    const state = loadState();
    res.json(makeSnapshot(state));
  });

  app.post('/api/account', async (req, res) => {
    const state = loadState();
    const { username, password } = req.body as { username?: string; password?: string };
    if (username && username.trim()) {
      state.username = username.trim();
    }
    if (password && password.trim()) {
      state.encryptedPassword = await encryptSecret(password.trim(), ENCRYPTION_KEY);
      state.encryptedSession = null;
    }
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/schedule', (req, res) => {
    const state = loadState();
    const body = req.body as Partial<ScheduleConfig>;
    if (body.actionTimeTehran && !parseTimeString(body.actionTimeTehran)) {
      res.status(400).json({ error: 'فرمت ساعت تهران نامعتبر است (مثال: 20:30).' });
      return;
    }
    if (body.onceActionDateJalali && !isValidJalaliString(body.onceActionDateJalali)) {
      res.status(400).json({ error: 'تاریخ اجرای شمسی نامعتبر است.' });
      return;
    }
    if (body.onceTargetMealDateJalali && !isValidJalaliString(body.onceTargetMealDateJalali)) {
      res.status(400).json({ error: 'تاریخ دریافت غذا (شمسی) نامعتبر است.' });
      return;
    }
    if (
      Array.isArray(body.weeklyTargetMealJsWeekdays) &&
      body.weeklyTargetMealJsWeekdays.length === 0
    ) {
      res.status(400).json({ error: 'حداقل یک روز برای غذا انتخاب کنید.' });
      return;
    }

    state.schedule = normalizeScheduleConfig({
      ...state.schedule,
      ...body,
    });
    saveState(state);
    syncBackgroundAlarm(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/policy', (req, res) => {
    const state = loadState();
    const body = req.body as Partial<PolicyConfig>;
    state.policy = normalizePolicyConfig({
      ...state.policy,
      ...body,
      meal: 'lunch',
      quantity: 1,
      creditOnly: true,
    });
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/stop-schedule', (_req, res) => {
    const state = loadState();
    state.schedule.enabled = false;
    state.lastStatus = 'PAUSED';
    state.lastMessage = 'زمان‌بندی خودکار متوقف شد.';
    saveState(state);
    syncBackgroundAlarm(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/runtime-mode', (req, res) => {
    const state = loadState();
    const { liveModeEnabled } = (req.body || {}) as { liveModeEnabled?: boolean };
    const nextLive = Boolean(liveModeEnabled);
    switchRuntimeEnvironment(state, nextLive, createSandboxSeedHistory());
    if (!nextLive) {
      sandboxLedger = {
        scenario: state.sandboxScenario,
        creditRials: state.availableCreditRials ?? DEFAULT_SANDBOX_CREDIT_RIALS,
        reservedMeals: [...state.reservedMeals],
      };
    }
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/test-login', async (_req, res) => {
    const state = loadState();
    const { client } = getActiveSiteClient(state);
    await runTestLogin({
      state,
      encryptionKey: ENCRYPTION_KEY,
      runtimeUsername: process.env.IUT_USERNAME,
      runtimePassword: process.env.IUT_PASSWORD,
      siteClient: client,
    });
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/test-live-login', async (_req, res) => {
    const state = loadState();
    const prevSandboxCredit = !state.liveModeEnabled ? state.availableCreditRials : null;
    const prevSandboxMeals = !state.liveModeEnabled ? [...state.reservedMeals] : null;
    if (state.lastLoginVerification?.source !== 'LIVE_IUT') {
      state.encryptedSession = null;
    }
    await runSyncWithSite({
      state,
      encryptionKey: ENCRYPTION_KEY,
      runtimeUsername: process.env.IUT_USERNAME,
      runtimePassword: process.env.IUT_PASSWORD,
      siteClient: new LocalBrowserIutClient(),
    });
    // If tested while in Sandbox mode, save Live verification, credit & meals into liveData
    // while keeping Sandbox's own simulated balance and meals untouched.
    if (!state.liveModeEnabled) {
      const liveCredit =
        state.lastLoginVerification?.source === 'LIVE_IUT' &&
        typeof state.lastLoginVerification.availableCreditRials === 'number'
          ? state.lastLoginVerification.availableCreditRials
          : typeof state.availableCreditRials === 'number'
            ? state.availableCreditRials
            : state.liveData?.availableCreditRials ?? null;
      state.liveData = {
        ...(state.liveData ?? extractRuntimeLedgerSlice(state)),
        availableCreditRials: liveCredit,
        reservedMeals: [...state.reservedMeals],
        lastLoginTestOk: state.lastLoginTestOk,
        lastLoginTestAtUtcMs: state.lastLoginTestAtUtcMs,
        lastLoginTestMessage: state.lastLoginTestMessage,
        lastLoginVerification: state.lastLoginVerification ?? null,
      };
      state.availableCreditRials = prevSandboxCredit;
      state.reservedMeals = prevSandboxMeals ?? [];
    }
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/sync', async (_req, res) => {
    const state = loadState();
    const { client } = getActiveSiteClient(state);
    await runSyncWithSite({
      state,
      encryptionKey: ENCRYPTION_KEY,
      runtimeUsername: process.env.IUT_USERNAME,
      runtimePassword: process.env.IUT_PASSWORD,
      siteClient: client,
    });
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/test-connection', async (_req, res) => {
    const state = loadState();
    const { client } = getActiveSiteClient(state);
    await runTestLogin({
      state,
      encryptionKey: ENCRYPTION_KEY,
      runtimeUsername: process.env.IUT_USERNAME,
      runtimePassword: process.env.IUT_PASSWORD,
      siteClient: client,
    });
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/reserve-now', async (req, res) => {
    const state = loadState();
    const { targetDateJalali, targetDatesJalali } = (req.body || {}) as {
      targetDateJalali?: string;
      targetDatesJalali?: string[];
    };
    if (targetDateJalali && !isValidJalaliString(targetDateJalali)) {
      res.status(400).json({ error: 'تاریخ هدف شمسی نامعتبر است.' });
      return;
    }
    const explicitTargets =
      Array.isArray(targetDatesJalali) && targetDatesJalali.length > 0
        ? targetDatesJalali
        : targetDateJalali
          ? [targetDateJalali]
          : resolveTargetMealDatesForExecution(state, Date.now());

    const { client } = getActiveSiteClient(state);
    await executeMultiDayReservationRun(
      {
        state,
        encryptionKey: ENCRYPTION_KEY,
        runtimeUsername: process.env.IUT_USERNAME,
        runtimePassword: process.env.IUT_PASSWORD,
        siteClient: client,
      },
      'MANUAL',
      explicitTargets
    );
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/sandbox/scenario', (req, res) => {
    const state = loadState();
    const { scenario } = req.body as { scenario: SandboxScenario };
    state.sandboxScenario = scenario;
    sandboxLedger.scenario = scenario;
    saveState(state);
    res.json(makeSnapshot(state));
  });

  app.post('/api/sandbox/reset', (_req, res) => {
    const state = loadState();
    const seed = createSandboxSeedHistory();
    sandboxLedger = {
      scenario: state.sandboxScenario,
      creditRials: DEFAULT_SANDBOX_CREDIT_RIALS,
      reservedMeals: [...seed.reservedMeals],
    };
    resetSandboxLedgerInState(state, seed);
    saveState(state);
    res.json(makeSnapshot(state));
  });

  // Restore persisted server alarm on startup
  syncBackgroundAlarm(initialState);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IUT Food Reservation server listening on http://localhost:${PORT}`);
  });
}

void startServer();
