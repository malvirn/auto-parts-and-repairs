// ========= Customers module =========
import supabase from "./supabaseClient.js";
import { hydrate } from "./data-cache.js";
import { installBulkDelete } from "./bulk-delete.js";

const tableBody = document.getElementById("customers-table");
const form = document.getElementById("customer-form");
const formMessage = document.getElementById("customer-form-message");

installBulkDelete({
  tbody: tableBody,
  table: "customers",
  label: "customer",
  getId: row => row.dataset.customerId,
});

function showCustomerMessage(text, tone = "success") {
  if (!formMessage) return;
  formMessage.textContent = text;
  formMessage.dataset.tone = tone;
}

// ---- Load and render all customers ----
async function fetchCustomersList() {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, customer_type, is_repeat_customer, vehicles(license_plate)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

function renderCustomersList(data) {
  if (data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="customer-empty">No customers yet — add one above.</td></tr>`;
    return;
  }
  tableBody.innerHTML = data.map(c => `
    <tr data-customer-id="${c.id}">
      <td data-label="Customer">${escapeHtml(c.full_name)}</td>
      <td data-label="Type"><span class="customer-type" data-type="${c.customer_type === "company" ? "company" : "individual"}">${c.customer_type === "company" ? "Company" : "Individual"}</span></td>
      <td data-label="Phone">${escapeHtml(c.phone || "—")}</td>
      <td data-label="Vehicles">${vehiclePlates(c.vehicles)}</td>
      <td data-label="Customer status"><span class="customer-repeat${c.is_repeat_customer ? "" : " is-new"}">${c.is_repeat_customer ? "Repeat customer" : "New customer"}</span></td>
    </tr>
  `).join("");
}

// Renders instantly from cache (set at sign-in or on an earlier visit this
// session) and refreshes in the background, so arriving on this page never
// shows a blank table while the network replies.
async function loadCustomers() {
  try {
    await hydrate("customers:list", fetchCustomersList, renderCustomersList);
  } catch (error) {
    console.error("Error loading customers:", error);
    tableBody.innerHTML = `<tr><td colspan="5" class="customer-empty" role="alert">Failed to load customers: ${escapeHtml(error.message)}</td></tr>`;
  }
}

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
    .select("id, full_name, phone, email, is_repeat_customer")
    .or(filters.join(","))
    .limit(1);

  if (error) {
    console.error("Error checking for an existing customer:", error);
    return { customer: null, error };
  }
  return { customer: data && data[0] ? data[0] : null, error: null };
}

async function addVehicle(customerId, vehicle) {
  const { error } = await supabase.from("vehicles").insert([{
    customer_id: customerId,
    license_plate: vehicle.license_plate,
    body_type: vehicle.body_type,
    make: vehicle.make,
    model: vehicle.model || null,
    year: vehicle.year,
    chassis_number: vehicle.chassis_number || null,
    engine_number: vehicle.engine_number || null,
  }]);
  if (error) console.error("Error adding customer vehicle:", error);
  return error;
}

// ---- Handle new customer form submit ----
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showCustomerMessage("");

    const full_name = document.getElementById("cust-name").value.trim();
    const customer_type = document.getElementById("cust-type").value;
    const phone = document.getElementById("cust-phone").value.trim();
    const license_plate = document.getElementById("cust-plate").value.trim().toUpperCase();
    const email = document.getElementById("customer-email").value.trim();
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
      alert("Name and phone number are required.");
      return;
    }

    if (!window.CentricPhoneFields?.isValid(phone)) {
      alert("Enter a valid phone number with its country code.");
      return;
    }
    if (email && !/^[^\s@]+@gmail\.com$/.test(email)) {
      alert("Email must end with @gmail.com");
      return;
    }
    const hasVehicleDetails = Boolean(vehicle.license_plate || vehicle.make || vehicle.model || vehicle.year || vehicle.chassis_number || vehicle.engine_number);
    if (hasVehicleDetails && !license_plate) {
      alert("Enter the vehicle plate number when registering vehicle details.");
      return;
    }
    if (license_plate && (!vehicle.make || !vehicle.model || !vehicle.year || !vehicle.chassis_number || !vehicle.engine_number)) {
      alert("Enter the vehicle make, model, year, chassis number, and engine number.");
      return;
    }

    const { customer: existing, error: lookupError } = await findExistingCustomer(phone, email);
    if (lookupError) {
      alert("Couldn't check for an existing customer: " + lookupError.message);
      return;
    }

    if (existing) {
      // This phone or email already belongs to someone in the system.
      // Treat it as that customer returning — add the vehicle to their
      // existing record and flag them as a repeat customer, rather than
      // creating a second customer row with the same credentials.
      if (license_plate) {
        const vehicleError = await addVehicle(existing.id, vehicle);
        if (vehicleError) {
          alert(`${existing.full_name} is already a customer, but the vehicle plate could not be saved: ${vehicleError.message}`);
          return;
        }
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
      showCustomerMessage(license_plate
        ? `${existing.full_name} is already registered. Vehicle ${license_plate} has been added to their customer record.`
        : `${existing.full_name} is already registered. No duplicate customer was created.`);
      return;
    }

    // No existing match — this really is a new customer.
    const { data: customer, error } = await supabase.from("customers").insert([
      { full_name, customer_type, phone, email: email || null }
    ]).select("id").single();

    if (error) {
      console.error("Error adding customer:", error);
      alert("Failed to add customer: " + error.message);
      return;
    }

    let vehicleSaveError = null;
    if (license_plate) {
      vehicleSaveError = await addVehicle(customer.id, vehicle);
    }

    form.reset();
    await loadCustomers();
    showCustomerMessage(vehicleSaveError
      ? `Customer ${full_name} has been added, but vehicle ${license_plate} could not be saved: ${vehicleSaveError.message}`
      : `Customer ${full_name} has been added${license_plate ? ` with vehicle ${license_plate}` : ""}.`,
    vehicleSaveError ? "error" : "success");
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
