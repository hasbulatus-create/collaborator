/* ============ Клиент платформы «Коллаборатор» ============ */

const app = document.getElementById('app');
let socket = null;
let state = {
  user: null,
  projects: [],
  currentProject: null,
  members: [],
  contributions: [],
  messages: [],
  docContent: '',
  myRole: '',
  activeTab: 'doc',
  templates: [],
};

const api = {
  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  },
  get(url) { return this.req('GET', url); },
  post(url, body) { return this.req('POST', url, body); },
  patch(url, body) { return this.req('PATCH', url, body); },
};

/* ---------- Инициализация ---------- */
async function init() {
  try {
    const { user } = await api.get('/api/me');
    state.user = user;
    await loadTemplates();
    await loadProjects();
    renderDashboard();
  } catch {
    renderAuth();
  }
}

async function loadTemplates() {
  state.templates = await api.get('/api/templates');
}

async function loadProjects() {
  state.projects = await api.get('/api/projects');
}

/* ---------- Экраны ---------- */
function renderAuth(mode = 'login') {
  app.innerHTML = `
    <div class="auth-wrap">
      <h1>Коллаборатор</h1>
      <p class="sub">Совместная проектная работа школьников в цифровой среде</p>
      <form id="auth-form">
        ${mode === 'register' ? `
          <label>Имя и фамилия</label>
          <input name="name" required />
          <label>Тип аккаунта</label>
          <select name="account_type">
            <option value="student">Ученик</option>
            <option value="teacher">Учитель</option>
          </select>
        ` : ''}
        <label>Email</label>
        <input name="email" type="email" required />
        <label>Пароль</label>
        <input name="password" type="password" required minlength="6" />
        <button class="btn full" type="submit">${mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        <div id="auth-msg"></div>
        <div class="switch-line">
          ${mode === 'login'
            ? `Нет аккаунта? <button type="button" id="to-register">Создать</button>`
            : `Уже есть аккаунт? <button type="button" id="to-login">Войти</button>`}
        </div>
      </form>
    </div>
  `;

  document.getElementById('to-register')?.addEventListener('click', () => renderAuth('register'));
  document.getElementById('to-login')?.addEventListener('click', () => renderAuth('login'));

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const msg = document.getElementById('auth-msg');
    try {
      const url = mode === 'login' ? '/api/login' : '/api/register';
      const res = await api.post(url, body);
      state.user = res.user;
      localStorage.setItem('token', res.token);
      await loadTemplates();
      await loadProjects();
      renderDashboard();
    } catch (err) {
      msg.className = 'msg-error';
      msg.textContent = err.message;
    }
  });
}

function renderDashboard() {
  app.innerHTML = `
    ${topbar()}
    <div class="container">
      <div class="section-title">
        <h2>Мои проекты</h2>
        <button class="btn" id="new-project">+ Новый проект</button>
      </div>
      <div id="projects-list" class="grid"></div>
    </div>
  `;
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('new-project').addEventListener('click', openNewProjectModal);
  renderProjectsList();
}

function topbar() {
  return `
    <div class="topbar">
      <div class="brand">Коллаборатор</div>
      <div class="user">
        <span>${escapeHtml(state.user.name)}</span>
        <span class="badge">${state.user.account_type === 'teacher' ? 'учитель' : 'ученик'}</span>
        <button class="btn ghost small" id="logout">Выйти</button>
      </div>
    </div>
  `;
}

