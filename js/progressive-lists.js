(() => {
  "use strict";

  const PAGE_SIZE = 10;
  const LIST_SELECTORS = [
    "#list", "#checklist-list", "#customer-credit-records", "#customer-credit-list",
    "#off-days-list", "#quotation-list", "#recent-jobs", "#ov-quotes", "#credit-voucher-list",
    "#v-list", "#unpriced-job-parts-list", "#supplier-list", "#employee-list",
    ".quotation-list", ".customer-credit-records", ".record-list",
    ".records-list", ".data-list", ".activity-list"
  ].join(",");
  const TABLE_EXCLUDES = [
    ".items", "#doc", "#jb-lines", "#quotation-paper-table", "#receipt-items", "#quotations-table", "#orders-table",
    ".receipt-document", ".invoice-document", ".job-card-print", ".payslip",
    ".modal table", ".modal-content table", "[data-no-progressive]"
  ].join(",");
  const TABLE_SELECTORS = [
    "#customers-table", "#suppliers-table", "#employees-table",
    "#customer-directory-table",
    "#customer-accounts-table", "#trial-balance-table", "#accounts-table",
    "#entries-table", "#payroll-employees", "#credit-job-table",
    "#recent-jobs", "#jb-lines-table"
  ].join(",");

  function recordsFor(container) {
    if (container.matches("tbody")) return [...container.children].filter(el => el.matches("tr"));
    return [...container.children].filter(el =>
      el.nodeType === 1 &&
      !el.matches(".progressive-more-wrap, .centric-pagination-wrap, .ov-empty, .empty-state, .apr-state, .customer-credit-empty, .message, script, style, template") &&
      !el.hasAttribute("data-progressive-control")
    );
  }

  function anchorFor(container) {
    return container.matches("tbody") ? container.closest("table") : container;
  }

  function paginationMarkup(page, pages, total) {
    const items = [];
    const add = value => items.push(value);
    const set = new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages));
    const sorted = [...set].sort((a,b)=>a-b);
    let previous = 0;
    for (const number of sorted) {
      if (previous && number - previous > 1) add("ellipsis");
      add(number);
      previous = number;
    }
    return `<nav class="centric-pagination" aria-label="List pages">
      <span class="centric-pagination__summary">${total.toLocaleString()} records</span>
      <div class="centric-pagination__controls">
        <button type="button" class="centric-page-arrow" data-page="${page-1}" aria-label="Previous page" ${page===1?"disabled":""}>‹</button>
        ${items.map(item=>item==="ellipsis"?'<span class="centric-page-ellipsis" aria-hidden="true">…</span>':`<button type="button" class="centric-page-number ${item===page?"is-current":""}" data-page="${item}" ${item===page?'aria-current="page"':""}>${item}</button>`).join("")}
        <button type="button" class="centric-page-arrow" data-page="${page+1}" aria-label="Next page" ${page===pages?"disabled":""}>›</button>
      </div>
    </nav>`;
  }

  function update(container) {
    if (!container.isConnected) return;
    const records = recordsFor(container);
    if (container.closest("[data-no-progressive]")) {
      records.forEach(record => { record.hidden = false; });
      container.parentElement?.querySelector(':scope > .centric-pagination-wrap[data-for="' + CSS.escape(container.id || "record-list") + '"]')?.remove();
      return;
    }
    const key = container.id || container.dataset.progressiveKey || "record-list";
    const previousTotal = Number(container.dataset.progressiveTotal || -1);
    let page = Number(container.dataset.progressivePage || 1);
    if (previousTotal !== records.length) page = 1;
    const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    page = Math.max(1, Math.min(pages, page));
    container.dataset.progressiveTotal = String(records.length);
    container.dataset.progressivePage = String(page);
    records.forEach((record, index) => {
      record.hidden = index < (page - 1) * PAGE_SIZE || index >= page * PAGE_SIZE;
    });
    let wrap = container.parentElement?.querySelector(':scope > .centric-pagination-wrap[data-for="' + CSS.escape(key) + '"]');
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "centric-pagination-wrap";
      wrap.dataset.for = key;
      container.insertAdjacentElement("afterend", wrap);
    }
    wrap.hidden = records.length <= PAGE_SIZE;
    wrap.innerHTML = records.length > PAGE_SIZE ? paginationMarkup(page, pages, records.length) : "";
    wrap.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => {
        const next = Number(button.dataset.page);
        if (!Number.isInteger(next) || next < 1 || next > pages || next === page) return;
        container.dataset.progressivePage = String(next);
        update(container);
      });
    });
  }

  function process(root = document) {
    root.querySelectorAll?.(LIST_SELECTORS).forEach(update);
    root.querySelectorAll?.("table").forEach(table => {
      if (table.matches(TABLE_EXCLUDES) || table.closest(TABLE_EXCLUDES)) return;
      if (!table.matches(TABLE_SELECTORS) && !table.id && !table.classList.contains("data-table")) return;
      const body = table.tBodies?.[0];
      if (body) update(body);
    });
    if (root.matches?.(LIST_SELECTORS)) update(root);
    if (root.matches?.("tbody")) update(root);
  }

  const style = document.createElement("style");
  style.textContent = `
    .centric-pagination-wrap{display:flex;justify-content:center;width:100%;padding:14px 0 18px}
    .centric-pagination-wrap[hidden]{display:none!important}
    .centric-pagination{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;width:100%;max-width:100%;color:var(--muted,#9aa6a0);font:inherit}
    .centric-pagination__summary{font-size:12px;font-weight:600;white-space:nowrap}
    .centric-pagination__controls{display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:wrap}
    .centric-page-number,.centric-page-arrow{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:34px;padding:0 9px;border:1px solid var(--line,#34423b);border-radius:8px;background:var(--surface-2,#17211d);color:var(--text,#f3f7f4);font:600 13px/1 inherit;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
    .centric-page-number:hover:not(:disabled),.centric-page-arrow:hover:not(:disabled){border-color:var(--green-bright,#36b979);background:rgba(54,185,121,.13)}
    .centric-page-number.is-current{border-color:var(--green-bright,#36b979);background:var(--green-bright,#248a58);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.18)}
    .centric-page-number:focus-visible,.centric-page-arrow:focus-visible{outline:2px solid var(--orange,#f58220);outline-offset:2px}
    .centric-page-number:disabled,.centric-page-arrow:disabled{opacity:.35;cursor:not-allowed}
    .centric-page-ellipsis{padding:0 3px;color:var(--muted,#9aa6a0)}
    @media(max-width:560px){.centric-pagination{justify-content:center;gap:8px}.centric-pagination__summary{width:100%;text-align:center}.centric-pagination__controls{gap:3px}.centric-page-number,.centric-page-arrow{min-width:32px;height:34px;padding:0 7px}}
  `;
  document.head.append(style);
  process();

  let queued = false;
  const observer = new MutationObserver(records => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target) {
          if (target.matches?.(LIST_SELECTORS) || target.matches?.("tbody")) {
            target.dataset.progressiveTotal = "-1";
            target.dataset.progressivePage = "1";
          }
          process(target);
        }
        record.addedNodes.forEach(node => { if (node.nodeType === 1) process(node); });
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.CentricProgressiveLists = { refresh: process };
})();