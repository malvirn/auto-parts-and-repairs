/* Shared sidebar presentation and keyboard support. Existing navigation code
   remains responsible for URLs, role filtering, account actions and open state. */
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("../css/sidebar.css?v=chrome-glass-1", import.meta.url).href;
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
