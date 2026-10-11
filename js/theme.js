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
  }
  apply();
  if (mq && mode === "system") {
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }
})();
