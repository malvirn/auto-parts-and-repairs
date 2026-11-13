import supabase from "./supabaseClient.js";

const primaryLinks = [
  { href: "index.html", page: "index", label: "Home", paths: ["M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM2.5 14V7.707l5.5-5.5 5.5 5.5V14H10v-4a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4z"] },
  { href: "shop.html", page: "shop", label: "Shop", paths: ["M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2z", "M7 5.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m-1.496-.854a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0M7 9.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m-1.496-.854a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 0 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0"] },
  { href: "repairs.html", page: "repairs", label: "Workshop", paths: ["M16 4.5a4.5 4.5 0 0 1-1.703 3.526L13 5l2.959-1.11q.04.3.041.61", "M11.5 9c.653 0 1.273-.139 1.833-.39L12 5.5 11 3l3.826-1.53A4.5 4.5 0 0 0 7.29 6.092l-6.116 5.096a2.583 2.583 0 1 0 3.638 3.638L9.908 8.71A4.5 4.5 0 0 0 11.5 9m-1.292-4.361-.596.893.809-.27a.25.25 0 0 1 .287.377l-.596.893.809-.27.158.475-1.5.5a.25.25 0 0 1-.287-.376l.596-.893-.809.27a.25.25 0 0 1-.287-.377l.596-.893-.809.27-.158-.475 1.5-.5a.25.25 0 0 1 .287.376M3 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2"] },
  { href: "quotations.html", page: "quotations", label: "Quotes", paths: ["M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0M9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1M4.5 9a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1zM4 10.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m.5 2.5a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1z"] },
];

function makeIcon(iconName) {
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", iconName);
  return icon;
}

function makePrimaryIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach(pathData => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  return svg;
}

function buildPrimaryLink(link, currentFile) {
  const item = document.createElement(link.search ? "button" : "a");
  if (link.href) item.href = link.page === "index"
    ? (currentFile === "index" ? "index.html" : "../index.html")
    : (currentFile === "index" ? `pages/${link.href}` : link.href);
  item.append(makePrimaryIcon(link.paths), document.createElement("span"));
  item.lastElementChild.textContent = link.label;
  item.lastElementChild.className = "sr-only";
  item.setAttribute("aria-label", link.label);
  item.title = link.label;
  if (link.page === currentFile) item.setAttribute("aria-current", "page");
  return item;
}

function pageName(path) {
  return path.split(/[?#]/, 1)[0].split("/").pop().replace(/\.html$/i, "");
}

function isDashboardHome() {
  const name = pageName(window.location.pathname);
  return name === "" || name === "index";
}

function addToolbarUtilities(container, isModuleToolbar) {
  if (!container) return;

  if (!container.querySelector(".dashboard-connection-status")) {
    const status = document.createElement("span");
    status.className = "dashboard-connection-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-label", "Connection status");
    status.title = "Connection status";
    status.innerHTML = '<span class="dashboard-connection-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
    container.append(status);

    // Measure a real same-origin request instead of relying on the optional
    // Network Information API, which is missing or inconsistent on many phones.
    let checkSequence = 0;
    let checkTimer = null;
    const paintConnection = (state, label) => {
      status.dataset.state = state;
      status.title = label;
      status.setAttribute("aria-label", label);
    };
    const updateConnection = async () => {
      const sequence = ++checkSequence;
      if (!navigator.onLine) {
        paintConnection("offline", "Offline");
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const started = performance.now();
      try {
        const response = await fetch(new URL("../index.html", import.meta.url), {
          method: "HEAD", cache: "no-store", credentials: "same-origin", signal: controller.signal
        });
        if (!response.ok) throw new Error("Connection check failed");
        if (sequence !== checkSequence) return;
        const elapsed = performance.now() - started;
        if (elapsed < 350) paintConnection("good", "Strong connection");
        else if (elapsed < 900) paintConnection("fair", "Fair connection");
        else paintConnection("poor", "Weak connection");
      } catch (_) {
        if (sequence === checkSequence) paintConnection("offline", "Connection unavailable");
      } finally {
        window.clearTimeout(timeout);
      }
    };
    updateConnection();
    if (!status.dataset.connectionMonitor) {
      status.dataset.connectionMonitor = "true";
      window.addEventListener("online", updateConnection);
      window.addEventListener("offline", () => paintConnection("offline", "Offline"));
      window.addEventListener("focus", updateConnection);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) updateConnection(); });
      checkTimer = window.setInterval(updateConnection, 30000);
    }
  }

  if (!container.querySelector(".dashboard-refresh")) {
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "dashboard-toolbar-button dashboard-refresh";
    refresh.setAttribute("aria-label", "Refresh this page");
    refresh.title = "Refresh this page";
    refresh.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>';
    refresh.addEventListener("click", () => window.location.reload());
    container.append(refresh);
  }

  let newJob = container.querySelector(".dashboard-new-job");
  if (!newJob) {
    newJob = document.createElement("a");
    newJob.className = "dashboard-toolbar-button dashboard-new-job";
    newJob.setAttribute("aria-label", "Create a new job card");
    newJob.title = "Create a new job card";
    newJob.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i>';
    container.append(newJob);
  }
  newJob.href = new URL("../pages/repairs.html?new=1", import.meta.url).href;
  newJob.hidden = !["super_admin", "staff"].includes(document.body.dataset.role || "staff");
  window.lucide?.createIcons();
}

