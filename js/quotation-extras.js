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

/* ---------- long tables show 5 rows, then a More button ---------- */
function limitRows(tbodySel, step = 5) {
  const tb = $(tbodySel); const table = tb?.closest("table"); if (!tb || !table) return;
  let shown = step;
  const wrap = document.createElement("div");
  wrap.className = "more-row"; wrap.hidden = true;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn"; wrap.append(btn);
  table.after(wrap);
  const rows = () => [...tb.querySelectorAll(":scope > tr")].filter(r => !r.querySelector("td.empty-state"));
  const apply = () => {
    const r = rows();
    r.forEach((row, i) => { row.hidden = i >= shown; });
    if (r.length <= step) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const rem = r.length - shown;
    if (rem > 0) { btn.textContent = `More (${rem})`; btn.dataset.m = "more"; }
    else { btn.textContent = "Show less"; btn.dataset.m = "less"; }
  };
  btn.addEventListener("click", () => { shown = btn.dataset.m === "more" ? shown + step : step; apply(); });
  new MutationObserver(apply).observe(tb, { childList: true });
  apply();
}
limitRows("#quotations-table");
limitRows("#orders-table");