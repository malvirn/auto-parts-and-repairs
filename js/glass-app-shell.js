import supabase from "./supabaseClient.js";

const NAV = [
  { title: "Main", items: [{ label: "Home", href: "index.html", icon: "house", page: "index" }] },
  { title: "Workshop", icon: "wrench", items: [
    { label: "Repairs / Job Cards", href: "pages/repairs.html", color: "#F58A4B", page: "repairs", roles: ["super_admin","staff"] },
    { label: "Vehicle Checklist", href: "pages/checklist.html", color: "#60A5FA", page: "checklist" },
    { label: "Technicians", href: "pages/technicians.html", color: "#A78BFA", page: "technicians", roles: ["super_admin"] },
    { label: "Commissions", href: "pages/commissions.html", color: "#FACC15", page: "commissions", roles: ["super_admin","accounting"] }
  ]},
  { title: "Inventory", icon: "package", items: [
    { label: "Shop / Parts", href: "pages/shop.html", color: "#34D399", page: "shop" },
    { label: "Suppliers", href: "pages/suppliers.html", color: "#2DD4BF", page: "suppliers", roles: ["super_admin","staff"] },
    { label: "Landed Cost", href: "pages/landed-cost.html", color: "#F472B6", page: "landed-cost", roles: ["super_admin","accounting"] }
  ]},
  { title: "Finance", icon: "landmark", items: [
    { label: "Quotations", href: "pages/quotations.html", color: "#60A5FA", page: "quotations" },
    { label: "Receipts", href: "pages/receipts.html", color: "#34D399", page: "receipts" },
    { label: "Cashbook", href: "pages/cashbook.html", color: "#F58A4B", page: "cashbook", roles: ["super_admin","accounting"] },
    { label: "Payables", href: "pages/payables.html", color: "#A78BFA", page: "payables", roles: ["super_admin","accounting"] },
    { label: "Ledger", href: "pages/ledger.html", color: "#FB7185", page: "ledger", attention: "ledger", roles: ["super_admin","accounting"] },
    { label: "Accounting", href: "pages/accounting.html", color: "#FACC15", page: "accounting", roles: ["super_admin","accounting"] },
    { label: "Fixed Assets", href: "pages/fixed-assets.html", color: "#2DD4BF", page: "fixed-assets", roles: ["super_admin","accounting"] },
    { label: "Financial Statements", href: "pages/financial-statements.html", color: "#F472B6", page: "financial-statements", roles: ["super_admin","accounting"] }
  ]},
  { title: "Intelligence", icon: "brain-circuit", items: [
    { label: "Centric Intelligence", href: "pages/centric-intelligence.html", color: "#A78BFA", page: "centric-intelligence", roles: ["super_admin","accounting"] },
    { label: "Analytics", href: "pages/analytics.html", color: "#60A5FA", page: "analytics", roles: ["super_admin","accounting"] }
  ]},
  { title: "Administration", icon: "shield-check", items: [
    { label: "Customers", href: "pages/customers.html", color: "#34D399", page: "customers", roles: ["super_admin","staff"] },
    { label: "Settings", href: "pages/settings.html", color: "#F58A4B", page: "settings" }
  ]}
];

const KEY = "centric-glass-sidebar";
const page = () => (location.pathname.split("/").pop() || "index.html").replace(/\.html$/i, "");
const inPages = () => /\/pages\//.test(location.pathname);
const hrefFor = href => inPages() ? (href === "index.html" ? "../index.html" : href.replace(/^pages\//, "")) : href;
const role = () => String(document.body.dataset.role || "staff").toLowerCase();
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const initials = value => String(value || "CA").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase();

function icon(name) { return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }

const GROUPS_KEY = "centric-glass-groups";
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function savedGroups() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}") || {}; } catch (_) { return {}; }
}
function saveGroup(title, open) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...savedGroups(), [title]: open })); } catch (_) {}
}

