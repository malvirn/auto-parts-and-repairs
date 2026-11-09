import supabase from "./supabaseClient.js";

const quoteTable = document.getElementById("quotations-table");

function businessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function openDepositDialog(button) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = `
    <form class="modal invoice-payment-modal" role="dialog" aria-modal="true" aria-labelledby="quotation-deposit-title">
      <h2 id="quotation-deposit-title">Record quotation deposit</h2>
      <p class="section-note" data-quote-summary></p>
      <div class="field"><label for="quotation-deposit-amount">Amount received ($)</label><input id="quotation-deposit-amount" type="number" min="0.01" step="0.01" required></div>
      <div class="field"><label for="quotation-deposit-method">Payment method</label><select id="quotation-deposit-method" required><option value="Cash">Cash</option><option value="EcoCash">EcoCash</option><option value="Bank">Bank transfer</option><option value="Swipe">Card / POS</option></select></div>
      <div class="field"><label for="quotation-deposit-date">Payment date</label><input id="quotation-deposit-date" type="date" required></div>
      <div class="field"><label for="quotation-deposit-reference">Payment reference (optional)</label><input id="quotation-deposit-reference" maxlength="120" autocomplete="off"></div>
      <p class="section-note">This deposit is recorded as Customer Credit Note # on the Receipts page. The quotation expires seven days after issue; any paid credit remains available until applied or refunded.</p>
      <p class="form-message" data-message role="status" aria-live="polite"></p>
      <div class="invoice-payment-actions"><button class="btn btn--primary" type="submit">Record deposit</button><button class="btn" type="button" data-cancel>Cancel</button></div>
    </form>`;

  const form = overlay.querySelector("form");
  const amount = overlay.querySelector("#quotation-deposit-amount");
  const date = overlay.querySelector("#quotation-deposit-date");
  const message = overlay.querySelector("[data-message]");
  const saveButton = form.querySelector('button[type="submit"]');
  const close = () => overlay.remove();
  overlay.querySelector("[data-quote-summary]").textContent = `Quotation #${button.dataset.number} · Total $${Number(button.dataset.total || 0).toFixed(2)}`;
  amount.max = String(Number(button.dataset.total || 0));
  date.value = businessDate();
  overlay.querySelector("[data-cancel]").addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  form.addEventListener("input", () => { delete form.dataset.idempotencyKey; });
  form.addEventListener("change", () => { delete form.dataset.idempotencyKey; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const value = Number(amount.value);
    if (!Number.isFinite(value) || value <= 0) {
      message.textContent = "Enter a deposit greater than zero.";
      message.dataset.tone = "error";
      return;
    }
    saveButton.disabled = true;
    message.textContent = "Recording deposit…";
    message.dataset.tone = "info";
    const idempotencyKey = form.dataset.idempotencyKey || crypto.randomUUID();
    form.dataset.idempotencyKey = idempotencyKey;
    try {
      const { data, error } = await supabase.rpc("record_quotation_deposit", {
        p_quotation_id: button.dataset.id,
        p_amount: value,
        p_payment_method: form.querySelector("#quotation-deposit-method").value,
        p_payment_date: date.value,
        p_reference: form.querySelector("#quotation-deposit-reference").value.trim() || null,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      message.textContent = `Quotation Credit Note QCN-${String(data.credit_note_number).padStart(6, "0")} recorded. Opening its receipt…`;
      message.dataset.tone = "success";
      delete form.dataset.idempotencyKey;
      window.location.href = `receipts.html?credit_note_id=${encodeURIComponent(data.id)}&from=quotations`;
    } catch (error) {
      message.textContent = error.message || "The deposit could not be recorded.";
      message.dataset.tone = "error";
      saveButton.disabled = false;
    }
  });
  document.body.appendChild(overlay);
  amount.focus();
}

quoteTable?.addEventListener("click", event => {
  const button = event.target.closest(".record-quote-deposit");
  if (!button) return;
  openDepositDialog(button);
});