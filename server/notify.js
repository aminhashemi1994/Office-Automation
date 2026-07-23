import db from './db.js';

let ioRef = null;
export function setIO(io) { ioRef = io; }
export function getIO() { return ioRef; }

export function notifyUser(userId, { type = 'info', title, body = '', link = '' }) {
  const r = db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, type, title, body, link);
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(r.lastInsertRowid);
  if (ioRef) ioRef.to(`user:${userId}`).emit('notification', notif);
  return notif;
}

export function notifyUsers(userIds, payload) {
  for (const id of new Set(userIds)) notifyUser(id, payload);
}
