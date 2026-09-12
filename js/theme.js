const savedTheme = localStorage.getItem("apr-theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);