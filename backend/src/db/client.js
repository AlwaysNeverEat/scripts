import pg from 'pg';
import dns from 'node:dns';

// Принудительно используем IPv4 — IPv6 через VPN-туннель часто ломается
dns.setDefaultResultOrder('ipv4first');

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
});

export const query = (text, params) => pool.query(text, params);
export default pool;