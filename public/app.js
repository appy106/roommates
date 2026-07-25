const root = document.getElementById("root");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

const state = {
  user: null,
  householdId: null,
  household: null, // { id, name, myRole, members }
  tab: "headsup",
  error: null,
  loading: true,
};

const COLORS = ["#E3A343", "#6FA8A0", "#C97B63", "#8FA6C9", "#A98FC9", "#8FC98F"];
function colorFor(email) {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % COLORS.length;
  return COLORS[h];
}
function initials(email) {
  return email.slice(0, 2).toUpperCase();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function avatarHtml(email, size) {
  size = size || 26;
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${colorFor(email)};font-size:${size * 0.42}px;">${initials(email)}</div>`;
}

async function boot() {
  try {
    const me = await api("/auth/me");
    state.user = me;
    if (me.households.length === 0) {
      state.view = "setup";
    } else {
      state.householdId = me.lastHouseholdId && me.households.some((h) => h.id === me.lastHouseholdId)
        ? me.lastHouseholdId
        : me.households[0].id;
      await loadHousehold();
      state.view = "app";
    }
  } catch (e) {
    state.view = "login";
  }
  state.loading = false;
  render();
}

async function loadHousehold() {
  state.household = await api(`/households/${state.householdId}`);
}

async function switchHousehold(id) {
  state.householdId = id;
  await api("/auth/last-household", { method: "POST", body: { householdId: id } });
  await loadHousehold();
  state.tab = "headsup";
  render();
}

// ---------- render dispatch ----------
function render() {
  state.error = null;
  if (state.loading) {
    root.innerHTML = `<p class="muted">Loading…</p>`;
    return;
  }
  if (state.view === "login") return renderLogin();
  if (state.view === "setup") return renderHouseholdSetup();
  if (state.view === "app") return renderApp();
}

// ---------- login / signup ----------
function renderLogin(mode = "login", errMsg = "") {
  root.innerHTML = `
    <h1 class="brand">The board</h1>
    <p class="muted" style="margin-bottom:20px;">Sign in to your household.</p>
    <div class="card">
      <div class="tabs" style="margin-bottom:16px;">
        <div class="tab ${mode === "login" ? "active" : ""}" id="tab-login">Log in</div>
        <div class="tab ${mode === "signup" ? "active" : ""}" id="tab-signup">Sign up</div>
      </div>
      <div class="stack">
        <input id="email" type="email" placeholder="name@example.com" />
        <input id="password" type="password" placeholder="Password (min 8 characters)" />
        ${errMsg ? `<div class="error">${esc(errMsg)}</div>` : ""}
        <button class="btn-primary" id="submit-auth">${mode === "login" ? "Log in" : "Create account"}</button>
        ${mode === "login" ? `<a href="#" id="forgot" class="muted">Forgot password?</a>` : ""}
      </div>
    </div>
  `;
  document.getElementById("tab-login").onclick = () => renderLogin("login");
  document.getElementById("tab-signup").onclick = () => renderLogin("signup");
  const forgotLink = document.getElementById("forgot");
  if (forgotLink) forgotLink.onclick = (e) => { e.preventDefault(); renderForgot(); };
  document.getElementById("submit-auth").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    try {
      await api(mode === "login" ? "/auth/login" : "/auth/signup", { method: "POST", body: { email, password } });
      state.loading = true;
      render();
      await boot();
    } catch (e) {
      renderLogin(mode, e.message);
    }
  };
}

function renderForgot() {
  root.innerHTML = `
    <h1 class="brand">Reset your password</h1>
    <div class="card stack">
      <input id="email" type="email" placeholder="name@example.com" />
      <button class="btn-primary" id="send">Send reset link</button>
      <div id="msg"></div>
      <a href="#" id="back" class="muted">Back to log in</a>
    </div>
  `;
  document.getElementById("back").onclick = (e) => { e.preventDefault(); renderLogin("login"); };
  document.getElementById("send").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const res = await api("/auth/forgot-password", { method: "POST", body: { email } });
    const msg = document.getElementById("msg");
    msg.className = "success";
    msg.textContent = "If that email has an account, a reset link has been sent.";
    if (res.devLink) {
      msg.innerHTML += `<br/><span class="muted">Dev mode — no email server configured, so here's the link directly: <a href="${res.devLink}">${res.devLink}</a></span>`;
    }
  };
}

