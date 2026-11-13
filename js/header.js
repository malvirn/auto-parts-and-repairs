/* Shared dashboard header structure. Runs after the existing page chrome and
   sidebar controls are initialized, so moving the menu button preserves its
   already-bound click handler and all existing control IDs. */
const icon = (name) => {
  const node = document.createElement("i");
  node.setAttribute("data-lucide", name);
  node.setAttribute("aria-hidden", "true");
  return node;
};

function ensureHeaderBrand(header) {
  let brand = header.querySelector(":scope > .dashboard-header-brand");
  if (!brand) {
    brand = document.createElement("a");
    brand.className = "dashboard-header-brand";
    brand.href = new URL("../index.html", import.meta.url).href;
    brand.setAttribute("aria-label", "Centric Auto Mobile home");
    const existingLogo = document.querySelector(".sidebar__brand .brand-logo");
    const logo = existingLogo || document.createElement("img");
    logo.src = new URL("../assets/logo.png", import.meta.url).href;
    logo.alt = "Centric Auto Mobile";
    logo.className = "dashboard-header-logo";
    existingLogo?.closest(".sidebar__brand")?.remove();
    const copy = document.createElement("span");
    copy.className = "dashboard-header-brand-copy";
    copy.innerHTML = '<strong>Centric Auto Mobile</strong><small>Auto Parts & Repairs</small>';
    brand.append(logo, copy);
  }
  header.prepend(brand);
}

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
  let search = document.getElementById("hs");
  if (!search) {
    search = document.createElement("div");
    search.className = "hs dashboard-header-search";
    search.id = "hs";
    search.innerHTML = '<div class="hs-bar" role="search"><i data-lucide="search" aria-hidden="true"></i><input type="search" id="hs-input" placeholder="Search everything…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search the whole system" aria-controls="hs-panel"><span class="hs-kbd" aria-hidden="true">/</span></div><div class="hs-panel" id="hs-panel" hidden><div class="hs-chips" id="hs-chips" role="group" aria-label="Search filters"></div><div id="hs-results" aria-live="polite"></div></div>';
  }
  if (!header.contains(search)) header.append(search);
  let searchToggle = header.querySelector(".dashboard-search-toggle");
  if (!searchToggle) {
    searchToggle = document.createElement("button");
    searchToggle.type = "button";
    searchToggle.className = "dashboard-search-toggle";
    searchToggle.setAttribute("aria-label", "Open search");
    searchToggle.setAttribute("aria-expanded", "false");
    searchToggle.innerHTML = '<i data-lucide="search" aria-hidden="true"></i>';
    header.insertBefore(searchToggle, search);
    searchToggle.addEventListener("click", () => {
      const expanded = header.classList.toggle("search-expanded");
      searchToggle.setAttribute("aria-expanded", String(expanded));
      if (expanded) document.getElementById("hs-input")?.focus({ preventScroll: true });
      else searchToggle.focus({ preventScroll: true });
    });
  }
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
  ensureHeaderBrand(header);
  ensureDateRow(header);
  ensureSearch(header);
  ensureActions(header);
  const menu = header.querySelector("#dashboard-sidebar-toggle");
  const brand = header.querySelector(".dashboard-header-brand");
  const date = header.querySelector(".dashboard-header-date");
  const searchToggle = header.querySelector(".dashboard-search-toggle");
  const search = header.querySelector("#hs");
  const actions = header.querySelector(".dashboard-topbar-actions");
  if (actions) {
    [actions.querySelector("#global-notif-bell"), actions.querySelector(".dashboard-analytics-link"),
      actions.querySelector(".dashboard-connection-status"), actions.querySelector(".dashboard-refresh"),
      actions.querySelector(".dashboard-new-job"), actions.querySelector(".dashboard-login-level")]
      .filter(Boolean).forEach(node => actions.append(node));
  }
  [menu, brand, date, searchToggle, search, actions].filter(Boolean).forEach(node => header.append(node));
  window.lucide?.createIcons();
}
