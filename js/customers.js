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

    const { data: customer, error } = await supabase.from("customers").insert([
      { full_name, phone, email: email || null }
    ]).select("id").single();

    if (error) {
      console.error("Error adding customer:", error);
      alert("Failed to add customer: " + error.message);
      return;
    }

    if (license_plate) {
      const { error: vehicleError } = await supabase.from("vehicles").insert([{
        customer_id: customer.id,
        body_type: "Other",
        make: "",
        license_plate,
      }]);
      if (vehicleError) {
        console.error("Error adding vehicle plate:", vehicleError);
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
