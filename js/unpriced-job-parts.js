import supabase from "./supabaseClient.js";

const body = document.getElementById("unpriced-job-parts-body");
const message = document.getElementById("unpriced-job-parts-message");

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value ?? "";
  return element.innerHTML;
}

async function loadUnpricedJobParts() {
  body.innerHTML = '<tr><td colspan="6" class="empty-state">Loading unpriced job parts…</td></tr>';
  message.textContent = "";
  const { data, error } = await supabase.rpc("get_unpriced_job_parts");

  if (error) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">Could not load the typed-in job parts.</td></tr>';
    message.textContent = `Could not load typed-in job parts: ${error.message}. Apply supabase/migrations/job-card-daily-updates-accounting-parts.sql if this feature is not installed.`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No typed-in job parts are waiting for a price.</td></tr>';
    return;
  }

  const settingsResult = await supabase.from("settings").select("markup_rate").maybeSingle();
  const defaultMarkup = settingsResult.error || settingsResult.data?.markup_rate == null
    ? 15
    : Number(settingsResult.data.markup_rate) * 100;

  body.innerHTML = data.map((item) => `
    <tr data-id="${escapeHtml(item.id)}" data-quantity="${escapeHtml(item.quantity || 1)}">
      <td>JC-${String(item.job_number ?? "").padStart(5, "0")}</td>
      <td>${escapeHtml(item.customer_name || "—")}</td>
      <td>${escapeHtml(item.part_name || "Unnamed part")}</td>
      <td>${escapeHtml(item.quantity)}</td>
      <td>
        <input class="unpriced-job-part-cost" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Cost" aria-label="Cost price for ${escapeHtml(item.part_name || "part")}">
        <input class="unpriced-job-part-markup" type="number" min="-100" max="1000" step="0.01" inputmode="decimal" value="${defaultMarkup.toFixed(2)}" aria-label="Markup percentage for ${escapeHtml(item.part_name || "part")}">
        <input class="unpriced-job-part-selling" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Selling" aria-label="Selling price for ${escapeHtml(item.part_name || "part")}">
        <strong class="unpriced-job-part-profit">Profit: —</strong>
      </td>
      <td><button class="btn btn--primary price-unlisted-job-part" type="button">Save price</button></td>
    </tr>`).join("");

  body.querySelectorAll("tr[data-id]").forEach((row) => {
    const costInput = row.querySelector(".unpriced-job-part-cost");
    const markupInput = row.querySelector(".unpriced-job-part-markup");
    const sellingInput = row.querySelector(".unpriced-job-part-selling");
    const profitLabel = row.querySelector(".unpriced-job-part-profit");
    const recalc = () => {
      const cost = Number(costInput.value);
      const markup = Number(markupInput.value);
      let selling = Number(sellingInput.value);
      if (!sellingInput.dataset.manual) {
        selling = Number.isFinite(cost) && cost > 0 && Number.isFinite(markup) && markup >= -100 && markup <= 1000
          ? cost * (1 + markup / 100)
          : NaN;
        if (Number.isFinite(selling)) sellingInput.value = selling.toFixed(2);
      }
      profitLabel.textContent = Number.isFinite(cost) && cost > 0 && Number.isFinite(selling)
        ? `Profit: $${((selling - cost) * Number(row.dataset.quantity || 1)).toFixed(2)}`
        : "Profit: —";
    };
    costInput.addEventListener("input", () => { delete sellingInput.dataset.manual; recalc(); });
    markupInput.addEventListener("input", () => { delete sellingInput.dataset.manual; recalc(); });
    sellingInput.addEventListener("input", () => {
      sellingInput.dataset.manual = "true";
      const cost = Number(costInput.value);
      const selling = Number(sellingInput.value);
      if (Number.isFinite(cost) && cost > 0 && Number.isFinite(selling) && selling > 0) {
        markupInput.value = ((selling / cost - 1) * 100).toFixed(2);
      }
      recalc();
    });
    recalc();
  });

  body.querySelectorAll(".price-unlisted-job-part").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const cost = Number(row.querySelector(".unpriced-job-part-cost").value);
      const markup = Number(row.querySelector(".unpriced-job-part-markup").value);
      const selling = Number(row.querySelector(".unpriced-job-part-selling").value);
      if (!Number.isFinite(cost) || cost <= 0) {
        message.textContent = "Enter a cost price greater than zero.";
        return;
      }
      if (!Number.isFinite(markup) || markup < -100 || markup > 1000) {
        message.textContent = "Enter a markup percentage from -100% to 1000%.";
        return;
      }
      if (!Number.isFinite(selling) || selling <= 0) {
        message.textContent = "Enter a selling price greater than zero.";
        return;
      }

      button.disabled = true;
      message.textContent = "";
      const { error: priceError } = await supabase.rpc("price_unlisted_job_part", {
        p_job_part_id: row.dataset.id,
        p_cost_price: cost,
        p_markup_pct: markup,
        p_selling_price: selling,
      });
      if (priceError) {
        message.textContent = `Could not save this price: ${priceError.message}`;
        button.disabled = false;
        return;
      }
      await loadUnpricedJobParts();
      message.textContent = "Price saved; the job-card total has been updated.";
    });
  });
}

document.getElementById("refresh-unpriced-job-parts").addEventListener("click", loadUnpricedJobParts);
loadUnpricedJobParts();
