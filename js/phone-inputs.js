const COUNTRIES = [
  ["ZW", "Zimbabwe", "263"],
  ["ZA", "South Africa", "27"],
  ["ZM", "Zambia", "260"],
  ["BW", "Botswana", "267"],
  ["MW", "Malawi", "265"],
  ["MZ", "Mozambique", "258"],
  ["NA", "Namibia", "264"],
  ["LS", "Lesotho", "266"],
  ["SZ", "Eswatini", "268"],
  ["KE", "Kenya", "254"],
  ["TZ", "Tanzania", "255"],
  ["UG", "Uganda", "256"],
  ["RW", "Rwanda", "250"],
  ["NG", "Nigeria", "234"],
  ["GH", "Ghana", "233"],
  ["ET", "Ethiopia", "251"],
  ["CD", "DR Congo", "243"],
  ["AO", "Angola", "244"],
  ["US", "United States", "1"],
  ["CA", "Canada", "1"],
  ["GB", "United Kingdom", "44"],
  ["IE", "Ireland", "353"],
  ["AU", "Australia", "61"],
  ["NZ", "New Zealand", "64"],
  ["IN", "India", "91"],
  ["CN", "China", "86"],
  ["JP", "Japan", "81"],
  ["SG", "Singapore", "65"],
  ["AE", "United Arab Emirates", "971"],
  ["SA", "Saudi Arabia", "966"],
  ["TR", "Türkiye", "90"],
  ["DE", "Germany", "49"],
  ["FR", "France", "33"],
  ["IT", "Italy", "39"],
  ["ES", "Spain", "34"],
  ["NL", "Netherlands", "31"],
  ["BE", "Belgium", "32"],
  ["CH", "Switzerland", "41"],
  ["SE", "Sweden", "46"],
  ["NO", "Norway", "47"],
  ["DK", "Denmark", "45"],
  ["BR", "Brazil", "55"],
  ["MX", "Mexico", "52"],
  ["AR", "Argentina", "54"],
  ["EG", "Egypt", "20"],
  ["MA", "Morocco", "212"],
  ["PK", "Pakistan", "92"],
  ["PH", "Philippines", "63"],
  ["MY", "Malaysia", "60"],
  ["ID", "Indonesia", "62"],
  ["KR", "South Korea", "82"],
  ["TH", "Thailand", "66"],
];

const byDialCode = [...COUNTRIES].sort((a, b) => b[2].length - a[2].length);

function stripTrunkPrefix(value) {
  return value.replace(/^0+/, "");
}

function parseInternationalNumber(input, countrySelect) {
  const value = input.value.trim();
  if (!value.startsWith("+") && !value.startsWith("00")) return;

  const digits = value.startsWith("00") ? value.slice(2).replace(/\D/g, "") : value.slice(1).replace(/\D/g, "");
  const match = byDialCode.find(country => digits.startsWith(country[2]));
  if (!match) return;

  countrySelect.value = match[0];
  input.value = stripTrunkPrefix(digits.slice(match[2].length));
}

function getNationalNumber(input, countrySelect) {
  parseInternationalNumber(input, countrySelect);
  return stripTrunkPrefix(input.value.replace(/\D/g, ""));
}

function normalizedNumber(input) {
  parseInternationalNumber(input, input.phoneCountrySelect);
  input.dataset.countryCode = input.phoneCountrySelect.value;
  const country = COUNTRIES.find(item => item[0] === input.dataset.countryCode);
  if (!country) return null;

  const national = getNationalNumber(input, input.phoneCountrySelect);
  const fullDigits = country[2] + national;
  if (!national || fullDigits.length < 7 || fullDigits.length > 15) return null;

  const formattedNational = country[0] === "ZW" && national.length === 9
    ? `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`
    : national;
  return `+${country[2]} ${formattedNational}`;
}

function isValid(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\+\d{1,3}\s[\d ]+$/.test(String(value || "")) && digits.length >= 7 && digits.length <= 15;
}

