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

function normalizeRole(role) {
  const normalized = String(role || "staff").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "superadmin" ? "super_admin" : normalized;
}

async function getMyProfile(userId) {
  const { data, error } = await supabase.from("profiles")
    .select("role, access_level")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("Unable to load the account role — defaulting to the most restrictive tier (staff):", error);
    return { role: "staff", is_active: true };
  }

  let is_active = true;
  const { data: activeData, error: activeError } = await supabase.from("profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();
  if (activeError) {
    console.warn("Unable to check whether the account is active; profile role was loaded successfully:", activeError);
  } else {
    is_active = activeData?.is_active !== false;
  }
  const normalizedRole = normalizeRole(data?.role);
  const role = Number(data?.access_level) >= 2 ? "super_admin" : normalizedRole;
  return { role, is_active };
}

function applyAccess(role) {
  role = normalizeRole(role);
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

  document.dispatchEvent(new Event("apr:access-ready"));

  // Only NOW is it confirmed this role is actually allowed on this exact
  // page — reveal it. Every earlier return in this function leaves the
  // page hidden on purpose, because a redirect is about to happen.
  revealPage();
}

function createLoadingSkeleton() {
  const main = document.querySelector("body.dashboard-page .main");
  if (!main || main.querySelector(":scope > .auth-skeleton")) return;

  const skeleton = document.createElement("section");
  skeleton.className = "auth-skeleton";
  skeleton.setAttribute("aria-label", "Loading page content");
  skeleton.setAttribute("role", "status");

  for (let index = 0; index < 4; index += 1) {
    const card = document.createElement("div");
    card.className = "auth-skeleton__card";
    if (index === 3) card.classList.add("auth-skeleton__card--wide");

    const heading = document.createElement("span");
    heading.className = "auth-skeleton__bar auth-skeleton__bar--heading";
    const value = document.createElement("span");
    value.className = "auth-skeleton__bar auth-skeleton__bar--value";
    const detail = document.createElement("span");
    detail.className = "auth-skeleton__bar auth-skeleton__bar--detail";
    const footer = document.createElement("span");
    footer.className = "auth-skeleton__bar auth-skeleton__bar--footer";

    card.append(heading, value, detail, footer);
    skeleton.append(card);
  }

  const header = main.querySelector(":scope > .app-header, :scope > .main__header, :scope > .dashboard-hero, :scope > .site-masthead");
  if (header) header.after(skeleton);
  else main.prepend(skeleton);
  main.setAttribute("aria-busy", "true");
}

function hidePage() {
  document.documentElement.style.visibility = "";
  document.body.classList.add("auth-loading");
  createLoadingSkeleton();

  if (!document.getElementById("auth-gate-style")) {
    const style = document.createElement("style");
    style.id = "auth-gate-style";
    style.textContent = `
      body.auth-loading .main > :not(.app-header):not(.main__header):not(.dashboard-hero):not(.site-masthead):not(.site-foot):not(.auth-skeleton) {
        display: none !important;
      }
      body.auth-loading .auth-skeleton {
        display: grid;
        width: min(1080px, calc(100% - 2 * clamp(14px, 4vw, 28px)));
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        margin: 0 auto 30px;
      }
      body.auth-loading .auth-skeleton__card {
        display: grid;
        min-height: 148px;
        align-content: start;
        gap: 17px;
        padding: 20px;
        border: 1px solid rgba(31, 196, 103, .2);
        border-radius: 18px;
        background: linear-gradient(155deg, #111b18, #0c1210);
      }
      body.auth-loading .auth-skeleton__card--wide { grid-column: 1 / -1; min-height: 190px; }
      body.auth-loading .auth-skeleton__bar {
        display: block;
        height: 12px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(159, 176, 166, .08), rgba(159, 176, 166, .2), rgba(159, 176, 166, .08));
        background-size: 220% 100%;
        animation: auth-skeleton-shimmer 1.4s ease-in-out infinite;
      }
      body.auth-loading .auth-skeleton__bar--heading { width: 42%; }
      body.auth-loading .auth-skeleton__bar--value { width: 66%; height: 24px; }
      body.auth-loading .auth-skeleton__bar--detail { width: 86%; }
      body.auth-loading .auth-skeleton__bar--footer { width: 54%; }
      @keyframes auth-skeleton-shimmer { to { background-position: -220% 0; } }
      @media (max-width: 700px) {
        body.auth-loading .auth-skeleton { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        body.auth-loading .auth-skeleton__card { min-height: 132px; padding: 16px; }
      }
      @media (max-width: 420px) {
        body.auth-loading .auth-skeleton { grid-template-columns: minmax(0, 1fr); }
        body.auth-loading .auth-skeleton__card--wide { grid-column: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        body.auth-loading .auth-skeleton__bar { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }
}

function revealPage() {
  document.body.classList.remove("auth-loading");
  document.querySelector("body.dashboard-page .main")?.removeAttribute("aria-busy");
  document.querySelector(".auth-skeleton")?.remove();
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
