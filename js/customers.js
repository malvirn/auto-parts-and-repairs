// ========= Customers module =========
import supabase from "./supabaseClient.js";
import { hydrate } from "./data-cache.js";
import { installBulkDelete } from "./bulk-delete.js";

const tableBody = document.getElementById("customers-table");
const form = document.getElementById("customer-form");
const formMessage = document.getElementById("customer-form-message");
const archiveToggle = document.getElementById("customer-archive-toggle");
const directoryTitle = document.getElementById("customer-directory-title");
const directoryDescription = document.getElementById("customer-directory-description");
let showingArchived = false;
let editingCustomerId = null;
let editingVehicleId = null;
let savedCustomerId = null;
let savedVehicleId = null;
let customerSubmissionInProgress = false;
let canManageCustomerCode = false;
let savedCustomerCode = "";
const VEHICLE_BODY_TYPES = ["Sedan", "SUV", "Hatchback", "Pickup", "Van", "Other"];
const vehicleBodyTypeValue = value =>
  VEHICLE_BODY_TYPES.find(type => type.toLowerCase() === String(value || "").trim().toLowerCase()) || "Other";

installBulkDelete({
  tbody: tableBody,
  table: "customers",
  label: "customer",
  getId: row => row.dataset.customerId,
  softDeleteColumn: "deleted_at",
  isSelectable: row => row.dataset.archived !== "true",
});

function showCustomerMessage(text, tone = "success") {
  if (!formMessage) return;
  formMessage.textContent = text;
  formMessage.dataset.tone = tone;
}

function hideSavedActions() {
  const actions = document.getElementById("customer-saved-actions");
  if (actions) actions.hidden = true;
  const cidResult = document.getElementById("customer-cid-result");
  if (cidResult) cidResult.hidden = true;
  savedCustomerCode = "";
  savedCustomerId = null;
  savedVehicleId = null;
}

function showSavedActions(customerId, vehicleId = null, customerCode = "") {
  savedCustomerId = customerId;
  savedVehicleId = vehicleId;
  savedCustomerCode = customerCode || "";
  const actions = document.getElementById("customer-saved-actions");
  const cidResult = document.getElementById("customer-cid-result");
  const cidPill = document.getElementById("customer-cid-pill");
  if (actions) actions.hidden = false;
  if (cidPill) cidPill.textContent = savedCustomerCode || "CID pending";
  if (cidResult) cidResult.hidden = !savedCustomerCode;
  if (window.lucide) lucide.createIcons();
}

function resetCustomerFormMode() {
  editingCustomerId = null;
  editingVehicleId = null;
  hideSavedActions();
  form?.reset();
  const heading = document.getElementById("customer-form-heading");
  const kicker = document.getElementById("customer-form-kicker");
  const submit = document.getElementById("customer-submit-button");
  const cancel = document.getElementById("customer-cancel-edit");
  if (heading) heading.textContent = "Add Customer";
  if (kicker) kicker.textContent = "New record";
  if (submit) submit.innerHTML = '<i data-lucide="user-plus"></i> Add Customer';
  if (cancel) cancel.hidden = true;
  if (window.lucide) lucide.createIcons();
}

