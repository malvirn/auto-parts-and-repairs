/* Shared topbar account label. Values come from auth.js applyAccess(). */
export function syncAccountLabel() {
  const nameNode = document.getElementById("dashboard-user-name");
  const roleNode = document.getElementById("dashboard-user-role");
  const avatar = document.getElementById("dashboard-user-avatar");
  if (!nameNode && !roleNode && !avatar) return false;

  const accountName = String(document.body.dataset.accountName || "Account").trim();
  const rawRole = String(document.body.dataset.role || "").trim();
  if (!rawRole) return false;

  const roleName = rawRole.split("_").filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const accessLevel = String(document.body.dataset.accessLevel || "").trim();

  if (nameNode) nameNode.textContent = accountName || "Account";
  if (roleNode) roleNode.textContent = accessLevel
    ? `Access level ${accessLevel} · ${roleName}`
    : `Access · ${roleName}`;
  if (avatar) {
    avatar.textContent = (accountName || "Account").split(/\\s+/)
      .filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "A";
  }
  return true;
}

document.addEventListener("apr:access-ready", syncAccountLabel);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncAccountLabel, { once: true });
} else {
  syncAccountLabel();
}
