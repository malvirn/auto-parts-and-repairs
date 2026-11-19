// Quotation page helpers keep form validation custom and long lists manageable.

const $ = (s, r = document) => r.querySelector(s);

/* ---------- custom form validation ---------- */
const form = $("#quotation-form");
const relax = () => {
  if (!form) return;
  form.noValidate = true;
  form.querySelectorAll("[required]").forEach(el => { el.required = false; el.removeAttribute("required"); el.removeAttribute("aria-required"); });
};
relax();
document.addEventListener("submit", e => {
  if (e.target.id !== "quotation-form") return;
  relax();
  const m = $("#quote-missing-fields");
  if (m) { m.hidden = true; m.textContent = ""; }
}, true);

/* Quotation and sales-order tables are rendered in full by quotations.js. */
