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
    root.style.backgroundColor = theme === "dark" ? "#0b1220" : "#eef3fb";
    root.style.colorScheme = theme;
    document.querySelectorAll("#modes button").forEach(function (button) {
      button.setAttribute("aria-checked", String(button.dataset.m === mode));
    });
    var status = document.getElementById("mode-now");
    if (status) status.textContent = mode === "system" ? "Following your device. Currently " + theme + "." : "";
    document.querySelectorAll(".theme-toggle").forEach(function (button) {
      var next = theme === "dark" ? "light" : "dark";
      button.setAttribute("aria-label", "Switch to " + next + " mode");
      button.setAttribute("title", "Switch to " + next + " mode");
      button.innerHTML = '<i data-lucide="' + (next === "light" ? "sun" : "moon") + '"></i><span>' + (next === "light" ? "Light" : "Dark") + "</span>";
    });
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
    if (!header || header.querySelector(".theme-toggle")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.addEventListener("click", function () {
      mode = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem("apr-theme", mode); } catch (e) {}
      apply();
      window.dispatchEvent(new CustomEvent("apr:theme-changed", { detail: { mode: mode } }));
    });
    var actions = header.querySelector(".site-masthead__actions, .site-masthead__status, .hdr-right") || header;
    actions.append(button);
    apply();
  });
  if (mq && mode === "system") {
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }
})();
