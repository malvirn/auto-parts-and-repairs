import supabase from "./supabaseClient.js";

const panel = document.getElementById("customer-credit-panel");
const list = document.getElementById("customer-credit-list");
const refreshButton = document.getElementById("customer-credit-refresh");
if (!panel || !list) throw new Error("Customer credit panel is missing from the Receipts page.");

const money = value => `$${Number(value || 0).toFixed(2)}`;
const escapeHtml = value => {
  const node = document.createElement("div");
  node.textContent = value ?? "";
  return node.innerHTML;
};
const businessDate = value => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value || Date.now()));
const dateLabel = value => value ? new Date(`${value}T00:00:00+02:00`).toLocaleDateString("en-GB", {
  timeZone: "Africa/Harare", day: "2-digit", month: "short", year: "numeric",
}) : "—";

let creditNotes = [];
let movements = [];
let targets = [];
let accounts = [];
let canRefund = false;

function showMessage(message, tone = "info") {
  let status = document.getElementById("customer-credit-status");
  if (!status) {
    status = document.createElement("p");
    status.id = "customer-credit-status";
    status.className = "form-message";
    status.setAttribute("role", "status");
    list.before(status);
  }
  status.textContent = message;
  status.dataset.tone = tone;
}

async function load() {
  list.innerHTML = `<div class="customer-credit-empty">Loading customer credit…</div>`;
  const [receiptsResult, balancesResult, movementsResult, targetsResult, accountsResult, authResult] = await Promise.all([
    supabase.from("quotation_deposit_receipts")
      .select("id, credit_note_number, quotation_id, customer_id, customer_name, customer_phone, amount, payment_method, payment_date, reference, created_at, journal_entry_id, quotations(quotation_number, created_at), customers(full_name)")
      .order("created_at", { ascending: false }),
    supabase.from("customer_credit_balances").select("deposit_receipt_id, available_amount"),
    supabase.from("customer_credit_movements")
      .select("id, deposit_receipt_id, movement_type, amount, target_type, target_id, payment_account_id, reason, journal_entry_id, created_at, reversed_at, reversal_reason, reversal_journal_entry_id")
      .order("created_at", { ascending: false }),
    supabase.from("customer_account_statement")
      .select("customer_id, customer_name, source_id, source_type, reference, balance_due")
      .gt("balance_due", 0.005),
    supabase.from("accounts").select("id, code, name")
      .eq("is_active", true).eq("type", "asset").like("code", "10%").order("code"),
    supabase.auth.getUser(),
  ]);

  const failure = receiptsResult.error || balancesResult.error || movementsResult.error || targetsResult.error;
  if (failure) {
    list.innerHTML = `<div class="customer-credit-empty">Customer credit is unavailable: ${escapeHtml(failure.message)}</div>`;
    return;
  }

  const userId = authResult.data.user?.id;
  const profileResult = userId
    ? await supabase.from("profiles").select("role, access_level").eq("id", userId).maybeSingle()
    : { data: null, error: null };
  const role = String(profileResult.data?.role || "").toLowerCase();
  canRefund = role === "accounting" || role === "super_admin" || role === "superadmin" || Number(profileResult.data?.access_level || 0) >= 2;

  creditNotes = receiptsResult.data || [];
  const balanceById = new Map((balancesResult.data || []).map(row => [row.deposit_receipt_id, Number(row.available_amount) || 0]));
  creditNotes = creditNotes.map(row => ({ ...row, available_amount: balanceById.get(row.id) || 0 }));
  movements = movementsResult.data || [];
  targets = (targetsResult.data || []).filter(row => ["Repair job", "Sales order", "Invoice"].includes(row.source_type));
  accounts = accountsResult.error ? [] : (accountsResult.data || []);
  render();
}

