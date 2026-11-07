import supabase from "./supabaseClient.js";

const unlockForm = document.getElementById("payroll-unlock-form");
const workspace = document.getElementById("payroll-workspace");
const unlockMessage = document.getElementById("payroll-unlock-message");
const runForm = document.getElementById("payroll-run-form");
const runMessage = document.getElementById("payroll-run-message");
const employeesBody = document.getElementById("payroll-employees-body");
const history = document.getElementById("payroll-history");
const payslip = document.getElementById("payroll-payslip");
const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Date(2000, index, 1).toLocaleString("en", { month: "long" }));

let employees = [];
let payrollBusy = false;
let currentPayslip = null;

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function setMessage(element, text, tone = "error") {
  element.textContent = text;
  element.dataset.tone = tone;
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.innerHTML = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
    window.lucide?.createIcons();
  }
}

function setupPeriodFields() {
  const now = new Date();
  const harareDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const dateParts = Object.fromEntries(harareDate.map(part => [part.type, part.value]));
  const year = document.getElementById("payroll-year");
  const month = document.getElementById("payroll-month");
  const date = document.getElementById("payroll-pay-date");
  year.value = dateParts.year;
  month.innerHTML = monthNames.map((name, index) =>
    `<option value="${index + 1}">${name}</option>`).join("");
  month.value = String(Number(dateParts.month));
  date.value = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

async function loadEmployees() {
  const { data, error } = await supabase.from("technicians")
    .select("id, full_name, department, salary, deductions, email, phone, is_active")
    .order("full_name");
  if (error) throw new Error("Couldn't load employees: " + error.message);
  employees = (data || []).filter(employee => employee.is_active !== false);
  employeesBody.innerHTML = employees.length ? employees.map(employee => `
    <tr data-employee-id="${escapeHtml(employee.id)}">
      <td><strong>${escapeHtml(employee.full_name)}</strong><small>${escapeHtml(employee.department || "")}</small></td>
      <td>${money(employee.salary)}</td>
      <td><input type="number" class="payroll-overtime-hours" min="0" step="0.25" value="0" aria-label="Overtime hours for ${escapeHtml(employee.full_name)}"></td>
      <td><input type="number" class="payroll-bonus" min="0" step="0.01" value="0" aria-label="One-off bonus for ${escapeHtml(employee.full_name)}"></td>
      <td>${money(employee.deductions)}</td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-state">No active employees to pay.</td></tr>`;
  if (window.lucide) window.lucide.createIcons();
}

async function loadHistory() {
  const { data: runs, error } = await supabase.from("payroll_runs")
    .select("id, year, month, pay_date, total_amount")
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(12);
  if (error) throw new Error("Couldn't load payroll history: " + error.message);
  if (!runs?.length) {
    history.innerHTML = `<p class="section-note">No payroll runs yet.</p>`;
    return;
  }
  history.innerHTML = runs.map(run => `
    <article class="payroll-run-card">
      <div class="payroll-run-head">
        <strong>${escapeHtml(monthNames[Number(run.month) - 1] || "Month")} ${Number(run.year)}</strong>
        <span>${money(run.total_amount)} net · paid ${escapeHtml(run.pay_date || "—")}</span>
      </div>
      <button type="button" class="btn payroll-view-run" data-run-id="${escapeHtml(run.id)}">
        <i data-lucide="file-text"></i> View payslips
      </button>
    </article>
  `).join("");
  if (window.lucide) window.lucide.createIcons();
  history.querySelectorAll(".payroll-view-run").forEach(button => {
    button.addEventListener("click", () => showRunPayslips(button.dataset.runId));
  });
}

unlockForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = unlockForm.querySelector('button[type="submit"]');
  setBusy(button, true, "Verifying…");
  unlockMessage.textContent = "";
  try {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) throw new Error("Your session has expired. Sign in again.");
    const email = document.getElementById("payroll-admin-email").value.trim();
    const passwordInput = document.getElementById("payroll-admin-password");
    const password = passwordInput.value;
    const { data: login, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    passwordInput.value = "";
    if (loginError || !login.user) throw new Error("Super Admin sign-in failed. Check the email and password.");

    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("role, access_level")
      .eq("id", login.user.id)
      .single();
    if (profileError) throw new Error("Couldn't verify the account's access level: " + profileError.message);
    const normalizedRole = String(profile.role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const isSuperAdmin = Number(profile.access_level) >= 2 || ["super_admin", "superadmin"].includes(normalizedRole);
    if (!isSuperAdmin) {
      await supabase.auth.signOut();
      throw new Error("This payroll page requires a Super Admin account. Sign in again with an authorized account.");
    }

    await loadEmployees();
    await loadHistory();
    workspace.hidden = false;
    unlockForm.hidden = true;
    unlockMessage.textContent = "";
  } catch (error) {
    console.error("Payroll access check failed:", error);
    setMessage(unlockMessage, error.message || String(error));
  } finally {
    setBusy(button, false);
  }
});

async function processPayroll(event) {
  event.preventDefault();
  if (payrollBusy) return;
  payrollBusy = true;
  const button = document.getElementById("payroll-run-submit");
  setBusy(button, true, "Processing payroll…");
  runMessage.textContent = "";

  try {
    const year = Number(document.getElementById("payroll-year").value);
    const month = Number(document.getElementById("payroll-month").value);
    const payDateValue = document.getElementById("payroll-pay-date").value;
    if (!Number.isInteger(year) || year < 2020 || !Number.isInteger(month) || month < 1 || month > 12 || !payDateValue) {
      throw new Error("Choose a valid payroll month, year, and pay date.");
    }
    if (!employees.length) throw new Error("There are no active employees to pay.");

    const { data: existingRun, error: existingRunError } = await supabase.from("payroll_runs")
      .select("id").eq("year", year).eq("month", month).maybeSingle();
    if (existingRunError) throw new Error("Couldn't check for an existing payroll run: " + existingRunError.message);
    if (existingRun) throw new Error("Payroll for this month has already been processed.");

    const employeeRows = [...employeesBody.querySelectorAll("tr[data-employee-id]")];
    const adjustments = new Map(employeeRows.map(row => [
      row.dataset.employeeId,
      {
        overtimeHours: Number(row.querySelector(".payroll-overtime-hours").value),
        bonus: Number(row.querySelector(".payroll-bonus").value),
      },
    ]));
    const { data: unpaidCommissions, error: commissionsError } = await supabase.from("commissions")
      .select("id, employee_id, commission_amount").eq("status", "unpaid");
    if (commissionsError) throw new Error("Couldn't load unpaid commissions: " + commissionsError.message);
    const commissionByEmployee = new Map();
    (unpaidCommissions || []).forEach(commission => {
      const amount = Number(commission.commission_amount || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("An unpaid commission has an invalid amount. Correct it before processing payroll.");
      }
      commissionByEmployee.set(commission.employee_id,
        (commissionByEmployee.get(commission.employee_id) || 0) + amount);
    });

    const payments = employees.map(employee => {
      const salary = Number(employee.salary || 0);
      const deductions = Number(employee.deductions || 0);
      const adjustment = adjustments.get(employee.id) || { overtimeHours: 0, bonus: 0 };
      if (!Number.isFinite(salary) || salary < 0 || !Number.isFinite(deductions) || deductions < 0) {
        throw new Error(`Salary and deductions must be valid non-negative amounts for ${employee.full_name}.`);
      }
      if (!Number.isFinite(adjustment.overtimeHours) || adjustment.overtimeHours < 0 ||
          !Number.isFinite(adjustment.bonus) || adjustment.bonus < 0) {
        throw new Error(`Enter valid overtime hours and a non-negative bonus for ${employee.full_name}.`);
      }
      const overtimeAmount = roundMoney(salary / 208 * 1.5 * adjustment.overtimeHours);
      const bonusAmount = roundMoney(adjustment.bonus);
      const commission = commissionByEmployee.get(employee.id) || 0;
      const gross = roundMoney(salary + overtimeAmount + bonusAmount + commission);
      if (deductions > gross) throw new Error(`Deductions exceed gross pay for ${employee.full_name}.`);
      return {
        employee_id: employee.id,
        employee_name: employee.full_name,
        department: employee.department,
        gross_salary: salary,
        overtime_hours: adjustment.overtimeHours,
        overtime_amount: overtimeAmount,
        bonus_amount: bonusAmount,
        deductions,
        commission_amount: commission,
        net_pay: roundMoney(gross - deductions),
      };
    });
    const totalNet = roundMoney(payments.reduce((sum, payment) => sum + payment.net_pay, 0));
    const totalGrossPlusCommission = roundMoney(payments.reduce((sum, payment) =>
      sum + payment.gross_salary + payment.overtime_amount + payment.bonus_amount + payment.commission_amount, 0));
    const totalDeductions = roundMoney(payments.reduce((sum, payment) => sum + payment.deductions, 0));
    const period = new Date(year, month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
    if (!await window.aprConfirm(`Process payroll for ${payments.length} active employees for ${period}? Net pay will total ${money(totalNet)}. This action cannot be undone here.`, { title: "Confirm payroll", confirmLabel: "Process payroll", danger: true })) return;

    const { data: accounts, error: accountError } = await supabase.from("accounts").select("id, code");
    if (accountError) throw new Error("Couldn't load payroll ledger accounts: " + accountError.message);
    const wagesExpense = accounts?.find(account => account.code === "5100");
    const bankAccount = accounts?.find(account => account.code === "1010");
    const taxPayable = accounts?.find(account => account.code === "2200");
    if (!wagesExpense || !bankAccount || (totalDeductions > 0 && !taxPayable)) {
      throw new Error("The Wages Expense (5100), Bank (1010), or Tax Payable (2200) ledger account is missing.");
    }

    const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
      entry_date: payDateValue,
      description: `Payroll for ${period}`,
      source_type: "payroll",
    }]).select().single();
    if (entryError) throw new Error("Failed to post payroll to the ledger: " + entryError.message);

    const journalLines = [{ account_id: wagesExpense.id, debit: totalGrossPlusCommission, credit: 0 }];
    if (totalDeductions > 0) journalLines.push({ account_id: taxPayable.id, debit: 0, credit: totalDeductions });
    journalLines.push({ account_id: bankAccount.id, debit: 0, credit: totalNet });
    const { error: linesError } = await supabase.from("journal_lines").insert(
      journalLines.map(line => ({ ...line, journal_entry_id: entry.id })));
    if (linesError) {
      const { error: cleanupError } = await supabase.from("journal_entries").delete().eq("id", entry.id);
      throw new Error(`Failed to post payroll ledger lines: ${linesError.message}${cleanupError ? ` Cleanup also failed: ${cleanupError.message}` : ""}`);
    }

    const { data: run, error: runError } = await supabase.from("payroll_runs").insert([{
      year, month, pay_date: payDateValue, total_amount: totalNet, journal_entry_id: entry.id,
    }]).select().single();
    if (runError) {
      const { error: cleanupError } = await supabase.from("journal_entries").delete().eq("id", entry.id);
      throw new Error(`Ledger posted but payroll run could not be saved: ${runError.message}${cleanupError ? ` Cleanup also failed: ${cleanupError.message}` : ""}`);
    }

    const { error: paymentsError } = await supabase.from("payroll_payments")
      .insert(payments.map(payment => ({ ...payment, payroll_run_id: run.id })));
    if (paymentsError) {
      throw new Error(`Payroll run was created, but employee payslip records could not be saved: ${paymentsError.message}. Contact a Super Admin before retrying.`);
    }

    const paidEmployeeIds = new Set(payments.map(payment => payment.employee_id));
    const commissionIds = (unpaidCommissions || [])
      .filter(commission => paidEmployeeIds.has(commission.employee_id))
      .map(commission => commission.id);
    if (commissionIds.length) {
      const { error: commissionUpdateError } = await supabase.from("commissions")
        .update({ status: "paid", payroll_run_id: run.id }).in("id", commissionIds);
      if (commissionUpdateError) {
        throw new Error(`Payroll was posted, but commissions could not be marked paid: ${commissionUpdateError.message}. Contact a Super Admin.`);
      }
    }

    setMessage(runMessage, `Payroll for ${period} processed. ${payments.length} payslips are ready below.`, "success");
    await loadHistory();
    await showRunPayslips(run.id);
  } catch (error) {
    console.error("Payroll processing failed:", error);
    setMessage(runMessage, error.message || String(error));
  } finally {
    payrollBusy = false;
    setBusy(button, false);
  }
}

