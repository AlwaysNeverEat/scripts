-- Атомарность длинных операций записей + суточная история очереди.
--
-- Длинная («продлённая») запись в оригинале — это N отдельных получасовых
-- записей, а транзакций у него нет: перенос червячка = N POST'ов подряд. Если
-- оригинал ляжет посреди переноса, упадёт наш процесс или слот успеет занять
-- кто-то другой, половина записи оказалась бы на новом месте, половина на
-- старом. progress — журнал хода операции (что уже уехало/создано и откуда),
-- по нему воркер либо доводит операцию до конца, либо возвращает всё назад.
--
-- Формат: { phase: 'apply'|'rollback', reason, rollbackAttempts,
--           origins: { [recordId]: { addressId, date, time } },
--           moved: [recordId…], created: [{ addressId, date, time, name, before }],
--           deleted: [recordId…] }

ALTER TABLE record_ops
  ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb;

-- История применённых операций живёт сутки (воркер подчищает раз в час) —
-- индекс, чтобы чистка не читала всю таблицу.
CREATE INDEX IF NOT EXISTS record_ops_history_idx
  ON record_ops (applied_at) WHERE status <> 'pending';
