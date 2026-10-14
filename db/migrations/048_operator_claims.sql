-- Кто СЕЙЧАС сидит под кодом оператора (вкладка «Лиды»), и кто сидел раньше.
--
-- Код оператора — это место за телефоном, а не человек: на 101 и 105 работают
-- по двое, сменами 2/2. Раньше код хранился в строке скина (user_skins.operator),
-- и звонок отдавался тому, у кого этот код записан и надет скин лидов. Сменщик
-- без скина в user_skins не попадал вовсе — и его звонки шли в чужом скине.
--
-- Поэтому код ЗАНИМАЮТ: открыл «Лиды» со своим кодом — строка «код → я, с
-- этого момента»; вышел из аккаунта — строка «код → никто». Чей звонок,
-- решается по ВРЕМЕНИ звонка: последняя строка этого кода до него. Так
-- вчерашние звонки сменщика остаются его, даже когда сегодня код занят тобой.
--
-- Строка пишется только при СМЕНЕ хозяина (shared/skins.js, store.claimOperator):
-- вкладку открывают десятки раз за смену, и повтор «код → я» ничего не меняет.

CREATE TABLE IF NOT EXISTS operator_claims (
  id       bigserial   PRIMARY KEY,
  code     text        NOT NULL,
  user_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_claims_code_at ON operator_claims (code, at DESC);

-- Начальное состояние — из прежних кодов в скинах, но ТОЛЬКО бесспорных: код,
-- записанный у двоих, никому не отдаём — его займёт тот, кто первым откроет
-- «Лиды». Повторный прогон миграции ничего не добавит.
INSERT INTO operator_claims (code, user_id, at)
SELECT s.operator, s.user_id, s.updated_at
FROM user_skins s
WHERE s.operator <> ''
  AND NOT EXISTS (SELECT 1 FROM operator_claims c WHERE c.code = s.operator)
  AND (SELECT count(*) FROM user_skins t WHERE t.operator = s.operator) = 1;
