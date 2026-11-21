import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import mongoose from 'mongoose';

const testUri = process.env.TEST_MONGODB_URI;
if (!testUri) {
  throw new Error('TEST_MONGODB_URI is required for integration tests and must target battle_miles_test');
}
const testDatabasePath = (() => {
  try {
    return new URL(testUri).pathname.replace(/^\/+/, '').split('?')[0];
  } catch {
    return '';
  }
})();
if (testDatabasePath !== 'battle_miles_test') {
  throw new Error('TEST_MONGODB_URI must target the isolated battle_miles_test database');
}

const suite = describe('authentication integration', () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const participantEmail = `runner-${runId}@example.com`;
  const adminEmail = `admin-${runId}@example.com`;
  const otherParticipantEmail = `other-${runId}@example.com`;
  let app: typeof import('./server').app;
  let closeSessionStore: typeof import('./server').closeSessionStore;
  let connectDatabase: typeof import('./config/db').connectDatabase;
  let disconnectDatabase: typeof import('./config/db').disconnectDatabase;
  let User: typeof import('./models').User;
  let Registration: typeof import('./models').Registration;
  let Payment: typeof import('./models').Payment;
  let setRazorpayClientFactoryForTests: typeof import('./config/razorpay').setRazorpayClientFactoryForTests;
  let resetRazorpayClientFactory: typeof import('./config/razorpay').resetRazorpayClientFactory;
  let server: http.Server;
  let baseUrl: string;
  let participantId: string | undefined;
  let adminId: string | undefined;
  let otherParticipantId: string | undefined;
  let otherRegistrationId: string | undefined;
  let paymentFixtureCounter = 0;

  async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    return { response, body: await response.json() as Record<string, unknown> };
  }

  function cookieHeader(setCookie: string): string {
    return setCookie.split(';', 1)[0];
  }

  async function getParticipantCookie(): Promise<string> {
    const login = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: participantEmail, password: 'StrongPassword123!' })
    });
    assert.equal(login.response.status, 200);
    const setCookie = login.response.headers.get('set-cookie');
    assert(setCookie);
    return cookieHeader(setCookie);
  }

  async function createPaymentRegistration(distancePackage: '05' | '10' | '20' = '05', paymentStatus: 'pending' | 'paid' | 'failed' = 'pending') {
    assert(participantId);
    paymentFixtureCounter += 1;
    return Registration.create({
      userId: new mongoose.Types.ObjectId(participantId),
      idempotencyKey: `payment-fixture-${runId}-${paymentFixtureCounter}-key`,
      distancePackage,
      amountPaise: distancePackage === '05' ? 80000 : distancePackage === '10' ? 120000 : 150000,
      currency: 'INR',
      paymentStatus,
      status: paymentStatus === 'paid' ? 'confirmed' : 'pending_payment',
      address: {
        line1: 'Payment Test Road',
        city: 'Test City',
        state: 'Test State',
        pincode: '12345'
      }
    });
  }

  function validSignature(orderId: string, paymentId: string): string {
    return crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
  }

  function webhookSignature(body: string): string {
    return crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(body)
      .digest('hex');
  }

  function webhookPayload(event: 'payment.captured' | 'payment.failed', orderId: string, paymentId: string, amount: number, currency = 'INR') {
    return JSON.stringify({
      event,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount,
            currency,
            status: event === 'payment.captured' ? 'captured' : 'failed',
            captured: event === 'payment.captured'
          }
        }
      }
    });
  }

  async function getSessionIdsForUsers(userIds: string[]): Promise<string[]> {
    const rows = await mongoose.connection.collection<{ _id: string; session: string }>('sessions').find({}).toArray();
    return rows
      .filter(row => {
        if (typeof row.session !== 'string') return false;
        try {
          const storedSession = JSON.parse(row.session) as { userId?: string };
          return typeof storedSession.userId === 'string' && userIds.includes(storedSession.userId);
        } catch {
          return false;
        }
      })
      .map(row => String(row._id));
  }

  before(async () => {
    process.env.MONGODB_URI = testUri;
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret-that-is-long-enough';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_battle_miles';
    process.env.RAZORPAY_KEY_SECRET = 'battle_miles_test_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'battle_miles_test_webhook_secret';
    ({ app, closeSessionStore } = await import('./server'));
    ({ connectDatabase, disconnectDatabase } = await import('./config/db'));
    ({ setRazorpayClientFactoryForTests, resetRazorpayClientFactory } = await import('./config/razorpay'));
    ({ User, Registration, Payment } = await import('./models'));
    await connectDatabase();
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address();
    assert(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  after(async () => {
    const userIds = [participantId, adminId, otherParticipantId].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      const registrationIds = await Registration.find({
        userId: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) }
      }).distinct('_id');
      await Payment.deleteMany({ registrationId: { $in: registrationIds } });
      await Registration.deleteMany({
        userId: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) }
      });
      await User.deleteMany({ email: { $in: [participantEmail, adminEmail, otherParticipantEmail] } });
      const sessionIds = await getSessionIdsForUsers(userIds);
      if (sessionIds.length > 0) {
        await mongoose.connection.collection<{ _id: string; session: string }>('sessions').deleteMany({
          _id: { $in: sessionIds }
        });
      }
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeSessionStore();
    resetRazorpayClientFactory();
    await disconnectDatabase();
  });

  it('registers with Argon2id and persists a MongoDB session', async () => {
    const { response, body } = await request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Runner', email: participantEmail.toUpperCase(), password: 'StrongPassword123!', phone: '1234567890' })
    });
    assert.equal(response.status, 201);
    assert.equal((body.user as Record<string, unknown>).email, participantEmail);
    const user = await User.findOne({ email: participantEmail }).select('+passwordHash').lean();
    assert(user);
    participantId = user._id.toString();
    assert(user.passwordHash.startsWith('$argon2id$'));
    assert.notEqual(user.passwordHash, 'StrongPassword123!');
    assert(participantId);
    const registrationCookie = response.headers.get('set-cookie');
    assert(registrationCookie);
    assert.match(registrationCookie, /^bm\.sid=/);
    const sessionIds = await getSessionIdsForUsers([participantId]);
    const sessionCount = sessionIds.length;
    assert.equal(sessionCount, 1);
  });

  it('rejects duplicate, invalid, and weak registration data', async () => {
    const duplicate = await request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Runner', email: participantEmail, password: 'StrongPassword123!', phone: '1234567890' })
    });
    assert.equal(duplicate.response.status, 409);
    const invalid = await request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', email: 'bad', password: 'weak', phone: '' })
    });
    assert.equal(invalid.response.status, 400);
  });

  it('authenticates, returns a safe user, and destroys logout sessions', async () => {
    const unauthenticated = await request('/auth/me');
    assert.equal(unauthenticated.response.status, 401);

    const loginForValidation = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: participantEmail, password: 'StrongPassword123!' })
    });
    assert.equal(loginForValidation.response.status, 200);
    const validationSetCookie = loginForValidation.response.headers.get('set-cookie');
    assert(validationSetCookie);
    const validationCookie = cookieHeader(validationSetCookie);
    const missingKey = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: validationCookie },
      body: JSON.stringify({
        distancePackage: '05',
        address: { line1: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '12345' }
      })
    });
    assert.equal(missingKey.response.status, 400);
    const wrongPassword = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: participantEmail, password: 'WrongPassword123!' })
    });
    assert.equal(wrongPassword.response.status, 401);
    const unknownEmail = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `unknown-${runId}@example.com`, password: 'WrongPassword123!' })
    });
    assert.equal(unknownEmail.response.status, 401);
    const login = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: participantEmail, password: 'StrongPassword123!' })
    });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get('set-cookie');
    assert(cookie);
    const me = await request('/auth/me', { headers: { cookie } });
    assert.equal(me.response.status, 200);
    assert.equal((me.body.user as Record<string, unknown>).email, participantEmail);
    assert.equal((me.body.user as Record<string, unknown>).passwordHash, undefined);
    const logout = await request('/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request('/auth/me', { headers: { cookie } });
    assert.equal(afterLogout.response.status, 401);
  });

  it('creates protected, idempotent, multi-registration records', async () => {
    const unauthenticated = await request('/registrations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `unauth-${runId}-0001`
      },
      body: JSON.stringify({
        distancePackage: '05',
        address: { line1: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '12345' }
      })
    });
    assert.equal(unauthenticated.response.status, 401);

    const login = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: participantEmail, password: 'StrongPassword123!' })
    });
    assert.equal(login.response.status, 200);
    const setCookie = login.response.headers.get('set-cookie');
    assert(setCookie);
    const cookie = cookieHeader(setCookie);

    const invalidDistance = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `invalid-distance-${runId}`, cookie },
      body: JSON.stringify({
        distancePackage: '42',
        address: { line1: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '12345' }
      })
    });
    assert.equal(invalidDistance.response.status, 400);

    const invalidAddress = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `invalid-address-${runId}`, cookie },
      body: JSON.stringify({
        distancePackage: '05',
        address: { line1: '', city: 'Test City', state: 'Test State', pincode: '' }
      })
    });
    assert.equal(invalidAddress.response.status, 400);

    const unknownFields = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `unknown-fields-${runId}`, cookie },
      body: JSON.stringify({
        distancePackage: '05',
        amountPaise: 1,
        userId: '507f1f77bcf86cd799439011',
        address: { line1: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '12345' }
      })
    });
    assert.equal(unknownFields.response.status, 400);

    const firstKey = `first-reg-${runId}-0001`;
    const first = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': firstKey, cookie },
      body: JSON.stringify({
        distancePackage: '05',
        address: { line1: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '12345' }
      })
    });
    assert.equal(first.response.status, 201);
    const firstRegistration = (first.body.registration as Record<string, unknown>);
    assert.equal(firstRegistration.amountPaise, 80000);
    assert.equal(firstRegistration.currency, 'INR');
    assert.equal(firstRegistration.paymentStatus, 'pending');
    assert.equal(firstRegistration.status, 'pending_payment');
    assert.equal(firstRegistration.kitEligible, undefined);
    assert.equal(firstRegistration.eligibleDistance, undefined);

    const secondKey = `second-reg-${runId}-0002`;
    const second = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': secondKey, cookie },
      body: JSON.stringify({
        distancePackage: '10',
        address: { line1: '2 Test Road', city: 'Test City', state: 'Test State', pincode: '23456' }
      })
    });
    assert.equal(second.response.status, 201);
    const secondRegistration = (second.body.registration as Record<string, unknown>);
    assert.equal(secondRegistration.amountPaise, 120000);
    assert.deepEqual(secondRegistration.inclusions, ['medal', 'runner_badge', 'refreshment_pack']);

    const sameDistanceKey = `same-distance-${runId}-0003`;
    const sameDistance = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': sameDistanceKey, cookie },
      body: JSON.stringify({
        distancePackage: '05',
        address: { line1: '3 Test Road', city: 'Test City', state: 'Test State', pincode: '34567' }
      })
    });
    assert.equal(sameDistance.response.status, 201);

    const repeated = await request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': firstKey, cookie },
      body: JSON.stringify({
        distancePackage: '05',
        address: { line1: '1 Test Road', city: 'Test City', state: 'Test State', pincode: '12345' }
      })
    });
    assert.equal(repeated.response.status, 200);
    assert.equal((repeated.body.registration as Record<string, unknown>).id, firstRegistration.id);

    const concurrentKey = `concurrent-${runId}-0004`;
    const concurrentBody = JSON.stringify({
      distancePackage: '20',
      address: { line1: '4 Test Road', city: 'Test City', state: 'Test State', pincode: '45678' }
    });
    const concurrent = await Promise.all([1, 2].map(() => request('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': concurrentKey, cookie },
      body: concurrentBody
    })));
    assert.deepEqual(concurrent.map(result => result.response.status).sort(), [200, 201]);
    assert.equal((concurrent[0].body.registration as Record<string, unknown>).id,
      (concurrent[1].body.registration as Record<string, unknown>).id);
    const concurrentRegistration = concurrent[0].body.registration as Record<string, unknown>;
    assert.equal(concurrentRegistration.amountPaise, 150000);
    assert.deepEqual(concurrentRegistration.inclusions, ['medal', 'runner_badge', 'event_tshirt']);

    const me = await request('/registrations/me', { headers: { cookie } });
    assert.equal(me.response.status, 200);
    const registrations = me.body.registrations as Record<string, unknown>[];
    assert.equal(registrations.length, 4);
    assert(registrations.every(registration => String(registration.paymentStatus) === 'pending'));
    assert(registrations.every(registration => !('kitEligible' in registration)));
    assert(registrations.every(registration => !('eligibleDistance' in registration)));

    const passwordHash = await argon2.hash('OtherPassword123!', { type: argon2.argon2id });
    const other = await User.create({
      name: 'Other Runner',
      email: otherParticipantEmail,
      passwordHash,
      phone: '1234567890',
      role: 'participant'
    });
    otherParticipantId = other.id;
    const otherRegistration = await Registration.create({
      userId: other._id,
      idempotencyKey: `other-owner-${runId}-0005`,
      distancePackage: '05',
      amountPaise: 80000,
      currency: 'INR',
      paymentStatus: 'pending',
      status: 'pending_payment',
      address: { line1: 'Other Road', city: 'Other City', state: 'Other State', pincode: '56789' }
    });
    otherRegistrationId = otherRegistration.id;

    const inaccessible = await request(`/registrations/${otherRegistrationId}`, { headers: { cookie } });
    assert.equal(inaccessible.response.status, 404);

    const ownDetail = await request(`/registrations/${firstRegistration.id}`, { headers: { cookie } });
    assert.equal(ownDetail.response.status, 200);
  });

  it('requires authentication and participant ownership for payment order creation', async () => {
    const unauthenticated = await request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registrationId: '507f1f77bcf86cd799439011' })
    });
    assert.equal(unauthenticated.response.status, 401);

    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration();
    const other = await Registration.findOne({ userId: { $ne: new mongoose.Types.ObjectId(participantId!) } });
    const foreignId = other?.id || '507f1f77bcf86cd799439011';
    const owned = await request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ registrationId: foreignId })
    });
    assert.equal(owned.response.status, 404);
    assert(registration.id);
  });

  it('creates server-priced orders and reuses an existing usable order', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('05');
    let createCount = 0;
    setRazorpayClientFactoryForTests(() => ({
      orders: {
        create: async (params: any) => {
          createCount += 1;
          assert.equal(params.amount, 80000);
          assert.equal(params.currency, 'INR');
          return { id: `order_reuse_${runId}`, amount: params.amount, currency: 'INR', status: 'created' };
        },
        fetch: async (orderId: string) => ({
          id: orderId,
          amount: 80000,
          currency: 'INR',
          status: 'created',
          receipt: `bm_${registration.id}`
        })
      },
      payments: { fetch: async () => ({}) }
    }));

    const first = await request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ registrationId: registration.id, amountPaise: 1 })
    });
    assert.equal(first.response.status, 400);

    const valid = await request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ registrationId: registration.id })
    });
    assert.equal(valid.response.status, 200);
    assert.equal((valid.body.orderId), `order_reuse_${runId}`);

    const reused = await request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ registrationId: registration.id })
    });
    assert.equal(reused.response.status, 200);
    assert.equal(reused.body.orderId, valid.body.orderId);
    assert.equal(createCount, 1);
  });

  it('rejects payment order creation for paid registrations', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('10', 'paid');
    const response = await request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ registrationId: registration.id })
    });
    assert.equal(response.response.status, 409);
  });

  it('rejects invalid signatures and wrong registration/order relationships', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('05');
    const orderId = `order_invalid_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      amountPaise: 80000,
      status: 'created'
    });
    const invalid = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        registrationId: registration.id,
        razorpay_order_id: orderId,
        razorpay_payment_id: `pay_invalid_${runId}`,
        razorpay_signature: '0'.repeat(64)
      })
    });
    assert.equal(invalid.response.status, 400);

    const wrongRegistration = await createPaymentRegistration('05');
    const wrong = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        registrationId: wrongRegistration.id,
        razorpay_order_id: orderId,
        razorpay_payment_id: `pay_wrong_${runId}`,
        razorpay_signature: validSignature(orderId, `pay_wrong_${runId}`)
      })
    });
    assert.equal(wrong.response.status, 404);
  });

  it('validates amount and currency after a valid signature', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('10');
    const orderId = `order_amount_${runId}`;
    const paymentId = `pay_amount_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      amountPaise: 120000,
      status: 'created'
    });
    setRazorpayClientFactoryForTests(() => ({
      orders: {
        create: async () => ({}),
        fetch: async () => ({ id: orderId, amount: 119999, currency: 'INR', status: 'created' })
      },
      payments: {
        fetch: async () => ({
          id: paymentId,
          order_id: orderId,
          amount: 119999,
          currency: 'INR',
          status: 'captured',
          captured: true
        })
      }
    }));
    const response = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        registrationId: registration.id,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature(orderId, paymentId)
      })
    });
    assert.equal(response.response.status, 409);
    const unchanged = await Registration.findById(registration.id);
    assert.equal(unchanged?.paymentStatus, 'pending');
  });

  it('does not reuse a payment ID across registrations', async () => {
    const cookie = await getParticipantCookie();
    const first = await createPaymentRegistration('05');
    const second = await createPaymentRegistration('05');
    const orderId = `order_reuse_payment_${runId}`;
    const paymentId = `pay_reuse_${runId}`;
    await Payment.create({
      registrationId: first._id,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      amountPaise: 80000,
      status: 'captured',
      signatureVerified: true
    });
    await Payment.create({
      registrationId: second._id,
      razorpayOrderId: `order_second_${runId}`,
      amountPaise: 80000,
      status: 'created'
    });
    const response = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        registrationId: second.id,
        razorpay_order_id: `order_second_${runId}`,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature(`order_second_${runId}`, paymentId)
      })
    });
    assert.equal(response.response.status, 409);
  });

  it('does not mark authorized uncaptured payments paid', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('05');
    const orderId = `order_authorized_${runId}`;
    const paymentId = `pay_authorized_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      amountPaise: 80000,
      status: 'created'
    });
    setRazorpayClientFactoryForTests(() => ({
      orders: {
        create: async () => ({}),
        fetch: async () => ({ id: orderId, amount: 80000, currency: 'INR', status: 'attempted' })
      },
      payments: {
        fetch: async () => ({
          id: paymentId,
          order_id: orderId,
          amount: 80000,
          currency: 'INR',
          status: 'authorized',
          captured: false
        })
      }
    }));
    const response = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        registrationId: registration.id,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature(orderId, paymentId)
      })
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.body.verified, false);
    const updated = await Registration.findById(registration.id);
    assert.equal(updated?.paymentStatus, 'pending');
    assert.equal(updated?.status, 'pending_payment');
  });

  it('serializes concurrent order creation and returns one reusable order', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('05');
    let createCount = 0;
    setRazorpayClientFactoryForTests(() => ({
      orders: {
        create: async (params: any) => {
          createCount += 1;
          await new Promise(resolve => setTimeout(resolve, 20));
          return { id: `order_concurrent_${runId}`, amount: params.amount, currency: 'INR', status: 'created' };
        },
        fetch: async (orderId: string) => ({
          id: orderId,
          amount: 80000,
          currency: 'INR',
          status: 'created'
        })
      },
      payments: { fetch: async () => ({}) }
    }));
    const body = JSON.stringify({ registrationId: registration.id });
    const responses = await Promise.all([1, 2].map(() => request('/payments/create-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body
    })));
    assert(responses.every(result => result.response.status === 200));
    assert.equal(createCount, 1);
  });

  it('does not mark failed payments paid', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('10');
    const orderId = `order_failed_${runId}`;
    const paymentId = `pay_failed_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      amountPaise: 120000,
      status: 'created'
    });
    setRazorpayClientFactoryForTests(() => ({
      orders: {
        create: async () => ({}),
        fetch: async () => ({ id: orderId, amount: 120000, currency: 'INR', status: 'attempted' })
      },
      payments: {
        fetch: async () => ({
          id: paymentId,
          order_id: orderId,
          amount: 120000,
          currency: 'INR',
          status: 'failed',
          captured: false
        })
      }
    }));
    const response = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        registrationId: registration.id,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature(orderId, paymentId)
      })
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.body.verified, false);
    const updatedRegistration = await Registration.findById(registration.id);
    const updatedPayment = await Payment.findOne({ registrationId: registration._id, razorpayOrderId: orderId });
    assert.equal(updatedRegistration?.paymentStatus, 'failed');
    assert.equal(updatedRegistration?.status, 'pending_payment');
    assert.equal(updatedPayment?.status, 'failed');
  });

  it('marks captured payments paid and keeps duplicate verification idempotent', async () => {
    const cookie = await getParticipantCookie();
    const registration = await createPaymentRegistration('20');
    const orderId = `order_captured_${runId}`;
    const paymentId = `pay_captured_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      amountPaise: 150000,
      status: 'created'
    });
    setRazorpayClientFactoryForTests(() => ({
      orders: {
        create: async () => ({}),
        fetch: async () => ({ id: orderId, amount: 150000, currency: 'INR', status: 'paid' })
      },
      payments: {
        fetch: async () => ({
          id: paymentId,
          order_id: orderId,
          amount: 150000,
          currency: 'INR',
          status: 'captured',
          captured: true
        })
      }
    }));
    const body = JSON.stringify({
      registrationId: registration.id,
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature(orderId, paymentId)
    });
    const first = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.verified, true);
    const second = await request('/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.body.verified, true);
    const updatedRegistration = await Registration.findById(registration.id);
    const updatedPayment = await Payment.findOne({ registrationId: registration._id, razorpayOrderId: orderId });
    assert.equal(updatedRegistration?.paymentStatus, 'paid');
    assert.equal(updatedRegistration?.status, 'confirmed');
    assert.equal(updatedPayment?.status, 'captured');
  });

  it('reconciles a valid captured webhook and is duplicate-safe', async () => {
    const registration = await createPaymentRegistration('05');
    const orderId = `order_webhook_captured_${runId}`;
    const paymentId = `pay_webhook_captured_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      amountPaise: 80000,
      status: 'created'
    });
    const body = webhookPayload('payment.captured', orderId, paymentId, 80000);
    const response = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(body)
      },
      body
    });
    assert.equal(response.response.status, 200);

    const duplicate = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(body)
      },
      body
    });
    assert.equal(duplicate.response.status, 200);

    const updatedRegistration = await Registration.findById(registration.id);
    const updatedPayment = await Payment.findOne({ razorpayOrderId: orderId });
    assert.equal(updatedRegistration?.paymentStatus, 'paid');
    assert.equal(updatedRegistration?.status, 'confirmed');
    assert.equal(updatedPayment?.status, 'captured');
    assert.equal(updatedPayment?.razorpayPaymentId, paymentId);
  });

  it('rejects invalid webhook signatures and invalid payloads', async () => {
    const invalidSignatureBody = webhookPayload(
      'payment.captured',
      `order_webhook_invalid_signature_${runId}`,
      `pay_webhook_invalid_signature_${runId}`,
      80000
    );
    const invalidSignature = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': '0'.repeat(64)
      },
      body: invalidSignatureBody
    });
    assert.equal(invalidSignature.response.status, 400);

    const invalidPayloadBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_invalid_payload_${runId}` } } }
    });
    const invalidPayload = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(invalidPayloadBody)
      },
      body: invalidPayloadBody
    });
    assert.equal(invalidPayload.response.status, 400);
  });

  it('reconciles failed webhooks and does not downgrade captured payments', async () => {
    const failedRegistration = await createPaymentRegistration('10');
    const failedOrderId = `order_webhook_failed_${runId}`;
    const failedPaymentId = `pay_webhook_failed_${runId}`;
    await Payment.create({
      registrationId: failedRegistration._id,
      razorpayOrderId: failedOrderId,
      amountPaise: 120000,
      status: 'created'
    });
    const failedBody = webhookPayload('payment.failed', failedOrderId, failedPaymentId, 120000);
    const failedResponse = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(failedBody)
      },
      body: failedBody
    });
    assert.equal(failedResponse.response.status, 200);
    const failedRegistrationUpdated = await Registration.findById(failedRegistration.id);
    const failedPaymentUpdated = await Payment.findOne({ razorpayOrderId: failedOrderId });
    assert.equal(failedRegistrationUpdated?.paymentStatus, 'failed');
    assert.equal(failedPaymentUpdated?.status, 'failed');

    const capturedRegistration = await createPaymentRegistration('20');
    const capturedOrderId = `order_webhook_after_capture_${runId}`;
    const capturedPaymentId = `pay_webhook_after_capture_${runId}`;
    await Payment.create({
      registrationId: capturedRegistration._id,
      razorpayOrderId: capturedOrderId,
      amountPaise: 150000,
      status: 'captured',
      razorpayPaymentId: capturedPaymentId,
      signatureVerified: true
    });
    await Registration.findByIdAndUpdate(capturedRegistration.id, {
      $set: { paymentStatus: 'paid', status: 'confirmed' }
    });
    const lateFailedBody = webhookPayload('payment.failed', capturedOrderId, capturedPaymentId, 150000);
    const lateFailed = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(lateFailedBody)
      },
      body: lateFailedBody
    });
    assert.equal(lateFailed.response.status, 200);
    const capturedRegistrationUpdated = await Registration.findById(capturedRegistration.id);
    const capturedPaymentUpdated = await Payment.findOne({ razorpayOrderId: capturedOrderId });
    assert.equal(capturedRegistrationUpdated?.paymentStatus, 'paid');
    assert.equal(capturedRegistrationUpdated?.status, 'confirmed');
    assert.equal(capturedPaymentUpdated?.status, 'captured');
  });

  it('rejects mismatched order and payment webhooks', async () => {
    const registration = await createPaymentRegistration('05');
    const orderId = `order_webhook_mismatch_${runId}`;
    const existingPaymentId = `pay_webhook_existing_${runId}`;
    await Payment.create({
      registrationId: registration._id,
      razorpayOrderId: orderId,
      razorpayPaymentId: existingPaymentId,
      amountPaise: 80000,
      status: 'created'
    });
    const mismatchedBody = webhookPayload(
      'payment.captured',
      orderId,
      `pay_webhook_mismatched_${runId}`,
      80000
    );
    const mismatched = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(mismatchedBody)
      },
      body: mismatchedBody
    });
    assert.equal(mismatched.response.status, 409);

    const mismatchAmountBody = webhookPayload(
      'payment.captured',
      orderId,
      existingPaymentId,
      79999
    );
    const mismatchAmount = await request('/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': webhookSignature(mismatchAmountBody)
      },
      body: mismatchAmountBody
    });
    assert.equal(mismatchAmount.response.status, 409);
  });

  it('checks roles from the database for protected endpoints', async () => {
    const passwordHash = await argon2.hash('AdminPassword123!', { type: argon2.argon2id });
    const admin = await User.create({ name: 'Admin', email: adminEmail, passwordHash, phone: '1234567890', role: 'admin' });
    adminId = admin.id;
    const participantLogin = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: participantEmail, password: 'StrongPassword123!' })
    });
    const participantCookie = participantLogin.response.headers.get('set-cookie');
    assert(participantCookie);
    const denied = await request('/admin/overview', { headers: { cookie: participantCookie } });
    assert.equal(denied.response.status, 403);
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'AdminPassword123!' })
    });
    const adminCookie = adminLogin.response.headers.get('set-cookie');
    assert(adminCookie);
    const allowed = await request('/admin/overview', { headers: { cookie: adminCookie } });
    assert.equal(allowed.response.status, 200);
    await User.deleteOne({ email: participantEmail });
    const deleted = await request('/auth/me', { headers: { cookie: participantCookie } });
    assert.equal(deleted.response.status, 401);
  });
});

export { suite };
