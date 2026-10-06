const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const JWT_SECRET = process.env.JWT_SECRET || 'collaborator-dev-secret-change-me';
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Аутентификация ---------- */
function auth(req, res, next) {
  const token =
    req.cookies.token ||
    (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Сессия истекла' });
  }
}

function setAuthCookie(res, user) {
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, account_type: user.account_type },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return token;
}

/* ---------- Регистрация / вход ---------- */
app.post('/api/register', (req, res) => {
  const { name, email, password, account_type } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });

  const type = account_type === 'teacher' ? 'teacher' : 'student';

  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, account_type) VALUES (?,?,?,?)')
      .run(name, email.toLowerCase(), hash, type);
    const user = db.prepare('SELECT id, name, email, account_type FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = setAuthCookie(res, user);
    res.json({ user, token });
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Неверный email или пароль' });
  const safe = { id: user.id, name: user.name, email: user.email, account_type: user.account_type };
  const token = setAuthCookie(res, safe);
  res.json({ user: safe, token });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user });
});

/* ---------- Шаблоны заданий ---------- */
const TEMPLATES = [
  { id: 'free', title: 'Свободный проект', description: 'Пустой документ для любой темы', roles: ['лидер','исполнитель','критик','секретарь'] },
  { id: 'sociology', title: 'Социологический опрос', description: 'Гипотеза → опрос → анализ → выводы', roles: ['социолог','технолог','аналитик','презентатор'] },
  { id: '3d_model', title: '3D-модель класса', description: 'Совместное моделирование в Tinkercad', roles: ['моделлер мебели','моделлер техники','дизайнер','координатор'] },
  { id: 'newspaper', title: 'Школьная газета', description: 'Вёрстка многостраничного документа', roles: ['главный редактор','журналист','дизайнер','корректор'] },
  { id: 'meme_security', title: 'Мем-серия по безопасности', description: 'Диптих «как не надо» / «как надо»', roles: ['сценарист','дизайнер','исследователь','докладчик'] },
  { id: 'video', title: 'Обучающее видео с субтитрами', description: 'Сценарий → съёмка → монтаж → субтитры', roles: ['сценарист','оператор','диктор','монтажёр'] },
];

app.get('/api/templates', auth, (req, res) => res.json(TEMPLATES));

