// Победа над ботом в парной игре — в журнал заданий (shared/quests.js).
//
// Сервер такую партию не видит вовсе: она целиком живёт в браузере. Поэтому
// задание «выиграй у бота» засчитывается со слов окна игры, и это осознанно —
// потолок того, что так можно накрутить, — 75 опыта в день. Отдельный крошечный
// модуль, а не quests.js: тот тянет за собой стили панели профиля, а в чанке
// игры им делать нечего.
//
// Окно игры зовёт это из своего showOver, а тот иногда вызывается для той же
// партии дважды (перерисовка итога) — помним, о какой партии уже сказали.
const told = new WeakSet();

export function reportBotWin(ctx, game, level, partyObj) {
    if (partyObj && typeof partyObj === 'object') {
        if (told.has(partyObj)) return;
        told.add(partyObj);
    }
    ctx?.apiFetch?.('/api/quests/report', { method: 'POST', body: { game, won: true, level } }).catch(() => {});
}
