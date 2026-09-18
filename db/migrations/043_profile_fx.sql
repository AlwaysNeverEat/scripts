-- Кастомизация профиля: выбранная рамка аватара и эффект обложки.
-- Каталог эффектов живёт в коде (shared/profileFx.js), в базе — только выбор
-- человека: по строке на пользователя, как у мини-топов. Незнакомый id при
-- чтении превращается в «без эффекта» (normalizeFx), поэтому чистить таблицу
-- при правках каталога не нужно.
--
-- Колонки покупок тут пока нет сознательно: валюты нет, всё надевается
-- бесплатно. Когда появится — рядом встанет таблица владения, а не флаг здесь.

CREATE TABLE IF NOT EXISTS user_profile_fx (
    user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    avatar_fx  text,
    profile_fx text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
