// Автовыход в полночь по МСК: без крона, middleware на каждый запрос считает
// "последнюю наступившую полночь МСК" и сравнивает с session.created_at.
//
// Россия с 2014 года не переводит часы — МСК = UTC+3 круглый год, поэтому
// достаточно фиксированного смещения (никаких таймзон-баз/DST не нужно).
//
// Приём: сдвигаем "сейчас" на +3ч, берём календарную дату по UTC-полям этого
// сдвинутого момента (это и есть "сегодня в МСК"), обнуляем время суток —
// получаем полночь МСК, выраженную в сдвинутой шкале, — и сдвигаем обратно
// на -3ч, чтобы получить реальный момент в UTC, которому соответствует эта
// полночь МСК.

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export function lastMidnightMsk(now = new Date()) {
  const shifted = new Date(now.getTime() + MSK_OFFSET_MS);
  const shiftedMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(shiftedMidnight - MSK_OFFSET_MS);
}

// Сессия жива, если создана не раньше последней полночи МСК (>=, не строго >).
export function isSessionAlive(createdAt, now = new Date()) {
  return new Date(createdAt).getTime() >= lastMidnightMsk(now).getTime();
}