// Plain links go to a page. Folder buttons only open and close their group.
function navGroups(current) {
  const visible = NAV.map(group => ({ ...group, items: group.items.filter(item => !item.roles || item.roles.includes(role())) }))
    .filter(group => group.items.length);
  const saved = savedGroups();
  const flat = visible.filter(group => !group.icon).map(group =>
    '<section class="glass-nav-group" aria-label="' + esc(group.title) + '">' +
    '<div class="glass-nav-heading">' + esc(group.title) + '</div>' +
    group.items.map(item => '<a class="glass-nav-link' + (item.page === current ? ' is-active' : '') + '" href="' + esc(hrefFor(item.href)) + '"' +
      (item.page === current ? ' aria-current="page"' : '') + ' title="' + esc(item.label) + '">' +
      icon(item.icon) + '<span>' + esc(item.label) + '</span></a>').join("") +
    (group.title === "Main" ? notificationsItem() : "") +
    '</section>').join("");
  const folders = visible.filter(group => group.icon).map(group => {
    const hasActive = group.items.some(item => item.page === current);
    const open = hasActive || (saved[group.title] !== undefined && !!saved[group.title]);
    const id = "glass-sub-" + slug(group.title);
    return '<div class="glass-nav-folder' + (open ? ' is-open' : '') + '" data-group="' + esc(group.title) + '"' + (hasActive ? ' data-has-active' : '') + '>' +
      '<button class="glass-nav-folder-btn" type="button" aria-expanded="' + open + '" aria-controls="' + id + '" title="' + esc(group.title) + '">' +
      icon(group.icon) + '<span>' + esc(group.title) + '</span>' + folderBadge(group) + icon("chevron-down") + '</button>' +
      '<div class="glass-nav-sub" id="' + id + '" role="group" aria-label="' + esc(group.title) + '"><div class="glass-nav-sub-inner">' +
      group.items.map(item => '<a class="glass-nav-sublink' + (item.page === current ? ' is-active' : '') + '" href="' + esc(hrefFor(item.href)) + '"' +
        (item.page === current ? ' aria-current="page"' : '') + ' style="--dot:' + esc(item.color || "#8A96A3") + '">' +
        '<span class="glass-dot" aria-hidden="true"></span><span>' + esc(item.label) + '</span>' + itemBadge(item) + '</a>').join("") +
      '</div></div></div>';
  }).join("");
  return flat + (folders ? '<section class="glass-nav-group" aria-label="Workspace"><div class="glass-nav-heading">Workspace</div>' + folders + '</section>' : "");
}

// ---- Sidebar badges: notifications + "needs attention" counts ----
function notificationsItem() {
  return '<button class="glass-nav-link glass-notif-link" type="button" data-glass-notifications aria-haspopup="true" aria-label="Open notifications" title="Notifications">' +
    icon("bell") + '<span>Notifications</span><b class="glass-badge" id="glass-notif-badge" hidden aria-live="polite"></b></button>';
}
function itemBadge(item) {
  return item.attention ? '<b class="glass-badge" data-badge="' + esc(item.attention) + '" hidden></b>' : "";
}
function folderBadge(group) {
  const keys = group.items.map(item => item.attention).filter(Boolean);
  return keys.length ? '<b class="glass-badge glass-badge--folder" data-badge-group="' + esc(group.title) + '" data-keys="' + esc(keys.join(",")) + '" hidden></b>' : "";
}

