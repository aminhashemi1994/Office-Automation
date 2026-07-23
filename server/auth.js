import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from './db.js';
import { config } from './config.js';

const secretFile = path.join(config.dataDir, '.jwt-secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'));
export const JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// ---------- ACL ----------
const ROLE_PERMS = {
  admin: ['*'],
  manager: ['tasks.assign', 'users.view', 'reports.view'],
  employee: ['users.view'],
};

export function userPerms(user) {
  const base = ROLE_PERMS[user.role] || [];
  let extra = [];
  try { extra = JSON.parse(user.permissions || '[]'); } catch {}
  return [...base, ...extra];
}

export function hasPerm(user, perm) {
  const perms = userPerms(user);
  return perms.includes('*') || perms.includes(perm);
}

export function requirePerm(perm) {
  return (req, res, next) => {
    if (!hasPerm(req.user, perm)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    next();
  };
}
