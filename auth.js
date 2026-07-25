const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const {
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough,
  issueSession,
  clearSession,
  requireAuth,
  createPasswordToken,
  consumePasswordToken,
  logSimulatedEmail,
  DEV_MODE,
} = require("../auth");

const router = express.Router();

// simple login rate limiting per email (in-memory; fine for a single-process demo)
const loginAttempts = new Map();
function isRateLimited(email) {
  const rec = loginAttempts.get(email);
  if (!rec) return false;
  const { count, firstAttempt } = rec;
  if (Date.now() - firstAttempt > 15 * 60 * 1000) {
    loginAttempts.delete(email);
    return false;
  }
  return count >= 8;
}
function recordFailedAttempt(email) {
  const rec = loginAttempts.get(email) || { count: 0, firstAttempt: Date.now() };
  rec.count += 1;
  loginAttempts.set(email, rec);
}
function clearAttempts(email) {
  loginAttempts.delete(email);
}

router.post("/signup", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (!isPasswordStrongEnough(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const id = nanoid();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, needs_password_setup) VALUES (?, ?, ?, 0)"
  ).run(id, email.toLowerCase(), hashPassword(password));
  issueSession(res, id);
  res.json({ id, email: email.toLowerCase() });
});

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const key = email.toLowerCase();
  if (isRateLimited(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again later." });
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(key);
  if (!user || user.needs_password_setup || !verifyPassword(password, user.password_hash)) {
    recordFailedAttempt(key);
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  clearAttempts(key);
  issueSession(res, user.id);
  res.json({ id: user.id, email: user.email });
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  const households = db
    .prepare(
      `SELECT h.id, h.name, m.role
       FROM household_members m JOIN households h ON h.id = m.household_id
       WHERE m.user_id = ? ORDER BY h.name`
    )
    .all(req.user.id);
  res.json({ id: req.user.id, email: req.user.email, lastHouseholdId: req.user.last_household_id, households });
});

router.post("/last-household", requireAuth, (req, res) => {
  const { householdId } = req.body || {};
  db.prepare("UPDATE users SET last_household_id = ? WHERE id = ?").run(householdId, req.user.id);
  res.json({ ok: true });
});

// --- forgot password (self-service) ---
router.post("/forgot-password", (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  // Always respond the same way whether or not the account exists, to avoid leaking which emails are registered.
  if (user) {
    const token = createPasswordToken(user.id, "reset");
    const link = `/reset-password.html?token=${token}`;
    logSimulatedEmail(user.email, "Reset your password", link);
    if (DEV_MODE) return res.json({ ok: true, devLink: link });
  }
  res.json({ ok: true });
});

router.post("/reset-password", (req, res) => {
  const { token, password } = req.body || {};
  if (!isPasswordStrongEnough(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const row = consumePasswordToken(token);
  if (!row || (row.purpose !== "reset" && row.purpose !== "setup")) {
    return res.status(400).json({ error: "That reset link is invalid or has expired." });
  }
  db.prepare(
    "UPDATE users SET password_hash = ?, needs_password_setup = 0 WHERE id = ?"
  ).run(hashPassword(password), row.user_id);
  issueSession(res, row.user_id);
  res.json({ ok: true });
});

module.exports = router;
