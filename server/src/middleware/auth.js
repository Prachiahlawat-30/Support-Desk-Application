import { verifyToken } from '../services/authService.js';
import { findUserById } from '../services/userService.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

/** Requires `Authorization: Bearer <token>` and loads the current user into req.user. */
export async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  // Re-read the user so deleted accounts or changed roles take effect immediately.
  const user = await findUserById(verifyToken(token));
  if (!user) throw unauthorized('Your account no longer exists');
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user?.role)) {
      throw forbidden(`Only ${roles.join(' or ')} users can do that`);
    }
    next();
  };
}
