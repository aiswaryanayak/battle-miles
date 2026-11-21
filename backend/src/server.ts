import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import crypto from 'crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from './config/db';
import { User, Registration, Payment, Submission, Verification, Audit, KitDispatch } from './models';
import { AuthenticatedRequest, requireAdmin, requireAuth, requireParticipant } from './middleware/auth';
import { registrationPackages, PackageCode } from './config/packages';
import { getRazorpayClient } from './config/razorpay';

export const app = express();
const PORT = Number(process.env.PORT || 4000);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const paymentOrderLocks = new Map<string, Promise<unknown>>();

async function withPaymentOrderLock<T>(registrationId: string, operation: () => Promise<T>): Promise<T> {
  const previous = paymentOrderLocks.get(registrationId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  paymentOrderLocks.set(registrationId, current);
  try {
    return await current;
  } finally {
    if (paymentOrderLocks.get(registrationId) === current) paymentOrderLocks.delete(registrationId);
  }
}

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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250 }));
app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ message: 'Webhook is not configured' });

  const signature = req.get('x-razorpay-signature');
  if (!signature || !/^[a-f\d]{64}$/i.test(signature) || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ message: 'Invalid webhook signature' });
  }

  const expected = crypto.createHmac('sha256', webhookSecret).update(req.body).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(400).json({ message: 'Invalid webhook signature' });
  }

  let payload: any;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid webhook payload' });
  }

  if (payload?.event !== 'payment.captured' && payload?.event !== 'payment.failed') {
    return res.status(200).json({ received: true });
  }

  const entity = payload?.payload?.payment?.entity;
  if (
    !entity ||
    typeof entity.id !== 'string' ||
    typeof entity.order_id !== 'string' ||
    typeof entity.amount !== 'number' ||
    typeof entity.currency !== 'string'
  ) {
    return res.status(400).json({ message: 'Invalid webhook payload' });
  }

  try {
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
    if (!payment) return res.status(404).json({ message: 'Payment order not found' });

    if (
      payment.razorpayPaymentId &&
      payment.razorpayPaymentId !== entity.id
    ) {
      return res.status(409).json({ message: 'Payment does not match this order' });
    }

    const reusedPayment = await Payment.findOne({ razorpayPaymentId: entity.id });
    if (
      reusedPayment &&
      (
        reusedPayment.id !== payment.id ||
        reusedPayment.razorpayOrderId !== entity.order_id
      )
    ) {
      return res.status(409).json({ message: 'Payment ID is already associated with another registration' });
    }

    const registration = await Registration.findById(payment.registrationId);
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    if (
      payment.amountPaise !== registration.amountPaise ||
      entity.amount !== payment.amountPaise ||
      entity.currency !== 'INR' ||
      registration.currency !== 'INR'
    ) {
      return res.status(409).json({ message: 'Payment amount or currency mismatch' });
    }

    if (payload.event === 'payment.captured') {
      if (entity.status !== 'captured' || entity.captured !== true) {
        return res.status(409).json({ message: 'Payment is not captured' });
      }
      await Payment.findOneAndUpdate(
        { _id: payment._id },
        {
          $set: {
            razorpayPaymentId: entity.id,
            signatureVerified: true,
            status: 'captured',
            amountPaise: registration.amountPaise
          }
        }
      );
      await Registration.findOneAndUpdate(
        { _id: registration._id, paymentStatus: { $ne: 'paid' } },
        { $set: { paymentStatus: 'paid', status: 'confirmed' } }
      );
      return res.status(200).json({ received: true });
    }

    if (payment.status === 'captured' || registration.paymentStatus === 'paid') {
      return res.status(200).json({ received: true });
    }

    await Payment.findOneAndUpdate(
      { _id: payment._id },
      {
        $set: {
          razorpayPaymentId: entity.id,
          signatureVerified: false,
          status: 'failed',
          amountPaise: registration.amountPaise
        }
      }
    );
    await Registration.findOneAndUpdate(
      { _id: registration._id, paymentStatus: { $ne: 'paid' } },
      { $set: { paymentStatus: 'failed', status: 'pending_payment' } }
    );
    return res.status(200).json({ received: true });
  } catch {
    return res.status(500).json({ message: 'Unable to reconcile payment webhook' });
  }
});
app.use(express.json({ limit: '1mb' }));

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

function registrationResponse(registration: typeof Registration.prototype) {
  const packageConfig = registrationPackages[registration.distancePackage as PackageCode];
  return {
    id: registration.id,
    userId: registration.userId,
    distancePackage: registration.distancePackage,
    distanceKm: packageConfig.distanceKm,
    amountPaise: packageConfig.amountPaise,
    currency: registration.currency,
    inclusions: packageConfig.inclusions,
    address: registration.address,
    paymentStatus: registration.paymentStatus,
    status: registration.status,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt
  };
}

