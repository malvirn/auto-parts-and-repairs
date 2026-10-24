import supabase from "./supabaseClient.js";

const path = window.location.pathname.replace(/\\/g, "/");
const isLoginPage = path.endsWith("/login.html") || path.endsWith("login.html");
const inPagesFolder = path.includes("/pages/");
const loginPath = inPagesFolder ? "../login.html" : "login.html";
const dashboardPath = inPagesFolder ? "../index.html" : "index.html";

// ---------- Who can see what ----------
// Keyed by bare filename, checked against the CURRENT page and every
// sidebar link's href — so this works purely by matching URLs, without
// needing a data attribute added to every page. Anything NOT listed here
// is accessible to every logged-in role by default; RLS is still the
// real boundary underneath regardless of what this hides or allows.
const PAGE_ACCESS = {
  "accounting": ["super_admin", "accounting"],
  "ledger": ["super_admin", "accounting"],
  "payables": ["super_admin", "accounting"],
  "cashbook": ["super_admin", "accounting"],
  "commissions": ["super_admin", "accounting"],
  "landed-cost": ["super_admin", "accounting"],
  "fixed-assets": ["super_admin", "accounting"],
  "financial-statements": ["super_admin", "accounting"],
  "technicians": ["super_admin"], // salary/bank data — super_admin only
  "customers": ["super_admin", "staff"], // accounting has no reason to see customer PII
  "repairs": ["super_admin", "staff"], // accounting has no reason to edit repair jobs directly
  "suppliers": ["super_admin", "staff"], // accounting still reads the suppliers TABLE fine (for Payables/Landed Cost dropdowns) — this only hides the management PAGE
  "analytics": ["super_admin", "accounting"], // includes payroll-adjacent figures — staff/mechanics don't see this
};

// Where each role lands instead of the generic dashboard, since "their
// dashboard should only show things related to their department" is best
// served by sending them straight to the hub that's actually theirs.
const DASHBOARD_REDIRECT = {
  accounting: "accounting",
};

// Netlify's "Pretty URLs" post-processing rewrites internal links at
// deploy time — "technicians.html" becomes "/pages/technicians" in the
// actual served HTML, extension stripped, path made absolute. This has
// to match regardless of whether that rewriting is happening or not, so
// it strips a trailing .html if present rather than assuming either form.
function basename(href) {
  if (!href) return "";
  let name = href.split("/").pop().split("?")[0].split("#")[0];
  if (name.endsWith(".html")) name = name.slice(0, -5);
  return name;
}

function addMobileNavigation(currentPage) {
  if (!document.body.classList.contains("system-page") || document.querySelector(".bottom-nav")) return;

  const sidebarLinks = [...document.querySelectorAll(".sidebar a.nav-link")];
  const homeLink = sidebarLinks.find(link => basename(link.getAttribute("href")) === "index");
  const preferredPages = ["customers", "repairs", "shop"];
  const primaryLinks = preferredPages
    .map(page => sidebarLinks.find(link => basename(link.getAttribute("href")) === page))
    .filter(Boolean);
  const menuLinks = sidebarLinks.filter(link => link !== homeLink && !primaryLinks.includes(link));

  while (primaryLinks.length < 3) {
    const nextLink = menuLinks.shift();
    if (!nextLink) break;
    primaryLinks.push(nextLink);
  }

  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Main navigation");

  const createNavLink = (source, label) => {
    const link = document.createElement("a");
    link.href = source.getAttribute("href");
    link.className = "bottom-nav__item";
    for (const attribute of source.attributes) {
      if (attribute.name.startsWith("data-")) link.setAttribute(attribute.name, attribute.value);
    }

    const icon = source.querySelector("[data-lucide]");
    if (icon) link.append(icon.cloneNode(true));
    const text = document.createElement("span");
    text.textContent = label;
    link.append(text);

    const targetPage = basename(source.getAttribute("href"));
    const onAccountingPage = targetPage === "accounting" && [
      "ledger", "payables", "cashbook", "commissions", "landed-cost", "fixed-assets", "financial-statements",
    ].includes(currentPage);
    const active = targetPage === currentPage || onAccountingPage;
    if (active) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }
    return link;
  };

  if (homeLink) nav.append(createNavLink(homeLink, "Home"));
  primaryLinks.forEach(source => {
    const page = basename(source.getAttribute("href"));
    const label = page === "customers" ? "Clients"
      : page === "repairs" ? "Work Orders"
        : page === "shop" ? "Parts"
          : source.textContent.trim();
    nav.append(createNavLink(source, label));
  });

  const moreWrap = document.createElement("div");
  moreWrap.className = "more-wrap";
  const moreToggle = document.createElement("button");
  moreToggle.id = "more-toggle";
  moreToggle.className = "bottom-nav__item";
  moreToggle.type = "button";
  moreToggle.setAttribute("aria-expanded", "false");
  moreToggle.setAttribute("aria-controls", "more-menu");
  moreToggle.innerHTML = '<i data-lucide="ellipsis"></i><span>More</span>';
  const moreMenu = document.createElement("div");
  moreMenu.className = "more-menu";
  moreMenu.id = "more-menu";

  menuLinks.forEach(source => {
    const menuLink = source.cloneNode(true);
    menuLink.className = "";
    const targetPage = basename(source.getAttribute("href"));
    const onAccountingPage = targetPage === "accounting" && [
      "ledger", "payables", "cashbook", "commissions", "landed-cost", "fixed-assets", "financial-statements",
    ].includes(currentPage);
    if (targetPage === currentPage || onAccountingPage) {
      menuLink.classList.add("current");
      if (targetPage === currentPage) menuLink.setAttribute("aria-current", "page");
      moreToggle.classList.add("active");
    }
    const pageLabels = {
      receipts: "Invoices & Receipts",
      technicians: "Technicians",
      shop: "Parts Shop",
      analytics: "Workshop Reports",
      accounting: "Accounts",
      suppliers: "Parts Suppliers",
    };
    if (pageLabels[targetPage]) {
      const icon = menuLink.querySelector("[data-lucide]");
      const label = pageLabels[targetPage];
      menuLink.textContent = label;
      if (icon) menuLink.prepend(icon);
    }
    moreMenu.append(menuLink);
  });
  moreWrap.append(moreToggle, moreMenu);
  nav.append(moreWrap);
  document.body.append(nav);

  moreToggle.addEventListener("click", event => {
    event.stopPropagation();
    const isOpen = moreMenu.classList.toggle("open");
    moreToggle.setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".more-wrap")) {
      moreMenu.classList.remove("open");
      moreToggle.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      moreMenu.classList.remove("open");
      moreToggle.setAttribute("aria-expanded", "false");
    }
  });
  if (window.lucide) lucide.createIcons({ root: nav });
}

