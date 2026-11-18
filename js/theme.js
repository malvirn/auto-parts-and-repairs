// Theme: "light" (default), "dark" or "system" (follows the device).
(function () {
  var mode = "light";
  try { mode = localStorage.getItem("apr-theme") || "light"; } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function apply() {
    var theme = mode === "system" ? (mq && mq.matches ? "dark" : "light") : mode;
    var root = document.documentElement;
    root.setAttribute("data-theme", theme);
    // Paint the app's background colour straight away so a page never
    // flashes white while it loads or while sign-in is being checked.
    root.style.backgroundColor = theme === "dark" ? "#212121" : "#f7f9f8";
    root.style.colorScheme = theme;
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === "dark" ? "#171c24" : "#e9edf2";
    document.querySelectorAll("#modes button").forEach(function (button) {
      button.setAttribute("aria-checked", String(button.dataset.m === mode));
    });
    var status = document.getElementById("mode-now");
    if (status) status.textContent = mode === "system" ? "Following your device. Currently " + theme + "." : "";
    document.querySelectorAll(".theme-toggle").forEach(function (button) {
      var next = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", "Switch to " + next + " mode");
      button.setAttribute("title", "Switch to " + next + " mode");
      button.innerHTML = '<i aria-hidden="true" data-lucide="' + (next === "light" ? "sun" : "moon") + '"></i>';
    });
    var sidebarLabel = document.getElementById("sidebar-theme-label");
    if (sidebarLabel) sidebarLabel.textContent = theme === "dark" ? "Dark mode" : "Light mode";
    if (window.lucide) window.lucide.createIcons();
  }
  apply();
  window.addEventListener("apr:theme-changed", function (event) {
    if (!event.detail || !event.detail.mode) return;
    mode = event.detail.mode;
    apply();
  });
  document.addEventListener("DOMContentLoaded", function () {
    var header = document.querySelector("body.dashboard-page .site-masthead, body.dashboard-page .app-header, body.dashboard-page .main__header");
    var dashboardTopbar = document.querySelector("body.dashboard-workshop .dashboard-topbar");
    if (!header && !dashboardTopbar) return;
    var sidebarButton = document.querySelector("body.dashboard-workshop .sidebar-theme-row .theme-toggle");
    var button = sidebarButton || dashboardTopbar?.querySelector(".theme-toggle") || header?.querySelector(".theme-toggle");
    if (button && !dashboardTopbar && !sidebarButton) return;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "theme-toggle";
    }
    if (!button.dataset.themeBound) {
      button.dataset.themeBound = "true";
      button.addEventListener("click", function () {
        mode = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem("apr-theme", mode); } catch (e) {}
        apply();
        window.dispatchEvent(new CustomEvent("apr:theme-changed", { detail: { mode: mode } }));
      });
    }
    if (sidebarButton) {
      var label = document.getElementById("sidebar-theme-label");
      if (label) label.textContent = mode === "dark" ? "Dark mode" : "Light mode";
    }
    var menuWrap = header?.querySelector(".hdr-menu-wrap");
    var headerActions = header?.querySelector(".hdr-header-actions");
    var actions = headerActions ||
      header?.querySelector(".site-masthead__actions, .site-masthead__status, .hdr-right") || header;
    var dashboardActions = dashboardTopbar?.querySelector(".dashboard-topbar-actions") || dashboardTopbar;
    if (sidebarButton) return; // Keep the dashboard theme control in the sidebar, not the header.\n    if (dashboardActions) dashboardActions.insertBefore(button, dashboardActions.querySelector("#global-notif-bell"));
    else if (headerActions && menuWrap) headerActions.insertBefore(button, menuWrap);
    else if (menuWrap) menuWrap.insertBefore(button, menuWrap.querySelector("#hdr-menu-btn"));
    else actions?.append(button);
    apply();
  });
  if (mq && mode === "system") {
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }
})();

// Put the header and sidebar back before the first paint when moving between pages, so they never reload.
// js/glass-app-shell.js saves the finished shell for this tab and adopts it again once the page's scripts load.
(function restoreShell() {
  var saved = null;
  try {
    var theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    saved = JSON.parse(sessionStorage.getItem("apr-shell:" + theme) || "null");
  } catch (e) {}
  if (!saved || !saved.html) return;
  var style = document.createElement("style");
  // The page content stays hidden while sign-in is checked; the shell itself is allowed to show.
  style.textContent = "#glass-app-chrome[data-cached]{visibility:visible}";
  document.head.appendChild(style);
  function norm(p) { p = String(p).replace(/\.html$/i, "").replace(/\/+$/, ""); return p.replace(/\/index$/, "") || "/"; }
  function samePath(a, b) { return norm(a) === norm(b); }
  function inject() {
    var body = document.body;
    if (!body) return false;
    if (!body.classList.contains("dashboard-page") || document.getElementById("glass-app-chrome")) return true;
    var root = document.createElement("div");
    root.id = "glass-app-chrome";
    root.setAttribute("data-cached", "1");
    root.setAttribute("data-sig", saved.sig || "");
    root.innerHTML = saved.html;
    root.querySelectorAll("a.glass-nav-link").forEach(function (a) {
      var on = false;
      try { on = samePath(new URL(a.getAttribute("href"), location.href).pathname, location.pathname); } catch (e) {}
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    body.classList.add("glass-app-shell");
    try {
      var narrow = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
      if (!narrow && localStorage.getItem("centric-glass-sidebar") === "collapsed") body.classList.add("glass-sidebar-collapsed");
    } catch (e) {}
    body.insertBefore(root, body.firstChild);
    return true;
  }
  if (!inject()) {
    var watcher = new MutationObserver(function () { if (inject()) watcher.disconnect(); });
    watcher.observe(document.documentElement, { childList: true });
  }
})();
