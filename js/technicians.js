// ========= Team module =========
import supabase from "./supabaseClient.js";

// Rank ladders, low to high — order here drives both the dropdown order
// and which end of each department's hierarchy list an employee sits at.
const RANKS = {
  "Mechanics": ["Apprentice", "Junior Mechanic", "Mechanic", "Senior Mechanic", "Workshop Foreman"],
  "Sales & Customer Service": ["Sales Associate", "Senior Sales Associate", "Front Desk Supervisor", "Department Manager"],
  "Administration & Finance": ["Admin Clerk", "Accounts Clerk", "Accountant", "Department Manager"],
};
const DEPARTMENTS = Object.keys(RANKS);
const CONTRACT_WARNING_DAYS = 30;
const OFF_DAYS_PER_MONTH = 3;

const form = document.getElementById("employee-form");
const formMessage = document.getElementById("employee-form-message");
const tableBody = document.getElementById("employees-table");
const departmentsGrid = document.getElementById("departments-grid");
const generateAllBtn = document.getElementById("generate-all-off-days");

const empDepartmentSelect = document.getElementById("emp-department");
const empRankSelect = document.getElementById("emp-rank");

const modal = document.getElementById("employee-modal");
const editDepartmentSelect = document.getElementById("edit-emp-department");
const editRankSelect = document.getElementById("edit-emp-rank");
const editContractEnd = document.getElementById("edit-emp-contract-end");
const editContractWarning = document.getElementById("edit-emp-contract-warning");
const editOffDaysList = document.getElementById("edit-emp-off-days");
const editSaveBtn = document.getElementById("edit-emp-save");
const editRenewBtn = document.getElementById("edit-emp-renew");
const editTerminateBtn = document.getElementById("edit-emp-terminate");
const editCancelBtn = document.getElementById("edit-emp-cancel");
const editGenerateOffDaysBtn = document.getElementById("edit-emp-generate-off-days");

let allEmployees = [];
let currentEditId = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function populateDepartmentSelect(select) {
  select.innerHTML = `<option value="">Select…</option>` + DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join("");
}
function populateRankSelect(select, department) {
  const ranks = RANKS[department] || [];
  select.innerHTML = ranks.length
    ? ranks.map(r => `<option value="${r}">${r}</option>`).join("")
    : `<option value="">Select a department first…</option>`;
}

populateDepartmentSelect(empDepartmentSelect);
populateDepartmentSelect(editDepartmentSelect);
empDepartmentSelect.addEventListener("change", () => populateRankSelect(empRankSelect, empDepartmentSelect.value));
editDepartmentSelect.addEventListener("change", () => populateRankSelect(editRankSelect, editDepartmentSelect.value));
populateRankSelect(empRankSelect, "");

// ---- Contract expiry helper ----
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diff / 86400000);
}
function contractWarningLabel(employee) {
  const days = daysUntil(employee.contract_end);
  if (days === null) return "";
  if (days < 0) return `<span class="contract-warning"><i data-lucide="alert-triangle"></i> Contract expired ${Math.abs(days)}d ago</span>`;
  if (days <= CONTRACT_WARNING_DAYS) return `<span class="contract-warning"><i data-lucide="alert-triangle"></i> Expires in ${days}d</span>`;
  return "";
}

// ---- Load + render employee table ----
async function loadEmployees() {
  const { data, error } = await supabase
    .from("technicians")
    .select("*")
    .order("department")
    .order("full_name");

  if (error) {
    console.error("Error loading employees:", error);
    tableBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">Failed to load: ${error.message}</td></tr>`;
    return;
  }

  allEmployees = data || [];
  renderTable();
  renderDepartments();
}

