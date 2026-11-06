import supabase from "./supabaseClient.js";

const requestBody = document.getElementById("shop-job-part-purchase-body");
const message = document.getElementById("shop-job-part-purchase-message");
const refreshButton = document.getElementById("refresh-job-part-purchase-requests");

if (requestBody && message && refreshButton) {
  let stockParts = [];
  let markupRate = 0.15;

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = value ?? "";
    return element.innerHTML;
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function jobReference(request) {
    return escapeHtml(request.cro_number || `JC-${String(request.job_number || "").padStart(5, "0")}`);
  }

  function receiptControls(request) {
    const partOptions = stockParts.map(part =>
      `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)}${part.part_number ? ` (${escapeHtml(part.part_number)})` : ""}</option>`
    ).join("");
    const defaultSellingPrice = (Number(request.quoted_unit_cost) * (1 + markupRate) * 1.05).toFixed(2);
    return `
      <a class="btn job-part-purchase-order" href="mailto:${encodeURIComponent(request.supplier_email || "")}?subject=${encodeURIComponent(`Purchase order: ${request.part_name}`)}&body=${encodeURIComponent(`Please supply ${request.quantity} × ${request.part_name} for ${jobReference(request)}. Supplier quote: ${money(request.quoted_unit_cost)} per unit.`)}">Email supplier order</a>
      <form class="job-part-purchase-receive" data-request-id="${escapeHtml(request.id)}">
        <label>Inventory item
          <select name="existing_part_id">
            <option value="">Create new inventory item</option>${partOptions}
          </select>
        </label>
        <label>Part number (new item)
          <input name="part_number" maxlength="100" autocomplete="off">
        </label>
        <label>Selling price (new item)
          <input name="selling_price" type="number" min="0.01" step="0.01" value="${defaultSellingPrice}" required>
        </label>
        <button class="btn btn--primary" type="submit">Receive into stock</button>
      </form>`;
  }

  function renderRequests(requests) {
    if (!requests?.length) {
      requestBody.innerHTML = '<tr><td colspan="4" class="empty-state">No job-card parts need Shop action.</td></tr>';
      return true;
    }

    requestBody.innerHTML = requests.map(request => {
      let action = "";
      let supplierDetails = "Not yet quoted";
      if (request.status === "requested") {
        action = `
          <form class="job-part-purchase-quote" data-request-id="${escapeHtml(request.id)}">
            <label>Supplier name <input name="supplier_name" maxlength="200" required></label>
            <label>Supplier email <input name="supplier_email" type="email" maxlength="254" required></label>
            <label>Supplier phone <input name="supplier_phone" type="tel" maxlength="50" required></label>
            <label>Quoted unit cost <input name="unit_cost" type="number" min="0.01" step="0.01" required></label>
            <button class="btn btn--primary" type="submit">Send quote to Accounting</button>
          </form>`;
      } else {
        supplierDetails = `${escapeHtml(request.supplier_name || "—")}<br>${escapeHtml(request.supplier_email || "")}<br>${escapeHtml(request.supplier_phone || "")}`;
        if (request.quoted_unit_cost != null) {
          supplierDetails += `<br>${money(request.quoted_unit_cost)} per unit`;
        }
        action = request.status === "paid"
          ? receiptControls(request)
          : '<span>Waiting for Accounting to release funds</span>';
      }

      return `<tr>
        <td>${jobReference(request)}<br>${escapeHtml(request.customer_name || "—")}</td>
        <td>${escapeHtml(request.part_name || "Unnamed part")}<br>Quantity: ${escapeHtml(request.quantity)}</td>
        <td>${supplierDetails}</td>
        <td>${action}</td>
      </tr>`;
    }).join("");

    if (window.lucide) window.lucide.createIcons();
  }

  async function loadRequests() {
    refreshButton.disabled = true;
    requestBody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading job-card part requests…</td></tr>';
    message.textContent = "";
    message.dataset.tone = "";
    try {
      const [{ data: requests, error: requestError }, { data: parts, error: partsError }] = await Promise.all([
        supabase.rpc("get_shop_job_part_purchase_requests"),
        supabase.from("parts").select("id, name, part_number").order("name"),
      ]);
      if (requestError) throw new Error(`Couldn't load job-part requests: ${requestError.message}`);
      if (partsError) throw new Error(`Couldn't load inventory items: ${partsError.message}`);
      stockParts = parts || [];
      renderRequests(requests || []);
      return true;
    } catch (error) {
      console.error("Couldn't load Shop job-part requests:", error);
      requestBody.innerHTML = '<tr><td colspan="4" class="empty-state">Could not load job-card part requests.</td></tr>';
      message.textContent = `${error.message || String(error)}. Apply supabase/migrations/job-part-purchase-requests.sql after the job-card and Shop migrations.`;
      message.dataset.tone = "error";
      return false;
    } finally {
      refreshButton.disabled = false;
    }
  }

  requestBody.addEventListener("submit", async event => {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = "";
    message.dataset.tone = "";

    try {
      if (form.matches(".job-part-purchase-quote")) {
        const values = new FormData(form);
        const unitCost = Number(values.get("unit_cost"));
        if (!Number.isFinite(unitCost) || unitCost <= 0) throw new Error("Enter a quoted unit cost greater than zero.");
        const { error } = await supabase.rpc("submit_job_part_purchase_quote", {
          p_request_id: form.dataset.requestId,
          p_supplier_name: values.get("supplier_name"),
          p_supplier_email: values.get("supplier_email"),
          p_supplier_phone: values.get("supplier_phone"),
          p_unit_cost: unitCost,
        });
        if (error) throw new Error(error.message);
        const loaded = await loadRequests();
        if (loaded) {
          message.textContent = "Supplier quote sent to Accounting for payment.";
          message.dataset.tone = "success";
        }
      } else if (form.matches(".job-part-purchase-receive")) {
        const values = new FormData(form);
        const existingPartId = values.get("existing_part_id") || null;
        const sellingPrice = Number(values.get("selling_price"));
        if (!existingPartId && (!Number.isFinite(sellingPrice) || sellingPrice <= 0)) {
          throw new Error("Enter a selling price greater than zero for the new inventory item.");
        }
        const { error } = await supabase.rpc("receive_job_part_purchase", {
          p_request_id: form.dataset.requestId,
          p_existing_part_id: existingPartId,
          p_part_number: values.get("part_number") || null,
          p_selling_price: existingPartId ? null : sellingPrice,
          p_vat_rate: 5,
        });
        if (error) throw new Error(error.message);
        message.textContent = "Part received into inventory and linked to its job card. Refreshing Shop stock…";
        message.dataset.tone = "success";
        window.setTimeout(() => window.location.reload(), 500);
        return;
      }

    } catch (error) {
      console.error("Shop job-part purchase action failed:", error);
      message.textContent = `Couldn't complete the request: ${error.message || String(error)}`;
      message.dataset.tone = "error";
      button.disabled = false;
    }
  });

  refreshButton.addEventListener("click", loadRequests);

  Promise.all([
    supabase.from("settings").select("markup_rate").maybeSingle(),
    supabase.from("parts").select("id, name, part_number").order("name"),
  ]).then(([settingsResult, partsResult]) => {
    if (settingsResult.error) console.error("Couldn't load Shop markup for new stock items:", settingsResult.error);
    else if (settingsResult.data?.markup_rate != null) markupRate = Number(settingsResult.data.markup_rate);
    if (partsResult.error) console.error("Couldn't load Shop inventory items:", partsResult.error);
    else stockParts = partsResult.data || [];
    return loadRequests();
  }).catch(error => {
    console.error("Couldn't initialize Shop job-part requests:", error);
    message.textContent = `Couldn't initialize the purchase queue: ${error.message || String(error)}`;
    message.dataset.tone = "error";
  });
}
