import supabase from "./supabaseClient.js";
import { STATUS_META, messageForStatus } from "./portalShared.js";

const form = document.getElementById("portal-form");
const phoneInput = document.getElementById("portal-phone");
const plateInput = document.getElementById("portal-plate");
const message = document.getElementById("portal-message");
const result = document.getElementById("portal-result");
const status = document.getElementById("portal-status");
const timeline = document.getElementById("portal-timeline");
const timelineList = document.getElementById("portal-timeline-list");

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function setMessage(text = "") {
  message.textContent = text;
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}

function renderJob(job) {
  const meta = STATUS_META[job.status] || { cls: "", icon: "circle" };
  const vehicle = [job.vehicle?.year, job.vehicle?.make, job.vehicle?.model]
    .filter(Boolean)
    .join(" ") || "Vehicle details unavailable";
  const details = [job.vehicle?.license_plate ? `Plate: ${job.vehicle.license_plate}` : "", job.vehicle?.body_type]
    .filter(Boolean)
    .join(" • ");

  document.getElementById("portal-job-number").textContent = `#${String(job.job_number).padStart(4, "0")}`;
  document.getElementById("portal-customer-greeting").textContent = job.customer_name
    ? `Hello, ${job.customer_name}`
    : "Your repair update";
  status.className = `portal-status ${meta.cls}`;
  status.innerHTML = `<i data-lucide="${meta.icon}"></i> ${escapeHtml(job.status)}`;
  document.getElementById("portal-vehicle-name").textContent = vehicle;
  document.getElementById("portal-vehicle-details").textContent = details;
  document.getElementById("portal-total-cost").textContent = formatMoney(job.total_cost);
  const statusMessage = messageForStatus({
    ...job,
    customers: { full_name: job.customer_name },
    vehicles: job.vehicle,
  });
  document.getElementById("portal-status-message").textContent = statusMessage
    || `Your ${vehicle} (Job #${String(job.job_number).padStart(4, "0")}) is currently ${job.status}.`;

  const history = Array.isArray(job.timeline) ? job.timeline : [];
  timeline.hidden = history.length === 0;
  timelineList.innerHTML = history.map(item => `
    <li>
      <div><strong>${escapeHtml(item.status)}</strong><time>${escapeHtml(formatDate(item.created_at))}</time></div>
    </li>
  `).join("");

  result.hidden = false;
  if (window.lucide) lucide.createIcons();
}

async function lookup(phone, plate, jobNumber = null, token = null) {
  setMessage("Looking up your repair…");
  result.hidden = true;
  const { data, error } = await supabase.rpc("lookup_repair_portal", {
    p_phone: phone,
    p_license_plate: plate,
    p_job_number: jobNumber,
    p_token: token,
  });

  if (error || !data) {
    console.error("Portal lookup failed:", error);
    setMessage("We could not find a repair with those details. Check the phone number and plate, then try again.");
    return;
  }

  setMessage("");
  renderJob(data);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  await lookup(phoneInput.value.trim(), plateInput.value.trim());
  button.disabled = false;
});

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const jobNumber = params.get("job");
  if (token && jobNumber) lookup("", "", Number(jobNumber), token);
});