// ---- Load and render all customers ----
async function fetchCustomersList() {
  let query = supabase
    .from("customers")
    .select("id, customer_code, full_name, phone, email, customer_type, is_company, company_name, is_repeat_customer, deleted_at, vehicles(id, license_plate, body_type, make, model, year, chassis_number, engine_number)")
    .order("created_at", { ascending: false });
  query = showingArchived ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function renderCustomersList(data) {
  const term = document.getElementById("customer-directory-search")?.value.trim().toLocaleLowerCase() || "";
  data = data.filter(c => [c.full_name,c.customer_code,c.company_name,c.phone,c.email].filter(Boolean).join(" ").toLocaleLowerCase().includes(term));
  if (data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" class="customer-empty"><div class="apr-state apr-state--empty"><div class="apr-state__icon"><i data-lucide="${showingArchived ? "archive" : "user-plus"}"></i></div><div class="apr-state__copy"><strong>${showingArchived ? "No archived customers" : "No customers yet"}</strong><p>${showingArchived ? "There are no archived records to restore." : "Add a customer above to build your directory."}</p></div></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  tableBody.innerHTML = data.map(c => `
    <tr data-customer-id="${c.id}" data-archived="${showingArchived}">
      <td data-label="Customer">${escapeHtml(c.full_name)}<small>Customer ID: ${escapeHtml(c.customer_code || "—")}</small>${c.is_company && c.company_name ? `<small>Company: ${escapeHtml(c.company_name)}</small>` : ""}</td>
      <td data-label="Type"><span class="customer-type" data-type="${c.is_company ? "company" : "individual"}">${c.is_company ? "Company" : "Individual"}</span></td>
      <td data-label="Phone">${escapeHtml(c.phone || "—")}</td>
      <td data-label="Vehicles">${vehiclePlates(c.vehicles)}</td>
      <td data-label="Customer status"><span class="customer-repeat${c.is_repeat_customer ? "" : " is-new"}">${c.is_repeat_customer ? "Repeat customer" : "New customer"}</span></td>
      <td data-label="Action">${showingArchived ? `<button type="button" class="btn customer-restore" data-restore-customer="${escapeHtml(c.id)}"><i data-lucide="rotate-ccw"></i> Restore</button>` : `<button type="button" class="btn customer-edit" data-edit-customer="${escapeHtml(c.id)}"><i data-lucide="pencil"></i> Edit</button>`}</td>
    </tr>
  `).join("");
  if (window.lucide) lucide.createIcons();
}

// Renders instantly from cache (set at sign-in or on an earlier visit this
// session) and refreshes in the background, so arriving on this page never
// shows a blank table while the network replies.
async function loadCustomers() {
  try {
    if (showingArchived) {
      renderCustomersList(await fetchCustomersList());
    } else {
      await hydrate("customers:active-list", fetchCustomersList, renderCustomersList);
    }
  } catch (error) {
    console.error("Error loading customers:", error);
    tableBody.innerHTML = `<tr><td colspan="7" class="customer-empty"><div class="apr-state apr-state--error" role="alert"><div class="apr-state__icon"><i data-lucide="triangle-alert"></i></div><div class="apr-state__copy"><strong>Customers could not be loaded</strong><p>${escapeHtml(error.message)} This is usually a connection, server, or account-permission problem. Check your connection and retry.</p></div></div></td></tr>`;
  }
}

archiveToggle?.addEventListener("click", async () => {
  showingArchived = !showingArchived;
  archiveToggle.setAttribute("aria-pressed", String(showingArchived));
  archiveToggle.textContent = showingArchived ? "View active customers" : "View archived customers";
  if (directoryTitle) directoryTitle.textContent = showingArchived ? "Archived Customers" : "Registered Customers";
  if (directoryDescription) directoryDescription.textContent = showingArchived
    ? "Archived records are retained for review and can be restored."
    : "Active customer records";
  await loadCustomers();
});

tableBody?.addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-customer]");
  if (editButton) {
    await startEditingCustomer(editButton.dataset.editCustomer);
    return;
  }
  const button = event.target.closest("[data-restore-customer]");
  if (!button) return;
  button.disabled = true;
  const { error } = await supabase.from("customers")
    .update({ deleted_at: null })
    .eq("id", button.dataset.restoreCustomer);
  if (error) {
    button.disabled = false;
    showCustomerMessage(`Couldn't restore customer: ${error.message}`, "error");
    return;
  }
  showCustomerMessage("Customer restored.");
  await loadCustomers();
});

// ---- Find an existing customer by phone or email ----
// Phone and/or email identify a real person: if either already exists in
// the table, this form submission is that same customer coming back (most
// likely to register another vehicle) rather than a genuinely new person —
// so we must not insert a second, duplicate customer row for them.
async function findExistingCustomer(phone, email) {
  const filters = [`phone.eq.${phone}`];
  if (email) filters.push(`email.eq.${email}`);

  const { data, error } = await supabase
    .from("customers")
    .select("id, customer_code, full_name, phone, email, is_company, company_name, is_repeat_customer")
    .or(filters.join(","))
    .is("deleted_at", null)
    .limit(1);

  if (error) {
    console.error("Error checking for an existing customer:", error);
    return { customer: null, error };
  }
  if (data?.[0]) return { customer: data[0], error: null };

  const { data: archived, error: archivedError } = await supabase
    .from("customers")
    .select("id, full_name, phone, email, is_repeat_customer")
    .or(filters.join(","))
    .not("deleted_at", "is", null)
    .limit(1);
  if (archivedError) {
    console.error("Error checking archived customers:", archivedError);
    return { customer: null, error: archivedError };
  }
  return {
    customer: archived?.[0] ? { ...archived[0], is_archived: true } : null,
    error: null,
  };
}

