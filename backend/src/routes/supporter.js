// ─────────────────────────────────────────────────────────────────────────────
// Подписка «supp»: состояние, настройки темы и выдача.
//
// Деньги через сайт НЕ ходят и в обозримом будущем ходить не будут: подписку
// оплачивают переводом, а выдаёт её руками владелец (backend/src/supporter/badge.js,
// OWNER_LOGIN). Поэтому здесь нет ни платёжного шлюза, ни вебхуков, ни ключей
// эквайринга — есть журнал выдач и одна кнопка «выдать месяц».
//
// Кто выдаёт — проверяется НА СЕРВЕРЕ и по логину, а не по роли: модераторов
// несколько, а платежи принимает один человек. Скрытая кнопка в интерфейсе
// защитой не считается (тот же довод, что в routes/admin.js).
//
// Что можно без подписки: посмотреть, что в неё входит, и покрутить
// предпросмотр темы. Что нельзя: сохранить настройки и загрузить фон — это
// уже трата места на диске и, главное, обещание, которого не было оплачено.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/client.js';
import {
    supporterState, saveTheme, grantMonth, revoke, listSupporters, loadSupporter,
    isOwner,
} from '../supporter/store.js';
import {
    uploadSupporterBackground, removeSupporterBackground, isAllowedAvatarMime,
} from '../storage/avatarStorage.js';
import { BG_ADVICE, SUPP_PRICE_RUB, SUPP_DAYS } from '../../../shared/supporterTheme.js';

const uploadBg = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BG_ADVICE.maxBytes },
}).single('background');

const router = Router();

// Замок владельца. Отдельной ручки «я владелец?» нет: об этом говорит поле
// canGrant в GET /me — одно место, где решается, кому показывать выдачу.
function requireOwner(req, res, next) {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'выдавать подписки может только владелец' });
    next();
}

// Действующая подписка — условие для всего, что что-то меняет у себя.
// Проверяем ПЕРЕД каждым таким действием, а не один раз при входе: месяц может
// кончиться прямо посреди сессии, и «настройки я открыл, когда подписка была»
// не аргумент.
async function requireActive(req, res, next) {
    try {
        const row = await loadSupporter(req.user.id);
        if (!row?.active) {
            return res.status(403).json({ error: 'нужна действующая подписка supp' });
        }
        next();
    } catch (err) {
        console.error('supporter requireActive', err);
        res.status(500).json({ error: err.message });
    }
}

// ── GET /api/supporter/me ────────────────────────────────────────────────────
// { active, forever, expires_at, theme, canGrant, price, days, bg }
// Тема отдаётся всегда — окно рисует по ней предпросмотр и тем, у кого
// подписки нет: витрина не должна требовать оплаты.
router.get('/me', async (req, res) => {
    try {
        const state = await supporterState(req.user);
        res.json({
            ...state,
            price: SUPP_PRICE_RUB,
            days: SUPP_DAYS,
            // Совет по картинке идёт с сервера, а не зашит в окне: и проверка
            // размера, и подпись «подойдёт 2560×1440» должны браться из одного
            // места (shared/supporterTheme.js).
            bg: BG_ADVICE,
        });
    } catch (err) {
        console.error('GET /api/supporter/me', err);
        res.status(500).json({ error: err.message });
    }
});