function payslipText(payment, run) {
  const period = `${monthNames[Number(run.month) - 1] || "Month"} ${run.year}`;
  return [
    `Centric Auto Mobile payslip — ${period}`,
    `Employee: ${payment.employee_name}`,
    `Department: ${payment.department || "—"}`,
    `Basic salary: ${money(payment.gross_salary)}`,
    `Overtime (${Number(payment.overtime_hours || 0)} hours): ${money(payment.overtime_amount)}`,
    `Bonus: ${money(payment.bonus_amount)}`,
    `Commission: ${money(payment.commission_amount)}`,
    `Deductions: ${money(payment.deductions)}`,
    `Net pay: ${money(payment.net_pay)}`,
    `Pay date: ${run.pay_date || "—"}`,
  ].join("\n");
}

function renderPayslip(payment, run) {
  const text = payslipText(payment, run);
  const html = `
    <div class="payroll-run-head"><div><p class="section-kicker">Centric Auto Mobile</p><h3>Payslip · ${escapeHtml(monthNames[Number(run.month) - 1] || "Month")} ${Number(run.year)}</h3></div><strong>Net pay ${money(payment.net_pay)}</strong></div>
    <p>${escapeHtml(payment.employee_name)} · ${escapeHtml(payment.department || "—")} · Pay date ${escapeHtml(run.pay_date || "—")}</p>
    <table class="payslip-table"><tbody>
      <tr><th>Basic salary</th><td>${money(payment.gross_salary)}</td></tr>
      <tr><th>Overtime · ${Number(payment.overtime_hours || 0)} hours</th><td>${money(payment.overtime_amount)}</td></tr>
      <tr><th>One-off bonus</th><td>${money(payment.bonus_amount)}</td></tr>
      <tr><th>Commission</th><td>${money(payment.commission_amount)}</td></tr>
      <tr><th>Deductions</th><td>− ${money(payment.deductions)}</td></tr>
      <tr><th>Net pay</th><td><strong>${money(payment.net_pay)}</strong></td></tr>
    </tbody></table>
    <div class="payslip-actions">
      <button type="button" class="btn btn--primary" data-payslip-action="print"><i data-lucide="printer"></i> Print payslip</button>
      <button type="button" class="btn" data-payslip-action="email"><i data-lucide="mail"></i> Email draft</button>
      <button type="button" class="btn" data-payslip-action="whatsapp"><i data-lucide="message-circle"></i> WhatsApp</button>
    </div>
  `;
  payslip.innerHTML = html;
  payslip.hidden = false;
  currentPayslip = { payment, run, text, html };
  if (window.lucide) window.lucide.createIcons();
}

