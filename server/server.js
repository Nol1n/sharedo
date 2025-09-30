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

// Debug: print which Google client ID was loaded (do not print the secret)
console.info('Loaded GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID || '<none>')

// Token encryption key (use a strong key in production)
const TOKEN_ENC_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'dev_token_encryption_key_change_me'
import crypto from 'crypto'
import { geocodeDiskCache } from './geocode_disk_cache.js'

function encryptToken(plain) {
  if (!plain) return ''
  const iv = crypto.randomBytes(12)
  const key = crypto.createHash('sha256').update(TOKEN_ENC_KEY).digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64')
}

function decryptToken(blob) {
  if (!blob) return ''
  if (String(blob).startsWith('enc:')) {
    try {
      const raw = Buffer.from(String(blob).slice(4), 'base64')
      const iv = raw.slice(0, 12)
      const tag = raw.slice(12, 28)
      const data = raw.slice(28)
      const key = crypto.createHash('sha256').update(TOKEN_ENC_KEY).digest()
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      const dec = Buffer.concat([decipher.update(data), decipher.final()])
      return dec.toString('utf8')
    } catch (e) {
      console.error('Failed to decrypt token', e)
      return ''
    }
  }
  // not prefixed -> assume plaintext (will migrate)
  return String(blob)
}

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
    location TEXT DEFAULT NULL,
    place_lat REAL DEFAULT NULL,
    place_lng REAL DEFAULT NULL,
    createdBy TEXT NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(id),
    FOREIGN KEY (ideaId) REFERENCES ideas(id)
  )`);
  // Add google_event_id column to events if missing (stores the Google Calendar event id)
  db.run(`ALTER TABLE events ADD COLUMN google_event_id TEXT DEFAULT NULL`, () => {});
  // Add google_event_synced_at column to events (timestamp of last sync)
  db.run(`ALTER TABLE events ADD COLUMN google_event_synced_at INTEGER DEFAULT NULL`, () => {});
  
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
    replyTo TEXT DEFAULT NULL,
    FOREIGN KEY (roomId) REFERENCES rooms(id),
    FOREIGN KEY (senderId) REFERENCES users(id)
  )`);
  // Add replyTo column for replies if missing (no-op if exists)
  db.run(`ALTER TABLE messages ADD COLUMN replyTo TEXT DEFAULT NULL`, () => {});
  // Add attachments column to messages to store JSON list of attachments
  db.run(`ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT NULL`, () => {});
  
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

  // Reactions on messages/ideas
  db.run(`CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    targetType TEXT CHECK(targetType IN ('message','idea')) NOT NULL,
    targetId TEXT NOT NULL,
    userId TEXT NOT NULL,
    emoji TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  )`);

  // Tags for ideas and events
  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS idea_tags (
    ideaId TEXT NOT NULL,
    tagId TEXT NOT NULL,
    PRIMARY KEY (ideaId, tagId),
    FOREIGN KEY (ideaId) REFERENCES ideas(id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS event_tags (
    eventId TEXT NOT NULL,
    tagId TEXT NOT NULL,
    PRIMARY KEY (eventId, tagId),
    FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
  )`);

  // Checklist items for events
  db.run(`CREATE TABLE IF NOT EXISTS event_checklist (
    id TEXT PRIMARY KEY,
    eventId TEXT NOT NULL,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    createdBy TEXT NOT NULL,
    FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (createdBy) REFERENCES users(id)
  )`);

  // Shopping list items for events
  db.run(`CREATE TABLE IF NOT EXISTS shopping_list (
    id TEXT PRIMARY KEY,
    eventId TEXT NOT NULL,
    item TEXT NOT NULL,
    qty TEXT DEFAULT '1',
    bought INTEGER DEFAULT 0,
    addedBy TEXT NOT NULL,
    FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (addedBy) REFERENCES users(id)
  )`);

  // Polls
  db.run(`CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS poll_options (
    id TEXT PRIMARY KEY,
    pollId TEXT NOT NULL,
    label TEXT NOT NULL,
    FOREIGN KEY (pollId) REFERENCES polls(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS poll_votes (
    pollId TEXT NOT NULL,
    optionId TEXT NOT NULL,
    userId TEXT NOT NULL,
    PRIMARY KEY (pollId, userId),
    FOREIGN KEY (pollId) REFERENCES polls(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES poll_options(id)
  )`);

  // ensure users table has google_refresh_token column
  db.get("PRAGMA table_info(users)", [], (err, row) => {})
  db.run("ALTER TABLE users ADD COLUMN google_refresh_token TEXT", [], (err) => { /* ignore if exists */ })
  // Add optional column for user's selected calendar id
  db.run("ALTER TABLE users ADD COLUMN google_calendar_id TEXT DEFAULT NULL", [], (err) => { /* ignore if exists */ })

  // Ensure events table has location and lat/lng columns for older DBs
  db.run("ALTER TABLE events ADD COLUMN location TEXT DEFAULT NULL", [], (err) => { /* ignore if exists */ })
  db.run("ALTER TABLE events ADD COLUMN place_lat REAL DEFAULT NULL", [], (err) => { /* ignore if exists */ })
  db.run("ALTER TABLE events ADD COLUMN place_lng REAL DEFAULT NULL", [], (err) => { /* ignore if exists */ })

  // Migrate existing plaintext refresh tokens to encrypted form
  dbAll('SELECT id, google_refresh_token FROM users').then(rows => {
    for (const r of rows) {
      if (r.google_refresh_token && !String(r.google_refresh_token).startsWith('enc:')) {
        const enc = encryptToken(r.google_refresh_token)
        dbRun('UPDATE users SET google_refresh_token = ? WHERE id = ?', [enc, r.id]).catch(()=>{})
      }
    }
  }).catch(()=>{})
  
  // Create default General room if it doesn't exist
  db.get('SELECT id FROM rooms WHERE id = ?', ['general'], (err, row) => {
    if (!row) {
      db.run('INSERT INTO rooms (id, name, imageUrl, createdBy) VALUES (?, ?, ?, ?)', 
        ['general', 'General', '', 'system']);
    }
  });

  // Cleanup existing reactions that target ideas (we no longer support reactions on ideas)
  db.run("DELETE FROM reactions WHERE targetType = 'idea'", [], (err) => {
    if (err) console.error('Failed to cleanup idea reactions:', err)
    else console.log('Cleaned up reactions targeting ideas')
  })
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

// Geocode caching & upstream configuration
const geocodeCache = new Map() // in-memory index (mirrors disk cache entries)
const GEOCODE_TTL = 1000 * 60 * 60 // 1 hour
let lastGeocodeFailure = 0
const GEOCODE_COOLDOWN = 1000 * 30 // 30s
const GEOCODE_UPSTREAM = (process.env.GEOCODE_UPSTREAM || 'https://nominatim.openstreetmap.org').split(',').map(s => s.trim()).filter(Boolean)
const RATE_LIMIT_WINDOW = Number(process.env.GEOCODE_RATE_WINDOW_MS || 60_000) // window ms
const RATE_LIMIT_MAX = Number(process.env.GEOCODE_RATE_MAX || 30) // max requests per window per ip
const rateMap = new Map()
const DISABLE_CLIENT_FALLBACK = process.env.DISABLE_CLIENT_GEOCODE_FALLBACK === '1'

// load disk cache into memory async (safe promise chain)
geocodeDiskCache.load().then(() => {
  try {
    for (const [k, v] of geocodeDiskCache.map) geocodeCache.set(k, v)
  } catch (e) { /* ignore */ }
}).catch(()=>{})

// Geocode proxy to obey User-Agent and provide lightweight caching
app.get('/api/geocode', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q || q.length < 2) return res.json([])

    if (lastGeocodeFailure && (Date.now() - lastGeocodeFailure) < GEOCODE_COOLDOWN) {
      // Fast-fail during cooldown to avoid repeated attempts
      return res.status(502).json([])
    }
    const key = q.toLowerCase()
    const now2 = Date.now()
    const cached = geocodeCache.get(key)
    if (cached && (now2 - cached.ts) < GEOCODE_TTL) return res.json(cached.data)

    // Rate limiting per IP
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const bucket = rateMap.get(ip) || { ts: now2, count: 0 }
    if (now2 - bucket.ts > RATE_LIMIT_WINDOW) { bucket.ts = now2; bucket.count = 0 }
    bucket.count++
    rateMap.set(ip, bucket)
    if (bucket.count > RATE_LIMIT_MAX) return res.status(429).json({ error: 'Rate limit exceeded' })

  // Try configured upstreams in order (use jsonv2 + addressdetails for richer results)
  const params = new URLSearchParams({ format: 'jsonv2', q, limit: '8', addressdetails: '1' })
  const ua = process.env.GEOCODE_USER_AGENT || `Sharedo/1.0 (+https://example.com)`
  // include optional email for polite usage (Nominatim recommends contact info)
  if (process.env.GEOCODE_EMAIL) params.set('email', process.env.GEOCODE_EMAIL)
    let lastErr = null
    for (const upstream of GEOCODE_UPSTREAM) {
      // forward user's Accept-Language header when available to improve localized results
      const lang = String(req.headers['accept-language'] || '')
      const url = upstream.replace(/\/$/, '') + '/search?' + params.toString()
      try {
        const headers = { 'User-Agent': ua }
        if (lang) headers['Accept-Language'] = lang
        const r = await fetch(url, { headers, timeout: 10000 })
        if (!r.ok) { lastErr = new Error('upstream-not-ok'); continue }
        const data = await r.json()
        const payload = { ts: Date.now(), data }
        geocodeCache.set(key, payload)
        try { geocodeDiskCache.set(key, payload) } catch(e) {}
        return res.json(data)
      } catch (e) {
        lastErr = e
        // try next upstream
      }
    }
    // All upstreams failed
  lastGeocodeFailure = Date.now()
    // Development-only stub: if explicitly enabled, return a deterministic fake result so developers can test UI locally
    if (process.env.DEV_GEOCODE_STUB === '1' && process.env.NODE_ENV !== 'production') {
      const fake = [{ place_id: 1, display_name: q + ' (dev stub)', lat: '48.8566', lon: '2.3522' }]
      geocodeCache.set(key, { ts: Date.now(), data: fake })
      try { geocodeDiskCache.set(key, { ts: Date.now(), data: fake }) } catch(e) {}
      return res.json(fake)
    }
    if (DISABLE_CLIENT_FALLBACK) return res.status(502).json({ error: 'Upstream geocode unavailable' })
    return res.status(502).json([])
  } catch (e) {
    // silent error: upstream may be unreachable in some environments
    res.status(500).json([])
  }
})

// Register middleware early so routes can use cookies/body
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Checklist endpoints
app.get('/api/events/:id/checklist', authRequired, async (req, res) => {
  try {
    const { id } = req.params
    const rows = await dbAll('SELECT * FROM event_checklist WHERE eventId = ? ORDER BY rowid ASC', [id])
    res.json(rows)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

app.post('/api/events/:id/checklist', authRequired, async (req, res) => {
  try {
    const { id } = req.params
    const { text } = req.body || {}
    if (!text) return res.status(400).json({ error: 'Text required' })
    const nid = uuidv4()
    await dbRun('INSERT INTO event_checklist (id, eventId, text, done, createdBy) VALUES (?, ?, ?, 0, ?)', [nid, id, text, req.user.id])
    const item = await dbGet('SELECT * FROM event_checklist WHERE id = ?', [nid])
    io.emit('event:checklist:changed', { eventId: id })
    res.status(201).json(item)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

app.put('/api/events/:id/checklist/:itemId', authRequired, async (req, res) => {
  try {
    const { itemId } = req.params
    const { text, done } = req.body || {}
    const row = await dbGet('SELECT * FROM event_checklist WHERE id = ?', [itemId])
    if (!row) return res.status(404).json({ error: 'Not found' })
    const nextText = typeof text === 'string' ? text : row.text
    const nextDone = done !== undefined ? (done ? 1 : 0) : row.done
    await dbRun('UPDATE event_checklist SET text = ?, done = ? WHERE id = ?', [nextText, nextDone, itemId])
    const updated = await dbGet('SELECT * FROM event_checklist WHERE id = ?', [itemId])
    io.emit('event:checklist:changed', { eventId: row.eventId })
    res.json(updated)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

app.delete('/api/events/:id/checklist/:itemId', authRequired, async (req, res) => {
  try {
    const { itemId } = req.params
    const row = await dbGet('SELECT * FROM event_checklist WHERE id = ?', [itemId])
    if (!row) return res.status(404).json({ error: 'Not found' })
    await dbRun('DELETE FROM event_checklist WHERE id = ?', [itemId])
    io.emit('event:checklist:changed', { eventId: row.eventId })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

// Shopping list endpoints
app.get('/api/events/:id/shopping', authRequired, async (req, res) => {
  try {
    const { id } = req.params
    const rows = await dbAll('SELECT * FROM shopping_list WHERE eventId = ? ORDER BY rowid ASC', [id])
    res.json(rows)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

app.post('/api/events/:id/shopping', authRequired, async (req, res) => {
  try {
    const { id } = req.params
    const { item, qty = '1' } = req.body || {}
    if (!item) return res.status(400).json({ error: 'Item required' })
    const nid = uuidv4()
    await dbRun('INSERT INTO shopping_list (id, eventId, item, qty, bought, addedBy) VALUES (?, ?, ?, ?, 0, ?)', [nid, id, item, String(qty), req.user.id])
    const row = await dbGet('SELECT * FROM shopping_list WHERE id = ?', [nid])
    io.emit('event:shopping:changed', { eventId: id })
    res.status(201).json(row)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

app.put('/api/events/:id/shopping/:itemId', authRequired, async (req, res) => {
  try {
    const { itemId } = req.params
    const { item, qty, bought } = req.body || {}
    const row = await dbGet('SELECT * FROM shopping_list WHERE id = ?', [itemId])
    if (!row) return res.status(404).json({ error: 'Not found' })
    const nextItem = typeof item === 'string' ? item : row.item
    const nextQty = qty !== undefined ? String(qty) : row.qty
    const nextBought = bought !== undefined ? (bought ? 1 : 0) : row.bought
    await dbRun('UPDATE shopping_list SET item = ?, qty = ?, bought = ? WHERE id = ?', [nextItem, nextQty, nextBought, itemId])
    const updated = await dbGet('SELECT * FROM shopping_list WHERE id = ?', [itemId])
    io.emit('event:shopping:changed', { eventId: row.eventId })
    res.json(updated)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

app.delete('/api/events/:id/shopping/:itemId', authRequired, async (req, res) => {
  try {
    const { itemId } = req.params
    const row = await dbGet('SELECT * FROM shopping_list WHERE id = ?', [itemId])
    if (!row) return res.status(404).json({ error: 'Not found' })
    await dbRun('DELETE FROM shopping_list WHERE id = ?', [itemId])
    io.emit('event:shopping:changed', { eventId: row.eventId })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

// (middleware already registered above)

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

        // IMPORTANT: do NOT auto-login the user here. Account creation should not bypass
        // the PIN/code login flow. Return created user info but do not issue a session
        // token or set a cookie. The client must call /api/login with the server code to
        // obtain an authenticated session.
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
    res.json({ id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl, googleLinked: !!user.google_refresh_token, googleCalendarId: user.google_calendar_id || null });
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

// Development helper: impersonate a user by id (only active in DEV)
app.get('/__dev/impersonate/:id', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).send('Not found')
  const uid = req.params.id
  db.get('SELECT id, username FROM users WHERE id = ?', [uid], (err, user) => {
    if (err) return res.status(500).send('DB error')
    if (!user) return res.status(404).send('No such user')
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' })
    res.json({ ok: true, id: user.id, username: user.username })
  })
})

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

// Reactions: add/remove on messages only (ideas no longer supported)
app.post('/api/reactions', authRequired, async (req, res) => {
  try {
    const { targetType, targetId, emoji } = req.body || {};
    // Only allow reactions on messages now
    if (targetType !== 'message') return res.status(400).json({ error: 'Reactions on this target type are not allowed' });
    if (!targetId || !emoji) return res.status(400).json({ error: 'Missing fields' });
    const id = uuidv4();
    await dbRun('INSERT INTO reactions (id, targetType, targetId, userId, emoji) VALUES (?, ?, ?, ?, ?)', [id, targetType, targetId, req.user.id, emoji]);
    io.emit('reaction:changed', { targetType, targetId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/reactions', authRequired, async (req, res) => {
  try {
    const { targetType, targetId, emoji } = req.body || {};
    if (targetType !== 'message') return res.status(400).json({ error: 'Reactions on this target type are not allowed' });
    await dbRun('DELETE FROM reactions WHERE targetType = ? AND targetId = ? AND userId = ? AND emoji = ?', [targetType, targetId, req.user.id, emoji]);
    io.emit('reaction:changed', { targetType, targetId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

// Tags: list/create and attach to ideas/events
app.get('/api/tags', authRequired, async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM tags'); res.json(rows) } catch (e) { res.status(500).json({ error: 'Database error' }) }
});
app.post('/api/tags', authRequired, async (req, res) => {
  try { const { name } = req.body || {}; if (!name) return res.status(400).json({ error: 'Missing name' }); const id = uuidv4(); await dbRun('INSERT INTO tags (id, name) VALUES (?, ?)', [id, name]); res.json({ id, name }) } catch (e) { res.status(500).json({ error: 'Database error' }) }
});

app.post('/api/ideas/:id/tags', authRequired, async (req, res) => {
  try { const { id } = req.params; const { tagIds } = req.body || {}; if (!Array.isArray(tagIds)) return res.status(400).json({ error: 'Missing tags' }); for (const t of tagIds) await dbRun('INSERT OR IGNORE INTO idea_tags (ideaId, tagId) VALUES (?, ?)', [id, t]); io.emit('ideas:changed', { ideaId: id }); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: 'Database error' }) }
});

app.post('/api/events/:id/tags', authRequired, async (req, res) => {
  try { const { id } = req.params; const { tagIds } = req.body || {}; if (!Array.isArray(tagIds)) return res.status(400).json({ error: 'Missing tags' }); for (const t of tagIds) await dbRun('INSERT OR IGNORE INTO event_tags (eventId, tagId) VALUES (?, ?)', [id, t]); io.emit('event:updated', { id }); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: 'Database error' }) }
});

// Polls: create and vote
app.post('/api/polls', authRequired, async (req, res) => {
  try {
    const { question, options } = req.body || {};
    if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Invalid poll' });
    const id = uuidv4();
    await dbRun('INSERT INTO polls (id, question, createdBy, createdAt) VALUES (?, ?, ?, ?)', [id, question, req.user.id, Date.now()]);
    for (const opt of options) {
      const oid = uuidv4();
      await dbRun('INSERT INTO poll_options (id, pollId, label) VALUES (?, ?, ?)', [oid, id, opt]);
    }
    io.emit('poll:created', { id });
    res.json({ id });
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/polls/:id/vote', authRequired, async (req, res) => {
  try {
    const { id } = req.params; const { optionId } = req.body || {};
    if (!optionId) return res.status(400).json({ error: 'Missing option' });
    await dbRun('INSERT OR REPLACE INTO poll_votes (pollId, optionId, userId) VALUES (?, ?, ?)', [id, optionId, req.user.id]);
    io.emit('poll:changed', { id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

// Export event as ICS
app.get('/api/events/:id/export.ics', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const ev = await dbGet('SELECT * FROM events WHERE id = ?', [id]);
    if (!ev) return res.status(404).json({ error: 'Not found' });
    const start = new Date(ev.date);
    const dtstart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${ev.id}\nDTSTAMP:${dtstart}\nDTSTART:${dtstart}\nSUMMARY:${ev.title}\nDESCRIPTION:${(ev.description||'').replace(/\n/g,'\\n')}\nEND:VEVENT\nEND:VCALENDAR`;
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="event-${ev.id}.ics"`);
    res.send(ics);
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

// Presence: track online users in memory and persistent lastSeen
const online = new Set();
app.get('/api/presence', authRequired, async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, avatarUrl FROM users');
    const result = users.map(u => ({ ...u, online: online.has(u.id) }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Database error' }); }
});

// Client-side error reporter (best-effort, no auth required since errors may occur before auth)
app.post('/api/client-error', express.json(), (req, res) => {
  try {
    const info = req.body || {}
    console.error('[CLIENT ERROR]', JSON.stringify(info, null, 2))
  } catch (e) { console.error('[CLIENT ERROR] malformed payload') }
  res.json({ ok: true })
})

// Google Calendar OAuth integration (optional, requires googleapis and env vars)
let googleClientAvailable = false
let OAuth2Client
try {
  const { google } = await import('googleapis')
  OAuth2Client = google.auth.OAuth2
  googleClientAvailable = true
} catch (e) {
  console.warn('googleapis not available; Google Calendar integration disabled')
}

app.get('/api/google/auth', authRequired, (req, res) => {
  if (!googleClientAvailable) return res.status(501).json({ error: 'Google integration not available on server' })
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
  const url = oauth2.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'], prompt: 'consent', include_granted_scopes: true })
  res.json({ url })
})

app.get('/api/google/callback', authRequired, async (req, res) => {
  if (!googleClientAvailable) return res.status(501).json({ error: 'Google integration not available on server' })
  try {
    const { code } = req.query
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
    const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
    const { tokens } = await oauth2.getToken(String(code))
    // store refresh token (if provided) in users table
    if (tokens.refresh_token) {
      const enc = encryptToken(tokens.refresh_token)
      await dbRun('UPDATE users SET google_refresh_token = ? WHERE id = ?', [enc, req.user.id])
    }
    res.send('<script>window.close()</script>')
  } catch (e) {
    console.error('Google callback error', e)
    // Try to surface Google's error description if available (but never leak secrets)
    let desc = 'Unknown error'
    try { if (e && e.response && e.response.data && e.response.data.error_description) desc = e.response.data.error_description } catch(err){}
    const clientId = process.env.GOOGLE_CLIENT_ID
    const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
    console.error('Google OAuth clientId:', clientId, 'redirect:', redirect)
    res.status(500).send(`<h2>Google auth failed</h2><p>${String(desc)}</p><p>Client ID: ${clientId}</p><p>Redirect URI used: ${redirect}</p>`)
  }
})

app.post('/api/google/disconnect', authRequired, async (req, res) => {
  try {
    await dbRun('UPDATE users SET google_refresh_token = NULL WHERE id = ?', [req.user.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

// Add event to Google Calendar for current user (requires linked account)
app.post('/api/events/:id/googleAdd', authRequired, async (req, res) => {
  if (!googleClientAvailable) return res.status(501).json({ error: 'Google integration not available on server' })
  try {
    const { id } = req.params
    const ev = await dbGet('SELECT * FROM events WHERE id = ?', [id])
    if (!ev) return res.status(404).json({ error: 'Not found' })
    const user = await dbGet('SELECT google_refresh_token FROM users WHERE id = ?', [req.user.id])
    // Debug log: who is calling and whether they have a refresh token
    console.info('[GoogleAdd] user:', req.user && req.user.id, 'event:', id, 'hasRefreshToken:', !!(user && user.google_refresh_token))
    if (!user || !user.google_refresh_token) return res.status(400).json({ error: 'Google not linked' })
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
    const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
    oauth2.setCredentials({ refresh_token: user.google_refresh_token })
    const { google } = await import('googleapis')
    const calendar = google.calendar({ version: 'v3', auth: oauth2 })
    const start = new Date(ev.date)
    const end = new Date(start.getTime() + 60*60*1000)
  const userPref = await dbGet('SELECT google_calendar_id FROM users WHERE id = ?', [req.user.id])
  const calId = (userPref && userPref.google_calendar_id) ? userPref.google_calendar_id : 'primary'
  const insertRes = await calendar.events.insert({ calendarId: calId, requestBody: {
      summary: ev.title,
      description: ev.description || '',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    }})
    // persist the google event id so we can remove or sync later
    try {
      const gid = insertRes.data && insertRes.data.id ? insertRes.data.id : null
      if (gid) await dbRun('UPDATE events SET google_event_id = ? WHERE id = ?', [gid, id])
    } catch(err) { console.error('Failed to persist google event id', err) }
    console.info('[GoogleAdd] success user:', req.user && req.user.id, 'event:', id, 'googleEventId:', insertRes.data && insertRes.data.id)
    res.json({ ok: true, data: insertRes.data })
  } catch (e) { 
    try { console.error('Google add event error message:', e && e.message) } catch(_){}
    try { console.error('Google add event error response data:', e && e.response && e.response.data) } catch(_){}
    console.error('Google add event error', e);
    if (process.env.NODE_ENV !== 'production') {
      const respData = (e && e.response && e.response.data) ? e.response.data : null
      return res.status(500).json({ error: 'Google error', details: respData, message: e && e.message })
    }
    res.status(500).json({ error: 'Google error' }) }
})

// Remove an event previously added to Google Calendar (if linked)
app.post('/api/events/:id/googleRemove', authRequired, async (req, res) => {
  if (!googleClientAvailable) return res.status(501).json({ error: 'Google integration not available on server' })
  try {
    const { id } = req.params
    const ev = await dbGet('SELECT * FROM events WHERE id = ?', [id])
    if (!ev) return res.status(404).json({ error: 'Not found' })
    if (!ev.google_event_id) return res.status(400).json({ error: 'No google event linked' })
  const user = await dbGet('SELECT google_refresh_token FROM users WHERE id = ?', [req.user.id])
  if (!user || !user.google_refresh_token) return res.status(400).json({ error: 'Google not linked' })
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
  const refreshTokenPlain = decryptToken(user.google_refresh_token)
  oauth2.setCredentials({ refresh_token: refreshTokenPlain })
    const { google } = await import('googleapis')
    const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  const userPref = await dbGet('SELECT google_calendar_id FROM users WHERE id = ?', [req.user.id])
  const calId = (userPref && userPref.google_calendar_id) ? userPref.google_calendar_id : 'primary'
  await calendar.events.delete({ calendarId: calId, eventId: ev.google_event_id })
    await dbRun('UPDATE events SET google_event_id = NULL WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) { console.error('Google remove event error', e); res.status(500).json({ error: 'Google error' }) }
})

// Explicitly update a Google event (useful to force resync)
app.post('/api/events/:id/googleUpdate', authRequired, async (req, res) => {
  if (!googleClientAvailable) return res.status(501).json({ error: 'Google integration not available on server' })
  try {
    const { id } = req.params
    const ev = await dbGet('SELECT * FROM events WHERE id = ?', [id])
    if (!ev) return res.status(404).json({ error: 'Not found' })
    if (!ev.google_event_id) return res.status(400).json({ error: 'No google event linked' })
  const user = await dbGet('SELECT google_refresh_token FROM users WHERE id = ?', [req.user.id])
  if (!user || !user.google_refresh_token) return res.status(400).json({ error: 'Google not linked' })
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
  const refreshTokenPlain = decryptToken(user.google_refresh_token)
  oauth2.setCredentials({ refresh_token: refreshTokenPlain })
    const { google } = await import('googleapis')
    const calendar = google.calendar({ version: 'v3', auth: oauth2 })
    const start = new Date(ev.date)
    const end = new Date(start.getTime() + 60*60*1000)
  const userPref = await dbGet('SELECT google_calendar_id FROM users WHERE id = ?', [req.user.id])
  const calId = (userPref && userPref.google_calendar_id) ? userPref.google_calendar_id : 'primary'
  const updateRes = await calendar.events.update({ calendarId: calId, eventId: ev.google_event_id, requestBody: {
      summary: ev.title,
      description: ev.description || '',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    }})
    await dbRun('UPDATE events SET google_event_synced_at = ? WHERE id = ?', [Date.now(), id])
    res.json({ ok: true, data: updateRes.data })
  } catch (e) { console.error('Google update event error', e); res.status(500).json({ error: 'Google error' }) }
})

// List available Google calendars for the current user
app.get('/api/google/calendars', authRequired, async (req, res) => {
  if (!googleClientAvailable) return res.status(501).json({ error: 'Google integration not available on server' })
  try {
    const user = await dbGet('SELECT google_refresh_token FROM users WHERE id = ?', [req.user.id])
    if (!user || !user.google_refresh_token) return res.status(400).json({ error: 'Google not linked' })
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
    const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
    const refreshTokenPlain = decryptToken(user.google_refresh_token)
    oauth2.setCredentials({ refresh_token: refreshTokenPlain })
    const { google } = await import('googleapis')
    const calendar = google.calendar({ version: 'v3', auth: oauth2 })
    const list = await calendar.calendarList.list()
    const items = (list && list.data && list.data.items) ? list.data.items.map(i => ({ id: i.id, summary: i.summary, primary: !!i.primary })) : []
    res.json({ items })
  } catch (e) { console.error('Google calendar list error', e); if (process.env.NODE_ENV !== 'production') { const details = e && e.response && e.response.data ? e.response.data : e.message; return res.status(500).json({ error: 'Google error', details }) } res.status(500).json({ error: 'Google error' }) }
})

// Select a calendar id for the current user (persist preference)
app.post('/api/google/selectCalendar', authRequired, async (req, res) => {
  try {
    const { calendarId } = req.body || {}
    if (!calendarId) return res.status(400).json({ error: 'Missing calendarId' })
    await dbRun('UPDATE users SET google_calendar_id = ? WHERE id = ?', [calendarId, req.user.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

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
    const enriched = await Promise.all(events.map(async (ev) => {
      const withAvail = await withAvailability(ev)
      const checklist = await dbAll('SELECT * FROM event_checklist WHERE eventId = ? ORDER BY rowid ASC', [ev.id])
      const shopping = await dbAll('SELECT * FROM shopping_list WHERE eventId = ? ORDER BY rowid ASC', [ev.id])
      return { ...withAvail, checklist, shopping }
    }))
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Search events (autocomplete) by title/description
app.get('/api/events/search', authRequired, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json([])
    const like = '%' + q.replace(/%/g, '') + '%'
    const rows = await dbAll('SELECT id, title, date, description, ideaId, location, place_lat, place_lng FROM events WHERE title LIKE ? OR description LIKE ? ORDER BY date ASC LIMIT 12', [like, like])
    const enriched = await Promise.all(rows.map(async (r) => {
      let imageUrl = null
      if (r.ideaId) {
        const idea = await dbGet('SELECT imageUrl FROM ideas WHERE id = ?', [r.ideaId])
        if (idea) imageUrl = idea.imageUrl || null
      }
      return { id: r.id, title: r.title, date: r.date, description: r.description, location: r.location, place_lat: r.place_lat, place_lng: r.place_lng, imageUrl }
    }))
    res.json(enriched)
  } catch (e) {
    res.status(500).json({ error: 'Database error' })
  }
})

// Public events list for development (no auth). Disabled in production.
app.get('/api/events/public', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' })
  try {
    const events = await dbAll('SELECT * FROM events ORDER BY date ASC')
    const enriched = await Promise.all(events.map(async (ev) => {
      const withAvail = await withAvailability(ev)
      const checklist = await dbAll('SELECT * FROM event_checklist WHERE eventId = ? ORDER BY rowid ASC', [ev.id])
      const shopping = await dbAll('SELECT * FROM shopping_list WHERE eventId = ? ORDER BY rowid ASC', [ev.id])
      return { ...withAvail, checklist, shopping }
    }))
    res.json(enriched)
  } catch (e) { res.status(500).json({ error: 'Database error' }) }
})

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
    const checklist = await dbAll('SELECT * FROM event_checklist WHERE eventId = ? ORDER BY rowid ASC', [id])
    const shopping = await dbAll('SELECT * FROM shopping_list WHERE eventId = ? ORDER BY rowid ASC', [id])
    res.json({ ...ev, idea, availability, checklist, shopping });
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
    const { title, description = '', date, ideaId = null, location = null, place_lat = null, place_lng = null } = req.body || {};
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
    const id = uuidv4();
    await dbRun('INSERT INTO events (id, title, description, date, ideaId, location, place_lat, place_lng, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, title, description, date, ideaId, location, place_lat, place_lng, req.user.id]);
    const event = { id, title, description, date, ideaId, location, place_lat, place_lng, createdBy: req.user.id };
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
    const { title, description, date, ideaId, location, place_lat, place_lng } = req.body || {};
    const next = {
      title: typeof title === 'string' ? title : row.title,
      description: typeof description === 'string' ? description : row.description,
      date: typeof date === 'string' ? date : row.date,
      ideaId: ideaId !== undefined ? ideaId : row.ideaId,
      location: location !== undefined ? location : row.location,
      place_lat: place_lat !== undefined ? place_lat : row.place_lat,
      place_lng: place_lng !== undefined ? place_lng : row.place_lng
    };
    await dbRun('UPDATE events SET title = ?, description = ?, date = ?, ideaId = ?, location = ?, place_lat = ?, place_lng = ? WHERE id = ?',
      [next.title, next.description, next.date, next.ideaId, next.location, next.place_lat, next.place_lng, id]);
    const payload = await withAvailability({ ...row, ...next });
    // If this event was previously pushed to Google, attempt to update it there as well
    try {
      if (row.google_event_id) {
        const user = await dbGet('SELECT google_refresh_token FROM users WHERE id = ?', [req.user.id]);
        if (user && user.google_refresh_token && googleClientAvailable) {
          const clientId = process.env.GOOGLE_CLIENT_ID
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET
          const redirect = (process.env.SERVER_URL || `http://localhost:${PORT}`) + '/api/google/callback'
          const oauth2 = new OAuth2Client(clientId, clientSecret, redirect)
          const refreshTokenPlain = decryptToken(user.google_refresh_token)
          oauth2.setCredentials({ refresh_token: refreshTokenPlain })
          const { google } = await import('googleapis')
          const calendar = google.calendar({ version: 'v3', auth: oauth2 })
          const start = new Date(next.date)
          const end = new Date(start.getTime() + 60*60*1000)
          const userPref = await dbGet('SELECT google_calendar_id FROM users WHERE id = ?', [req.user.id])
          const calId = (userPref && userPref.google_calendar_id) ? userPref.google_calendar_id : 'primary'
          await calendar.events.update({ calendarId: calId, eventId: row.google_event_id, requestBody: {
            summary: next.title,
            description: next.description || '',
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() }
          }})
          await dbRun('UPDATE events SET google_event_synced_at = ? WHERE id = ?', [Date.now(), id])
          console.info('[GoogleUpdate] updated google event for', id)
        }
      }
    } catch (e) { console.error('[GoogleUpdate] error updating google event', e && e.response && e.response.data ? e.response.data : e.message || e) }
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
    // attach reaction aggregates for each message
    const result = [];
    for (const m of msgs.reverse()) {
      const u = byId.get(m.senderId);
      const aggs = await dbAll('SELECT emoji, COUNT(*) as c FROM reactions WHERE targetType = ? AND targetId = ? GROUP BY emoji', ['message', m.id]);
      const mine = await dbAll('SELECT emoji FROM reactions WHERE targetType = ? AND targetId = ? AND userId = ?', ['message', m.id, req.user.id]);
      const mineSet = new Set(mine.map(r=>r.emoji));
      const reactions = aggs.map(a => ({ emoji: a.emoji, count: a.c, reactedByMe: mineSet.has(a.emoji) }));
      result.push({ ...m, senderName: u?.username || 'Unknown', avatarUrl: u?.avatarUrl || '', reactions });
    }
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
    const limited = msgs.slice(-200);
    const result = [];
    for (const m of limited) {
      const u = byId.get(m.senderId);
      const aggs = await dbAll('SELECT emoji, COUNT(*) as c FROM reactions WHERE targetType = ? AND targetId = ? GROUP BY emoji', ['message', m.id]);
      const mine = await dbAll('SELECT emoji FROM reactions WHERE targetType = ? AND targetId = ? AND userId = ?', ['message', m.id, req.user.id]);
      const mineSet = new Set(mine.map(r=>r.emoji));
      const reactions = aggs.map(a => ({ emoji: a.emoji, count: a.c, reactedByMe: mineSet.has(a.emoji) }));
      let atts = []
      try { atts = m.attachments ? JSON.parse(m.attachments) : [] } catch(e) { atts = [] }
      result.push({ ...m, senderName: u?.username || 'Unknown', avatarUrl: u?.avatarUrl || '', reactions, attachments: atts });
    }
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
    // annotate online status from in-memory set
    const membersWithOnline = members.map(u => ({ ...u, online: online.has(u.id) }));
    const memberIds = members.map(u => u.id);
    res.json({ ...room, members: membersWithOnline, memberIds, isCreator });
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
  // mark online and join personal room for notifications
  try {
    online.add(socket.user.id)
    socket.join(socket.user.id)
    io.emit('presence:changed', { userId: socket.user.id, online: true })
  } catch(e){}
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
    const replyTo = data?.replyTo || null
    const attachments = Array.isArray(data?.attachments) ? data.attachments : []
    const member = await dbGet('SELECT 1 FROM room_members WHERE roomId = ? AND userId = ?', [roomId, socket.user.id]).catch(()=>null);
    if (!member) return;
    const id = uuidv4();
    const timestamp = Date.now();
    await dbRun('INSERT INTO messages (id, roomId, senderId, text, timestamp, replyTo, attachments) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, roomId, socket.user.id, text, timestamp, replyTo, JSON.stringify(attachments || [])]);
    const u = await dbGet('SELECT username, avatarUrl FROM users WHERE id = ?', [socket.user.id]).catch(()=>null);
    const payload = { id, roomId, senderId: socket.user.id, text, timestamp, replyTo, attachments: attachments || [], senderName: u?.username || 'Unknown', avatarUrl: u?.avatarUrl || '' };
    io.to('room:' + roomId).emit('chat:message', payload);
    // Detect mentions like @username and emit notification to mentioned users
    const mentionMatches = Array.from(new Set((text.match(/@([a-zA-Z0-9_\-]+)/g) || []).map(m => m.slice(1))));
    if (mentionMatches.length) {
      const q = '(' + mentionMatches.map(()=>'?').join(',') + ')'
      const rows = await dbAll(`SELECT id, username FROM users WHERE username IN ${q}`, mentionMatches);
      for (const r of rows) {
        io.to(r.id).emit('notification', { type: 'mention', from: socket.user.id, roomId, messageId: id, text });
      }
    }
    // broadcast a general notification for others (toast badge)
    io.emit('notification', { type: 'message', roomId, messageId: id });
  });

  socket.on('disconnect', () => { try { online.delete(socket.user.id); io.emit('presence:changed', { userId: socket.user.id, online: false }) } catch(e){} });
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
