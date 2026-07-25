const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const { requireAuth, requireMembership } = require("../auth");

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireMembership);

const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 30 };

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function rotationOrder(householdId) {
  return db
    .prepare(
      `SELECT user_id FROM household_members WHERE household_id = ? ORDER BY joined_at ASC`
    )
    .all(householdId)
    .map((r) => r.user_id);
}

function nextInRotation(householdId, currentUserId) {
  const order = rotationOrder(householdId);
  if (order.length === 0) return currentUserId;
  const idx = order.indexOf(currentUserId);
  if (idx === -1) return order[0]; // current assignee no longer a member — restart from first
  return order[(idx + 1) % order.length];
}

router.get("/", (req, res) => {
  const chores = db
    .prepare(
      `SELECT c.*, u.email as assigned_to_email FROM chores c
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.household_id = ? ORDER BY c.done ASC, c.created_at DESC`
    )
    .all(req.params.householdId);
  res.json(chores);
});

router.post("/", (req, res) => {
  const { task, assignmentType, assignedTo, frequency } = req.body || {};
  if (!task || !task.trim()) return res.status(400).json({ error: "Chore name is required." });
  if (!["manual", "auto"].includes(assignmentType)) {
    return res.status(400).json({ error: "Assignment type must be manual or auto." });
  }
  if (assignmentType === "auto" && !FREQ_DAYS[frequency]) {
    return res.status(400).json({ error: "Auto-rotating chores need a daily/weekly/monthly frequency." });
  }
  let nextDue = null;
  if (assignmentType === "auto") {
    nextDue = addDays(new Date().toISOString().slice(0, 10), FREQ_DAYS[frequency]);
  }
  const id = nanoid();
  db.prepare(
    `INSERT INTO chores (id, household_id, task, assignment_type, assigned_to, frequency, next_due, done)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, req.params.householdId, task.trim(), assignmentType, assignedTo || null, frequency || null, nextDue);
  res.json({ id });
});

router.patch("/:choreId", (req, res) => {
  const { done } = req.body || {};
  const chore = db
    .prepare("SELECT * FROM chores WHERE id = ? AND household_id = ?")
    .get(req.params.choreId, req.params.householdId);
  if (!chore) return res.status(404).json({ error: "Chore not found." });

  if (done && chore.assignment_type === "auto") {
    // completing an auto-rotating chore advances it to the next person and resets due date
    const next = nextInRotation(req.params.householdId, chore.assigned_to);
    const nextDue = addDays(new Date().toISOString().slice(0, 10), FREQ_DAYS[chore.frequency] || 7);
    db.prepare(
      "UPDATE chores SET done = 0, assigned_to = ?, next_due = ? WHERE id = ?"
    ).run(next, nextDue, chore.id);
  } else {
    db.prepare("UPDATE chores SET done = ? WHERE id = ?").run(done ? 1 : 0, chore.id);
  }
  res.json({ ok: true });
});

// manual "pass it on" — works for both manual and auto chores, ad hoc
router.post("/:choreId/pass", (req, res) => {
  const chore = db
    .prepare("SELECT * FROM chores WHERE id = ? AND household_id = ?")
    .get(req.params.choreId, req.params.householdId);
  if (!chore) return res.status(404).json({ error: "Chore not found." });
  const next = nextInRotation(req.params.householdId, chore.assigned_to);
  db.prepare("UPDATE chores SET assigned_to = ?, done = 0 WHERE id = ?").run(next, chore.id);
  res.json({ ok: true });
});

router.delete("/:choreId", (req, res) => {
  db.prepare("DELETE FROM chores WHERE id = ? AND household_id = ?").run(
    req.params.choreId,
    req.params.householdId
  );
  res.json({ ok: true });
});

module.exports = router;