async function showRunPayslips(runId) {
  const { data: run, error: runError } = await supabase.from("payroll_runs")
    .select("id, year, month, pay_date, total_amount").eq("id", runId).single();
  if (runError) {
    setMessage(runMessage, "Couldn't load the payroll run: " + runError.message);
    return;
  }
  const { data: payments, error: paymentsError } = await supabase.from("payroll_payments")
    .select("employee_id, employee_name, department, gross_salary, overtime_hours, overtime_amount, bonus_amount, deductions, commission_amount, net_pay")
    .eq("payroll_run_id", runId).order("employee_name");
  if (paymentsError) {
    setMessage(runMessage, "Couldn't load payslips: " + paymentsError.message);
    return;
  }
  history.querySelector(".payroll-payslip-list")?.remove();
  const list = document.createElement("div");
  list.className = "payroll-payslip-list";
  list.innerHTML = (payments || []).map((payment, index) => `
    <button type="button" class="btn payroll-view-payslip" data-payslip-index="${index}">
      <i data-lucide="user-round"></i> ${escapeHtml(payment.employee_name)} · ${money(payment.net_pay)}
    </button>
  `).join("") || `<p class="section-note">No payslip records were saved for this run.</p>`;
  history.append(list);
  if (window.lucide) window.lucide.createIcons();
  list.querySelectorAll(".payroll-view-payslip").forEach(button => {
    button.addEventListener("click", () => renderPayslip(payments[Number(button.dataset.payslipIndex)], run));
  });
  if (payments?.length) renderPayslip(payments[0], run);
}

