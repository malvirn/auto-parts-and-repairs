const $ = id => document.getElementById(id);
const clock = $("hdr-clock");
const date = $("dashboard-date");
const live = $("hdr-live");
const menuButton = $("hdr-menu-btn");
const menu = $("hdr-menu");
const search = $("hs-input");
// Keep a source copy before access-control removes links that a role cannot
// use. The More menu can therefore still be built when the visual sidebar has
// been converted into the compact mobile navigation.
const navigationSource = $("sidebar")?.cloneNode(true);

// Every module uses the Dashboard masthead.  Pages keep their own content,
// while this shared component supplies the small structural details that were
// previously copied (and slowly diverged) between individual pages.
const header = document.querySelector("body.dashboard-page .app-header");
if (header) {
  header.classList.add("dashboard-hero");

  if (!header.querySelector(".curve")) {
    header.insertAdjacentHTML("beforeend", `
      <svg class="curve" viewBox="0 0 1536 28" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 24H1130" fill="none" stroke="#1fc467" stroke-width="3" vector-effect="non-scaling-stroke"/>
        <path d="M1130 24C1200 24 1230 7 1300 7H1536" fill="none" stroke="#ff7a12" stroke-width="3" vector-effect="non-scaling-stroke"/>
      </svg>`);
  }

  const searchArea = header.querySelector("#hs");
  if (searchArea && !searchArea.querySelector("#hs-panel")) {
    searchArea.insertAdjacentHTML("beforeend", '<div class="hs-panel" id="hs-panel" hidden><div class="hs-chips" id="hs-chips" role="group" aria-label="Search filters"></div><div id="hs-results" aria-live="polite"></div></div>');
  }
  search?.setAttribute("aria-controls", "hs-panel");
  search?.setAttribute("autocapitalize", "off");
  search?.setAttribute("spellcheck", "false");
}

function updateHeader() {
  const now = new Date();
  if (clock) clock.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
  if (date) date.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function updateConnection() {
  if (!live) return;
  const online = navigator.onLine;
  live.dataset.state = online ? "online" : "offline";
  live.querySelector("span").textContent = online ? "Live" : "Offline";
}

function buildMenu() {
  if (!menu) return;
  const sidebar = $("sidebar");
  const source = sidebar?.querySelector(".nav-link") ? sidebar : navigationSource;
  const escape = value => {
    const node = document.createElement("span");
    node.textContent = value;
    return node.innerHTML;
  };
  const currentFile = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const linkHtml = link => {
    const icon = link.querySelector("[data-lucide]")?.getAttribute("data-lucide") || "circle";
    const current = link.getAttribute("aria-current") === "page" || link.classList.contains("active");
    return `<a role="menuitem" href="${escape(link.getAttribute("href"))}"${current ? ' aria-current="page"' : ""}><i data-lucide="${escape(icon)}"></i><span>${escape(link.textContent.trim())}</span></a>`;
  };

  let html = "";
  let groupIndex = 0;
  [...(source?.children || [])].forEach(element => {
    if (element.matches("a.nav-link")) {
      html += linkHtml(element);
      return;
    }
    if (!element.matches(".nav-group")) return;

    const links = [...element.querySelectorAll("a.nav-link")];
    if (!links.length) return;

    const titleElement = element.querySelector(".nav-grp span");
    const title = titleElement?.textContent.trim() || "Modules";
    const iconMap = {
      Workshop: "wrench",
      "Parts & Sales": "package",
      Accounting: "landmark",
      "Reports & Insights": "chart-no-axes-column-increasing",
      Administration: "settings"
    };
    const icon = element.querySelector(".nav-grp [data-lucide]")?.getAttribute("data-lucide") || iconMap[title] || "folder";
    const hasCurrentPage = links.some(link => {
      const href = link.getAttribute("href") || "";
      const file = href.split(/[?#]/)[0].split("/").pop().toLowerCase();
      return file === currentFile;
    });
    const groupId = `hdr-grp-${groupIndex++}`;
    html += `<div class="m-group"><button type="button" class="m-grp" aria-expanded="${hasCurrentPage}" aria-controls="${groupId}"><i data-lucide="${escape(icon)}"></i><span>${escape(title)}</span><span class="m-chev" aria-hidden="true"></span></button><div class="m-items" id="${groupId}"${hasCurrentPage ? "" : " hidden"}>${links.map(linkHtml).join("")}</div></div>`;
  });

  menu.innerHTML = html || `<div class="hs-empty">No modules available.</div>`;
  window.lucide?.createIcons();
}

updateHeader();
updateConnection();
window.setInterval(updateHeader, 1000);
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

if (menuButton && menu) {
  const setOpen = open => {
    if (open) buildMenu();
    menu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("a")?.focus({ preventScroll: true });
  };
  menuButton.addEventListener("click", () => setOpen(menu.hidden));
  menu.addEventListener("click", event => {
    const groupButton = event.target.closest(".m-grp");
    if (!groupButton) return;
    const open = groupButton.getAttribute("aria-expanded") !== "true";
    menu.querySelectorAll(".m-grp").forEach(button => {
      const isOpen = button === groupButton && open;
      button.setAttribute("aria-expanded", String(isOpen));
      const panel = document.getElementById(button.getAttribute("aria-controls"));
      if (panel) panel.hidden = !isOpen;
    });
  });
  document.addEventListener("click", event => {
    if (!menu.hidden && !event.target.closest(".hdr-menu-wrap")) setOpen(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !menu.hidden) {
      setOpen(false);
      menuButton.focus({ preventScroll: true });
    }
  });
}

search?.addEventListener("keydown", event => {
  if (event.key === "Enter" && search.value.trim()) {
    const dashboard = new URL("../index.html", window.location.href);
    dashboard.searchParams.set("search", search.value.trim());
    window.location.href = dashboard.href;
  }
});
