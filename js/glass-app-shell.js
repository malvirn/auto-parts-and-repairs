import supabase from "./supabaseClient.js";

const NAV = [
  { title: "Main", items: [{ label: "Home", href: "index.html", icon: "house", page: "index" }] },
  { title: "Workshop", items: [
    { label: "Repairs / Job Cards", href: "pages/repairs.html", icon: "wrench", page: "repairs", roles: ["super_admin","staff"] },
    { label: "Vehicle Checklist", href: "pages/checklist.html", icon: "clipboard-check", page: "checklist" },
    { label: "Technicians", href: "pages/technicians.html", icon: "users", page: "technicians", roles: ["super_admin"] },
    { label: "Commissions", href: "pages/commissions.html", icon: "wallet", page: "commissions", roles: ["super_admin","accounting"] }
  ]},
  { title: "Inventory", items: [
    { label: "Shop / Parts", href: "pages/shop.html", icon: "package", page: "shop" },
    { label: "Suppliers", href: "pages/suppliers.html", icon: "truck", page: "suppliers", roles: ["super_admin","staff"] },
    { label: "Landed Cost", href: "pages/landed-cost.html", icon: "calculator", page: "landed-cost", roles: ["super_admin","accounting"] }
  ]},
  { title: "Finance", items: [
    { label: "Quotations", href: "pages/quotations.html", icon: "file-text", page: "quotations" },
    { label: "Receipts", href: "pages/receipts.html", icon: "receipt", page: "receipts" },
    { label: "Cashbook", href: "pages/cashbook.html", icon: "book-open", page: "cashbook", roles: ["super_admin","accounting"] },
    { label: "Payables", href: "pages/payables.html", icon: "hand-coins", page: "payables", roles: ["super_admin","accounting"] },
    { label: "Ledger", href: "pages/ledger.html", icon: "book-check", page: "ledger", roles: ["super_admin","accounting"] },
    { label: "Accounting", href: "pages/accounting.html", icon: "calculator", page: "accounting", roles: ["super_admin","accounting"] },
    { label: "Fixed Assets", href: "pages/fixed-assets.html", icon: "landmark", page: "fixed-assets", roles: ["super_admin","accounting"] },
    { label: "Financial Statements", href: "pages/financial-statements.html", icon: "chart-no-axes-combined", page: "financial-statements", roles: ["super_admin","accounting"] }
  ]},
  { title: "Intelligence", items: [
    { label: "Centric Intelligence", href: "pages/centric-intelligence.html", icon: "brain-circuit", page: "centric-intelligence", roles: ["super_admin","accounting"] },
    { label: "Analytics", href: "pages/analytics.html", icon: "chart-no-axes-combined", page: "analytics", roles: ["super_admin","accounting"] }
  ]},
  { title: "Administration", items: [
    { label: "Customers", href: "pages/customers.html", icon: "contact-round", page: "customers", roles: ["super_admin","staff"] },
    { label: "Settings", href: "pages/settings.html", icon: "settings", page: "settings" }
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

function buildSidebar(current) {
  const groups = NAV.map(group => {
    const items = group.items.filter(item => !item.roles || item.roles.includes(role()));
    if (!items.length) return "";
    return '<section class="glass-nav-group" aria-label="' + esc(group.title) + '">' +
      '<div class="glass-nav-heading">' + esc(group.title) + '</div>' +
      items.map(item => '<a class="glass-nav-link' + (item.page === current ? ' is-active' : '') + '" href="' + esc(hrefFor(item.href)) + '"' +
        (item.page === current ? ' aria-current="page"' : '') + ' title="' + esc(item.label) + '">' +
        icon(item.icon) + '<span>' + esc(item.label) + '</span></a>').join("") +
      '</section>';
  }).join("");

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
    '<div class="glass-notification-slot" id="glass-notification-slot"></div></div></header>';
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
  sidebar.querySelectorAll("a.glass-nav-link").forEach(a => a.addEventListener("click", () => { if (mobile()) setCollapsed(true); }));
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

  // The existing notification module owns the data and alert behaviour.
  const moveBell = () => {
    const bell = document.getElementById("global-notif-bell");
    if (bell && !header.querySelector("#global-notif-bell")) header.querySelector("#glass-notification-slot").append(bell);
  };
  moveBell();
  const observer = new MutationObserver(moveBell);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });

  // dashboard-search.js is loaded by each dashboard page and binds to #hs-input.
  if (window.lucide) window.lucide.createIcons();
}

export function initializeGlassAppShell() {
  if (!document.body?.classList.contains("dashboard-page")) return;
  if (document.getElementById("glass-sidebar") && document.getElementById("glass-header")) return;
  document.body.classList.add("glass-app-shell");
  const current = page();
  const root = document.createElement("div");
  root.id = "glass-app-chrome";
  root.innerHTML = buildHeader() + buildSidebar(current) +
    '<button class="glass-sidebar-backdrop" type="button" aria-label="Close navigation"></button>';
  document.body.prepend(root);
  bindShell(root);
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
  }).catch(error => console.warn("Profile details unavailable:", error));
  if (window.lucide) window.lucide.createIcons();
}
