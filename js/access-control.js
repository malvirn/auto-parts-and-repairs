import supabase from "./supabaseClient.js";

const content = document.getElementById("access-control-content");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const ROLE_LABELS = { super_admin: "Super Admin", accounting: "Accounting", staff: "Staff" };

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { content.innerHTML = `<p style="color:var(--text-dim,#7c9490)">Not logged in.</p>`; return; }

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
  const { data: profiles, error } = await supabase.from("profiles").select("id, email, full_name, role, created_at").order("created_at");
  if (error) { content.innerHTML = `<p style="color:#ff4d4d;">Failed to load users: ${escapeHtml(error.message)}</p>`; return; }

  content.innerHTML = `
    <p style="color:var(--text-dim,#7c9490); font-size:.85rem; margin-bottom:14px;">
      <strong>Super Admin</strong> — full access, including this page.
      <strong>Accounting</strong> — the whole financial module (Ledger, Payables, Cash Book, Commissions, Landed Cost, Fixed Assets, Statements, Payroll).
      <strong>Staff</strong> — day-to-day operations only (Repairs, Customers, Shop, Receipts) — no financial data.
    </p>
    <table>
      <thead><tr><th>User</th><th>Current Role</th><th>Change To</th><th></th></tr></thead>
      <tbody id="access-control-table"></tbody>
    </table>
    <p id="access-control-message" class="form-message"></p>
  `;

  const tbody = document.getElementById("access-control-table");
  tbody.innerHTML = profiles.map(p => `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.full_name || p.email || "—")}${p.email ? `<div style="font-size:.78rem; color:var(--text-dim,#7c9490);">${escapeHtml(p.email)}</div>` : ""}</td>
      <td>${ROLE_LABELS[p.role] || p.role}</td>
      <td>
        <select class="role-select" ${p.id === myId ? "disabled" : ""}>
          <option value="super_admin" ${p.role === "super_admin" ? "selected" : ""}>Super Admin</option>
          <option value="accounting" ${p.role === "accounting" ? "selected" : ""}>Accounting</option>
          <option value="staff" ${p.role === "staff" ? "selected" : ""}>Staff</option>
        </select>
      </td>
      <td>
        ${p.id === myId
          ? `<span style="font-size:.78rem; color:var(--text-dim,#7c9490);">This is you</span>`
          : `<button type="button" class="btn save-role-btn"><i data-lucide="check"></i> Save</button>`}
      </td>
    </tr>
  `).join("");

  if (window.lucide) lucide.createIcons();

  tbody.querySelectorAll(".save-role-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const newRole = row.querySelector(".role-select").value;
      const message = document.getElementById("access-control-message");

      message.textContent = "Saving…"; message.dataset.tone = "info";
      const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", id);
      if (error) { message.textContent = "Failed: " + error.message; message.dataset.tone = "error"; return; }
      message.textContent = "Role updated. They'll see the change next time they load a page."; message.dataset.tone = "success";
      row.querySelector("td:nth-child(2)").textContent = ROLE_LABELS[newRole] || newRole;
    });
  });
}

document.addEventListener("DOMContentLoaded", init);