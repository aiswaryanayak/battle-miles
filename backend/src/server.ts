import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from './config/db';
import { User, Registration, Payment, Submission, Verification, Audit, KitDispatch } from './models';
import { AuthenticatedRequest, requireAdmin, requireAuth } from './middleware/auth';

export const app = express();
const PORT = Number(process.env.PORT || 4000);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const prices: Record<string, number> = { '05': 80000, '10': 120000, '20': 150000 };

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' as const : 'lax' as const,
  maxAge: SESSION_TTL_MS,
  path: '/'
};

app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250 }));

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long');
}

const databaseReady = connectDatabase();
const sessionStore = MongoStore.create({
  clientPromise: databaseReady.then(() => mongoose.connection.getClient()),
  collectionName: 'sessions',
  ttl: SESSION_TTL_MS / 1000,
  autoRemove: 'native'
});
sessionStore.on('error', error => console.error('Session store error', error instanceof Error ? error.message : error));
app.use(session({
  name: 'bm.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: sessionCookieOptions
}));

export async function closeSessionStore(): Promise<void> {
  await sessionStore.close();
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', service: 'battle-miles-api' }));

// Authentication
app.post('/api/v1/auth/register', async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email().max(254),
      password: z.string().min(10).max(128),
      phone: z.string().trim().min(8).max(20)
    }).strict().parse(req.body);

    const email = body.email.toLowerCase();
    if (await User.exists({ email })) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const user = await User.create({
      name: body.name,
      email,
      phone: body.phone,
      passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }),
      role: 'participant'
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);

    return res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const body = z.object({
      email: z.string().trim().email().max(254),
      password: z.string().min(1).max(128)
    }).strict().parse(req.body);

    const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await argon2.verify(user.passwordHash, body.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/v1/auth/logout', (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('bm.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax',
      path: '/'
    });
    return res.status(200).json({ message: 'Logged out successfully' });
  });
});

app.get('/api/v1/auth/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await User.findById(req.authUser?.id).select('name email phone role');
    if (!user) return res.status(401).json({ message: 'Authentication required' });
    return res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (error) {
    return next(error);
  }
});

// Registration and payments remain unchanged in this first module.
app.post('/api/v1/registrations', async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2), email: z.string().email(), password: z.string().min(10),
      phone: z.string().min(8), address: z.string().min(5), city: z.string().min(2),
      state: z.string().min(2), pincode: z.string().min(5),
      distancePackage: z.enum(['05', '10', '20'])
    }).parse(req.body);

    let user = await User.findOne({ email: body.email.toLowerCase() });
    if (!user) {
      user = await User.create({
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }),
        phone: body.phone,
        role: 'participant'
      });
    } else {
      return res.status(409).json({ message: 'An account with this email already exists. Please log in.' });
    }

    const existing = await Registration.findOne({ userId: user._id });
    if (existing) return res.status(409).json({ message: 'A registration already exists for this account' });

    const registration = await Registration.create({
      userId: user._id,
      distancePackage: body.distancePackage,
      amountPaise: prices[body.distancePackage],
      address: { line1: body.address, city: body.city, state: body.state, pincode: body.pincode }
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);

    return res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      registrationId: registration.id,
      amountPaise: registration.amountPaise,
      paymentStatus: registration.paymentStatus
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/v1/payments/create-order', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ message: 'Payment gateway is not configured' });
    }
    const body = z.object({ registrationId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.body);
    const registration = await Registration.findOne({ _id: body.registrationId, userId: req.authUser?.id });
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({ amount: registration.amountPaise, currency: 'INR', receipt: `bm_${registration.id}` });
    await Payment.create({ registrationId: registration._id, razorpayOrderId: order.id, amountPaise: registration.amountPaise });
    return res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (error) { return next(error); }
});

app.post('/api/v1/payments/verify', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ message: 'Payment gateway is not configured' });
    const body = z.object({
      registrationId: z.string().regex(/^[a-f\d]{24}$/i),
      razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1),
      razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i)
    }).parse(req.body);
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(body.razorpay_signature, 'hex');
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return res.status(400).json({ message: 'Payment signature invalid' });
    }
    const registration = await Registration.findOne({ _id: body.registrationId, userId: req.authUser?.id });
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    const payment = await Payment.findOne({ registrationId: registration._id, razorpayOrderId: body.razorpay_order_id });
    if (!payment) return res.status(404).json({ message: 'Payment order not found' });
    payment.razorpayPaymentId = body.razorpay_payment_id;
    payment.signatureVerified = true;
    payment.status = 'authorized';
    await payment.save();
    registration.paymentStatus = 'paid';
    registration.status = 'confirmed';
    await registration.save();
    return res.json({ verified: true, registrationStatus: registration.status });
  } catch (error) { return next(error); }
});

