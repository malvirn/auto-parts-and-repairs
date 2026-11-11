import supabase from "./supabaseClient.js";

let host = document.getElementById("credit-voucher-panel");
let list = document.getElementById("credit-voucher-list");
let search = document.getElementById("credit-voucher-search");
let statusFilter = document.getElementById("credit-voucher-status");
let refresh = document.getElementById("credit-voucher-refresh");
let settingsButton = document.getElementById("credit-voucher-settings");
const tabButton = document.getElementById("credit-voucher-tab");
const notesTabButton = document.getElementById("credit-notes-tab");
let redeemCode = document.getElementById("voucher-redeem-code");
let redeemCheck = document.getElementById("voucher-redeem-check");
let redeemScan = document.getElementById("voucher-redeem-scan");
let redeemPreview = document.getElementById("voucher-redeem-preview");
let redeemTarget = document.getElementById("voucher-redeem-target");
let redeemAmount = document.getElementById("voucher-redeem-amount");
let redeemConfirmation = document.getElementById("voucher-redeem-confirmation");
let redeemSourceSelect = document.getElementById("voucher-redeem-source");
let redeemAuthorisedBy = document.getElementById("voucher-redeem-authorised-by");
let redeemApply = document.getElementById("voucher-redeem-apply");
let redeemMessage = document.getElementById("voucher-redeem-message");
let redeemVideo = document.getElementById("voucher-redeem-video");
const notesPanel = document.getElementById("customer-credit-panel");
let launcher = null;
if (!host) {
  host = document.createElement("section");
  host.id = "credit-voucher-panel";
  host.hidden = true;
  host.className = "credit-voucher-overlay";
  host.innerHTML = '<header><div><small>CENTRIC AUTO MOBILE</small><h2>Customer Credit Vouchers</h2></div><button type="button" id="credit-voucher-close" aria-label="Close vouchers">×</button></header>' +
    '<div class="credit-voucher-overlay-tools"><input id="credit-voucher-search" type="search" placeholder="Search voucher code or customer"><select id="credit-voucher-status"><option value="">All statuses</option><option value="active">Active</option><option value="redeemed">Redeemed</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select><button id="credit-voucher-settings" type="button">Settings</button><button id="credit-voucher-refresh" type="button">Refresh</button></div>' +
    '<section class="credit-voucher-redeem"><h3>Redeem a voucher</h3><p>Enter the code or scan its QR. Vouchers can be used against eligible outstanding balances.</p>' +
    '<div class="credit-voucher-code-entry"><input id="voucher-redeem-code" type="text" maxlength="11" placeholder="XXXXX-XXXXX"><button id="voucher-redeem-check" type="button">Check code</button><button id="voucher-redeem-scan" type="button">Scan QR</button></div>' +
    '<div id="voucher-redeem-preview" class="credit-voucher-preview" aria-live="polite"></div><label for="voucher-redeem-source">Customer credit available for this balance</label><select id="voucher-redeem-source"><option value="">Choose a credit note or voucher…</option></select><label for="voucher-redeem-target">Apply to outstanding balance</label><select id="voucher-redeem-target" disabled><option value="">Check a voucher first</option></select>' +
    '<label for="voucher-redeem-amount">Amount to apply ($)</label><input id="voucher-redeem-amount" type="number" min="0.01" step="0.01" disabled placeholder="0.00"><label id="voucher-redeem-confirmation-label" for="voucher-redeem-confirmation">Customer phone last 4 digits or full name</label><input id="voucher-redeem-confirmation" type="text" autocomplete="off" placeholder="Confirm customer identity"><label id="voucher-redeem-authorised-label" for="voucher-redeem-authorised-by" hidden>Authorised by</label><input id="voucher-redeem-authorised-by" type="text" autocomplete="off" placeholder="Driver or accounts person" hidden><button id="voucher-redeem-apply" type="button" disabled>Apply voucher</button><p id="voucher-redeem-message" role="status"></p><video id="voucher-redeem-video" playsinline muted hidden></video></section>' +
    '<div id="credit-voucher-list" aria-live="polite"></div>';
  document.body.append(host);
  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "credit-voucher-launcher";
  launcher.textContent = "Redeem voucher";
  launcher.setAttribute("aria-label","Open customer credit vouchers");
  document.body.append(launcher);
  const style = document.createElement("style");
  style.textContent = '.credit-voucher-launcher{position:fixed;right:16px;bottom:86px;z-index:9990;padding:12px 17px;border:0;border-radius:28px;background:#f58220;color:#fff;font-weight:800;box-shadow:0 8px 24px #0004}.credit-voucher-overlay{position:fixed;z-index:9991;inset:4vh 3vw auto auto;width:min(720px,94vw);max-height:90vh;overflow:auto;padding:18px;border:1px solid #526174;border-radius:16px;background:#10181a;color:#eef3ef;box-shadow:0 18px 60px #0008}.credit-voucher-overlay[hidden]{display:none}.credit-voucher-overlay>header{display:flex;justify-content:space-between;align-items:center;gap:12px}.credit-voucher-overlay>header h2{margin:3px 0 12px}.credit-voucher-overlay>header button{font-size:25px;background:transparent;color:inherit;border:0}.credit-voucher-overlay-tools{display:grid;grid-template-columns:minmax(0,1fr) 140px auto;gap:8px;margin:12px 0}.credit-voucher-overlay input,.credit-voucher-overlay select{min-width:0;padding:10px;border:1px solid #53635a;border-radius:8px;background:#0c1210;color:inherit}.credit-voucher-overlay .credit-voucher-card{background:#14211b}.credit-voucher-overlay .credit-voucher-actions{display:flex;flex-wrap:wrap;gap:7px}.credit-voucher-overlay .credit-voucher-actions button,.credit-voucher-overlay-tools button{padding:9px;border-radius:8px}.credit-voucher-overlay .credit-voucher-redeem{display:grid;gap:9px;margin:12px 0;padding:14px;border:1px solid #40564a;border-radius:12px}.credit-voucher-overlay .credit-voucher-code-entry{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.credit-voucher-overlay .credit-voucher-redeem button{min-height:42px}.credit-voucher-overlay #voucher-redeem-apply{width:100%;background:#f58220;color:#fff;border:0;border-radius:8px;font-weight:800}.credit-voucher-overlay .credit-voucher-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.credit-voucher-overlay .credit-voucher-code{font-size:20px}.credit-voucher-overlay video{width:100%;max-height:230px;object-fit:cover}.credit-voucher-overlay .credit-voucher-history{margin-top:12px}.credit-voucher-overlay .credit-voucher-preview{padding:10px;border:1px solid #40564a;border-radius:8px}.credit-voucher-overlay .credit-voucher-expired-note{color:#fbbf24}
:root[data-theme="light"] .credit-voucher-overlay{background:#fff!important;color:#17212b!important;border-color:#d8e0e8!important;box-shadow:0 18px 60px rgba(15,23,42,.2)!important;color-scheme:light}
:root[data-theme="light"] .credit-voucher-overlay h2,:root[data-theme="light"] .credit-voucher-overlay h3,:root[data-theme="light"] .credit-voucher-overlay p,:root[data-theme="light"] .credit-voucher-overlay label,:root[data-theme="light"] .credit-voucher-overlay small,:root[data-theme="light"] .credit-voucher-overlay strong,:root[data-theme="light"] .credit-voucher-overlay summary{color:#17212b}
:root[data-theme="light"] .credit-voucher-overlay input,:root[data-theme="light"] .credit-voucher-overlay select{background:#fff!important;color:#17212b!important;border-color:#cbd5df!important;color-scheme:light}
:root[data-theme="light"] .credit-voucher-overlay .credit-voucher-card,:root[data-theme="light"] .credit-voucher-overlay .credit-voucher-redeem,:root[data-theme="light"] .credit-voucher-overlay .credit-voucher-preview{background:#f5f7fa!important;color:#17212b!important;border-color:#d8e0e8!important}
:root[data-theme="light"] .credit-voucher-overlay .credit-voucher-facts>span{background:#fff;border:1px solid #e1e7ee;border-radius:8px;padding:8px}
:root[data-theme="light"] .credit-voucher-overlay .credit-voucher-code{color:#126b3a}
:root[data-theme="light"] .credit-voucher-overlay .credit-voucher-expired-note{color:#9a5700}
:root[data-theme="light"] .credit-voucher-overlay>header button{color:#17212b}
@media(max-width:560px){.credit-voucher-overlay{inset:2vh 2vw auto;width:96vw;max-height:94vh;padding:12px}.credit-voucher-overlay-tools{grid-template-columns:1fr 1fr}.credit-voucher-overlay-tools input{grid-column:1/-1}.credit-voucher-overlay .credit-voucher-code-entry{grid-template-columns:1fr 1fr}.credit-voucher-overlay .credit-voucher-code-entry input{grid-column:1/-1}.credit-voucher-overlay .credit-voucher-facts{grid-template-columns:1fr 1fr}}';
  document.head.append(style);
  launcher.addEventListener("click", async () => {
    host.hidden = false;
    try { await load(); } catch (error) { list.textContent = error.message || String(error); }
  });
  host.querySelector("#credit-voucher-close").addEventListener("click", () => { host.hidden = true; stopScanner(); });
}
if (!host) throw new Error("Credit voucher panel is missing.");
list = list || host.querySelector("#credit-voucher-list");
if (!list) throw new Error("Credit voucher list is missing.");
search = search || host.querySelector("#credit-voucher-search");
statusFilter = statusFilter || host.querySelector("#credit-voucher-status");
refresh = refresh || host.querySelector("#credit-voucher-refresh");
settingsButton = settingsButton || host.querySelector("#credit-voucher-settings");
redeemCode = redeemCode || host.querySelector("#voucher-redeem-code");
redeemCheck = redeemCheck || host.querySelector("#voucher-redeem-check");
redeemScan = redeemScan || host.querySelector("#voucher-redeem-scan");
redeemPreview = redeemPreview || host.querySelector("#voucher-redeem-preview");
redeemTarget = redeemTarget || host.querySelector("#voucher-redeem-target");
redeemAmount = redeemAmount || host.querySelector("#voucher-redeem-amount");
redeemConfirmation = redeemConfirmation || host.querySelector("#voucher-redeem-confirmation");
redeemSourceSelect = redeemSourceSelect || host.querySelector("#voucher-redeem-source");
redeemAuthorisedBy = redeemAuthorisedBy || host.querySelector("#voucher-redeem-authorised-by");
redeemApply = redeemApply || host.querySelector("#voucher-redeem-apply");
redeemMessage = redeemMessage || host.querySelector("#voucher-redeem-message");
redeemVideo = redeemVideo || host.querySelector("#voucher-redeem-video");
let checkedVoucher = null;
let selectedCustomerCreditNote = null;
let currentCustomer = null;
let currentTarget = null;
let customerCreditSources = [];
let redeemTargets = [];
let preferredRedeemTarget = null;
let scannerStream = null;
let scannerActive = false;
let redemptionRequest = { signature: null, key: null };

const money = value => "$" + Number(value || 0).toFixed(2);
const esc = value => {
  const node = document.createElement("span");
  node.textContent = value ?? "";
  return node.innerHTML;
};
const dateLabel = value => value ? new Date(value + (String(value).length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", {
  timeZone: "Africa/Harare", day: "2-digit", month: "short", year: "numeric",
}) : "—";
let vouchers = [];
let redemptions = [];
let resolutions = [];
let terms = "Redeemable against eligible Centric Auto Mobile job cards, invoices and sales orders. Not redeemable for cash. Subject to available balance and expiry date.";
let qrPromise;

function setRedeemMessage(message, tone = "info") {
  if (!redeemMessage) return;
  redeemMessage.textContent = message;
  redeemMessage.dataset.tone = tone;
}

function targetLabel(row) {
  const type = row.source_type === "Repair job" ? "repair_job" : row.source_type === "Sales order" ? "sales_order" : "invoice";
  return { ...row, target_type: type, label: row.reference + " · due " + money(row.balance_due) };
}

async function loadRedeemTargets() {
  const { data, error } = await supabase.from("customer_account_statement")
    .select("customer_id,customer_name,source_id,source_type,reference,balance_due")
    .gt("balance_due", 0.005);
  if (error) throw error;
  const targetCustomerId = checkedVoucher?.customer_id || selectedCustomerCreditNote?.customer_id || currentTarget?.customer_id;
  redeemTargets = (data || []).filter(row => ["Repair job","Sales order","Invoice"].includes(row.source_type) && (!targetCustomerId || row.customer_id === targetCustomerId)).map(targetLabel);
  redeemTarget.innerHTML = '<option value="">Choose an outstanding balance…</option>' +
    redeemTargets.map(row => '<option value="' + esc(row.target_type + "|" + row.source_id) + '">' + esc(row.label) + '</option>').join("");
  redeemTarget.disabled = !redeemTargets.length || (!checkedVoucher && !selectedCustomerCreditNote) || (checkedVoucher && checkedVoucher.status !== "active");
  const targetToPreselect = preferredRedeemTarget || currentTarget;
  if (targetToPreselect) {
    const match = redeemTargets.find(row => row.target_type === targetToPreselect.targetType && String(row.source_id) === String(targetToPreselect.targetId));
    if (match) {
      redeemTarget.value = match.target_type + "|" + match.source_id;
      updateRedeemAmount();
    }
    preferredRedeemTarget = null;
  }
}

function updateRedeemAmount() {
  const [type,id] = (redeemTarget.value || "").split("|");
  const target = redeemTargets.find(row => row.target_type === type && row.source_id === id);
  if (!target || (!checkedVoucher && !selectedCustomerCreditNote)) {
    redeemAmount.value = "";
    redeemApply.disabled = true;
    return;
  }
  const sourceBalance = Number(selectedCustomerCreditNote?.available_amount ?? checkedVoucher?.available_amount) || 0;
  const amount = Math.min(Number(target.balance_due) || 0, sourceBalance);
  redeemAmount.value = amount > 0 ? amount.toFixed(2) : "";
  redeemAmount.max = String(amount);
  redeemAmount.disabled = amount <= 0;
  redeemApply.disabled = amount <= 0;
  redemptionRequest = { signature: null, key: null };
}

function renderLegacyCustomerRegistration(sourceNote, voucher) {
  const sourceName = String(sourceNote?.customer_name || "").trim();
  const sourcePhone = String(sourceNote?.customer_phone || "").trim();
  redeemPreview.innerHTML =
    '<strong>Legacy credit record · ' + esc(sourceName || "Customer name not recorded") + '</strong>' +
    '<span>This older voucher has no linked Customer ID. Register the customer below to create a CID and link this credit before redemption.</span>' +
    '<label class="legacy-credit-company-toggle"><input id="legacy-credit-is-company" type="checkbox"> Register this customer as a company</label>' +
    '<label for="legacy-credit-full-name">Customer / contact person name</label>' +
    '<input id="legacy-credit-full-name" type="text" value="' + esc(sourceName) + '" autocomplete="name">' +
    '<label id="legacy-credit-company-label" for="legacy-credit-company-name" hidden>Registered company name</label>' +
    '<input id="legacy-credit-company-name" type="text" value="' + esc(sourceName) + '" autocomplete="organization" hidden>' +
    '<label for="legacy-credit-phone">Phone number</label>' +
    '<input id="legacy-credit-phone" type="tel" value="' + esc(sourcePhone) + '" autocomplete="tel">' +
    '<button id="legacy-credit-register-link" type="button" class="btn btn--primary">Register customer and link credit</button>' +
    '<small>For a company, enter the authorised contact person and keep the company name exactly as it appears on the original credit note. The original credit amount and accounting entries will not be changed.</small>';

  const companyToggle = redeemPreview.querySelector("#legacy-credit-is-company");
  const fullName = redeemPreview.querySelector("#legacy-credit-full-name");
  const companyName = redeemPreview.querySelector("#legacy-credit-company-name");
  const companyLabel = redeemPreview.querySelector("#legacy-credit-company-label");
  const registerButton = redeemPreview.querySelector("#legacy-credit-register-link");
  companyToggle.addEventListener("change", () => {
    const isCompany = companyToggle.checked;
    companyLabel.hidden = !isCompany;
    companyName.hidden = !isCompany;
    companyName.required = isCompany;
    fullName.placeholder = isCompany ? "Contact person name" : "Customer name";
    if (isCompany && fullName.value.trim().toLocaleLowerCase() === sourceName.toLocaleLowerCase()) fullName.value = "";
    if (!isCompany && !fullName.value.trim()) fullName.value = sourceName;
  });
  registerButton.addEventListener("click", async () => {
    const isCompany = companyToggle.checked;
    const name = fullName.value.trim();
    const phone = redeemPreview.querySelector("#legacy-credit-phone").value.trim();
    const company = companyName.value.trim();
    if (!name || !phone || (isCompany && !company)) {
      setRedeemMessage("Enter the customer/contact name, phone, and company name where applicable.", "error");
      return;
    }
    registerButton.disabled = true;
    setRedeemMessage("Registering the customer and linking the existing credit…");
    try {
      const { data, error } = await supabase.rpc("register_and_link_legacy_credit_customer", {
        p_credit_note_type: voucher.credit_note_type,
        p_credit_note_id: voucher.credit_note_id,
        p_full_name: name,
        p_phone: phone,
        p_is_company: isCompany,
        p_company_name: isCompany ? company : null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRedeemMessage("Customer registered and linked as " + (data?.customer_code || "a new customer") + ". Reloading voucher…", "success");
      await previewVoucher();
    } catch (error) {
      setRedeemMessage(error.message || String(error), "error");
      registerButton.disabled = false;
    }
  });
}

async function previewVoucher() {
  const code = redeemCode.value.trim().toUpperCase();
  if (!code) { setRedeemMessage("Enter a voucher code first.", "error"); return; }
  redeemCheck.disabled = true;
  redeemApply.disabled = true;
  checkedVoucher = null;
  redeemPreview.textContent = "Checking voucher…";
  try {
    const { data, error } = await supabase.rpc("lookup_credit_voucher", { p_code: code });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    checkedVoucher = data;
    selectedCustomerCreditNote = null;
    const sourceTable = data.credit_note_type === "quotation_deposit" ? "quotation_deposit_receipts" : "customer_overpayment_credit_notes";
    const { data: sourceNote, error: sourceError } = await supabase.from(sourceTable).select("customer_id,customer_name,customer_phone").eq("id", data.credit_note_id).maybeSingle();
    if (sourceError) throw sourceError;
    let customer;
    if (sourceNote?.customer_id) {
      const result = await supabase.from("customers").select("id,customer_code,is_company,company_name,full_name,phone").eq("id", sourceNote.customer_id).single();
      if (result.error) throw result.error;
      customer = result.data;
    } else {
      const result = await supabase.from("customers").select("id,customer_code,is_company,company_name,full_name,phone").limit(1000);
      if (result.error) throw result.error;
      const digits = value => String(value || "").replace(/\D/g, "");
      const name = String(sourceNote?.customer_name || "").trim().toLocaleLowerCase();
      const phone = digits(sourceNote?.customer_phone);
      const matches = (result.data || []).filter(candidate =>
        [candidate.full_name,candidate.company_name].some(value => String(value || "").trim().toLocaleLowerCase() === name) &&
        (!phone || digits(candidate.phone) === phone)
      );
      if (matches.length > 1) throw new Error("More than one registered customer matches this legacy credit. Ask a manager to resolve the duplicate customer records before redeeming it.");
      if (matches.length === 0) {
        checkedVoucher = null;
        renderLegacyCustomerRegistration(sourceNote, data);
        redeemTarget.innerHTML = '<option value="">Link the legacy credit to a customer first</option>';
        redeemTarget.disabled = true;
        redeemAmount.value = "";
        redeemAmount.disabled = true;
        setRedeemMessage(sourceNote?.customer_phone
          ? "This voucher belongs to an older customer record. Register and link that customer before redemption."
          : "This older credit has no recorded phone number. Register the customer with a verified phone number before linking it.", "error");
        return;
      }
      customer = matches[0];
    }
    checkedVoucher.customer_id = customer.id;
    checkedVoucher.customer = customer;
    currentCustomer = customer;
    const customerLabel = customer.company_name || customer.full_name || data.customer_first_name || "Customer";
    const cidLabel = customer.customer_code ? " · " + customer.customer_code : "";
    redeemPreview.innerHTML = '<strong>' + esc(customerLabel) + '</strong><span>' + esc(cidLabel) + ' · ' + money(data.available_amount) +
      ' available · expires ' + dateLabel(data.expires_at) + '</span><small>Status: ' + esc(data.status) + '</small>';
    const confirmationLabel = host.querySelector("#voucher-redeem-confirmation-label");
    const authorLabel = host.querySelector("#voucher-redeem-authorised-label");
    if (confirmationLabel) confirmationLabel.textContent = customer.is_company ? "Confirm company name exactly" : "Customer phone last 4 digits or full name";
    if (authorLabel) authorLabel.hidden = !customer.is_company;
    if (redeemAuthorisedBy) { redeemAuthorisedBy.hidden = !customer.is_company; redeemAuthorisedBy.required = Boolean(customer.is_company); }
    if (redeemConfirmation) { redeemConfirmation.value = ""; redeemConfirmation.placeholder = customer.is_company ? "Type the company name" : "Last 4 phone digits or full name"; }
    if (redeemAuthorisedBy) redeemAuthorisedBy.value = "";
    if (data.status !== "active" || Number(data.available_amount) <= 0.005) {
      redeemTarget.innerHTML = '<option value="">This voucher cannot be redeemed</option>';
      redeemTarget.disabled = true;
      redeemAmount.value = "";
      redeemAmount.disabled = true;
      setRedeemMessage("This voucher is " + data.status + " and cannot be applied.", "error");
      return;
    }
    await loadRedeemTargets();
    if (!redeemTargets.length) throw new Error("There are no outstanding job cards, invoices or confirmed sales orders.");
    setRedeemMessage("Voucher verified. Choose the balance to apply it to.");
    updateRedeemAmount();
  } catch (error) {
    checkedVoucher = null;
    redeemPreview.textContent = "";
    redeemTarget.innerHTML = '<option value="">Check a voucher first</option>';
    redeemTarget.disabled = true;
    redeemAmount.value = "";
    redeemAmount.disabled = true;
    setRedeemMessage(error.message || String(error), "error");
  } finally { redeemCheck.disabled = false; }
}

async function applyVoucher() {
  if (!checkedVoucher && !selectedCustomerCreditNote) return;
  const [targetType,targetId] = (redeemTarget.value || "").split("|");
  const amount = Number(redeemAmount.value);
  const target = redeemTargets.find(row => row.target_type === targetType && row.source_id === targetId);
  const sourceBalance = Number(selectedCustomerCreditNote?.available_amount ?? checkedVoucher?.available_amount) || 0;
  const maximum = Math.min(Number(target?.balance_due) || 0, sourceBalance);
  if (!targetType || !target || !Number.isFinite(amount) || amount <= 0 || amount > maximum + 0.005) {
    setRedeemMessage("Choose a valid target and amount.", "error");
    return;
  }
  redeemApply.disabled = true;
  setRedeemMessage("Applying voucher and posting the accounting entry…");
  const signature = [selectedCustomerCreditNote ? selectedCustomerCreditNote.id : redeemCode.value.trim().toUpperCase(), targetType, targetId, amount.toFixed(2)].join("|");
  if (redemptionRequest.signature !== signature) {
    redemptionRequest = { signature, key: crypto.randomUUID() };
  }
  try {
    let data, error;
    if (selectedCustomerCreditNote) {
      ({ data, error } = await supabase.rpc("apply_customer_credit_verified", {
        p_deposit_receipt_id: selectedCustomerCreditNote.deposit_receipt_id,
        p_amount: amount, p_target_type: targetType, p_target_id: targetId,
        p_reason: "Customer credit applied from job or invoice payment",
        p_idempotency_key: redemptionRequest.key,
        p_confirmation_value: redeemConfirmation?.value.trim() || "",
        p_authorised_by: redeemAuthorisedBy?.value.trim() || null,
      }));
    } else {
      ({ data, error } = await supabase.rpc("redeem_credit_voucher_verified", {
        p_code: redeemCode.value.trim().toUpperCase(), p_amount: amount,
        p_target_type: targetType, p_target_id: targetId,
        p_idempotency_key: redemptionRequest.key,
        p_confirmation_value: redeemConfirmation?.value.trim() || "",
        p_authorised_by: redeemAuthorisedBy?.value.trim() || null,
      }));
    }
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const wasCreditNote = Boolean(selectedCustomerCreditNote);
    const sourceSnapshot = selectedCustomerCreditNote;
    const targetSnapshot = currentTarget;
    const { data: refreshed, error: refreshError } = await supabase.from("customer_account_statement")
      .select("balance_due").eq("source_id", targetId).eq("source_type", target.source_type).maybeSingle();
    if (refreshError) throw refreshError;
    const remainingDue = Math.max(0, Number(refreshed?.balance_due) || 0);
    redemptionRequest = { signature: null, key: null };
    await load();
    selectedCustomerCreditNote = null;
    checkedVoucher = null;
    await loadCustomerCreditSources(targetSnapshot);
    const remainingCredit = wasCreditNote ? Math.max(0, Number(sourceSnapshot.available_amount) - amount) : Number(data.remaining_balance);
    setRedeemMessage((wasCreditNote ? "Credit note" : "Voucher") + " applied: " + money(data.amount || amount) + ". Credit remaining: " +
      money(remainingCredit) + ". Target balance remaining: " + money(remainingDue) + ".", "success");

  } catch (error) {
    setRedeemMessage(error.message || String(error), "error");
    redeemApply.disabled = false;
  }
}

function stopScanner() {
  scannerActive = false;
  if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
  scannerStream = null;
  if (redeemVideo) { redeemVideo.pause(); redeemVideo.srcObject = null; redeemVideo.hidden = true; }
}

async function startScanner() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    setRedeemMessage("QR scanning is not supported by this browser. Enter the voucher code manually.");
    return;
  }
  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
    redeemVideo.srcObject = scannerStream;
    redeemVideo.hidden = false;
    await redeemVideo.play();
    scannerActive = true;
    setRedeemMessage("Point the camera at the voucher QR code.");
    const scanFrame = async () => {
      if (!scannerActive) return;
      try {
        const codes = await detector.detect(redeemVideo);
        if (codes.length && codes[0].rawValue) {
          redeemCode.value = codes[0].rawValue;
          stopScanner();
          await previewVoucher();
          return;
        }
      } catch (error) { console.warn("Voucher QR scan frame failed:", error); }
      if (scannerActive) requestAnimationFrame(scanFrame);
    };
    scanFrame();
  } catch (error) {
    stopScanner();
    setRedeemMessage("Camera access failed. Enter the voucher code manually.", "error");
  }
}

async function loadQrLibrary() {
  if (window.QRCode) return;
  if (!qrPromise) qrPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("QR generator could not load."));
    document.head.append(script);
  });
  await qrPromise;
}

async function load() {
  list.innerHTML = '<div class="customer-credit-empty">Loading vouchers…</div>';
  const [voucherResult, redemptionResult, resolutionResult, settingsResult] = await Promise.all([
    supabase.rpc("list_customer_credit_vouchers_with_identity"),
    supabase.from("credit_voucher_redemptions").select("id,voucher_id,amount,target_type,target_id,redeemed_at,reversed_at").order("redeemed_at", { ascending: false }),
    supabase.from("credit_voucher_expiry_resolutions").select("id,voucher_id,decision,amount,reason,performed_at").order("performed_at", { ascending: false }),
    supabase.from("credit_voucher_settings").select("terms,default_expiry_days").eq("id", true).maybeSingle(),
  ]);
  if (voucherResult.error) throw voucherResult.error;
  if (redemptionResult.error) throw redemptionResult.error;
  if (resolutionResult.error) throw resolutionResult.error;
  vouchers = voucherResult.data || [];
  redemptions = redemptionResult.data || [];
  resolutions = resolutionResult.data || [];
  terms = settingsResult.data?.terms || terms;
  render();
}

function render() {
  const query = search?.value.trim().toLowerCase() || "";
  const status = statusFilter?.value || "";
  const rows = vouchers.filter(v => {
    const text = [v.voucher_code, v.customer_name, v.customer_code, v.company_name, v.credit_note_number, v.holder_note].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (!status || v.status === status);
  });
  if (!rows.length) {
    list.innerHTML = '<div class="customer-credit-empty">No vouchers match these filters.</div>';
    return;
  }
  const active = vouchers.filter(v => v.status === "active").length;
  const expired = vouchers.filter(v => v.status === "expired").length;
  list.innerHTML = '<div class="customer-credit-summary"><div><small>Total vouchers</small><strong>' + vouchers.length +
    '</strong></div><div><small>Active</small><strong>' + active +
    '</strong></div><div><small>Expired · decision needed</small><strong>' + expired +
    '</strong></div></div><div class="customer-credit-records credit-voucher-records">' +
    rows.map(v => {
      const history = redemptions.filter(r => r.voucher_id === v.voucher_id);
      const resolutionHistory = resolutions.filter(r => r.voucher_id === v.voucher_id);
      const last = history.find(r => !r.reversed_at);
      const canCancel = ["active","expired"].includes(v.status);
      const canResolve = v.status === "expired" && Number(v.available_amount) > 0.005;
      return '<article class="credit-voucher-card" data-voucher-id="' + esc(v.voucher_id) + '">' +
        '<div class="credit-voucher-card__top"><div><small>' + esc(v.credit_note_number || "Customer credit") +
        '</small><strong>' + esc(v.company_name || v.customer_name || "Customer") + '</strong>' + (v.customer_code ? '<small>Customer ID: ' + esc(v.customer_code) + '</small>' : '') + '</div><span class="credit-voucher-status status-' +
        esc(v.status) + '">' + esc(v.status) + '</span></div>' +
        '<div class="credit-voucher-code">' + esc(v.voucher_code) + '</div>' +
        '<div class="credit-voucher-facts"><span><small>Available</small><strong>' + money(v.available_amount) +
        '</strong></span><span><small>Original</small><strong>' + money(v.original_amount) +
        '</strong></span><span><small>Expires</small><strong>' + dateLabel(v.expires_at) + '</strong></span></div>' +
        (v.holder_note ? '<p class="credit-voucher-note">' + esc(v.holder_note) + '</p>' : '') +
        (v.status === "expired" && Number(v.available_amount) > 0.005 ? '<p class="credit-voucher-expired-note">Unused credit remains a liability. A manager decision is required.</p>' : '') +
        '<div class="credit-voucher-actions"><button class="btn" type="button" data-voucher-print="' + esc(v.voucher_id) + '">Print voucher</button>' +
        '<button class="btn" type="button" data-voucher-whatsapp="' + esc(v.voucher_id) + '">WhatsApp</button>' +
        '<button class="btn" type="button" data-voucher-expiry="' + esc(v.voucher_id) + '">Change expiry</button>' +
        (canResolve ? '<button class="btn" type="button" data-voucher-resolve="' + esc(v.voucher_id) + '">Resolve expired credit</button>' : '') +
        (canCancel ? '<button class="btn" type="button" data-voucher-cancel="' + esc(v.voucher_id) + '">Cancel</button>' : '') +
        (last ? '<button class="btn" type="button" data-voucher-reverse="' + esc(last.id) + '" data-voucher-id="' + esc(v.voucher_id) + '">Reverse last redemption</button>' : '') +
        '</div>' +
        (history.length || resolutionHistory.length ? '<details class="credit-voucher-history"><summary>Voucher activity · ' + (history.length + resolutionHistory.length) + '</summary>' +
          history.map(r => '<div><span>' + dateLabel(r.redeemed_at) + ' · ' + esc(r.target_type.replace("_"," ")) +
            '</span><strong>' + money(r.amount) + '</strong><small>' + (r.reversed_at ? 'Reversed · ' + dateLabel(r.reversed_at) : 'Redeemed') +
            '</small></div>').join("") + resolutionHistory.map(r => '<div><span>' + dateLabel(r.performed_at) + ' · ' + esc(r.decision.replaceAll("_"," ")) +
            '</span><strong>' + money(r.amount) + '</strong><small>' + esc(r.reason) + '</small></div>').join("") + '</details>' : '') + '</article>';
    }).join("") + '</div>';
}

async function qrDataUrl(code) {
  await loadQrLibrary();
  const node = document.createElement("div");
  new window.QRCode(node, { text: code, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
  await new Promise(resolve => setTimeout(resolve, 80));
  const canvas = node.querySelector("canvas");
  const image = node.querySelector("img");
  if (canvas) return canvas.toDataURL("image/png");
  if (image?.src) return image.src;
  throw new Error("QR code could not be created.");
}

function phoneForWhatsApp(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  return digits;
}

async function printVoucher(v) {
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) throw new Error("Allow pop-ups to print the voucher.");
  try {
    const { error: auditError } = await supabase.rpc("log_credit_voucher_event", { p_voucher_id: v.voucher_id, p_action: "printed" });
    if (auditError) throw auditError;
    const qr = await qrDataUrl(v.voucher_code);
  const logo = window.location.origin + "/assets/logo.png";
  popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Credit Voucher ' + esc(v.voucher_code) + '</title>' +
    '<style>*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#18212b;font:13px/1.5 Arial,sans-serif}.sheet{width:210mm;min-height:297mm;margin:auto;padding:18mm;background:#fff}' +
    '.brand{display:flex;align-items:center;gap:14px;border-bottom:2px solid #152b48;padding-bottom:15px}.brand img{width:56px;height:56px;object-fit:contain}.brand strong{display:block;font-size:17px;letter-spacing:.07em}.brand small{color:#64748b}' +
    'h1{font-size:25px;margin:26px 0 4px}.sub{color:#64748b;margin:0 0 24px}.amount{padding:18px;border:1px solid #dbe2ea;background:#f7f9fb;border-radius:10px}.amount small{display:block;color:#64748b}.amount strong{font-size:32px}' +
    '.code{margin:25px 0 18px;text-align:center;padding:22px;border:1px dashed #8b98a8;border-radius:12px}.code small{display:block;color:#64748b}.code strong{font:800 30px/1.4 ui-monospace,monospace;letter-spacing:.12em}.qr{display:flex;justify-content:center;margin:18px}.qr img{width:160px;height:160px}' +
    '.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}.facts div{padding:12px;background:#f5f7f9}.facts small{display:block;color:#64748b}.terms{margin-top:24px;padding-top:16px;border-top:1px solid #dbe2ea;color:#526174}footer{margin-top:32px;text-align:center;color:#64748b;font-size:10px}' +
    '@page{size:A4;margin:0}@media print{.sheet{margin:0;width:210mm;min-height:297mm}}</style></head><body><main class="sheet">' +
    '<header class="brand"><img src="' + logo + '" alt="Centric Auto Mobile"><div><strong>CENTRIC AUTO MOBILE</strong><small>Auto Parts &amp; Repairs · Norton, Zimbabwe</small></div></header>' +
    '<h1>Customer Credit Voucher</h1><p class="sub">Portable customer credit · Keep this code safe</p><section class="amount"><small>Available voucher value</small><strong>' + money(v.available_amount) + '</strong></section>' +
    '<section class="code"><small>VOUCHER CODE</small><strong>' + esc(v.voucher_code) + '</strong><div class="qr"><img src="' + qr + '" alt="Voucher QR code"></div></section>' +
    '<section class="facts"><div><small>Issued to</small><strong>' + esc(v.company_name || v.customer_name || "Customer") + '</strong></div><div><small>Customer ID</small><strong>' + esc(v.customer_code || "—") + '</strong></div><div><small>Credit note</small><strong>' + esc(v.credit_note_number || "—") +
    '</strong></div><div><small>Expiry date</small><strong>' + dateLabel(v.expires_at) + '</strong></div><div><small>Status</small><strong>' + esc(v.status) + '</strong></div></section>' +
    '<section class="terms"><strong>Terms &amp; conditions</strong><p>' + esc(terms) + '</p><p>Present this voucher code or QR at Centric Auto Mobile when paying for an eligible job card, invoice or sales order. Partial redemption is permitted while value remains.</p></section>' +
    '<footer>CENTRIC AUTO MOBILE · Auto Parts &amp; Repairs · Norton, Zimbabwe</footer></main><script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});<\/script></body></html>');
  popup.document.close();
  } catch (error) {
    popup.close();
    throw error;
  }
}

async function resolveExpiredCredit(v) {
  const decision = prompt("Choose what to do with this expired credit. Type REFUND or INCOME:", "REFUND")?.trim().toLowerCase();
  if (!decision) return;
  const action = decision === "refund" ? "refund" : decision === "income" || decision === "move to income" ? "move_to_income" : "";
  if (!action) throw new Error("Choose REFUND or INCOME.");
  const query = supabase.from("accounts").select("id,code,name,type").eq("is_active", true);
  const { data: accounts, error } = action === "refund"
    ? await query.eq("type", "asset").like("code", "10%").order("code")
    : await query.eq("type", "revenue").order("code");
  if (error) throw error;
  if (!accounts?.length) throw new Error(action === "refund" ? "No active cash or bank accounts were found." : "No active income accounts were found.");
  const choices = accounts.map(a => a.code + " · " + a.name).join("\n");
  const accountCode = prompt("Enter the account code to use:\n" + choices);
  if (!accountCode) return;
  const account = accounts.find(a => a.code.toLowerCase() === accountCode.trim().toLowerCase());
  if (!account) throw new Error("That account code is not in the available list.");
  const amountText = prompt("Amount to " + (action === "refund" ? "refund" : "move to income") + " (available " + money(v.available_amount) + "):", Number(v.available_amount).toFixed(2));
  if (amountText === null) return;
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number(v.available_amount) + 0.005) throw new Error("Enter a valid amount within the remaining expired credit.");
  const reason = prompt("Reason for this expired-credit decision:")?.trim();
  if (!reason) return;
  const { data, error: resolveError } = await supabase.rpc("resolve_expired_credit_voucher", {
    p_voucher_id: v.voucher_id, p_decision: action, p_amount: amount, p_account_id: account.id, p_reason: reason,
  });
  if (resolveError) throw resolveError;
  await load();
  setRedeemMessage("Expired credit " + (action === "refund" ? "refunded" : "moved to income") + ": " + money(data.amount) +
    ". Remaining expired credit: " + money(data.remaining_balance) + ".");
}

async function manage(voucherId, action, extra = {}) {
  const promptText = action === "set_expiry" ? "Reason for changing the voucher expiry date:" :
    action === "cancel" ? "Reason for cancelling this voucher:" : "Reason for reversing this voucher redemption:";
  const reason = prompt(promptText)?.trim();
  if (!reason) return;
  const { error } = await supabase.rpc("manage_credit_voucher", {
    p_voucher_id: voucherId, p_action: action, p_reason: reason,
    p_new_expiry: extra.expiry || null, p_redemption_id: extra.redemptionId || null,
  });
  if (error) throw error;
  await load();
}

tabButton?.addEventListener("click", async () => {
  const showVouchers = host.hidden;
  host.hidden = !showVouchers;
  if (notesPanel) notesPanel.hidden = showVouchers;
  tabButton.setAttribute("aria-pressed", String(showVouchers));
  notesTabButton?.setAttribute("aria-pressed", String(!showVouchers));
  if (showVouchers) {
    try { await load(); } catch (error) { list.innerHTML = '<div class="customer-credit-empty">Could not load vouchers: ' + esc(error.message || error) + '</div>'; }
  }
});
notesTabButton?.addEventListener("click", () => {
  host.hidden = true;
  if (notesPanel) notesPanel.hidden = false;
  tabButton.setAttribute("aria-pressed", "false");
  notesTabButton.setAttribute("aria-pressed", "true");
});
settingsButton?.addEventListener("click", async () => {
  try {
    const { data, error } = await supabase.from("credit_voucher_settings").select("default_expiry_days,terms").eq("id", true).single();
    if (error) throw error;
    const days = prompt("Default voucher expiry in days (applies to new vouchers):", String(data.default_expiry_days));
    if (days === null) return;
    const parsedDays = Number(days);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 3650) throw new Error("Expiry must be a whole number between 1 and 3650 days.");
    const nextTerms = prompt("Voucher terms and conditions:", data.terms || terms);
    if (nextTerms === null) return;
    const { error: saveError } = await supabase.rpc("update_credit_voucher_settings", {
      p_default_expiry_days: parsedDays, p_terms: nextTerms,
    });
    if (saveError) throw saveError;
    terms = nextTerms;
    alert("Voucher settings updated. The new expiry applies to vouchers issued from now on.");
  } catch (error) { alert(error.message || String(error)); }
});
refresh?.addEventListener("click", async () => {
  refresh.disabled = true;
  try { await load(); } catch (error) { list.innerHTML = '<div class="customer-credit-empty">' + esc(error.message || error) + '</div>'; }
  finally { refresh.disabled = false; }
});
redeemCheck?.addEventListener("click", previewVoucher);
redeemScan?.addEventListener("click", startScanner);
redeemApply?.addEventListener("click", applyVoucher);
redeemTarget?.addEventListener("change", updateRedeemAmount);
redeemAmount?.addEventListener("input", () => {
  const max = Number(redeemAmount.max) || 0;
  const amount = Number(redeemAmount.value);
  redeemApply.disabled = (!checkedVoucher && !selectedCustomerCreditNote) || !Number.isFinite(amount) || amount <= 0 || amount > max + 0.005;
});
redeemCode?.addEventListener("input", () => {
  checkedVoucher = null;
  selectedCustomerCreditNote = null;
  if (redeemSourceSelect) redeemSourceSelect.value = "";
  redeemApply.disabled = true;
});
window.addEventListener("apr:open-voucher-redemption", async event => {
  const detail = event.detail || {};
  preferredRedeemTarget = detail.targetId ? { targetType: detail.targetType || "repair_job", targetId: String(detail.targetId) } : null;
  host.hidden = false;
  redeemCode.value = "";
  checkedVoucher = null;
  selectedCustomerCreditNote = null;
  currentCustomer = null;
  currentTarget = null;
  if (redeemSourceSelect) redeemSourceSelect.innerHTML = '<option value="">Loading customer credit…</option>';
  redeemPreview.textContent = "";
  redeemTarget.innerHTML = '<option value="">Check a voucher first</option>';
  redeemTarget.disabled = true;
  redeemAmount.value = "";
  redeemAmount.disabled = true;
  if (redeemConfirmation) redeemConfirmation.value = "";
  if (redeemAuthorisedBy) redeemAuthorisedBy.value = "";
  redeemApply.disabled = true;
  setRedeemMessage(preferredRedeemTarget ? "Check the voucher code. This job card will be selected automatically." : "Enter a voucher code to continue.");
  try {
    await load();
    await loadCustomerCreditSources(preferredRedeemTarget);
  } catch (error) { setRedeemMessage(error.message || String(error), "error"); }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) stopScanner(); });
search?.addEventListener("input", render);
statusFilter?.addEventListener("change", render);

list.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const voucherId = button.dataset.voucherPrint || button.dataset.voucherWhatsapp || button.dataset.voucherExpiry || button.dataset.voucherCancel || button.dataset.voucherResolve || button.dataset.voucherId;
  const v = vouchers.find(row => row.voucher_id === voucherId);
  if (!v) return;
  button.disabled = true;
  try {
    if (button.dataset.voucherPrint) await printVoucher(v);
    else if (button.dataset.voucherWhatsapp) {
      const phone = phoneForWhatsApp(v.customer_phone);
      if (!phone) throw new Error("No WhatsApp number is saved for this customer.");
      const whatsappWindow = window.open("about:blank", "_blank");
      if (!whatsappWindow) throw new Error("Allow pop-ups to open WhatsApp.");
      try {
        const { error: auditError } = await supabase.rpc("log_credit_voucher_event", { p_voucher_id: v.voucher_id, p_action: "whatsapp_shared" });
        if (auditError) throw auditError;
        const message = "Hello " + (v.company_name || v.customer_name || "Customer") + ", your Centric Auto Mobile credit voucher is ready.\n\nCustomer ID: " + (v.customer_code || "Not assigned") + "\nValue: " + money(v.available_amount) +
          "\nVoucher code: " + v.voucher_code + "\nExpiry: " + dateLabel(v.expires_at) + "\n\n" + terms;
        whatsappWindow.location.href = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
      } catch (error) {
        whatsappWindow.close();
        throw error;
      }
    } else if (button.dataset.voucherExpiry) {
      const value = prompt("Enter the new expiry date (YYYY-MM-DD):", v.expires_at);
      if (!value) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error("Enter a valid date in YYYY-MM-DD format.");
      await manage(v.voucher_id, "set_expiry", { expiry: value });
    } else if (button.dataset.voucherResolve) await resolveExpiredCredit(v);
    else if (button.dataset.voucherCancel) await manage(v.voucher_id, "cancel");
    else if (button.dataset.voucherReverse) await manage(v.voucher_id, "reverse", { redemptionId: button.dataset.voucherReverse });
  } catch (error) { alert(error.message || String(error)); }
  finally { button.disabled = false; }
});
document.addEventListener("apr:access-ready", () => { if (!host.hidden) load().catch(error => console.error("Voucher refresh failed:", error)); });


