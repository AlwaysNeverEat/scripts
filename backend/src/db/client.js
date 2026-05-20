import pg from 'pg';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase.co')
    || process.env.DATABASE_URL?.includes('supabase.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  // Принудительно использовать IPv4
  options: '-c statement_timeout=10000',
});

// Перехват DNS lookup чтобы вернуть только IPv4 адреса
const originalLookup = dns.lookup;
dns.lookup = function (hostname, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  opts = { ...opts, family: 4 };
  return originalLookup.call(this, hostname, opts, cb);
};

export const query = (text, params) => pool.query(text, params);
export default pool;