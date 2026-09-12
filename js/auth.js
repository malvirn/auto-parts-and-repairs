import supabase from "./supabaseClient.js";

const path = window.location.pathname.replace(/\\/g, "/");
const isLoginPage = path.endsWith("/login.html");
const loginPath = path.includes("/pages/") ? "../login.html" : "login.html";
const levelTwoRoles = new Set(["admin", "manager", "owner", "staff"]);

async function getAccessProfile(user) {
  const { data, error } = await supabase
    .from("profiles")
    .select("access_level, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Unable to load access profile:", error);
    return { accessLevel: 1, role: "user" };
  }

  const accessLevel = Number(data?.access_level || 1);
  const role = String(data?.role || "user").toLowerCase();
  return { accessLevel, role };
}

function applyAccess(profile) {
  const hasLevelTwo = profile.accessLevel >= 2 || levelTwoRoles.has(profile.role);
  document.body.dataset.accessLevel = String(profile.accessLevel);
  document.body.dataset.role = profile.role;

  document.querySelectorAll("[data-level=\"2\"]").forEach(element => {
    if (!hasLevelTwo) element.remove();
  });

  if (!hasLevelTwo && ["receipts.html", "technicians.html", "shop.html", "suppliers.html", "quotations.html"].some(page => path.endsWith(`/pages/${page}`))) {
    window.location.replace("../index.html");
  }
}

async function protectPage() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.replace(loginPath);
    return;
  }
  applyAccess(await getAccessProfile(session.user));
}

if (!isLoginPage) {
  protectPage();
}

export { applyAccess, getAccessProfile };
