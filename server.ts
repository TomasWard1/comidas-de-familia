import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { Database } from "bun:sqlite";

const db = new Database("comidas.db", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    category TEXT NOT NULL,
    notes TEXT DEFAULT '',
    meal_date TEXT DEFAULT (date('now', 'localtime')),
    meal_time TEXT DEFAULT '',
    is_swap INTEGER DEFAULT 0,
    credited_to INTEGER DEFAULT NULL REFERENCES members(id),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
  CREATE INDEX IF NOT EXISTS idx_logs_member ON logs(member_id);
  CREATE INDEX IF NOT EXISTS idx_logs_meal_date ON logs(meal_date);
`);

// Migrate: add meal_date and meal_time columns if missing (existing DBs)
try {
  db.exec("ALTER TABLE logs ADD COLUMN meal_date TEXT DEFAULT (date('now', 'localtime'))");
} catch { /* column already exists */ }
try {
  db.exec("ALTER TABLE logs ADD COLUMN meal_time TEXT DEFAULT ''");
} catch { /* column already exists */ }
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_logs_meal_date ON logs(meal_date)");
} catch { /* index already exists */ }

// Migrate: add swap columns if missing (existing DBs)
try {
  db.exec("ALTER TABLE logs ADD COLUMN is_swap INTEGER DEFAULT 0");
} catch { /* column already exists */ }
try {
  db.exec("ALTER TABLE logs ADD COLUMN credited_to INTEGER DEFAULT NULL REFERENCES members(id)");
} catch { /* column already exists */ }

// Backfill: set meal_date from created_at for rows that have NULL meal_date
db.exec("UPDATE logs SET meal_date = date(created_at) WHERE meal_date IS NULL");

// Seed default members if empty
const count = db.query("SELECT COUNT(*) as c FROM members").get() as { c: number };
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO members (name) VALUES (?)");
  for (const name of ["Tomas", "Emma", "Mateo", "Maria"]) {
    insert.run(name);
  }
}

const app = new Hono();

// API routes
app.get("/api/members", (c) => {
  const members = db.query("SELECT id, name FROM members ORDER BY name").all();
  return c.json(members);
});

app.post("/api/members", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);
  try {
    db.prepare("INSERT INTO members (name) VALUES (?)").run(name.trim());
    return c.json({ ok: true }, 201);
  } catch {
    return c.json({ error: "Member already exists" }, 409);
  }
});

app.delete("/api/members/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM logs WHERE member_id = ?").run(id);
  db.prepare("DELETE FROM members WHERE id = ?").run(id);
  return c.json({ ok: true });
});

app.post("/api/log", async (c) => {
  const { memberId, category, notes, mealDate, mealTime, isSwap, creditedTo } = await c.req.json<{
    memberId: number;
    category: string;
    notes?: string;
    mealDate?: string;
    mealTime?: string;
    isSwap?: boolean;
    creditedTo?: number;
  }>();
  if (!memberId || !category) return c.json({ error: "memberId and category required" }, 400);
  if (isSwap && !creditedTo) return c.json({ error: "creditedTo required when isSwap is true" }, 400);
  const validMealTimes = ["Mañana", "Mediodía", "Tarde", "Noche"];
  const finalMealTime = mealTime && validMealTimes.includes(mealTime) ? mealTime : "";
  const finalMealDate = mealDate || new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO logs (member_id, category, notes, meal_date, meal_time, is_swap, credited_to) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    memberId,
    category,
    notes || "",
    finalMealDate,
    finalMealTime,
    isSwap ? 1 : 0,
    isSwap && creditedTo ? creditedTo : null
  );
  return c.json({ ok: true }, 201);
});

app.delete("/api/log/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM logs WHERE id = ?").run(id);
  return c.json({ ok: true });
});

app.get("/api/scores", (c) => {
  const scores = db
    .query(
      `SELECT m.id as memberId, m.name, l.category, COUNT(l.id) as count
       FROM members m
       LEFT JOIN logs l ON COALESCE(l.credited_to, l.member_id) = m.id
       GROUP BY m.id, l.category
       ORDER BY m.name, l.category`
    )
    .all();
  return c.json(scores);
});

app.get("/api/history", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  const history = db
    .query(
      `SELECT l.id, m.name, l.category, l.notes, l.meal_date, l.meal_time, l.created_at,
              l.is_swap, l.credited_to, mc.name as credited_name
       FROM logs l
       JOIN members m ON m.id = l.member_id
       LEFT JOIN members mc ON mc.id = l.credited_to
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  return c.json(history);
});

app.get("/api/calendar", (c) => {
  const month = c.req.query("month"); // e.g. "2026-03"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: "month param required (YYYY-MM)" }, 400);
  }
  const startDate = month + "-01";
  // Calculate last day of month
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = month + "-" + String(lastDay).padStart(2, "0");

  const logs = db
    .query(
      `SELECT l.id, m.name, l.category, l.notes, l.meal_date, l.meal_time, l.created_at,
              l.is_swap, l.credited_to, mc.name as credited_name
       FROM logs l
       JOIN members m ON m.id = l.member_id
       LEFT JOIN members mc ON mc.id = l.credited_to
       WHERE l.meal_date >= ? AND l.meal_date <= ?
       ORDER BY l.meal_date, l.meal_time`
    )
    .all(startDate, endDate);

  // Group by date
  const grouped: Record<string, any[]> = {};
  (logs as any[]).forEach((log) => {
    const d = log.meal_date || log.created_at?.slice(0, 10);
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(log);
  });

  return c.json(grouped);
});

app.get("/api/next", (c) => {
  const next = db
    .query(
      `WITH all_categories(category) AS (
        VALUES ('Cocina'),('Lava'),('Seca'),('Sacar Lavavajillas'),('Poner Lavavajillas')
      ),
      counts AS (
        SELECT m.id, m.name, ac.category, COALESCE(cnt, 0) as count
        FROM members m
        CROSS JOIN all_categories ac
        LEFT JOIN (
          SELECT COALESCE(credited_to, member_id) as effective_member, category, COUNT(*) as cnt FROM logs GROUP BY effective_member, category
        ) l ON l.effective_member = m.id AND l.category = ac.category
      )
      SELECT category, name, count
      FROM counts c1
      WHERE count = (SELECT MIN(count) FROM counts c2 WHERE c2.category = c1.category)
      ORDER BY category`
    )
    .all();
  return c.json(next);
});

// Serve static files
app.use("/*", serveStatic({ root: "./public" }));

const port = Number(process.env.PORT || 3000);
console.log(`Comidas de Familia running on http://localhost:${port}`);

export default { port, fetch: app.fetch };
