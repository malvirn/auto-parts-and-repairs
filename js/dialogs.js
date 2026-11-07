const queue = [];
let activeDialog = null;
let activeRequest = null;

function getDialog() {
  if (activeDialog?.isConnected) return activeDialog;

  const dialog = document.createElement("dialog");
  dialog.id = "apr-message-dialog";
  dialog.setAttribute("aria-labelledby", "apr-message-title");
  dialog.setAttribute("aria-describedby", "apr-message-description");
  dialog.innerHTML = `
    <style>
      #apr-message-dialog{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;overflow:auto;border:1px solid rgba(148,163,184,.28);border-radius:18px;background:var(--surface,#111827);color:var(--text,#f8fafc);box-shadow:0 28px 90px rgba(0,0,0,.48)}
      #apr-message-dialog[open]{position:fixed;inset:0;margin:auto;z-index:10000}
      #apr-message-dialog::backdrop{background:rgba(3,7,18,.68);backdrop-filter:blur(4px)}
      #apr-message-dialog .apr-message-card{padding:24px}
      #apr-message-dialog h2{margin:0 0 10px;color:inherit;font:700 1.15rem/1.3 system-ui,sans-serif}
      #apr-message-dialog p{margin:0;color:var(--text-muted,#aab4c4);font:400 .94rem/1.55 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}
      #apr-message-dialog .apr-message-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
      #apr-message-dialog button{min-width:88px;min-height:42px;padding:0 16px;border:1px solid transparent;border-radius:10px;font:700 .9rem/1 system-ui,sans-serif;cursor:pointer}
      #apr-message-dialog .apr-message-cancel{border-color:rgba(148,163,184,.3);background:transparent;color:inherit}
      #apr-message-dialog .apr-message-confirm{background:#1fc467;color:#06220f}
      #apr-message-dialog .apr-message-confirm.danger{background:#dc2626;color:#fff}
      #apr-message-dialog button:focus-visible{outline:2px solid #86efac;outline-offset:3px}
      @media(max-width:520px){#apr-message-dialog .apr-message-card{padding:20px}#apr-message-dialog .apr-message-actions button{flex:1}}
    </style>
    <form class="apr-message-card">
      <h2 id="apr-message-title">Notice</h2>
      <p id="apr-message-description"></p>
      <div class="apr-message-actions">
        <button class="apr-message-cancel" type="button">Cancel</button>
        <button class="apr-message-confirm" type="button">OK</button>
      </div>
    </form>`;
  const finish = result => {
    if (typeof dialog.close === "function" && dialog.open) dialog.close(String(Boolean(result)));
    else dialog.removeAttribute("open");
    resolveActive(Boolean(result));
  };
  const confirmButton = dialog.querySelector(".apr-message-confirm");
  const cancelButton = dialog.querySelector(".apr-message-cancel");
  confirmButton.addEventListener("click", () => finish(activeRequest?.type === "confirm"));
  cancelButton.addEventListener("click", () => finish(false));
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    finish(false);
  });
  document.body.append(dialog);
  activeDialog = dialog;
  return dialog;
}

function resolveActive(confirmed) {
  const request = activeRequest;
  activeRequest = null;
  if (request?.type === "confirm") request.resolve(Boolean(confirmed));
  if (queue.length) showNext();
}

function showNext() {
  if (activeDialog?.open) return;
  const request = queue.shift();
  if (!request) return;
  const dialog = getDialog();
  activeRequest = request;
  dialog.returnValue = "";
  dialog.setAttribute("role", request.type === "confirm" ? "alertdialog" : "dialog");
  dialog.querySelector("#apr-message-title").textContent = request.title || (request.type === "confirm" ? "Please confirm" : "Notice");
  dialog.querySelector("#apr-message-description").textContent = request.message;
  const cancelButton = dialog.querySelector(".apr-message-cancel");
  const confirmButton = dialog.querySelector(".apr-message-confirm");
  cancelButton.hidden = request.type !== "confirm";
  confirmButton.textContent = request.confirmLabel || "OK";
  confirmButton.classList.toggle("danger", Boolean(request.danger));
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  confirmButton.focus();
}

window.alert = message => {
  queue.push({ type: "alert", message: String(message ?? "") });
  showNext();
};

window.aprConfirm = (message, options = {}) => new Promise(resolve => {
  queue.push({
    type: "confirm",
    message: String(message ?? ""),
    title: options.title,
    confirmLabel: options.confirmLabel || "Confirm",
    danger: options.danger,
    resolve,
  });
  showNext();
});
