const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'task-manager-secret-key-2024';
const DB_PATH = path.join(__dirname, 'tasks.db');

app.use(cors());
app.use(express.json());

let db;
let clients = new Set();
let wss;

async function initDb() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  saveDb();
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// WebSocket setup
const server = http.createServer(app);
wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
}

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Helper to get single row
function getRow(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    cols.forEach((col, i) => row[col] = vals[i]);
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Helper to get all rows
function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    cols.forEach((col, i) => row[col] = vals[i]);
    rows.push(row);
  }
  stmt.free();
  return rows;
}

// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const existing = getRow('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const hashed = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed]);
    saveDb();
    
    const user = getRow('SELECT * FROM users WHERE username = ?', [username]);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = getRow('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Task routes
app.get('/api/tasks', auth, (req, res) => {
  const tasks = getAll('SELECT * FROM tasks WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id]);
  res.json(tasks);
});

app.post('/api/tasks', auth, (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  
  db.run('INSERT INTO tasks (user_id, title, description) VALUES (?, ?, ?)', 
    [req.user.id, title, description || '']);
  saveDb();
  
  const task = getRow('SELECT * FROM tasks WHERE id = last_insert_rowid()');
  
  broadcast({ type: 'task_created', task });
  res.status(201).json(task);
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const { title, description, status } = req.body;
  const task = getRow('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  const updates = [];
  const params = [];
  
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user.id);
  
  db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);
  saveDb();
  
  const updated = getRow('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  broadcast({ type: 'task_updated', task: updated });
  res.json(updated);
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const task = getRow('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  saveDb();
  
  broadcast({ type: 'task_deleted', taskId: parseInt(req.params.id) });
  res.json({ message: 'Task deleted' });
});

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});