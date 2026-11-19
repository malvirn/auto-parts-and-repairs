(() => {
  "use strict";

  if (window.__centricPreviewModalInstalled) return;
  window.__centricPreviewModalInstalled = true;

  const isAccounting = /\/pages\/accounting\.html$/.test(location.pathname);
  const isHome = /\/index\.html$|\/$/.test(location.pathname) && !/\/pages\//.test(location.pathname);
  if (!isAccounting && !isHome) return;

  const style = document.createElement("style");
  style.textContent = `
    .centric-preview-backdrop{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:clamp(8px,2vw,24px);background:rgba(3,8,14,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
    .centric-preview-backdrop[hidden]{display:none}
    .centric-preview-dialog{display:flex;flex-direction:column;width:min(1440px,100%);height:min(900px,92dvh);min-height:0;overflow:hidden;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:20px;background:var(--surface,#111923);color:var(--text,#f4f7fb);box-shadow:0 28px 90px rgba(0,0,0,.5)}
    .centric-preview-head{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:62px;padding:12px 16px 12px 20px;border-bottom:1px solid var(--border,rgba(255,255,255,.12));background:var(--surface-2,var(--surface,#111923))}
    .centric-preview-heading{min-width:0}.centric-preview-kicker{display:block;margin-bottom:2px;color:var(--muted,#9aa8b8);font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
    .centric-preview-title{display:block;overflow:hidden;color:var(--text,#f4f7fb);font-size:15px;font-weight:750;text-overflow:ellipsis;white-space:nowrap}
    .centric-preview-close{display:grid;place-items:center;flex:none;width:38px;height:38px;border:1px solid var(--border,rgba(255,255,255,.16));border-radius:11px;background:var(--surface,#111923);color:var(--text,#f4f7fb);font-size:23px;line-height:1;cursor:pointer}
    .centric-preview-close:hover{border-color:var(--success,#35b978);color:var(--success,#35b978)}
    .centric-preview-frame{display:block;flex:1;width:100%;min-height:0;border:0;background:var(--background,#0b1118)}
    html.centric-preview-open,html.centric-preview-open body{overflow:hidden!important}
    @media(max-width:640px){.centric-preview-backdrop{padding:0}.centric-preview-dialog{width:100%;height:100dvh;max-height:100dvh;border-radius:0;border:0}.centric-preview-head{min-height:58px;padding:10px 12px}.centric-preview-title{font-size:14px}}
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.className = "centric-preview-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="centric-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="centric-preview-title">
      <header class="centric-preview-head">
        <div class="centric-preview-heading"><span class="centric-preview-kicker">Centric · Quick view</span><strong class="centric-preview-title" id="centric-preview-title">Records</strong></div>
        <button class="centric-preview-close" type="button" aria-label="Close quick view">&times;</button>
      </header>
      <iframe class="centric-preview-frame" title="Module records" loading="eager"></iframe>
    </section>`;
  document.body.appendChild(backdrop);

  const frame = backdrop.querySelector("iframe");
  const titleNode = backdrop.querySelector(".centric-preview-title");
  const closeButton = backdrop.querySelector(".centric-preview-close");
  let previousFocus = null;

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    frame.src = "about:blank";
    document.documentElement.classList.remove("centric-preview-open");
    previousFocus?.focus?.();
  }

  function open(link, title) {
    const destination = new URL(link, location.href);
    if (destination.origin !== location.origin || !/^https?:$/.test(destination.protocol)) return;
    previousFocus = document.activeElement;
    titleNode.textContent = title || "Records";
    frame.src = destination.href;
    backdrop.hidden = false;
    document.documentElement.classList.add("centric-preview-open");
    closeButton.focus();
  }

  function previewTarget(target) {
    if (isHome) {
      return target.closest("#ov-kpis a.stat-card, #attention-panel a.attention-item, #system-lists a.ov-row");
    }
    if (isAccounting) {
      const action = target.closest(".module-card__actions a");
      if (action && (action.classList.contains("btn--primary") || /new=1|create/i.test(action.href))) return null;
      return target.closest(".module-card[href], .module-card__actions a, .accounting-guide a");
    }
    return null;
  }

  document.addEventListener("click", event => {
    const link = previewTarget(event.target);
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self") return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return;
    event.preventDefault();
    const title = link.querySelector(".stat-card__label,.module-card__title,.ov-main")?.textContent?.trim()
      || link.querySelector(".attention-item__label")?.textContent?.trim()
      || link.textContent.trim().replace(/\s+/g, " ");
    open(href, title);
  });

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  document.addEventListener("keydown", event => {
    if (backdrop.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      event.preventDefault();
      closeButton.focus();
    }
  });
})();
