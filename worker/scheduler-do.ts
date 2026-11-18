import { encryptSecret } from '../src/core/crypto';
import {
  computeNextRunDetails,
  isValidJalaliString,
  parseTimeString,
} from '../src/core/jalali';
import {
  executeMultiDayReservationRun,
  resolveTargetMealDatesForExecution,
  runEarlyLoginPreparation,
  runKeepAliveRefresh,
  runStandbyAndPrecisionExecuteMulti,
  runTestLogin,
} from '../src/core/runner';
import { normalizePolicyConfig } from '../src/core/policy';
import { SandboxIutSiteClient, type IutSiteClient, type SandboxLedger } from '../src/core/site';
import {
  buildPublicSnapshot,
  createInitialPersistentState,
  normalizeScheduleConfig,
  type PersistentBotState,
} from '../src/core/state';
import type { PolicyConfig, SandboxScenario, ScheduleConfig } from '../src/core/types';
import { CloudflareBrowserIutClient } from './browser-iut';
import type { CloudflareEnv, DurableObjectState } from './env';

interface AlarmMeta {
  phase: 'EARLY_LOGIN' | 'KEEP_ALIVE' | 'STANDBY_EXECUTE' | 'EXECUTE';
  targetDateJalali: string;
  targetDatesJalali?: string[];
  targetActionUtcMs: number;
}