app.post('/api/v1/submissions', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ registrationId: z.string(), storageKey: z.string().min(5), originalFilename: z.string(), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).parse(req.body);
    const registration = await Registration.findOne({ _id: body.registrationId, userId: req.authUser?.id, paymentStatus: 'paid' });
    if (!registration) return res.status(403).json({ message: 'A paid registration is required' });
    const submission = await Submission.create({ ...body, registrationId: registration._id });
    return res.status(201).json({ submissionId: submission.id, status: submission.status, message: 'Submission received; verification worker integration is pending.' });
  } catch (error) { return next(error); }
});

app.get('/api/v1/submissions/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const registrations = await Registration.find({ userId: req.authUser?.id }).select('_id');
    const ids = registrations.map(registration => registration._id);
    return res.json({ submissions: await Submission.find({ registrationId: { $in: ids } }).sort({ createdAt: -1 }) });
  } catch (error) { return next(error); }
});

app.get('/api/v1/admin/overview', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [participants, registrations, paid, pending] = await Promise.all([
      User.countDocuments({ role: 'participant' }), Registration.countDocuments(),
      Registration.countDocuments({ paymentStatus: 'paid' }),
      Submission.countDocuments({ status: { $in: ['queued', 'pending_review'] } })
    ]);
    return res.json({ participants, registrations, paidRegistrations: paid, pendingReviews: pending });
  } catch (error) { return next(error); }
});

app.get('/api/v1/admin/submissions', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await Submission.find().sort({ createdAt: -1 }).populate({ path: 'registrationId', populate: { path: 'userId', select: 'name email phone' } });
    return res.json({ submissions: rows });
  } catch (error) { return next(error); }
});

app.patch('/api/v1/admin/submissions/:id/decision', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({
      decision: z.enum(['approved', 'rejected', 'resubmission_requested']),
      reason: z.string().trim().max(500).optional(),
      verifiedDistance: z.number().min(0).max(300).optional()
    }).parse(req.body);
    if (body.decision === 'approved' && body.verifiedDistance === undefined) {
      return res.status(400).json({ message: 'Verified distance is required to approve a submission' });
    }
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });
    submission.status = body.decision;
    if (body.verifiedDistance !== undefined) submission.extractedDistance = body.verifiedDistance;
    await submission.save();
    await Audit.create({ adminId: req.authUser?.id, submissionId: submission._id, action: body.decision, reason: body.reason });
    if (body.decision === 'approved') {
      const distance = body.verifiedDistance as number;
      const tier = distance >= 20 ? '20' : distance >= 10 ? '10' : distance >= 5 ? '05' : null;
      await KitDispatch.findOneAndUpdate(
        { registrationId: submission.registrationId },
        { registrationId: submission.registrationId, eligibleDistance: tier ?? null, eligibilityStatus: tier ? 'eligible' : 'not_eligible' },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return res.json({ submission });
  } catch (error) { return next(error); }
});

app.get('/api/v1/admin/participants', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await Registration.find().populate('userId', 'name email phone').sort({ createdAt: -1 });
    return res.json({ registrations: rows });
  } catch (error) { return next(error); }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof z.ZodError) return res.status(400).json({ message: 'Validation failed', errors: error.issues });
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
    return res.status(409).json({ message: 'Email already registered' });
  }
  if (error instanceof Error && error.message === 'Origin is not allowed') {
    return res.status(403).json({ message: 'Origin is not allowed' });
  }
  return res.status(500).json({ message: 'Internal server error' });
});

let httpServer: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    if (httpServer) await new Promise<void>((resolve, reject) => httpServer?.close(error => error ? reject(error) : resolve()));
    await closeSessionStore();
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed', error instanceof Error ? error.message : error);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

if (require.main === module) {
  databaseReady
    .then(() => {
      httpServer = app.listen(PORT, () => console.log(`BATTLE MILES API listening on ${PORT}`));
    })
    .catch(error => { console.error('Startup failed', error instanceof Error ? error.message : error); process.exit(1); });
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