app.post('/api/v1/registrations', requireAuth, requireParticipant, async (req: AuthenticatedRequest, res, next) => {
  try {
    const idempotencyHeader = req.header('Idempotency-Key');
    if (!idempotencyHeader || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(idempotencyHeader)) {
      return res.status(400).json({ message: 'A valid Idempotency-Key header is required' });
    }

    const body = z.object({
      distancePackage: z.enum(['05', '10', '20']),
      address: z.object({
        line1: z.string().trim().min(5).max(200),
        city: z.string().trim().min(2).max(100),
        state: z.string().trim().min(2).max(100),
        pincode: z.string().trim().min(5).max(12)
      }).strict()
    }).strict().parse(req.body);

    const existing = await Registration.findOne({
      userId: req.authUser?.id,
      idempotencyKey: idempotencyHeader
    });
    if (existing) {
      return res.status(200).json({ registration: registrationResponse(existing) });
    }

    const packageConfig = registrationPackages[body.distancePackage];
    try {
      const registration = await Registration.create({
        userId: req.authUser?.id,
        idempotencyKey: idempotencyHeader,
        distancePackage: body.distancePackage,
        amountPaise: packageConfig.amountPaise,
        currency: 'INR',
        paymentStatus: 'pending',
        status: 'pending_payment',
        address: body.address
      });
      return res.status(201).json({ registration: registrationResponse(registration) });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const concurrentExisting = await Registration.findOne({
          userId: req.authUser?.id,
          idempotencyKey: idempotencyHeader
        });
        if (concurrentExisting) {
          return res.status(200).json({ registration: registrationResponse(concurrentExisting) });
        }
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/registrations/me', requireAuth, requireParticipant, async (req: AuthenticatedRequest, res, next) => {
  try {
    const registrations = await Registration.find({ userId: req.authUser?.id }).sort({ createdAt: -1 });
    return res.json({ registrations: registrations.map(registrationResponse) });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/registrations/:id', requireAuth, requireParticipant, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(404).json({ message: 'Registration not found' });
    }
    const registration = await Registration.findOne({
      _id: req.params.id,
      userId: req.authUser?.id
    });
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    return res.json({ registration: registrationResponse(registration) });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/v1/payments/create-order', requireAuth, requireParticipant, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ message: 'Payment gateway is not configured' });
    }
    const body = z.object({ registrationId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.body);
    const registration = await Registration.findOne({ _id: body.registrationId, userId: req.authUser?.id });
    if (!registration) return res.status(404).json({ message: 'Registration not found' });
    if (registration.paymentStatus === 'paid') {
      return res.status(409).json({ message: 'Registration is already paid' });
    }

    const packageConfig = registrationPackages[registration.distancePackage as PackageCode];
    if (!packageConfig || registration.amountPaise !== packageConfig.amountPaise || registration.currency !== 'INR') {
      return res.status(409).json({ message: 'Registration payment amount is invalid' });
    }

    return await withPaymentOrderLock(registration.id, async () => {
      const currentRegistration = await Registration.findOne({ _id: registration._id, userId: req.authUser?.id });
      if (!currentRegistration) return res.status(404).json({ message: 'Registration not found' });
      if (currentRegistration.paymentStatus === 'paid') {
        return res.status(409).json({ message: 'Registration is already paid' });
      }

      const existing = await Payment.findOne({
        registrationId: currentRegistration._id,
        razorpayOrderId: { $exists: true, $ne: null },
        status: { $in: ['created', 'authorized'] }
      }).sort({ createdAt: -1 });

      if (existing?.razorpayOrderId) {
        try {
          const existingOrder = await getRazorpayClient().orders.fetch(existing.razorpayOrderId);
          if (
            existingOrder.id === existing.razorpayOrderId &&
            Number(existingOrder.amount) === currentRegistration.amountPaise &&
            existingOrder.currency === 'INR' &&
            (existingOrder.status === 'created' || existingOrder.status === 'attempted')
          ) {
            return res.json({
              orderId: existing.razorpayOrderId,
              amount: existingOrder.amount,
              currency: existingOrder.currency,
              keyId: process.env.RAZORPAY_KEY_ID
            });
          }
          if (existingOrder.id === existing.razorpayOrderId && existingOrder.status === 'paid') {
            return res.status(409).json({ message: 'Payment order is already paid; verification is required' });
          }
        } catch {
          return res.status(502).json({ message: 'Unable to verify existing payment order' });
        }
      }

      let order: any;
      try {
        order = await getRazorpayClient().orders.create({
          amount: currentRegistration.amountPaise,
          currency: 'INR',
          receipt: `bm_${currentRegistration.id}`
        });
      } catch {
        return res.status(502).json({ message: 'Unable to create payment order' });
      }

      if (!order?.id || Number(order.amount) !== currentRegistration.amountPaise || order.currency !== 'INR') {
        return res.status(502).json({ message: 'Payment gateway returned an invalid order' });
      }

      try {
        await Payment.create({
          registrationId: currentRegistration._id,
          razorpayOrderId: order.id,
          amountPaise: currentRegistration.amountPaise,
          status: 'created',
          signatureVerified: false
        });
      } catch (error) {
        const existingByOrder = await Payment.findOne({
          registrationId: currentRegistration._id,
          razorpayOrderId: order.id
        });
        if (!existingByOrder) throw error;
      }

      return res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID
      });
    });
  } catch (error) { return next(error); }
});

