import supabase from "./supabaseClient.js";
import { initNetworkStatus } from "./network-status.js?v=icon-only-network-20261123";

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
    { label: "Ledger", href: "pages/ledger.html", color: "#FB7185", page: "ledger", roles: ["super_admin","accounting"] },
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
    '</section>').join("");
  const folders = visible.filter(group => group.icon).map(group => {
    const hasActive = group.items.some(item => item.page === current);
    const open = hasActive || (saved[group.title] !== undefined && !!saved[group.title]);
    const id = "glass-sub-" + slug(group.title);
    return '<div class="glass-nav-folder' + (open ? ' is-open' : '') + '" data-group="' + esc(group.title) + '"' + (hasActive ? ' data-has-active' : '') + '>' +
      '<button class="glass-nav-folder-btn" type="button" aria-expanded="' + open + '" aria-controls="' + id + '" title="' + esc(group.title) + '">' +
      icon(group.icon) + '<span>' + esc(group.title) + '</span>' + icon("chevron-down") + '</button>' +
      '<div class="glass-nav-sub" id="' + id + '" role="group" aria-label="' + esc(group.title) + '"><div class="glass-nav-sub-inner">' +
      group.items.map(item => '<a class="glass-nav-sublink' + (item.page === current ? ' is-active' : '') + '" href="' + esc(hrefFor(item.href)) + '"' +
        (item.page === current ? ' aria-current="page"' : '') + ' style="--dot:' + esc(item.color || "#8A96A3") + '">' +
        '<span class="glass-dot" aria-hidden="true"></span><span>' + esc(item.label) + '</span></a>').join("") +
      '</div></div></div>';
  }).join("");
  const alerts = '<section class="glass-nav-group" aria-label="Alerts"><button class="glass-nav-link glass-notif-link" type="button" data-open-notifications title="Notifications">' +
    icon("bell") + '<span>Notifications</span><span class="glass-nav-badge" data-attn-total hidden></span></button></section>';
  return alerts + flat + (folders ? '<section class="glass-nav-group" aria-label="Workspace"><div class="glass-nav-heading">Workspace</div>' + folders + '</section>' : "");
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
    '<button class="glass-icon-button theme-toggle" type="button" aria-label="Switch theme" title="Switch theme"></button>' +
    '<div class="glass-notification-slot" id="glass-network-slot"><button class="glass-net" id="glass-net" type="button" data-level="" aria-label="Network strength" title="Checking connection…"><span class="glass-net-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button></div></div></header>';
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

const pageOf = href => { try { return new URL(href, location.href).pathname.split("/").pop().replace(/\.html$/i, "") || "index"; } catch (_) { return ""; } };
const badgeText = n => (n > 9 ? "9+" : String(n));

// Shows how many things need attention on each page next to its sidebar link (and on a collapsed folder).
function applyAttention(root, detail) {
  if (!root) return;
  const counts = (detail && detail.counts) || {};
  root.querySelectorAll(".glass-nav-badge[data-attn-page], .glass-nav-badge[data-attn-folder]").forEach(n => n.remove());
  const make = (n, attr) => {
    const b = document.createElement("span");
    b.className = "glass-nav-badge"; b.setAttribute(attr, "");
    b.textContent = badgeText(n);
    b.title = n + (n === 1 ? " item needs attention" : " items need attention");
    return b;
  };
  root.querySelectorAll("a.glass-nav-link, a.glass-nav-sublink").forEach(a => {
    const n = counts[pageOf(a.getAttribute("href"))] || 0;
    a.toggleAttribute("data-attention", n > 0);
    if (n) a.append(make(n, "data-attn-page"));
  });
  root.querySelectorAll(".glass-nav-folder").forEach(folder => {
    let n = 0;
    folder.querySelectorAll("a.glass-nav-sublink").forEach(a => { n += counts[pageOf(a.getAttribute("href"))] || 0; });
    folder.toggleAttribute("data-attention", n > 0);
    const btn = folder.querySelector(".glass-nav-folder-btn");
    if (btn && n) btn.append(make(n, "data-attn-folder"));
  });
  const total = root.querySelector("[data-attn-total]");
  if (total) { const u = (detail && detail.unread) || 0; total.hidden = !u; total.textContent = u ? badgeText(u) : ""; }
}
window.addEventListener("apr:attention-change", event => applyAttention(document.getElementById("glass-app-chrome"), event.detail));

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
    clone.querySelectorAll(".glass-nav-badge[data-attn-page], .glass-nav-badge[data-attn-folder]").forEach(n => n.remove());
    clone.querySelectorAll("[data-attention]").forEach(n => n.removeAttribute("data-attention"));
    clone.querySelectorAll("[data-attn-total]").forEach(n => { n.hidden = true; n.textContent = ""; });
    clone.querySelectorAll("#hs-input").forEach(n => { n.removeAttribute("data-search-bound"); n.removeAttribute("value"); });
    clone.querySelectorAll("#hs-chips, #hs-results").forEach(n => { n.innerHTML = ""; });
    clone.querySelectorAll("#glass-net").forEach(n => { n.removeAttribute("data-bound"); n.dataset.level = ""; });
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

  header.querySelector(".theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("apr-theme", next); } catch (_) {}
    window.dispatchEvent(new CustomEvent("apr:theme-changed", { detail: { mode: next } }));
  });

  // The notification module owns the data; the sidebar entry just opens its panel next to the button.
  root.querySelector("[data-open-notifications]")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new CustomEvent("apr:open-notifications", { detail: { anchor: event.currentTarget, toggle: true } }));
  });
  initNetworkStatus();
  try { applyAttention(root, JSON.parse(sessionStorage.getItem("apr-attention") || "null")); } catch (_) {}

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