async function addVehicle(customerId, vehicle) {
  const { data, error } = await supabase.from("vehicles").insert([{
    customer_id: customerId,
    license_plate: vehicle.license_plate,
    body_type: vehicle.body_type,
    make: vehicle.make,
    model: vehicle.model || null,
    year: vehicle.year,
    chassis_number: vehicle.chassis_number || null,
    engine_number: vehicle.engine_number || null,
  }]).select("id").single();
  if (error) console.error("Error adding customer vehicle:", error);
  return { error, vehicle: data || null };
}

async function startEditingCustomer(customerId) {
  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, customer_code, full_name, phone, email, customer_type, is_company, company_name, vehicles(id, license_plate, body_type, make, model, year, chassis_number, engine_number)")
    .eq("id", customerId)
    .single();
  if (error || !customer) {
    showCustomerMessage(`Couldn't load customer details: ${error?.message || "Customer not found"}`, "error");
    return;
  }

  hideSavedActions();
  editingCustomerId = customer.id;
  editingVehicleId = customer.vehicles?.[0]?.id || null;
  document.getElementById("cust-name").value = customer.full_name || "";
  document.getElementById("cust-is-company").checked = Boolean(customer.is_company);
  document.getElementById("cust-company-name").value = customer.company_name || "";
  document.getElementById("cust-company-name-field").hidden = !customer.is_company;
  document.getElementById("cust-company-name").required = Boolean(customer.is_company);
  document.getElementById("cust-customer-code").value = customer.customer_code || "";
  document.getElementById("cust-customer-code").readOnly = !canManageCustomerCode;
  document.getElementById("cust-is-company").checked = Boolean(customer.is_company);
  document.getElementById("cust-company-name").value = customer.company_name || "";
  document.getElementById("cust-company-name-field").hidden = !customer.is_company;
  document.getElementById("cust-company-name").required = Boolean(customer.is_company);
  document.getElementById("cust-customer-code").value = customer.customer_code || "";
  document.getElementById("cust-type").value = customer.customer_type || "individual";
  document.getElementById("cust-phone").value = customer.phone || "";
  document.getElementById("customer-email").value = customer.email || "";

  const vehicle = customer.vehicles?.[0] || null;
  document.getElementById("cust-plate").value = vehicle?.license_plate || "";
  document.getElementById("cust-body-type").value = vehicleBodyTypeValue(vehicle?.body_type);
  document.getElementById("cust-make").value = vehicle?.make || "";
  document.getElementById("cust-model").value = vehicle?.model || "";
  document.getElementById("cust-year").value = vehicle?.year || "";
  document.getElementById("cust-chassis").value = vehicle?.chassis_number || "";
  document.getElementById("cust-engine").value = vehicle?.engine_number || "";

  document.getElementById("customer-form-heading").textContent = "Edit Customer";
  document.getElementById("customer-form-kicker").textContent = "Update record";
  document.getElementById("customer-submit-button").innerHTML = '<i data-lucide="save"></i> Save Changes';
  document.getElementById("customer-cancel-edit").hidden = false;
  showSavedActions(customer.id, customer.vehicles?.[0]?.id || null, customer.customer_code);
  showCustomerMessage("Editing customer details. Save to apply changes.");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  if (window.lucide) lucide.createIcons();
  document.getElementById("cust-name")?.focus({ preventScroll: true });
}

document.getElementById("customer-cancel-edit")?.addEventListener("click", resetCustomerFormMode);
document.getElementById("customer-edit-saved")?.addEventListener("click", () => {
  if (savedCustomerId) startEditingCustomer(savedCustomerId);
});
document.getElementById("customer-open-job")?.addEventListener("click", () => {
  if (!savedCustomerId) return;
  const params = new URLSearchParams({ new: "1", customer: savedCustomerId });
  if (savedVehicleId) params.set("vehicle", savedVehicleId);
  window.location.href = `repairs.html?${params.toString()}`;
});

