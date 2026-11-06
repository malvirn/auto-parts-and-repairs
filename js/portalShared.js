export const STATUS_META = {
  Draft: { cls: "badge--received", icon: "file-edit" },
  Processing: { cls: "badge--in-repair", icon: "wrench" },
  Processed: { cls: "badge--ready", icon: "check-circle" },
  Received: { cls: "badge--received", icon: "inbox" },
  Diagnosing: { cls: "badge--diagnosing", icon: "search" },
  "Awaiting Parts": { cls: "badge--awaiting", icon: "package-search" },
  "In Repair": { cls: "badge--in-repair", icon: "wrench" },
  "Ready for Pickup": { cls: "badge--ready", icon: "check-circle" },
  Completed: { cls: "badge--completed", icon: "circle-check" },
  Collected: { cls: "badge--collected", icon: "car" },
  Unclaimed: { cls: "badge--unclaimed", icon: "alert-triangle" },
};

export function messageForStatus(job) {
  const vehicle = [job?.vehicles?.year, job?.vehicles?.make, job?.vehicles?.model]
    .filter(Boolean)
    .join(" ");
  const jobNo = String(job?.job_number ?? "").padStart(4, "0");
  const customer = job?.customers?.full_name ?? job?.customer_name ?? "";
  const registration = job?.vehicles?.license_plate ? ` (${job.vehicles.license_plate})` : "";
  const vehicleDetails = vehicle || "your vehicle";
  const reference = jobNo ? `JC-${jobNo}` : "your job card";
  const status = job?.status ? String(job.status) : "under review";
  const labour = Number(job?.labour_cost) || 0;
  const parts = Number(job?.parts_cost) || 0;
  const incidentals = Number(job?.incidentals_cost) || 0;
  const total = Number(job?.total_cost) || labour + parts + incidentals;
  const money = value => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const nextMileage = job?.next_service_mileage != null ? `${Number(job.next_service_mileage).toLocaleString("en-US")} km` : null;

  return [
    `Dear ${customer || "Customer"},`,
    "",
    `This is a formal update from Centric Auto Mobile regarding ${vehicleDetails}${registration}.`,
    `Job card reference: ${reference}`,
    `Current status: ${status}`,
    job?.fault_reported ? `Customer concern: ${job.fault_reported}` : null,
    job?.diagnosis ? `Diagnosis: ${job.diagnosis}` : null,
    job?.work_done ? `Work completed: ${job.work_done}` : null,
    job?.work_missing ? `Work still required: ${job.work_missing}` : null,
    "",
    `Labour total: ${money(labour)}`,
    `Materials total: ${money(parts)}`,
    `Additional costs total: ${money(incidentals)}`,
    `Job total: ${money(total)}`,
    nextMileage ? `Next checkup mileage: ${nextMileage}` : null,
    "",
    "Please contact our workshop if you require any further assistance.",
    "",
    "Kind regards,",
    "Centric Auto Mobile"
  ].join("\n");
}
