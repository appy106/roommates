# The board — roommate household app

Groceries, chores, and bill-splitting for a shared household, built to match the
PRD: email/password accounts, multi-household support with a switcher, per-household
admin/member roles, a "Heads up" personalized summary, equal/custom bill splits,
and honor-system settle-up.

## Stack
- **Backend**: Node.js + Express, using Node's built-in `node:sqlite` (no native
  compilation required — works out of the box).
- **Frontend**: plain HTML/CSS/JS, no build step.
- **Auth**: email + password, bcrypt-hashed, JWT session in an httpOnly cookie.

## Running it locally
```
npm install
npm start
```
Then open http://localhost:3000. The database (`data.sqlite`) is created
automatically on first run in the project folder.

## Deploying it so it's reachable from a phone, anywhere
Running locally only works while your computer is on and on the same
network as your phone. To get a real URL your roommates can open from
anywhere:

1. Push this folder to a GitHub repo (or use Render's "public Git repo" option).
2. On [Render](https://render.com), New → Blueprint → point it at the repo.
   `render.yaml` in this project is already set up: it provisions a free
   web service with a persistent disk for the SQLite file.
3. Render gives you a URL like `https://the-board-xxxx.onrender.com`. That's
   what you (and your roommates) open on your phones.

Any Node host works the same way (Railway, Fly.io, a VPS) — the only things
that matter are: run `npm install && npm start`, set `JWT_SECRET` to a real
secret, and give the SQLite file a persistent disk to live on so data
survives redeploys (see `DATA_DIR` below).

**Important**: `DEV_MODE` defaults to `true` in `render.yaml`, which means
password reset/setup links are exposed directly in the API response rather
than actually emailed — necessary right now since no real email provider is
wired in (see "Email" below), but it means anyone who knows an account's
email can get that account's reset link. Fine for a household of people who
trust each other testing this out; wire up real email and set `DEV_MODE=false`
before treating it as production-grade.

## Installing it like an app on your iPhone
Once it's deployed to a real URL (not localhost):
1. Open the URL in Safari.
2. Tap the Share icon → **Add to Home Screen**.
3. It launches full-screen with its own icon, no browser chrome — this is a
   PWA (manifest + service worker + iOS meta tags are already set up), not a
   native App Store app, but it behaves like one.

## Environment variables
| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Server port |
| `JWT_SECRET` | a dev fallback | **Must** be set to a real secret before any real deployment |
| `DEV_MODE` | `true` | See "Email" below — set to `false` once real email is wired up |
| `DATA_DIR` | project folder | Where `data.sqlite` lives — point this at a persistent disk on your host |
| `NODE_ENV` | unset | Set to `production` on a real deploy — enables secure cookies |

## Email — read this before using it for real
There's no email provider wired in. Password-reset links, admin-triggered
resets, and admin-added-member setup links are:
1. Logged to the server console (`[simulated email] ...`), and
2. Returned directly in the API response **only when `DEV_MODE=true`**, so you
   can click through the flow without a mail server.

Before this goes anywhere real, swap `logSimulatedEmail()` in `auth.js` for an
actual provider (Postmark, SES, Resend, etc.) and set `DEV_MODE=false` so
tokens are never exposed to the client — only emailed to the account holder.

## Security notes (already implemented, listed here so they're visible)
- Passwords hashed with bcrypt (cost factor 12), never logged or stored plain.
- Minimum 8-character password enforced at signup/reset.
- Login attempts rate-limited per email (8 attempts / 15 minutes).
- Password reset/setup tokens are single-use and expire after 1 hour.
- Session cookies are httpOnly; enable the `secure` flag in `auth.js` once
  served over HTTPS.
- Every household-scoped route re-checks the caller's membership and role
  server-side (`requireMembership` / `requireAdmin`) — the client's claimed
  role is never trusted.
- Admin-added accounts get a setup link, not a visible password — an admin
  never sees a member's actual password, even briefly.

## What's implemented (v1 per the PRD)
- Email/password accounts; self sign-up or admin-added.
- Multiple households per account with a switcher; roles are per-household.
- Invite links: any member can share, only admins can revoke/regenerate.
- Admin tools: add member by email, remove member, reset a member's
  password, rename household, promote/demote admin. A household always
  keeps at least one admin.
- Groceries: add, check off, see who added what.
- Chores: manual assignment, or auto-rotation on a daily/weekly/monthly
  cadence; manual "pass it on" works alongside auto-rotation; a removed
  member is skipped in future rotations.
- Bills: equal or custom splits (custom must sum exactly to the total —
  blocked otherwise), running per-person balances, honor-system settle-up.
- "Heads up": per-user landing view aggregating overdue/upcoming chores,
  pending groceries, and net balance.

## What's not built (intentionally deferred — see PRD section 5)
Push/email delivery of reminders, payment processing, photo receipts,
grocery categorization, comments, and combined cross-household views.

## Known simplifications for this build
- No real email delivery (see above).
- No automated background job to advance overdue auto-rotating chores if
  nobody opens the app — "next due" is computed on read/complete, not on a
  schedule. Fine for the MVP's usage pattern (frequent check-ins) but worth
  a proper scheduler if that assumption doesn't hold in practice.
- Single-process in-memory rate limiting — fine for one server instance,
  would need a shared store (e.g. Redis) behind a load balancer.
