(() => {
  "use strict";

  const INITIAL = 3;
  const STEP = 3;
  const LIST_SELECTORS = [
    "#list", "#jb-list", "#customer-credit-records", "#customer-credit-list",
    "#off-days-list", "#quotation-list", "#recent-jobs", "#ov-quotes",
    "#v-list", "#unpriced-job-parts-list", "#supplier-list", "#employee-list",
    ".quotation-list", ".customer-credit-records", ".record-list",
    ".records-list", ".data-list", ".activity-list"
  ].join(",");
  const TABLE_EXCLUDES = [
    ".items", "#doc", "#jb-lines", "#quotation-paper-table", "#receipt-items",
    ".receipt-document", ".invoice-document", ".job-card-print", ".payslip",
    ".modal table", ".modal-content table", "[data-no-progressive]"
  ].join(",");
  const TABLE_SELECTORS = [
    "#customers-table", "#suppliers-table", "#employees-table",
    "#quotations-table", "#orders-table", "#customer-directory-table",
    "#customer-accounts-table", "#trial-balance-table", "#accounts-table",
    "#entries-table", "#payroll-employees", "#credit-job-table",
    "#recent-jobs", "#jb-lines-table"
  ].join(",");

  function recordsFor(container) {
    if (container.matches("tbody")) return [...container.children].filter(el => el.matches("tr"));
    return [...container.children].filter(el =>
      el.nodeType === 1 &&
      !el.matches(".progressive-more-wrap, script, style, template") &&
      !el.hasAttribute("data-progressive-control")
    );
  }

  function anchorFor(container) {
    return container.matches("tbody") ? container.closest("table") : container;
  }

  function getButton(container) {
    const anchor = anchorFor(container);
    const key = container.id || anchor.id || container.dataset.progressiveKey || "record-list";
    let wrap = anchor.parentElement?.querySelector(':scope > .progressive-more-wrap[data-for="' + CSS.escape(key) + '"]');
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "progressive-more-wrap";
      wrap.dataset.for = key;
      wrap.setAttribute("data-progressive-control", "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "progressive-more-btn";
      wrap.append(button);
      anchor.insertAdjacentElement("afterend", wrap);
    }
    return wrap.querySelector("button");
  }

  function update(container, keepCount = false) {
    if (!container.isConnected) return;
    const records = recordsFor(container);
    if (records.length <= INITIAL) {
      records.forEach(record => { record.hidden = false; });
      container.dataset.progressiveTotal = String(records.length);
      container.dataset.progressiveVisible = String(records.length);
      const anchor = anchorFor(container);
      const wrap = anchor.nextElementSibling;
      if (wrap?.classList.contains("progressive-more-wrap")) wrap.remove();
      return;
    }

    const previousTotal = Number(container.dataset.progressiveTotal || 0);
    let visible = Number(container.dataset.progressiveVisible || INITIAL);
    if (!keepCount && previousTotal !== records.length) visible = INITIAL;
    visible = Math.max(INITIAL, Math.min(records.length, visible));
    container.dataset.progressiveTotal = String(records.length);
    container.dataset.progressiveVisible = String(visible);
    records.forEach((record, index) => { record.hidden = index >= visible; });

    const button = getButton(container);
    const wrap = button.closest(".progressive-more-wrap");
    wrap.hidden = false;
    if (visible >= records.length) {
      button.textContent = "Show less";
      button.onclick = () => {
        container.dataset.progressiveVisible = String(INITIAL);
        update(container, true);
      };
    } else {
      button.textContent = "More";
      button.onclick = () => {
        container.dataset.progressiveVisible = String(Math.min(records.length, Number(container.dataset.progressiveVisible || INITIAL) + STEP));
        update(container, true);
      };
    }
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
    .progressive-more-wrap{display:flex;justify-content:center;align-items:center;padding:12px 0 18px}
    .progressive-more-wrap[hidden]{display:none!important}
    .progressive-more-btn{min-width:112px;min-height:42px;padding:9px 22px;border:1px solid #75dba4;border-radius:11px;background:linear-gradient(180deg,#267d50,#145c38);color:#fff;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;letter-spacing:.02em;box-shadow:0 3px 0 #0c4027,0 5px 12px rgba(0,0,0,.2);cursor:pointer}
    .progressive-more-btn:hover{background:linear-gradient(180deg,#319b63,#1c7045);border-color:#b4f2ce}
    .progressive-more-btn:focus-visible{outline:3px solid #f58220;outline-offset:3px}
    .progressive-more-btn:active{transform:translateY(1px);box-shadow:0 1px 0 #0c4027}
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
            target.dataset.progressiveVisible = String(INITIAL);
          }
          process(target);
        }
        record.addedNodes.forEach(node => { if (node.nodeType === 1) process(node); });
      }
      process();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.CentricProgressiveLists = { refresh: process };
})();