import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, redactSecrets } from './crypto';
import {
  executeMultiDayReservationRun,
  executeReservationRun,
  runStandbyAndPrecisionExecute,
  runTestLogin,
} from './runner';
import { SandboxIutSiteClient, type IutSiteClient } from './site';
import {
  buildPublicSnapshot,
  createInitialPersistentState,
  tryAcquireReservationLock,
} from './state';

const TEST_KEY = 'super-secret-server-encryption-key-for-tests';

test('encrypts and decrypts password & session cookies with AES-256-GCM', async () => {
  const secret = 'my-iut-password-1234';
  const encrypted = await encryptSecret(secret, TEST_KEY);
  assert.ok(!encrypted.includes(secret));
  const decrypted = await decryptSecret(encrypted, TEST_KEY);
  assert.equal(decrypted, secret);

  const redacted = redactSecrets(`Login failed for password=${secret}`, [secret]);
  assert.ok(!redacted.includes(secret));
});

test('prevents duplicate reservation via shared lock and pre-purchase reserved list check', async () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const state = createInitialPersistentState(nowMs);
  state.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);

  const ledger = {
    scenario: 'normal' as const,
    creditRials: 2000000,
    reservedMeals: [],
  };
  const client = new SandboxIutSiteClient(ledger);

  // First manual run succeeds and creates official receipt code
  const first = await executeReservationRun(
    { state, encryptionKey: TEST_KEY, siteClient: client, nowUtcMs: nowMs },
    'MANUAL',
    '1405/09/02'
  );
  assert.equal(first.status, 'RESERVED');
  assert.ok(first.receipt?.reservationCode.startsWith('IUT-'));
  assert.equal(first.receipt?.foodName, 'ماکارونی با سویا و سالاد');

  // Second scheduled run for the SAME date must be blocked by pre-purchase check
  const second = await executeReservationRun(
    { state, encryptionKey: TEST_KEY, siteClient: client, nowUtcMs: nowMs + 5000 },
    'SCHEDULED',
    '1405/09/02'
  );
  assert.equal(second.status, 'BLOCKED_DUPLICATE');
  assert.equal(second.errorCode, 'DUPLICATE_LOCK');
  assert.equal(ledger.reservedMeals.length, 1);

  // Also test concurrent lock directly
  const lock1 = tryAcquireReservationLock([], '1405/09/02', 'lunch', 'MANUAL', nowMs);
  assert.equal(lock1.acquired, true);
  if (lock1.acquired) {
    const lock2 = tryAcquireReservationLock(lock1.nextLocks, '1405/09/02', 'lunch', 'SCHEDULED', nowMs + 1000);
    assert.equal(lock2.acquired, false);
  }
});

test('executes multi-day reservation run across multiple checked weekdays cleanly', async () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const state = createInitialPersistentState(nowMs);
  state.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);
  state.schedule.weeklyTargetMealJsWeekdays = [6, 1, 3]; // Sat, Mon, Wed

  const ledger = {
    scenario: 'normal' as const,
    creditRials: 2000000,
    reservedMeals: [],
  };
  const client = new SandboxIutSiteClient(ledger);

  const records = await executeMultiDayReservationRun(
    { state, encryptionKey: TEST_KEY, siteClient: client, nowUtcMs: nowMs },
    'MANUAL',
    ['1405/08/30', '1405/09/02', '1405/09/04']
  );

  assert.equal(records.length, 3);
  assert.ok(records.every((r) => r.status === 'RESERVED'));
  assert.equal(ledger.reservedMeals.length, 3);
  assert.equal(state.lastStatus, 'RESERVED');
  assert.ok(state.lastMessage.includes('3 روز رزرو شد'));
});

test('recovers automatically when cached session drops with AUTH_ERROR during fetch', async () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const state = createInitialPersistentState(nowMs);
  state.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);
  state.encryptedSession = {
    encryptedCookiesJson: await encryptSecret(JSON.stringify({ stale: true }), TEST_KEY),
    preparedAtUtcMs: nowMs - 60_000,
    preparedAtJalali: '1405/08/27 15:29',
    username: '40125403',
  };

  const ledger = {
    scenario: 'normal' as const,
    creditRials: 2000000,
    reservedMeals: [],
  };
  const baseClient = new SandboxIutSiteClient(ledger);
  let contextCalls = 0;

  const flakyClient: IutSiteClient = {
    testLoginAndOpenReservationPage: (creds, existing) =>
      baseClient.testLoginAndOpenReservationPage(creds, existing),
    fetchReservationContext: async (cookies, targetDate, retryOpts) => {
      contextCalls += 1;
      if (contextCalls === 1) {
        return {
          ok: false,
          errorCode: 'AUTH_ERROR',
          message: 'نشست منقضی شد',
          availableCreditRials: 0,
          reservedMeals: [],
          menu: [],
          attemptsUsed: 1,
        };
      }
      return baseClient.fetchReservationContext(cookies, targetDate, retryOpts);
    },
    addToCartAndReadSummary: (cookies, item, date) =>
      baseClient.addToCartAndReadSummary(cookies, item, date),
    confirmPurchaseWithCredit: (cookies, cart) =>
      baseClient.confirmPurchaseWithCredit(cookies, cart),
    fetchReservedMealsReport: (cookies, date) =>
      baseClient.fetchReservedMealsReport(cookies, date),
  };

  const rec = await executeReservationRun(
    { state, encryptionKey: TEST_KEY, siteClient: flakyClient, nowUtcMs: nowMs },
    'MANUAL',
    '1405/09/02'
  );

  assert.equal(rec.status, 'RESERVED');
  assert.equal(contextCalls, 2);
});