// Counts of things that need a person's attention, by key. Today: typed-in job-card parts that
// are not in the system yet and still need accounting to price them (shown on Ledger).
const ATTENTION_KEY = "apr-attention-v1";
function setBadge(badge, count, noun) {
  badge.hidden = !(count > 0);
  badge.textContent = count > 99 ? "99+" : String(count || "");
  if (count > 0) badge.setAttribute("aria-label", count + " " + noun + (count === 1 ? "" : "s") + " need" + (count === 1 ? "s" : "") + " attention");
  else badge.removeAttribute("aria-label");
}
function paintAttention(root, counts) {
  root.querySelectorAll("[data-badge]").forEach(badge => setBadge(badge, counts[badge.dataset.badge] || 0, "item"));
  root.querySelectorAll("[data-badge-group]").forEach(badge => {
    const total = (badge.dataset.keys || "").split(",").filter(Boolean).reduce((sum, key) => sum + (counts[key] || 0), 0);
    setBadge(badge, total, "item");
  });
}
async function fetchAttention(root) {
  const counts = {};
  // Only accounting / super admin can see Ledger, and only they may call this RPC.
  if (root.querySelector('[data-badge="ledger"]')) {
    const { data, error } = await supabase.rpc("get_unpriced_job_parts");
    if (error) throw error;
    counts.ledger = (data || []).length;
  }
  return counts;
}
function startAttentionBadges(root) {
  if (!root.querySelector("[data-badge]")) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(ATTENTION_KEY) || "null");
    if (saved && saved.role === role() && Date.now() - saved.at < 10 * 60 * 1000) paintAttention(root, saved.counts || {});
  } catch (_) {}
  let busy = false;
  const refresh = async () => {
    if (busy || document.hidden || !navigator.onLine) return;
    busy = true;
    try {
      const counts = await fetchAttention(root);
      paintAttention(root, counts);
      try { sessionStorage.setItem(ATTENTION_KEY, JSON.stringify({ role: role(), at: Date.now(), counts })); } catch (_) {}
    } catch (error) { console.warn("Could not refresh the attention badges:", error.message || error); }
    finally { busy = false; }
  };
  refresh();
  window.setInterval(refresh, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  // Pages call this after they change something that affects a count (e.g. Ledger after pricing a part).
  document.addEventListener("apr:attention-refresh", refresh);
}

