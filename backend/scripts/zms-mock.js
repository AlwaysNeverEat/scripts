// ─────────────────────────────────────────────────────────────────────────────
// Мок оригинальной админки записей ZMS для разработки и e2e-проверки клона.
// Отдаёт ту же разметку, что и настоящая /admin/record (см. фикстуру
// shared/__fixtures__/admin-record-page.html), умеет логин по форме,
// создание/правку/удаление записей и «падение» по флагу.
//
// Запуск:  node backend/scripts/zms-mock.js   (порт 3999)
// Бэкенд:  ZMS_ADMIN_BASE_URL=http://127.0.0.1:3999
// Логин/пароль мока: admin / spot123
//
// Управление:
//   POST /__mock/down  {"down":true|false}  — эмулировать падение админки
//   GET  /__mock/records                    — дамп записей (для проверок)
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import multer from 'multer';

const PORT = Number(process.env.ZMS_MOCK_PORT) || 3999;
const LOGIN = 'admin';
const PASSWORD = 'spot123';

const ADDRESSES = [
    { id: '3', title: 'СПб, Оптиков 2', boxes: 3 },
    { id: '8', title: 'СПб, Выборгское шоссе 2', boxes: 2 },
    { id: '192', title: 'СПБ, Ветеранов 167 к.8 СПОТ', boxes: 1 },
];

const HOURS = { from: 9, to: 22 }; // строки сетки: 09:00 … 22:30

function today(offsetDays = 0) {
    const parts = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(new Date(Date.now() + offsetDays * 86_400_000));
    const get = (t) => parts.find(p => p.type === t)?.value;
    return `${get('day')}.${get('month')}.${get('year')}`;
}

function addMin(t, d) {
    const [h, m] = t.split(':').map(Number);
    const total = h * 60 + m + d;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ── Состояние ────────────────────────────────────────────────────────────────

let down = false;
let nextId = 500000;
const records = new Map(); // id → {id, addressId, date, time, name, phone, carNumber, comment, status}

function seed() {
    const d = today(0);
    const add = (addressId, time, name, phone, status = '') => {
        const id = String(nextId++);
        records.set(id, { id, addressId, date: d, time, name, phone, carNumber: '', comment: '', status });
    };
    add('3', '09:00', 'Сергей двс', '+7(921) 756-18-03', 'checked');
    add('3', '09:00', 'Дмитрий', '+7 (931) 531-72-66', 'checked');
    // Продлённая запись: 10:00 настоящая + два слота-заглушки встык
    add('8', '10:00', 'Иван Продлённый', '+7 (921) 111-22-33', 'new');
    add('8', '10:30', 'Иван Продлённый', '+71111111111');
    add('8', '11:00', 'Иван Продлённый', '+71111111111');
    add('192', '12:00', 'Клиент Ветеранова', '+7 (900) 000-11-22', 'late');
}
seed();

// ── HTML ─────────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loginPage() {
    return `<!DOCTYPE html><html><head><title>Вход</title></head><body>
    <form action="/admin/auth/login" method="post">
        <input type="hidden" name="csrf" value="mock-csrf-token">
        <input type="text" name="username" placeholder="Логин">
        <input type="password" name="password" placeholder="Пароль">
        <button type="submit">Войти</button>
    </form></body></html>`;
}

function markerFor(status) {
    if (status === 'checked') return `<div class="checked" title="Клиент приехал."><svg class="checked"><use href="/static/images/admin-record.svg#admin-record"></use></svg></div></div>`;
    if (status === 'late') return `<div class="too-late" title="Клиент не приехал."><svg class="too-late"><use href="/static/images/admin-record.svg#admin-record"></use></svg></div></div>`;
    if (status === 'new') return `<div class="is-new" title="Новая запись."><svg class="is-new"><use href="/static/images/admin-record.svg#admin-record"></use></svg></div></div>`;
    return '';
}

function recordBlock(r) {
    const end = addMin(r.time, 30);
    const encTime = `${r.date}+${r.time.replace(':', '%3A')}`;
    return `${markerFor(r.status)}<div class="address_id_${r.addressId} r-stat-head" style="padding:2px 5px;">${r.time}-${end}                <br/>
                <a href="/admin/record/edit?id=${r.id}">изменить</a>
                <a href="/admin/record/delete?id=${r.id}&time=${encTime}&address_id=${r.addressId}"
                   onclick="return deleteConfirm();">удалить</a>
                <br/>
                ${esc(r.name)} / ${esc(r.phone)} /</div>`;
}

