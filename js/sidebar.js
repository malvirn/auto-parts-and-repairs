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


const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("../css/sidebar.css?v=phase3", import.meta.url).href;
stylesheet.dataset.sharedSidebarStyles = "true";
document.head.append(stylesheet);

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