function renderTable() {
  if (!allEmployees.length) {
    tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No employees yet — add one above.</td></tr>`;
    return;
  }
  tableBody.innerHTML = allEmployees.map(e => `
    <tr>
      <td><strong>${escapeHtml(e.full_name)}</strong></td>
      <td>${escapeHtml(e.department || "—")}</td>
      <td>${escapeHtml(e.rank || "—")}</td>
      <td>${escapeHtml(e.employee_type || "—")}</td>
      <td>
        ${e.is_active === false ? `<span class="badge badge--unclaimed">Terminated</span>` : `<span class="badge badge--ready">Active</span>`}
        ${contractWarningLabel(e)}
      </td>
      <td><button type="button" class="btn view-emp-btn" data-id="${e.id}"><i data-lucide="eye"></i> View</button></td>
    </tr>
  `).join("");
  if (window.lucide) lucide.createIcons();
  tableBody.querySelectorAll(".view-emp-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditModal(allEmployees.find(e => e.id === btn.dataset.id)));
  });
}

// ---- Departments & hierarchy ----
function renderDepartments() {
  departmentsGrid.innerHTML = DEPARTMENTS.map(dept => {
    const people = allEmployees.filter(e => e.department === dept && e.is_active !== false);
    const ranks = RANKS[dept];
    const tiers = [...ranks].reverse().map(rank => {
      const atThisRank = people.filter(p => p.rank === rank);
      if (!atThisRank.length) return "";
      return `
        <div class="rank-tier">
          <div class="rank-tier__label">${escapeHtml(rank)}</div>
          <div class="rank-tier__people">
            ${atThisRank.map(p => `
              <div class="hierarchy-person view-emp-btn" data-id="${p.id}">
                <span>${escapeHtml(p.full_name)}</span>
                <span class="off-count">${offDaysCountLabel(p.id)}</span>
              </div>
            `).join("")}
          </div>
        </div>`;
    }).join("");
    return `
      <div class="dept-card">
        <h3>${escapeHtml(dept)}</h3>
        <div class="dept-count">${people.length} active employee${people.length === 1 ? "" : "s"}</div>
        ${tiers || `<div class="empty-state" style="justify-content:flex-start;">No one in this department yet</div>`}
      </div>`;
  }).join("");

  departmentsGrid.querySelectorAll(".view-emp-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditModal(allEmployees.find(e => e.id === btn.dataset.id)));
  });
}

// ---- Off days: 3 per employee per month, random, never a Sunday ----
let offDaysCache = {}; // employeeId -> [dates] for the current month, filled lazily

function offDaysCountLabel(employeeId) {
  const days = offDaysCache[employeeId];
  if (!days) return "";
  return `${days.length}/${OFF_DAYS_PER_MONTH} off`;
}

function pickRandomOffDays(year, month) {
  // month is 1-indexed here
  const daysInMonth = new Date(year, month, 0).getDate();
  const candidates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getDay() !== 0) candidates.push(d); // exclude Sundays (getDay() === 0)
  }
  // Fisher-Yates shuffle, then take the first N
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, OFF_DAYS_PER_MONTH).sort((a, b) => a - b).map(d => {
    const mm = String(month).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  });
}

async function loadOffDaysForMonth(employeeId, year, month) {
  const { data, error } = await supabase
    .from("employee_off_days")
    .select("off_date")
    .eq("employee_id", employeeId)
    .eq("year", year)
    .eq("month", month);
  if (error) { console.error("Error loading off days:", error); return []; }
  return (data || []).map(r => r.off_date);
}

async function generateOffDays(employeeId, year, month, { reshuffle = false } = {}) {
  if (reshuffle) {
    await supabase.from("employee_off_days").delete().eq("employee_id", employeeId).eq("year", year).eq("month", month);
  } else {
    const existing = await loadOffDaysForMonth(employeeId, year, month);
    if (existing.length >= OFF_DAYS_PER_MONTH) return existing;
  }
  const dates = pickRandomOffDays(year, month);
  const rows = dates.map(off_date => ({ employee_id: employeeId, off_date, year, month }));
  const { error } = await supabase.from("employee_off_days").insert(rows);
  if (error) console.error("Error saving off days:", error);
  return dates;
}

async function refreshOffDaysCacheForCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const results = await Promise.all(allEmployees.map(async e => {
    const days = await loadOffDaysForMonth(e.id, year, month);
    return [e.id, days];
  }));
  offDaysCache = Object.fromEntries(results);
  renderDepartments(); // refresh the "X/3 off" labels now that we know
}

if (generateAllBtn) {
  generateAllBtn.addEventListener("click", async () => {
    if (!confirm(`Generate this month's 3 random off days (no Sundays) for every active employee who doesn't already have a full set?`)) return;
    generateAllBtn.disabled = true;
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth() + 1;
    for (const e of allEmployees.filter(e => e.is_active !== false)) {
      await generateOffDays(e.id, year, month);
    }
    await refreshOffDaysCacheForCurrentMonth();
    generateAllBtn.disabled = false;
    alert("Off days generated for this month.");
  });
}

function renderOffDaysInModal(dates) {
  editOffDaysList.innerHTML = dates.length
    ? dates.map(d => `<span class="off-day-chip">${new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>`).join("")
    : `<span style="color:var(--text-muted); font-size:.85rem;">Not generated yet this month.</span>`;
}

// ---- Add employee ----
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const full_name = document.getElementById("emp-name").value.trim();
  const department = empDepartmentSelect.value;
  const rank = empRankSelect.value;

  if (!full_name) { formMessage.textContent = "Full name is required."; formMessage.dataset.tone = "error"; return; }
  if (!department || !rank) { formMessage.textContent = "Department and rank are required."; formMessage.dataset.tone = "error"; return; }

  const payload = {
    full_name,
    date_of_birth: document.getElementById("emp-dob").value || null,
    gender: document.getElementById("emp-gender").value || null,
    phone: document.getElementById("emp-phone").value.trim() || null,
    alt_phone: document.getElementById("emp-alt-phone").value.trim() || null,
    email: document.getElementById("emp-email").value.trim() || null,
    home_address: document.getElementById("emp-address").value.trim() || null,
    job_title: document.getElementById("emp-job-title").value.trim() || null,
    department,
    rank,
    employee_type: document.getElementById("emp-type").value,
    contract_start: document.getElementById("emp-contract-start").value || null,
    contract_end: document.getElementById("emp-contract-end").value || null,
    salary: parseFloat(document.getElementById("emp-salary").value) || null,
    work_location: document.getElementById("emp-location").value.trim() || "Main Branch",
    account_number: document.getElementById("emp-account").value.trim() || null,
    deductions: parseFloat(document.getElementById("emp-deductions").value) || 0,
    deductions_notes: document.getElementById("emp-deductions-notes").value.trim() || null,
    is_active: true,
  };

  formMessage.textContent = "Saving…"; formMessage.dataset.tone = "info";
  const { error } = await supabase.from("technicians").insert([payload]);
  if (error) { formMessage.textContent = "Failed to add employee: " + error.message; formMessage.dataset.tone = "error"; return; }

  form.reset();
  populateRankSelect(empRankSelect, "");
  document.getElementById("emp-location").value = "Main Branch";
  formMessage.textContent = "Employee added."; formMessage.dataset.tone = "success";
  loadEmployees();
});

// ---- Edit modal ----
function openEditModal(employee) {
  if (!employee) return;
  currentEditId = employee.id;
  document.getElementById("emp-modal-name").textContent = employee.full_name;
  document.getElementById("edit-emp-name").value = employee.full_name || "";
  document.getElementById("edit-emp-dob").value = employee.date_of_birth || "";
  document.getElementById("edit-emp-gender").value = employee.gender || "";
  document.getElementById("edit-emp-phone").value = employee.phone || "";
  document.getElementById("edit-emp-alt-phone").value = employee.alt_phone || "";
  document.getElementById("edit-emp-email").value = employee.email || "";
  document.getElementById("edit-emp-address").value = employee.home_address || "";
  document.getElementById("edit-emp-job-title").value = employee.job_title || "";
  editDepartmentSelect.value = employee.department || "";
  populateRankSelect(editRankSelect, employee.department || "");
  editRankSelect.value = employee.rank || "";
  document.getElementById("edit-emp-type").value = employee.employee_type || "Full-time";
  document.getElementById("edit-emp-location").value = employee.work_location || "";
  document.getElementById("edit-emp-contract-start").value = employee.contract_start || "";
  editContractEnd.value = employee.contract_end || "";
  document.getElementById("edit-emp-salary").value = employee.salary ?? "";
  document.getElementById("edit-emp-account").value = employee.account_number || "";
  document.getElementById("edit-emp-deductions").value = employee.deductions ?? 0;
  document.getElementById("edit-emp-deductions-notes").value = employee.deductions_notes || "";
  document.getElementById("edit-emp-notes").value = employee.notes || "";
  editContractWarning.innerHTML = contractWarningLabel(employee);

  const now = new Date();
  loadOffDaysForMonth(employee.id, now.getFullYear(), now.getMonth() + 1).then(renderOffDaysInModal);

  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

editDepartmentSelect.addEventListener("change", () => populateRankSelect(editRankSelect, editDepartmentSelect.value));

function closeEditModal() {
  modal.classList.add("hidden");
  currentEditId = null;
}
editCancelBtn.addEventListener("click", closeEditModal);
modal.addEventListener("click", e => { if (e.target === modal) closeEditModal(); });

editSaveBtn.addEventListener("click", async () => {
  if (!currentEditId) return;
  const updates = {
    full_name: document.getElementById("edit-emp-name").value.trim(),
    date_of_birth: document.getElementById("edit-emp-dob").value || null,
    gender: document.getElementById("edit-emp-gender").value || null,
    phone: document.getElementById("edit-emp-phone").value.trim() || null,
    alt_phone: document.getElementById("edit-emp-alt-phone").value.trim() || null,
    email: document.getElementById("edit-emp-email").value.trim() || null,
    home_address: document.getElementById("edit-emp-address").value.trim() || null,
    job_title: document.getElementById("edit-emp-job-title").value.trim() || null,
    department: editDepartmentSelect.value || null,
    rank: editRankSelect.value || null,
    employee_type: document.getElementById("edit-emp-type").value,
    work_location: document.getElementById("edit-emp-location").value.trim() || null,
    contract_start: document.getElementById("edit-emp-contract-start").value || null,
    contract_end: editContractEnd.value || null,
    salary: parseFloat(document.getElementById("edit-emp-salary").value) || null,
    account_number: document.getElementById("edit-emp-account").value.trim() || null,
    deductions: parseFloat(document.getElementById("edit-emp-deductions").value) || 0,
    deductions_notes: document.getElementById("edit-emp-deductions-notes").value.trim() || null,
    notes: document.getElementById("edit-emp-notes").value.trim() || null,
  };
  const { error } = await supabase.from("technicians").update(updates).eq("id", currentEditId);
  if (error) { alert("Failed to save: " + error.message); return; }
  closeEditModal();
  loadEmployees();
});

editRenewBtn.addEventListener("click", () => {
  const newEnd = prompt("New contract end date (YYYY-MM-DD):", editContractEnd.value || "");
  if (!newEnd) return;
  editContractEnd.value = newEnd;
  editContractWarning.innerHTML = contractWarningLabel({ contract_end: newEnd });
  if (window.lucide) lucide.createIcons();
  alert("New end date set — click Save to confirm the renewal.");
});

editTerminateBtn.addEventListener("click", async () => {
  if (!currentEditId) return;
  if (!confirm("Mark this employee as terminated? Their record and history are kept, just flagged inactive.")) return;
  const { error } = await supabase.from("technicians").update({ is_active: false }).eq("id", currentEditId);
  if (error) { alert("Failed to update: " + error.message); return; }
  closeEditModal();
  loadEmployees();
});

editGenerateOffDaysBtn.addEventListener("click", async () => {
  if (!currentEditId) return;
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const existing = await loadOffDaysForMonth(currentEditId, year, month);
  const reshuffle = existing.length > 0 && confirm("Off days already exist for this month — reshuffle to new random dates?");
  if (existing.length > 0 && !reshuffle) return;
  const dates = await generateOffDays(currentEditId, year, month, { reshuffle: true });
  renderOffDaysInModal(dates);
  refreshOffDaysCacheForCurrentMonth();
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadEmployees();
  refreshOffDaysCacheForCurrentMonth();
});