import supabase from "./supabaseClient.js";
    const $ = id => document.getElementById(id);
    const enc = encodeURIComponent;
    const appRoot = new URL(location.pathname.includes("/pages/") ? "../" : "./", location.href);
    const resolveHref = href => new URL(href, appRoot).href;
    const esc = v => { const d = document.createElement("div"); d.textContent = v ?? ""; return d.innerHTML; };
    const money = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
    const pad = n => (n == null || n === "" ? "" : String(n).padStart(4, "0"));
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const icons = () => { if (window.lucide) window.lucide.createIcons(); };

    // ---------- data sources (each loads once, then is reused for 2 minutes) ----------
    const memo = new Map();
    function rows(key, build) {
      const hit = memo.get(key);
      if (hit && Date.now() - hit.t < 120000) return hit.p;
      const p = (async () => {
        try { const { data, error } = await build(); if (error) throw error; return data || []; }
        catch (e) { console.warn(`Search source "${key}" unavailable:`, e.message || e); memo.delete(key); return []; }
      })();
      memo.set(key, { t: Date.now(), p });
      return p;
    }
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const flat = (o, out = []) => {
      if (o == null) return out;
      if (typeof o === "string") { if (!UUID.test(o)) out.push(o); }
      else if (Array.isArray(o)) o.forEach(v => flat(v, out));
      else if (typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "id" || /_id$|_at$|date$/i.test(k)) continue; flat(v, out); }
      return out;
    };
    const mk = (title, sub, href, parts = []) => ({ title: title || "—", sub: sub || "", href, hay: [title, sub, ...parts].filter(Boolean).join(" ").toLowerCase() });
    const veh = v => [v?.year, v?.make, v?.model].filter(Boolean).join(" ");
    const jobsRows = () => rows("jobs", () => supabase.from("repair_jobs").select("id, job_number, cro_number, status, fault_reported, customers ( full_name, phone ), vehicles ( make, model, year, license_plate )").order("created_at", { ascending: false }).limit(1000));

    const SOURCES = [
      { key: "customers", label: "Customers", icon: "users", load: async () =>
          (await rows("customers", () => supabase.from("customers").select("*").is("deleted_at", null).limit(1000)))
            .map(c => mk(c.full_name || "Unnamed customer", [c.phone, c.email].filter(Boolean).join(" · "), `pages/customers.html?highlight=${enc(c.id)}`, flat(c))) },
      { key: "jobs", label: "Job Cards", icon: "clipboard-list", load: async () =>
          (await jobsRows()).map(j => mk(`#${pad(j.job_number)} — ${j.customers?.full_name || "Unknown customer"}`,
            [veh(j.vehicles), j.vehicles?.license_plate, j.status].filter(Boolean).join(" · "), `pages/repairs.html?highlight=${enc(j.id)}`,
            [String(j.job_number ?? ""), j.cro_number, j.fault_reported, j.customers?.phone, j.vehicles?.make, j.vehicles?.model])) },
      { key: "vehicles", label: "Vehicles", icon: "car", load: async () => {
          const seen = new Set(), out = [];
          for (const j of await jobsRows()) {
            const v = j.vehicles; if (!v) continue;
            const k = [v.license_plate, v.make, v.model, v.year].join("|"); if (seen.has(k)) continue; seen.add(k);
            out.push(mk(veh(v) || "Vehicle", [v.license_plate, j.customers?.full_name].filter(Boolean).join(" · "), `pages/repairs.html?highlight=${enc(j.id)}`, [v.license_plate, v.make, v.model]));
          }
          return out; } },
      { key: "quotes", label: "Quotations", icon: "file-text", load: async () =>
          (await rows("quotes", () => supabase.from("quotations").select("id, quotation_number, status, fault_reported, walk_in_name, customers ( full_name )").order("created_at", { ascending: false }).limit(500)))
            .map(q => mk(`Quote #${q.quotation_number}`, [q.customers?.full_name || q.walk_in_name || "Walk-in", q.status].filter(Boolean).join(" · "), `pages/quotations.html?highlight=${enc(q.id)}`, [String(q.quotation_number ?? ""), q.fault_reported])) },
      { key: "orders", label: "Sales Orders", icon: "shopping-cart", load: async () =>
          (await rows("orders", () => supabase.from("sales_orders").select("id, order_number, status, walk_in_name, customers ( full_name )").order("created_at", { ascending: false }).limit(500)))
            .map(o => mk(`Sales order #${o.order_number}`, [o.customers?.full_name || o.walk_in_name || "Walk-in", o.status].filter(Boolean).join(" · "), "pages/quotations.html", [String(o.order_number ?? "")])) },
      { key: "receipts", label: "Receipts", icon: "receipt", load: async () =>
          (await rows("receipts", () => supabase.from("receipts").select("id, receipt_number, amount, issued_at, repair_jobs ( job_number, customers ( full_name ) ), sales_orders ( order_number, walk_in_name, customers ( full_name ) )").order("issued_at", { ascending: false }).limit(1000)))
            .map(r => { const who = r.repair_jobs?.customers?.full_name || r.sales_orders?.customers?.full_name || r.sales_orders?.walk_in_name || "";
              return mk(`Receipt #${pad(r.receipt_number)}`, [who, money(r.amount)].filter(Boolean).join(" · "), "pages/receipts.html", [String(r.receipt_number ?? ""), Number(r.amount || 0).toFixed(2), String(r.repair_jobs?.job_number ?? ""), String(r.sales_orders?.order_number ?? "")]); }) },
      { key: "credit", label: "Credit Notes", icon: "file-minus", load: async () =>
          (await rows("credit", () => supabase.from("credit_notes").select("id, credit_note_number, reason, amount, customers ( full_name )").order("issued_at", { ascending: false }).limit(500)))
            .map(c => mk(`Credit note #${c.credit_note_number}`, [c.customers?.full_name, money(c.amount)].filter(Boolean).join(" · "), "pages/receipts.html", [String(c.credit_note_number ?? ""), c.reason])) },
      { key: "parts", label: "Parts", icon: "package", load: async () =>
          (await rows("parts", () => supabase.from("parts").select("*").limit(1000)))
            .map(p => mk(p.name, [p.part_number, p.category, `${p.quantity_in_stock ?? 0} in stock`].filter(Boolean).join(" · "), "pages/shop.html", flat(p))) },
      { key: "suppliers", label: "Suppliers", icon: "truck", load: async () =>
          (await rows("suppliers", () => supabase.from("suppliers").select("*").limit(1000)))
            .map(s => mk(s.name, s.phone || "", `pages/suppliers.html?highlight=${enc(s.id)}`, flat(s))) },
      { key: "staff", label: "Staff", icon: "hard-hat", load: async () =>
          (await rows("staff", () => supabase.from("technician_directory").select("id, full_name, department, is_active").limit(500)))
            .map(t => mk(t.full_name, [t.department, t.is_active === false ? "Inactive" : ""].filter(Boolean).join(" · "), "pages/technicians.html", [t.department])) },
      { key: "bills", label: "Payables", icon: "banknote", load: async () =>
          (await rows("bills", () => supabase.from("payables").select("id, bill_number, due_date, amount, amount_paid, suppliers ( name )").limit(1000)))
            .map(b => mk(`Bill ${b.bill_number || ""}${b.suppliers?.name ? " — " + b.suppliers.name : ""}`.trim(), `${money((Number(b.amount) || 0) - (Number(b.amount_paid) || 0))} outstanding`, `pages/payables.html?highlight=${enc(b.id)}`, [b.bill_number, b.suppliers?.name])) },
      { key: "accounts", label: "Accounts", icon: "book-open-check", load: async () =>
          (await rows("accounts", () => supabase.from("accounts").select("id, code, name, type").limit(500)))
            .map(a => mk(`${a.code} — ${a.name}`, a.type, "pages/ledger.html", [a.code, a.name])) },
      { key: "journal", label: "Journal", icon: "notebook-pen", load: async () =>
          (await rows("journal", () => supabase.from("journal_entries").select("id, entry_date, reference, description, source_type").order("entry_date", { ascending: false }).limit(1000)))
            .map(e => mk(e.description || e.reference || "Journal entry", [e.entry_date, e.reference, e.source_type].filter(Boolean).join(" · "), "pages/ledger.html", [e.reference, e.source_type])) },
      { key: "assets", label: "Assets", icon: "wrench", load: async () =>
          (await rows("assets", () => supabase.from("fixed_assets").select("*").limit(500)))
            .map(a => mk(a.name || "Asset", [a.category, a.status].filter(Boolean).join(" · "), "pages/fixed-assets.html", flat(a))) },
      { key: "pages", label: "Pages", icon: "layout-grid", load: async () => {
          const out = [];
          document.querySelectorAll("#sidebar .nav-group").forEach(g => {
            const grp = g.querySelector(".nav-grp span")?.textContent.trim() || "";
            g.querySelectorAll("a.nav-link").forEach(a => out.push(mk(a.textContent.trim(), grp, a.getAttribute("href"))));
          });
          return out; } },
    ];
    const BY_KEY = Object.fromEntries(SOURCES.map(s => [s.key, s]));

    // ---------- search UI ----------
    const input = document.querySelector(".sidebar-search #hs-input") || $("hs-input");
    const panel = input?.closest(".hs")?.querySelector("#hs-panel") || $("hs-panel");
    const chips = panel?.querySelector("#hs-chips") || $("hs-chips");
    const out = panel?.querySelector("#hs-results") || $("hs-results");
    if (input && panel && chips && out && !input.dataset.searchBound) {
      input.dataset.searchBound = "true";
      let filter = "all", seq = 0, warmed = false;
      chips.innerHTML = [{ key: "all", label: "All" }, ...SOURCES].map(s => `<button type="button" class="hs-chip" data-f="${s.key}" aria-pressed="${s.key === "all"}">${esc(s.label)}</button>`).join("");

      const hint = () => { out.innerHTML = `<div class="hs-empty">Type at least 2 characters to search everything in the system.</div>`; };
      const openPanel = () => { panel.hidden = false; };
      const closePanel = () => { panel.hidden = true; };

      function rank(items, tokens) {
        const first = tokens[0], res = [];
        for (const it of items) {
          if (!tokens.every(t => it.hay.includes(t))) continue;
          const title = it.title.toLowerCase();
          res.push({ it, s: title.startsWith(first) ? 0 : title.includes(first) ? 1 : 2 });
        }
        return res.sort((a, b) => a.s - b.s).map(x => x.it);
      }
      function draw(term, results) {
        const single = filter !== "all";
        const total = results.reduce((n, r) => n + r.hits.length, 0);
        if (!total) {
          out.innerHTML = `<div class="hs-empty">No matches for “${esc(term)}”${single ? ` in ${esc(BY_KEY[filter].label)}` : ""}.${single ? " Try the <b>All</b> filter." : ""}</div>`;
          return;
        }
        const cap = single ? 40 : 5;
        out.innerHTML = results.filter(r => r.hits.length).map(r => {
          const shown = r.hits.slice(0, cap), more = r.hits.length - shown.length;
          return `<div class="hs-group"><span>${esc(r.s.label)} · ${r.hits.length}</span>${more > 0 ? `<button type="button" class="hs-more" data-f="${r.s.key}">Show all</button>` : ""}</div>`
            + shown.map(i => `<a class="hs-item" href="${esc((() => { const target = new URL(resolveHref(i.href)); target.searchParams.set("search", term); return target.href; })())}"><i data-lucide="${r.s.icon}"></i><span><b>${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span></a>`).join("");
        }).join("");
        icons();
      }
      async function run() {
        const term = input.value.trim();
        const my = ++seq;
        if (term.length < 2) { hint(); return; }
        const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
        const list = filter === "all" ? SOURCES : [BY_KEY[filter]];
        const results = await Promise.all(list.map(async s => ({ s, hits: rank(await s.load(), tokens) })));
        if (my !== seq) return;
        draw(term, results);
      }
      const runDebounced = debounce(run, 250);
      function setFilter(key) {
        filter = key;
        chips.querySelectorAll(".hs-chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === key)));
        if (input.value.trim().length >= 2) { out.innerHTML = `<div class="hs-empty">Searching…</div>`; run(); } else hint();
        input.focus({ preventScroll: true });
      }
      const warm = () => { if (warmed) return; warmed = true; SOURCES.forEach(s => { if (s.key !== "pages") s.load(); }); };

      hint();
      input.addEventListener("focus", () => { openPanel(); warm(); });
      input.addEventListener("input", () => {
        openPanel();
        if (input.value.trim().length < 2) { seq++; hint(); return; }
        out.innerHTML = `<div class="hs-empty">Searching…</div>`;
        runDebounced();
      });
      chips.addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) setFilter(b.dataset.f); });
      out.addEventListener("click", e => { const b = e.target.closest(".hs-more"); if (b) setFilter(b.dataset.f); });
      document.addEventListener("click", e => { if (!e.target.closest("#hs")) closePanel(); });
      input.addEventListener("keydown", e => {
        if (e.key === "ArrowDown") { const a = out.querySelector(".hs-item"); if (a) { e.preventDefault(); a.focus(); } }
        else if (e.key === "Enter") { const a = out.querySelector(".hs-item"); if (a) { e.preventDefault(); window.location.href = a.href; } }
      });
      out.addEventListener("keydown", e => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        const all = [...out.querySelectorAll(".hs-item")], i = all.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        if (e.key === "ArrowDown") all[Math.min(i + 1, all.length - 1)].focus();
        else if (i === 0) input.focus(); else all[i - 1].focus();
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !panel.hidden) { closePanel(); input.blur(); }
        else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && !document.activeElement?.isContentEditable) { e.preventDefault(); input.focus(); }
      });
      const carriedSearch = new URLSearchParams(location.search).get("search");
      if (carriedSearch && carriedSearch.trim().length >= 2) {
        input.value = carriedSearch.trim();
        openPanel();
        run();
      }
    }

    // ---------- top-right More menu ----------
    const btn = $("hdr-menu-btn"), menu = $("hdr-menu");
    if (btn && menu) {
      const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
      const linkHtml = a => {
        const href = a.getAttribute("href") || "#";
        const icon = a.querySelector("[data-lucide]")?.getAttribute("data-lucide") || "circle";
        const cur = href.split(/[?#]/)[0].split("/").pop().toLowerCase() === here ? ' aria-current="page"' : "";
        return `<a role="menuitem" href="${esc(href)}"${cur}><i data-lucide="${esc(icon)}"></i><span>${esc(a.textContent.trim())}</span></a>`;
      };
      function build() {
        let html = "", gi = 0;
        [...($("sidebar")?.children || [])].forEach(el => {
          if (el.matches("a.nav-link")) html += linkHtml(el);
          else if (el.matches(".nav-group")) {
            const links = [...el.querySelectorAll("a.nav-link")];
            if (links.length) {
              const gid = "hdr-grp-" + (gi++);
              const open = links.some(a => (a.getAttribute("href") || "").split(/[?#]/)[0].split("/").pop().toLowerCase() === here);
              const gicon = el.querySelector(".nav-grp [data-lucide]")?.getAttribute("data-lucide") || "folder";
              html += `<div class="m-group"><button type="button" class="m-grp" aria-expanded="${open}" aria-controls="${gid}"><i data-lucide="${esc(gicon)}"></i><span>${esc(el.querySelector(".nav-grp span")?.textContent.trim() || "")}</span><span class="m-chev" aria-hidden="true"></span></button><div class="m-items" id="${gid}"${open ? "" : " hidden"}>${links.map(linkHtml).join("")}</div></div>`;
            }
          }
        });
        menu.innerHTML = html || `<div class="hs-empty">No modules available.</div>`;
        icons();
      }
      const setOpen = (open, restore) => {
        if (open) build();
        menu.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        if (open) menu.querySelector("a")?.focus({ preventScroll: true });
        else if (restore) btn.focus({ preventScroll: true });
      };
      btn.addEventListener("click", () => setOpen(menu.hidden));
      menu.addEventListener("click", e => {
        const g = e.target.closest(".m-grp"); if (!g) return;
        const open = g.getAttribute("aria-expanded") !== "true";
        menu.querySelectorAll(".m-grp").forEach(b => {
          const on = b === g && open;
          b.setAttribute("aria-expanded", String(on));
          const p = document.getElementById(b.getAttribute("aria-controls")); if (p) p.hidden = !on;
        });
      });
      document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest(".hdr-menu-wrap")) setOpen(false); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) setOpen(false, true); });
    }
