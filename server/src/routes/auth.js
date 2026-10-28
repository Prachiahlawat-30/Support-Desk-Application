import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { login } from '../services/authService.js';
import { validationError } from '../utils/httpError.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const errors = {};
  if (typeof email !== 'string' || !email.trim()) errors.email = 'Email is required';
  if (typeof password !== 'string' || !password) errors.password = 'Password is required';
  if (Object.keys(errors).length) throw validationError(errors);

  res.json({ data: await login(email, password) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ data: req.user });
});
