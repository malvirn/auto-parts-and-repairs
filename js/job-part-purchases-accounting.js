import supabase from "./supabaseClient.js";

const requestBody = document.getElementById("accounting-job-part-purchase-body");
const message = document.getElementById("accounting-job-part-purchase-message");
const refreshButton = document.getElementById("refresh-accounting-job-part-purchases");

if (requestBody && message && refreshButton) {
  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = value ?? "";
    return element.innerHTML;
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function localDate() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function renderRequests(requests, accounts) {
    if (!requests?.length) {
      requestBody.innerHTML = '<tr><td colspan="7" class="empty-state">No job-part purchases are awaiting funds.</td></tr>';
      return true;
    }

    const accountOptions = accounts.map(account =>
      `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`
    ).join("");
    requestBody.innerHTML = requests.map(request => {
      const total = Number(request.quoted_unit_cost) * Number(request.quantity);
      return `<tr>
        <td>${escapeHtml(request.cro_number || `JC-${String(request.job_number || "").padStart(5, "0")}`)}<br>${escapeHtml(request.customer_name || "—")}</td>
        <td>${escapeHtml(request.part_name || "Unnamed part")}<br>Quantity: ${escapeHtml(request.quantity)}</td>
        <td>${escapeHtml(request.supplier_name || "—")}<br>${escapeHtml(request.supplier_email || "")}<br>${escapeHtml(request.supplier_phone || "")}</td>
        <td>${money(total)}<br><small>${money(request.quoted_unit_cost)} per unit</small></td>
        <td><select class="job-part-purchase-account" aria-label="Cash or Bank account for ${escapeHtml(request.part_name)}"><option value="">Select account…</option>${accountOptions}</select></td>
        <td><input class="job-part-purchase-date" type="date" value="${localDate()}" aria-label="Payment date for ${escapeHtml(request.part_name)}"></td>
        <td><button class="btn btn--primary release-job-part-funds" type="button" data-request-id="${escapeHtml(request.id)}">Release funds</button></td>
      </tr>`;
    }).join("");
  }

  async function loadRequests() {
    refreshButton.disabled = true;
    requestBody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading job-part purchases…</td></tr>';
    message.textContent = "";
    message.dataset.tone = "";
    try {
      const [{ data: requests, error: requestError }, { data: accounts, error: accountError }] = await Promise.all([
        supabase.rpc("get_accounting_job_part_purchase_requests"),
        supabase.from("accounts").select("id, code, name, type")
          .eq("is_active", true).eq("type", "asset").in("code", ["1000", "1010"]).order("code"),
      ]);
      if (requestError) throw new Error(`Couldn't load job-part purchase requests: ${requestError.message}`);
      if (accountError) throw new Error(`Couldn't load active Cash and Bank accounts: ${accountError.message}`);
      renderRequests(requests || [], accounts || []);
      return true;
    } catch (error) {
      console.error("Couldn't load Accounting job-part purchases:", error);
      requestBody.innerHTML = '<tr><td colspan="7" class="empty-state">Could not load job-part purchases awaiting funds.</td></tr>';
      message.textContent = `${error.message || String(error)}. Apply supabase/migrations/job-part-purchase-requests.sql after the job-card and Shop migrations.`;
      message.dataset.tone = "error";
      return false;
    } finally {
      refreshButton.disabled = false;
    }
  }

  requestBody.addEventListener("click", async event => {
    const button = event.target.closest(".release-job-part-funds");
    if (!button) return;
    const row = button.closest("tr");
    const accountId = row.querySelector(".job-part-purchase-account").value;
    const paymentDate = row.querySelector(".job-part-purchase-date").value;
    if (!accountId || !paymentDate) {
      message.textContent = "Choose the Cash or Bank account and actual payment date before releasing funds.";
      message.dataset.tone = "error";
      return;
    }

    button.disabled = true;
    message.textContent = "";
    message.dataset.tone = "";
    try {
      const { error } = await supabase.rpc("release_job_part_purchase_funds", {
        p_request_id: button.dataset.requestId,
        p_cash_account_id: accountId,
        p_payment_date: paymentDate,
      });
      if (error) throw new Error(error.message);
      const loaded = await loadRequests();
      if (loaded) {
        message.textContent = "Payment recorded in the ledger. Shop has been notified to order and receive the part.";
        message.dataset.tone = "success";
      }
    } catch (error) {
      console.error("Couldn't release job-part purchase funds:", error);
      message.textContent = `Couldn't release the funds: ${error.message || String(error)}`;
      message.dataset.tone = "error";
      button.disabled = false;
    }
  });

  refreshButton.addEventListener("click", loadRequests);
  loadRequests();
}
