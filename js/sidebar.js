/* Shared sidebar module. It owns role-filtered link state and keyboard access;
   the navigation bootstrap retains account actions, URLs and open-state behaviour. */
/* Apply the existing verified role rules and active-page state to the
   canonical sidebar. Keep this policy in one place for every module page. */
export function applySidebarAccessRules(sidebar, { role, indexUrl, currentPage, pageName }) {
  if (!sidebar || !indexUrl || typeof pageName !== "function") return;
  const accessByPage = {
    accounting: ["super_admin", "accounting"],
    ledger: ["super_admin", "accounting"],
    payables: ["super_admin", "accounting"],
    cashbook: ["super_admin", "accounting"],
    commissions: ["super_admin", "accounting"],
    "landed-cost": ["super_admin", "accounting"],
    "fixed-assets": ["super_admin", "accounting"],
    "financial-statements": ["super_admin", "accounting"],
    analytics: ["super_admin", "accounting"],
    technicians: ["super_admin"],
    customers: ["super_admin", "staff"],
    checklist: ["super_admin", "staff"],
    repairs: ["super_admin", "staff"],
    suppliers: ["super_admin", "staff"],
  };

  sidebar.querySelectorAll("a.nav-link").forEach(link => {
    const target = new URL(link.getAttribute("href"), indexUrl);
    const targetPage = pageName(target.pathname);
    const allowedRoles = accessByPage[targetPage];
    if (allowedRoles && !allowedRoles.includes(role)) {
      const groupKey = link.closest(".nav-group")?.dataset.group;
      if (groupKey === "accounting") {
        const restrictedLink = document.createElement("span");
        restrictedLink.className = "nav-link nav-link--restricted";
        restrictedLink.setAttribute("aria-disabled", "true");
        restrictedLink.title = "Your account does not have access to this module";
        restrictedLink.innerHTML = link.innerHTML;
        link.replaceWith(restrictedLink);
        return;
      }
      link.remove();
      return;
    }
    link.href = target.pathname + target.search + target.hash;
    const isCurrent = targetPage === currentPage;
    link.classList.toggle("active", isCurrent);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}


function initialiseSidebarAccessibility() {
  const sidebar = document.querySelector('body.dashboard-page .sidebar[data-dashboard-canonical="true"]') ||
    document.querySelector("body.dashboard-home .sidebar");
  if (!sidebar || sidebar.dataset.keyboardReady === "true") return;
  sidebar.dataset.keyboardReady = "true";
  sidebar.querySelectorAll("a.nav-link").forEach(link => {
    const label = link.querySelector("span")?.textContent?.trim() || link.textContent.trim();
    if (label && !link.hasAttribute("title")) link.title = label;
  });

  const getItems = () => [...sidebar.querySelectorAll(
    'a.nav-link:not([aria-disabled="true"]),button.nav-grp,button.sidebar-account__footer, .sidebar-account__footer button'
  )].filter(item => {
    const style = getComputedStyle(item);
    return style.display !== "none" && !item.hidden && item.getClientRects().length > 0;
  });

  sidebar.addEventListener("keydown", event => {
    const items = getItems();
    const current = event.target.closest("a.nav-link,button.nav-grp,.sidebar-account__footer button");
    if (!current || !items.length) return;
    const index = items.indexOf(current);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    }
  });

  document.addEventListener("click", event => {
    if (!event.target.closest("#dashboard-sidebar-toggle") ||
        !document.body.classList.contains("sidebar-open")) return;
    requestAnimationFrame(() => getItems()[0]?.focus({ preventScroll: true }));
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Tab" || !window.matchMedia("(max-width: 1024px)").matches ||
        !document.body.classList.contains("sidebar-open")) return;
    const items = getItems();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !document.body.classList.contains("sidebar-open")) return;
    const toggle = document.getElementById("dashboard-sidebar-toggle");
    document.body.classList.remove("sidebar-open");
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.focus({ preventScroll: true });
  });
}
const sidebarObserver = new MutationObserver(() => {
  const sidebar = document.querySelector('body.dashboard-page .sidebar[data-dashboard-canonical="true"]') ||
    document.querySelector('body.dashboard-home .sidebar');
  if (sidebar && sidebar.dataset.keyboardReady !== "true") initialiseSidebarAccessibility();
});
sidebarObserver.observe(document.documentElement, { childList: true, subtree: true });
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseSidebarAccessibility, { once: true });
} else initialiseSidebarAccessibility();