async function loadCustomerCreditSources(target) {
  if (!target?.targetId) return;
  const sourceType = target.targetType === "repair_job" ? "Repair job" : target.targetType === "sales_order" ? "Sales order" : "Invoice";
  const { data: statement, error: statementError } = await supabase.from("customer_account_statement")
    .select("customer_id,customer_name,source_id,source_type,balance_due")
    .eq("source_id", target.targetId).eq("source_type", sourceType).maybeSingle();
  if (statementError) throw statementError;
  if (!statement?.customer_id) {
    setRedeemMessage("This job card or invoice is not linked to a registered customer.", "error");
    return;
  }
  currentTarget = { ...target, customer_id: statement.customer_id, balance_due: Number(statement.balance_due) || 0, source_type: sourceType };
  const { data: customer, error: customerError } = await supabase.from("customers")
    .select("id,customer_code,is_company,company_name,full_name,phone")
    .eq("id", statement.customer_id).single();
  if (customerError) throw customerError;
  currentCustomer = customer;
  const [notesResult, voucherResult] = await Promise.all([
    supabase.from("customer_credit_balances")
      .select("deposit_receipt_id,credit_note_number,quotation_id,available_amount,created_at,customer_code,is_company,company_name")
      .eq("customer_id", customer.id).gt("available_amount", 0.005).order("created_at", { ascending: true }),
    supabase.rpc("list_customer_credit_vouchers_with_identity"),
  ]);
  if (notesResult.error) throw notesResult.error;
  if (voucherResult.error) throw voucherResult.error;
  const notes = notesResult.data || [];
  const quotationIds = [...new Set(notes.map(row => row.quotation_id).filter(Boolean))];
  let quotationDates = new Map();
  if (quotationIds.length) {
    const { data: quotes, error } = await supabase.from("quotations").select("id,created_at").in("id", quotationIds);
    if (error) throw error;
    quotationDates = new Map((quotes || []).map(row => [row.id, row.created_at]));
  }
  const activeVoucherNoteIds = new Set((voucherResult.data || [])
    .filter(row => row.customer_id === customer.id && row.status === "active" && Number(row.available_amount) > 0.005 && row.credit_note_type === "quotation_deposit")
    .map(row => row.credit_note_id));
  const noteSources = notes.filter(row => !activeVoucherNoteIds.has(row.deposit_receipt_id)).map(row => {
    const createdAt = quotationDates.get(row.quotation_id) || row.created_at;
    const expiry = createdAt ? new Date(Date.parse(createdAt) + 7 * 86400000).toISOString().slice(0,10) : null;
    return {
      kind: "deposit", id: row.deposit_receipt_id,
      deposit_receipt_id: row.deposit_receipt_id,
      code: "QCN-" + String(row.credit_note_number).padStart(6,"0"),
      available_amount: Number(row.available_amount) || 0,
      expires_at: expiry, issued_at: createdAt || row.created_at,
      customer_id: customer.id,
    };
  });
  const voucherSources = (voucherResult.data || []).filter(row =>
    row.customer_id === customer.id && row.status === "active" && Number(row.available_amount) > 0.005
  ).map(row => ({
    kind: "voucher", id: row.voucher_id, code: row.voucher_code,
    available_amount: Number(row.available_amount) || 0,
    expires_at: row.expires_at, issued_at: row.issued_at,
    customer_id: customer.id,
  }));
  customerCreditSources = [...noteSources, ...voucherSources].sort((a,b) =>
    Date.parse(a.issued_at || a.expires_at || 0) - Date.parse(b.issued_at || b.expires_at || 0)
  );
  if (redeemSourceSelect) {
    redeemSourceSelect.innerHTML = '<option value="">Choose a credit note or voucher…</option>' +
      customerCreditSources.map(source => '<option value="' + esc(source.kind + ":" + source.id) + '">' +
        esc(source.code + " · " + money(source.available_amount) + " available · expires " + dateLabel(source.expires_at)) +
      '</option>').join("");
  }
  const label = (customer.company_name || customer.full_name || "Customer") +
    (customer.customer_code ? " · " + customer.customer_code : "");
  if (!customerCreditSources.length) {
    redeemPreview.textContent = label + " has no active credit notes or vouchers.";
    redeemTarget.innerHTML = '<option value="">No available customer credit</option>';
    redeemTarget.disabled = true;
    redeemAmount.value = "";
    redeemAmount.disabled = true;
    setRedeemMessage("No available customer credit was found for this customer.");
    return;
  }
  redeemPreview.textContent = label + " · " + customerCreditSources.length + " available credit source(s).";
  if (customerCreditSources.length === 1) {
    const only = customerCreditSources[0];
    if (redeemSourceSelect) redeemSourceSelect.value = only.kind + ":" + only.id;
    await selectCustomerCreditSource(only);
  } else {
    selectedCustomerCreditNote = null;
    checkedVoucher = null;
    redeemAmount.value = "";
    redeemAmount.disabled = true;
    redeemApply.disabled = true;
    await loadRedeemTargets();
    setRedeemMessage("Choose a credit note or voucher. Sources are listed oldest first.");
  }
}

