const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const { requireAuth, requireMembership } = require("../auth");

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireMembership);

function round2(n) {
  return Math.round(n * 100) / 100;
}

router.get("/", (req, res) => {
  const bills = db
    .prepare(
      `SELECT b.*, u.email as paid_by_email FROM bills b
       JOIN users u ON u.id = b.paid_by
       WHERE b.household_id = ? ORDER BY b.created_at DESC`
    )
    .all(req.params.householdId);
  const splits = db.prepare("SELECT * FROM bill_splits WHERE bill_id = ?");
  const withSplits = bills.map((b) => ({ ...b, splits: splits.all(b.id) }));
  res.json(withSplits);
});

router.post("/", (req, res) => {
  const { description, amount, paidBy, splitType, participants, customAmounts } = req.body || {};
  if (!description || !description.trim()) return res.status(400).json({ error: "Description is required." });
  const amt = round2(Number(amount));
  if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number." });
  if (!paidBy) return res.status(400).json({ error: "Who paid is required." });
  if (!Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: "Pick at least one person to split between." });
  }
  if (!["equal", "custom"].includes(splitType)) {
    return res.status(400).json({ error: "Split type must be equal or custom." });
  }

  let shares;
  if (splitType === "equal") {
    const share = round2(amt / participants.length);
    shares = participants.map((uid) => ({ userId: uid, amount: share }));
    // adjust last share for rounding remainder so shares sum exactly to amt
    const sum = round2(shares.reduce((s, x) => s + x.amount, 0));
    const diff = round2(amt - sum);
    if (diff !== 0) shares[shares.length - 1].amount = round2(shares[shares.length - 1].amount + diff);
  } else {
    if (!customAmounts || typeof customAmounts !== "object") {
      return res.status(400).json({ error: "Custom split amounts are required." });
    }
    shares = participants.map((uid) => ({ userId: uid, amount: round2(Number(customAmounts[uid])) }));
    const sum = round2(shares.reduce((s, x) => s + x.amount, 0));
    // Hard validation: block submission unless the custom split sums exactly to the total.
    if (Math.abs(sum - amt) > 0.01) {
      return res.status(400).json({
        error: `Custom split amounts must add up to $${amt.toFixed(2)} (currently $${sum.toFixed(2)}).`,
      });
    }
  }

  const billId = nanoid();
  db.prepare(
    `INSERT INTO bills (id, household_id, description, amount, paid_by, split_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(billId, req.params.householdId, description.trim(), amt, paidBy, splitType);
  const insertSplit = db.prepare(
    "INSERT INTO bill_splits (id, bill_id, user_id, share_amount) VALUES (?, ?, ?, ?)"
  );
  for (const s of shares) insertSplit.run(nanoid(), billId, s.userId, s.amount);

  res.json({ id: billId });
});

router.delete("/:billId", (req, res) => {
  db.prepare("DELETE FROM bill_splits WHERE bill_id = ?").run(req.params.billId);
  db.prepare("DELETE FROM bills WHERE id = ? AND household_id = ?").run(
    req.params.billId,
    req.params.householdId
  );
  res.json({ ok: true });
});

// net balance per member: positive = owed to them, negative = they owe
router.get("/balances/summary", (req, res) => {
  const members = db
    .prepare(
      `SELECT u.id, u.email FROM household_members m JOIN users u ON u.id = m.user_id
       WHERE m.household_id = ?`
    )
    .all(req.params.householdId);
  const balances = {};
  members.forEach((m) => (balances[m.id] = 0));

  const bills = db.prepare("SELECT * FROM bills WHERE household_id = ?").all(req.params.householdId);
  const splitsStmt = db.prepare("SELECT * FROM bill_splits WHERE bill_id = ?");
  for (const b of bills) {
    const splits = splitsStmt.all(b.id);
    for (const s of splits) {
      if (s.user_id === b.paid_by) continue;
      balances[s.user_id] = round2((balances[s.user_id] || 0) - s.share_amount);
      balances[b.paid_by] = round2((balances[b.paid_by] || 0) + s.share_amount);
    }
  }

  const settlements = db
    .prepare("SELECT * FROM settlements WHERE household_id = ?")
    .all(req.params.householdId);
  for (const s of settlements) {
    // from_user paid to_user, so from_user's debt decreases (balance goes up toward 0), to_user's credit decreases
    balances[s.from_user] = round2((balances[s.from_user] || 0) + s.amount);
    balances[s.to_user] = round2((balances[s.to_user] || 0) - s.amount);
  }

  res.json(members.map((m) => ({ userId: m.id, email: m.email, balance: balances[m.id] || 0 })));
});

// --- settle up (honor system: either person in the pair can record it) ---
router.post("/settle", (req, res) => {
  const { toUserId, amount } = req.body || {};
  const amt = round2(Number(amount));
  if (!toUserId || !amt || amt <= 0) {
    return res.status(400).json({ error: "A recipient and positive amount are required." });
  }
  db.prepare(
    "INSERT INTO settlements (id, household_id, from_user, to_user, amount) VALUES (?, ?, ?, ?, ?)"
  ).run(nanoid(), req.params.householdId, req.user.id, toUserId, amt);
  res.json({ ok: true });
});

module.exports = router;
module.exports.round2 = round2;
