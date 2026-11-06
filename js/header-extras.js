/* Shared header menu and theme toggle behavior.
   <script src="../js/header-extras.js" defer></script>
   1) Three-dots menu: each category becomes a collapsed group; opening one closes the others.
   2) Light/dark toggle: sun (in dark mode) / moon (in light mode). js/theme.js still owns the click and the saved choice. */
(() => {
  // ---------- 1. collapsible menu groups ----------
  const style = document.createElement("style");
  style.textContent = `
    .hdr-menu .m-group{margin-top:2px}
    .hdr-menu .m-grp{display:flex;align-items:center;gap:11px;width:100%;min-height:44px;padding:10px;border:0;border-radius:10px;background:none;color:var(--text,#eef3fb);font:600 .92rem var(--font,"Inter","Segoe UI",system-ui,sans-serif);text-align:left;cursor:pointer}
    .hdr-menu .m-grp:hover,.hdr-menu .m-grp:focus-visible,.hdr-menu .m-grp[aria-expanded="true"]{background:rgba(77,163,255,.12);outline:none}
    .hdr-menu .m-grp>svg{width:19px;height:19px;flex:none;color:var(--green-bright,#4da3ff)}
    .hdr-menu .m-grp>span:first-of-type{flex:1}
    .hdr-menu .m-chev{width:8px;height:8px;flex:none;border-right:1.6px solid var(--muted,#9db0cc);border-bottom:1.6px solid var(--muted,#9db0cc);transform:rotate(45deg) translateY(-2px);transition:transform 180ms}
    .hdr-menu .m-grp[aria-expanded="true"] .m-chev{transform:rotate(225deg) translate(-2px,-1px)}
    .hdr-menu .m-items{margin:2px 0 8px 19px;padding-left:8px;border-left:1px solid var(--line,rgba(77,163,255,.34))}
    .hdr-menu .m-items a{min-height:40px;font-size:.88rem}
    .hdr-menu .m-items[hidden]{display:none}
    .theme-toggle svg.apr-theme-icon{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform 320ms cubic-bezier(.2,.78,.2,1)}
    .theme-toggle:hover svg.apr-theme-icon{transform:rotate(18deg)}
    .theme-toggle[data-mode="dark"]{color:#fbbf24}
    .theme-toggle[data-mode="light"]{color:#2a5bd7}`;
  document.head.appendChild(style);

  const menu = document.getElementById("hdr-menu");
  if (menu) {
    const iconFor = {};
    document.querySelectorAll(".sidebar .nav-group").forEach(g => {
      const label = g.querySelector(".nav-grp span")?.textContent.trim();
      const icon = g.querySelector(".nav-grp [data-lucide]")?.getAttribute("data-lucide");
      if (label && icon) iconFor[label] = icon;
    });

    const group = () => {
      if (menu.hidden || !menu.querySelector(".m-head") || menu.querySelector(".m-group")) return;
      const frag = document.createDocumentFragment();
      let items = null, n = 0;
      [...menu.children].forEach(el => {
        if (el.classList.contains("m-head")) {
          const label = el.textContent.trim();
          const id = `hdr-grp-${n++}`;
          const wrap = document.createElement("div");
          wrap.className = "m-group";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "m-grp";
          btn.setAttribute("aria-expanded", "false");
          btn.setAttribute("aria-controls", id);
          btn.innerHTML = `<i data-lucide="${iconFor[label] || "folder"}"></i><span></span><span class="m-chev" aria-hidden="true"></span>`;
          btn.querySelector("span").textContent = label;
          items = document.createElement("div");
          items.className = "m-items";
          items.id = id;
          items.hidden = true;
          wrap.append(btn, items);
          frag.append(wrap);
        } else if (items) {
          items.append(el);
        } else {
          frag.append(el); // links above the first heading (e.g. Home) stay visible
        }
      });
      menu.replaceChildren(frag);
      // the group holding the current page starts open
      menu.querySelectorAll(".m-items").forEach(panel => {
        if (!panel.querySelector('[aria-current="page"]')) return;
        panel.hidden = false;
        menu.querySelector(`[aria-controls="${panel.id}"]`)?.setAttribute("aria-expanded", "true");
      });
      if (window.lucide) window.lucide.createIcons();
    };

    new MutationObserver(group).observe(menu, { childList: true, attributes: true, attributeFilter: ["hidden"] });

    // one category open at a time keeps the dropdown short
    menu.addEventListener("click", e => {
      const g = e.target.closest(".m-grp");
      if (!g) return;
      const open = g.getAttribute("aria-expanded") !== "true";
      menu.querySelectorAll(".m-grp").forEach(b => {
        const on = b === g && open;
        b.setAttribute("aria-expanded", String(on));
        const panel = document.getElementById(b.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
    });
  }

  // ---------- 2. light / dark toggle icon ----------
  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true" class="apr-theme-icon"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true" class="apr-theme-icon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  const SEL = '.theme-toggle, #theme-toggle, #themeToggle, [data-theme-toggle], button[aria-label*="theme" i], button[aria-label*="dark mode" i], button[aria-label*="light mode" i]';
  const root = document.documentElement;
  let btn = null;
  const watch = new MutationObserver(() => paint());
  function paint() {
    if (!btn || !btn.isConnected) return;
    const dark = root.getAttribute("data-theme") !== "light";
    const mode = dark ? "dark" : "light";
    if (btn.dataset.mode === mode && btn.querySelector(".apr-theme-icon")) return;
    watch.disconnect();
    btn.dataset.mode = mode;
    btn.innerHTML = dark ? SUN : MOON;
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    watch.observe(btn, { childList: true, subtree: true, characterData: true });
  }
  const find = () => {
    const found = document.querySelector(SEL);
    if (!found) return false;
    btn = found;
    paint();
    return true;
  };
  new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (!find()) {
    const finder = new MutationObserver(() => { if (find()) finder.disconnect(); });
    finder.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => finder.disconnect(), 8000);
  }
})();