const plateField = document.getElementById("cust-plate");
plateField?.addEventListener("change", async () => {
  if (editingCustomerId) return;
  const plate = plateField.value.trim().toUpperCase();
  if (!plate) return;
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, license_plate, body_type, make, model, year, chassis_number, engine_number, customers(id, customer_code, full_name, phone, email, customer_type)")
    .ilike("license_plate", plate)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Couldn't lookup customer plate:", error);
    return;
  }
  if (!data?.customers) return;
  document.getElementById("cust-name").value = data.customers.full_name || "";
  document.getElementById("cust-type").value = data.customers.customer_type || "individual";
  document.getElementById("cust-phone").value = data.customers.phone || "";
  document.getElementById("customer-email").value = data.customers.email || "";
  document.getElementById("cust-is-company").checked = Boolean(data.customers.is_company);
  document.getElementById("cust-company-name").value = data.customers.company_name || "";
  document.getElementById("cust-company-name-field").hidden = !data.customers.is_company;
  document.getElementById("cust-company-name").required = Boolean(data.customers.is_company);
  document.getElementById("cust-customer-code").value = data.customers.customer_code || "";
  document.getElementById("cust-body-type").value = vehicleBodyTypeValue(data.body_type);
  document.getElementById("cust-make").value = data.make || "";
  document.getElementById("cust-model").value = data.model || "";
  document.getElementById("cust-year").value = data.year || "";
  document.getElementById("cust-chassis").value = data.chassis_number || "";
  document.getElementById("cust-engine").value = data.engine_number || "";
  showCustomerMessage(`Existing customer found: ${data.customers.full_name} (${data.customers.customer_code || "No customer ID"}). Details filled automatically.`);
});

