import type { FastifyBaseLogger } from 'fastify';
import { now, sqlite } from '../db/index.js';

export function purgeExpiredAuthState(log: FastifyBaseLogger) {
  const sessions = sqlite.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now()).changes;
  const flows = sqlite.prepare('DELETE FROM auth_flows WHERE expires_at<=?').run(now()).changes;
  const invitations = sqlite
    .prepare("UPDATE workspace_invitations SET status='revoked' WHERE status='pending' AND expires_at<=?")
    .run(now()).changes;
  if (sessions || flows || invitations)
    log.info({ sessions, flows, invitations }, 'Expired authentication state removed');
}

export function scheduleMaintenance(log: FastifyBaseLogger) {
  purgeExpiredAuthState(log);
  setInterval(() => purgeExpiredAuthState(log), 6 * 60 * 60 * 1000).unref();
}