function renderProjectsList() {
  const wrap = document.getElementById('projects-list');
  if (!state.projects.length) {
    wrap.outerHTML = `<div class="empty card">Пока нет проектов. Создайте первый!</div>`;
    return;
  }
  wrap.innerHTML = state.projects.map(p => `
    <div class="card">
      <h3>${escapeHtml(p.title)}</h3>
      <div class="meta">Автор: ${escapeHtml(p.owner_name)} · участников: ${p.members_count}</div>
      <div>${escapeHtml((p.description || '').slice(0, 120))}</div>
      <div class="actions">
        <button class="btn small" data-open="${p.id}">Открыть</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openProject(Number(btn.dataset.open)));
  });
}

function openNewProjectModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Новый проект</h3>
      <label>Название</label>
      <input id="np-title" placeholder="Например, Социологический опрос" />
      <label>Краткое описание</label>
      <textarea id="np-desc" rows="2" placeholder="Цель и суть проекта"></textarea>
      <label>Шаблон</label>
      <select id="np-template">
        ${state.templates.map(t => `<option value="${t.id}">${escapeHtml(t.title)} — ${escapeHtml(t.description)}</option>`).join('')}
      </select>
      <div class="actions">
        <button class="btn ghost" id="np-cancel">Отмена</button>
        <button class="btn" id="np-create">Создать</button>
      </div>
      <div id="np-msg"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#np-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('#np-create').addEventListener('click', async () => {
    const title = backdrop.querySelector('#np-title').value.trim();
    const description = backdrop.querySelector('#np-desc').value.trim();
    const template = backdrop.querySelector('#np-template').value;
    if (!title) return;
    try {
      const { id } = await api.post('/api/projects', { title, description, template });
      backdrop.remove();
      await loadProjects();
      openProject(id);
    } catch (e) {
      backdrop.querySelector('#np-msg').innerHTML = `<div class="msg-error">${escapeHtml(e.message)}</div>`;
    }
  });
}

/* ---------- Просмотр проекта ---------- */
async function openProject(id) {
  const data = await api.get('/api/projects/' + id);
  state.currentProject = data.project;
  state.members = data.members;
  state.contributions = data.contributions;
  state.myRole = data.my_role;
  state.docContent = data.document?.content || '';
  state.messages = await api.get(`/api/projects/${id}/messages`);
  state.activeTab = 'doc';

  connectSocket(id);
  renderProject();
}

function connectSocket(projectId) {
  if (socket) socket.disconnect();
  const token = localStorage.getItem('token');
  socket = io({ auth: { token } });

  socket.on('connect', () => {
    socket.emit('join_project', { projectId });
  });

  socket.on('document_updated', ({ content, by }) => {
    const editor = document.getElementById('editor');
    if (editor && document.activeElement !== editor) {
      state.docContent = content;
      editor.value = content;
    }
    flash(`✏️ ${by} обновил(а) документ`);
  });

  socket.on('contributions_updated', (rows) => {
    state.contributions = rows;
    if (state.activeTab === 'progress') renderProgressTab();
  });

  socket.on('new_message', (msg) => {
    state.messages.push(msg);
    if (state.activeTab === 'chat') appendMessage(msg);
  });

  socket.on('members_updated', async () => {
    const data = await api.get('/api/projects/' + projectId);
    state.members = data.members;
    if (state.activeTab === 'members') renderMembersTab();
  });

  socket.on('presence', ({ userId, name, online }) => {
    flash(`${online ? '🟢' : '⚪'} ${name} ${online ? 'в сети' : 'вышел(ла)'}`);
  });

  socket.on('error_msg', (m) => alert(m));
}

function renderProject() {
  const p = state.currentProject;
  app.innerHTML = `
    ${topbar()}
    <div class="container">
      <div class="project-header">
        <div>
          <h1>${escapeHtml(p.title)}</h1>
          <div class="desc">${escapeHtml(p.description || '')}</div>
          <div class="hint">Ваша роль: <span class="badge">${escapeHtml(state.myRole)}</span></div>
        </div>
        <button class="btn ghost" id="back">← К проектам</button>
      </div>
      <div class="tabs">
        ${tabBtn('doc', '📄 Документ')}
        ${tabBtn('chat', '💬 Чат')}
        ${tabBtn('members', '👥 Участники')}
        ${tabBtn('progress', '📊 Прогресс')}
      </div>
      <div id="tab-content"></div>
    </div>
  `;
  document.getElementById('back').addEventListener('click', () => {
    if (socket) socket.disconnect();
    renderDashboard();
  });
  document.querySelectorAll('.tabs button').forEach(b => {
    b.addEventListener('click', () => {
      state.activeTab = b.dataset.tab;
      renderProject();
    });
  });
  renderTabContent();
}

function tabBtn(id, label) {
  return `<button data-tab="${id}" class="${state.activeTab === id ? 'active' : ''}">${label}</button>`;
}

function renderTabContent() {
  const el = document.getElementById('tab-content');
  if (state.activeTab === 'doc') el.innerHTML = editorTabHtml();
  if (state.activeTab === 'chat') { el.innerHTML = chatTabHtml(); bindChat(); }
  if (state.activeTab === 'members') { el.innerHTML = membersTabHtml(); bindMembers(); }
  if (state.activeTab === 'progress') { el.innerHTML = progressTabHtml(); }
  if (state.activeTab === 'doc') bindEditor();
}

/* --- Вкладка «Документ» --- */
function editorTabHtml() {
  return `
    <div class="workspace">
      <div>
        <textarea id="editor" class="editor" placeholder="Начните писать...">${escapeHtml(state.docContent)}</textarea>
        <div class="hint">Изменения синхронизируются автоматически. Вклад каждого участника учитывается.</div>
      </div>
      <div class="card">
        <h3>👥 Онлайн</h3>
        <div id="presence-list" class="list">${state.members.map(m => `
          <div class="list-row"><span>${escapeHtml(m.name)}</span><span class="role">${escapeHtml(m.role)}</span></div>
        `).join('')}</div>
        <div class="hint">Работайте вместе: обсуждайте текст в чате, распределяйте разделы по ролям.</div>
      </div>
    </div>
  `;
}

let editorTimer = null;
function bindEditor() {
  const editor = document.getElementById('editor');
  if (!editor) return;
  editor.addEventListener('input', () => {
    state.docContent = editor.value;
    clearTimeout(editorTimer);
    editorTimer = setTimeout(() => {
      socket?.emit('document_edit', {
        projectId: state.currentProject.id,
        content: editor.value,
      });
    }, 400);
  });
}

/* --- Вкладка «Чат» --- */
function chatTabHtml() {
  return `
    <div class="card">
      <div class="chat-box">
        <div class="chat-messages" id="chat-messages"></div>
        <form class="chat-form" id="chat-form">
          <input id="chat-input" placeholder="Написать сообщение..." autocomplete="off" />
          <button class="btn" type="submit">Отправить</button>
        </form>
      </div>
    </div>
  `;
}

function appendMessage(m) {
  const list = document.getElementById('chat-messages');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="who">${escapeHtml(m.name)}:</span>${escapeHtml(m.text)}<span class="when">${formatTime(m.created_at)}</span>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function bindChat() {
  const list = document.getElementById('chat-messages');
  state.messages.forEach(appendMessage);
  if (list) list.scrollTop = list.scrollHeight;

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat_message', { projectId: state.currentProject.id, text });
    input.value = '';
  });
}

/* --- Вкладка «Участники» --- */
function membersTabHtml() {
  return `
    <div class="card">
      <h3>Участники проекта</h3>
      <div class="list">${state.members.map(m => `
        <div class="list-row">
          <div>
            <b>${escapeHtml(m.name)}</b>
            <div class="role">${escapeHtml(m.email)}</div>
          </div>
          <div>
            <select data-uid="${m.user_id}" class="role-select">
              ${['лидер','исполнитель','критик','секретарь','докладчик','социолог','технолог','аналитик','презентатор','дизайнер','сценарист','монтажёр']
                .map(r => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
        </div>
      `).join('')}</div>
      <h3 style="margin-top:20px">Пригласить участника</h3>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input id="invite-email" placeholder="email@example.com" style="flex:1" />
        <input id="invite-role" placeholder="роль" value="исполнитель" style="width:150px" />
        <button class="btn" id="invite-btn">Добавить</button>
      </div>
      <div id="invite-msg" class="hint"></div>
    </div>
  `;
}

function bindMembers() {
  document.querySelectorAll('.role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const uid = Number(sel.dataset.uid);
      await api.patch(`/api/projects/${state.currentProject.id}/members/${uid}`, { role: sel.value });
      flash('Роль обновлена');
    });
  });

  document.getElementById('invite-btn').addEventListener('click', async () => {
    const email = document.getElementById('invite-email').value.trim();
    const role = document.getElementById('invite-role').value.trim() || 'исполнитель';
    const msg = document.getElementById('invite-msg');
    try {
      await api.post(`/api/projects/${state.currentProject.id}/members`, { email, role });
      msg.className = 'msg-info';
      msg.textContent = 'Участник добавлен';
      const data = await api.get('/api/projects/' + state.currentProject.id);
      state.members = data.members;
      renderMembersTab();
    } catch (e) {
      msg.className = 'msg-error';
      msg.textContent = e.message;
    }
  });
}

function renderMembersTab() {
  document.getElementById('tab-content').innerHTML = membersTabHtml();
  bindMembers();
}

/* --- Вкладка «Прогресс» --- */
function progressTabHtml() {
  const totalEdits = state.contributions.reduce((s, c) => s + c.edits, 0) || 1;
  return `
    <div class="card">
      <h3>Вклад участников</h3>
      ${state.contributions.length === 0
        ? `<div class="empty">Пока нет данных. Начните редактировать документ.</div>`
        : state.contributions.map(c => {
            const pct = Math.round((c.edits / totalEdits) * 100);
            return `
              <div style="margin-bottom:14px">
                <div style="display:flex; justify-content:space-between; font-size:14px;">
                  <b>${escapeHtml(c.name)}</b>
                  <span class="badge">${c.edits} правок · ${c.chars_added} симв.</span>
                </div>
                <div class="progress-bar"><span style="width:${pct}%"></span></div>
                <div class="hint">Последняя правка: ${c.last_edit ? formatTime(c.last_edit) : '—'}</div>
              </div>
            `;
          }).join('')}
    </div>
  `;
}
function renderProgressTab() {
  if (state.activeTab === 'progress') {
    document.getElementById('tab-content').innerHTML = progressTabHtml();
  }
}

/* ---------- Утилиты ---------- */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[s]));
}

function formatTime(iso) {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

let flashTimer = null;
function flash(text) {
  let el = document.getElementById('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2233;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:100;box-shadow:0 10px 30px rgba(0,0,0,.2)';
    document.body.appendChild(el);
  }
  el.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.remove(), 2500);
}

async function logout() {
  await api.post('/api/logout');
  localStorage.removeItem('token');
  if (socket) socket.disconnect();
  state.user = null;
  renderAuth();
}

init();