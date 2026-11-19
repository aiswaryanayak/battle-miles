import { NextFunction, Request, Response } from 'express';
import { User } from '../models';

export type AuthenticatedRequest = Request & {
  authUser?: {
    id: string;
    role: 'participant' | 'admin';
  };
};

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    const user = await User.findById(userId).select('_id role');
    if (!user) {
      req.session.destroy(error => {
        if (error) console.error('Session destruction failed', error.message);
      });
      res.clearCookie('bm.sid', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax',
        path: '/'
      });
      return res.status(401).json({ message: 'Authentication required' });
    }

    req.authUser = { id: user.id, role: user.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.authUser?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return next();
}
