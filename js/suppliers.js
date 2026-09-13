import supabase from "./supabaseClient.js";

// ⚠️ Replace with your own restricted key — see setup steps.
// This key is visible to anyone viewing your site's source. That's normal
// for a browser-only Places API key, which is why it must be restricted by
// HTTP referrer (your Netlify domain) and by API (Places API (New) only)
// in Google Cloud Console — see the setup steps provided alongside this file.
const GOOGLE_PLACES_API_KEY = "AIzaSyCnkz5Y71BA7UnNQqtkRm-bLyCnGV3NESA";

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
// Phone/email formats are no longer restricted to Zimbabwe/Gmail — suppliers
// can now be found and added from anywhere, so a fixed format would reject
// perfectly valid international data. Basic sanity checks only.

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
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) {
    showFormMessage("That doesn't look like a valid email address.", "error");
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

// ---------- Search suppliers online (Google Places API, worldwide) ----------
// Places API (New) Text Search returns phone number and website directly in
// the search response — no separate "Place Details" call needed. It does
// NOT return email addresses; Google doesn't expose those for most listings,
// so that field is still left for the user to fill in (e.g. after checking
// the business's website).

let onlineSearchToken = 0;

async function searchGooglePlaces(query) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query }), // no country/region restriction — worldwide
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Lookup failed (${response.status})`);
  }

  const data = await response.json();
  return (data.places || []).map(place => ({
    name: place.displayName?.text || "Unnamed business",
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
    website: place.websiteUri || "",
  }));
}

onlineForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const query = onlineInput.value.trim();
  if (!query) return;

  if (!GOOGLE_PLACES_API_KEY || GOOGLE_PLACES_API_KEY === "YOUR_GOOGLE_PLACES_API_KEY") {
    showOnlineMessage("Online search isn't set up yet — add a Google Places API key in suppliers.js.", "error");
    return;
  }

  const token = ++onlineSearchToken;
  onlineResults.innerHTML = "";
  showOnlineMessage("Searching…");

  try {
    const places = await searchGooglePlaces(query);
    if (token !== onlineSearchToken) return; // a newer search started, drop this one

    if (!places.length) {
      showOnlineMessage(`No results for "${query}". Try a more general search, e.g. just the business or area name.`);
      return;
    }

    showOnlineMessage(`${places.length} result${places.length === 1 ? "" : "s"} — data via Google Maps. Email addresses aren't available from this source; add those manually if you have them.`);
    onlineResults.innerHTML = places.map((place, index) => `
        <div class="online-result">
          <div class="online-result__info">
            <strong>${escapeHtml(place.name)}</strong>
            <span>${escapeHtml(place.address)}${place.phone ? " · " + escapeHtml(place.phone) : ""}</span>
          </div>
          <button type="button" class="btn btn--primary online-add-btn" data-index="${index}">
            <i data-lucide="plus"></i> Use this
          </button>
        </div>`
    ).join("");

    if (window.lucide) lucide.createIcons();
    onlineResults.querySelectorAll(".online-add-btn").forEach(button => {
      button.addEventListener("click", () => {
        const place = places[button.dataset.index];
        fields.name.value = place.name;
        fields.address.value = place.address;
        fields.contact_person.value = "";
        fields.phone.value = place.phone;
        fields.email.value = "";
        fields.notes.value = place.website
          ? `Found via Google Maps. Website: ${place.website}`
          : "Found via Google Maps.";
        document.getElementById("supplier-form").scrollIntoView({ behavior: "smooth", block: "start" });
        showFormMessage(
          place.phone
            ? "Details loaded — add an email if you have one, then click Add Supplier."
            : "Details loaded — phone wasn't available for this listing, add it manually if you have it.",
          "info"
        );
        (place.phone ? fields.email : fields.phone).focus();
      });
    });
  } catch (err) {
    if (token !== onlineSearchToken) return;
    console.error("Online supplier search failed:", err);
    showOnlineMessage(`Lookup failed: ${err.message}. Check that your Google Places API key is valid, billing is enabled, and the key's referrer restriction includes this site.`, "error");
  }
});

document.addEventListener("DOMContentLoaded", loadSuppliers);