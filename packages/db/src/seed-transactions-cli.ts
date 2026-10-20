// `pnpm db:seed-transactions <email> [count] [YYYY-MM]`: fictional transactions for a local
// user, to check that money pages stay fast on a realistic volume (T23: the monthly report with
// 10,000). The user must have opened Money once, so their Cash account and categories exist.
// Development only: it writes to whatever DATABASE_URL names.
// Plain pg and SQL, free of relative imports, so Node can run it directly with type stripping.
import { parseArgs } from "node:util";
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed fictional transactions with NODE_ENV=production");
  process.exit(1);
}

const { positionals } = parseArgs({ allowPositionals: true });
const [email, countText = "10000", month = new Date().toISOString().slice(0, 7)] = positionals;
const count = Number(countText);
if (
  !email ||
  !Number.isInteger(count) ||
  count < 1 ||
  !/^(19\d\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(month)
) {
  console.error("Usage: pnpm db:seed-transactions <email> [count] [YYYY-MM]");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // Mostly expenses spread over the month's first 28 days, every tenth one income, a tenth
  // uncategorized, the rest round-robin over the user's categories.
  const result = await client.query(
    `with target as (
       select u.id as user_id, a.id as account_id, a.currency
       from users u
       join money_accounts a on a.user_id = u.id and a.archived_at is null
       where u.email = $1
       order by a.created_at
       limit 1
     ),
     categories as (
       select c.id, row_number() over (order by c.id) - 1 as n, count(*) over () as total
       from money_categories c join target t on c.user_id = t.user_id
     )
     insert into money_transactions
       (user_id, account_id, booked_on, amount_cents, currency, counterparty, category_id, source)
     select t.user_id, t.account_id,
       ($3 || '-01')::date + (i % 28),
       case when i % 10 = 0 then 50000 + i % 977 else -(100 + (i * 7919) % 20000) end,
       t.currency,
       (array['GROCERY MART', 'CITY TRANSIT', 'CORNER CAFE', 'POWER CO', 'BOOK NOOK'])[1 + i % 5],
       case when i % 10 = 1 then null
            else (select c.id from categories c where c.n = i % c.total) end,
       'manual'
     from target t, generate_series(0, $2 - 1) as i`,
    [email, count, month],
  );
  if (result.rowCount === 0) {
    throw new Error(`No active account for ${email}: create the user and open Money once first`);
  }
  console.log(`Added ${result.rowCount} transactions in ${month} for ${email}`);
} finally {
  await client.end();
}
