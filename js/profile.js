import supabase from "./supabaseClient.js";

const PROFILE_TIMEOUT_MS = 8000;

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
    console.error("Unable to load account role; continuing with the most restrictive staff access:", error);
    return {
      role: "staff",
      lookup_failed: true,
      full_name: null,
      is_active: activeResult.status === "fulfilled" && !activeResult.value.error
        ? activeResult.value.data?.is_active !== false
        : true,
    };
  }

  if (activeResult.status === "rejected" || activeResult.value.error) {
    const error = activeResult.status === "rejected" ? activeResult.reason : activeResult.value.error;
    console.warn("Unable to check whether the account is active; keeping the loaded role:", error);
  }

  const profile = roleResult.value.data;
  const profileRole = normalizeRole(profile?.role);
  return {
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
}
