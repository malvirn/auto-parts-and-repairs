import supabase from "./supabaseClient.js";

const form = document.getElementById("supplier-form");
const tableBody = document.getElementById("suppliers-table");
const modal = document.getElementById("supplier-modal");
const saveButton = document.getElementById("supplier-save");
const deleteButton = document.getElementById("supplier-delete");
const cancelButton = document.getElementById("supplier-cancel");
const formMessage = document.getElementById("supplier-form-message");
const searchInput = document.getElementById("supplier-search");
const supplierCount = document.getElementById("supplier-count");
const exportButton = document.getElementById("export-suppliers-btn");

const onlineForm = document.getElementById("online-search-form");
const onlineInput = document.getElementById("online-search-input");
const onlineResults = document.getElementById("online-search-results");
const onlineMessage = document.getElementById("online-search-message");

const fields = {
  name: document.getElementById("supplier-name"),
  contact_person: document.getElementById("supplier-contact"),
  phone: document.getElementById("supplier-phone"),
  email: document.getElementById("supplier-email"),
  address: document.getElementById("supplier-address"),
  notes: document.getElementById("supplier-notes"),
};
const editFields = {
  name: document.getElementById("edit-supplier-name"),
  contact_person: document.getElementById("edit-supplier-contact"),
  phone: document.getElementById("edit-supplier-phone"),
  email: document.getElementById("edit-supplier-email"),
  address: document.getElementById("edit-supplier-address"),
  notes: document.getElementById("edit-supplier-notes"),
};

let currentId = null;
let allSuppliers = [];   // full list from the DB, used for local filtering
let currentFilter = "";

function showFormMessage(text = "", tone = "info") {
  if (!formMessage) return;
  formMessage.textContent = text;
  formMessage.dataset.tone = tone; // "info" | "error" | "success" — styled in CSS
}

function showOnlineMessage(text = "", tone = "info") {
  if (!onlineMessage) return;
  onlineMessage.textContent = text;
  onlineMessage.dataset.tone = tone;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function closeModal() {
  modal.classList.add("hidden");
  modal.style.display = "none";
  currentId = null;
}

function openModal(supplier) {
  currentId = supplier.id;
  Object.entries(editFields).forEach(([key, input]) => { input.value = supplier[key] || ""; });
  modal.classList.remove("hidden");
  modal.style.display = "flex";
}

// ---------- Load + render + local filter ----------

async function loadSuppliers() {
  tableBody.innerHTML = `<tr><td colspan="6" class="empty-state"><i data-lucide="loader-circle"></i><span>Loading…</span></td></tr>`;
  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) {
    tableBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">Failed to load suppliers: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  allSuppliers = data || [];
  renderTable();
}

function renderTable() {
  const term = currentFilter.trim().toLowerCase();
  const rows = term
    ? allSuppliers.filter(s =>
        [s.name, s.contact_person, s.phone, s.email, s.address, s.notes]
          .filter(Boolean)
          .some(v => v.toLowerCase().includes(term))
      )
    : allSuppliers;

  if (supplierCount) {
    supplierCount.textContent = term
      ? `${rows.length} of ${allSuppliers.length} suppliers`
      : `${allSuppliers.length} supplier${allSuppliers.length === 1 ? "" : "s"}`;
  }

  if (!allSuppliers.length) {
    tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No suppliers yet — add your first supplier above, or look one up online.</td></tr>`;
    return;
  }
  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No suppliers match "${escapeHtml(currentFilter)}".</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map(supplier => `
    <tr data-supplier='${JSON.stringify(supplier).replace(/'/g, "&apos;")}'>
      <td><strong>${escapeHtml(supplier.name)}</strong></td>
      <td>${escapeHtml(supplier.contact_person || "—")}</td>
      <td>${escapeHtml(supplier.phone || "—")}</td>
      <td>${escapeHtml(supplier.email || "—")}</td>
      <td>${escapeHtml(supplier.address || "—")}</td>
      <td><button type="button" class="btn edit-supplier-btn"><i data-lucide="pencil"></i> Edit</button></td>
    </tr>
  `).join("");

  if (window.lucide) lucide.createIcons();
  tableBody.querySelectorAll(".edit-supplier-btn").forEach(button => {
    button.addEventListener("click", () => openModal(JSON.parse(button.closest("tr").dataset.supplier)));
  });
}

searchInput?.addEventListener("input", event => {
  currentFilter = event.target.value;
  renderTable();
});

// ---------- Export to CSV ----------

exportButton?.addEventListener("click", () => {
  if (!allSuppliers.length) return;
  const headers = ["Name", "Contact Person", "Phone", "Email", "Address", "Notes"];
  const rows = allSuppliers.map(s => [s.name, s.contact_person, s.phone, s.email, s.address, s.notes]
    .map(v => `"${(v || "").replace(/"/g, '""')}"`).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `suppliers-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

