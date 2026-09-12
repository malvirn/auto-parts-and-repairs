export const STATUS_META = {
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
  const total = Number(job?.total_cost ?? 0).toFixed(2);

  if (job?.status === "Ready for Pickup") {
    return `Hi ${customer}, your ${vehicle} (Job #${jobNo}) is ready for pickup! Total cost: $${total}. Thank you for choosing us.`;
  }
  if (job?.status === "Completed") {
    return `Hi ${customer}, your ${vehicle} (Job #${jobNo}) has been completed. Total cost: $${total}. Thanks again!`;
  }
  if (job?.status === "Collected") {
    return `Hi ${customer}, your ${vehicle} (Job #${jobNo}) has been collected. Thank you for choosing us.`;
  }
  return null;
}