function addDashboardToolbar(main) {
  let toolbar = document.querySelector(".dashboard-topbar");
  if (!toolbar) {
    toolbar = document.createElement("header");
    toolbar.className = "dashboard-topbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Dashboard header");

    const pageHeader = main.querySelector(":scope > .app-header, :scope > .main__header");
    const dateSource = pageHeader?.querySelector(".hdr-time, .dashboard-header-date, .site-masthead__status");
    const date = dateSource?.querySelector("#dashboard-date") || pageHeader?.querySelector("#dashboard-date");
    const clock = dateSource?.querySelector("#hdr-clock") || pageHeader?.querySelector("#hdr-clock");
    const live = dateSource?.querySelector("#hdr-live") || pageHeader?.querySelector("#hdr-live");

    const dateWrap = document.createElement("div");
    dateWrap.className = "dashboard-header-date";
    dateWrap.innerHTML = '<i data-lucide="calendar-days" aria-hidden="true"></i><span id="dashboard-date">Loading date…</span><span class="header-separator">|</span><i data-lucide="clock-3" aria-hidden="true"></i><span id="hdr-clock">--:--</span><span class="hdr-live" id="hdr-live" data-state="online"><i aria-hidden="true"></i><span>Live</span></span>';
    if (date) dateWrap.querySelector("#dashboard-date").textContent = date.textContent || "Loading date…";
    if (clock) dateWrap.querySelector("#hdr-clock").textContent = clock.textContent || "--:--";
    if (live) {
      dateWrap.querySelector("#hdr-live").dataset.state = live.dataset.state || "online";
      dateWrap.querySelector("#hdr-live span").textContent = live.querySelector("span")?.textContent || "Live";
    }
    toolbar.append(dateWrap);
    const actions = document.createElement("div");
    actions.className = "dashboard-topbar-actions";
    toolbar.append(actions);
    document.body.insertBefore(toolbar, document.body.firstChild);

    // Keep the page's existing live date/time updater alive after moving its display.
    if (date && date !== dateWrap.querySelector("#dashboard-date")) date.remove();
    if (clock && clock !== dateWrap.querySelector("#hdr-clock")) clock.remove();
    if (live && live !== dateWrap.querySelector("#hdr-live")) live.remove();
  } else if (!toolbar.querySelector(".dashboard-header-date")) {
    const dateWrap = document.createElement("div");
    dateWrap.className = "dashboard-header-date";
    dateWrap.innerHTML = '<i data-lucide="calendar-days" aria-hidden="true"></i><span id="dashboard-date">Loading date…</span><span class="header-separator">|</span><i data-lucide="clock-3" aria-hidden="true"></i><span id="hdr-clock">--:--</span><span class="hdr-live" id="hdr-live" data-state="online"><i aria-hidden="true"></i><span>Live</span></span>';
    toolbar.prepend(dateWrap);
  }

  let actions = toolbar.querySelector(".dashboard-topbar-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "dashboard-topbar-actions";
    toolbar.append(actions);
  }
  addToolbarUtilities(actions, true);
  // The theme control stays in the sidebar, exactly like the home page.
  const notification = document.querySelector("#global-notif-bell");
  if (notification && !actions.contains(notification)) actions.append(notification);
  main.querySelectorAll(":scope > .app-header, :scope > .main__header").forEach(header => header.remove());
  main.querySelectorAll(":scope > .site-foot").forEach(footer => footer.remove());

  let backdrop = document.querySelector(".dashboard-sidebar-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("button");
    backdrop.className = "dashboard-sidebar-backdrop";
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close navigation");
    document.body.append(backdrop);
  }

  const sidebar = document.querySelector("body.dashboard-page .sidebar");
  if (sidebar && !document.getElementById("dashboard-sidebar-toggle")) {
    const toggle = document.createElement("button");
    toggle.className = "dashboard-sidebar-toggle";
    toggle.id = "dashboard-sidebar-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Collapse navigation");
    toggle.setAttribute("aria-controls", "sidebar");
    toggle.setAttribute("aria-expanded", "true");
    toggle.innerHTML = '<svg class="sidebar-toggle-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 16h9"/></svg>';
    sidebar.after(toggle);
  }
  window.lucide?.createIcons();
}

const SHELL_CACHE_KEY = "apr-shell-v1";
const ACCESS_CACHE_KEY = "apr-last-access-v1";

function readCachedShellDocument() {
  try {
    const cached = JSON.parse(localStorage.getItem(SHELL_CACHE_KEY) || "null");
    if (!cached || !cached.sidebar || !cached.header || !cached.toggle || !cached.backdrop) return null;
    const html = `<!doctype html><html><body class="dashboard-page dashboard-workshop">${cached.header}${cached.sidebar}${cached.toggle}${cached.backdrop}</body></html>`;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.__aprShellStale = !cached.savedAt || Date.now() - Number(cached.savedAt) > 6 * 60 * 60 * 1000;
    return parsed;
  } catch (_) { return null; }
}

