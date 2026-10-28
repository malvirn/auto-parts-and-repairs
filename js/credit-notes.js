// ========= Credit notes (self-contained, loads alongside receipts.js) =========
// Adds a "Credit" button next to every "View" button in the Issued Receipts
// table, opens a form built from that receipt, and saves via the
// issue_credit_note() SQL function. No edits to receipts.js needed.
import supabase from "./supabaseClient.js";

const tableBody = document.getElementById("receipts-table");

const SELECT = `id, receipt_number, amount, issued_at,
  repair_jobs(id, job_number, cro_number, labour_cost, customers(id, full_name, phone), job_parts(part_id, part_name, quantity, price_at_time), job_incidentals(description, amount)),
  sales_orders(id, order_number, walk_in_name, customers(id, full_name, phone), sales_order_items(part_id, part_name, quantity, unit_price_usd))`;

const money = n => `$${Number(n || 0).toFixed(2)}`;
const esc = s => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };

// ---------- add the Credit button to each row ----------
function addButtons() {
  if (!tableBody) return;
  tableBody.querySelectorAll(".view-receipt-btn").forEach(view => {
    if (view.parentElement.querySelector(".credit-note-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn credit-note-btn";
    btn.dataset.jobId = view.dataset.jobId || "";
    btn.dataset.orderId = view.dataset.orderId || "";
    btn.innerHTML = `<i data-lucide="undo-2"></i> Credit`;
    view.after(btn);
    view.parentElement.style.display = "flex";
    view.parentElement.style.gap = "6px";
  });
  if (window.lucide) lucide.createIcons();
}

if (tableBody) {
  new MutationObserver(addButtons).observe(tableBody, { childList: true, subtree: true });
  addButtons();
  tableBody.addEventListener("click", e => {
    const btn = e.target.closest(".credit-note-btn");
    if (btn) openCreditNote(btn);
  });
}

// ---------- load receipt + what's already been credited ----------
async function loadReceipt(btn) {
  let q = supabase.from("receipts").select(SELECT);
  q = btn.dataset.jobId ? q.eq("repair_job_id", btn.dataset.jobId) : q.eq("sales_order_id", btn.dataset.orderId);
  const { data, error } = await q.order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function creditedQty(receiptId) {
  const { data, error } = await supabase
    .from("credit_note_items")
    .select("part_name, quantity, credit_notes!inner(receipt_id)")
    .eq("credit_notes.receipt_id", receiptId);
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { map[r.part_name] = (map[r.part_name] || 0) + Number(r.quantity); });
  return map;
}

function buildLines(receipt) {
  const job = receipt.repair_jobs, order = receipt.sales_orders;
  if (job) {
    return {
      ref: job.cro_number || `Job #${String(job.job_number || "").padStart(4, "0")}`,
      customer: job.customers,
      lines: [
        ...(job.job_parts || []).map(i => ({ name: i.part_name || "Part", partId: i.part_id, qty: Number(i.quantity || 0), price: Number(i.price_at_time || 0), part: true })),
        ...(job.job_incidentals || []).map(i => ({ name: i.description || "Incidental", partId: null, qty: 1, price: Number(i.amount || 0), part: false })),
        ...(Number(job.labour_cost) > 0 ? [{ name: "Labour", partId: null, qty: 1, price: Number(job.labour_cost), part: false }] : []),
      ],
    };
  }
  if (order) {
    return {
      ref: `Order #${String(order.order_number || "").padStart(4, "0")}`,
      customer: order.customers || (order.walk_in_name ? { full_name: order.walk_in_name } : null),
      lines: (order.sales_order_items || []).map(i => ({ name: i.part_name || "Part", partId: i.part_id, qty: Number(i.quantity || 0), price: Number(i.unit_price_usd || 0), part: true })),
    };
  }
  return null;
}

// ---------- modal ----------
async function openCreditNote(btn) {
  btn.disabled = true;
  try {
    const receipt = await loadReceipt(btn);
    const built = receipt && buildLines(receipt);
    if (!built) { alert("This receipt has no source record, so a credit note can't be built from it."); return; }

    const credited = await creditedQty(receipt.id);
    const lines = built.lines
      .map(l => ({ ...l, remaining: l.qty - (credited[l.name] || 0) }))
      .filter(l => l.remaining > 0);
    if (!lines.length) { alert("Everything on this receipt has already been credited."); return; }

    showModal(receipt, built, lines);
  } catch (err) {
    console.error(err);
    alert("Couldn't open credit note: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function showModal(receipt, built, lines) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.alignItems = "center";
  overlay.innerHTML = `
    <div style="width:min(620px,calc(100% - 24px));margin:auto;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:16px;color:var(--text)">
      <h2 style="margin:0 0 4px">Credit note</h2>
      <p style="margin:0 0 14px;color:var(--muted)">Receipt #${String(receipt.receipt_number).padStart(4, "0")} · ${esc(built.ref)} · ${esc(built.customer?.full_name || "Walk-in")}</p>
      <div style="display:grid;gap:8px">
        ${lines.map((l, i) => `
          <div style="display:grid;grid-template-columns:auto 1fr 70px auto;gap:10px;align-items:center">
            <input type="checkbox" class="cn-on" data-i="${i}">
            <span>${esc(l.name)} <small style="color:var(--muted)">@ ${money(l.price)}</small></span>
            <input type="number" class="cn-qty" data-i="${i}" min="1" max="${l.remaining}" value="${l.remaining}" ${l.part ? "" : "disabled"} style="min-height:36px">
            ${l.part ? `<label style="font-size:12px"><input type="checkbox" class="cn-stock" data-i="${i}"> restock</label>` : "<span></span>"}
          </div>`).join("")}
      </div>
      <textarea id="cn-reason" placeholder="Reason (returned, overcharge, cancelled...)" style="width:100%;margin-top:14px;min-height:60px"></textarea>
      <label style="display:block;margin-top:8px"><input type="checkbox" id="cn-refund"> Cash refunded to customer</label>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:10px;flex-wrap:wrap">
        <strong id="cn-total">Total: $0.00</strong>
        <span style="display:flex;gap:8px">
          <button type="button" class="btn" id="cn-cancel">Cancel</button>
          <button type="button" class="btn btn--primary" id="cn-save">Issue credit note</button>
        </span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const selected = () => lines.map((l, i) => {
    if (!overlay.querySelector(`.cn-on[data-i="${i}"]`).checked) return null;
    const raw = Number(overlay.querySelector(`.cn-qty[data-i="${i}"]`).value) || 1;
    return {
      part_name: l.name,
      part_id: l.partId || null,
      quantity: l.part ? Math.min(l.remaining, Math.max(1, raw)) : 1,
      unit_price: l.price,
      restock: !!overlay.querySelector(`.cn-stock[data-i="${i}"]`)?.checked,
    };
  }).filter(Boolean);

  const total = () => selected().reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const refresh = () => { overlay.querySelector("#cn-total").textContent = `Total: ${money(total())}`; };
  overlay.addEventListener("input", refresh);
  overlay.addEventListener("change", refresh);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#cn-cancel").onclick = () => overlay.remove();

  overlay.querySelector("#cn-save").onclick = async e => {
    const items = selected();
    if (!items.length) { alert("Tick at least one line."); return; }
    const saveButton = e.currentTarget;
    saveButton.disabled = true;
    try {
      const { data, error } = await supabase.rpc("issue_credit_note", {
        p_receipt_id: receipt.id,
        p_customer_id: built.customer?.id || null,
        p_reason: overlay.querySelector("#cn-reason").value,
        p_refunded: overlay.querySelector("#cn-refund").checked,
        p_items: items,
      });
      if (error) throw error;

      overlay.remove();
      alert(`Credit note #${String(data.credit_note_number).padStart(4, "0")} issued for ${money(data.amount)}.`);
    } catch (error) {
      console.error(error);
      alert("Failed: " + error.message);
      saveButton.disabled = false;
    }
  };
}