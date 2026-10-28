const primaryLinks = [
  { href: "index.html", page: "index", label: "Home", icon: "house" },
  { href: "customers.html", page: "customers", label: "Customers", icon: "users" },
  { href: "quotations.html", page: "quotations", label: "Quotations", icon: "file-text" },
  { href: "repairs.html", page: "repairs", label: "Work Orders", icon: "wrench" },
];

const fallbackModules = [
  ["repairs.html", "Work Orders", "wrench"],
  ["customers.html", "Customers", "users"],
  ["technicians.html", "Employees & Staff", "hard-hat"],
  ["shop.html", "Parts & Stock", "store"],
  ["quotations.html", "Quotations", "file-text"],
  ["receipts.html", "Invoices & Receipts", "receipt"],
  ["suppliers.html", "Suppliers", "truck"],
  ["accounting.html", "Accounting Overview", "landmark"],
  ["ledger.html", "Ledger", "book-open-check"],
  ["payables.html", "Payables", "banknote"],
  ["cashbook.html", "Cash Book", "wallet"],
  ["commissions.html", "Commissions", "percent"],
  ["landed-cost.html", "Landed Cost", "ship"],
  ["fixed-assets.html", "Fixed Assets", "wrench"],
  ["financial-statements.html", "Statements", "file-bar-chart"],
  ["analytics.html", "Analytics", "bar-chart-3"],
  ["settings.html", "Settings", "settings"],
];

function makeIcon(iconName) {
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", iconName);
  return icon;
}

function buildPrimaryLink(link, currentFile) {
  const item = document.createElement(link.search ? "button" : "a");
  if (link.href) item.href = link.page === "index"
    ? (currentFile === "index" ? "index.html" : "../index.html")
    : (currentFile === "index" ? `pages/${link.href}` : link.href);
  item.append(makeIcon(link.icon), document.createElement("span"));
  item.lastElementChild.textContent = link.label;
  if (link.page === currentFile) item.setAttribute("aria-current", "page");
  return item;
}

