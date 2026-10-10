// Пароли — scrypt (node:crypto), сессии — случайный токен, в БД хранится только его SHA-256.
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';

export const ROLES = ['admin', 'investigator', 'reader'];
export const MIN_PASSWORD = 8;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && timingSafeEqual(test, ref);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export const uuid = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export function sessionExpiry(days = Number(process.env.SESSION_DAYS || 30)) {
  return new Date(Date.now() + days * 86400000).toISOString();
}