// ── PUT /api/supporter/theme ─────────────────────────────────────────────────
// Сохранить настройки темы. Возвращаем НОРМАЛИЗОВАННУЮ тему, а не «ok»: окно
// применяет то, что сохранилось, и не должно гадать, что сервер поправил.
router.put('/theme', requireActive, async (req, res) => {
    try {
        const theme = await saveTheme(req.user.id, req.body?.theme);
        res.json({ theme });
    } catch (err) {
        console.error('PUT /api/supporter/theme', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/supporter/background ───────────────────────────────────────────
// Своя картинка под стекло. Кладётся туда же, куда аватарки, и путь у неё
// детерминированный: повторная загрузка перезаписывает предыдущую, мусор не
// копится (см. storage/diskStorage.js).
router.post('/background', requireActive, (req, res) => {
    uploadBg(req, res, async (uploadErr) => {
        if (uploadErr) {
            // Единственная ожидаемая ошибка мультера — превышение лимита; её
            // человеку надо объяснить размером, а не кодом.
            const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
            return res.status(tooBig ? 413 : 400).json({
                error: tooBig
                    ? `картинка больше ${Math.round(BG_ADVICE.maxBytes / (1024 * 1024))} МБ`
                    : uploadErr.message,
            });
        }
        if (!req.file) return res.status(400).json({ error: 'файл background обязателен' });
        if (!isAllowedAvatarMime(req.file.mimetype)) {
            return res.status(400).json({ error: 'разрешены только изображения (jpeg/png/webp)' });
        }
        try {
            const url = await uploadSupporterBackground(req.user.id, req.file.buffer, req.file.mimetype);
            const current = await loadSupporter(req.user.id);
            const theme = await saveTheme(req.user.id, { ...current?.theme, background: url });
            res.json({ theme });
        } catch (err) {
            console.error('POST /api/supporter/background', err);
            res.status(500).json({ error: err.message });
        }
    });
});

// ── DELETE /api/supporter/background ─────────────────────────────────────────
// Вернуться к готовому фону. Файл удаляется, настройки остаются.
router.delete('/background', requireActive, async (req, res) => {
    try {
        await removeSupporterBackground(req.user.id);
        const current = await loadSupporter(req.user.id);
        const theme = await saveTheme(req.user.id, { ...current?.theme, background: null });
        res.json({ theme });
    } catch (err) {
        console.error('DELETE /api/supporter/background', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/supporter/list ──────────────────────────────────────────────────
// Кому выдано (и у кого недавно кончилось) — экран выдачи у владельца.
router.get('/list', requireOwner, async (_req, res) => {
    try {
        res.json({ supporters: await listSupporters() });
    } catch (err) {
        console.error('GET /api/supporter/list', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/supporter/users?q= ──────────────────────────────────────────────
// Поиск человека, которому выдать. Своя ручка, а не общий GET /api/users,
// потому что тот открыт модераторам, а выдача — владельцу: замки у них разные,
// и общий список однажды остался бы под одним из них.
router.get('/users', requireOwner, async (req, res) => {
    const q = String(req.query.q || '').trim();
    try {
        const params = [];
        let where = '';
        if (q) {
            params.push(`%${q}%`);
            where = 'WHERE u.display_name ILIKE $1 OR u.login ILIKE $1';
        }
        const r = await query(
            `SELECT u.id, u.display_name, u.login, u.avatar
               FROM users u
               ${where}
              ORDER BY u.display_name
              LIMIT 20`,
            params,
        );
        res.json({ users: r.rows });
    } catch (err) {
        console.error('GET /api/supporter/users', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/supporter/grant ────────────────────────────────────────────────
// { user_id, note } → выдать (или продлить) месяц.
router.post('/grant', requireOwner, async (req, res) => {
    const userId = req.body?.user_id;
    if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'user_id обязателен' });
    try {
        const exists = await query('SELECT id, display_name FROM users WHERE id = $1', [userId]);
        if (!exists.rows.length) return res.status(404).json({ error: 'такого пользователя нет' });

        const row = await grantMonth(userId, { by: req.user.id, note: req.body?.note });
        res.json({ user: exists.rows[0], supporter: row });
    } catch (err) {
        console.error('POST /api/supporter/grant', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/supporter/revoke ───────────────────────────────────────────────
// { user_id } → снять досрочно. Настройки темы человеку остаются.
router.post('/revoke', requireOwner, async (req, res) => {
    const userId = req.body?.user_id;
    if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'user_id обязателен' });
    try {
        const row = await revoke(userId, { by: req.user.id, note: req.body?.note });
        if (!row) return res.status(409).json({ error: 'у этого человека нет действующей подписки' });
        res.json({ supporter: row });
    } catch (err) {
        console.error('POST /api/supporter/revoke', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