// ---- Handle new customer form submit ----
if (form) {
  form.addEventListener("input", event => {
    if (event.target?.matches("input, select, textarea")) window.APRUI?.clearFieldError(event.target);
    if (event.target?.matches("input, select, textarea")) hideSavedActions();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showCustomerMessage("");
    hideSavedActions();

    const full_name = document.getElementById("cust-name").value.trim();
    const isCompanyToggle = document.getElementById("cust-is-company");
    const companyNameField = document.getElementById("cust-company-name");
    const customer_type = document.getElementById("cust-type").value;
    const phone = document.getElementById("cust-phone").value.trim();
    const license_plate = document.getElementById("cust-plate").value.trim().toUpperCase();
    const email = document.getElementById("customer-email").value.trim();
    const requestedCustomerCode = document.getElementById("cust-customer-code")?.value.trim() || "";
    const is_company = document.getElementById("cust-is-company")?.checked || false;
    const company_name = document.getElementById("cust-company-name")?.value.trim() || "";
    if (is_company && !company_name) { showCustomerMessage("Company name is required.", "error"); document.getElementById("cust-company-name")?.focus(); return; }
    const vehicle = {
      license_plate,
      body_type: document.getElementById("cust-body-type").value,
      make: document.getElementById("cust-make").value.trim(),
      model: document.getElementById("cust-model").value.trim(),
      year: parseInt(document.getElementById("cust-year").value, 10) || null,
      chassis_number: document.getElementById("cust-chassis").value.trim(),
      engine_number: document.getElementById("cust-engine").value.trim(),
    };

    if (!full_name || !phone) {
      const missing = !full_name ? document.getElementById("cust-name") : document.getElementById("cust-phone");
      window.APRUI?.flagField(missing, !full_name ? "Customer name is required." : "Phone number is required.");
      missing?.focus();
      return;
    }

    if (!window.CentricPhoneFields?.isValid(phone)) {
      const phoneField = document.getElementById("cust-phone");
      window.APRUI?.flagField(phoneField, "Enter a valid phone number with its country code.");
      phoneField?.focus();
      return;
    }
    if (email && !/^[^\s@]+@gmail\.com$/.test(email)) {
      const emailField = document.getElementById("customer-email");
      window.APRUI?.flagField(emailField, "Email must end with @gmail.com.");
      emailField?.focus();
      return;
    }
    const hasVehicleDetails = Boolean(vehicle.license_plate || vehicle.make || vehicle.model || vehicle.year || vehicle.chassis_number || vehicle.engine_number);
    if (hasVehicleDetails && !license_plate) {
      const plateField = document.getElementById("cust-plate");
      window.APRUI?.flagField(plateField, "Enter the plate number when registering vehicle details.");
      plateField?.focus();
      return;
    }
    if (license_plate && (!vehicle.make || !vehicle.model || !vehicle.year || !vehicle.chassis_number || !vehicle.engine_number)) {
      alert("Enter the vehicle make, model, year, chassis number, and engine number.");
      return;
    }

    if (customerSubmissionInProgress) return;
    customerSubmissionInProgress = true;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
    if (editingCustomerId) {
      const { error: customerError } = await supabase
        .from("customers")
        .update({ full_name, customer_type, phone, email: email || null, is_company, company_name: is_company ? company_name : null })
        .eq("id", editingCustomerId);
      if (customerError) {
        alert(`Couldn't update customer details: ${customerError.message}`);
        return;
      }

      let vehicleSaveError = null;
      let vehicleId = editingVehicleId;
      if (license_plate) {
        const vehicleValues = {
          customer_id: editingCustomerId,
          license_plate,
          body_type: vehicle.body_type,
          make: vehicle.make,
          model: vehicle.model || null,
          year: vehicle.year,
          chassis_number: vehicle.chassis_number || null,
          engine_number: vehicle.engine_number || null,
        };
        if (vehicleId) {
          const { error } = await supabase.from("vehicles").update(vehicleValues).eq("id", vehicleId);
          vehicleSaveError = error;
        } else {
          const result = await addVehicle(editingCustomerId, vehicle);
          vehicleSaveError = result.error;
          vehicleId = result.vehicle?.id || null;
        }
      } else if (vehicleId) {
        const { error } = await supabase.from("vehicles")
          .delete()
          .eq("id", vehicleId);
        vehicleSaveError = error;
        vehicleId = null;
      }

      if (vehicleSaveError) {
        showCustomerMessage(`Customer details were updated, but the vehicle could not be saved: ${vehicleSaveError.message}`, "error");
        return;
      }

      const savedId = editingCustomerId;
      resetCustomerFormMode();
      await loadCustomers();
      showCustomerMessage(`${full_name}'s customer details were updated.`);
      const { data: savedCustomer } = await supabase.from("customers").select("customer_code").eq("id", savedId).maybeSingle();
      showSavedActions(savedId, vehicleId, savedCustomer?.customer_code || requestedCustomerCode);
      if (window.APRUI?.success) window.APRUI.success("Customer updated", `${full_name} was updated successfully.`);
      return;
    }

    const { customer: existing, error: lookupError } = await findExistingCustomer(phone, email);
    if (lookupError) {
      alert("Couldn't check for an existing customer: " + lookupError.message);
      return;
    }

    if (existing) {
      if (existing.is_archived) {
        if (!await window.aprConfirm(`${existing.full_name} is archived. Restore this customer record and continue?`, { title: "Restore customer", confirmLabel: "Restore customer" })) return;
        const { error: restoreError } = await supabase.from("customers")
          .update({ deleted_at: null })
          .eq("id", existing.id);
        if (restoreError) {
          alert(`Couldn't restore ${existing.full_name}: ${restoreError.message}`);
          return;
        }
      }
      // This phone or email already belongs to someone in the system.
      // Treat it as that customer returning — add the vehicle to their
      // existing record and flag them as a repeat customer, rather than
      // creating a second customer row with the same credentials.
      let savedVehicleIdForExisting = null;
      if (license_plate) {
        const vehicleResult = await addVehicle(existing.id, vehicle);
        const vehicleError = vehicleResult.error;
        if (vehicleError) {
          alert(`${existing.full_name} is already a customer, but the vehicle plate could not be saved: ${vehicleError.message}`);
          return;
        }
        savedVehicleIdForExisting = vehicleResult.vehicle?.id || null;
      }
      if (!existing.is_repeat_customer) {
        const { error: flagError } = await supabase
          .from("customers")
          .update({ is_repeat_customer: true })
          .eq("id", existing.id);
        if (flagError) console.error("Error marking repeat customer:", flagError);
      }
      form.reset();
      await loadCustomers();
      showCustomerMessage(existing.is_archived
        ? `${existing.full_name} was restored${license_plate ? ` and vehicle ${license_plate} was added` : ""}.`
        : license_plate
          ? `${existing.full_name} is already registered. Vehicle ${license_plate} has been added to their customer record.`
          : `${existing.full_name} is already registered. No duplicate customer was created.`);
      showSavedActions(existing.id, savedVehicleIdForExisting, existing.customer_code);
      return;
    }

    // No existing match — this really is a new customer.
    const { data: customer, error } = await supabase.from("customers").insert([
      { full_name, customer_type, phone, email: email || null, is_company, company_name: is_company ? company_name : null }
    ]).select("id, customer_code").single();

    if (error) {
      console.error("Error adding customer:", error);
      alert("Failed to add customer: " + error.message);
      return;
    }

    let vehicleSaveError = null;
    let savedVehicle = null;
    if (license_plate) {
      const vehicleResult = await addVehicle(customer.id, vehicle);
      vehicleSaveError = vehicleResult.error;
      savedVehicle = vehicleResult.vehicle;
    }

    form.reset();
    await loadCustomers();
    showCustomerMessage(vehicleSaveError
      ? `Customer ${full_name} has been added, but vehicle ${license_plate} could not be saved: ${vehicleSaveError.message}`
      : `Customer ${full_name} has been added${license_plate ? ` with vehicle ${license_plate}` : ""}.`,
    vehicleSaveError ? "error" : "success");
    if (!vehicleSaveError) {
      window.APRUI?.success("Customer saved", `${full_name} was added successfully.`);
      showSavedActions(customer.id, savedVehicle?.id || null, customer.customer_code);
    }
    } catch (error) {
      console.error("Customer save failed:", error);
      showCustomerMessage(`Couldn't finish saving the customer: ${error.message || String(error)}`, "error");
    } finally {
      customerSubmissionInProgress = false;
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// ---- Simple HTML escaping to keep the table safe ----
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function vehiclePlates(vehicles = []) {
  const plates = vehicles.map(vehicle => vehicle.license_plate).filter(Boolean);
  return plates.length ? plates.map(escapeHtml).join(", ") : "—";
}

// ---- Highlight a row reached via the dashboard's global search ----
function highlightFromUrl() {
  const id = new URLSearchParams(window.location.search).get("highlight");
  if (!id) return;
  const row = document.querySelector(`#customers-table tr[data-customer-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("highlight-flash");
}

// ---- Init ----
document.addEventListener("DOMContentLoaded", async () => {
  await loadCustomers();
  highlightFromUrl();
});


document.getElementById("cust-is-company")?.addEventListener("change", event => {
  const enabled = event.currentTarget.checked;
  const wrap = document.getElementById("cust-company-name-field");
  const input = document.getElementById("cust-company-name");
  if (wrap) wrap.hidden = !enabled;
  if (input) { input.required = enabled; if (!enabled) input.value = ""; }
});

document.getElementById("customer-directory-search")?.addEventListener("input", () => loadCustomers());

async function loadCustomerCodePermissions() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return;
  const { data: profile } = await supabase.from("profiles").select("role,access_level").eq("id", auth.user.id).maybeSingle();
  const role = String(profile?.role || "").toLowerCase();
  canManageCustomerCode = Number(profile?.access_level || 0) >= 2 || ["super_admin", "superadmin", "accounting"].includes(role);
  const field = document.getElementById("cust-customer-code");
  if (field) field.readOnly = !canManageCustomerCode;
}
loadCustomerCodePermissions().catch(error => console.warn("Could not load Customer ID permissions:", error));


document.getElementById("customer-cid-copy")?.addEventListener("click", async () => {
  if (!savedCustomerCode) return;
  try { await navigator.clipboard.writeText(savedCustomerCode); showCustomerMessage(savedCustomerCode + " copied."); }
  catch { showCustomerMessage("Copy was blocked. Select the Customer ID and copy it manually.", "error"); }
});
document.getElementById("customer-cid-whatsapp")?.addEventListener("click", () => {
  if (!savedCustomerCode) return;
  const customerName = document.getElementById("cust-company-name")?.value.trim() || document.getElementById("cust-name")?.value.trim() || "Customer";
  const message = "Hello " + customerName + ", your Centric Auto Mobile Customer ID is " + savedCustomerCode + ". Please keep it for future visits.";
  window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank", "noopener");
});