// ---------- Add supplier (manual form) ----------

function isDuplicate(name) {
  const target = name.trim().toLowerCase();
  return allSuppliers.some(s => (s.name || "").trim().toLowerCase() === target);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const supplier = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim() || null]));

  if (!supplier.name) {
    showFormMessage("Supplier name is required.", "error");
    fields.name.focus();
    return;
  }
  if (supplier.phone && !/^\+263\s\d{2}\s\d{3}\s\d{4}$/.test(supplier.phone)) {
    showFormMessage("Phone must use this format: +263 00 000 0000", "error");
    return;
  }
  if (supplier.email && !/^[^\s@]+@gmail\.com$/.test(supplier.email)) {
    showFormMessage("Email must end with @gmail.com", "error");
    return;
  }
  if (isDuplicate(supplier.name)) {
    showFormMessage(`"${supplier.name}" is already in your supplier list — check the table before adding a duplicate.`, "error");
    return;
  }

  showFormMessage("Saving supplier…");
  const { error } = await supabase.from("suppliers").insert([supplier]);
  if (error) {
    console.error("Failed to add supplier:", error);
    showFormMessage(`Failed to add supplier: ${error.message}`, "error");
    return;
  }
  form.reset();
  showFormMessage("Supplier added.", "success");
  loadSuppliers();
});

saveButton.addEventListener("click", async () => {
  if (!currentId) return;
  const supplier = Object.fromEntries(Object.entries(editFields).map(([key, input]) => [key, input.value.trim() || null]));
  if (!supplier.name) return;
  const { error } = await supabase.from("suppliers").update(supplier).eq("id", currentId);
  if (error) { alert("Failed to update supplier: " + error.message); return; }
  closeModal();
  loadSuppliers();
});

deleteButton.addEventListener("click", async () => {
  if (!currentId || !confirm("Delete this supplier? Existing restocks will keep their history.")) return;
  const { error } = await supabase.from("suppliers").delete().eq("id", currentId);
  if (error) { alert("Failed to delete supplier: " + error.message); return; }
  closeModal();
  loadSuppliers();
});

cancelButton.addEventListener("click", closeModal);
modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });

// ---------- Search suppliers online (OpenStreetMap / Nominatim) ----------
// Free, no API key required. Good for name + address; phone/email are
// rarely available from this source so those fields are left for the
// user to fill in before saving. For richer results (phone numbers,
// opening hours, ratings) swap this for the Google Places API behind
// your own backend endpoint — Nominatim is the quick, key-free option
// to get this working today.

let onlineSearchToken = 0;

onlineForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const query = onlineInput.value.trim();
  if (!query) return;

  const token = ++onlineSearchToken;
  onlineResults.innerHTML = "";
  showOnlineMessage("Searching…");

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "zw");
    url.searchParams.set("limit", "8");

    const response = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (token !== onlineSearchToken) return; // a newer search started, drop this one
    if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
    const results = await response.json();

    if (!results.length) {
      showOnlineMessage(`No results for "${query}" in Zimbabwe. Try a more general search, e.g. just the business or area name.`);
      return;
    }

    showOnlineMessage(`${results.length} result${results.length === 1 ? "" : "s"} — data via OpenStreetMap contributors. Review before adding; phone/email aren't included and should be filled in manually.`);
    onlineResults.innerHTML = results.map((place, index) => {
      const name = place.namedetails?.name || place.display_name.split(",")[0];
      return `
        <div class="online-result">
          <div class="online-result__info">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(place.display_name)}</span>
          </div>
          <button type="button" class="btn btn--primary online-add-btn" data-index="${index}">
            <i data-lucide="plus"></i> Use this
          </button>
        </div>`;
    }).join("");

    if (window.lucide) lucide.createIcons();
    onlineResults.querySelectorAll(".online-add-btn").forEach(button => {
      button.addEventListener("click", () => {
        const place = results[button.dataset.index];
        const name = place.namedetails?.name || place.display_name.split(",")[0];
        fields.name.value = name;
        fields.address.value = place.display_name;
        fields.contact_person.value = "";
        fields.phone.value = "";
        fields.email.value = "";
        fields.notes.value = "Found via online lookup — confirm phone/email with the vendor.";
        document.getElementById("supplier-form").scrollIntoView({ behavior: "smooth", block: "start" });
        showFormMessage("Details loaded — confirm phone and email, then click Add Supplier.", "info");
        fields.phone.focus();
      });
    });
  } catch (err) {
    if (token !== onlineSearchToken) return;
    console.error("Online supplier search failed:", err);
    showOnlineMessage(`Lookup failed: ${err.message}. Nominatim is rate-limited — wait a moment and try again.`, "error");
  }
});

document.addEventListener("DOMContentLoaded", loadSuppliers);