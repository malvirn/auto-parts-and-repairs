import supabase from "./supabaseClient.js";

const content = document.getElementById("access-control-content");
let myEmail = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const ROLE_LABELS = { super_admin: "Super Admin", accounting: "Accounting", staff: "Staff" };

// ---------- Password re-confirmation modal ----------
// The real security boundary is the database RLS policy (super_admin
// only, enforced regardless of what this UI does) — this is a second,
// deliberate layer: even a super_admin's own already-logged-in session
// has to re-prove identity before a role actually changes, so a
// left-unlocked screen or hijacked session can't silently promote
// someone.

function injectConfirmModal() {
  if (document.getElementById("role-confirm-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "role-confirm-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:3000;";
  overlay.innerHTML = `
    <div style="background:var(--panel,#10161c); border:1px solid rgba(56,224,201,0.2); border-radius:8px; padding:22px; width:100%; max-width:360px;">
      <h3 style="margin-top:0;">Confirm Your Password</h3>
      <p style="font-size:.85rem; color:var(--text-dim,#7c9490); margin-bottom:14px;" id="role-confirm-detail"></p>
      <div class="field"><label>Your Password</label><input type="password" id="role-confirm-password" /></div>
      <p id="role-confirm-message" class="form-message"></p>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button id="role-confirm-submit" type="button" class="btn btn--primary"><i data-lucide="check"></i> Confirm</button>
        <button id="role-confirm-cancel" type="button" class="btn"><i data-lucide="x"></i> Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();
}

function askForPasswordConfirmation(detailText) {
  return new Promise((resolve) => {
    injectConfirmModal();
    const overlay = document.getElementById("role-confirm-overlay");
    const detail = document.getElementById("role-confirm-detail");
    const passwordInput = document.getElementById("role-confirm-password");
    const message = document.getElementById("role-confirm-message");
    const submitBtn = document.getElementById("role-confirm-submit");
    const cancelBtn = document.getElementById("role-confirm-cancel");

    detail.textContent = detailText;
    passwordInput.value = "";
    message.textContent = "";
    overlay.style.display = "flex";
    passwordInput.focus();

    const cleanup = (result) => { overlay.style.display = "none"; resolve(result); };

    submitBtn.onclick = async () => {
      const password = passwordInput.value;
      if (!password) { message.textContent = "Enter your password."; message.dataset.tone = "error"; return; }
      submitBtn.disabled = true;
      message.textContent = "Verifying…"; message.dataset.tone = "info";
      const { error } = await supabase.auth.signInWithPassword({ email: myEmail, password });
      submitBtn.disabled = false;
      if (error) { message.textContent = "Incorrect password."; message.dataset.tone = "error"; return; }
      cleanup(true);
    };
    cancelBtn.onclick = () => cleanup(false);
  });
}

// ---------- Main ----------

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { content.innerHTML = `<p style="color:var(--text-dim,#7c9490)">Not logged in.</p>`; return; }
  myEmail = user.email;

  const { data: myProfile, error: myError } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (myError || !myProfile) { content.innerHTML = `<p style="color:var(--text-dim,#7c9490)">Couldn't determine your role.</p>`; return; }

  if (myProfile.role !== "super_admin") {
    content.innerHTML = `
      <p style="color:var(--text-dim,#7c9490); font-size:.88rem;">
        Only Super Admins can view or change who has access to what. Your current role is
        <strong>${ROLE_LABELS[myProfile.role] || myProfile.role}</strong>.
      </p>
    `;
    return;
  }

  await renderRoster(user.id);
}

async function renderRoster(myId) {
  const { data: profiles, error } = await supabase.from("profiles").select("id, email, full_name, role, is_active, created_at").order("created_at");
  if (error) { content.innerHTML = `<p style="color:#ff4d4d;">Failed to load users: ${escapeHtml(error.message)}</p>`; return; }

  content.innerHTML = `
    <p style="color:var(--text-dim,#7c9490); font-size:.85rem; margin-bottom:14px;">
      <strong>Super Admin</strong> — full access, including this page and individual salaries.
      <strong>Accounting</strong> — Ledger, Payables, Cash Book, Commissions, Landed Cost, Fixed Assets, Statements. No payroll/salary access, no customer or vehicle data, and repair jobs / sales orders are read-only.
      <strong>Staff</strong> — day-to-day operations (Repairs, Customers, Shop, Receipts) — no financial data at all.
    </p>
    <p style="color:var(--text-dim,#7c9490); font-size:.82rem; margin-bottom:14px;">
      <strong>Terminate</strong> reversibly blocks a login without deleting it — flip it back anytime. <strong>Delete</strong> permanently removes the login itself; there's no undo.
    </p>
    <table>
      <thead><tr><th>User</th><th>Role</th><th>Change To</th><th>Status</th><th></th></tr></thead>
      <tbody id="access-control-table"></tbody>
    </table>
    <p id="access-control-message" class="form-message"></p>
  `;

  const tbody = document.getElementById("access-control-table");
  tbody.innerHTML = profiles.map(p => `
    <tr data-id="${p.id}" data-name="${escapeHtml(p.full_name || p.email || "this user")}">
      <td>${escapeHtml(p.full_name || p.email || "—")}${p.email ? `<div style="font-size:.78rem; color:var(--text-dim,#7c9490);">${escapeHtml(p.email)}</div>` : ""}</td>
      <td>${ROLE_LABELS[p.role] || p.role}</td>
      <td>
        <select class="role-select" ${p.id === myId ? "disabled" : ""}>
          <option value="super_admin" ${p.role === "super_admin" ? "selected" : ""}>Super Admin</option>
          <option value="accounting" ${p.role === "accounting" ? "selected" : ""}>Accounting</option>
          <option value="staff" ${p.role === "staff" ? "selected" : ""}>Staff</option>
        </select>
        ${p.id === myId ? "" : `<button type="button" class="btn save-role-btn" style="margin-left:6px;"><i data-lucide="check"></i></button>`}
      </td>
      <td>${p.is_active !== false ? `<span style="color:var(--success,#2e7d4f);">Active</span>` : `<span style="color:var(--danger,#ff4d4d);">Terminated</span>`}</td>
      <td>
        ${p.id === myId
          ? `<span style="font-size:.78rem; color:var(--text-dim,#7c9490);">This is you</span>`
          : `
            <button type="button" class="btn terminate-btn">${p.is_active !== false ? "Terminate" : "Reactivate"}</button>
            <button type="button" class="btn delete-user-btn" style="border-color:#ff4d4d; color:#ff4d4d;">Delete</button>
          `}
      </td>
    </tr>
  `).join("");

  if (window.lucide) lucide.createIcons();

  tbody.querySelectorAll(".save-role-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const name = row.dataset.name;
      const newRole = row.querySelector(".role-select").value;
      const message = document.getElementById("access-control-message");

      const confirmed = await askForPasswordConfirmation(`Confirm your password to change ${name}'s role to ${ROLE_LABELS[newRole]}.`);
      if (!confirmed) { message.textContent = "Cancelled — role was not changed."; message.dataset.tone = "info"; return; }

      message.textContent = "Saving…"; message.dataset.tone = "info";
      const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", id);
      if (error) { message.textContent = "Failed: " + error.message; message.dataset.tone = "error"; return; }
      message.textContent = "Role updated. They'll see the change next time they load a page."; message.dataset.tone = "success";
      row.children[1].textContent = ROLE_LABELS[newRole] || newRole;
    });
  });

  tbody.querySelectorAll(".terminate-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const name = row.dataset.name;
      const message = document.getElementById("access-control-message");
      const currentlyActive = btn.textContent.trim() === "Terminate";

      const confirmed = await askForPasswordConfirmation(`Confirm your password to ${currentlyActive ? "terminate" : "reactivate"} ${name}'s login.`);
      if (!confirmed) { message.textContent = "Cancelled."; message.dataset.tone = "info"; return; }

      message.textContent = "Saving…"; message.dataset.tone = "info";
      const { error } = await supabase.from("profiles").update({ is_active: !currentlyActive }).eq("id", id);
      if (error) { message.textContent = "Failed: " + error.message; message.dataset.tone = "error"; return; }
      message.textContent = currentlyActive ? "Login terminated — they'll be signed out next time they load a page." : "Login reactivated."; message.dataset.tone = "success";
      renderRoster(myId);
    });
  });

  tbody.querySelectorAll(".delete-user-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const name = row.dataset.name;
      const message = document.getElementById("access-control-message");

      if (!confirm(`Permanently delete ${name}'s login? This cannot be undone.`)) return;
      const confirmed = await askForPasswordConfirmation(`Confirm your password to permanently delete ${name}'s login.`);
      if (!confirmed) { message.textContent = "Cancelled — nothing was deleted."; message.dataset.tone = "info"; return; }

      message.textContent = "Deleting…"; message.dataset.tone = "info";
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { targetUserId: id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || data?.error) { message.textContent = "Failed: " + (data?.error || error.message); message.dataset.tone = "error"; return; }
      message.textContent = "Login permanently deleted."; message.dataset.tone = "success";
      renderRoster(myId);
    });
  });
}

document.addEventListener("DOMContentLoaded", init);