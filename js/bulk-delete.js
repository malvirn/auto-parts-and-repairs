import supabase from "./supabaseClient.js";

const CONFIRMATION_WORD = "DELETE";

function installDeleteDialogStyles() {
  if (document.getElementById("apr-delete-dialog-style")) return;
  const style = document.createElement("style");
  style.id = "apr-delete-dialog-style";
  style.textContent = `
    #apr-delete-confirm-dialog{width:min(440px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;overflow:auto;border:1px solid rgba(148,163,184,.28);border-radius:22px;background:var(--surface,#111827);color:var(--text,#f8fafc);box-shadow:0 28px 90px rgba(0,0,0,.48)}
    #apr-delete-confirm-dialog::backdrop{background:rgba(3,7,18,.68);backdrop-filter:blur(5px)}
    #apr-delete-confirm-dialog .apr-delete-card{padding:28px}
    #apr-delete-confirm-dialog .apr-delete-icon{display:grid;place-items:center;width:54px;height:54px;margin-bottom:18px;border:1px solid rgba(239,68,68,.32);border-radius:17px;background:rgba(239,68,68,.12);color:#f87171}
    #apr-delete-confirm-dialog .apr-delete-icon svg{width:25px;height:25px}
    #apr-delete-confirm-dialog h2{margin:0;color:inherit;font:700 1.25rem/1.3 system-ui,sans-serif;letter-spacing:-.02em}
    #apr-delete-confirm-dialog .apr-delete-description{margin:10px 0 18px;color:var(--text-muted,#aab4c4);font:400 .94rem/1.55 system-ui,sans-serif;overflow-wrap:anywhere}
    #apr-delete-confirm-dialog .apr-delete-warning{display:flex;align-items:flex-start;gap:9px;margin:0 0 18px;padding:12px 13px;border:1px solid rgba(248,113,113,.2);border-radius:12px;background:rgba(127,29,29,.16);color:#fecaca;font:500 .84rem/1.45 system-ui,sans-serif}
    #apr-delete-confirm-dialog .apr-delete-warning svg{width:17px;height:17px;flex:none;margin-top:1px}
    #apr-delete-confirm-dialog label{display:block;margin-bottom:7px;color:var(--text,#f8fafc);font:600 .84rem/1.4 system-ui,sans-serif}
    #apr-delete-confirm-dialog input{box-sizing:border-box;width:100%;min-height:46px;padding:10px 12px;border:1px solid rgba(148,163,184,.35);border-radius:11px;background:rgba(15,23,42,.65);color:var(--text,#f8fafc);font:600 1rem/1.3 system-ui,sans-serif;letter-spacing:.08em}
    #apr-delete-confirm-dialog input:focus{outline:2px solid rgba(248,113,113,.7);outline-offset:2px}
    #apr-delete-confirm-dialog .apr-delete-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
    #apr-delete-confirm-dialog .apr-delete-actions button{min-height:42px;padding:0 16px;border-radius:10px;font:600 .9rem/1 system-ui,sans-serif;cursor:pointer}
    #apr-delete-confirm-dialog .apr-delete-cancel{border:1px solid rgba(148,163,184,.3);background:transparent;color:var(--text,#f8fafc)}
    #apr-delete-confirm-dialog .apr-delete-submit{border:1px solid #dc2626;background:#dc2626;color:#fff}
    #apr-delete-confirm-dialog .apr-delete-submit:hover:not(:disabled){background:#b91c1c}
    #apr-delete-confirm-dialog .apr-delete-submit:disabled{border-color:#7f1d1d;background:#7f1d1d;color:#fecaca;cursor:not-allowed;opacity:.65}
    #apr-delete-confirm-dialog button:focus-visible{outline:2px solid #fca5a5;outline-offset:3px}
    @media(max-width:520px){#apr-delete-confirm-dialog .apr-delete-card{padding:22px}#apr-delete-confirm-dialog .apr-delete-actions button{flex:1}}
  `;
  document.head.append(style);
}

export async function confirmTypedDelete(description) {
  if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") {
    if (!window.confirm(`Delete ${description}? This cannot be undone.`)) return false;
    return window.prompt(`Type ${CONFIRMATION_WORD} to confirm deletion:`) === CONFIRMATION_WORD;
  }

  installDeleteDialogStyles();
  const dialog = document.createElement("dialog");
  dialog.id = "apr-delete-confirm-dialog";
  dialog.setAttribute("aria-labelledby", "apr-delete-title");
  dialog.setAttribute("aria-describedby", "apr-delete-description");
  dialog.innerHTML = `
    <form class="apr-delete-card" method="dialog">
      <div class="apr-delete-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
      </div>
      <h2 id="apr-delete-title">Confirm deletion</h2>
      <p class="apr-delete-description" id="apr-delete-description"></p>
      <p class="apr-delete-warning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>
        This action cannot be undone.
      </p>
      <label for="apr-delete-confirm-input">Type <strong>${CONFIRMATION_WORD}</strong> to continue</label>
      <input id="apr-delete-confirm-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Type DELETE to confirm" />
      <div class="apr-delete-actions">
        <button class="apr-delete-cancel" type="button">Cancel</button>
        <button class="apr-delete-submit" type="submit" value="confirmed" disabled>Delete</button>
      </div>
    </form>
  `;
  dialog.querySelector(".apr-delete-description").textContent = `You are about to delete ${description}.`;
  const input = dialog.querySelector("#apr-delete-confirm-input");
  const submit = dialog.querySelector(".apr-delete-submit");
  const cancel = dialog.querySelector(".apr-delete-cancel");
  input.addEventListener("input", () => { submit.disabled = input.value !== CONFIRMATION_WORD; });
  cancel.addEventListener("click", () => dialog.close("cancelled"));
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close("cancelled");
  });

  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirmed");
      dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