/* ---------- Проекты ---------- */
app.get('/api/projects', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.name AS owner_name,
      (SELECT COUNT(*) FROM members m WHERE m.project_id = p.id) AS members_count
    FROM projects p
    JOIN users u ON u.id = p.owner_id
    JOIN members mm ON mm.project_id = p.id AND mm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

app.post('/api/projects', auth, (req, res) => {
  const { title, description, template } = req.body || {};
  if (!title || title.trim().length < 2)
    return res.status(400).json({ error: 'Введите название' });
  const tpl = TEMPLATES.find(t => t.id === template) || TEMPLATES[0];

  const info = db.prepare(
    'INSERT INTO projects (title, description, template, owner_id) VALUES (?,?,?,?)'
  ).run(title.trim(), (description || '').trim(), tpl.id, req.user.id);

  const projectId = info.lastInsertRowid;
  db.prepare('INSERT INTO members (project_id, user_id, role) VALUES (?,?,?)')
    .run(projectId, req.user.id, tpl.roles[0] || 'лидер');
  db.prepare('INSERT INTO documents (project_id, content) VALUES (?,?)')
    .run(projectId, defaultDoc(tpl.id, title));

  res.json({ id: projectId });
});

function defaultDoc(template, title) {
  const header = `# ${title}\n\n`;
  switch (template) {
    case 'sociology':
      return header + '## Гипотеза\n\n\n## Вопросы опроса\n\n1. \n2. \n3. \n\n## Данные\n\n\n## Выводы\n\n';
    case '3d_model':
      return header + '## Объекты модели\n\n- \n- \n- \n\n## Масштаб и размеры\n\n\n## Этапы работы\n\n';
    case 'newspaper':
      return header + '## Заголовок номера\n\n\n## Статья 1\n\n\n## Статья 2\n\n\n## Иллюстрации\n\n';
    case 'meme_security':
      return header + '## Кейс нарушения\n\n\n## Мем 1: как НЕ надо\n\n\n## Мем 2: как НАДО\n\n\n## Обоснование\n\n';
    case 'video':
      return header + '## Сценарий\n\n| # | Реплика | Действие на экране |\n|---|---------|--------------------|\n| 1 |         |                    |\n\n## Субтитры\n\n';
    default:
      return header + '## Цель проекта\n\n\n## План работы\n\n1. \n2. \n3. \n\n## Результат\n\n';
  }
}

function getMembership(projectId, userId) {
  return db.prepare('SELECT * FROM members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
}

app.get('/api/projects/:id', auth, (req, res) => {
  const projectId = Number(req.params.id);
  const member = getMembership(projectId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Нет доступа к проекту' });

  const project = db.prepare(`
    SELECT p.*, u.name AS owner_name FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ?
  `).get(projectId);
  const members = db.prepare(`
    SELECT m.role, m.joined_at, u.id AS user_id, u.name, u.email
    FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY m.joined_at
  `).all(projectId);
  const doc = db.prepare('SELECT * FROM documents WHERE project_id = ?').get(projectId);
  const contributions = db.prepare(`
    SELECT c.*, u.name FROM contributions c JOIN users u ON u.id = c.user_id
    WHERE c.project_id = ? ORDER BY c.edits DESC
  `).all(projectId);

  res.json({ project, members, my_role: member.role, document: doc, contributions });
});

/* Добавить участника по email */
app.post('/api/projects/:id/members', auth, (req, res) => {
  const projectId = Number(req.params.id);
  const { email, role } = req.body || {};
  const member = getMembership(projectId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Нет доступа' });

  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь с таким email не найден' });

  try {
    db.prepare('INSERT INTO members (project_id, user_id, role) VALUES (?,?,?)')
      .run(projectId, user.id, role || 'исполнитель');
    res.json({ ok: true, user });
  } catch {
    res.status(409).json({ error: 'Участник уже добавлен' });
  }
});

app.patch('/api/projects/:id/members/:userId', auth, (req, res) => {
  const projectId = Number(req.params.id);
  const targetId = Number(req.params.userId);
  const member = getMembership(projectId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Нет доступа' });
  const { role } = req.body || {};
  db.prepare('UPDATE members SET role = ? WHERE project_id = ? AND user_id = ?')
    .run(role || 'исполнитель', projectId, targetId);
  io.to('project:' + projectId).emit('members_updated');
  res.json({ ok: true });
});

/* Сообщения */
app.get('/api/projects/:id/messages', auth, (req, res) => {
  const projectId = Number(req.params.id);
  if (!getMembership(projectId, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const rows = db.prepare(`
    SELECT m.id, m.text, m.created_at, u.id AS user_id, u.name
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY m.id ASC LIMIT 500
  `).all(projectId);
  res.json(rows);
});

/* ---------- Socket.IO ---------- */
io.use((socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.cookie || '')
        .split('; ')
        .find(c => c.startsWith('token='))?.slice(6);
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.on('join_project', ({ projectId }) => {
    const member = getMembership(Number(projectId), socket.user.id);
    if (!member) return socket.emit('error_msg', 'Нет доступа к проекту');
    socket.join('project:' + projectId);
    socket.data.projectId = Number(projectId);

    io.to('project:' + projectId).emit('presence', {
      userId: socket.user.id,
      name: socket.user.name,
      online: true,
    });
  });

  /* Совместное редактирование документа (упрощённая синхронизация полного содержимого) */
  socket.on('document_edit', ({ projectId, content }) => {
    const pid = Number(projectId);
    const member = getMembership(pid, socket.user.id);
    if (!member) return;

    const prev = db.prepare('SELECT content FROM documents WHERE project_id = ?').get(pid);
    const prevLen = prev?.content?.length || 0;
    const nextLen = (content || '').length;
    const delta = Math.max(0, nextLen - prevLen);

    db.prepare(`UPDATE documents SET content = ?, updated_at = datetime('now'), updated_by = ? WHERE project_id = ?`)
      .run(content || '', socket.user.id, pid);

    /* Учёт вклада */
    if (delta > 0) {
      const existing = db.prepare('SELECT * FROM contributions WHERE project_id = ? AND user_id = ?')
        .get(pid, socket.user.id);
      if (existing) {
        db.prepare(`UPDATE contributions SET edits = edits + 1, chars_added = chars_added + ?, last_edit = datetime('now') WHERE id = ?`)
          .run(delta, existing.id);
      } else {
        db.prepare(`INSERT INTO contributions (project_id, user_id, edits, chars_added, last_edit) VALUES (?,?,?,?,datetime('now'))`)
          .run(pid, socket.user.id, 1, delta);
      }
    }

    socket.to('project:' + pid).emit('document_updated', {
      content: content || '',
      by: socket.user.name,
      byId: socket.user.id,
    });

    const contributions = db.prepare(`
      SELECT c.edits, c.chars_added, c.last_edit, u.id AS user_id, u.name
      FROM contributions c JOIN users u ON u.id = c.user_id
      WHERE c.project_id = ? ORDER BY c.edits DESC
    `).all(pid);
    io.to('project:' + pid).emit('contributions_updated', contributions);
  });

  /* Чат */
  socket.on('chat_message', ({ projectId, text }) => {
    const pid = Number(projectId);
    if (!getMembership(pid, socket.user.id)) return;
    if (!text || !text.trim()) return;

    const info = db.prepare('INSERT INTO messages (project_id, user_id, text) VALUES (?,?,?)')
      .run(pid, socket.user.id, text.trim().slice(0, 2000));

    io.to('project:' + pid).emit('new_message', {
      id: info.lastInsertRowid,
      project_id: pid,
      user_id: socket.user.id,
      name: socket.user.name,
      text: text.trim(),
      created_at: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    if (socket.data.projectId) {
      io.to('project:' + socket.data.projectId).emit('presence', {
        userId: socket.user.id,
        name: socket.user.name,
        online: false,
      });
    }
  });
});

process.on('uncaughtException', e => console.error('uncaught:', e));
process.on('unhandledRejection', e => console.error('unhandled:', e));

/* JSON-ответ вместо HTML при ошибке */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера: ' + err.message });
});

server.listen(PORT, () => {
  console.log(`Коллаборатор запущен на http://localhost:${PORT}`);
});