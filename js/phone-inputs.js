const PREFIX = "+263";

function digitsOnly(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("263")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function formatPhone(value) {
  const digits = digitsOnly(value).slice(0, 9);
  if (!digits) return PREFIX + " ";
  if (digits.length <= 2) return PREFIX + " " + digits;
  if (digits.length <= 5) return PREFIX + " " + digits.slice(0, 2) + " " + digits.slice(2);
  return PREFIX + " " + digits.slice(0, 2) + " " + digits.slice(2, 5) + " " + digits.slice(5);
}

function isValid(value) {
  return digitsOnly(value).length === 9;
}

function initializePhoneInput(input) {
  if (input.dataset.phoneInitialized === "true") return;
  input.dataset.phoneInitialized = "true";
  input.setAttribute("autocomplete", input.getAttribute("autocomplete") || "tel");
  input.setAttribute("inputmode", "tel");
  input.setAttribute("placeholder", input.getAttribute("placeholder") || "+263 77 123 4567");
  input.value = formatPhone(input.value || "");
  input.setAttribute("aria-label", input.getAttribute("aria-label") || "Phone number with Zimbabwe country code");

  const validate = () => {
    const valid = !input.value.trim() && !input.required || isValid(input.value);
    input.setCustomValidity(valid ? "" : "Enter a valid Zimbabwean phone number with 9 digits after +263.");
    input.dataset.countryCode = "ZW";
  };

  input.addEventListener("focus", () => {
    if (!input.value.trim()) input.value = PREFIX + " ";
    if (!input.value.startsWith(PREFIX)) input.value = formatPhone(input.value);
  });
  input.addEventListener("input", () => {
    const cursorAtEnd = input.selectionStart === input.value.length;
    input.value = formatPhone(input.value);
    validate();
    if (cursorAtEnd) input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener("blur", () => {
    input.value = formatPhone(input.value);
    validate();
  });
  input.addEventListener("invalid", validate);
  input.form?.addEventListener("reset", () => {
    setTimeout(() => { input.value = formatPhone(""); validate(); });
  });
  validate();
}

function initializePhoneFields(container = document) {
  container.querySelectorAll?.('input[type="tel"], input[inputmode="tel"]').forEach(initializePhoneInput);
}

function normalizePhoneInputs(container) {
  const inputs = container.querySelectorAll('input[type="tel"], input[inputmode="tel"]');
  for (const input of inputs) {
    initializePhoneInput(input);
    input.value = formatPhone(input.value);
    if (!input.required && digitsOnly(input.value).length === 0) {
      input.value = "";
      input.setCustomValidity("");
      continue;
    }
    if (input.required && !isValid(input.value)) {
      input.setCustomValidity("Enter a valid Zimbabwean phone number with 9 digits after +263.");
      input.reportValidity();
      return false;
    }
    input.setCustomValidity("");
  }
  return true;
}

function normalizeFormPhones(form) {
  return normalizePhoneInputs(form);
}

initializePhoneFields();
document.addEventListener("focusin", event => {
  if (event.target.matches?.('input[type="tel"], input[inputmode="tel"]')) initializePhoneInput(event.target);
});
document.addEventListener("submit", event => {
  if (!normalizeFormPhones(event.target)) event.preventDefault();
}, true);
document.addEventListener("click", event => {
  const button = event.target.closest?.("button");
  if (!button) return;
  const container = button.form || button.closest("form, .modal, .settings-section");
  if (container && !normalizePhoneInputs(container)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

const phoneObserver = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.('input[type="tel"], input[inputmode="tel"]')) initializePhoneInput(node);
      initializePhoneFields(node);
    }
  }
});
phoneObserver.observe(document.documentElement, { childList: true, subtree: true });

window.CentricPhoneFields = { isValid, normalizeFormPhones, initializePhoneFields };