// ---- Network strength (replaces the old header theme button) ----
const NET_LEVELS = [
  { max: 250, level: 4, state: "good", label: "Strong" },
  { max: 600, level: 3, state: "good", label: "Good" },
  { max: 1200, level: 2, state: "fair", label: "Fair" },
  { max: Infinity, level: 1, state: "poor", label: "Weak" }
];
function startConnectionMonitor(root) {
  const node = root.querySelector("#glass-connection");
  if (!node) return;
  const label = node.querySelector(".glass-connection-label");
  const paint = (state, level, text, detail) => {
    node.dataset.state = state;
    node.dataset.level = String(level);
    if (label) label.textContent = text;
    const full = detail ? text + " connection · " + detail : text;
    node.title = full;
    node.setAttribute("aria-label", "Network: " + full);
  };
  const probeUrl = new URL(inPages() ? "../index.html" : "index.html", location.href);
  const samples = [];
  let sequence = 0;
  const check = async () => {
    const mine = ++sequence;
    if (!navigator.onLine) { samples.length = 0; paint("offline", 0, "Offline", ""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const started = performance.now();
    try {
      const response = await fetch(probeUrl.href, { method: "HEAD", cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("Probe failed");
      if (mine !== sequence) return;
      samples.push(performance.now() - started);
      if (samples.length > 3) samples.shift();
      // The middle of the last few readings, so one slow request doesn't make the bars jump.
      const ms = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      const band = NET_LEVELS.find(entry => ms < entry.max);
      paint(band.state, band.level, band.label, Math.round(ms) + " ms");
    } catch (_) {
      if (mine === sequence) paint("offline", 0, navigator.onLine ? "No signal" : "Offline", "");
    } finally { window.clearTimeout(timer); }
  };
  check();
  window.setInterval(() => { if (!document.hidden) check(); }, 20000);
  window.addEventListener("online", check);
  window.addEventListener("offline", () => { samples.length = 0; paint("offline", 0, "Offline", ""); });
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

function buildSidebar(current) {
  const groups = navGroups(current);
  const accountName = document.body.dataset.accountName || "Centric Auto User";
  const accountRole = (role() || "staff").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return '<aside class="glass-sidebar" id="glass-sidebar" aria-label="Main navigation">' +
    '<div class="glass-sidebar-brand"><span class="glass-brand-mark">C</span><span class="glass-brand-name">Centric Auto</span>' +
    '<button class="glass-icon-button glass-sidebar-close" type="button" aria-label="Close navigation">' + icon("x") + '</button></div>' +
    '<nav class="glass-sidebar-nav">' + groups + '</nav>' +
    '<div class="glass-profile-wrap"><button class="glass-profile" type="button" aria-expanded="false" aria-controls="glass-profile-menu">' +
    '<span class="glass-avatar">' + esc(initials(accountName)) + '</span><span class="glass-profile-copy"><strong>' + esc(accountName) +
    '</strong><small>' + esc(accountRole) + '</small></span>' + icon("chevron-down") + '</button>' +
    '<div class="glass-profile-menu" id="glass-profile-menu" hidden><a href="' + esc(hrefFor("pages/settings.html")) + '">' + icon("settings") + 'Settings</a>' +
    '<button type="button" data-glass-theme aria-label="Switch theme"></button>' +
    '<button type="button" data-glass-signout>' + icon("log-out") + 'Sign out</button></div></div></aside>';
}

function buildHeader() {
  return '<header class="glass-header" id="glass-header">' +
    '<button class="glass-icon-button glass-menu-toggle" type="button" aria-label="Toggle navigation" aria-controls="glass-sidebar" aria-expanded="true">' + icon("panel-left") + '</button>' +
    '<div class="glass-header-brand"><span class="glass-brand-mark">C</span><strong>Centric Auto</strong></div>' +
    '<div class="glass-search hs" id="hs"><i data-lucide="search" aria-hidden="true"></i><input id="hs-input" type="search" placeholder="Search jobs, customers, parts..." autocomplete="off" aria-label="Search the system"><kbd>/</kbd>' +
    '<div class="hs-panel" id="hs-panel" hidden><div class="hs-chips" id="hs-chips" role="group" aria-label="Search categories"></div><div id="hs-results" aria-live="polite"></div></div></div>' +
    '<div class="glass-header-actions"><a class="glass-job-action" href="' + esc(hrefFor("pages/repairs.html")) + '?new=1">' + icon("plus") + '<span>Job Card</span></a>' +
    '<a class="glass-icon-button glass-shop-action" href="' + esc(hrefFor("pages/shop.html")) + '" aria-label="Open shop" title="Shop">' + icon("shopping-cart") + '</a>' +
    '<span class="glass-connection" id="glass-connection" role="status" aria-live="polite" data-state="checking" data-level="0" aria-label="Network: checking" title="Checking connection">' +
    '<span class="glass-connection-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><small class="glass-connection-label">Checking</small></span></div></header>';
}


/* ---- Keep the header and sidebar from reloading between pages ----
   The finished shell is saved for this tab. The next page puts that copy back before the first paint
   (see js/theme.js), then this module just wires it up instead of rebuilding it. */
const CACHE_PREFIX = "apr-shell2:";
const canon = html => String(html)
  .replace(/ is-active/g, "").replace(/ is-open/g, "").replace(/ data-has-active/g, "")
  .replace(/ aria-current="page"/g, "").replace(/ aria-expanded="(true|false)"/g, "")
  .replace(/href="([^"]*)"/g, (m, h) => {
    try { return 'href="' + new URL(h.replace(/&amp;/g, "&"), location.href).href + '"'; } catch (_) { return m; }
  });
const themeName = () => document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
const normPath = p => { p = String(p).replace(/\.html$/i, "").replace(/\/+$/, ""); return p.replace(/\/index$/, "") || "/"; };
const samePath = (a, b) => normPath(a) === normPath(b);

function markActive(root) {
  root.querySelectorAll("a.glass-nav-link, a.glass-nav-sublink").forEach(a => {
    let on = false;
    try { on = samePath(new URL(a.getAttribute("href"), location.href).pathname, location.pathname); } catch (_) {}
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  syncGroups(root);
}

// The marker lives on the page you are on. If its folder is closed (or the rail hides it) the folder carries it instead.
function syncGroups(root) {
  const saved = savedGroups();
  root.querySelectorAll(".glass-nav-folder").forEach(folder => {
    const hasActive = !!folder.querySelector("a.is-active");
    folder.toggleAttribute("data-has-active", hasActive);
    const title = folder.getAttribute("data-group");
    const open = hasActive || (saved[title] !== undefined && !!saved[title]);
    folder.classList.toggle("is-open", open);
    folder.querySelector(".glass-nav-folder-btn")?.setAttribute("aria-expanded", String(open));
  });
}

function cacheShell(root, sig) {
  try {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("a[href]").forEach(a => a.setAttribute("href", new URL(a.getAttribute("href"), location.href).href));
    clone.querySelectorAll(".is-active").forEach(a => a.classList.remove("is-active"));
    clone.querySelectorAll("[data-has-active]").forEach(a => a.removeAttribute("data-has-active"));
    clone.querySelectorAll("[aria-current]").forEach(a => a.removeAttribute("aria-current"));
    clone.querySelectorAll("#global-notif-bell, #global-notif-panel").forEach(n => n.remove());
    clone.querySelectorAll(".glass-badge").forEach(n => { n.hidden = true; n.textContent = ""; n.removeAttribute("aria-label"); });
    const net = clone.querySelector("#glass-connection");
    if (net) { net.dataset.state = "checking"; net.dataset.level = "0"; net.title = "Checking connection"; net.setAttribute("aria-label", "Network: checking"); const l = net.querySelector(".glass-connection-label"); if (l) l.textContent = "Checking"; }
    clone.querySelectorAll("#glass-profile-menu, #hs-panel").forEach(n => n.setAttribute("hidden", ""));
    clone.querySelectorAll("[aria-expanded]:not(.glass-nav-folder-btn)").forEach(n => n.setAttribute("aria-expanded", "false"));
    clone.removeAttribute("data-cached");
    sessionStorage.setItem(CACHE_PREFIX + themeName(), JSON.stringify({ sig, html: clone.innerHTML }));
  } catch (_) {}
}

function clearShellCache() {
  try {
    Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => sessionStorage.removeItem(k));
  } catch (_) {}
}

function bindShell(root) {
  const sidebar = root.querySelector("#glass-sidebar");
  const header = root.querySelector("#glass-header");
  const toggle = header.querySelector(".glass-menu-toggle");
  const backdrop = root.querySelector(".glass-sidebar-backdrop");
  const mobile = () => matchMedia("(max-width: 900px)").matches;
  const setCollapsed = collapsed => {
    document.body.classList.toggle("glass-sidebar-collapsed", collapsed && !mobile());
    document.body.classList.toggle("glass-drawer-open", !collapsed && mobile());
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (!mobile()) {
      try { localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded"); } catch (_) {}
    }
  };
  let saved = "expanded";
  try { saved = localStorage.getItem(KEY) || "expanded"; } catch (_) {}
  if (mobile()) {
    document.body.classList.remove("glass-sidebar-collapsed", "glass-drawer-open");
    toggle.setAttribute("aria-expanded", "false");
  } else {
    setCollapsed(mobile() ? true : saved === "collapsed");
  }
  toggle.addEventListener("click", () => {
    if (mobile()) setCollapsed(document.body.classList.contains("glass-drawer-open"));
    else setCollapsed(!document.body.classList.contains("glass-sidebar-collapsed"));
  });
  sidebar.querySelector(".glass-sidebar-close").addEventListener("click", () => setCollapsed(true));
  backdrop.addEventListener("click", () => setCollapsed(true));
  sidebar.querySelectorAll("a.glass-nav-link, a.glass-nav-sublink").forEach(a => a.addEventListener("click", () => { if (mobile()) setCollapsed(true); }));
  // Folder buttons toggle their group. On the narrow rail there is no room for the links, so a folder opens the full sidebar first.
  sidebar.querySelectorAll(".glass-nav-folder-btn").forEach(button => button.addEventListener("click", () => {
    const folder = button.closest(".glass-nav-folder");
    const title = folder.getAttribute("data-group");
    if (document.body.classList.contains("glass-sidebar-collapsed")) {
      saveGroup(title, true);
      syncGroups(root);
      setCollapsed(false);
      return;
    }
    const hasActivePage = folder.hasAttribute("data-has-active");
    const open = hasActivePage || !folder.classList.contains("is-open");
    saveGroup(title, open);
    folder.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
  }));
  syncGroups(root);
  window.addEventListener("resize", () => {
    if (!mobile()) {
      document.body.classList.remove("glass-drawer-open");
      let preference = "expanded";
      try { preference = localStorage.getItem(KEY) || "expanded"; } catch (_) {}
      setCollapsed(preference === "collapsed");
    } else {
      document.body.classList.remove("glass-sidebar-collapsed", "glass-drawer-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  const profile = sidebar.querySelector(".glass-profile");
  const profileMenu = sidebar.querySelector("#glass-profile-menu");
  profile.addEventListener("click", () => {
    const open = profileMenu.hidden;
    profileMenu.hidden = !open;
    profile.setAttribute("aria-expanded", String(open));
  });
  sidebar.querySelector("[data-glass-signout]").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    clearShellCache();
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      location.replace(inPages() ? "../login.html" : "login.html");
    } catch (error) {
      console.error("Sign out failed:", error);
      alert("Could not sign out. Please try again.");
      button.disabled = false;
    }
  });

  // Theme switch now lives in the profile menu.
  const themeItem = sidebar.querySelector("[data-glass-theme]");
  const paintThemeItem = () => {
    if (!themeItem) return;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    themeItem.innerHTML = icon(dark ? "sun" : "moon") + (dark ? "Switch to light mode" : "Switch to dark mode");
    themeItem.title = dark ? "Switch to light mode" : "Switch to dark mode";
    if (window.lucide) window.lucide.createIcons();
  };
  paintThemeItem();
  window.addEventListener("apr:theme-changed", paintThemeItem);
  themeItem?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem("apr-theme", next); } catch (_) {}
    window.dispatchEvent(new CustomEvent("apr:theme-changed", { detail: { mode: next } }));
  });

  // Notifications now open from the sidebar. js/notifications.js owns the data and the panel.
  const notifLink = sidebar.querySelector("[data-glass-notifications]");
  notifLink?.addEventListener("click", () => {
    if (mobile()) setCollapsed(true);
    document.dispatchEvent(new CustomEvent("apr:open-notifications", { detail: { anchor: notifLink, toggle: true } }));
  });

  if (root.dataset.monitorsBound !== "true") {
    root.dataset.monitorsBound = "true";
    startConnectionMonitor(root);
    startAttentionBadges(root);
  }

  // dashboard-search.js is loaded by each dashboard page and binds to #hs-input.
  if (window.lucide) window.lucide.createIcons();
}

export function initializeGlassAppShell() {
  if (!document.body?.classList.contains("dashboard-page")) return;
  const existing = document.getElementById("glass-app-chrome");
  if (existing && !existing.dataset.cached && document.getElementById("glass-sidebar") && document.getElementById("glass-header")) return;
  document.body.classList.add("glass-app-shell");
  const current = page();
  const sig = canon(buildHeader() + navGroups(current));
  let root = existing;
  if (root && root.dataset.cached && root.dataset.sig === sig && root.querySelector("#glass-sidebar") && root.querySelector("#glass-header")) {
    // The shell was already painted from the saved copy: keep those elements, just wire them up.
    root.removeAttribute("data-cached");
    markActive(root);
  } else {
    root = document.createElement("div");
    root.id = "glass-app-chrome";
    root.innerHTML = buildHeader() + buildSidebar(current) +
      '<button class="glass-sidebar-backdrop" type="button" aria-label="Close navigation"></button>';
    if (existing) existing.replaceWith(root); else document.body.prepend(root);
  }
  root.dataset.sig = sig;
  bindShell(root);
  if (window.lucide) window.lucide.createIcons();
  cacheShell(root, sig);
  window.__centricPaintNotifBadge?.();
  document.dispatchEvent(new Event("apr:shell-ready"));
  // Resolve the signed-in account label from Supabase without blocking shell rendering.
  supabase.auth.getUser().then(({ data }) => {
    const user = data?.user;
    if (!user) return;
    const name = document.body.dataset.accountName || user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Centric Auto User";
    const profile = root.querySelector(".glass-profile-copy strong");
    const avatar = root.querySelector(".glass-avatar");
    if (profile) profile.textContent = name;
    if (avatar && !avatar.querySelector("img")) avatar.textContent = initials(name);
    const image = user.user_metadata?.avatar_url || user.user_metadata?.picture;
    if (image && avatar) {
      const photo = document.createElement("img");
      photo.src = image; photo.alt = ""; photo.referrerPolicy = "no-referrer";
      photo.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit";
      avatar.textContent = ""; avatar.append(photo);
    }
    cacheShell(root, sig);
  }).catch(error => console.warn("Profile details unavailable:", error));
}