function boardPage(date) {
    const ths = ADDRESSES.map(a => `                					<th id="address_id_${a.id}">${esc(a.title)}</th>`).join('\n');
    const rows = [];
    for (let h = HOURS.from; h <= HOURS.to; h++) {
        for (const half of [0, 30]) {
            const time = `${String(h).padStart(2, '0')}:${half === 0 ? '00' : '30'}`;
            const cells = ADDRESSES.map(a => {
                const recs = [...records.values()].filter(r =>
                    r.addressId === a.id && r.date === date && r.time === time);
                const freeBoxes = Math.max(0, a.boxes - recs.length);
                const encTime = `${date}+${time.replace(':', '%3A')}`;
                let inner = recs.map(recordBlock).join('');
                for (let i = 0; i < freeBoxes; i++) {
                    inner += `\n                <a href="/admin/record/create?time=${encTime}&address_id=${a.id}">Добавить</a>`;
                }
                return `<td class="time-cell">${inner}</td>`;
            }).join('');
            rows.push(half === 0
                ? `            				<tr data-time="${h}">
					<td>${time}						<hr class="r-marck" />
					</td>
                    ${cells}
				</tr>`
                : `                				<tr>
                    <td>${time}</td>
                    ${cells}
                </tr>`);
        }
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Панель управления</title></head><body>
	<div class="r-main-content">
		<table id="r-stat-table">
			<tr>
				<th></th>
${ths}
            			</tr>
${rows.join('\n')}
        </table>
    </div>
    <script>function deleteConfirm() { return confirm("Вы действительно хотите удалить запись?"); }</script>
</body></html>`;
}

function editPage(r) {
    return `<!DOCTYPE html><html><body>
    <form class="edit-record-form" action="/admin/record/update" method="post">
        <input type="hidden" name="id" value="${r.id}">
        <select name="address_id">${ADDRESSES.map(a =>
            `<option value="${a.id}"${a.id === r.addressId ? ' selected' : ''}>${esc(a.title)}</option>`).join('')}</select>
        <select name="date"><option selected value="${r.date}">${r.date}</option></select>
        <select name="time"><option selected value="${r.time}">${r.time}</option></select>
        <input type="text" name="name" value="${esc(r.name)}">
        <input type="text" name="phone" value="${esc(r.phone)}">
        <input type="text" name="car_number" value="${esc(r.carNumber)}">
        <textarea name="comment">${esc(r.comment)}</textarea>
        <input type="hidden" name="back" value="/admin/record">
        <button type="submit">Сохранить</button>
    </form></body></html>`;
}

// ── Сервер ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: false }));

// Флаг падения: любой /admin и /jsApi отвечает 503.
app.use((req, res, next) => {
    if (down && !req.path.startsWith('/__mock')) return res.status(503).send('Service Unavailable');
    next();
});

const SESSION_COOKIE = 'mock_session=ok';
const authed = (req) => (req.headers.cookie || '').includes(SESSION_COOKIE);

app.post('/admin/auth/login', (req, res) => {
    if (req.body.username === LOGIN && req.body.password === PASSWORD && req.body.csrf === 'mock-csrf-token') {
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}; Path=/`);
        return res.redirect(302, '/admin/record');
    }
    res.status(200).send(loginPage());
});

app.get('/admin/record', (req, res) => {
    if (!authed(req)) return res.send(loginPage());
    res.send(boardPage(String(req.query.date || today(0))));
});

app.get('/admin/record/edit', (req, res) => {
    if (!authed(req)) return res.send(loginPage());
    const r = records.get(String(req.query.id));
    if (!r) return res.status(404).send('<html>нет такой записи</html>');
    res.send(editPage(r));
});

app.post('/admin/record/update', multer().none(), (req, res) => {
    if (!authed(req)) return res.send(loginPage());
    const b = req.body;
    const id = String(b.id || '').trim();
    const rec = {
        id: id || String(nextId++),
        addressId: String(b.address_id),
        date: String(b.date),
        time: String(b.time),
        name: String(b.name || ''),
        phone: String(b.phone || ''),
        carNumber: String(b.car_number || ''),
        comment: String(b.comment || ''),
        status: id ? (records.get(id)?.status || '') : '',
    };
    records.set(rec.id, rec);
    res.redirect(302, String(b.back || '/admin/record'));
});

app.get('/admin/record/delete', (req, res) => {
    if (!authed(req)) return res.send(loginPage());
    records.delete(String(req.query.id));
    res.redirect(302, '/admin/record');
});

app.post('/jsApi/serviceTimes', (req, res) => {
    if (!authed(req)) return res.status(302).redirect('/admin/record');
    const addressId = String(req.query.addressId);
    const day = String(req.query.day || '').slice(0, 10); // YYYY-MM-DD
    const date = day.split('-').reverse().join('.');
    const addr = ADDRESSES.find(a => a.id === addressId);
    const out = [];
    for (let h = HOURS.from; h <= HOURS.to; h++) {
        for (const half of ['00', '30']) {
            const time = `${String(h).padStart(2, '0')}:${half}`;
            const booked = [...records.values()]
                .filter(r => r.addressId === addressId && r.date === date && r.time === time).length;
            // Инвертированная семантика оригинала: isAvailable=false — СВОБОДНО
            out.push({ time, isAvailable: booked >= (addr?.boxes || 1) });
        }
    }
    res.json(out);
});

// ── Управление моком ─────────────────────────────────────────────────────────

app.use(express.json());

app.post('/__mock/down', (req, res) => {
    down = Boolean(req.body?.down);
    res.json({ down });
});

app.get('/__mock/records', (_req, res) => {
    res.json({ down, records: [...records.values()] });
});

app.listen(PORT, '127.0.0.1', () =>
    console.log(`zms-mock на http://127.0.0.1:${PORT} (логин ${LOGIN}/${PASSWORD})`));
