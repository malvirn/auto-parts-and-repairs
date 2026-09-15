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
  "accounting.html": ["super_admin", "accounting"],
  "ledger.html": ["super_admin", "accounting"],
  "payables.html": ["super_admin", "accounting"],
  "cashbook.html": ["super_admin", "accounting"],
  "commissions.html": ["super_admin", "accounting"],
  "landed-cost.html": ["super_admin", "accounting"],
  "fixed-assets.html": ["super_admin", "accounting"],
  "financial-statements.html": ["super_admin", "accounting"],
  "technicians.html": ["super_admin"], // salary/bank data — super_admin only, matches the RLS refinement
  "customers.html": ["super_admin", "staff"], // accounting has no legitimate reason to see customer PII
};

function basename(href) {
  return href.split("/").pop().split("?")[0].split("#")[0];
}

async function getMyRole(userId) {
  const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) {
    console.error("Unable to load role — defaulting to the most restrictive tier (staff):", error);
    return "staff";
  }
  return data?.role || "staff";
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

  // If the CURRENT page itself isn't allowed for this role, don't wait
  // for a confused click-around — redirect immediately.
  const currentPage = basename(path);
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
  const role = await getMyRole(user.id);
  applyAccess(role);
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

export { applyAccess, getMyRole };