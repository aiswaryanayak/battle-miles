# BATTLE MILES — Authentication module update

This patch replaces the in-memory bearer-token authentication with MongoDB-backed Express sessions and HttpOnly cookies.

## Apply
1. Stop the backend dev server.
2. Back up your current `backend/src/server.ts` if you have made any local changes since creating your backup.
3. Copy this patch's `src/server.ts` to `backend/src/server.ts`.
4. Copy this patch's `src/middleware/auth.ts` to `backend/src/middleware/auth.ts` (create the `middleware` folder if needed).
5. Copy this patch's `src/types.d.ts` to `backend/src/types.d.ts`.
6. Replace `backend/package.json` with this patch's `package.json`.
7. In `backend`, run `npm install` to update `package-lock.json` and install the session packages.

## Environment
Keep your existing `.env` private. Ensure it contains:

- `MONGODB_URI=...`
- `FRONTEND_ORIGIN=http://localhost:3000`
- `SESSION_SECRET=` followed by at least 32 random characters
- `NODE_ENV=development`

Example PowerShell command to generate a secret (run from backend):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the generated value into `.env` as `SESSION_SECRET=...`. Do not share the secret.

## Build and run

```powershell
npm run build
npm run dev
```

The frontend uses the session cookie with `credentials: 'include'`; it does not store
authentication tokens in browser storage.

## Isolated integration tests

Integration tests require `TEST_MONGODB_URI`; they fail closed if it is missing and verify
that its database name is exactly `battle_miles_test`. The test URI must be supplied
separately from `MONGODB_URI` and must not reference the application database:

```powershell
$env:TEST_MONGODB_URI="mongodb+srv://<encoded-test-user>:<encoded-test-password>@<atlas-cluster-host>/battle_miles_test?retryWrites=true&w=majority"
npm test
```

Use an Atlas database user restricted to `battle_miles_test`. The suite creates uniquely
named temporary users and removes only those users and their MongoDB sessions. It does not
drop databases or modify `battle_miles`.

## Authentication endpoints
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Registration and login create a persistent session. Admin role is always read from MongoDB; a participant cannot promote themselves by sending a role field.
