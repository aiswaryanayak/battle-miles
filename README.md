# Building Marathon

A responsive virtual-marathon platform starter with:
- Next.js + TypeScript participant-facing website
- Express + TypeScript REST API
- MongoDB/Mongoose data models
- Razorpay order creation and signature verification (test credentials)
- Private object-storage upload integration interface
- Python/FastAPI verification service scaffold
- Admin review and kit eligibility workflow

## Important
This is a development MVP scaffold, not a production-certified payment or image-forensics system.
Before production: configure HTTPS, secure session/cookie settings, CSRF protection, rate limits,
backups, private object storage, Razorpay webhook verification, admin provisioning, audit logging,
and test all payment/webhook edge cases. AI/image checks are indicators only; human admin approval
is mandatory.

## Requirements
- Node.js 20+
- MongoDB
- Python 3.10+ (for verification service)

## Run locally

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Backend tests
The integration suite requires an explicitly supplied, separate database. It refuses to run
when `TEST_MONGODB_URI` is missing or when its database name is not exactly `battle_miles_test`.
Create a dedicated Atlas database/user with access only to that database. Do not copy the
application URI or use the `battle_miles` database.

Set the variable using your real Atlas values (credentials must be URL-encoded):

```powershell
cd backend
$env:TEST_MONGODB_URI="mongodb+srv://<encoded-test-user>:<encoded-test-password>@<atlas-cluster-host>/battle_miles_test?retryWrites=true&w=majority"
npm test
```

The test process uses only `TEST_MONGODB_URI`; it never falls back to `MONGODB_URI`.
Cleanup targets only uniquely generated test users and their sessions. The suite covers
Argon2id password hashing, validation, duplicate registration handling, MongoDB session
persistence, logout, and participant/admin authorization.

### Frontend
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

### Verification service
```bash
cd verification
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Frontend: http://localhost:3000
Backend: http://localhost:4000
Verification API: http://localhost:8001

## First-run setup
1. Create a MongoDB database and set `MONGODB_URI`.
2. Set Razorpay test key ID/secret in backend `.env`.
3. Create the first admin using the backend's admin seed script:
   `npm run seed:admin`
4. Do not commit `.env` files.
5. Configure a real private storage provider before accepting real participant screenshots.

## Business rules currently assumed
- Packages: 5 KM ₹800, 10 KM ₹1,200, 20 KM ₹1,500 (confirm with client).
- Eligibility: 5–<10 KM => 5 KM kit; 10–<20 KM => 10 KM kit; >=20 KM => 20 KM kit.
- Distance below 5 KM is not eligible.
- Event dates, registration dates, kit contents, prizes, and resubmission policy remain configurable/TBC.
- A participant pays for a selected package; verified distance determines the finisher-kit tier.
