const iconName = {
  loading: "loader-circle",
  empty: "inbox",
  error: "triangle-alert",
  offline: "wifi-off",
  search: "search-x",
  success: "circle-check",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function setUiState(container, type, options = {}) {
  if (!container) return;
  const kind = type === "no-results" ? "search" : type;
  const title = options.title || ({
    loading: "Loading",
    empty: "Nothing here yet",
    error: "We could not complete this action",
    offline: "You are offline",
    search: "No results found",
    success: "Done",
  })[kind];
  const detail = options.detail || ({
    loading: "Please wait while we get the latest information.",
    empty: "There is no information to show yet.",
    error: "This may be a connection, permission, or server problem.",
    offline: "Showing saved information where available.",
    search: "Try a shorter term, check spelling, or broaden your search.",
    success: "The operation completed successfully.",
  })[kind];

  container.innerHTML = `
    <div class="apr-state apr-state--${escapeHtml(kind)}" role="${kind === "error" ? "alert" : "status"}" aria-live="polite">
      <div class="apr-state__icon"><i data-lucide="${iconName[kind] || iconName.empty}" aria-hidden="true"></i></div>
      <div class="apr-state__copy">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      ${options.actionLabel ? `<button type="button" class="btn apr-state__action">${escapeHtml(options.actionLabel)}</button>` : ""}
    </div>`;

  if (options.actionLabel && options.onAction) {
    container.querySelector(".apr-state__action")?.addEventListener("click", options.onAction, { once: true });
  }
  window.lucide?.createIcons();
}

export function showSuccess(message, detail = "") {
  showToast("success", message, detail);
}

export function showError(message, detail = "") {
  showToast("error", message, detail);
}

function ensureToasts() {
  let root = document.querySelector(".apr-toasts");
  if (!root) {
    root = document.createElement("div");
    root.className = "apr-toasts";
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-atomic", "false");
    document.body.append(root);
  }
  return root;
}

function showToast(type, message, detail) {
  const root = ensureToasts();
  const toast = document.createElement("div");
  toast.className = `apr-toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="apr-toast-ic"><i data-lucide="${type === "success" ? "circle-check" : "triangle-alert"}"></i></span>
    <span class="apr-toast-tx"><b>${escapeHtml(message)}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</span>
    <button type="button" class="apr-toast-x" aria-label="Dismiss">&times;</button>`;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  root.append(toast);
  window.lucide?.createIcons();
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 250);
  }, type === "error" ? 7000 : 4200);
}

function initNetworkState() {
  let banner = document.getElementById("apr-network-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "apr-network-banner";
    banner.className = "apr-network-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.prepend(banner);
  }

  const update = () => {
    if (!navigator.onLine) {
      banner.dataset.state = "offline";
      banner.hidden = false;
      banner.innerHTML = `<i data-lucide="wifi-off"></i><span><b>You are offline.</b> Saved content stays visible. Reconnect or retry to refresh.</span><button type="button">Retry</button>`;
      banner.querySelector("button").addEventListener("click", () => location.reload());
    } else {
      banner.hidden = true;
      banner.removeAttribute("data-state");
    }
    window.lucide?.createIcons();
  };

  addEventListener("online", update);
  addEventListener("offline", update);
  document.addEventListener("DOMContentLoaded", update, { once: true });
  update();
}

export function flagField(field, message) {
  if (!field) return;
  field.classList.add("apr-field-invalid");
  field.setAttribute("aria-invalid", "true");
  const id = `${field.id || "field"}-error`;
  let hint = field.parentElement?.querySelector(`[data-apr-error-for="${field.id || ""}"]`);
  if (!hint) {
    hint = document.createElement("small");
    hint.className = "apr-field-error";
    hint.dataset.aprErrorFor = field.id || "";
    hint.id = id;
    field.setAttribute("aria-describedby", id);
    field.parentElement?.append(hint);
  }
  hint.textContent = message;
}

export function clearFieldError(field) {
  if (!field) return;
  field.classList.remove("apr-field-invalid");
  field.removeAttribute("aria-invalid");
  field.parentElement?.querySelector(`[data-apr-error-for="${field.id || ""}"]`)?.remove();
}

initNetworkState();

window.APRUI = {
  setState: setUiState,
  success: showSuccess,
  error: showError,
  flagField,
  clearFieldError,
};
