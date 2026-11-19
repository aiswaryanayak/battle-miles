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
  let app: typeof import('./server').app;
  let closeSessionStore: typeof import('./server').closeSessionStore;
  let connectDatabase: typeof import('./config/db').connectDatabase;
  let disconnectDatabase: typeof import('./config/db').disconnectDatabase;
  let User: typeof import('./models').User;
  let server: http.Server;
  let baseUrl: string;
  let participantId: string | undefined;
  let adminId: string | undefined;

  async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    return { response, body: await response.json() as Record<string, unknown> };
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
    ({ User } = await import('./models'));
    await connectDatabase();
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address();
    assert(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  after(async () => {
    const userIds = [participantId, adminId].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      await User.deleteMany({ email: { $in: [participantEmail, adminEmail] } });
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