// ---------- household setup (create or join) ----------
function renderHouseholdSetup(errMsg = "") {
  root.innerHTML = `
    <h1 class="brand">The board</h1>
    <p class="muted" style="margin-bottom:20px;">Create a household, or join one with an invite code.</p>
    <div class="card stack">
      <strong>Create a household</strong>
      <input id="hh-name" placeholder="e.g. Maple St." />
      <button class="btn-primary" id="create-hh">Create</button>
    </div>
    <div class="card stack">
      <strong>Join with an invite code</strong>
      <input id="invite-code" placeholder="Invite code" />
      <button class="btn-primary" id="join-hh">Join</button>
    </div>
    ${errMsg ? `<div class="error">${esc(errMsg)}</div>` : ""}
    <button class="btn-ghost" id="logout">Log out</button>
  `;
  document.getElementById("logout").onclick = doLogout;
  document.getElementById("create-hh").onclick = async () => {
    try {
      const name = document.getElementById("hh-name").value.trim();
      const h = await api("/households", { method: "POST", body: { name } });
      state.householdId = h.id;
      await loadHousehold();
      state.view = "app";
      render();
    } catch (e) { renderHouseholdSetup(e.message); }
  };
  document.getElementById("join-hh").onclick = async () => {
    try {
      const code = document.getElementById("invite-code").value.trim();
      const h = await api("/households/join", { method: "POST", body: { code } });
      state.householdId = h.id;
      await loadHousehold();
      state.view = "app";
      render();
    } catch (e) { renderHouseholdSetup(e.message); }
  };
}

async function doLogout() {
  await api("/auth/logout", { method: "POST" });
  location.reload();
}

