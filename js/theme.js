// Theme: "light" (default), "dark" or "system" (follows the device).
(function () {
  var mode = "light";
  try { mode = localStorage.getItem("apr-theme") || "light"; } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function apply() {
    var theme = mode === "system" ? (mq && mq.matches ? "dark" : "light") : mode;
    document.documentElement.setAttribute("data-theme", theme);
  }
  apply();
  if (mq && mode === "system") {
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }
})();