async function getMyProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
  if (error) {
    console.error("Unable to load profile — defaulting to the most restrictive tier (staff):", error);
    return { role: "staff", is_active: true };
  }
  return { role: data?.role || "staff", is_active: data?.is_active !== false };
}

function applyAccess(role) {
  document.body.dataset.role = role;

  // Hide sidebar links the current role isn't allowed to use — this is a
  // UX nicety (no dead-end clicks into a page that'll just show empty
  // data), not the actual security boundary. That's still RLS.
  document.querySelectorAll(".sidebar a.nav-link").forEach(link => {
    const page = basename(link.getAttribute("href") || "");
    const allowed = PAGE_ACCESS[page];
    if (allowed && !allowed.includes(role)) link.remove();
  });

  const currentPage = basename(path);
  addMobileNavigation(currentPage);

  // Send this role to its own landing page instead of the generic
  // dashboard, if one's defined for them. This only ever fires from the
  // root index.html (that's what isDashboard means), so the target
  // always needs the pages/ prefix — a bare relative path here would
  // resolve against the root, not the pages folder, and 404.
  const isDashboard = currentPage === "index" || currentPage === "index.html" || currentPage === "";
  if (isDashboard && DASHBOARD_REDIRECT[role]) {
    window.location.replace("pages/" + DASHBOARD_REDIRECT[role]);
    return; // stay hidden — a redirect is about to happen
  }

  // If the CURRENT page itself isn't allowed for this role, don't wait
  // for a confused click-around — redirect immediately.
  const allowedHere = PAGE_ACCESS[currentPage];
  if (allowedHere && !allowedHere.includes(role)) {
    window.location.replace(dashboardPath);
    return; // stay hidden — a redirect is about to happen
  }

  // Only NOW is it confirmed this role is actually allowed on this exact
  // page — reveal it. Every earlier return in this function leaves the
  // page hidden on purpose, because a redirect is about to happen.
  revealPage();
}

function hidePage() {
  document.documentElement.style.visibility = "hidden";
  if (document.getElementById("auth-gate-style")) return;
  const style = document.createElement("style");
  style.id = "auth-gate-style";
  style.textContent = "body { visibility: hidden !important; }";
  document.head.appendChild(style);
}

function revealPage() {
  document.documentElement.style.visibility = "";
  document.getElementById("auth-gate-style")?.remove();
}

async function protectPage() {
  // getUser() verifies with Supabase's Auth server, unlike getSession()
  // which only reads local storage without checking whether that session
  // is still actually valid server-side. This matters specifically after
  // an account gets deleted (e.g. a database reset) — a stale local
  // session would otherwise still "look" logged in and load the page.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    window.location.replace(loginPath);
    return;
  }

  const profile = await getMyProfile(user.id);

  if (!profile.is_active) {
    await supabase.auth.signOut();
    window.location.replace(loginPath + (loginPath.includes("?") ? "&" : "?") + "terminated=1");
    return;
  }

  applyAccess(profile.role);
}

if (!isLoginPage) {
  hidePage(); // synchronous, immediate — closes the exposure window as much as possible before the async role check below even starts
  protectPage();

  // Also react to sign-out happening in another tab, and to a token
  // refresh failing silently — without this, a session that dies while
  // the page is just sitting open wouldn't be caught until the next
  // manual navigation.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
      window.location.replace(loginPath);
    }
  });
}

export { applyAccess, getMyProfile };
