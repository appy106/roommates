const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const db = require("./db");
const { requireAuth, requireMembership } = require("./auth");

const authRoutes = require("./routes/auth");
const householdRoutes = require("./routes/households");
const groceryRoutes = require("./routes/groceries");
const choreRoutes = require("./routes/chores");
const billRoutes = require("./routes/bills");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/households", householdRoutes);
app.use("/api/households/:householdId/groceries", groceryRoutes);
app.use("/api/households/:householdId/chores", choreRoutes);
app.use("/api/households/:householdId/bills", billRoutes);

// --- Heads up: personalized, per-household summary of what needs attention ---
app.get("/api/households/:householdId/heads-up", requireAuth, requireMembership, (req, res) => {
  const householdId = req.params.householdId;
  const userId = req.user.id;
  const today = new Date().toISOString().slice(0, 10);

  const groceries = db
    .prepare("SELECT * FROM groceries WHERE household_id = ? AND done = 0 ORDER BY created_at ASC")
    .all(householdId);

  const chores = db
    .prepare(
      "SELECT * FROM chores WHERE household_id = ? AND assigned_to = ? AND done = 0 ORDER BY next_due ASC"
    )
    .all(householdId, userId);
  const choreItems = chores.map((c) => {
    let status = "assigned";
    if (c.next_due) {
      status = c.next_due < today ? "overdue" : c.next_due === today ? "due_today" : "upcoming";
    }
    return { id: c.id, task: c.task, frequency: c.frequency, nextDue: c.next_due, status };
  });

  // balances (reuse the same logic as the bills balances endpoint)
  const members = db
    .prepare(
      `SELECT u.id, u.email FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ?`
    )
    .all(householdId);
  const balances = {};
  members.forEach((m) => (balances[m.id] = 0));
  const bills = db.prepare("SELECT * FROM bills WHERE household_id = ?").all(householdId);
  const splitsStmt = db.prepare("SELECT * FROM bill_splits WHERE bill_id = ?");
  for (const b of bills) {
    for (const s of splitsStmt.all(b.id)) {
      if (s.user_id === b.paid_by) continue;
      balances[s.user_id] = round2((balances[s.user_id] || 0) - s.share_amount);
      balances[b.paid_by] = round2((balances[b.paid_by] || 0) + s.share_amount);
    }
  }
  const settlements = db.prepare("SELECT * FROM settlements WHERE household_id = ?").all(householdId);
  for (const s of settlements) {
    balances[s.from_user] = round2((balances[s.from_user] || 0) + s.amount);
    balances[s.to_user] = round2((balances[s.to_user] || 0) - s.amount);
  }
  const myBalance = round2(balances[userId] || 0);

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  res.json({
    groceries: groceries.map((g) => ({ id: g.id, name: g.name })),
    chores: choreItems,
    balance: myBalance,
    allCaughtUp: groceries.length === 0 && choreItems.length === 0 && myBalance >= 0,
  });
});

app.use(express.static(path.join(__dirname, "public")));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Roommate app running at http://localhost:${PORT}`);
});
