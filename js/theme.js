const savedTheme = localStorage.getItem("apr-theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);