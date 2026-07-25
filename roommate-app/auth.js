const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { nanoid } = require("nanoid");
const db = require("./db");

// In a real deployment this MUST come from a secret manager / env var,
// never a hardcoded fallback. The fallback here only exists so this
// demo runs out of the box; replace before shipping.
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
const SESSION_COOKIE = "session";

// --- password hashing ---
function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}
function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}
function isPasswordStrongEnough(plain) {
  return typeof plain === "string" && plain.length >= 8;
}

// --- sessions (JWT in httpOnly cookie) ---
function issueSession(res, userId) {
  const token = jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function clearSession(res) {
  res.clearCookie(SESSION_COOKIE);
}
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare("SELECT id, email, last_household_id FROM users WHERE id = ?")
      .get(payload.uid);
    if (!user) return res.status(401).json({ error: "Not signed in." });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Sign in again." });
  }
}

// --- household membership / role authorization ---
// Always checked server-side against the DB — never trust a client-claimed role.
function requireMembership(req, res, next) {
  const householdId = req.params.householdId;
  const membership = db
    .prepare(
      "SELECT * FROM household_members WHERE household_id = ? AND user_id = ?"
    )
    .get(householdId, req.user.id);
  if (!membership) return res.status(403).json({ error: "Not a member of this household." });
  req.membership = membership;
  next();
}
function requireAdmin(req, res, next) {
  if (req.membership.role !== "admin") {
    return res.status(403).json({ error: "Admin role required for this action." });
  }
  next();
}

// --- single-use, time-limited tokens for password setup / reset ---
// In production these get emailed. Here (no email infra in this environment)
// they're returned via the API only when DEV_MODE is on, and always logged
// server-side, so the flow is demonstrable without wiring a real mail provider.
const DEV_MODE = process.env.DEV_MODE !== "false";

function createPasswordToken(userId, purpose) {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  db.prepare(
    "INSERT INTO password_tokens (token, user_id, purpose, expires_at, used) VALUES (?, ?, ?, ?, 0)"
  ).run(token, userId, purpose, expiresAt);
  return token;
}
function consumePasswordToken(token) {
  const row = db.prepare("SELECT * FROM password_tokens WHERE token = ?").get(token);
  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  db.prepare("UPDATE password_tokens SET used = 1 WHERE token = ?").run(token);
  return row;
}
function logSimulatedEmail(to, subject, link) {
  // Stand-in for a real transactional email provider (SES, Postmark, etc).
  console.log(`\n[simulated email] To: ${to}\nSubject: ${subject}\nLink: ${link}\n`);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough,
  issueSession,
  clearSession,
  requireAuth,
  requireMembership,
  requireAdmin,
  createPasswordToken,
  consumePasswordToken,
  logSimulatedEmail,
  DEV_MODE,
};