function render() {
  if (!creditNotes.length) {
    list.innerHTML = `<div class="customer-credit-empty">No quotation deposit credit notes have been issued.</div>`;
    return;
  }
  const accountOptions = accounts.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} · ${escapeHtml(account.name)}</option>`).join("");
  list.innerHTML = `<table class="customer-credit-table">
    <thead><tr><th>Credit note</th><th>Customer / quotation</th><th>Issued</th><th>Amount</th><th>Available</th><th>Staff action</th></tr></thead>
    <tbody>${creditNotes.map(note => {
      const quoteNumber = note.quotations?.quotation_number ?? "—";
      const expired = note.quotations?.created_at && Date.now() > Date.parse(note.quotations.created_at) + 7 * 86400000;
      const noteName = note.customer_name || note.customers?.full_name || "";
      const quoteTargets = targets.filter(target => note.customer_id
        ? target.customer_id === note.customer_id
        : String(target.customer_name || "").trim().toLocaleLowerCase() === noteName.trim().toLocaleLowerCase());
      const targetOptions = quoteTargets.map(target => {
        const type = target.source_type === "Repair job" ? "repair_job" : target.source_type === "Sales order" ? "sales_order" : "invoice";
        return `<option value="${type}|${escapeHtml(target.source_id)}">${escapeHtml(target.reference)} · due ${money(target.balance_due)}</option>`;
      }).join("");
      const noteMovements = movements.filter(movement => movement.deposit_receipt_id === note.id);
      const history = noteMovements.length ? `<details class="customer-credit-history"><summary>History (${noteMovements.length})</summary>${noteMovements.map(movement => {
        const label = movement.movement_type === "refund" ? "Refund" : "Applied";
        const status = movement.reversed_at ? ` · Reversed: ${escapeHtml(movement.reversal_reason || "")}` : "";
        const reverseAction = canRefund && !movement.reversed_at
          ? ` <button type="button" class="btn customer-credit-reverse" data-movement-id="${escapeHtml(movement.id)}">Reverse</button>`
          : "";
        return `<div>${label} ${money(movement.amount)} · ${dateLabel(String(movement.created_at || "").slice(0, 10))} · Journal ${escapeHtml(movement.journal_entry_id)}${movement.reason ? ` · ${escapeHtml(movement.reason)}` : ""}${status}${reverseAction}</div>`;
      }).join("")}</details>` : `<small class="customer-credit-history">No applications or refunds recorded.</small>`;
      const refundFields = canRefund && accounts.length && note.available_amount > 0.005
        ? `<div class="customer-credit-actions" data-credit-id="${escapeHtml(note.id)}" data-action="refund">
            <select class="credit-account" aria-label="Refund payment account"><option value="">Refund from…</option>${accountOptions}</select>
            <input class="credit-amount" type="number" min="0.01" max="${note.available_amount}" step="0.01" placeholder="Amount" aria-label="Refund amount">
            <button type="button" class="btn customer-credit-refund">Refund</button>
            <input class="credit-reason" maxlength="240" placeholder="Refund reason" aria-label="Refund reason">
          </div>`
        : "";
      const refundNotice = canRefund && !accounts.length
        ? `<small>Refund accounts are unavailable; refunding is disabled.</small>`
        : canRefund ? "" : `<small>Refund requires Accounting access.</small>`;
      const applyFields = note.available_amount > 0.005
        ? `<div class="customer-credit-actions" data-credit-id="${escapeHtml(note.id)}" data-action="apply">
            <select class="credit-target" aria-label="Apply credit to" ${quoteTargets.length ? "" : "disabled"}><option value="">${quoteTargets.length ? "Apply to…" : "No same-customer balance"}</option>${targetOptions}</select>
            <input class="credit-amount" type="number" min="0.01" max="${note.available_amount}" step="0.01" placeholder="Amount" aria-label="Credit amount">
            <button type="button" class="btn customer-credit-apply" ${quoteTargets.length ? "" : "disabled"}>Apply</button>
          </div>`
        : "";
      return `<tr>
        <td><strong>QCN-${String(note.credit_note_number).padStart(6, "0")}</strong><small>${escapeHtml(note.payment_method)}${note.reference ? ` · ${escapeHtml(note.reference)}` : ""}</small>${history}</td>
        <td>${escapeHtml(noteName || "Customer")}<small>${note.customer_phone ? `${escapeHtml(note.customer_phone)} · ` : ""}Quotation #${escapeHtml(quoteNumber)} · ${expired ? "Quote expired; credit remains available" : "7-day quote window"}</small></td>
        <td>${dateLabel(note.payment_date)}</td><td>${money(note.amount)}</td><td><strong>${money(note.available_amount)}</strong></td>
        <td>${applyFields}${refundFields}${refundNotice}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
  window.lucide?.createIcons();
}

list.addEventListener("input", event => {
  const action = event.target.closest("[data-action]");
  if (action) delete action.dataset.idempotencyKey;
});
list.addEventListener("change", event => {
  const action = event.target.closest("[data-action]");
  if (action) delete action.dataset.idempotencyKey;
});
list.addEventListener("click", async event => {
  const applyButton = event.target.closest(".customer-credit-apply");
  const refundButton = event.target.closest(".customer-credit-refund");
  const reverseButton = event.target.closest(".customer-credit-reverse");
  if (!applyButton && !refundButton && !reverseButton) return;

  if (reverseButton) {
    const reason = prompt("Reason for reversing this customer-credit transaction:")?.trim();
    if (!reason) return;
    reverseButton.disabled = true;
    const { error } = await supabase.rpc("reverse_customer_credit_movement", {
      p_movement_id: reverseButton.dataset.movementId,
      p_reason: reason,
    });
    if (error) {
      showMessage(error.message, "error");
      reverseButton.disabled = false;
      return;
    }
    await load();
    showMessage("Credit transaction reversed with a compensating journal entry.", "success");
    return;
  }

  const action = (applyButton || refundButton).closest("[data-action]");
  const amount = Number(action.querySelector(".credit-amount")?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showMessage("Enter an amount greater than zero.", "error");
    return;
  }
  const idempotencyKey = action.dataset.idempotencyKey || crypto.randomUUID();
  action.dataset.idempotencyKey = idempotencyKey;
  (applyButton || refundButton).disabled = true;
  try {
    let result;
    if (applyButton) {
      const [targetType, targetId] = (action.querySelector(".credit-target")?.value || "").split("|");
      if (!targetType || !targetId) throw new Error("Choose a same-customer repair job, sale or invoice.");
      result = await supabase.rpc("apply_customer_credit", {
        p_deposit_receipt_id: action.dataset.creditId,
        p_amount: amount,
        p_target_type: targetType,
        p_target_id: targetId,
        p_reason: "Staff-applied quotation deposit",
        p_idempotency_key: idempotencyKey,
      });
    } else {
      if (!canRefund) throw new Error("Only Accounting-level users can refund customer credit.");
      const accountId = action.querySelector(".credit-account")?.value;
      const reason = action.querySelector(".credit-reason")?.value.trim();
      if (!accountId || !reason) throw new Error("Choose a refund account and enter a reason.");
      result = await supabase.rpc("refund_customer_credit", {
        p_deposit_receipt_id: action.dataset.creditId,
        p_amount: amount,
        p_payment_account_id: accountId,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      });
    }
    if (result.error) throw result.error;
    await load();
    showMessage(applyButton ? "Credit applied to the customer balance." : "Partial refund recorded in the ledger.", "success");
  } catch (error) {
    showMessage(error.message || "The customer-credit transaction could not be completed.", "error");
    (applyButton || refundButton).disabled = false;
  }
});

refreshButton?.addEventListener("click", load);
load();