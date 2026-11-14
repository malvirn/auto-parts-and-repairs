/* Shared dashboard header structure. Runs after the existing page chrome and
   sidebar controls are initialized, so moving the menu button preserves its
   already-bound click handler and all existing control IDs. */
const icon = (name) => {
  const node = document.createElement("i");
  node.setAttribute("data-lucide", name);
  node.setAttribute("aria-hidden", "true");
  return node;
};

function ensureMenuButton(header) {
  let toggle = document.getElementById("dashboard-sidebar-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "dashboard-sidebar-toggle";
    toggle.className = "dashboard-sidebar-toggle";
    toggle.setAttribute("aria-label", "Open navigation");
    toggle.setAttribute("aria-controls", "sidebar");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<svg class="sidebar-toggle-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 16h9"/></svg>';
  }
  header.prepend(toggle);
}

function ensureSearch(header) {
  let searchToggle = header.querySelector(".dashboard-search-toggle");
  let panel = header.querySelector("#dashboard-search-panel, #hs-panel");
  if (!searchToggle) {
    searchToggle = document.createElement("button");
    searchToggle.type = "button";
    searchToggle.className = "dashboard-search-toggle";
    searchToggle.setAttribute("aria-label", "Open search");
    searchToggle.setAttribute("aria-expanded", "false");
    searchToggle.innerHTML = '<i data-lucide="search" aria-hidden="true"></i>';
  }
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "dashboard-search-panel";
    panel.id = "dashboard-search-panel";
    panel.hidden = true;
    panel.innerHTML = '<input type="search" id="hs-input" placeholder="Search everything…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search the whole system"><div class="hs-chips" id="hs-chips" role="group" aria-label="Search filters"></div><div id="hs-results" aria-live="polite"></div>';
    header.append(panel);
  }
  if (!searchToggle.dataset.searchBound) {
    searchToggle.dataset.searchBound = "true";
    searchToggle.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      searchToggle.setAttribute("aria-expanded", String(open));
      if (open) panel.querySelector("#hs-input")?.focus({ preventScroll: true });
    });
    panel.querySelector("#hs-input")?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        panel.hidden = true;
        searchToggle.setAttribute("aria-expanded", "false");
        searchToggle.focus({ preventScroll: true });
      } else if (event.key === "Enter" && event.currentTarget.value.trim()) {
        const target = new URL("../index.html", import.meta.url);
        target.searchParams.set("search", event.currentTarget.value.trim());
        window.location.href = target.href;
      }
    });
  }
  const oldBar = header.querySelector(".hs-bar");
  oldBar?.remove();
  const legacyInput = header.querySelector("#hs-input");
  if (legacyInput && !panel.contains(legacyInput)) panel.prepend(legacyInput);
  return { searchToggle, panel };
}

function ensureActions(header) {
  let actions = header.querySelector(".dashboard-topbar-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "dashboard-topbar-actions";
    header.append(actions);
  }
  if (!actions.querySelector(".dashboard-analytics-link")) {
    const analytics = document.createElement("a");
    analytics.className = "dashboard-toolbar-button dashboard-analytics-link";
    analytics.href = new URL("../pages/analytics.html", import.meta.url).href;
    analytics.title = "Analytics";
    analytics.setAttribute("aria-label", "Open analytics");
    analytics.append(icon("chart-no-axes-combined"));
    analytics.hidden = !document.querySelector('.sidebar a[href*="analytics.html"]');
    actions.append(analytics);
  }
  const searchToggle = header.querySelector(".dashboard-search-toggle");
  if (searchToggle && !actions.contains(searchToggle)) actions.prepend(searchToggle);
  const account = document.querySelector(".dashboard-login-level");
  if (account && !actions.contains(account)) actions.append(account);
}

function ensureDateRow(header) {
  let date = header.querySelector(".dashboard-header-date");
  if (!date) {
    date = document.createElement("div");
    date.className = "dashboard-header-date";
    date.innerHTML = '<i data-lucide="calendar-days" aria-hidden="true"></i><span id="dashboard-date">Loading date…</span><span class="header-separator">|</span><i data-lucide="clock-3" aria-hidden="true"></i><span id="hdr-clock">--:--:--</span><span class="hdr-live" id="hdr-live" data-state="online"><i aria-hidden="true"></i><span>Live</span></span>';
  }
  header.append(date);
}

export function initializeSharedHeader() {
  if (!document.body.classList.contains("dashboard-page") ||
      !document.body.classList.contains("dashboard-workshop")) return;
  const header = document.querySelector("body.dashboard-workshop > .dashboard-topbar");
  if (!header || header.dataset.sharedHeaderReady === "true") return;
  header.dataset.sharedHeaderReady = "true";
  header.setAttribute("role", "toolbar");
  header.setAttribute("aria-label", "Dashboard header");
  ensureMenuButton(header);
  header.querySelectorAll(".hdr-brand, .dashboard-header-brand, .dashboard-header-logo").forEach(node => node.remove());
  document.querySelectorAll("body.dashboard-page .sidebar__brand").forEach(node => node.remove());
  ensureDateRow(header);
  ensureSearch(header);
  ensureActions(header);
  const menu = header.querySelector("#dashboard-sidebar-toggle");
  const date = header.querySelector(".dashboard-header-date");
  const searchToggle = header.querySelector(".dashboard-search-toggle");
  const searchPanel = header.querySelector("#dashboard-search-panel, #hs-panel");
  const actions = header.querySelector(".dashboard-topbar-actions");
  if (actions) {
    [actions.querySelector(".dashboard-search-toggle"), actions.querySelector("#global-notif-bell"), actions.querySelector(".dashboard-analytics-link"),
      actions.querySelector(".dashboard-connection-status"), actions.querySelector(".dashboard-refresh"),
      actions.querySelector(".dashboard-new-job"), actions.querySelector(".dashboard-login-level")]
      .filter(Boolean).forEach(node => actions.append(node));
  }
  [menu, date, actions, searchPanel].filter(Boolean).forEach(node => header.append(node));
  window.lucide?.createIcons();
}