export class ReservationSchedulerDO {
  private readonly ctx: DurableObjectState;
  private readonly env: CloudflareEnv;
  private stateCache: PersistentBotState | null = null;
  private sandboxLedger: SandboxLedger = {
    scenario: 'normal',
    creditRials: 1850000,
    reservedMeals: [],
  };

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS execution_log (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          target_date TEXT NOT NULL,
          payload TEXT NOT NULL
        );
      `);
    });
  }

  private getEncryptionKey(): string {
    return (
      this.env.APP_ENCRYPTION_KEY ||
      'ephemeral-worker-key-configure-APP_ENCRYPTION_KEY-secret'
    );
  }

  private loadState(): PersistentBotState {
    if (this.stateCache) return this.stateCache;
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM kv_store WHERE key = 'bot_state'`)
      .toArray();
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value) as PersistentBotState;
      parsed.policy = normalizePolicyConfig(parsed.policy);
      parsed.schedule = normalizeScheduleConfig(parsed.schedule);
      this.stateCache = parsed;
      this.sandboxLedger.scenario = this.stateCache.sandboxScenario;
      this.sandboxLedger.reservedMeals = [...this.stateCache.reservedMeals];
      if (typeof this.stateCache.availableCreditRials === 'number') {
        this.sandboxLedger.creditRials = this.stateCache.availableCreditRials;
      }
      return this.stateCache;
    }

    const initial = createInitialPersistentState(Date.now());
    if (this.env.IUT_USERNAME) {
      initial.username = this.env.IUT_USERNAME;
    }
    this.stateCache = initial;
    this.saveState(initial);
    return initial;
  }

  private saveState(state: PersistentBotState): void {
    this.stateCache = state;
    this.ctx.storage.sql.exec(
      `INSERT INTO kv_store (key, value) VALUES ('bot_state', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(state)
    );
  }

  private getSiteClient(state: PersistentBotState): {
    client: IutSiteClient;
    mode: 'SANDBOX' | 'CLOUDFLARE_BROWSER_RUN';
  } {
    if (this.env.MYBROWSER && this.env.SANDBOX_FALLBACK !== 'true') {
      return {
        client: new CloudflareBrowserIutClient(this.env.MYBROWSER),
        mode: 'CLOUDFLARE_BROWSER_RUN',
      };
    }
    this.sandboxLedger.scenario = state.sandboxScenario;
    return {
      client: new SandboxIutSiteClient(this.sandboxLedger),
      mode: 'SANDBOX',
    };
  }

  private async syncAlarm(state: PersistentBotState, nowUtcMs = Date.now()): Promise<void> {
    if (!state.schedule.enabled || state.schedule.mode === 'now') {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete('alarm_meta');
      return;
    }

    const next = computeNextRunDetails(state.schedule, nowUtcMs);
    if (!next.nextActionUtcMs || !next.targetMealDateJalali) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete('alarm_meta');
      return;
    }

    const actionUtcMs = next.nextActionUtcMs;
    const standbyUtcMs = state.schedule.subsecondExecution ? actionUtcMs - 35 * 1000 : actionUtcMs;
    const targetDates =
      next.targetMealDatesJalali.length > 0
        ? next.targetMealDatesJalali
        : [next.targetMealDateJalali];

    if (
      next.earlyLoginUtcMs &&
      next.earlyLoginUtcMs > nowUtcMs &&
      state.schedule.earlyLoginMinutes > 0
    ) {
      const meta: AlarmMeta = {
        phase: 'EARLY_LOGIN',
        targetDateJalali: next.targetMealDateJalali,
        targetDatesJalali: targetDates,
        targetActionUtcMs: actionUtcMs,
      };
      await this.ctx.storage.put('alarm_meta', meta);
      await this.ctx.storage.setAlarm(next.earlyLoginUtcMs);
    } else if (state.schedule.keepSessionWarm && actionUtcMs - nowUtcMs > 4 * 60 * 1000) {
      const meta: AlarmMeta = {
        phase: 'KEEP_ALIVE',
        targetDateJalali: next.targetMealDateJalali,
        targetDatesJalali: targetDates,
        targetActionUtcMs: actionUtcMs,
      };
      await this.ctx.storage.put('alarm_meta', meta);
      await this.ctx.storage.setAlarm(actionUtcMs - 4 * 60 * 1000);
    } else if (state.schedule.subsecondExecution && standbyUtcMs > nowUtcMs) {
      const meta: AlarmMeta = {
        phase: 'STANDBY_EXECUTE',
        targetDateJalali: next.targetMealDateJalali,
        targetDatesJalali: targetDates,
        targetActionUtcMs: actionUtcMs,
      };
      await this.ctx.storage.put('alarm_meta', meta);
      await this.ctx.storage.setAlarm(standbyUtcMs);
    } else if (actionUtcMs > nowUtcMs) {
      const meta: AlarmMeta = {
        phase: state.schedule.subsecondExecution ? 'STANDBY_EXECUTE' : 'EXECUTE',
        targetDateJalali: next.targetMealDateJalali,
        targetDatesJalali: targetDates,
        targetActionUtcMs: actionUtcMs,
      };
      await this.ctx.storage.put('alarm_meta', meta);
      await this.ctx.storage.setAlarm(actionUtcMs);
    }
  }

  async alarm(): Promise<void> {
    const state = this.loadState();
    if (!state.schedule.enabled) return;

    const meta = await this.ctx.storage.get<AlarmMeta>('alarm_meta');
    const { client } = this.getSiteClient(state);
    const nowUtcMs = Date.now();
    const runnerCtx = {
      state,
      encryptionKey: this.getEncryptionKey(),
      runtimeUsername: this.env.IUT_USERNAME,
      runtimePassword: this.env.IUT_PASSWORD,
      siteClient: client,
      nowUtcMs,
    };

    const actionUtcMs = meta?.targetActionUtcMs ?? nowUtcMs;
    const targetDate = meta?.targetDateJalali;
    const targetDates =
      meta?.targetDatesJalali && meta.targetDatesJalali.length > 0
        ? meta.targetDatesJalali
        : targetDate
          ? [targetDate]
          : resolveTargetMealDatesForExecution(state, actionUtcMs);

    if (meta?.phase === 'EARLY_LOGIN' && targetDate) {
      await runEarlyLoginPreparation(runnerCtx);
      this.saveState(state);

      const now = Date.now();
      if (state.schedule.keepSessionWarm && actionUtcMs - now > 4 * 60 * 1000) {
        await this.ctx.storage.put('alarm_meta', {
          phase: 'KEEP_ALIVE',
          targetDateJalali: targetDate,
          targetDatesJalali: targetDates,
          targetActionUtcMs: actionUtcMs,
        } satisfies AlarmMeta);
        await this.ctx.storage.setAlarm(actionUtcMs - 4 * 60 * 1000);
      } else {
        const standbyAt = state.schedule.subsecondExecution
          ? Math.max(now + 250, actionUtcMs - 35 * 1000)
          : actionUtcMs;
        await this.ctx.storage.put('alarm_meta', {
          phase: state.schedule.subsecondExecution ? 'STANDBY_EXECUTE' : 'EXECUTE',
          targetDateJalali: targetDate,
          targetDatesJalali: targetDates,
          targetActionUtcMs: actionUtcMs,
        } satisfies AlarmMeta);
        await this.ctx.storage.setAlarm(standbyAt);
      }
      return;
    }

    if (meta?.phase === 'KEEP_ALIVE' && targetDate) {
      await runKeepAliveRefresh(runnerCtx);
      this.saveState(state);

      const now = Date.now();
      const standbyAt = state.schedule.subsecondExecution
        ? Math.max(now + 250, actionUtcMs - 35 * 1000)
        : actionUtcMs;
      await this.ctx.storage.put('alarm_meta', {
        phase: state.schedule.subsecondExecution ? 'STANDBY_EXECUTE' : 'EXECUTE',
        targetDateJalali: targetDate,
        targetDatesJalali: targetDates,
        targetActionUtcMs: actionUtcMs,
      } satisfies AlarmMeta);
      await this.ctx.storage.setAlarm(standbyAt);
      return;
    }

    const records =
      meta?.phase === 'STANDBY_EXECUTE'
        ? await runStandbyAndPrecisionExecuteMulti(
            runnerCtx,
            'SCHEDULED',
            actionUtcMs,
            targetDates,
            () => this.saveState(state)
          )
        : await executeMultiDayReservationRun(runnerCtx, 'SCHEDULED', targetDates);

    for (const record of records) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO execution_log (id, created_at, status, target_date, payload)
         VALUES (?, ?, ?, ?, ?)`,
        record.id,
        record.startedAtUtcMs,
        record.status,
        record.targetDateJalali,
        JSON.stringify(record)
      );
    }

    if (state.schedule.mode === 'once') {
      state.schedule.enabled = false;
    }

    this.saveState(state);
    await this.syncAlarm(state, Date.now() + 1000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = this.loadState();
    const { client, mode } = this.getSiteClient(state);

    const buildSnapshot = () =>
      Response.json(
        buildPublicSnapshot(state, {
          runtimeMode: mode,
          runtimeUsernameConfigured: Boolean(this.env.IUT_USERNAME),
          runtimePasswordConfigured: Boolean(this.env.IUT_PASSWORD),
          nowUtcMs: Date.now(),
        })
      );

    if (request.method === 'GET' && url.pathname === '/api/state') {
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/account') {
      const body = (await request.json()) as { username?: string; password?: string };
      if (body.username && body.username.trim()) {
        state.username = body.username.trim();
      }
      if (body.password && body.password.trim()) {
        state.encryptedPassword = await encryptSecret(
          body.password.trim(),
          this.getEncryptionKey()
        );
        state.encryptedSession = null;
      }
      this.saveState(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/schedule') {
      const body = (await request.json()) as Partial<ScheduleConfig>;
      if (body.actionTimeTehran && !parseTimeString(body.actionTimeTehran)) {
        return Response.json({ error: 'فرمت ساعت تهران نامعتبر است (مثال: 20:30).' }, { status: 400 });
      }
      if (body.onceActionDateJalali && !isValidJalaliString(body.onceActionDateJalali)) {
        return Response.json({ error: 'تاریخ اجرای شمسی نامعتبر است.' }, { status: 400 });
      }
      if (body.onceTargetMealDateJalali && !isValidJalaliString(body.onceTargetMealDateJalali)) {
        return Response.json({ error: 'تاریخ دریافت غذا (شمسی) نامعتبر است.' }, { status: 400 });
      }
      if (
        Array.isArray(body.weeklyTargetMealJsWeekdays) &&
        body.weeklyTargetMealJsWeekdays.length === 0
      ) {
        return Response.json({ error: 'حداقل یک روز برای غذا انتخاب کنید.' }, { status: 400 });
      }

      state.schedule = normalizeScheduleConfig({
        ...state.schedule,
        ...body,
      });
      this.saveState(state);
      await this.syncAlarm(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/policy') {
      const body = (await request.json()) as Partial<PolicyConfig>;
      state.policy = normalizePolicyConfig({
        ...state.policy,
        ...body,
        meal: 'lunch',
        quantity: 1,
        creditOnly: true,
      });
      this.saveState(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/stop-schedule') {
      state.schedule.enabled = false;
      state.lastStatus = 'PAUSED';
      state.lastMessage = 'زمان‌بندی خودکار متوقف شد.';
      this.saveState(state);
      await this.syncAlarm(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/runtime-mode') {
      const body = (await request.json().catch(() => ({}))) as { liveModeEnabled?: boolean };
      state.liveModeEnabled = Boolean(body.liveModeEnabled);
      this.saveState(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/test-live-login') {
      if (!this.env.MYBROWSER) {
        return Response.json(
          { error: 'در این محیط مرورگر واقعی Cloudflare (MYBROWSER) متصل نیست.' },
          { status: 400 }
        );
      }
      await runTestLogin({
        state,
        encryptionKey: this.getEncryptionKey(),
        runtimeUsername: this.env.IUT_USERNAME,
        runtimePassword: this.env.IUT_PASSWORD,
        siteClient: new CloudflareBrowserIutClient(this.env.MYBROWSER),
      });
      this.saveState(state);
      return buildSnapshot();
    }

    if (
      request.method === 'POST' &&
      (url.pathname === '/api/test-login' || url.pathname === '/api/test-connection')
    ) {
      await runTestLogin({
        state,
        encryptionKey: this.getEncryptionKey(),
        runtimeUsername: this.env.IUT_USERNAME,
        runtimePassword: this.env.IUT_PASSWORD,
        siteClient: client,
      });
      this.saveState(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/reserve-now') {
      const body = (await request.json().catch(() => ({}))) as {
        targetDateJalali?: string;
        targetDatesJalali?: string[];
      };
      if (body.targetDateJalali && !isValidJalaliString(body.targetDateJalali)) {
        return Response.json({ error: 'تاریخ هدف شمسی نامعتبر است.' }, { status: 400 });
      }
      const explicitTargets =
        Array.isArray(body.targetDatesJalali) && body.targetDatesJalali.length > 0
          ? body.targetDatesJalali
          : body.targetDateJalali
            ? [body.targetDateJalali]
            : resolveTargetMealDatesForExecution(state, Date.now());

      await executeMultiDayReservationRun(
        {
          state,
          encryptionKey: this.getEncryptionKey(),
          runtimeUsername: this.env.IUT_USERNAME,
          runtimePassword: this.env.IUT_PASSWORD,
          siteClient: client,
        },
        'MANUAL',
        explicitTargets
      );
      this.saveState(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/sandbox/scenario') {
      const body = (await request.json()) as { scenario: SandboxScenario };
      state.sandboxScenario = body.scenario;
      this.sandboxLedger.scenario = body.scenario;
      this.saveState(state);
      return buildSnapshot();
    }

    if (request.method === 'POST' && url.pathname === '/api/sandbox/reset') {
      this.sandboxLedger = {
        scenario: state.sandboxScenario,
        creditRials: 1850000,
        reservedMeals: [],
      };
      state.reservedMeals = [];
      state.lastReceipt = null;
      state.availableCreditRials = 1850000;
      state.lastStatus = 'IDLE';
      state.lastErrorCode = undefined;
      state.lastMessage = 'داده‌های آزمایشی بازنشانی شد.';
      this.saveState(state);
      return buildSnapshot();
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  }
}
