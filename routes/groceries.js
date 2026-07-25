const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const { requireAuth, requireMembership } = require("../auth");

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireMembership);

router.get("/", (req, res) => {
  const items = db
    .prepare(
      `SELECT g.*, u.email as added_by_email FROM groceries g
       LEFT JOIN users u ON u.id = g.added_by
       WHERE g.household_id = ? ORDER BY g.done ASC, g.created_at DESC`
    )
    .all(req.params.householdId);
  res.json(items);
});

router.post("/", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Item name is required." });
  const id = nanoid();
  db.prepare(
    "INSERT INTO groceries (id, household_id, name, added_by, done) VALUES (?, ?, ?, ?, 0)"
  ).run(id, req.params.householdId, name.trim(), req.user.id);
  res.json({ id });
});

router.patch("/:itemId", (req, res) => {
  const { done } = req.body || {};
  db.prepare("UPDATE groceries SET done = ? WHERE id = ? AND household_id = ?").run(
    done ? 1 : 0,
    req.params.itemId,
    req.params.householdId
  );
  res.json({ ok: true });
});

router.delete("/:itemId", (req, res) => {
  db.prepare("DELETE FROM groceries WHERE id = ? AND household_id = ?").run(
    req.params.itemId,
    req.params.householdId
  );
  res.json({ ok: true });
});

module.exports = router;
