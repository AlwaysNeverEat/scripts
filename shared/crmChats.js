// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Чаты»: «Открытые линии» новой CRM — переписка с клиентами в MAX,
// Telegram и ВК (re/api.php, раздел omni_*).
//
// В самой CRM этот экран спрятан в подменю «Клиенты», а о новом сообщении
// говорит только красная цифра у пункта меню, которую видно, лишь открыв это
// меню. Отсюда вкладка рядом с «Лидами» и счётчик прямо на ней.
//
// Ручки взяты из кода самой CRM (страница сохранена оператором), живьём не
// снимались — разбор терпим к пустым полям:
//
//   omni_dialogs&status=open|closed&channel=&q=   список диалогов;
//   omni_thread&id=                               диалог и сообщения (его
//                                                 открытие CRM считает
//                                                 прочтением — после него она
//                                                 сама пересчитывает счётчик);
//   omni_counts                                   { unread } — для счётчика;
//   omni_waiting                                  диалоги, где бот сдался и
//                                                 «клиент ждёт оператора»;
//   omni_reply (id, text)                         ответ клиенту;
//   omni_assign (id)                              взять в работу / на себя;
//   omni_status (id, to=open|closed)              закрыть / вернуть;
//   omni_client_search&q= → omni_link (id, client_id)  привязать клиента.
//
// Настройки каналов (токены ботов) сюда сознательно не взяты: это экран
// руководителя, и токены ботов незачем возить через ещё один сайт.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v == null ? '' : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);

export const CHANNELS = [
    { id: 'max', label: 'MAX' },
    { id: 'tg', label: 'Telegram' },
    { id: 'vk', label: 'ВК' },
];
export const channelLabel = (id) => CHANNELS.find(c => c.id === id)?.label || str(id) || '—';

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// Кто на том конце: привязанный клиент CRM, иначе имя из мессенджера, иначе
// @логин, иначе номер собеседника — ровно в том порядке, что и в самой CRM.
function whoOf(o) {
    return str(o.client) || str(o.peer_name) || (str(o.peer_username) ? `@${str(o.peer_username)}` : '')
        || (o.peer_id != null && o.peer_id !== '' ? `#${o.peer_id}` : 'Без имени');
}

export function parseDialogs(json) {
    return arr(json?.dialogs).filter(o => o && o.id != null).map(o => ({
        id: str(o.id),
        who: whoOf(o),
        channel: str(o.channel),
        unread: num(o.unread),
        lastOut: o.last_dir === 'out',
        lastText: str(o.last_text),
        lastAt: str(o.last_at),
        assignee: str(o.assignee),
        clientId: str(o.client_id),
    }));
}

// «Клиент ждёт оператора»: бот «Открытых линий» не нашёл ответа или клиент
// попросил человека — диалог ждёт, а бот замолчал. В CRM это отдельная
// всплывашка колл-центру; у нас — такая же отметка в списке и в уведомлении.
export function parseWaiting(json) {
    return arr(json?.waiting).filter(x => x && x.id != null).map(x => ({
        id: str(x.id),
        who: str(x.who) || 'Клиент',
        channel: str(x.channel),
        lastText: str(x.last_text),
    }));
}

export function parseThread(json) {
    const d = json?.dialog || {};
    return {
        dialog: {
            id: str(d.id),
            who: whoOf(d),
            channel: str(d.channel),
            username: str(d.peer_username),
            phone: str(d.phone),
            clientId: str(d.client_id),
            assigned: Boolean(d.assigned_to),
            closed: d.status === 'closed',
        },
        messages: arr(json?.messages).map(m => ({
            out: m.dir === 'out',
            body: str(m.body),
            attachments: arr(m.att).length,
            author: str(m.author),
            at: str(m.at),
            failed: Boolean(m.err),
        })),
    };
}

export const parseUnread = (json) => num(json?.unread);

export function parseClientMatches(json) {
    return arr(json?.items).filter(it => it && it.id != null)
        .map(it => ({ id: str(it.id), name: str(it.name) || 'Без имени', phone: str(it.phone) }));
}

// Диалог не открылся / CRM не приняла действие: её слова, а без них — общее.
export function chatRefusal(json) {
    if (json && json.ok !== false && !json.error) return null;
    return str(json?.message) || str(json?.msg) || str(json?.error) || 'CRM не приняла';
}

// Новое сообщение — это рост непрочитанного. Падение (кто-то прочитал) и
// первый замер после загрузки страницы новостью не считаются: иначе
// уведомление вылетало бы на каждый F5 при уже висящих непрочитанных.
export function newUnread(prev, next) {
    if (prev == null) return 0;
    return Math.max(0, next - prev);
}
