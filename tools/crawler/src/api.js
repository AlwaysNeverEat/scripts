// Клиент бэкенда: проверка дублей и заливка кандидатов в фид.
// В обычной сети работает через штатный fetch. Если задан HTTPS_PROXY
// (песочница) и доступен undici — идём через прокси.

let dispatcher = null;
if (process.env.HTTPS_PROXY) {
  try {
    const { ProxyAgent } = await import('undici');
    dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
  } catch { /* undici недоступен — идём напрямую */ }
}

export class Api {
  constructor({ base, key }) {
    this.base = base.replace(/\/$/, '');
    this.key = key;
  }

  async _fetch(path, opts = {}) {
    const res = await fetch(this.base + path, {
      ...opts,
      headers: { 'x-api-key': this.key, 'content-type': 'application/json', ...(opts.headers || {}) },
      ...(dispatcher ? { dispatcher } : {}),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path} → ${res.status} ${(json && json.error) || ''}`);
    return json;
  }

  // Возвращает Set известных dedup_key (уже в cars или в кандидатах).
  async known(keys) {
    if (!keys.length) return new Set();
    const out = new Set();
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      const r = await this._fetch('/api/candidates/known', { method: 'POST', body: JSON.stringify({ keys: chunk }) });
      for (const k of r.known || []) out.add(k);
    }
    return out;
  }

  // Заливает кандидата. Возвращает { created } | { skipped, reason }.
  async postCandidate(candidate) {
    return this._fetch('/api/candidates', { method: 'POST', body: JSON.stringify(candidate) });
  }

  async health() {
    const res = await fetch(this.base + '/health', dispatcher ? { dispatcher } : {});
    return res.ok;
  }
}

// Тот же ключ дублей, что и на бэкенде (backend/src/cars/upsert.js:dedupKey).
export function dedupKey({ brand, model, engine_code, engine_volume, year_from }) {
  return [
    String(brand || '').trim().toLowerCase(),
    String(model || '').trim().toLowerCase(),
    String(engine_code || '').trim().toLowerCase(),
    engine_volume != null && engine_volume !== '' ? Number(engine_volume) : 0,
    year_from != null && year_from !== '' ? parseInt(year_from) : 0,
  ].join('|');
}