export function installBulkDelete({ tbody, table, label, getId, beforeDelete, foreignKeyMessage }) {
  if (!tbody || tbody.dataset.bulkDeleteReady === "true") return;
  const tableElement = tbody.closest("table");
  if (!tableElement) return;

  tbody.dataset.bulkDeleteReady = "true";
  const toolbar = document.createElement("div");
  toolbar.className = "bulk-delete-toolbar";
  toolbar.innerHTML = `
    <label class="bulk-delete-select-all"><input type="checkbox" aria-label="Select all ${label}" /> Select all</label>
    <button class="btn btn--danger" type="button" disabled>Delete selected</button>
    <span class="bulk-delete-message" role="status" aria-live="polite"></span>
  `;
  if (!document.getElementById("bulk-delete-style")) {
    const style = document.createElement("style");
    style.id = "bulk-delete-style";
    style.textContent = `
      .bulk-delete-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border,rgba(255,255,255,.12))}
      .bulk-delete-select-all{display:inline-flex;align-items:center;gap:7px;color:var(--text-muted);font-size:.85rem}
      .bulk-delete-cell{width:40px;text-align:center!important}
      .bulk-delete-cell input{width:18px;height:18px;accent-color:var(--accent,#12a150);cursor:pointer}
      .bulk-delete-message{font-size:.84rem;color:var(--text-muted)}
      .bulk-delete-message[data-tone="error"]{color:var(--danger,#ff6b6b)}
    `;
    document.head.append(style);
  }
  tableElement.parentElement.insertBefore(toolbar, tableElement);

  const header = tableElement.tHead?.rows[0];
  if (header) {
    const cell = document.createElement("th");
    cell.className = "bulk-delete-cell";
    cell.setAttribute("aria-label", "Select records");
    header.prepend(cell);
  }

  const selectAll = toolbar.querySelector("input");
  const deleteButton = toolbar.querySelector("button");
  const message = toolbar.querySelector(".bulk-delete-message");

  function updateControls() {
    const checkboxes = [...tbody.querySelectorAll(".bulk-delete-row input")];
    const selected = checkboxes.filter(box => box.checked);
    deleteButton.disabled = selected.length === 0;
    deleteButton.textContent = selected.length ? `Delete selected (${selected.length})` : "Delete selected";
    selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
    selectAll.disabled = checkboxes.length === 0;
  }

  function decorateRows() {
    [...tbody.rows].forEach(row => {
      const id = getId(row);
      if (!id || row.querySelector(".bulk-delete-row")) return;
      const cell = document.createElement("td");
      cell.className = "bulk-delete-cell bulk-delete-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(id);
      checkbox.setAttribute("aria-label", `Select ${label} record`);
      checkbox.addEventListener("change", updateControls);
      cell.append(checkbox);
      row.prepend(cell);
    });
    updateControls();
  }

  selectAll.addEventListener("change", () => {
    tbody.querySelectorAll(".bulk-delete-row input").forEach(box => { box.checked = selectAll.checked; });
    updateControls();
  });

  deleteButton.addEventListener("click", async () => {
    const ids = [...new Set([...tbody.querySelectorAll(".bulk-delete-row input:checked")].map(box => box.value))];
    if (!ids.length) return;
    if (!(await confirmTypedDelete(`${ids.length} ${label} record${ids.length === 1 ? "" : "s"}`))) {
      message.textContent = "Cancelled — nothing was deleted.";
      return;
    }

    deleteButton.disabled = true;
    message.textContent = "Deleting selected records…";
    try {
      if (beforeDelete) await beforeDelete(ids);
      const { data, error } = await supabase.from(table).delete().in("id", ids).select("id");
      if (error) throw error;
      const deleted = data || [];
      if (!deleted.length) throw new Error("No records were deleted. Check your role permissions and try again.");

      const remaining = ids.length - deleted.length;
      message.textContent = remaining
        ? `Deleted ${deleted.length}; ${remaining} were not deleted. Refreshing totals…`
        : `Deleted ${deleted.length}. Refreshing totals…`;
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
          const key = sessionStorage.key(i);
          if (key?.startsWith("apr:cache:")) sessionStorage.removeItem(key);
        }
      } catch (storageError) {
        console.warn("Couldn't clear cached page data after deletion:", storageError);
      }
      window.location.reload();
    } catch (error) {
      console.error(`Bulk delete failed for ${table}:`, error);
      message.textContent = error.code === "23503"
        ? foreignKeyMessage || `Couldn't delete: related records still depend on these ${label} records.`
        : `Couldn't delete: ${error.message || String(error)}`;
      message.dataset.tone = "error";
      deleteButton.disabled = false;
    }
  });

  new MutationObserver(decorateRows).observe(tbody, { childList: true });
  decorateRows();
}
