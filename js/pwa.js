// Installable app: registers the service worker and offers "Install app".
(function () {
  var deferred = null;
  function standalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function refresh() {
    var show = !!deferred && !standalone();
    document.querySelectorAll("[data-install-app]").forEach(function (el) { el.hidden = !show; });
  }
  function addSidebarButton() {
    var side = document.querySelector(".sidebar");
    if (!side || side.querySelector("[data-install-app]")) return;
    var a = document.createElement("a");
    a.href = "#";
    a.className = "nav-link nav-install";
    a.setAttribute("data-install-app", "");
    a.hidden = true;
    a.innerHTML = '<i data-lucide="download"></i> Install app';
    a.addEventListener("click", function (e) { e.preventDefault(); window.aprInstall(); });
    side.appendChild(a);
    if (window.lucide) window.lucide.createIcons();
  }
  window.aprInstall = async function () {
    if (!deferred) {
      alert("To install: open your browser menu and tap \"Install app\" or \"Add to Home screen\".\nOn iPhone: tap Share, then \"Add to Home Screen\".");
      return;
    }
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) {}
    deferred = null;
    refresh();
  };
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener("appinstalled", function () { deferred = null; refresh(); });
  document.addEventListener("DOMContentLoaded", function () { addSidebarButton(); refresh(); });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
})();
