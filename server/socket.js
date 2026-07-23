import { Server } from 'socket.io';
import db from './db.js';
import { verifyToken } from './auth.js';
import { setIO } from './notify.js';

// وضعیت تماس‌ها در حافظه: roomId -> Map<socketId, {userId, name}>
const callRooms = new Map();
const callInvites = new Map(); // room -> Set<userId> (دعوت‌شدگانی که هنوز پاسخ نداده‌اند)
const online = new Map(); // userId -> Set<socketId>

export function setupSocket(httpServer) {
  const io = new Server(httpServer, { maxHttpBufferSize: 1e6 });
  setIO(io);

  io.use((socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token || '');
    if (!payload) return next(new Error('unauthorized'));
    const user = db.prepare('SELECT id, full_name, avatar_color FROM users WHERE id = ? AND is_active = 1').get(payload.id);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    if (!online.has(user.id)) online.set(user.id, new Set());
    online.get(user.id).add(socket.id);
    io.emit('presence', { user_id: user.id, online: true });
    socket.emit('presence:list', [...online.keys()]);

    socket.on('typing', ({ conversation_id }) => {
      const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversation_id);
      if (!members.some(m => m.user_id === user.id)) return;
      for (const m of members) {
        if (m.user_id !== user.id) {
          io.to(`user:${m.user_id}`).emit('typing', { conversation_id, user_id: user.id, name: user.full_name });
        }
      }
    });

    // ---------- تماس و کنفرانس ----------
    // room: `call:<uuid>` — دعوت مستقیم یا کنفرانس گروهی
    // آیا کاربر هم‌اکنون در تماس دیگری مشغول است؟ (در یکی از اتاق‌های فعال حضور دارد)
    const isUserBusy = (uid) => {
      // در یکی از تماس‌های فعال حضور دارد
      for (const peers of callRooms.values()) {
        for (const info of peers.values()) if (info.userId === uid) return true;
      }
      // در حال زنگ‌خوردن برای تماس دیگری است (دعوت‌شده ولی هنوز پاسخ نداده)
      for (const invited of callInvites.values()) {
        if (invited.has(uid)) return true;
      }
      return false;
    };

    socket.on('call:invite', ({ room, target_user_ids, video, title, conversation_id, group }) => {
      if (!callInvites.has(room)) callInvites.set(room, new Set());
      for (const uid of target_user_ids || []) {
        // اگر مخاطب مشغول تماس دیگری است، به‌جای زنگ‌خوردن، به تماس‌گیرنده «اشغال» اعلام می‌شود
        if (isUserBusy(uid)) {
          const target = db.prepare('SELECT full_name FROM users WHERE id = ?').get(uid);
          socket.emit('call:busy', { room, user_id: uid, name: target?.full_name || '' });
          continue;
        }
        callInvites.get(room).add(uid);
        io.to(`user:${uid}`).emit('call:incoming', {
          room, video: !!video, title: title || '', conversation_id: conversation_id || null, group: !!group,
          from: { id: user.id, name: user.full_name, color: user.avatar_color },
        });
      }
    });

    socket.on('call:join', ({ room }) => {
      if (!callRooms.has(room)) callRooms.set(room, new Map());
      const peers = callRooms.get(room);
      // اطلاعات اعضای فعلی برای عضو جدید
      socket.emit('call:peers', [...peers.entries()].map(([sid, info]) => ({ socket_id: sid, ...info })));
      peers.set(socket.id, { userId: user.id, name: user.full_name, color: user.avatar_color });
      socket.join(room);
      socket.data.callRoom = room;
      callInvites.get(room)?.delete(user.id); // این کاربر پاسخ داد و دیگر «در حال زنگ‌خوردن» نیست
      socket.to(room).emit('call:peer-joined', { socket_id: socket.id, userId: user.id, name: user.full_name, color: user.avatar_color });
    });

    socket.on('call:reject', ({ room, to_user_id }) => {
      if (to_user_id) io.to(`user:${to_user_id}`).emit('call:rejected', { room, by: user.full_name });
      // این دعوت‌شونده دیگر منتظر نیست
      callInvites.get(room)?.delete(user.id);
    });

    const cancelInvites = (room) => {
      const inv = callInvites.get(room);
      if (inv) {
        for (const uid of inv) io.to(`user:${uid}`).emit('call:cancelled', { room });
        callInvites.delete(room);
      }
    };

    const leaveCall = () => {
      const room = socket.data.callRoom;
      if (!room) return;
      const peers = callRooms.get(room);
      if (peers) {
        peers.delete(socket.id);
        if (peers.size === 0) { callRooms.delete(room); cancelInvites(room); }
      }
      socket.leave(room);
      socket.to(room).emit('call:peer-left', { socket_id: socket.id });
      socket.data.callRoom = null;
    };
    socket.on('call:leave', leaveCall);

    // سیگنالینگ WebRTC — ارسال مستقیم به سوکت مقصد
    socket.on('rtc:signal', ({ to, data }) => {
      io.to(to).emit('rtc:signal', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      leaveCall();
      const set = online.get(user.id);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          online.delete(user.id);
          io.emit('presence', { user_id: user.id, online: false });
        }
      }
    });
  });

  return io;
}
