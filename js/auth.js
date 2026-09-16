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

  // Send this role to its own landing page instead of the generic
  // dashboard, if one's defined for them. This only ever fires from the
  // root index.html (that's what isDashboard means), so the target
  // always needs the pages/ prefix — a bare relative path here would
  // resolve against the root, not the pages folder, and 404.
  const isDashboard = currentPage === "index" || currentPage === "index.html" || currentPage === "";
  if (isDashboard && DASHBOARD_REDIRECT[role]) {
    window.location.replace("pages/" + DASHBOARD_REDIRECT[role]);
    return;
  }

  // If the CURRENT page itself isn't allowed for this role, don't wait
  // for a confused click-around — redirect immediately.
  const allowedHere = PAGE_ACCESS[currentPage];
  if (allowedHere && !allowedHere.includes(role)) {
    window.location.replace(dashboardPath);
  }
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