// Sidebar attention badges are a presentation of the existing global
// notification feed. No notification checks or data requests belong here.
function updateSidebarAttentionBadges(items) {
  if (!Array.isArray(items)) return;
  const sidebar = document.querySelector("body.dashboard-page .sidebar");
  if (!sidebar) return;

  const counts = new Map();
  items.forEach(item => {
    if (!item?.link) return;
    let file;
    try {
      const url = new URL(item.link, document.baseURI);
      file = url.pathname.split("/").filter(Boolean).pop()?.toLowerCase();
    } catch (_) { return; }
    if (!file) return;
    const current = counts.get(file) || { count: 0, critical: false };
    current.count += 1;
    current.critical ||= item.severity === "critical";
    counts.set(file, current);
  });

  const links = [...sidebar.querySelectorAll("a.nav-link")];
  links.forEach(link => {
    let file;
    try { file = new URL(link.getAttribute("href"), document.baseURI).pathname.split("/").filter(Boolean).pop()?.toLowerCase(); }
    catch (_) { return; }
    const state = counts.get(file) || { count: 0, critical: false };
    let badge = link.querySelector(":scope > .nav-badge");
    if (!state.count) {
      badge?.remove();
      link.removeAttribute("aria-label");
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      badge.setAttribute("aria-hidden", "true");
      link.append(badge);
    }
    badge.textContent = state.count > 9 ? "9+" : String(state.count);
    badge.dataset.severity = state.critical ? "critical" : "warning";
    const label = link.dataset.attentionLabel || link.getAttribute("title") ||
      [...link.childNodes].filter(node => !(node.nodeType === 1 && node.classList?.contains("nav-badge")))
        .map(node => node.textContent || "").join(" ").replace(/\\s+/g, " ").trim();
    link.dataset.attentionLabel = label;
    link.setAttribute("aria-label", `${label}, ${state.count} need attention`);
  });

  sidebar.querySelectorAll(".nav-group").forEach(group => {
    const groupLinks = [...group.querySelectorAll("a.nav-link")];
    const total = groupLinks.reduce((sum, link) => {
      let file;
      try { file = new URL(link.getAttribute("href"), document.baseURI).pathname.split("/").filter(Boolean).pop()?.toLowerCase(); }
      catch (_) { return sum; }
      return sum + (counts.get(file)?.count || 0);
    }, 0);
    const hasCritical = groupLinks.some(link => link.querySelector(":scope > .nav-badge")?.dataset.severity === "critical");
    let groupBadge = group.querySelector(":scope > .nav-grp .nav-group-badge");
    if (!total) {
      groupBadge?.remove();
      group.querySelector(":scope > .nav-grp")?.removeAttribute("aria-label");
      return;
    }
    if (!groupBadge) {
      groupBadge = document.createElement("span");
      groupBadge.className = "nav-group-badge";
      groupBadge.setAttribute("aria-hidden", "true");
      group.querySelector(":scope > .nav-grp")?.append(groupBadge);
    }
    groupBadge.textContent = total > 9 ? "9+" : String(total);
    groupBadge.dataset.severity = hasCritical ? "critical" : "warning";
    group.querySelector(":scope > .nav-grp")?.setAttribute("aria-label", `${group.querySelector(":scope > .nav-grp > span")?.textContent.trim() || "Navigation group"}, ${total} need attention`);
  });
}

function initialiseSidebarAttentionBadges() {
  const apply = items => updateSidebarAttentionBadges(items);
  document.addEventListener("apr:notifications-updated", event => apply(event.detail));
  if (Array.isArray(window.__aprNotificationItems)) apply(window.__aprNotificationItems);
  const observer = new MutationObserver(() => {
    if (Array.isArray(window.__aprNotificationItems)) apply(window.__aprNotificationItems);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseSidebarAttentionBadges, { once: true });
} else initialiseSidebarAttentionBadges();
