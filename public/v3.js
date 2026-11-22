/**
 * Progressive enhancement only. Every page works without this file:
 * forms post normally, tables sort via links, charts are server-rendered SVG.
 * What is added here is motion, the command palette and small conveniences.
 */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("has-js");

  /* ------------------------------------------------------------- theme */
  var root = document.documentElement;
  var stored = null;
  try {
    stored = localStorage.getItem("lr-theme");
  } catch (e) {
    stored = null;
  }
  if (stored === "light" || stored === "dark") root.setAttribute("data-theme", stored);

  function toggleTheme() {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("lr-theme", next);
    } catch (e) {
      /* storage may be disabled; the toggle still works for this page */
    }
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-label", next === "light" ? "Byt till mörkt tema" : "Byt till ljust tema");
    });
  }

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest("[data-theme-toggle]");
    if (toggle) {
      event.preventDefault();
      toggleTheme();
      return;
    }

    var close = event.target.closest("[data-command-close]");
    if (close) {
      var dialogToClose = document.getElementById("command");
      if (dialogToClose) dialogToClose.close();
      return;
    }

    var open = event.target.closest("[data-command-open]");
    if (open) {
      event.preventDefault();
      var dialog = document.getElementById("command");
      if (dialog && typeof dialog.showModal === "function") {
        dialog.showModal();
        var input = dialog.querySelector("input");
        if (input) setTimeout(function () { input.focus(); }, 30);
      }
      return;
    }

    var row = event.target.closest("tr[data-href]");
    if (row && !event.target.closest("a, button, input")) {
      window.location.href = row.getAttribute("data-href");
    }
  });

  document.addEventListener("keydown", function (event) {
    var meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      var dialog = document.getElementById("command");
      if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    }
    if (event.key === "Escape") {
      var d = document.getElementById("command");
      if (d && d.open) d.close();
    }
  });

  /* Table rows with data-href are links. Give them the same keyboard path as
     a real link without nesting interactive controls inside a link. */
  function initRows() {
    document.querySelectorAll("tr[data-href]").forEach(function (row) {
      row.setAttribute("tabindex", "0");
      row.setAttribute("role", "link");
      row.setAttribute("aria-label", row.textContent.trim().replace(/\s+/g, " ").slice(0, 140));
      row.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("a, button, input, select, textarea")) return;
        event.preventDefault();
        window.location.href = row.getAttribute("data-href");
      });
    });
  }

  /* -------------------------------------------------------- count-up KPIs */
  function countUp(el) {
    var target = el.getAttribute("data-count") || el.textContent || "";
    var match = target.replace(/\u00a0/g, " ").match(/-?\d[\d\s,.]*/);
    if (!match) return;
    var numeric = parseFloat(match[0].replace(/\s/g, "").replace(",", "."));
    if (!isFinite(numeric) || numeric === 0 || reduceMotion) return;

    var prefix = target.slice(0, match.index);
    var suffix = target.slice(match.index + match[0].length);
    var decimals = (match[0].split(/[.,]/)[1] || "").length;
    var start = performance.now();
    var duration = 650;

    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var value = numeric * eased;
      el.textContent =
        prefix +
        value.toLocaleString("sv-SE", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) +
        suffix;
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = target;
    }
    requestAnimationFrame(frame);
  }

  function initCountUp() {
    if (reduceMotion) return;
    document.querySelectorAll("[data-count]").forEach(function (el) {
      if (el.closest("[data-no-count]")) return;
      countUp(el);
    });
  }

  /* ------------------------------------------------------- range outputs */
  function initRanges() {
    document.querySelectorAll("input[type=range][data-output]").forEach(function (input) {
      var out = document.getElementById(input.getAttribute("data-output"));
      if (!out) return;
      var unit = input.getAttribute("data-unit") || "";
      function sync() {
        var value = Number(input.value);
        out.textContent = (input.getAttribute("data-sign") === "plus" && value > 0 ? "+" : "") + value + unit;
      }
      input.addEventListener("input", sync);
      sync();
    });
  }

  /* ----------------------------------------------------- submit feedback */
  function initForms() {
    document.querySelectorAll("form[data-busy]").forEach(function (form) {
      form.addEventListener("submit", function () {
        var button = form.querySelector("button[type=submit], button:not([type])");
        if (!button) return;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        var label = button.textContent;
        button.dataset.label = label;
        button.textContent = form.getAttribute("data-busy") || "Arbetar…";
      });
    });

    document.querySelectorAll("[data-confirm]").forEach(function (el) {
      el.addEventListener("submit", function (event) {
        if (!window.confirm(el.getAttribute("data-confirm"))) event.preventDefault();
      });
      if (el.tagName === "BUTTON" || el.tagName === "A") {
        el.addEventListener("click", function (event) {
          if (!window.confirm(el.getAttribute("data-confirm"))) event.preventDefault();
        });
      }
    });
  }

  /* --------------------------------------------------------- saved filter */
  /* CSP blocks inline handlers. Keep auto-submit and destructive confirms in
     one delegated script so every control works with script-src 'self'. */
  function initDelegatedForms() {
    document.addEventListener("change", function (event) {
      var select = event.target.closest("select[data-autosubmit]");
      if (!select || !select.form) return;
      if (typeof select.form.requestSubmit === "function") select.form.requestSubmit();
      else select.form.submit();
    });
    document.addEventListener("submit", function (event) {
      var form = event.target.closest("form[data-confirm]");
      if (!form) return;
      if (!window.confirm(form.getAttribute("data-confirm") || "")) event.preventDefault();
    });
  }

  function initFilterPersistence() {
    var forms = document.querySelectorAll("form[data-persist]");
    forms.forEach(function (form) {
      var key = "lr-filter:" + form.getAttribute("data-persist");
      var saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(key) || "null");
      } catch (e) {
        saved = null;
      }
      if (saved && !window.location.search) {
        Object.keys(saved).forEach(function (name) {
          var field = form.elements[name];
          if (field && saved[name]) field.value = saved[name];
        });
      }
      form.addEventListener("submit", function () {
        var data = {};
        Array.prototype.forEach.call(form.elements, function (field) {
          if (field.name) data[field.name] = field.value;
        });
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
          /* ignore */
        }
      });
    });
  }

  /* ------------------------------------------------------------ copilot */
  function initCopilot() {
    var thread = document.querySelector("[data-thread]");
    if (thread) thread.scrollTop = thread.scrollHeight;

    var composer = document.querySelector("[data-composer]");
    if (composer) {
      var field = composer.querySelector("textarea, input[name=q]");
      if (field) {
        field.addEventListener("keydown", function (event) {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            composer.requestSubmit();
          }
        });
        field.focus();
      }
    }

    document.querySelectorAll("[data-ask]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var target = document.querySelector("textarea[name=q], input[name=q]");
        if (!target) return;
        target.value = chip.getAttribute("data-ask");
        var form = target.closest("form");
        if (form) form.requestSubmit();
      });
    });
  }

  /* ----------------------------------------------------- chart tooltips */
  function initChartFocus() {
    document.querySelectorAll(".chart [title]").forEach(function (node) {
      node.setAttribute("tabindex", "-1");
    });
  }

  function initLangSwitcher() {
    document.querySelectorAll("[data-lang-select]").forEach(function (select) {
      select.addEventListener("change", function () {
        if (select.form) select.form.submit();
      });
    });
  }

  /* --------------------------------------------------------- scroll reveal */
  function initReveal() {
    if (reduceMotion || !("IntersectionObserver" in window)) return;
    var targets = document.querySelectorAll(
      ".site-body .section, .site-body .editorial, .site-body .cta-band, .site-body .feature-grid, .site-body .price-grid, " +
      ".site-body .ni-section, .site-body .hero-metrics, .site-body .product-hero, .site-body .pricing-hero, " +
      ".site-body .error-shell, .site-body .about-title, .site-body .help-grid"
    );
    if (!targets.length) return;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    targets.forEach(function (el) {
      /* Elements with the entry animation already own their first paint;
         stacking a second opacity transition only caused a visible blink. */
      if (el.classList.contains("reveal")) return;
      el.classList.add("reveal-scroll");
      observer.observe(el);
    });
    /* Safety net: if the observer is throttled (background tab, older engine)
       the first viewport still becomes readable instead of staying at zero. */
    window.setTimeout(function () {
      targets.forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 1.1 && rect.bottom > 0) {
          el.classList.add("is-visible");
          observer.unobserve(el);
        }
      });
    }, 1100);
  }

  /* ------------------------------------------------------- route progress */
  function initRouteProgress() {
    if (reduceMotion) return;
    var bar = document.createElement("div");
    bar.className = "route-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    var grow = null;
    var started = false;

    function start() {
      if (started) return;
      started = true;
      bar.classList.add("is-active");
      bar.style.width = "16%";
      grow = window.setTimeout(function () { bar.style.width = "78%"; }, 140);
    }

    function reset() {
      if (grow) window.clearTimeout(grow);
      started = false;
      bar.classList.remove("is-active");
      bar.style.width = "0%";
    }

    document.addEventListener("click", function (event) {
      var link = event.target.closest("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;
      var url;
      try { url = new URL(link.href, window.location.href); } catch (e) { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    });

    document.addEventListener("submit", function (event) {
      if (!event.defaultPrevented) start();
    });

    window.addEventListener("pageshow", reset);
  }

  /* ------------------------------------------------------ instant search */
  function initCommandSearch() {
    var dialog = document.getElementById("command");
    if (!dialog || typeof window.fetch !== "function") return;
    var form = dialog.querySelector(".command-form");
    var input = form ? form.querySelector("input[name=q]") : null;
    var panel = dialog.querySelector("[data-command-results]");
    if (!form || !input || !panel) return;

    var endpoint = dialog.getAttribute("data-endpoint");
    panel.setAttribute("role", "listbox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    var timer = null;
    var controller = null;
    var items = [];
    var active = -1;

    function clear() {
      panel.innerHTML = "";
      panel.classList.remove("is-open");
      input.removeAttribute("aria-activedescendant");
      input.setAttribute("aria-expanded", "false");
      items = [];
      active = -1;
    }

    function label(text) {
      var p = document.createElement("p");
      p.className = "command-group";
      p.textContent = text;
      panel.appendChild(p);
    }

    function row(href, title, meta, tag) {
      var a = document.createElement("a");
      a.className = "command-result";
      a.href = href;
      a.id = "command-option-" + items.length;
      a.setAttribute("role", "option");
      var strong = document.createElement("strong");
      strong.textContent = title;
      a.appendChild(strong);
      if (meta) {
        var span = document.createElement("span");
        span.textContent = meta;
        a.appendChild(span);
      }
      if (tag) {
        var badge = document.createElement("em");
        badge.textContent = tag;
        a.appendChild(badge);
      }
      panel.appendChild(a);
      items.push(a);
      return a;
    }

    function render(payload) {
      clear();
      if (!payload) return;
      var query = input.value.trim();
      if (payload.items && payload.items.length) {
        payload.items.forEach(function (item) {
          row(item.href, item.name, item.sku + (item.category ? " · " + item.category : ""));
        });
      }
      if (payload.categories && payload.categories.length) {
        label(dialog.getAttribute("data-categories"));
        payload.categories.forEach(function (cat) {
          row(cat.href, cat.label, "", "");
        });
      }
      if (payload.synonyms && payload.synonyms.length) {
        label(dialog.getAttribute("data-synonyms"));
        payload.synonyms.forEach(function (term) {
          row("/app/artiklar?q=" + encodeURIComponent(term), term, "", "");
        });
      }
      if (!items.length) {
        var empty = document.createElement("p");
        empty.className = "command-empty";
        empty.textContent = dialog.getAttribute("data-empty");
        panel.appendChild(empty);
      } else {
        var all = document.createElement("a");
        all.className = "command-all";
        all.href = "/app/artiklar?q=" + encodeURIComponent(query);
        all.textContent = dialog.getAttribute("data-all") + " →";
        panel.appendChild(all);
      }
      panel.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
    }

    function search() {
      var query = input.value.trim();
      if (query.length < 2) {
        clear();
        return;
      }
      if (controller) controller.abort();
      controller = typeof AbortController === "function" ? new AbortController() : null;
      panel.innerHTML = '<p class="command-loading">' + dialog.getAttribute("data-loading") + "</p>";
      panel.classList.add("is-open");
      fetch(endpoint + "?q=" + encodeURIComponent(query), {
        credentials: "same-origin",
        signal: controller ? controller.signal : undefined,
        headers: { accept: "application/json" },
      })
        .then(function (response) {
          if (!response.ok) throw new Error("search");
          return response.json();
        })
        .then(render)
        .catch(function (error) {
          if (error && error.name === "AbortError") return;
          panel.innerHTML = '<p class="command-empty" role="alert">' + dialog.getAttribute("data-error") + "</p>";
          panel.classList.add("is-open");
          input.setAttribute("aria-expanded", "true");
        });
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(search, 180);
    });

    input.addEventListener("keydown", function (event) {
      if (!items.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach(function (item, index) {
          item.classList.toggle("is-active", index === active);
          item.setAttribute("aria-selected", index === active ? "true" : "false");
        });
        input.setAttribute("aria-activedescendant", items[active].id);
        items[active].scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" && active >= 0) {
        event.preventDefault();
        window.location.href = items[active].href;
      }
    });

    dialog.addEventListener("close", clear);
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  }


  /* ------------------------------------------------------ public navigation */
  /* Keep 100vw-derived full-bleed elements inside the layout viewport. */
  function initViewportVar() {
    var root = document.documentElement;
    function set() {
      var width = Math.max(0, window.innerWidth - root.clientWidth);
      root.style.setProperty("--sbw", width + "px");
    }
    set();
    requestAnimationFrame(set);
    window.addEventListener("resize", set, { passive: true });
  }

  function initPublicMenus() {
    var menus = Array.prototype.slice.call(document.querySelectorAll(".nav-menu"));
    if (!menus.length) return;
    function closeAll(except) {
      menus.forEach(function (menu) {
        if (menu !== except) menu.removeAttribute("open");
      });
    }
    menus.forEach(function (menu) {
      menu.addEventListener("toggle", function () {
        if (menu.open) closeAll(menu);
      });
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".nav-menu")) closeAll(null);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        var open = document.querySelector(".nav-menu[open]");
        if (open) {
          open.removeAttribute("open");
          var summary = open.querySelector("summary");
          if (summary) summary.focus();
        }
      }
    });
    var siteMenu = document.querySelector(".site-menu");
    if (siteMenu) {
      siteMenu.addEventListener("click", function (event) {
        var link = event.target.closest("a");
        if (link) siteMenu.removeAttribute("open");
      });
    }
  }

  /* ---------------------------------------------------------- product preview */
  function initProductPreview() {
    var root = document.querySelector("[data-product-preview]");
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll("[data-preview-tab]"));
    var panels = Array.prototype.slice.call(root.querySelectorAll("[data-preview-panel]"));
    if (!tabs.length || !panels.length) return;
    function activate(name, focus) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute("data-preview-tab") === name;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.setAttribute("tabindex", active ? "0" : "-1");
        if (active && focus) tab.focus();
      });
      panels.forEach(function (panel) {
        var active = panel.getAttribute("data-preview-panel") === name;
        panel.hidden = !active;
        if (active) {
          panel.classList.remove("is-entering");
          void panel.offsetWidth;
          panel.classList.add("is-entering");
        }
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () {
        activate(tab.getAttribute("data-preview-tab"), false);
      });
      tab.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        activate(tabs[next].getAttribute("data-preview-tab"), true);
      });
    });
  }

  function initPlatformTabs() {
    var root = document.querySelector("[data-platform-tabs]");
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll("[data-platform-tab]"));
    var panels = Array.prototype.slice.call(root.querySelectorAll("[data-platform-panel]"));
    if (!tabs.length || !panels.length) return;
    function activate(name, focus) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute("data-platform-tab") === name;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.setAttribute("tabindex", active ? "0" : "-1");
        tab.classList.toggle("is-active", active);
        if (active && focus) {
          tab.focus();
          if (tab.parentElement && tab.parentElement.scrollWidth > tab.parentElement.clientWidth) {
            var left = tab.offsetLeft - tab.parentElement.clientWidth / 2 + tab.offsetWidth / 2;
            tab.parentElement.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
          }
        }
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-platform-panel") !== name;
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () {
        activate(tab.getAttribute("data-platform-tab"), false);
      });
      tab.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        activate(tabs[next].getAttribute("data-platform-tab"), true);
      });
    });
  }

  /* ---------------------------------------------------------------- app rail */
  function initRail() {
    var toggle = document.querySelector("[data-rail-toggle]");
    if (!toggle) return;
    var mobile = window.matchMedia("(max-width: 760px)");
    var rail = document.querySelector("#app-rail");
    var stored = null;
    try {
      stored = localStorage.getItem("lr-rail");
    } catch (e) {
      stored = null;
    }
    if (stored === "collapsed" && !mobile.matches) {
      root.setAttribute("data-rail", "collapsed");
      toggle.setAttribute("aria-expanded", "false");
    }
    function isOpen() {
      return mobile.matches ? root.getAttribute("data-rail") === "open" : root.getAttribute("data-rail") !== "collapsed";
    }
    function sync() {
      toggle.setAttribute("aria-expanded", isOpen() ? "true" : "false");
    }
    toggle.addEventListener("click", function () {
      if (mobile.matches) {
        if (root.getAttribute("data-rail") === "open") root.removeAttribute("data-rail");
        else {
          root.setAttribute("data-rail", "open");
          if (rail) rail.scrollTop = 0;
        }
      } else if (root.getAttribute("data-rail") === "collapsed") {
        root.removeAttribute("data-rail");
        try { localStorage.setItem("lr-rail", "expanded"); } catch (e) {}
      } else {
        root.setAttribute("data-rail", "collapsed");
        try { localStorage.setItem("lr-rail", "collapsed"); } catch (e) {}
      }
      sync();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && root.getAttribute("data-rail") === "open") {
        root.removeAttribute("data-rail");
        sync();
        toggle.focus();
      }
    });
    document.addEventListener("click", function (event) {
      if (root.getAttribute("data-rail") !== "open") return;
      if (event.target.closest(".rail") || event.target.closest("[data-rail-toggle]")) return;
      root.removeAttribute("data-rail");
      sync();
    });
    mobile.addEventListener("change", function () {
      if (root.getAttribute("data-rail") === "open") root.removeAttribute("data-rail");
      sync();
    });
    sync();
  }

  /* ---------------------------------------------------------- data network
     Every [data-net] canvas draws the same idea: a calm lattice of nodes that
     orbit their anchor, links that exist only while two nodes are close, and
     a few signals travelling between them. Structure comes from the lattice,
     life from slightly different periods — never from random scattering. The
     pointer displaces nearby nodes a few pixels and brightens their links.
     One loop per canvas, paused when the tab or the section is out of view. */

  function initDataNet() {
    var targets = document.querySelectorAll("[data-net]");
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].getAttribute("data-net-ready")) continue;
      targets[i].setAttribute("data-net-ready", "1");
      dataNet(targets[i], targets[i].getAttribute("data-net") === "ambient");
    }
  }

  function dataNet(canvas, ambient) {
    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var TAU = Math.PI * 2;
    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    var reduced = motionQuery.matches;
    var nodes = [];
    var signals = [];
    var buckets = [[], [], []];
    var palette = { line: "#2c6b4f", stock: "#2c6b4f", demand: "#12181a", capital: "#b3744c" };
    var w = 0;
    var h = 0;
    var raf = 0;
    var running = false;
    var inView = true;
    var sampleMs = 0;
    var sampleFrames = 0;
    var slowWindows = 0;
    var origin = performance.now();
    var pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false, r: ambient ? 118 : 168 };

    function color(name, fallback) {
      var value = getComputedStyle(canvas).getPropertyValue(name).trim();
      return value || fallback;
    }

    function paintPalette() {
      palette.stock = color("--success", "#2c6b4f");
      palette.line = palette.stock;
      palette.demand = color("--ink", "#12181a");
      palette.capital = color("--copper", "#b3744c");
    }

    function layout() {
      var box = canvas.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) return false;
      w = box.width;
      h = box.height;
      var ratio = Math.min(window.devicePixelRatio || 1, w * h > 620000 ? 1.5 : 2);
      var nextW = Math.round(w * ratio);
      var nextH = Math.round(h * ratio);
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      build(1);
      return true;
    }

    function build(scale) {
      var area = w * h;
      var density = ambient ? 19000 : 9000;
      var cap = ambient ? 56 : 124;
      var floor = ambient ? 26 : 34;
      var target = Math.round((area / density) * scale);
      target = Math.max(floor, Math.min(cap, target));
      var spacing = Math.sqrt(area / Math.max(1, target));
      var cols = Math.max(2, Math.round(w / spacing));
      var rows = Math.max(2, Math.round(h / spacing));
      var cw = w / cols;
      var ch = h / rows;

      nodes.length = 0;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (nodes.length >= target) break;
          var roll = Math.random();
          nodes.push({
            ax: cw * (c + 0.5) + (Math.random() - 0.5) * cw * 0.6,
            ay: ch * (r + 0.5) + (Math.random() - 0.5) * ch * 0.6,
            rx: 5 + Math.random() * 14,
            ry: 4 + Math.random() * 11,
            period: 11000 + Math.random() * 15000,
            phase: Math.random() * TAU,
            spin: Math.random() < 0.5 ? -1 : 1,
            drift: 0.00004 + Math.random() * 0.00008,
            driftPhase: Math.random() * TAU,
            driftX: 5 + Math.random() * 12,
            driftY: 4 + Math.random() * 9,
            kind: roll < 0.62 ? 0 : roll < 0.9 ? 1 : 2,
            pushX: 0,
            pushY: 0,
            x: 0,
            y: 0
          });
        }
      }
      seedSignals();
      step(origin);
    }

    function seedSignals() {
      signals.length = 0;
      var count = ambient ? 2 : Math.min(5, Math.round(nodes.length / 22));
      for (var i = 0; i < count; i++) signals.push(nextSignal(i * 900));
    }

    function nextSignal(offset) {
      var from = Math.floor(Math.random() * nodes.length);
      var to = Math.floor(Math.random() * nodes.length);
      while (to === from && nodes.length > 1) to = Math.floor(Math.random() * nodes.length);
      return { a: from, b: to, t0: performance.now() - offset, dur: 2400 + Math.random() * 2600 };
    }

    function step(now) {
      var px = pointer.x;
      var py = pointer.y;
      var radius = pointer.r;
      var rad2 = radius * radius;
      var t = now - origin;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var angle = (t / n.period) * n.spin * TAU + n.phase;
        var x = n.ax + Math.sin(t * n.drift + n.driftPhase) * n.driftX + Math.cos(angle) * n.rx;
        var y = n.ay + Math.cos(t * n.drift * 0.84 + n.driftPhase) * n.driftY + Math.sin(angle) * n.ry;

        var pushX = 0;
        var pushY = 0;
        if (pointer.active) {
          var dx = x - px;
          var dy = y - py;
          var d2 = dx * dx + dy * dy;
          if (d2 < rad2 && d2 > 0.5) {
            var d = Math.sqrt(d2);
            var falloff = 1 - d / radius;
            var mag = falloff * falloff * (n.kind === 2 ? 4 : 7);
            pushX = (dx / d) * mag;
            pushY = (dy / d) * mag;
          }
        }
        n.pushX += (pushX - n.pushX) * 0.1;
        n.pushY += (pushY - n.pushY) * 0.1;
        n.x = x + n.pushX;
        n.y = y + n.pushY;
      }
    }

    function paint(now) {
      ctx.clearRect(0, 0, w, h);

      var link = ambient ? 98 : 128;
      var link2 = link * link;
      for (var b = 0; b < 3; b++) buckets[b].length = 0;

      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var c = nodes[j];
          var dx = a.x - c.x;
          if (dx > link || dx < -link) continue;
          var dy = a.y - c.y;
          if (dy > link || dy < -link) continue;
          var d2 = dx * dx + dy * dy;
          if (d2 > link2) continue;
          var closeness = 1 - Math.sqrt(d2) / link;
          var alpha = closeness * closeness * (ambient ? 0.3 : 0.5);
          alpha *= 0.55 + 0.45 * Math.sin(now * 0.00035 + a.phase + c.phase) * 0.5 + 0.225;
          if (a.pushX || a.pushY || c.pushX || c.pushY) alpha += closeness * 0.22;
          var slot = alpha > 0.2 ? 2 : alpha > 0.09 ? 1 : 0;
          buckets[slot].push(a.x, a.y, c.x, c.y);
        }
      }

      ctx.lineWidth = ambient ? 0.6 : 0.7;
      ctx.strokeStyle = palette.line;
      var alphas = [0.045, 0.095, 0.17];
      for (var k = 0; k < 3; k++) {
        var segment = buckets[k];
        if (!segment.length) continue;
        ctx.globalAlpha = alphas[k];
        ctx.beginPath();
        for (var s = 0; s < segment.length; s += 4) {
          ctx.moveTo(segment[s], segment[s + 1]);
          ctx.lineTo(segment[s + 2], segment[s + 3]);
        }
        ctx.stroke();
      }

      var sizes = [1.05, 1.5, 1.95];
      var colors = [palette.stock, palette.demand, palette.capital];
      var tones = [0.6, 0.66, 0.74];
      for (var kind = 0; kind < 3; kind++) {
        ctx.beginPath();
        for (var m = 0; m < nodes.length; m++) {
          if (nodes[m].kind !== kind) continue;
          ctx.moveTo(nodes[m].x + sizes[kind], nodes[m].y);
          ctx.arc(nodes[m].x, nodes[m].y, sizes[kind], 0, TAU);
        }
        ctx.fillStyle = colors[kind];
        ctx.globalAlpha = tones[kind] * (ambient ? 0.7 : 1);
        ctx.fill();
      }

      // Capital nodes carry a faint halo: value that is easy to miss otherwise.
      ctx.strokeStyle = palette.capital;
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n].kind !== 2) continue;
        ctx.moveTo(nodes[n].x + 3.6, nodes[n].y);
        ctx.arc(nodes[n].x, nodes[n].y, 3.6, 0, TAU);
      }
      ctx.stroke();

      if (!reduced) {
        for (var q = 0; q < signals.length; q++) {
          var sig = signals[q];
          var progress = (now - sig.t0) / sig.dur;
          if (progress >= 1 || signals.length < 2) {
            signals[q] = nextSignal(0);
            continue;
          }
          var from = nodes[sig.a];
          var to = nodes[sig.b];
          if (!from || !to) continue;
          var eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          var sx = from.x + (to.x - from.x) * eased;
          var sy = from.y + (to.y - from.y) * eased;
          ctx.fillStyle = palette.capital;
          for (var trail = 3; trail > 0; trail--) {
            var back = Math.max(0, eased - trail * 0.035);
            ctx.globalAlpha = 0.1 / trail;
            ctx.beginPath();
            ctx.arc(from.x + (to.x - from.x) * back, from.y + (to.y - from.y) * back, 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.5, 0, TAU);
          ctx.fill();
        }
      }

      if (pointer.active) {
        ctx.strokeStyle = palette.demand;
        ctx.globalAlpha = 0.05;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, pointer.r * 0.42, 0, TAU);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      var delta = now - (loop.last || now);
      loop.last = now;
      pointer.x += (pointer.tx - pointer.x) * 0.15;
      pointer.y += (pointer.ty - pointer.y) * 0.15;
      step(now);
      paint(now);
      adapt(delta);
    }

    function adapt(delta) {
      if (document.hidden || delta <= 0 || delta > 140) return;
      sampleMs += delta;
      sampleFrames++;
      if (sampleFrames < 100) return;
      var average = sampleMs / sampleFrames;
      sampleMs = 0;
      sampleFrames = 0;
      if (average <= 24) {
        slowWindows = 0;
        return;
      }
      slowWindows++;
      if (slowWindows === 2 && nodes.length > 44) {
        build(0.72);
        return;
      }
      if (slowWindows >= 4) {
        cancel();
        paint(performance.now());
      }
    }

    function play() {
      if (running || reduced) return;
      running = true;
      loop.last = 0;
      raf = requestAnimationFrame(loop);
    }

    function cancel() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    function sync() {
      if (reduced) {
        cancel();
        paint(performance.now());
        canvas.classList.add("is-ready");
        return;
      }
      if (!document.hidden && inView) play();
      else cancel();
    }

    function onPointer(event) {
      if (event.pointerType === "touch") return;
      var box = canvas.getBoundingClientRect();
      if (!box.width) return;
      var x = event.clientX - box.left;
      var y = event.clientY - box.top;
      if (x < -60 || y < -60 || x > box.width + 60 || y > box.height + 60) {
        pointer.active = false;
        return;
      }
      pointer.tx = x;
      pointer.ty = y;
      if (!pointer.active) {
        pointer.x = x;
        pointer.y = y;
      }
      pointer.active = true;
    }

    paintPalette();
    if (!layout()) {
      // Hidden on arrival (for example a collapsed panel): wait for a size.
      var retry = new ResizeObserver(function () {
        if (layout()) {
          retry.disconnect();
          paint(performance.now());
          canvas.classList.add("is-ready");
          sync();
        }
      });
      retry.observe(canvas);
      return;
    }

    step(performance.now());
    paint(performance.now());
    canvas.classList.add("is-ready");

    if (!reduced) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("pointerdown", onPointer, { passive: true });
      document.addEventListener("visibilitychange", sync);
      if (motionQuery.addEventListener) {
        motionQuery.addEventListener("change", function (event) {
          reduced = event.matches;
          sync();
        });
      }
    }

    // Kept outside the motion branch: a static frame still follows resizes and
    // theme changes, it just never animates.
    if ("ResizeObserver" in window) {
      var sizes = new ResizeObserver(function () {
        if (!layout()) return;
        paint(performance.now());
      });
      sizes.observe(canvas);
    }

    if ("IntersectionObserver" in window) {
      var seen = new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        sync();
      }, { rootMargin: "160px" });
      seen.observe(canvas);
    }

    if (window.MutationObserver) {
      new MutationObserver(function () {
        paintPalette();
        paint(performance.now());
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }

    sync();
  }

  function init() {
    initDataNet();
    initViewportVar();
    initPublicMenus();
    initProductPreview();
    initPlatformTabs();
    initRail();
    initDelegatedForms();
    initRouteProgress();
    initReveal();
    initRows();
    initCommandSearch();
    initLangSwitcher();
    initCountUp();
    initRanges();
    initForms();
    initFilterPersistence();
    initCopilot();
    initChartFocus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