function pageName(path) {
  return path.split(/[?#]/, 1)[0].split("/").pop().replace(/\.html$/i, "");
}

function initializePageChrome() {
  if (!document.body.classList.contains("dashboard-page")) return;

  const main = document.querySelector(".dashboard-page .main");
  if (!main) return;

  if (!main.querySelector(":scope > .site-masthead, :scope > .app-header")) {
    const header = document.createElement("header");
    header.className = "site-masthead";

    const brand = document.createElement("div");
    brand.className = "site-masthead__brand";

    const logo = document.createElement("img");
    logo.className = "site-masthead__logo";
    logo.src = "../assets/logo.png";
    logo.alt = "Centric Auto Mobile";

    const divider = document.createElement("span");
    divider.className = "site-masthead__divider";
    divider.setAttribute("aria-hidden", "true");

    const identity = document.createElement("div");
    const name = document.createElement("p");
    name.className = "site-masthead__name";
    name.textContent = "Centric Auto Mobile";

    const tagline = document.createElement("p");
    tagline.className = "site-masthead__tagline";
    tagline.textContent = "Auto Parts & Repairs";

    identity.append(name, tagline);
    brand.append(logo, divider, identity);
    const status = document.createElement("div");
    status.className = "site-masthead__status";

    const date = document.createElement("time");
    date.className = "site-masthead__date";

    const clock = document.createElement("time");
    clock.className = "site-masthead__clock";

    const updateTime = () => {
      const now = new Date();
      date.textContent = now.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      date.dateTime = now.toISOString();
      clock.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
      clock.dateTime = now.toISOString();
    };
    updateTime();
    window.setInterval(updateTime, 1000);

    status.append(date, clock);
    header.append(brand, status);
    main.insertBefore(header, main.firstChild);
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
}

function initializeNavigation() {
  initializePageChrome();

  const sidebar = document.querySelector("body.dashboard-page .sidebar");
  if (!sidebar) return;
  document.querySelectorAll(".tabbar, .bottom-nav, .sidebar-toggle, .sidebar-backdrop, .dots-btn, .apr-header-menu, .menu-scrim").forEach(element => element.remove());
  document.querySelector(".apr-bottom-nav")?.remove();
  document.body.classList.remove("sidebar-open", "menu-open");

  const currentFile = pageName(window.location.pathname);
  let sidebarLinks = [...sidebar.querySelectorAll("a.nav-link")];
  if (!sidebarLinks.length) {
    const role = document.body.dataset.role || "staff";
    const restrictedModules = {
      technicians: ["super_admin"],
      accounting: ["super_admin", "accounting"],
      ledger: ["super_admin", "accounting"],
      payables: ["super_admin", "accounting"],
      cashbook: ["super_admin", "accounting"],
      commissions: ["super_admin", "accounting"],
      "landed-cost": ["super_admin", "accounting"],
      "fixed-assets": ["super_admin", "accounting"],
      "financial-statements": ["super_admin", "accounting"],
      customers: ["super_admin", "staff"],
      repairs: ["super_admin", "staff"],
      suppliers: ["super_admin", "staff"],
      analytics: ["super_admin", "accounting"],
    };
    sidebarLinks = fallbackModules.map(([href, label, icon]) => {
      const targetPage = pageName(href);
      const allowedRoles = restrictedModules[targetPage];
      if (allowedRoles && !allowedRoles.includes(role)) return null;
      const link = document.createElement("a");
      link.href = currentFile === "index" ? `pages/${href}` : href;
      link.append(makeIcon(icon), document.createTextNode(label));
      return link;
    }).filter(Boolean);
  }
  sidebar.querySelectorAll(".apr-drawer-head, .drawer-head").forEach(element => element.remove());

  const nav = document.createElement("nav");
  nav.className = "apr-bottom-nav";
  nav.setAttribute("aria-label", "Main navigation");
  primaryLinks.forEach(link => nav.append(buildPrimaryLink(link, currentFile)));
  const primaryPages = new Set(primaryLinks.map(link => link.page));
  const moreWrap = document.createElement("div");
  moreWrap.className = "apr-more-wrap";
  const moreButton = document.createElement("button");
  moreButton.type = "button";
  moreButton.className = "apr-more-toggle";
  moreButton.setAttribute("aria-expanded", "false");
  moreButton.setAttribute("aria-haspopup", "true");
  moreButton.append(makeIcon("ellipsis"), document.createElement("span"));
  moreButton.lastElementChild.textContent = "More";
  const moreMenu = document.createElement("div");
  moreMenu.className = "apr-more-menu";
  moreMenu.setAttribute("aria-label", "More modules");
  moreMenu.hidden = true;

  const seenPages = new Set(primaryPages);
  let currentIsMore = false;
  sidebarLinks.forEach(link => {
    const targetPage = pageName(new URL(link.href, window.location.href).pathname);
    if (!targetPage || seenPages.has(targetPage)) return;
    seenPages.add(targetPage);
    const item = document.createElement("a");
    item.href = link.href;
    item.append(makeIcon(link.querySelector("[data-lucide]")?.getAttribute("data-lucide") || "circle"), document.createTextNode(link.textContent.trim()));
    if (targetPage === currentFile) {
      item.setAttribute("aria-current", "page");
      currentIsMore = true;
    }
    moreMenu.append(item);
  });

  if (currentIsMore) moreButton.setAttribute("aria-current", "page");
  moreWrap.append(moreButton, moreMenu);
  nav.append(moreWrap);

  const closeMoreMenu = ({ restoreFocus = false } = {}) => {
    moreMenu.classList.remove("open");
    moreMenu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) moreButton.focus({ preventScroll: true });
  };
  moreButton.addEventListener("click", () => {
    const open = moreMenu.hidden;
    moreMenu.hidden = !open;
    moreMenu.classList.toggle("open", open);
    moreButton.setAttribute("aria-expanded", String(open));
    if (open) moreMenu.querySelector("a")?.focus({ preventScroll: true });
  });
  document.addEventListener("click", event => {
    if (!moreWrap.contains(event.target)) closeMoreMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !moreMenu.hidden) closeMoreMenu({ restoreFocus: true });
  });

  document.body.append(nav);
  sidebar.inert = true;
  if (window.lucide) window.lucide.createIcons();
}

function initializeAfterAccess() {
  if (document.body.dataset.role) {
    initializeNavigation();
    return;
  }
  document.addEventListener("apr:access-ready", initializeNavigation, { once: true });
}

initializePageChrome();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAfterAccess, { once: true });
} else {
  initializeAfterAccess();
}