async function selectCustomerCreditSource(source) {
  selectedCustomerCreditNote = source.kind === "deposit" ? source : null;
  checkedVoucher = null;
  if (source.kind === "voucher") {
    redeemCode.value = source.code;
    await previewVoucher();
    return;
  }
  const customer = currentCustomer;
  const label = customer?.company_name || customer?.full_name || "Customer";
  const confirmationLabel = host.querySelector("#voucher-redeem-confirmation-label");
  const authorLabel = host.querySelector("#voucher-redeem-authorised-label");
  if (confirmationLabel) confirmationLabel.textContent = customer?.is_company ? "Confirm company name exactly" : "Customer phone last 4 digits or full name";
  if (authorLabel) authorLabel.hidden = !customer?.is_company;
  if (redeemAuthorisedBy) { redeemAuthorisedBy.hidden = !customer?.is_company; redeemAuthorisedBy.required = Boolean(customer?.is_company); }
  if (redeemConfirmation) { redeemConfirmation.value = ""; redeemConfirmation.placeholder = customer?.is_company ? "Type the company name" : "Last 4 phone digits or full name"; }
  if (redeemAuthorisedBy) redeemAuthorisedBy.value = "";
  redeemPreview.textContent = label + " · " + source.code + " · " + money(source.available_amount) + " available · expires " + dateLabel(source.expires_at);
  await loadRedeemTargets();
  updateRedeemAmount();
}

redeemSourceSelect?.addEventListener("change", async () => {
  const [kind,id] = (redeemSourceSelect.value || "").split(":");
  const source = customerCreditSources.find(row => row.kind === kind && row.id === id);
  if (!source) return;
  try { await selectCustomerCreditSource(source); }
  catch (error) { setRedeemMessage(error.message || String(error), "error"); }
});
