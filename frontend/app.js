const API_URL = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000';
let token = localStorage.getItem('token');
let currentUser = null;
let tasks = [];
let currentFilter = 'all';
let ws = null;

// Auth
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.auth-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById('login-form').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'flex' : 'none';
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('register-username').value;
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  try {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  ws?.close();
  document.getElementById('auth-section').style.display = 'flex';
  document.getElementById('app-section').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-section').style.display = 'none';
  document.getElementById('app-section').style.display = 'block';
  document.getElementById('username-display').textContent = currentUser.username;
  document.getElementById('task-input').value = '';
  document.getElementById('task-desc').value = '';
  connectWebSocket();
  fetchTasks();
}

// WebSocket
function connectWebSocket() {
  if (ws) ws.close();
  ws = new WebSocket(WS_URL);
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'task_created':
        tasks.unshift(data.task);
        break;
      case 'task_updated':
        tasks = tasks.map(t => t.id === data.task.id ? data.task : t);
        break;
      case 'task_deleted':
        tasks = tasks.filter(t => t.id !== data.taskId);
        break;
    }
    renderTasks();
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 3000);
  };
}

// Tasks
async function fetchTasks() {
  try {
    const res = await fetch(`${API_URL}/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    tasks = await res.json();
    renderTasks();
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
  }
}

async function addTask() {
  const titleInput = document.getElementById('task-input');
  const descInput = document.getElementById('task-desc');
  const title = titleInput.value.trim();
  if (!title) return;

  try {
    const res = await fetch(`${API_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ title, description: descInput.value.trim() })
    });
    if (res.ok) {
      titleInput.value = '';
      descInput.value = '';
    }
  } catch (err) {
    console.error('Failed to add task:', err);
  }
}

async function updateTaskStatus(id, status) {
  try {
    await fetch(`${API_URL}/tasks/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status })
    });
  } catch (err) {
    console.error('Failed to update task:', err);
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await fetch(`${API_URL}/tasks/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    console.error('Failed to delete task:', err);
  }
}

async function editTask(id) {
  const task = tasks.find(t => t.id === id);
  const newTitle = prompt('Edit task title:', task.title);
  if (newTitle && newTitle.trim() !== task.title) {
    try {
      await fetch(`${API_URL}/tasks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle.trim() })
      });
    } catch (err) {
      console.error('Failed to edit task:', err);
    }
  }
}

function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderTasks();
}

function renderTasks() {
  const container = document.getElementById('tasks-container');
  let filtered = tasks;
  
  if (currentFilter !== 'all') {
    filtered = tasks.filter(t => t.status === currentFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks found. Add one above!</div>';
    return;
  }

  container.innerHTML = filtered.map(task => {
    const statusClass = task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : '';
    const statusLabel = task.status === 'in_progress' ? 'In Progress' : task.status.charAt(0).toUpperCase() + task.status.slice(1);
    const created = new Date(task.created_at).toLocaleDateString();
    
    return `
      <div class="task-card ${statusClass}">
        <div class="task-header">
          <div class="task-title">${escapeHtml(task.title)}</div>
        </div>
        ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">${statusLabel} · Created ${created}</div>
        <div class="task-actions">
          ${task.status !== 'in_progress' ? `<button class="btn-status in-progress" onclick="updateTaskStatus(${task.id}, 'in_progress')">In Progress</button>` : ''}
          ${task.status !== 'completed' ? `<button class="btn-status complete" onclick="updateTaskStatus(${task.id}, 'completed')">Complete</button>` : ''}
          ${task.status !== 'pending' ? `<button class="btn-status" onclick="updateTaskStatus(${task.id}, 'pending')">Pending</button>` : ''}
          <button class="btn-edit" onclick="editTask(${task.id})">Edit</button>
          <button class="btn-delete" onclick="deleteTask(${task.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Check for existing token on load
if (token) {
  // Try to validate by fetching tasks
  fetch(`${API_URL}/tasks`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(res => {
    if (res.ok) {
      // Decode token to get user info
      const payload = JSON.parse(atob(token.split('.')[1]));
      currentUser = { id: payload.id, username: payload.username };
      showApp();
    } else {
      localStorage.removeItem('token');
    }
  }).catch(() => {
    localStorage.removeItem('token');
  });
}

// Keyboard shortcut
document.getElementById('task-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addTask();
});