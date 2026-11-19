import assert from 'node:assert/strict';
import http from 'node:http';
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
  let server: http.Server;
  let baseUrl: string;
  let participantId: string | undefined;
  let adminId: string | undefined;
  let otherParticipantId: string | undefined;
  let otherRegistrationId: string | undefined;

  async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    return { response, body: await response.json() as Record<string, unknown> };
  }

  function cookieHeader(setCookie: string): string {
    return setCookie.split(';', 1)[0];
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
    ({ app, closeSessionStore } = await import('./server'));
    ({ connectDatabase, disconnectDatabase } = await import('./config/db'));
    ({ User, Registration } = await import('./models'));
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
