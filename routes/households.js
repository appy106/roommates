const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const {
  requireAuth,
  requireMembership,
  requireAdmin,
  hashPassword,
  createPasswordToken,
  logSimulatedEmail,
  DEV_MODE,
} = require("../auth");

const router = express.Router();
router.use(requireAuth);

// create a household -> creator becomes admin
router.post("/", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Household name is required." });
  const id = nanoid();
  db.prepare("INSERT INTO households (id, name) VALUES (?, ?)").run(id, name.trim());
  db.prepare(
    "INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, 'admin')"
  ).run(nanoid(), id, req.user.id);
  db.prepare("UPDATE users SET last_household_id = ? WHERE id = ?").run(id, req.user.id);
  res.json({ id, name: name.trim(), role: "admin" });
});

// join via invite code -> regular member
router.post("/join", (req, res) => {
  const { code } = req.body || {};
  const invite = db.prepare("SELECT * FROM invites WHERE code = ? AND active = 1").get(code);
  if (!invite) return res.status(404).json({ error: "That invite link is invalid or has been revoked." });
  const already = db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(invite.household_id, req.user.id);
  if (!already) {
    db.prepare(
      "INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, 'member')"
    ).run(nanoid(), invite.household_id, req.user.id);
  }
  db.prepare("UPDATE users SET last_household_id = ? WHERE id = ?").run(invite.household_id, req.user.id);
  const h = db.prepare("SELECT * FROM households WHERE id = ?").get(invite.household_id);
  res.json({ id: h.id, name: h.name, role: already ? already.role : "member" });
});

router.use("/:householdId", requireMembership);

router.get("/:householdId", (req, res) => {
  const h = db.prepare("SELECT * FROM households WHERE id = ?").get(req.params.householdId);
  const members = db
    .prepare(
      `SELECT u.id, u.email, m.role FROM household_members m
       JOIN users u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY u.email`
    )
    .all(req.params.householdId);
  res.json({ id: h.id, name: h.name, myRole: req.membership.role, members });
});

router.patch("/:householdId", requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Household name is required." });
  db.prepare("UPDATE households SET name = ? WHERE id = ?").run(name.trim(), req.params.householdId);
  res.json({ ok: true });
});

// --- invites: any member can view/create; only admin can revoke/regenerate ---
router.get("/:householdId/invite", (req, res) => {
  let invite = db
    .prepare("SELECT * FROM invites WHERE household_id = ? AND active = 1")
    .get(req.params.householdId);
  if (!invite) {
    const code = nanoid(10);
    db.prepare(
      "INSERT INTO invites (id, household_id, code, active) VALUES (?, ?, ?, 1)"
    ).run(nanoid(), req.params.householdId, code);
    invite = { code };
  }
  res.json({ code: invite.code, link: `/join.html?code=${invite.code}` });
});

router.post("/:householdId/invite/regenerate", requireAdmin, (req, res) => {
  db.prepare("UPDATE invites SET active = 0 WHERE household_id = ?").run(req.params.householdId);
  const code = nanoid(10);
  db.prepare(
    "INSERT INTO invites (id, household_id, code, active) VALUES (?, ?, ?, 1)"
  ).run(nanoid(), req.params.householdId, code);
  res.json({ code, link: `/join.html?code=${code}` });
});

// --- members ---
router.post("/:householdId/members", requireAdmin, (req, res) => {
  const { email } = req.body || {};
  if (!email || !email.trim()) return res.status(400).json({ error: "Email is required." });
  const cleanEmail = email.trim().toLowerCase();
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(cleanEmail);
  if (!user) {
    const id = require("nanoid").nanoid();
    db.prepare(
      "INSERT INTO users (id, email, password_hash, needs_password_setup) VALUES (?, ?, NULL, 1)"
    ).run(id, cleanEmail);
    user = { id, email: cleanEmail };
  }
  const already = db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(req.params.householdId, user.id);
  if (already) return res.status(409).json({ error: "That person is already a member." });
  db.prepare(
    "INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, 'member')"
  ).run(nanoid(), req.params.householdId, user.id);

  const token = createPasswordToken(user.id, "setup");
  const link = `/reset-password.html?token=${token}&setup=1`;
  logSimulatedEmail(user.email, "You've been added to a household — set your password", link);
  res.json({ ok: true, email: user.email, devSetupLink: DEV_MODE ? link : undefined });
});

router.delete("/:householdId/members/:userId", requireAdmin, (req, res) => {
  const { userId } = req.params;
  const admins = db
    .prepare("SELECT COUNT(*) as n FROM household_members WHERE household_id = ? AND role = 'admin'")
    .get(req.params.householdId).n;
  const target = db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(req.params.householdId, userId);
  if (!target) return res.status(404).json({ error: "That person isn't a member." });
  if (target.role === "admin" && admins <= 1) {
    return res.status(400).json({ error: "Promote another admin before removing the last one." });
  }
  db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(
    req.params.householdId,
    userId
  );
  res.json({ ok: true });
});

router.post("/:householdId/members/:userId/role", requireAdmin, (req, res) => {
  const { role } = req.body || {};
  if (!["admin", "member"].includes(role)) return res.status(400).json({ error: "Invalid role." });
  const admins = db
    .prepare("SELECT COUNT(*) as n FROM household_members WHERE household_id = ? AND role = 'admin'")
    .get(req.params.householdId).n;
  const target = db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(req.params.householdId, req.params.userId);
  if (!target) return res.status(404).json({ error: "That person isn't a member." });
  if (target.role === "admin" && role === "member" && admins <= 1) {
    return res.status(400).json({ error: "A household needs at least one admin." });
  }
  db.prepare(
    "UPDATE household_members SET role = ? WHERE household_id = ? AND user_id = ?"
  ).run(role, req.params.householdId, req.params.userId);
  res.json({ ok: true });
});

// admin-triggered password reset for a member who's locked out
router.post("/:householdId/members/:userId/reset-password", requireAdmin, (req, res) => {
  const target = db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(req.params.householdId, req.params.userId);
  if (!target) return res.status(404).json({ error: "That person isn't a member." });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId);
  const token = createPasswordToken(user.id, "reset");
  const link = `/reset-password.html?token=${token}`;
  logSimulatedEmail(user.email, "Reset your password", link);
  // The admin never sees the member's actual password — only a link, sent to the member's email.
  res.json({ ok: true, sentTo: user.email, devLink: DEV_MODE ? link : undefined });
});

// leave household voluntarily
router.post("/:householdId/leave", (req, res) => {
  const admins = db
    .prepare("SELECT COUNT(*) as n FROM household_members WHERE household_id = ? AND role = 'admin'")
    .get(req.params.householdId).n;
  if (req.membership.role === "admin" && admins <= 1) {
    return res.status(400).json({ error: "Promote another admin before leaving." });
  }
  db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(
    req.params.householdId,
    req.user.id
  );
  res.json({ ok: true });
});

module.exports = router;
