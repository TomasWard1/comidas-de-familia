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
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
  CREATE INDEX IF NOT EXISTS idx_logs_member ON logs(member_id);
`);

// Seed default members if empty
const count = db.query("SELECT COUNT(*) as c FROM members").get() as { c: number };
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO members (name) VALUES (?)");
  for (const name of ["Tomás", "Mamá", "Papá", "Hermano"]) {
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
  const { memberId, category, notes } = await c.req.json<{
    memberId: number;
    category: string;
    notes?: string;
  }>();
  if (!memberId || !category) return c.json({ error: "memberId and category required" }, 400);
  db.prepare("INSERT INTO logs (member_id, category, notes) VALUES (?, ?, ?)").run(
    memberId,
    category,
    notes || ""
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
       LEFT JOIN logs l ON l.member_id = m.id
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
      `SELECT l.id, m.name, l.category, l.notes, l.created_at
       FROM logs l
       JOIN members m ON m.id = l.member_id
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  return c.json(history);
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
          SELECT member_id, category, COUNT(*) as cnt FROM logs GROUP BY member_id, category
        ) l ON l.member_id = m.id AND l.category = ac.category
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
