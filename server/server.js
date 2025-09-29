// Sharedo Backend: Express + Socket.io
// Simplified in-memory backend for demo purposes (no persistent DB)

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// Generate or load a persisted 6-char server access code
function randomCode(n=6){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i=0;i<n;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
let SERVER_CODE = (process.env.SERVER_CODE || '').toUpperCase();
try {
  if (!SERVER_CODE) {
    const codePath = path.join(__dirname, 'server_code.txt');
    if (fs.existsSync(codePath)) {
      const raw = fs.readFileSync(codePath, 'utf8').trim().toUpperCase();
      if (/^[A-Z0-9]{6}$/.test(raw)) SERVER_CODE = raw;
    }
    if (!SERVER_CODE) {
      SERVER_CODE = randomCode(6).toUpperCase();
      fs.writeFileSync(codePath, SERVER_CODE, 'utf8');
    }
  }
} catch (e) {
  // Fallback to random if FS fails
  if (!SERVER_CODE) SERVER_CODE = randomCode(6).toUpperCase();
}

// SQLite database
const dbPath = path.join(__dirname, 'sharedo.db');
const db = new sqlite3.Database(dbPath);

// Small promise-based helpers for sqlite3
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err){
    if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

// Initialize database schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    avatarUrl TEXT DEFAULT ''
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    imageUrl TEXT DEFAULT '',
    createdBy TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    date TEXT NOT NULL,
    ideaId TEXT,
    createdBy TEXT NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(id),
    FOREIGN KEY (ideaId) REFERENCES ideas(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS availability (
    id TEXT PRIMARY KEY,
    eventId TEXT NOT NULL,
    userId TEXT NOT NULL,
    status TEXT CHECK(status IN ('yes', 'no', 'maybe')) NOT NULL,
    FOREIGN KEY (eventId) REFERENCES events(id),
    FOREIGN KEY (userId) REFERENCES users(id),
    UNIQUE(eventId, userId)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    imageUrl TEXT DEFAULT '',
    createdBy TEXT NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(id)
  )`);
  // Add description column if missing
  db.run(`ALTER TABLE rooms ADD COLUMN description TEXT DEFAULT ''`, () => {});
  
  db.run(`CREATE TABLE IF NOT EXISTS room_members (
    roomId TEXT NOT NULL,
    userId TEXT NOT NULL,
    FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id),
    PRIMARY KEY (roomId, userId)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    roomId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (roomId) REFERENCES rooms(id),
    FOREIGN KEY (senderId) REFERENCES users(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS idea_votes (
    id TEXT PRIMARY KEY,
    ideaId TEXT NOT NULL,
    userId TEXT NOT NULL,
    vote TEXT CHECK(vote IN ('up','down')) NOT NULL,
    FOREIGN KEY (ideaId) REFERENCES ideas(id),
    FOREIGN KEY (userId) REFERENCES users(id),
    UNIQUE(ideaId, userId)
  )`);

  // Special highlighted days for calendar
  db.run(`CREATE TABLE IF NOT EXISTS special_days (
    date TEXT PRIMARY KEY,
    color TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(id)
  )`);
  
  // Create default General room if it doesn't exist
  db.get('SELECT id FROM rooms WHERE id = ?', ['general'], (err, row) => {
    if (!row) {
      db.run('INSERT INTO rooms (id, name, imageUrl, createdBy) VALUES (?, ?, ?, ?)', 
        ['general', 'General', '', 'system']);
    }
  });
});

// Helper: auth middleware
function authRequired(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: [CLIENT_ORIGIN, 'http://localhost:4000'],
    credentials: true
  }
});

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// File uploads
const uploadsDir = path.join(__dirname, 'uploads');
import fs from 'fs';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadsDir));

// Auth routes
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  
  db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], async (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.status(400).json({ error: 'Username or email already taken' });
    
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    db.run('INSERT INTO users (id, username, email, passwordHash, avatarUrl) VALUES (?, ?, ?, ?, ?)',
      [userId, username, email, passwordHash, ''], function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        // Auto-join General room
        db.run('INSERT OR IGNORE INTO room_members (roomId, userId) VALUES (?, ?)', ['general', userId]);
        
        const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
        res.json({ id: userId, username, email, avatarUrl: '' });
      });
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password, code } = req.body || {};
  if (!code || String(code).toUpperCase() !== SERVER_CODE) {
    return res.status(403).json({ error: 'Invalid code' });
  }
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl });
  });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// Profile
app.get('/api/profile', authRequired, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl });
  });
});

app.put('/api/profile', authRequired, (req, res) => {
  const { avatarUrl, username } = req.body || {};
  let updates = [];
  let params = [];
  
  if (typeof avatarUrl === 'string') {
    updates.push('avatarUrl = ?');
    params.push(avatarUrl);
  }
  if (typeof username === 'string' && username.length > 0) {
    updates.push('username = ?');
    params.push(username);
  }
  
  if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });
  
  params.push(req.user.id);
  
  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      const payload = { id: user.id, username: user.username, avatarUrl: user.avatarUrl };
      io.emit('user:updated', payload);
      res.json({ id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl });
    });
  });
});

// Ideas
app.get('/api/ideas', authRequired, async (req, res) => {
  try {
    const ideas = await dbAll('SELECT * FROM ideas ORDER BY createdAt ASC');
    const votes = await dbAll('SELECT ideaId, vote, COUNT(*) as c FROM idea_votes GROUP BY ideaId, vote');
    const myVotes = await dbAll('SELECT ideaId, vote FROM idea_votes WHERE userId = ?', [req.user.id]);
    const byIdea = new Map();
    for (const v of votes) {
      const agg = byIdea.get(v.ideaId) || { up: 0, down: 0 };
      if (v.vote === 'up') agg.up = v.c; else agg.down = v.c;
      byIdea.set(v.ideaId, agg);
    }
    const mine = new Map(myVotes.map(v => [v.ideaId, v.vote]));
    res.json(ideas.map(i => ({
      ...i,
      votes: byIdea.get(i.id) || { up: 0, down: 0 },
      myVote: mine.get(i.id) || null
    })));
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/ideas/:id/vote', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { vote } = req.body || {};
    if (!['up','down',null].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
    const idea = await dbGet('SELECT id FROM ideas WHERE id = ?', [id]);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    const existing = await dbGet('SELECT * FROM idea_votes WHERE ideaId = ? AND userId = ?', [id, req.user.id]);
    if (!vote) {
      if (existing) await dbRun('DELETE FROM idea_votes WHERE ideaId = ? AND userId = ?', [id, req.user.id]);
    } else if (!existing) {
      await dbRun('INSERT INTO idea_votes (id, ideaId, userId, vote) VALUES (?, ?, ?, ?)', [uuidv4(), id, req.user.id, vote]);
    } else {
      await dbRun('UPDATE idea_votes SET vote = ? WHERE ideaId = ? AND userId = ?', [vote, id, req.user.id]);
    }
    io.emit('ideas:changed', { ideaId: id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Lightweight EventSource stream to signal ideas updates (not sending data, just ping)
app.get('/api/ideas/stream', authRequired, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const ping = setInterval(()=>{ res.write(`data: ping\n\n`) }, 15000);
  req.on('close', ()=> clearInterval(ping));
});

app.post('/api/ideas', authRequired, async (req, res) => {
  try {
    const { title, description = '', imageUrl = '' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = uuidv4();
    const createdAt = Date.now();
    await dbRun('INSERT INTO ideas (id, title, description, imageUrl, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [id, title, description, imageUrl, req.user.id, createdAt]);
    const idea = { id, title, description, imageUrl, createdBy: req.user.id, createdAt };
    io.emit('idea:created', idea);
    res.status(201).json(idea);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Upload endpoint for images
app.post('/api/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  res.status(201).json({ url });
});

// Special days API
app.get('/api/special-days', authRequired, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM special_days');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

app.put('/api/special-days/:date', authRequired, async (req, res) => {
  try {
    const { date } = req.params; // YYYY-MM-DD
    const { color } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
    if (typeof color !== 'string' || !color) return res.status(400).json({ error: 'Invalid color' });
    await dbRun('INSERT INTO special_days (date, color, createdBy) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET color = excluded.color', [date, color, req.user.id]);
    io.emit('special:changed', { date, color });
    res.json({ date, color });
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/special-days/:date', authRequired, async (req, res) => {
  try {
    const { date } = req.params;
    await dbRun('DELETE FROM special_days WHERE date = ?', [date]);
    io.emit('special:changed', { date, color: null });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/ideas/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dbGet('SELECT * FROM ideas WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.createdBy !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await dbRun('DELETE FROM ideas WHERE id = ?', [id]);
    io.emit('idea:deleted', row);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Events
const withAvailability = async (event) => {
  const avail = await dbAll('SELECT * FROM availability WHERE eventId = ?', [event.id]);
  return { ...event, availability: avail };
};

app.get('/api/events', authRequired, async (req, res) => {
  try {
    const events = await dbAll('SELECT * FROM events ORDER BY date ASC');
    const enriched = await Promise.all(events.map(withAvailability));
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Detailed event view with idea and availability
app.get('/api/events/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const ev = await dbGet('SELECT * FROM events WHERE id = ?', [id]);
    if (!ev) return res.status(404).json({ error: 'Not found' });
    const idea = ev.ideaId ? await dbGet('SELECT * FROM ideas WHERE id = ?', [ev.ideaId]) : null;
    const availability = await dbAll(`
      SELECT a.*, u.username, u.avatarUrl FROM availability a 
      LEFT JOIN users u ON u.id = a.userId
      WHERE a.eventId = ?
    `, [id]);
    res.json({ ...ev, idea, availability });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/events/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const ev = await dbGet('SELECT * FROM events WHERE id = ?', [id]);
    if (!ev) return res.status(404).json({ error: 'Not found' });
    let canDelete = ev.createdBy === req.user.id;
    if (!canDelete && ev.ideaId) {
      const idea = await dbGet('SELECT createdBy FROM ideas WHERE id = ?', [ev.ideaId]);
      if (idea && idea.createdBy === req.user.id) canDelete = true;
    }
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });
    await dbRun('DELETE FROM availability WHERE eventId = ?', [id]);
    await dbRun('DELETE FROM events WHERE id = ?', [id]);
    io.emit('event:deleted', { id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/events', authRequired, async (req, res) => {
  try {
    const { title, description = '', date, ideaId = null } = req.body || {};
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
    const id = uuidv4();
    await dbRun('INSERT INTO events (id, title, description, date, ideaId, createdBy) VALUES (?, ?, ?, ?, ?, ?)',
      [id, title, description, date, ideaId, req.user.id]);
    const event = { id, title, description, date, ideaId, createdBy: req.user.id };
    const payload = await withAvailability(event);
    io.emit('event:created', payload);
    res.status(201).json(payload);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/events/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dbGet('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { title, description, date, ideaId } = req.body || {};
    const next = {
      title: typeof title === 'string' ? title : row.title,
      description: typeof description === 'string' ? description : row.description,
      date: typeof date === 'string' ? date : row.date,
      ideaId: ideaId !== undefined ? ideaId : row.ideaId
    };
    await dbRun('UPDATE events SET title = ?, description = ?, date = ?, ideaId = ? WHERE id = ?',
      [next.title, next.description, next.date, next.ideaId, id]);
    const payload = await withAvailability({ ...row, ...next });
    io.emit('event:updated', payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/events/:id/availability', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['yes', 'no', 'maybe'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const event = await dbGet('SELECT id FROM events WHERE id = ?', [id]);
    if (!event) return res.status(404).json({ error: 'Not found' });
    const existing = await dbGet('SELECT * FROM availability WHERE eventId = ? AND userId = ?', [id, req.user.id]);
    if (!existing) {
      await dbRun('INSERT INTO availability (id, eventId, userId, status) VALUES (?, ?, ?, ?)', [uuidv4(), id, req.user.id, status]);
    } else {
      await dbRun('UPDATE availability SET status = ? WHERE eventId = ? AND userId = ?', [status, id, req.user.id]);
    }
    const payload = { eventId: id, userId: req.user.id, status };
    io.emit('event:availability', payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Chat history via HTTP (optional)
app.get('/api/chat/messages', authRequired, async (req, res) => {
  try {
    // Return latest 100 messages with sender basic info from rooms the user is in
    const rooms = await dbAll('SELECT roomId FROM room_members WHERE userId = ?', [req.user.id]);
    const roomIds = rooms.map(r => r.roomId);
    if (roomIds.length === 0) return res.json([]);
    const placeholders = roomIds.map(()=>'?').join(',');
    const msgs = await dbAll(`SELECT * FROM messages WHERE roomId IN (${placeholders}) ORDER BY timestamp DESC LIMIT 100`, roomIds);
    const users = await dbAll('SELECT id, username, avatarUrl FROM users');
    const byId = new Map(users.map(u => [u.id, u]));
    const result = msgs.map(m => {
      const u = byId.get(m.senderId);
      return { ...m, senderName: u?.username || 'Unknown', avatarUrl: u?.avatarUrl || '' };
    }).reverse();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Rooms API
async function ensureDefaultRoom() {
  const row = await dbGet('SELECT id FROM rooms WHERE id = ?', ['general']);
  if (!row) {
    await dbRun('INSERT INTO rooms (id, name, imageUrl, createdBy) VALUES (?, ?, ?, ?)', ['general', 'General', '', 'system']);
  }
}
ensureDefaultRoom().catch(()=>{});

// List rooms for current user (always include General)
app.get('/api/rooms', authRequired, async (req, res) => {
  try {
    await ensureDefaultRoom();
    await dbRun('INSERT OR IGNORE INTO room_members (roomId, userId) VALUES (?, ?)', ['general', req.user.id]);
  const rooms = await dbAll('SELECT r.* FROM rooms r JOIN room_members m ON m.roomId = r.id WHERE m.userId = ?', [req.user.id]);
    res.json(rooms);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/rooms', authRequired, async (req, res) => {
  try {
    const { name, members, imageUrl = '', description = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    const memberIds = Array.isArray(members) && members.length ? members : [req.user.id];
    await dbRun('INSERT INTO rooms (id, name, imageUrl, createdBy, description) VALUES (?, ?, ?, ?, ?)', [id, name, imageUrl, req.user.id, description]);
    for (const uid of Array.from(new Set(memberIds))) {
      await dbRun('INSERT OR IGNORE INTO room_members (roomId, userId) VALUES (?, ?)', [id, uid]);
    }
    const room = await dbGet('SELECT * FROM rooms WHERE id = ?', [id]);
    io.emit('rooms:changed', { id });
    res.status(201).json(room);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/rooms/:id/messages', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const room = await dbGet('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const member = await dbGet('SELECT 1 FROM room_members WHERE roomId = ? AND userId = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Forbidden' });
    const msgs = await dbAll('SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC', [id]);
    const users = await dbAll('SELECT id, username, avatarUrl FROM users');
    const byId = new Map(users.map(u => [u.id, u]));
    const result = msgs.slice(-200).map(m => {
      const u = byId.get(m.senderId);
      return { ...m, senderName: u?.username || 'Unknown', avatarUrl: u?.avatarUrl || '' };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Update a room (name, image, members) — only creator can update for simplicity
app.put('/api/rooms/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const room = await dbGet('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.createdBy !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { name, imageUrl, members, description } = req.body || {};
    const next = {
      name: typeof name === 'string' && name.trim() ? name.trim() : room.name,
      imageUrl: typeof imageUrl === 'string' ? imageUrl : room.imageUrl,
      description: typeof description === 'string' ? description : room.description
    };
    await dbRun('UPDATE rooms SET name = ?, imageUrl = ?, description = ? WHERE id = ?', [next.name, next.imageUrl, next.description, id]);
    if (Array.isArray(members)) {
      // Always ensure creator stays a member
      const unique = new Set(members.filter(Boolean));
      unique.add(room.createdBy);
      await dbRun('DELETE FROM room_members WHERE roomId = ?', [id]);
      for (const uid of Array.from(unique)) {
        await dbRun('INSERT OR IGNORE INTO room_members (roomId, userId) VALUES (?, ?)', [id, uid]);
      }
    }
    const updated = await dbGet('SELECT * FROM rooms WHERE id = ?', [id]);
    io.to('room:' + id).emit('room:updated', { id, name: updated.name, imageUrl: updated.imageUrl, description: updated.description });
    io.emit('rooms:changed', { id });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Room details endpoint
app.get('/api/rooms/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const room = await dbGet('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const members = await dbAll('SELECT u.id, u.username, u.avatarUrl FROM room_members m JOIN users u ON u.id = m.userId WHERE m.roomId = ?', [id]);
    const isCreator = room.createdBy === req.user.id;
    res.json({ ...room, members, isCreator });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete a room (creator-only)
app.delete('/api/rooms/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const room = await dbGet('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.createdBy !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await dbRun('DELETE FROM rooms WHERE id = ?', [id]);
    io.to('room:' + id).emit('room:deleted', { id });
    io.emit('rooms:changed', { id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Users list (basic)
app.get('/api/users', authRequired, async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, avatarUrl FROM users');
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Users search (autocomplete by username)
app.get('/api/users/search', authRequired, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    // Basic LIKE search, case-insensitive by default in SQLite when using NOCASE collate
    const like = `%${q.replace(/%/g, '')}%`;
    const users = await dbAll(
      'SELECT id, username, avatarUrl FROM users WHERE username LIKE ? COLLATE NOCASE ORDER BY username ASC LIMIT 20',
      [like]
    );
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Issue a short-lived token to authenticate Socket.io since we use httpOnly cookie for JWT
app.get('/api/token', authRequired, (req, res) => {
  const token = jwt.sign({ id: req.user.id, username: req.user.username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});
// Socket.io for real-time
io.use((socket, next) => {
  // Simple auth via query token (from cookie fallback if needed)
  const { token } = socket.handshake.auth || {};
  try {
    if (!token) return next(new Error('no token'));
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload; // {id, username}
    next();
  } catch (e) {
    next(new Error('invalid token'));
  }
});

io.on('connection', (socket) => {
  // Do not auto-join any room; client will explicitly join/leave

  socket.on('chat:join', async ({ roomId }) => {
    const member = await dbGet('SELECT 1 FROM room_members WHERE roomId = ? AND userId = ?', [roomId, socket.user.id]).catch(()=>null);
    if (!member) return;
    socket.join('room:' + roomId);
  });

  socket.on('chat:leave', ({ roomId }) => {
    socket.leave('room:' + roomId);
  });

  socket.on('chat:newMessage', async (data) => {
    const text = String(data?.text || '').slice(0, 2000);
    const roomId = data?.roomId || 'general';
    const member = await dbGet('SELECT 1 FROM room_members WHERE roomId = ? AND userId = ?', [roomId, socket.user.id]).catch(()=>null);
    if (!member) return;
    const id = uuidv4();
    const timestamp = Date.now();
    await dbRun('INSERT INTO messages (id, roomId, senderId, text, timestamp) VALUES (?, ?, ?, ?, ?)', [id, roomId, socket.user.id, text, timestamp]);
    const u = await dbGet('SELECT username, avatarUrl FROM users WHERE id = ?', [socket.user.id]).catch(()=>null);
    io.to('room:' + roomId).emit('chat:message', { id, roomId, senderId: socket.user.id, text, timestamp, senderName: u?.username || 'Unknown', avatarUrl: u?.avatarUrl || '' });
  });

  socket.on('disconnect', () => { /* presence updates here if desired */ });
});

// Serve frontend build if exists
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
// SPA fallback for any non-API, non-socket request
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  const indexPath = path.join(publicDir, 'index.html');
  res.sendFile(indexPath, (err) => { if (err) next(); });
});

server.listen(PORT, () => {
  console.log(`Sharedo server listening on http://localhost:${PORT}`);
  console.log(`Server access code: ${SERVER_CODE}`);
});