app.post('/api/v1/payments/verify', requireAuth, requireParticipant, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ message: 'Payment gateway is not configured' });
    const body = z.object({
      registrationId: z.string().regex(/^[a-f\d]{24}$/i),
      razorpay_order_id: z.string().trim().min(1).max(128),
      razorpay_payment_id: z.string().trim().min(1).max(128),
      razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i)
    }).strict().parse(req.body);

    const registration = await Registration.findOne({ _id: body.registrationId, userId: req.authUser?.id });
    if (!registration) return res.status(404).json({ message: 'Registration not found' });

    const packageConfig = registrationPackages[registration.distancePackage as PackageCode];
    if (!packageConfig || registration.amountPaise !== packageConfig.amountPaise || registration.currency !== 'INR') {
      return res.status(409).json({ message: 'Registration payment amount is invalid' });
    }

    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(body.razorpay_signature, 'hex');
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return res.status(400).json({ message: 'Payment signature invalid' });
    }

    const payment = await Payment.findOne({
      registrationId: registration._id,
      razorpayOrderId: body.razorpay_order_id
    });
    if (!payment) return res.status(404).json({ message: 'Payment order not found' });
    if (payment.razorpayPaymentId && payment.razorpayPaymentId !== body.razorpay_payment_id) {
      return res.status(409).json({ message: 'Payment does not match this order' });
    }

    const reusedPayment = await Payment.findOne({ razorpayPaymentId: body.razorpay_payment_id });
    if (reusedPayment && (
      reusedPayment.registrationId.toString() !== registration.id ||
      reusedPayment.razorpayOrderId !== body.razorpay_order_id
    )) {
      return res.status(409).json({ message: 'Payment ID is already associated with another registration' });
    }

    if (payment.amountPaise !== registration.amountPaise) {
      return res.status(409).json({ message: 'Payment amount does not match registration' });
    }

    let razorpayOrder: any;
    let razorpayPayment: any;
    try {
      const razorpay = getRazorpayClient();
      [razorpayOrder, razorpayPayment] = await Promise.all([
        razorpay.orders.fetch(body.razorpay_order_id),
        razorpay.payments.fetch(body.razorpay_payment_id)
      ]);
    } catch {
      return res.status(502).json({ message: 'Unable to verify payment with payment gateway' });
    }

    if (
      razorpayOrder.id !== body.razorpay_order_id ||
      Number(razorpayOrder.amount) !== registration.amountPaise ||
      razorpayOrder.currency !== 'INR'
    ) {
      return res.status(409).json({ message: 'Payment order validation failed' });
    }
    if (
      razorpayPayment.id !== body.razorpay_payment_id ||
      razorpayPayment.order_id !== body.razorpay_order_id ||
      Number(razorpayPayment.amount) !== registration.amountPaise ||
      razorpayPayment.currency !== 'INR'
    ) {
      return res.status(409).json({ message: 'Payment validation failed' });
    }

    if (razorpayPayment.status === 'captured' && razorpayPayment.captured === true) {
      await Payment.findOneAndUpdate(
        { _id: payment._id },
        {
          $set: {
            razorpayPaymentId: body.razorpay_payment_id,
            signatureVerified: true,
            status: 'captured',
            amountPaise: registration.amountPaise
          }
        }
      );
      await Registration.findOneAndUpdate(
        { _id: registration._id, paymentStatus: { $ne: 'paid' } },
        { $set: { paymentStatus: 'paid', status: 'confirmed' } }
      );
      const updatedRegistration = await Registration.findById(registration._id);
      return res.json({
        verified: true,
        registrationStatus: updatedRegistration?.status,
        paymentStatus: updatedRegistration?.paymentStatus
      });
    }

    if (razorpayPayment.status === 'authorized') {
      await Payment.findOneAndUpdate(
        { _id: payment._id },
        {
          $set: {
            razorpayPaymentId: body.razorpay_payment_id,
            signatureVerified: true,
            status: 'authorized',
            amountPaise: registration.amountPaise
          }
        }
      );
      return res.json({
        verified: false,
        registrationStatus: registration.status,
        paymentStatus: registration.paymentStatus,
        message: 'Payment is authorized but not yet captured'
      });
    }

    await Payment.findOneAndUpdate(
      { _id: payment._id },
      {
        $set: {
          razorpayPaymentId: body.razorpay_payment_id,
          signatureVerified: true,
          status: 'failed',
          amountPaise: registration.amountPaise
        }
      }
    );
    await Registration.findOneAndUpdate(
      { _id: registration._id, paymentStatus: { $ne: 'paid' } },
      { $set: { paymentStatus: 'failed', status: 'pending_payment' } }
    );
    return res.json({
      verified: false,
      registrationStatus: 'pending_payment',
      paymentStatus: 'failed',
      message: 'Payment was not successful'
    });
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
