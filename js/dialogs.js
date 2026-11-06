const queue = [];
let activeDialog = null;

function getDialog() {
  if (activeDialog?.isConnected) return activeDialog;

  const dialog = document.createElement("dialog");
  dialog.id = "apr-message-dialog";
  dialog.setAttribute("aria-labelledby", "apr-message-title");
  dialog.innerHTML = `
    <style>
      #apr-message-dialog{width:min(440px,calc(100vw - 32px));max-width:none;padding:0;border:1px solid rgba(148,163,184,.28);border-radius:18px;background:var(--surface,#111827);color:var(--text,#f8fafc);box-shadow:0 28px 90px rgba(0,0,0,.48)}
      #apr-message-dialog[open]{position:fixed;inset:0;margin:auto;z-index:10000}
      #apr-message-dialog::backdrop{background:rgba(3,7,18,.68);backdrop-filter:blur(4px)}
      #apr-message-dialog .apr-message-card{padding:24px}
      #apr-message-dialog h2{margin:0 0 10px;color:inherit;font:700 1.15rem/1.3 system-ui,sans-serif}
      #apr-message-dialog p{margin:0;color:var(--text-muted,#aab4c4);font:400 .94rem/1.55 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}
      #apr-message-dialog button{display:block;min-width:88px;min-height:42px;margin:22px 0 0 auto;padding:0 16px;border:0;border-radius:10px;background:#1fc467;color:#06220f;font:700 .9rem/1 system-ui,sans-serif;cursor:pointer}
      #apr-message-dialog button:focus-visible{outline:2px solid #86efac;outline-offset:3px}
    </style>
    <form class="apr-message-card" method="dialog">
      <h2 id="apr-message-title">Notice</h2>
      <p></p>
      <button type="submit">OK</button>
    </form>`;
  dialog.addEventListener("close", showNext);
  document.body.append(dialog);
  activeDialog = dialog;
  return dialog;
}

function showNext() {
  const message = queue.shift();
  if (message === undefined) return;
  const dialog = getDialog();
  dialog.querySelector("p").textContent = message;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else {
    dialog.setAttribute("open", "");
    dialog.querySelector("button").addEventListener("click", () => {
      dialog.removeAttribute("open");
      showNext();
    }, { once: true });
  }
}

window.alert = message => {
  queue.push(String(message ?? ""));
  if (!activeDialog?.open) showNext();
};