test('standby precision execution enters STANDBY_IN_SITE and completes reservation cleanly', async () => {
  const nowMs = Date.now();
  const state = createInitialPersistentState(nowMs);
  state.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);
  state.policy.preferredKeywords = ['زرشک‌پلو'];

  const ledger = {
    scenario: 'normal' as const,
    creditRials: 2000000,
    reservedMeals: [],
  };
  const client = new SandboxIutSiteClient(ledger);
  let sawStandby = false;

  const rec = await runStandbyAndPrecisionExecute(
    { state, encryptionKey: TEST_KEY, siteClient: client },
    'SCHEDULED',
    Date.now() + 60,
    '1405/09/02',
    () => {
      if (state.lastStatus === 'STANDBY_IN_SITE') {
        sawStandby = true;
      }
    }
  );
  assert.equal(sawStandby, true);
  assert.equal(rec.status, 'RESERVED');
  assert.equal(rec.receipt?.foodName, 'زرشک‌پلو با اکبرجوجه');
});

test('ambiguous confirm outcome re-reads reserved report without auto-retrying buy', async () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const state = createInitialPersistentState(nowMs);
  state.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);

  // Case A: site actually saved the reservation before timeout
  const ledgerSuccess = {
    scenario: 'ambiguous_timeout_success' as const,
    creditRials: 2000000,
    reservedMeals: [],
  };
  const resA = await executeReservationRun(
    {
      state,
      encryptionKey: TEST_KEY,
      siteClient: new SandboxIutSiteClient(ledgerSuccess),
      nowUtcMs: nowMs,
    },
    'SCHEDULED',
    '1405/09/02'
  );
  assert.equal(resA.status, 'AMBIGUOUS_RESOLVED_RESERVED');
  assert.ok(resA.receipt?.reservationCode);
  assert.equal(ledgerSuccess.reservedMeals.length, 1);

  // Case B: site did NOT save the reservation -> reports clearly, never buys twice
  const stateB = createInitialPersistentState(nowMs);
  stateB.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);
  const ledgerFail = {
    scenario: 'ambiguous_timeout_failed' as const,
    creditRials: 2000000,
    reservedMeals: [],
  };
  const resB = await executeReservationRun(
    {
      state: stateB,
      encryptionKey: TEST_KEY,
      siteClient: new SandboxIutSiteClient(ledgerFail),
      nowUtcMs: nowMs,
    },
    'SCHEDULED',
    '1405/09/02'
  );
  assert.equal(resB.status, 'AMBIGUOUS_RESOLVED_NOT_RESERVED');
  assert.equal(resB.errorCode, 'AMBIGUOUS_NEED_CHECK');
  assert.equal(ledgerFail.reservedMeals.length, 0);
});

test('runTestLogin distinguishes SANDBOX_SIMULATION from LIVE_IUT verification proof', async () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const state = createInitialPersistentState(nowMs);
  state.encryptedPassword = await encryptSecret('pass1234', TEST_KEY);

  const sandboxClient = new SandboxIutSiteClient({
    scenario: 'normal',
    creditRials: 1850000,
    reservedMeals: [],
  });
  await runTestLogin({
    state,
    encryptionKey: TEST_KEY,
    siteClient: sandboxClient,
    nowUtcMs: nowMs,
  });

  assert.equal(state.lastLoginVerification?.source, 'SANDBOX_SIMULATION');
  assert.equal(state.lastLoginVerification?.ok, true);

  const liveStub: IutSiteClient = {
    testLoginAndOpenReservationPage: async () => ({
      ok: true,
      message: 'ورود واقعی انجام شد.',
      sessionCookiesJson: JSON.stringify([{ name: 'ASP.NET_SessionId', value: 'ok' }]),
      availableCreditRials: 950000,
      reservationPageOpened: true,
      verification: {
        source: 'LIVE_IUT',
        ok: true,
        finalUrl: 'https://dining.iut.ac.ir/#!/Reservation',
        pageTitle: 'سامانه تغذیه دانشگاه صنعتی اصفهان',
        studentBannerText: 'دانشجو ۴۰۱۲۵۴۰۳',
        availableCreditRials: 950000,
        reservedCountOnSite: 2,
      },
    }),
    fetchReservationContext: (cookies, targetDate, retryOpts) =>
      sandboxClient.fetchReservationContext(cookies, targetDate, retryOpts),
    addToCartAndReadSummary: (cookies, item, date) =>
      sandboxClient.addToCartAndReadSummary(cookies, item, date),
    confirmPurchaseWithCredit: (cookies, cart) =>
      sandboxClient.confirmPurchaseWithCredit(cookies, cart),
    fetchReservedMealsReport: (cookies, date) =>
      sandboxClient.fetchReservedMealsReport(cookies, date),
  };

  state.liveModeEnabled = true;
  await runTestLogin({
    state,
    encryptionKey: TEST_KEY,
    siteClient: liveStub,
    nowUtcMs: nowMs + 1000,
  });

  const snap = buildPublicSnapshot(state, {
    runtimeMode: 'LIVE_LOCAL_BROWSER',
    runtimeUsernameConfigured: false,
    runtimePasswordConfigured: false,
    nowUtcMs: nowMs + 1000,
  });

  assert.equal(snap.liveModeEnabled, true);
  assert.equal(snap.runtimeMode, 'LIVE_LOCAL_BROWSER');
  assert.equal(snap.account.lastLoginVerification?.source, 'LIVE_IUT');
  assert.equal(snap.account.lastLoginVerification?.finalUrl, 'https://dining.iut.ac.ir/#!/Reservation');
  assert.equal(snap.account.lastLoginVerification?.availableCreditRials, 950000);
});