payslip.addEventListener("click", event => {
  const button = event.target.closest("[data-payslip-action]");
  if (!button || !currentPayslip) return;
  const { payment, run, text, html } = currentPayslip;
  if (button.dataset.payslipAction === "print") {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setMessage(runMessage, "Allow pop-ups to print this payslip.");
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>Payslip</title><style>body{font:15px Arial,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:24px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}td{text-align:right}h3{margin-bottom:8px}@media print{body{margin:0}}</style></head><body>${html.replace(/<div class="payslip-actions">[\s\S]*?<\/div>/, "")}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  } else if (button.dataset.payslipAction === "email") {
    const employee = employees.find(item => item.id === payment.employee_id);
    if (!employee?.email) {
      setMessage(runMessage, `No email address is recorded for ${payment.employee_name}.`);
      return;
    }
    window.location.href = `mailto:${encodeURIComponent(employee.email)}?subject=${encodeURIComponent("Payslip - " + monthNames[Number(run.month) - 1] + " " + run.year)}&body=${encodeURIComponent(text)}`;
  } else if (button.dataset.payslipAction === "whatsapp") {
    const employee = employees.find(item => item.id === payment.employee_id);
    let phone = String(employee?.phone || "").replace(/\D/g, "");
    if (phone.startsWith("0")) phone = `263${phone.slice(1)}`;
    else if (phone.startsWith("7")) phone = `263${phone}`;
    if (!phone) {
      setMessage(runMessage, `No phone number is recorded for ${payment.employee_name}.`);
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }
});

document.getElementById("payroll-refresh").addEventListener("click", async () => {
  try {
    await loadEmployees();
    await loadHistory();
    setMessage(runMessage, "Employee payroll and history refreshed.", "success");
  } catch (error) {
    setMessage(runMessage, error.message || String(error));
  }
});

runForm.addEventListener("submit", processPayroll);
setupPeriodFields();
