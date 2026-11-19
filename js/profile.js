import supabase from "./supabaseClient.js";

const PROFILE_TIMEOUT_MS = 8000;
const PROFILE_CACHE_PREFIX = "apr-profile-cache:";

function withTimeout(promise, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${PROFILE_TIMEOUT_MS / 1000} seconds`)), PROFILE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function normalizeRole(role) {
  const normalized = String(role || "staff").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "superadmin" ? "super_admin" : normalized;
}

export async function loadUserProfile(userId) {
  const roleRequest = supabase.from("profiles")
    .select("role, full_name, access_level")
    .eq("id", userId)
    .maybeSingle();
  const activeRequest = supabase.from("profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  const [roleResult, activeResult] = await Promise.allSettled([
    withTimeout(roleRequest, "Account role lookup"),
    withTimeout(activeRequest, "Account activation lookup"),
  ]);

  if (roleResult.status === "rejected" || roleResult.value.error) {
    const error = roleResult.status === "rejected" ? roleResult.reason : roleResult.value.error;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_PREFIX + userId) || "null"); } catch (_) {}
    if (cached) return { ...cached, offline_cached: true, lookup_failed: true };
    console.error("Unable to load account role; using restricted staff access because no cached profile exists:", error);
    return { role: "staff", lookup_failed: true, full_name: null, is_active: true };
  }

  if (activeResult.status === "rejected" || activeResult.value.error) {
    const error = activeResult.status === "rejected" ? activeResult.reason : activeResult.value.error;
    console.warn("Unable to check whether the account is active; keeping the loaded role:", error);
  }

  const profile = roleResult.value.data;
  const profileRole = normalizeRole(profile?.role);
  const resolved = {
    ...profile,
    role: profileRole === "accounting"
      ? "accounting"
      : Number(profile?.access_level) >= 2 || profileRole === "super_admin"
        ? "super_admin"
        : profileRole,
    is_active: activeResult.status === "fulfilled" && !activeResult.value.error
      ? activeResult.value.data?.is_active !== false
      : true,
  };
  try { localStorage.setItem(PROFILE_CACHE_PREFIX + userId, JSON.stringify(resolved)); } catch (_) {}
  return resolved;
}
