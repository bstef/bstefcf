(function () {
  var SITE_APPS = [
    { path: "/perodic.html", icon: "⚛️", name: "Periodic Table", desc: "Interactive elements reference" },
    { path: "/qr.html", icon: "▦", name: "QR Generator", desc: "Create QR codes on the fly" },
    { path: "/whois.html", icon: "🔍", name: "Whois Lookup", desc: "Domain & IP information" },
    { path: "/fork-sync.html", icon: "🍴", name: "Fork Sync Report", desc: "GitHub fork sync status" },
    { path: "/cloudflare.html", icon: "☁️", name: "Cloudflare Dashboard", desc: "Traffic, cache & error metrics" },
    { path: "/volvo.html", icon: "🚗", name: "Volvo Dashboard", desc: "Controls, trips & map, fuel log, updates" },
    { path: "/home-value.html", icon: "🏠", name: "Home Value Tracker", desc: "Property values, history & rent data" }
  ];

  function currentPath() {
    var path = window.location.pathname;
    if (path === "" || path === "/") return "/index.html";
    return path;
  }

  function renderBack() {
    var mount = document.getElementById("site-back");
    if (!mount) return;
    if (currentPath() === "/index.html") {
      mount.remove();
      return;
    }
    mount.innerHTML = '<a href="/index.html">&larr; back to bstef.pages.dev</a>';
  }

  function renderIndexGrid() {
    var grid = document.getElementById("app-grid");
    if (!grid) return;
    var cards = SITE_APPS.map(function (app) {
      return '<a class="page-card" href="' + app.path + '">' +
        '<div class="icon">' + app.icon + '</div>' +
        '<h3>' + app.name + '</h3>' +
        '<p>' + app.desc + '</p>' +
        '</a>';
    }).join("");
    grid.innerHTML = cards +
      '<div class="page-card empty"><div class="icon">+</div><p>More coming soon</p></div>';
  }

  function renderFooter() {
    var mount = document.getElementById("site-footer");
    if (!mount) return;
    var here = currentPath();
    var links = SITE_APPS
      .filter(function (app) { return app.path !== here; })
      .map(function (app) { return '<a href="' + app.path + '">' + app.icon + ' ' + app.name + '</a>'; })
      .join("");
    var homeLink = here === "/index.html" ? "" : '<a href="/index.html">🏠 Home</a>';
    mount.innerHTML =
      '<div class="site-footer-nav">' + homeLink + links + '</div>' +
      '<div class="site-footer-meta"><a href="https://bstef.com">bstef.com</a> · <a href="https://github.com/bstef/bstefcf">source</a></div>';
  }

  function init() {
    renderBack();
    renderIndexGrid();
    renderFooter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SITE_APPS = SITE_APPS;
})();
