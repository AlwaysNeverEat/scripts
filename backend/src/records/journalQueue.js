// ─────────────────────────────────────────────────────────────────────────────
// Очередь операций раздела «Записи» — чтобы оператор не сидел и не ждал CRM.
//
// Журнал CRM отвечает медленно: запись на час — это два слота, два запроса,
// плюс журнал дня для проверки поста, и всё это через общую очередь запросов к
// CRM (crm/client.js). Пока операция исполнялась прямо в POST, окно висело
// секунды, а человек с трубкой в руке их не ждёт. Старая админка приучила к
// другому: нажал — окно закрылось, запись висит на доске «в очереди», сайт сам
// дожидается ответа.
//
// Поэтому POST /api/journal/ops теперь только СТАВИТ операцию и сразу отвечает,
// а исполняет её этот модуль — фоном, под той же личной сессией CRM (автор
// записи по-прежнему тот, кто нажал). Раздел опрашивает список, пока в нём есть
// невыполненное, и показывает исход: запись встала — доска перечитывается;
// CRM отказала — красная плашка с её текстом.
//
// Очередь живёт В ПАМЯТИ процесса, а не в базе, и это осознанно. Старая очередь
// (record_ops) жила в базе, потому что ждала, пока поднимется лежащая админка,
// — часами. Эта ждёт секунды: CRM либо ответит сейчас, либо откажет. Цена
// названа честно: перезапуск бэкенда посреди операции её теряет — раздел
// перестанет показывать призрака, а доска покажет, успела ли CRM её принять.
//
// Порядок — СТРОГО по человеку. Правка записи — это до трёх операций подряд
// (снять хвост, перенести, дописать), и перенос, обогнавший снятие хвоста,
// упрётся в собственный слот. Операции разных людей друг друга не ждут: общая
// очередь к CRM (crm/client.js) и так не пустит их туда одновременно.
// ─────────────────────────────────────────────────────────────────────────────

import { applyJournalOp, OpRefused } from './journalOps.js';
import { CrmError } from '../crm/client.js';

// Сколько помнить исполненные: плашка «не записалось» должна дожить до того,
// как человек вернётся к компьютеру, а список «Очередь» — показать смену.
const KEEP_MS = 12 * 3600 * 1000;
const KEEP_PER_USER = 50;

export const OP_TYPES = new Set(['create', 'update', 'delete']);

export function createJournalQueue({ apply = applyJournalOp, now = () => Date.now(), log = console } = {}) {
    const ops = [];            // все операции, старые в начале
    const tails = new Map();   // userId → промис последней поставленной
    const brokenGroups = new Map(); // `${userId}:${group}` → когда шаг не прошёл
    let lastId = 0;

    // id растут и ПЕРЕЖИВАЮТ перезапуск: раздел помнит «последнюю увиденную»
    // в localStorage и по ней зажигает бейдж, а счётчик с единицы после
    // рестарта объявил бы все новые операции давно увиденными.
    function nextId() {
        lastId = Math.max(lastId + 1, now());
        return lastId;
    }

    function prune() {
        const edge = now() - KEEP_MS;
        const perUser = new Map();
        for (let i = ops.length - 1; i >= 0; i--) {
            const op = ops[i];
            if (op.status === 'pending') continue;
            const n = (perUser.get(op.userId) || 0) + 1;
            perUser.set(op.userId, n);
            if (n > KEEP_PER_USER || Date.parse(op.createdAt) < edge) ops.splice(i, 1);
        }
        for (const [key, at] of brokenGroups) if (at < edge) brokenGroups.delete(key);
    }

    // Снаружи — копия без userId: список уезжает в браузер как есть.
    const view = (op) => {
        const { userId, ...rest } = op;
        return rest;
    };

    async function run(op) {
        const groupKey = op.group ? `${op.userId}:${op.group}` : null;
        if (op.status !== 'pending') return; // отменили, пока ждала
        if (groupKey && brokenGroups.has(groupKey)) {
            finish(op, 'failed', 'не выполнено: предыдущий шаг этой правки не прошёл');
            return;
        }
        op.running = true;
        try {
            const result = await apply(op.userId, op.type, op.payload);
            op.result = result || {};
            finish(op, 'done', '');
        } catch (err) {
            if (groupKey) brokenGroups.set(groupKey, now());
            // Отказ по делу и ошибка CRM — это текст для человека. Всё прочее —
            // наша поломка: её в лог, а на экран общее.
            const readable = err instanceof OpRefused || err instanceof CrmError;
            if (!readable) log.error('journal queue', err);
            finish(op, 'failed', readable ? err.message : 'внутренняя ошибка — запись могла не встать, проверьте доску');
        }
    }

    function finish(op, status, lastError) {
        op.status = status;
        op.running = false;
        op.lastError = lastError;
        op.appliedAt = new Date(now()).toISOString();
    }

    return {
        enqueue(userId, { type, payload, author = '', group = null, note = null }) {
            prune();
            const op = {
                id: nextId(),
                userId,
                type,
                payload: payload || {},
                status: 'pending',
                running: false,
                lastError: '',
                author,
                group: group ? String(group) : null,
                // Подпись для уведомления (routes/journal.js → cleanNote).
                note,
                createdAt: new Date(now()).toISOString(),
                appliedAt: null,
                result: null,
            };
            ops.push(op);
            const prev = tails.get(userId) || Promise.resolve();
            const tail = prev.then(() => run(op));
            tails.set(userId, tail);
            // Хвост отпускаем, когда за ним никого: Map не должен копить
            // промисы всех, кто когда-то записывал.
            tail.then(() => { if (tails.get(userId) === tail) tails.delete(userId); });
            return view(op);
        },

        // Свежие первыми — так их рисует окно «Очередь».
        list(userId) {
            prune();
            return ops.filter(o => o.userId === userId).reverse().map(view);
        },

        // Отменить можно только то, что ещё НЕ ушло в CRM: начатую операцию
        // остановить посередине нельзя — половина записи хуже любой.
        cancel(userId, id) {
            const op = ops.find(o => o.userId === userId && o.id === Number(id));
            if (!op || op.status !== 'pending' || op.running) return false;
            finish(op, 'failed', 'отменена вручную');
            if (op.group) brokenGroups.set(`${userId}:${op.group}`, now());
            return true;
        },

        // Для тестов: дождаться, пока все поставленные исполнятся.
        async idle() {
            while (tails.size) await Promise.all([...tails.values()]);
        },
    };
}

export const journalQueue = createJournalQueue();