// ---------- main app shell ----------
function renderApp() {
  const h = state.household;
  const me = state.user;
  root.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="brand">The board</h1>
        <div class="muted">${esc(h.name)}</div>
      </div>
      <div class="inline">
        ${h && h.members.length ? "" : ""}
        <select id="household-switch">
          ${me.households.map((x) => `<option value="${x.id}" ${x.id === state.householdId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
        </select>
        ${avatarHtml(me.email, 28)}
        <button class="btn-ghost" id="logout">Log out</button>
      </div>
    </div>
    <div class="tabs" id="tabs">
      ${tabDef().map((t) => `<div class="tab ${state.tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</div>`).join("")}
    </div>
    <div id="tab-content"></div>
    <div style="margin-top:24px; text-align:right;">
      <a href="#" id="new-household" class="muted">+ create or join another household</a>
    </div>
  `;
  document.getElementById("logout").onclick = doLogout;
  document.getElementById("household-switch").onchange = (e) => switchHousehold(e.target.value);
  document.getElementById("new-household").onclick = (e) => { e.preventDefault(); state.view = "setup"; render(); };
  document.querySelectorAll("#tabs .tab").forEach((el) => {
    el.onclick = () => { state.tab = el.dataset.tab; render(); };
  });
  renderTabContent();
}

function tabDef() {
  const t = [
    { id: "headsup", label: "Heads up" },
    { id: "groceries", label: "Groceries" },
    { id: "chores", label: "Chores" },
    { id: "bills", label: "Bills" },
  ];
  if (state.household.myRole === "admin" || true) t.push({ id: "admin", label: "Household" });
  return t;
}

async function renderTabContent() {
  const el = document.getElementById("tab-content");
  el.innerHTML = `<p class="muted">Loading…</p>`;
  if (state.tab === "headsup") return renderHeadsUp(el);
  if (state.tab === "groceries") return renderGroceries(el);
  if (state.tab === "chores") return renderChores(el);
  if (state.tab === "bills") return renderBills(el);
  if (state.tab === "admin") return renderAdmin(el);
}

// ---------- Heads up ----------
async function renderHeadsUp(el) {
  const data = await api(`/households/${state.householdId}/heads-up`);
  if (data.allCaughtUp) {
    el.innerHTML = `<div class="empty">You're all caught up.</div>`;
    return;
  }
  let html = "";
  if (data.balance < 0) {
    html += `<div class="row" style="border-color:#5A3A36; background:#3A2A28;">
      <span class="badge-overdue">●</span>
      <div style="flex:1;">You owe <strong>$${Math.abs(data.balance).toFixed(2)}</strong> total across bills</div>
    </div>`;
  } else if (data.balance > 0) {
    html += `<div class="row"><span style="color:#8FC98F;">●</span><div style="flex:1;">You're owed <strong>$${data.balance.toFixed(2)}</strong> total</div></div>`;
  }
  data.chores.forEach((c) => {
    const label = c.status === "overdue" ? "overdue" : c.status === "due_today" ? "due today" : c.nextDue ? `due ${c.nextDue}` : "";
    html += `<div class="row">
      <span class="${c.status === "overdue" ? "badge-overdue" : "badge-upcoming"}">●</span>
      <div style="flex:1;">${esc(c.task)} <span class="muted">${label}</span></div>
    </div>`;
  });
  data.groceries.forEach((g) => {
    html += `<div class="row"><span class="badge-upcoming">●</span><div style="flex:1;">${esc(g.name)} <span class="muted">still on the list</span></div></div>`;
  });
  el.innerHTML = html || `<div class="empty">You're all caught up.</div>`;
}

// ---------- Groceries ----------
async function renderGroceries(el) {
  const items = await api(`/households/${state.householdId}/groceries`);
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  el.innerHTML = `
    <div class="inline" style="margin-bottom:16px;">
      <input id="new-item" placeholder="Add a grocery item" style="flex:1;" />
      <button class="btn-primary" id="add-item">Add</button>
    </div>
    ${pending.length === 0 && done.length === 0 ? `<div class="empty">The list is empty.</div>` : ""}
    <div id="pending-list">${pending.map(groceryRow).join("")}</div>
    ${done.length ? `<div class="muted" style="margin:14px 0 8px; font-size:12px; text-transform:uppercase;">In the cart</div>${done.map(groceryRow).join("")}` : ""}
  `;
  function groceryRow(g) {
    return `<div class="row" style="${g.done ? "opacity:0.55;" : ""}">
      <input type="checkbox" ${g.done ? "checked" : ""} data-id="${g.id}" class="g-check" />
      <div style="flex:1; ${g.done ? "text-decoration:line-through;" : ""}">${esc(g.name)}</div>
      <span class="muted">${g.added_by_email ? esc(g.added_by_email.split("@")[0]) : ""}</span>
      <button class="btn-ghost" data-id="${g.id}" class="g-del" style="padding:2px 8px;">×</button>
    </div>`;
  }
  document.getElementById("add-item").onclick = async () => {
    const input = document.getElementById("new-item");
    if (!input.value.trim()) return;
    await api(`/households/${state.householdId}/groceries`, { method: "POST", body: { name: input.value.trim() } });
    renderTabContent();
  };
  el.querySelectorAll(".g-check").forEach((cb) => {
    cb.onchange = async () => {
      await api(`/households/${state.householdId}/groceries/${cb.dataset.id}`, { method: "PATCH", body: { done: cb.checked } });
      renderTabContent();
    };
  });
  el.querySelectorAll("[class~='g-del']").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/households/${state.householdId}/groceries/${btn.dataset.id}`, { method: "DELETE" });
      renderTabContent();
    };
  });
}

// ---------- Chores ----------
async function renderChores(el) {
  const chores = await api(`/households/${state.householdId}/chores`);
  const members = state.household.members;
  el.innerHTML = `
    <div class="card stack">
      <input id="chore-name" placeholder="Add a chore" />
      <div class="inline">
        <select id="chore-type">
          <option value="manual">Manual</option>
          <option value="auto">Auto-rotating</option>
        </select>
        <select id="chore-assignee">${members.map((m) => `<option value="${m.id}">${esc(m.email)}</option>`).join("")}</select>
        <select id="chore-freq" style="display:none;">
          <option value="daily">Daily</option>
          <option value="weekly" selected>Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <button class="btn-primary" id="add-chore">Add</button>
      </div>
    </div>
    ${chores.length === 0 ? `<div class="empty">No chores yet.</div>` : ""}
    <div id="chore-list">${chores.map(choreRow).join("")}</div>
  `;
  function choreRow(c) {
    const email = c.assigned_to_email || "Unassigned";
    return `<div class="row" style="${c.done ? "opacity:0.55;" : ""}">
      ${avatarHtml(email !== "Unassigned" ? email : "??", 22)}
      <div style="flex:1;">
        <div style="${c.done ? "text-decoration:line-through;" : ""}">${esc(c.task)}</div>
        <div class="muted">${email} · ${c.assignment_type === "auto" ? c.frequency : "manual"}${c.next_due ? " · due " + c.next_due : ""}</div>
      </div>
      <button class="btn-ghost pass-btn" data-id="${c.id}" style="padding:4px 8px;">↻</button>
      <button class="btn-ghost done-btn" data-id="${c.id}" data-done="${c.done}" style="padding:4px 8px;">✓</button>
      <button class="btn-ghost del-btn" data-id="${c.id}" style="padding:4px 8px;">×</button>
    </div>`;
  }
  document.getElementById("chore-type").onchange = (e) => {
    document.getElementById("chore-freq").style.display = e.target.value === "auto" ? "block" : "none";
  };
  document.getElementById("add-chore").onclick = async () => {
    const task = document.getElementById("chore-name").value.trim();
    if (!task) return;
    const assignmentType = document.getElementById("chore-type").value;
    const assignedTo = document.getElementById("chore-assignee").value;
    const frequency = document.getElementById("chore-freq").value;
    try {
      await api(`/households/${state.householdId}/chores`, {
        method: "POST",
        body: { task, assignmentType, assignedTo, frequency: assignmentType === "auto" ? frequency : null },
      });
      renderTabContent();
    } catch (e) { alert(e.message); }
  };
  el.querySelectorAll(".pass-btn").forEach((b) => b.onclick = async () => {
    await api(`/households/${state.householdId}/chores/${b.dataset.id}/pass`, { method: "POST" });
    renderTabContent();
  });
  el.querySelectorAll(".done-btn").forEach((b) => b.onclick = async () => {
    const isDone = b.dataset.done === "1";
    await api(`/households/${state.householdId}/chores/${b.dataset.id}`, { method: "PATCH", body: { done: !isDone } });
    renderTabContent();
  });
  el.querySelectorAll(".del-btn").forEach((b) => b.onclick = async () => {
    await api(`/households/${state.householdId}/chores/${b.dataset.id}`, { method: "DELETE" });
    renderTabContent();
  });
}

// ---------- Bills ----------
async function renderBills(el) {
  const [bills, balances] = await Promise.all([
    api(`/households/${state.householdId}/bills`),
    api(`/households/${state.householdId}/bills/balances/summary`),
  ]);
  const members = state.household.members;
  el.innerHTML = `
    <div class="inline" style="margin-bottom:16px; flex-wrap:wrap;">
      ${balances.map((b) => `<div class="pill">${avatarHtml(b.email, 20)} ${esc(b.email.split("@")[0])}
        <strong style="color:${b.balance > 0 ? "#8FC98F" : b.balance < 0 ? "#E08B7D" : "#93998C"};">
          ${b.balance > 0 ? "+$" + b.balance.toFixed(2) : b.balance < 0 ? "-$" + Math.abs(b.balance).toFixed(2) : "settled"}
        </strong>
        ${b.userId !== state.user.id && b.balance !== 0 ? `<button class="btn-ghost settle-btn" data-id="${b.userId}" style="padding:2px 8px;">Settle</button>` : ""}
      </div>`).join("")}
    </div>
    <div class="card stack">
      <input id="bill-desc" placeholder="What's the bill for?" />
      <div class="inline">
        <input id="bill-amount" type="number" step="0.01" placeholder="Amount" style="max-width:120px;" />
        <select id="bill-paidby">${members.map((m) => `<option value="${m.id}">${esc(m.email)} paid</option>`).join("")}</select>
        <select id="bill-splittype">
          <option value="equal">Equal split</option>
          <option value="custom">Custom split</option>
        </select>
      </div>
      <div class="inline" id="bill-participants">
        ${members.map((m) => `<label class="pill"><input type="checkbox" class="participant-cb" value="${m.id}" checked style="width:auto;" /> ${esc(m.email.split("@")[0])}</label>`).join("")}
      </div>
      <div id="custom-amounts" style="display:none;"></div>
      <div id="bill-error" class="error"></div>
      <button class="btn-primary" id="add-bill">Add bill</button>
    </div>
    ${bills.length === 0 ? `<div class="empty">No bills logged yet.</div>` : ""}
    <div>${bills.map(billRow).join("")}</div>
  `;
  function billRow(b) {
    return `<div class="row">
      <div style="flex:1;">
        <div>${esc(b.description)}</div>
        <div class="muted">${esc(b.paid_by_email.split("@")[0])} paid · split ${b.splits.length} way${b.splits.length > 1 ? "s" : ""} · ${b.date.slice(0, 10)}</div>
      </div>
      <div><strong>$${b.amount.toFixed(2)}</strong></div>
      <button class="btn-ghost del-bill" data-id="${b.id}" style="padding:2px 8px;">×</button>
    </div>`;
  }
  function refreshCustomAmounts() {
    const type = document.getElementById("bill-splittype").value;
    const box = document.getElementById("custom-amounts");
    if (type !== "custom") { box.style.display = "none"; return; }
    const checked = [...document.querySelectorAll(".participant-cb:checked")].map((c) => c.value);
    box.style.display = "block";
    box.innerHTML = checked.map((uid) => {
      const m = members.find((x) => x.id === uid);
      return `<div class="inline"><span style="width:140px;" class="muted">${esc(m.email.split("@")[0])}</span><input type="number" step="0.01" class="custom-amt" data-uid="${uid}" placeholder="0.00" style="max-width:100px;" /></div>`;
    }).join("");
  }
  document.getElementById("bill-splittype").onchange = refreshCustomAmounts;
  el.querySelectorAll(".participant-cb").forEach((cb) => cb.onchange = refreshCustomAmounts);
  document.getElementById("add-bill").onclick = async () => {
    const errBox = document.getElementById("bill-error");
    errBox.textContent = "";
    const description = document.getElementById("bill-desc").value.trim();
    const amount = parseFloat(document.getElementById("bill-amount").value);
    const paidBy = document.getElementById("bill-paidby").value;
    const splitType = document.getElementById("bill-splittype").value;
    const participants = [...document.querySelectorAll(".participant-cb:checked")].map((c) => c.value);
    const body = { description, amount, paidBy, splitType, participants };
    if (splitType === "custom") {
      const customAmounts = {};
      document.querySelectorAll(".custom-amt").forEach((inp) => { customAmounts[inp.dataset.uid] = parseFloat(inp.value) || 0; });
      body.customAmounts = customAmounts;
    }
    try {
      await api(`/households/${state.householdId}/bills`, { method: "POST", body });
      renderTabContent();
    } catch (e) { errBox.textContent = e.message; }
  };
  el.querySelectorAll(".del-bill").forEach((b) => b.onclick = async () => {
    await api(`/households/${state.householdId}/bills/${b.dataset.id}`, { method: "DELETE" });
    renderTabContent();
  });
  el.querySelectorAll(".settle-btn").forEach((b) => b.onclick = async () => {
    const bal = balances.find((x) => x.userId === state.user.id);
    const amt = prompt("Amount to mark as settled:", bal ? Math.abs(bal.balance).toFixed(2) : "0.00");
    if (!amt) return;
    await api(`/households/${state.householdId}/bills/settle`, { method: "POST", body: { toUserId: b.dataset.id, amount: parseFloat(amt) } });
    renderTabContent();
  });
}

// ---------- Household admin ----------
async function renderAdmin(el) {
  const h = await api(`/households/${state.householdId}`);
  state.household = h;
  const invite = await api(`/households/${state.householdId}/invite`);
  const isAdmin = h.myRole === "admin";
  el.innerHTML = `
    <div class="card stack">
      <strong>Household name</strong>
      <div class="inline">
        <input id="hh-rename" value="${esc(h.name)}" ${isAdmin ? "" : "disabled"} />
        ${isAdmin ? `<button class="btn-ghost" id="rename-btn">Save</button>` : ""}
      </div>
    </div>
    <div class="card stack">
      <strong>Invite link</strong>
      <div class="muted">Anyone with this link can join as a member.</div>
      <div class="inline"><input readonly value="${location.origin}${invite.link}" /> ${isAdmin ? `<button class="btn-ghost" id="regen-btn">Regenerate</button>` : ""}</div>
    </div>
    ${isAdmin ? `
    <div class="card stack">
      <strong>Add a member by email</strong>
      <div class="inline"><input id="add-email" placeholder="name@example.com" /><button class="btn-primary" id="add-member-btn">Add</button></div>
      <div id="add-member-msg" class="muted"></div>
    </div>` : ""}
    <div class="card">
      <strong>Members</strong>
      <div id="member-list" style="margin-top:10px;">${h.members.map(memberRow).join("")}</div>
    </div>
    <button class="btn-danger" id="leave-btn">Leave this household</button>
  `;
  function memberRow(m) {
    const isMe = m.id === state.user.id;
    return `<div class="row">
      ${avatarHtml(m.email, 22)}
      <div style="flex:1;">${esc(m.email)} ${isMe ? "<span class='muted'>(you)</span>" : ""}</div>
      <span class="muted">${m.role}</span>
      ${isAdmin ? `
        <button class="btn-ghost role-btn" data-id="${m.id}" data-role="${m.role === "admin" ? "member" : "admin"}" style="padding:2px 8px;">${m.role === "admin" ? "Demote" : "Promote"}</button>
        <button class="btn-ghost resetpw-btn" data-id="${m.id}" style="padding:2px 8px;">Reset pw</button>
        ${isMe ? "" : `<button class="btn-danger remove-btn" data-id="${m.id}" style="padding:2px 8px;">Remove</button>`}
      ` : ""}
    </div>`;
  }
  if (isAdmin) {
    document.getElementById("rename-btn").onclick = async () => {
      await api(`/households/${state.householdId}`, { method: "PATCH", body: { name: document.getElementById("hh-rename").value.trim() } });
      renderTabContent();
    };
    document.getElementById("regen-btn").onclick = async () => {
      await api(`/households/${state.householdId}/invite/regenerate`, { method: "POST" });
      renderTabContent();
    };
    document.getElementById("add-member-btn").onclick = async () => {
      const email = document.getElementById("add-email").value.trim();
      try {
        const r = await api(`/households/${state.householdId}/members`, { method: "POST", body: { email } });
        const msg = document.getElementById("add-member-msg");
        msg.textContent = `Added. Setup link sent to ${r.email}.`;
        if (r.devSetupLink) msg.innerHTML += `<br/>Dev mode link: <a href="${r.devSetupLink}">${location.origin}${r.devSetupLink}</a>`;
        renderTabContent();
      } catch (e) { alert(e.message); }
    };
    el.querySelectorAll(".role-btn").forEach((b) => b.onclick = async () => {
      try {
        await api(`/households/${state.householdId}/members/${b.dataset.id}/role`, { method: "POST", body: { role: b.dataset.role } });
        renderTabContent();
      } catch (e) { alert(e.message); }
    });
    el.querySelectorAll(".resetpw-btn").forEach((b) => b.onclick = async () => {
      const r = await api(`/households/${state.householdId}/members/${b.dataset.id}/reset-password`, { method: "POST" });
      alert(`Reset link sent to ${r.sentTo}.` + (r.devLink ? `\n\nDev mode link: ${location.origin}${r.devLink}` : ""));
    });
    el.querySelectorAll(".remove-btn").forEach((b) => b.onclick = async () => {
      if (!confirm("Remove this member from the household?")) return;
      try {
        await api(`/households/${state.householdId}/members/${b.dataset.id}`, { method: "DELETE" });
        renderTabContent();
      } catch (e) { alert(e.message); }
    });
  }
  document.getElementById("leave-btn").onclick = async () => {
    if (!confirm("Leave this household?")) return;
    try {
      await api(`/households/${state.householdId}/leave`, { method: "POST" });
      location.reload();
    } catch (e) { alert(e.message); }
  };
}

boot();