function initializePhoneInput(input) {
  if (input.dataset.phoneInitialized === "true") return;
  input.dataset.phoneInitialized = "true";
  input.setAttribute("autocomplete", input.getAttribute("autocomplete") || "tel-national");
  input.setAttribute("inputmode", "tel");
  input.removeAttribute("pattern");

  const control = document.createElement("div");
  control.className = "phone-field-control";
  const countrySelect = document.createElement("select");
  countrySelect.className = "phone-country-select";
  countrySelect.setAttribute("aria-label", "Country calling code");
  countrySelect.setAttribute("autocomplete", "tel-country-code");
  for (const [code, name, dial] of COUNTRIES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${name} (+${dial})`;
    countrySelect.append(option);
  }
  countrySelect.value = "ZW";

  input.parentNode.insertBefore(control, input);
  control.append(countrySelect, input);
  input.phoneCountrySelect = countrySelect;
  input.dataset.countryCode = countrySelect.value;

  const updateCountry = () => {
    input.dataset.countryCode = countrySelect.value;
  };
  const validate = () => {
    const rawValue = input.value;
    const valid = !rawValue.trim() && !input.required || Boolean(normalizedNumber(input));
    input.value = rawValue;
    input.setCustomValidity(valid ? "" : "Enter a valid phone number for the selected country.");
  };

  input.addEventListener("focus", () => {
    parseInternationalNumber(input, countrySelect);
    updateCountry();
  });
  input.addEventListener("input", () => {
    parseInternationalNumber(input, countrySelect);
    updateCountry();
    validate();
  });
  input.addEventListener("blur", () => {
    const normalized = normalizedNumber(input);
    if (normalized) input.value = normalized;
    updateCountry();
    validate();
  });
  countrySelect.addEventListener("change", () => {
    const previousCountry = COUNTRIES.find(item => item[0] === input.dataset.countryCode);
    let digits = input.value.replace(/\D/g, "");
    if ((input.value.trim().startsWith("+") || input.value.trim().startsWith("00")) && previousCountry) {
      const internationalDigits = input.value.trim().startsWith("00")
        ? input.value.trim().slice(2).replace(/\D/g, "")
        : input.value.trim().slice(1).replace(/\D/g, "");
      if (internationalDigits.startsWith(previousCountry[2])) digits = internationalDigits.slice(previousCountry[2].length);
    }
    input.value = stripTrunkPrefix(digits);
    updateCountry();
    validate();
    input.focus();
  });
  input.form?.addEventListener("reset", () => {
    setTimeout(() => {
      updateCountry();
      validate();
    });
  });
  input.addEventListener("invalid", validate);
  validate();
}

function normalizePhoneInputs(container) {
  for (const input of container.querySelectorAll("input[type='tel'], input[inputmode='tel']")) {
    if (!input.value.trim()) continue;
    const normalized = normalizedNumber(input);
    if (normalized) {
      input.value = normalized;
      input.setCustomValidity("");
    } else {
      input.setCustomValidity("Enter a valid phone number for the selected country.");
      input.reportValidity();
      return false;
    }
  }
  return true;
}

function normalizeFormPhones(form) {
  return normalizePhoneInputs(form);
}

function initializePhoneFields() {
  document.querySelectorAll("input[type='tel'], input[inputmode='tel']").forEach(initializePhoneInput);
}

initializePhoneFields();
document.addEventListener("focusin", event => {
  if (event.target.matches("input[type='tel'], input[inputmode='tel']")) initializePhoneInput(event.target);
});
document.addEventListener("submit", event => {
  if (!normalizeFormPhones(event.target)) event.preventDefault();
}, true);
document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const container = button.form || button.closest("form, .modal, .settings-section");
  if (container && !normalizePhoneInputs(container)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

window.CentricPhoneFields = { isValid, normalizeFormPhones };