function cacheCanonicalShell(indexDocument) {
  try {
    const sidebar = indexDocument.querySelector("body.dashboard-page .sidebar");
    const header = indexDocument.querySelector("body.dashboard-workshop > .dashboard-topbar");
    const toggle = indexDocument.querySelector("#dashboard-sidebar-toggle");
    const backdrop = indexDocument.querySelector(".dashboard-sidebar-backdrop");
    if (sidebar && header && toggle && backdrop) {
      localStorage.setItem(SHELL_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        sidebar: sidebar.outerHTML, header: header.outerHTML,
        toggle: toggle.outerHTML, backdrop: backdrop.outerHTML
      }));
    }
  } catch (error) { console.warn("Could not cache the dashboard shell:", error); }
}

async function normalizeDashboardSidebar(sidebar) {
  if (!sidebar || sidebar.dataset.dashboardCanonicalizing === "true" || isDashboardHome()) return;
  sidebar.dataset.dashboardCanonicalizing = "true";
  const indexUrl = new URL("../index.html", import.meta.url);
  let indexDocument = readCachedShellDocument();
  const usedCache = Boolean(indexDocument);
  try {
    if (!indexDocument) {
      const response = await fetch(indexUrl, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Could not load the dashboard navigation (${response.status})`);
      const html = await response.text();
      indexDocument = new DOMParser().parseFromString(html, "text/html");
      cacheCanonicalShell(indexDocument);
    }
    // The shared stylesheet is linked in each module page head, so cached
    // shell rendering does not wait for a late stylesheet request.
    if (usedCache && indexDocument.__aprShellStale) {
      fetch(indexUrl, { credentials: "same-origin" })
        .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.text(); })
        .then(html => cacheCanonicalShell(new DOMParser().parseFromString(html, "text/html")))
        .catch(error => console.warn("Could not refresh the cached dashboard shell:", error));
    }
    const source = indexDocument.querySelector("body.dashboard-page .sidebar");
    const sourceHeader = indexDocument.querySelector("body.dashboard-workshop > .dashboard-topbar");
    const sourceToggle = indexDocument.querySelector("#dashboard-sidebar-toggle");
    const sourceBackdrop = indexDocument.querySelector(".dashboard-sidebar-backdrop");
    if (!source || !sourceHeader || !sourceToggle || !sourceBackdrop) {
      throw new Error("The Index shared layout template is incomplete");
    }

    let rememberedAccess = {};
    try { rememberedAccess = JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY) || "{}"); } catch (_) {}
    const rawRole = String(document.body.dataset.role || rememberedAccess.role || "staff").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const normalizedRole = rawRole === "superadmin" ? "super_admin" : rawRole;
    // Verified numeric access level is authoritative for super-admin navigation.
    const role = Number(document.body.dataset.accessLevel || rememberedAccess.accessLevel) >= 2 ? "super_admin" : normalizedRole;
    const accessByPage = {
      accounting: ["super_admin", "accounting"],
      ledger: ["super_admin", "accounting"],
      payables: ["super_admin", "accounting"],
      cashbook: ["super_admin", "accounting"],
      commissions: ["super_admin", "accounting"],
      "landed-cost": ["super_admin", "accounting"],
      "fixed-assets": ["super_admin", "accounting"],
      "financial-statements": ["super_admin", "accounting"],
      analytics: ["super_admin", "accounting"],
      technicians: ["super_admin"],
      customers: ["super_admin", "staff"],
      checklist: ["super_admin", "staff"],
      repairs: ["super_admin", "staff"],
      suppliers: ["super_admin", "staff"],
    };
    const canonical = source.cloneNode(true);
    canonical.id = "sidebar";
    canonical.dataset.dashboardCanonical = "true";
    canonical.style.setProperty("visibility", "visible", "important");
    canonical.removeAttribute("aria-hidden");
    // The Index reference sidebar starts with search, not a second Centric logo.
    canonical.querySelector(".sidebar__brand")?.remove();
    canonical.querySelector("#dashboard-sidebar-toggle")?.remove();
    canonical.querySelectorAll("img[src]").forEach(image => {
      image.src = new URL(image.getAttribute("src"), indexUrl).href;
    });
    const currentPage = pageName(window.location.pathname);
    canonical.querySelectorAll("a.nav-link").forEach(link => {
      const target = new URL(link.getAttribute("href"), indexUrl);
      const targetPage = pageName(target.pathname);
      const allowedRoles = accessByPage[targetPage];
      if (allowedRoles && !allowedRoles.includes(role)) {
        const groupKey = link.closest(".nav-group")?.dataset.group;
        if (groupKey === "accounting") {
          const restrictedLink = document.createElement("span");
          restrictedLink.className = "nav-link nav-link--restricted";
          restrictedLink.setAttribute("aria-disabled", "true");
          restrictedLink.title = "Your account does not have access to this module";
          restrictedLink.innerHTML = link.innerHTML;
          link.replaceWith(restrictedLink);
          return;
        }
        link.remove();
        return;
      }
      link.href = target.pathname + target.search + target.hash;
      const isCurrent = pageName(target.pathname) === currentPage;
      link.classList.toggle("active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    canonical.querySelectorAll(".sidebar-quick-access a").forEach(link => {
      const target = new URL(link.getAttribute("href"), indexUrl);
      const isCurrent = pageName(target.pathname) === currentPage;
      link.classList.toggle("is-current", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    canonical.querySelectorAll(".nav-group").forEach(group => {
      if (!group.querySelector(".nav-link")) {
        group.remove();
        return;
      }
      const groupKey = group.dataset.group;
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem("apr-nav-open") || "{}"); } catch (error) {
        console.warn("Could not read saved navigation state:", error);
      }
      const shouldOpen = Object.hasOwn(stored, groupKey)
        ? Boolean(stored[groupKey])
        : Boolean(group.querySelector('[aria-current="page"]'));
      group.classList.toggle("open", shouldOpen);
      group.querySelector(".nav-grp")?.setAttribute("aria-expanded", String(shouldOpen));
    });
    sidebar.replaceWith(canonical);

    // Replace module-specific chrome with the exact Index page elements.
    const header = sourceHeader.cloneNode(true);
    const existingHeader = document.querySelector("body.dashboard-workshop > .dashboard-topbar");
    // Preserve the live notification button before replacing the module header.
    const existingBell = document.getElementById("global-notif-bell");
    if (existingHeader) existingHeader.replaceWith(header);
    else document.body.insertBefore(header, document.body.firstChild);
    const headerActions = header.querySelector(".dashboard-topbar-actions");
    if (existingBell && headerActions) headerActions.prepend(existingBell);
    addToolbarUtilities(headerActions, true);
    const refreshButton = header.querySelector("#dashboard-refresh, .dashboard-refresh");
    if (refreshButton && !refreshButton.dataset.sharedRefreshBound) {
      refreshButton.dataset.sharedRefreshBound = "true";
      refreshButton.addEventListener("click", () => window.location.reload());
    }
    placeSharedNotificationBell();

    const toggle = sourceToggle.cloneNode(true);
    document.getElementById("dashboard-sidebar-toggle")?.replaceWith(toggle);
    const backdrop = sourceBackdrop.cloneNode(true);
    document.querySelector(".dashboard-sidebar-backdrop")?.replaceWith(backdrop);
    if (!document.querySelector(".dashboard-sidebar-backdrop")) canonical.before(backdrop);

    canonical.removeAttribute("inert");

    // cloneNode does not copy event listeners, so explicitly reconnect the
    // Index sidebar theme switch to the app-wide theme controller.
    const sidebarThemeButton = canonical.querySelector("#sidebar-theme-toggle");
    if (sidebarThemeButton && !sidebarThemeButton.dataset.themeBound) {
      sidebarThemeButton.dataset.themeBound = "true";
      sidebarThemeButton.addEventListener("click", () => {
        const nextMode = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem("apr-theme", nextMode); } catch (error) {}
        window.dispatchEvent(new CustomEvent("apr:theme-changed", { detail: { mode: nextMode } }));
      });
    }
    delete sidebar.dataset.dashboardCanonicalizing;
    sidebar.dataset.dashboardCanonical = "true";
    sidebar.style.removeProperty("visibility");
    sidebar.removeAttribute("aria-hidden");
    window.lucide?.createIcons();
  } catch (error) {
    delete sidebar.dataset.dashboardCanonicalizing;
    sidebar.style.removeProperty("visibility");
    sidebar.removeAttribute("aria-hidden");
    console.warn("Using this page's navigation because the shared shell could not load:", error);
  }
}

function startSharedDashboardHeaderClock() {
  if (window.__centricHeaderClockStarted) return;
  window.__centricHeaderClockStarted = true;
  const update = () => {
    const date = document.getElementById("dashboard-date");
    const clock = document.getElementById("hdr-clock");
    if (date) date.textContent = new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      timeZone: "Africa/Harare"
    }).format(new Date());
    if (clock) clock.textContent = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      timeZone: "Africa/Harare"
    }).format(new Date());
    const live = document.getElementById("hdr-live");
    if (live) {
      live.dataset.state = navigator.onLine ? "online" : "offline";
      const label = live.querySelector("span");
      if (label) label.textContent = navigator.onLine ? "Live" : "Offline";
    }
  };
  update();
  window.setInterval(update, 1000);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}

function placeSharedNotificationBell() {
  const actions = document.querySelector("body.dashboard-workshop .dashboard-topbar .dashboard-topbar-actions");
  const bell = document.getElementById("global-notif-bell");
  if (!actions || !bell) return;
  if (bell.parentElement !== actions || actions.firstElementChild !== bell) actions.prepend(bell);
  bell.style.position = "relative";
  bell.style.top = "auto";
  bell.style.right = "auto";
  bell.style.zIndex = "auto";
}

function watchSharedNotificationBell() {
  if (window.__centricNotificationObserver) return;
  window.__centricNotificationObserver = new MutationObserver(() => placeSharedNotificationBell());
  window.__centricNotificationObserver.observe(document.body, { childList: true, subtree: true });
  placeSharedNotificationBell();
}

function ensureDashboardHeaderActions(header) {
  const menuWrap = header?.querySelector(":scope > .hdr-menu-wrap");
  if (!menuWrap) return;

  let actions = header.querySelector(":scope > .hdr-header-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "hdr-header-actions";
    menuWrap.before(actions);
  }
  actions.append(menuWrap);
  if (!document.querySelector("body.dashboard-workshop .dashboard-topbar")) {
    addToolbarUtilities(actions, false);
  }
  header.querySelectorAll(".theme-toggle, #global-notif-bell").forEach(control => {
    if (control !== actions && !actions.contains(control)) actions.insertBefore(control, menuWrap);
    else if (control.parentElement === menuWrap) actions.insertBefore(control, menuWrap);
  });
}

function ensureDashboardToolbarActions(toolbar) {
  if (!toolbar) return;

  let actions = toolbar.querySelector(".dashboard-topbar-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "dashboard-topbar-actions";
    toolbar.append(actions);
  }
  addToolbarUtilities(actions, true);
  toolbar.querySelectorAll(".theme-toggle, #global-notif-bell").forEach(control => {
    if (control !== actions && !actions.contains(control)) actions.append(control);
  });
}

let dashboardChromeFallbackTimer = null;

function markDashboardChromeReady() {
  if (!document.body?.classList.contains("dashboard-workshop")) return;
  document.body.classList.add("dashboard-chrome-ready");
  if (dashboardChromeFallbackTimer !== null) {
    clearTimeout(dashboardChromeFallbackTimer);
    dashboardChromeFallbackTimer = null;
  }
}

function revealDashboardChromeWhenReady() {
  if (dashboardChromeFallbackTimer === null) {
    dashboardChromeFallbackTimer = window.setTimeout(markDashboardChromeReady, 3000);
  }
  const stylesheet = document.querySelector('link[data-shared-dashboard-chrome]');
  if (!stylesheet || stylesheet.sheet) {
    markDashboardChromeReady();
    return;
  }
  stylesheet.addEventListener("load", markDashboardChromeReady, { once: true });
  stylesheet.addEventListener("error", markDashboardChromeReady, { once: true });
}

function initializePageChrome() {
  if (!document.body.classList.contains("dashboard-page")) return;

  const main = document.querySelector(".dashboard-page .main");
  if (!main) return;
  if (!isDashboardHome()) {
    document.body.classList.add("dashboard-workshop");
    // Start the safety release before building the toolbar so even an
    // initialization error cannot leave the page header hidden indefinitely.
    if (dashboardChromeFallbackTimer === null) {
      dashboardChromeFallbackTimer = window.setTimeout(markDashboardChromeReady, 3000);
    }
    addDashboardToolbar(main);
    revealDashboardChromeWhenReady();
    return;
  }

  if (!main.querySelector(":scope > .site-masthead, :scope > .app-header")) {
    const header = document.createElement("header");
    header.className = "main__header dashboard-hero app-header";
    header.innerHTML = `
      <div class="hdr-brand dashboard-hero__brand">
        <img src="../assets/logo.png" alt="Centric Auto Mobile" class="dashboard-hero__logo">
        <span class="hdr-divider" aria-hidden="true"></span>
        <div><p class="hdr-name">Centric <em>Auto Mobile</em></p><p class="hdr-sub">Auto Parts &amp; Repairs Management System</p></div>
      </div>
      <div class="hs" id="hs">
        <div class="hs-bar" role="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
          <input type="search" id="hs-input" placeholder="Search everything…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search the whole system" aria-controls="hs-panel">
          <span class="hs-kbd" aria-hidden="true">/</span>
        </div>
        <div class="hs-panel" id="hs-panel" hidden><div class="hs-chips" id="hs-chips" role="group" aria-label="Search filters"></div><div id="hs-results" aria-live="polite"></div></div>
      </div>
      <div class="hdr-right">
        <div class="hdr-time"><p class="page-intro" id="dashboard-date">Loading…</p><div class="hdr-clock" id="hdr-clock" aria-hidden="true">--:--:--</div><div class="hdr-live" id="hdr-live" data-state="online"><i aria-hidden="true"></i><span>Live</span></div></div>
        <span class="hdr-divider" aria-hidden="true"></span><div class="hdr-hello"><span id="dashboard-greeting">Welcome back</span></div>
      </div>
      <div class="hdr-menu-wrap">
        <button type="button" class="hdr-more" id="hdr-menu-btn" aria-label="More modules" aria-haspopup="true" aria-expanded="false" aria-controls="hdr-menu">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>
        </button>
        <div class="hdr-menu" id="hdr-menu" role="menu" aria-label="More modules" hidden></div>
      </div>`;
    main.insertBefore(header, main.firstChild);
    initializeGeneratedHeader(header);
  }

  if (!main.querySelector(":scope > .site-foot")) {
    const footer = document.createElement("footer");
    footer.className = "site-foot";

    const copyright = document.createElement("span");
    copyright.textContent = "© 2025 Centric Auto Mobile. All rights reserved.";

    const email = document.createElement("a");
    email.href = "mailto:malvirngomo8@gmail.com";
    email.append(makeIcon("mail"), document.createTextNode("malvirngomo8@gmail.com"));

    footer.append(copyright, email);
    main.append(footer);
  }

  ensureDashboardToolbarActions(document.querySelector("body.dashboard-workshop .dashboard-topbar"));
  ensureDashboardHeaderActions(main.querySelector(":scope > .app-header"));
}

function initializeGeneratedHeader(header) {
  const date = header.querySelector("#dashboard-date");
  const clock = header.querySelector("#hdr-clock");
  const live = header.querySelector("#hdr-live");
  const update = () => {
    const now = new Date();
    date.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    clock.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
  };
  const updateConnection = () => {
    const online = navigator.onLine;
    live.dataset.state = online ? "online" : "offline";
    live.querySelector("span").textContent = online ? "Live" : "Offline";
  };
  update();
  updateConnection();
  window.setInterval(update, 1000);
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  const search = header.querySelector("#hs-input");
  if (!document.querySelector('script[src*="/js/dashboard-header.js"]')) {
    search.addEventListener("keydown", event => {
      if (event.key !== "Enter" || !search.value.trim()) return;
      const dashboard = new URL("../index.html", window.location.href);
      dashboard.searchParams.set("search", search.value.trim());
      window.location.href = dashboard.href;
    });
  }

  if (!document.querySelector('script[src*="/js/dashboard-header.js"]')) {
    const button = header.querySelector("#hdr-menu-btn");
    const menu = header.querySelector("#hdr-menu");
    const closeMenu = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    button.addEventListener("click", () => {
    if (!menu.hidden) {
      closeMenu();
      return;
    }
    menu.replaceChildren();
    const groups = [...document.querySelectorAll(".sidebar .nav-group[data-group]")];
    const currentPage = pageName(window.location.pathname);
    groups.forEach(group => {
      const links = [...group.querySelectorAll("a.nav-link")].filter(link => link.isConnected);
      if (!links.length) return;
      const groupWrap = document.createElement("div");
      groupWrap.className = "m-group";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "m-grp";
      const groupButton = group.querySelector(".nav-grp");
      const iconName = groupButton?.querySelector("[data-lucide]")?.getAttribute("data-lucide") || "folder";
      toggle.append(makeIcon(iconName));
      const title = document.createElement("span");
      title.textContent = groupButton?.querySelector("span")?.textContent.trim() || "Modules";
      toggle.append(title);
      const chev = document.createElement("span");
      chev.className = "m-chev";
      chev.setAttribute("aria-hidden", "true");
      toggle.append(chev);
      const items = document.createElement("div");
      items.className = "m-items";
      links.forEach(link => {
        const item = document.createElement("a");
        item.href = link.href;
        item.setAttribute("role", "menuitem");
        item.append(makeIcon(link.querySelector("[data-lucide]")?.getAttribute("data-lucide") || "circle"));
        const label = document.createElement("span");
        label.textContent = link.textContent.trim();
        item.append(label);
        if (link.classList.contains("active") || link.getAttribute("aria-current") === "page") item.setAttribute("aria-current", "page");
        items.append(item);
      });
      const hasCurrentPage = links.some(link => pageName(new URL(link.href, window.location.href).pathname) === currentPage);
      items.hidden = !hasCurrentPage;
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        menu.querySelectorAll(".m-grp").forEach(button => button.setAttribute("aria-expanded", "false"));
        menu.querySelectorAll(".m-items").forEach(list => { list.hidden = true; });
        toggle.setAttribute("aria-expanded", String(!open));
        items.hidden = open;
      });
      toggle.setAttribute("aria-expanded", String(hasCurrentPage));
      groupWrap.append(toggle, items);
      menu.append(groupWrap);
    });
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("a")?.focus({ preventScroll: true });
    if (window.lucide) window.lucide.createIcons();
    });
    document.addEventListener("click", event => {
      if (!header.querySelector(".hdr-menu-wrap").contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !menu.hidden) {
        closeMenu();
        button.focus({ preventScroll: true });
      }
    });
  }
}

function initializeNavigation() {
  initializePageChrome();

  const sidebar = document.querySelector("body.dashboard-page .sidebar");
  if (!sidebar) return;
  ensureSidebarAccount(sidebar);
  document.querySelectorAll("body.dashboard-workshop .dashboard-topbar .hs, body.dashboard-workshop .app-header .hs, body.dashboard-workshop .main__header .hs")
    .forEach(search => { if (!search.closest(".sidebar")) search.remove(); });
  document.querySelectorAll(".tabbar, .bottom-nav, .ftbar, .sidebar-toggle, .sidebar-backdrop, .dots-btn, .apr-header-menu, .menu-scrim").forEach(element => element.remove());
  document.querySelector(".apr-bottom-nav")?.remove();
  document.body.classList.remove("sidebar-open", "menu-open");
  if (document.body.classList.contains("dashboard-workshop") && !isDashboardHome()) {
    document.querySelectorAll(".site-foot").forEach(element => element.remove());
    const toggle = document.getElementById("dashboard-sidebar-toggle");
    const backdrop = document.querySelector(".dashboard-sidebar-backdrop");
    const isMobile = () => window.matchMedia("(max-width: 768px)").matches;
    // The saved "collapsed" choice is a desktop setting. On a phone the menu is a
    // slide-in drawer, and the collapsed flag used to keep that drawer off-screen
    // while the toggle button still jumped over the header icons.
    // Tablets (769 to 1100px) start with the menu collapsed, like the dashboard, so the
    // page gets the full width. Laptops start expanded. Each size remembers its own choice.
    const collapseKey = "apr-sidebar-collapsed";
    const lockKey = "apr-sidebar-locked";
    const isLocked = () => { try { return localStorage.getItem(lockKey) === "true"; } catch (_) { return false; } };
    const applySavedCollapse = () => {
      document.body.classList.toggle("sidebar-collapsed", !isMobile() && !isLocked());
      document.body.classList.remove("sidebar-open");
    };
    applySavedCollapse();
    const syncSidebar = () => {
      const compact = document.body.classList.contains("sidebar-collapsed");
      const open = isMobile() ? document.body.classList.contains("sidebar-open") : !compact;
      toggle?.setAttribute("aria-expanded", String(open));
      toggle?.setAttribute("aria-label", isMobile()
        ? (open ? "Close navigation" : "Open navigation")
        : (compact ? "Expand navigation" : "Collapse navigation"));
      const currentSidebar = document.querySelector("body.dashboard-page .sidebar");
      if (currentSidebar) currentSidebar.inert = !open;
    };
    document.addEventListener("apr:sidebar-lock-changed", event => {
      if (!isMobile()) document.body.classList.toggle("sidebar-collapsed", !event.detail?.locked);
      syncSidebar();
    });
    if (toggle && !toggle.dataset.navigationBound) {
      toggle.dataset.navigationBound = "true";
      toggle.addEventListener("click", () => {
        if (isMobile()) document.body.classList.toggle("sidebar-open");
        else {
          document.body.classList.toggle("sidebar-collapsed");
          try { localStorage.setItem(collapseKey, String(document.body.classList.contains("sidebar-collapsed"))); } catch (error) {
            console.warn("Could not save sidebar state:", error);
          }
        }
        syncSidebar();
      });
      backdrop?.addEventListener("click", () => {
        document.body.classList.remove("sidebar-open");
        syncSidebar();
      });
      document.addEventListener("click", event => {
        const groupButton = event.target.closest(".sidebar[data-dashboard-canonical='true'] .nav-grp");
        if (groupButton) {
          const group = groupButton.closest(".nav-group");
          const open = !group.classList.contains("open");
          group.classList.toggle("open", open);
          groupButton.setAttribute("aria-expanded", String(open));
          try {
            const state = JSON.parse(localStorage.getItem("apr-nav-open") || "{}");
            state[group.dataset.group] = open;
            localStorage.setItem("apr-nav-open", JSON.stringify(state));
          } catch (error) {
            console.warn("Could not save navigation state:", error);
          }
          return;
        }
        if (event.target.closest(".sidebar a.nav-link")) {
          if (isMobile()) {
            document.body.classList.remove("sidebar-open");
          } else if (!isLocked()) {
            document.body.classList.add("sidebar-collapsed");
            try { localStorage.setItem(collapseKey, "true"); } catch (error) {
              console.warn("Could not save collapsed navigation state:", error);
            }
          }
          syncSidebar();
        }
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && document.body.classList.contains("sidebar-open")) {
          document.body.classList.remove("sidebar-open");
          syncSidebar();
        }
      });
      window.addEventListener("resize", () => {
        if (!isMobile()) document.body.classList.remove("sidebar-open");
        applySavedCollapse();
        syncSidebar();
      }, { passive: true });
    }
    syncSidebar();
  }

  const currentFile = pageName(window.location.pathname);
  sidebar.querySelectorAll(".apr-drawer-head, .drawer-head").forEach(element => element.remove());

  if (!document.body.classList.contains("dashboard-workshop")) {
    const nav = document.createElement("nav");
    nav.className = "ftbar";
    nav.setAttribute("aria-label", "Main");
    primaryLinks.forEach(link => nav.append(buildPrimaryLink(link, currentFile)));
    document.body.append(nav);
  }
  if (!document.body.classList.contains("dashboard-workshop")) sidebar.inert = true;
  if (window.lucide) window.lucide.createIcons();
}

function ensureSidebarAccount(sidebar) {
  if (!sidebar) return;
  let account = sidebar.querySelector(".sidebar-account");
  if (!account) {
    account = document.createElement("section");
    account.className = "sidebar-account";
    account.setAttribute("aria-label", "Signed-in account");
    const avatar = document.createElement("span");
    avatar.className = "sidebar-account__avatar";
    avatar.setAttribute("aria-hidden", "true");
    const details = document.createElement("span");
    details.className = "sidebar-account__details";
    const name = document.createElement("strong");
    name.className = "sidebar-account__name";
    const role = document.createElement("small");
    role.className = "sidebar-account__role";
    const online = document.createElement("small");
    online.className = "sidebar-account__online";
    details.append(name, role, online);
    account.append(avatar, details);
  }
  let lock = sidebar.querySelector(".sidebar-account__lock");
  if (!lock) {
    lock = document.createElement("button");
    lock.type = "button";
    lock.className = "sidebar-account__lock";
    lock.setAttribute("aria-pressed", "false");
  }
  const paintLock = () => {
    let locked = false;
    try { locked = localStorage.getItem("apr-sidebar-locked") === "true"; } catch (_) {}
    lock.innerHTML = locked
      ? '<i data-lucide="lock" aria-hidden="true"></i><span>Unlock</span>'
      : '<i data-lucide="unlock" aria-hidden="true"></i><span>Lock</span>';
    lock.setAttribute("aria-pressed", String(locked));
    lock.setAttribute("aria-label", locked ? "Unlock sidebar auto-collapse" : "Lock sidebar open");
    lock.title = locked ? "Unlock sidebar auto-collapse" : "Keep sidebar open when changing modules";
    window.lucide?.createIcons();
  };
  paintLock();
  if (!lock.dataset.bound) {
    lock.dataset.bound = "true";
    lock.addEventListener("click", () => {
      const next = lock.getAttribute("aria-pressed") !== "true";
      try { localStorage.setItem("apr-sidebar-locked", String(next)); } catch (_) {}
      paintLock();
      document.dispatchEvent(new CustomEvent("apr:sidebar-lock-changed", { detail: { locked: next } }));
    });
  }
  let signOut = sidebar.querySelector(".sidebar-account__signout");
  if (!signOut) {
    signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "sidebar-account__signout";
    signOut.innerHTML = '<i data-lucide="log-out" aria-hidden="true"></i><span>Sign Out</span>';
    signOut.setAttribute("aria-label", "Sign out");
    signOut.title = "Sign out";
  }
  signOut.innerHTML = '<i data-lucide="log-out" aria-hidden="true"></i>';
  signOut.setAttribute("aria-label", "Sign out");
  signOut.title = "Sign out";
  if (!signOut.dataset.bound) {
    signOut.dataset.bound = "true";
    signOut.addEventListener("click", async () => {
      signOut.disabled = true;
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        const inPagesFolder = window.location.pathname.replace(/\\/g, "/").includes("/pages/");
        window.location.replace(inPagesFolder ? "../login.html" : "login.html");
      } catch (error) {
        console.error("Could not sign out:", error);
        alert("Could not sign out: " + (error.message || String(error)));
        signOut.disabled = false;
      }
    });
  }
  let footer = sidebar.querySelector(".sidebar-account__footer");
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "sidebar-account__footer";
    footer.setAttribute("aria-label", "Account actions");
  }
  footer.append(lock, signOut);

  let scrollArea = sidebar.querySelector(":scope > .sidebar-scroll");
  if (!scrollArea) {
    scrollArea = document.createElement("div");
    scrollArea.className = "sidebar-scroll";
  }
  [...sidebar.children].forEach(child => {
    if (child !== account && child !== scrollArea && child !== footer) scrollArea.append(child);
  });
  sidebar.style.setProperty("display", "flex", "important");
  sidebar.style.setProperty("flex-direction", "column", "important");
  sidebar.style.setProperty("overflow", "hidden", "important");
  sidebar.prepend(account);
  sidebar.append(scrollArea, footer);

  const accountName = document.body.dataset.accountName || "Account";
  const roleName = (document.body.dataset.role || "staff")
    .split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const accessLevel = document.body.dataset.accessLevel;
  const name = account.querySelector(".sidebar-account__name");
  const role = account.querySelector(".sidebar-account__role");
  const avatar = account.querySelector(".sidebar-account__avatar");
  const online = account.querySelector(".sidebar-account__online");
  if (name) name.textContent = accountName;
  if (role) role.textContent = accessLevel ? `Access level ${accessLevel} · ${roleName}` : `Access · ${roleName}`;
  if (avatar) avatar.textContent = accountName.trim().split(/\\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "A";
  const updateOnline = () => {
    if (!online) return;
    online.dataset.state = navigator.onLine ? "online" : "offline";
    online.textContent = navigator.onLine ? "Online" : "Offline";
  };
  updateOnline();
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  window.lucide?.createIcons();
}

async function initializeAfterAccess() {
  if (document.body.dataset.role) {
    try {
      localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({
        role: document.body.dataset.role,
        accessLevel: document.body.dataset.accessLevel || null
      }));
    } catch (_) {}
  }
  if (!document.body.dataset.role) {
    document.addEventListener("apr:access-ready", initializeAfterAccess, { once: true });
    return;
  }
  await normalizeDashboardSidebar(document.querySelector("body.dashboard-page .sidebar"));
  initializeNavigation();
}

// Render the cached canonical shell immediately, using the last verified role
// until the current session's access check supplies an authoritative role.
if (!isDashboardHome()) {
  const initialSidebar = document.querySelector("body.dashboard-page .sidebar");
  if (initialSidebar) normalizeDashboardSidebar(initialSidebar);
}

initializePageChrome();
startSharedDashboardHeaderClock();
watchSharedNotificationBell();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAfterAccess, { once: true });
} else {
  initializeAfterAccess();
}


// Global keyboard shortcuts and lowercase text-entry standard.
(() => {
  if (window.__centricGlobalShortcutsBound) return;
  window.__centricGlobalShortcutsBound = true;

  const pageUrl = file => new URL("../pages/" + file, import.meta.url).href;
  const isTextEntry = target => Boolean(target?.closest?.(
    'input, textarea, select, [contenteditable="true"], [role="textbox"]'
  ));

  document.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = String(event.key || "").toLowerCase();
    const target = event.target;
    const searchTarget = target?.matches?.("#hs-input, #global-search-input");
    if (isTextEntry(target) && !(key === "s" && searchTarget)) return;

    let destination = null;
    if (key === "s" && !event.shiftKey) {
      event.preventDefault();
      const search = document.querySelector("#hs-input, #global-search-input");
      if (search) {
        const panel = document.getElementById("hs-panel");
        if (panel) panel.hidden = false;
        search.focus({ preventScroll: true });
        search.select?.();
      } else {
        document.getElementById("dashboard-sidebar-toggle")?.click();
      }
      return;
    }
    if (key === "q" && !event.shiftKey) destination = "quotations.html";
    else if (key === "j" && !event.shiftKey) destination = "repairs.html";
    else if (key === "r" && !event.shiftKey) destination = "receipts.html";
    else if (key === "c" && event.shiftKey) destination = "checklist.html";
    if (!destination) return;
    event.preventDefault();
    window.location.assign(pageUrl(destination));
  });


})();
