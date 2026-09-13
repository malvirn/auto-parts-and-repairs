// ========= Customers module =========
import supabase from "./supabaseClient.js";

const tableBody = document.getElementById("customers-table");
const form = document.getElementById("customer-form");

// ---- Load and render all customers ----
async function loadCustomers() {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, is_repeat_customer, vehicles(license_plate)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading customers:", error);
    tableBody.innerHTML = `<tr><td colspan="4" style="color:var(--danger)">Failed to load customers: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted)">No customers yet — add one above</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map(c => `
    <tr>
      <td>${escapeHtml(c.full_name)}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>${vehiclePlates(c.vehicles)}</td>
      <td>${c.is_repeat_customer ? "Yes" : "No"}</td>
    </tr>
  `).join("");
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

async function addVehicle(customerId, license_plate) {
  const { error } = await supabase.from("vehicles").insert([{
    customer_id: customerId,
    body_type: "Other",
    make: "",
    license_plate,
  }]);
  if (error) console.error("Error adding vehicle plate:", error);
  return error;
}

// ---- Handle new customer form submit ----
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const full_name = document.getElementById("cust-name").value.trim();
    const phone = document.getElementById("cust-phone").value.trim();
    const license_plate = document.getElementById("cust-plate").value.trim().toUpperCase();
    const email = document.getElementById("customer-email").value.trim();

    if (!full_name || !phone) {
      alert("Name and phone number are required.");
      return;
    }

    if (!/^\+263\s\d{2}\s\d{3}\s\d{4}$/.test(phone)) {
      alert("Phone must use this format: +263 00 000 0000");
      return;
    }
    if (email && !/^[^\s@]+@gmail\.com$/.test(email)) {
      alert("Email must end with @gmail.com");
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
        const vehicleError = await addVehicle(existing.id, license_plate);
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
      alert(`${existing.full_name} is already in the system with this phone/email${license_plate ? " — the vehicle has been added to their profile." : "."}`);
      return;
    }

    // No existing match — this really is a new customer.
    const { data: customer, error } = await supabase.from("customers").insert([
      { full_name, phone, email: email || null }
    ]).select("id").single();

    if (error) {
      console.error("Error adding customer:", error);
      alert("Failed to add customer: " + error.message);
      return;
    }

    if (license_plate) {
      const vehicleError = await addVehicle(customer.id, license_plate);
      if (vehicleError) {
        alert("Customer was added, but the vehicle plate could not be saved: " + vehicleError.message);
      }
    }

    form.reset();
    loadCustomers();
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

// ---- Init ----
document.addEventListener("DOMContentLoaded", loadCustomers);