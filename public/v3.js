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
      var label = next === "light" ? btn.getAttribute("data-theme-dark-label") : btn.getAttribute("data-theme-light-label");
      if (label) btn.setAttribute("aria-label", label);
    });
  }

  /* ------------------------------------------------------------ motion
     One switch for the whole product. The stored choice wins over the system
     preference, and both are reflected on <html data-motion="on|paused"> so
     CSS and any canvas loop read the same state.
     Beslutet fattas av /motion.js (samma modul som src/ui/motion.ts), så
     lagringsnyckel och tolkning finns på ett enda ställe. */
  var motionModule = null;
  // Valet gäller sidan även när lagringen är blockerad och inte kan läsas tillbaka.
  var pageMotionChoice = null;
  var systemReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function currentMotion() {
    var stored = pageMotionChoice !== null ? pageMotionChoice : motionModule.readStoredMotion();
    return motionModule.resolveMotionPreference(motionModule.prefersReducedMotion(), stored);
  }

  function syncMotionButtons() {
    var paused = root.getAttribute("data-motion") === "paused";
    document.querySelectorAll("[data-motion-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", paused ? "true" : "false");
      var label = btn.getAttribute(paused ? "data-motion-on-label" : "data-motion-off-label");
      if (label) btn.setAttribute("aria-label", label);
      var text = btn.querySelector("span");
      var textLabel = btn.getAttribute(paused ? "data-motion-on-text" : "data-motion-off-text");
      if (text && textLabel) text.textContent = textLabel;
    });
  }

  function applyMotion() {
    if (!motionModule) return;
    motionModule.applyMotionPreference(currentMotion());
    syncMotionButtons();
  }

  function toggleMotion() {
    if (!motionModule) return;
    pageMotionChoice = currentMotion().enabled;
    /* storage may be disabled; the choice still holds for this page */
    motionModule.writeStoredMotion(pageMotionChoice);
    applyMotion();
  }

  import("/motion.js")
    .then(function (module) {
      motionModule = module;
      applyMotion();
    })
    .catch(function () {
      /* Utan modulen gäller CSS-regeln för prefers-reduced-motion som tidigare. */
    });
  if (typeof systemReduce.addEventListener === "function") {
    systemReduce.addEventListener("change", function () {
      if (!motionModule || currentMotion().source === "user") return;
      applyMotion();
    });
  }

  document.addEventListener("click", function (event) {
    var motion = event.target.closest("[data-motion-toggle]");
    if (motion) {
      event.preventDefault();
      toggleMotion();
      return;
    }

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

  /* ------------------------------------------------ bulk row selection */
  (function () {
    var form = document.querySelector("[data-pick-form]");
    if (!form) return;
    var all = form.querySelector("[data-pick-all]");
    var count = form.querySelector("[data-pick-count]");
    var submit = form.querySelector("[data-pick-submit]");
    var boxes = function () {
      return Array.prototype.slice.call(form.querySelectorAll('input[name="sku"]'));
    };
    var sv = document.documentElement.lang !== "en";
    function sync() {
      var picked = boxes().filter(function (box) { return box.checked; }).length;
      if (count) count.textContent = sv ? picked + " markerade" : picked + " selected";
      if (submit) submit.disabled = picked === 0;
      if (all) {
        var total = boxes().length;
        all.checked = total > 0 && picked === total;
        all.indeterminate = picked > 0 && picked < total;
      }
    }
    if (all) {
      all.addEventListener("change", function () {
        boxes().forEach(function (box) { box.checked = all.checked; });
        sync();
      });
    }
    form.addEventListener("change", function (event) {
      if (event.target && event.target.name === "sku") sync();
    });
    sync();
  })();

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


  /* --------------------------------------------------- matrix as a filter */
  function initMatrix() {
    var cells = document.querySelectorAll("[data-matrix-cell]");
    var panel = document.querySelector("[data-matrix-panel]");
    if (!cells.length || !panel) return;

    function open(key) {
      panel.hidden = false;
      var detail = null;
      panel.querySelectorAll("[data-matrix-detail]").forEach(function (node) {
        var on = node.getAttribute("data-matrix-detail") === key;
        node.hidden = !on;
        if (on) detail = node;
      });
      cells.forEach(function (cell) {
        var on = cell.getAttribute("data-matrix-cell") === key;
        cell.classList.toggle("is-selected", on);
        cell.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (detail) {
        detail.setAttribute("tabindex", "-1");
        detail.focus({ preventScroll: true });
        if (detail.scrollIntoView) detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    cells.forEach(function (cell) {
      cell.addEventListener("click", function (event) {
        event.preventDefault();
        open(cell.getAttribute("data-matrix-cell"));
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || panel.hidden) return;
      panel.hidden = true;
      cells.forEach(function (cell) {
        cell.classList.remove("is-selected");
        cell.removeAttribute("aria-pressed");
      });
    });
  }

  /* --------------------------------------------- health map as a selector */
  function initHealthMap() {
    var nodes = document.querySelectorAll(".chart-healthmap [data-hm-sku]");
    var panel = document.querySelector("[data-hm-panel]");
    if (!nodes.length || !panel) return;

    function field(name) {
      return panel.querySelector("[data-hm-" + name + "]");
    }
    var fields = {
      name: field("name"),
      sku: field("sku"),
      status: field("status"),
      score: field("score"),
      value: field("value"),
      stock: field("stock"),
      cover: field("cover")
    };
    var link = field("open");

    function select(node) {
      nodes.forEach(function (other) {
        var on = other === node;
        other.classList.toggle("is-selected", on);
        other.setAttribute("aria-pressed", on ? "true" : "false");
      });
      Object.keys(fields).forEach(function (key) {
        if (fields[key]) fields[key].textContent = node.getAttribute("data-hm-" + key) || "–";
      });
      if (link) link.setAttribute("href", node.getAttribute("data-hm-href") || "#");
      panel.hidden = false;
    }

    nodes.forEach(function (node) {
      node.addEventListener("click", function () { select(node); });
      node.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select(node);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || panel.hidden) return;
      panel.hidden = true;
      nodes.forEach(function (node) {
        node.classList.remove("is-selected");
        node.removeAttribute("aria-pressed");
      });
    });
  }

  /* ----------------------------------------------------- cross highlight */
  function initCrossHighlight() {
    var nodes = document.querySelectorAll("[data-sku]");
    if (!nodes.length) return;
    var frames = !("requestAnimationFrame" in window);
    var pending = null;

    function paint(sku) {
      pending = null;
      nodes.forEach(function (node) {
        node.classList.toggle("is-cross", sku !== null && node.getAttribute("data-sku") === sku);
      });
      document.body.classList.toggle("is-crossing", sku !== null);
      if (sku !== null) document.body.setAttribute("data-cross-sku", sku);
      else document.body.removeAttribute("data-cross-sku");
    }

    /* Paint immediately: pointerover already fires only when the target
       changes, and deferring to rAF left the state unpainted in a background
       tab (rAF does not run there). */
    function show(sku) {
      void frames;
      void pending;
      paint(sku);
    }

    document.addEventListener("pointerover", function (event) {
      var hit = event.target.closest("[data-sku]");
      if (!hit || !hit.closest(".chart-matrix, .chart-healthmap, .priority-list, .data-table, .matrix-panel")) return;
      show(hit.getAttribute("data-sku"));
    });
    document.addEventListener("pointerout", function (event) {
      var hit = event.target.closest("[data-sku]");
      if (!hit) return;
      var to = event.relatedTarget && event.relatedTarget.closest ? event.relatedTarget.closest("[data-sku]") : null;
      if (to && to.getAttribute("data-sku") === hit.getAttribute("data-sku")) return;
      show(null);
    });
    document.addEventListener("focusin", function (event) {
      var hit = event.target.closest("[data-sku]");
      if (hit) show(hit.getAttribute("data-sku"));
    });
    document.addEventListener("focusout", function () { show(null); });
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
      ".site-body .error-shell, .site-body .about-reveal, .site-body .help-grid"
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
     life from slightly different periods - never from random scattering. The
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
    initMatrix();
    initHealthMap();
    initCrossHighlight();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* Public warehouse world. The section is optional and heavy, so it is loaded
   after first paint, when the browser is idle, and never on reduced motion. */
(function () {
  var root = document.querySelector("[data-world]");
  if (!root) return;
  function load() {
    import("/world/boot.js?v=20261124a").then(function (module) { module.bootWorld(); }).catch(function () {});
  }
  function start() {
    if (typeof requestIdleCallback === "function") requestIdleCallback(load, { timeout: 2200 });
    else setTimeout(load, 600);
  }
  /* Nothing 3D is fetched until the reader actually scrolls towards it. The
     landing page's LCP and TBT must not pay for a scene nobody looked at, and
     a lab run that never scrolls loads no three.js at all. */
  let started = false;
  function whenNear() {
    if (started) return;
    started = true;
    start();
  }
  if (location.hash.includes("varld")) {
    window.addEventListener("load", whenNear, { once: true });
  } else {
    window.addEventListener("scroll", whenNear, { once: true, passive: true });
    window.addEventListener("hashchange", whenNear, { once: true });
  }
})();

/* ------------------------------------------------------ signed-in world */
/* Live Warehouse 2.0. The 3D view is a second rendering of the same table:
   the payload comes from the layout engine, the renderer only draws it, and
   the simulation writes stock changes back to the table. It loads only when
   the reader asks for 3D, on a viewport wide enough for it, and never when
   motion is paused: then the table is the view. */
(function () {
  var root = document.querySelector("[data-app-world]");
  if (!root) return;
  var dataNode = root.querySelector("[data-aw-data]");
  if (!dataNode) return;
  var payload;
  try { payload = JSON.parse(dataNode.textContent || "{}"); } catch (err) { return; }

  var sv = payload.locale !== "en";
  var wrap = root.querySelector("[data-aw-viewport]");
  var canvas = root.querySelector("[data-aw-canvas]");
  var skeleton = root.querySelector("[data-aw-skeleton]");
  var panel = root.querySelector("[data-aw-panel]");
  var body = root.querySelector("[data-aw-panel-body]");
  var note = root.querySelector("[data-aw-mode-note]");
  var visibleNote = root.querySelector("[data-aw-visible-note]");
  var toggles = root.querySelectorAll("[data-aw-view]");
  var world = null;
  var loading = false;
  var playing = false;
  var selected = null;
  var stockBySku = {};
  var totalArticles = (payload.summary && payload.summary.articles) || (payload.slots || []).length || (payload.blocks || []).length;
  var searchResults = root.querySelector("[data-aw-search-results]");
  var searchHits = [];
  var searchSeq = 0;
  // Slot payload for the detail layout (pallet count and fill are a property
  // of the placement, not of the article record).
  var slotBySku = {};
  (payload.slots || []).forEach(function (slot) { if (slot && slot.sku) slotBySku[slot.sku] = slot; });

  /* Deterministic simulation. The engine is loaded as the same TypeScript
     module the server and tests use, then runs on the analysis snapshot. */
  var simInput = payload.simulation || null;
  var portfolio = payload.portfolio || null;
  var portfolioMode = Boolean(portfolio);
  var scenarioRequest = 0;
  var simEngine = null;
  var simRun = null;
  var simDay = 0;
  var simSpeed = 1;
  var simTimer = null;
  var simZone = "all";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var narrow = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;

  var TEXT = {
    play: sv ? "Spela" : "Play",
    pause: sv ? "Pausa" : "Pause",
    reset: sv ? "Återställ" : "Reset",
    playFlow: sv ? "Spela upp flödet" : "Play flow",
    visible: sv ? "av" : "of",
    itemsVisible: sv ? "artiklar synliga" : "items visible",
  };

  function formatNumber(value) {
    return new Intl.NumberFormat(sv ? "sv-SE" : "en-US", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }
  function formatMoney(value) {
    return new Intl.NumberFormat(sv ? "sv-SE" : "en-US", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(Number(value) || 0);
  }
  function formatDate(value) {
    return value == null ? "–" : formatNumber(value) + (sv ? " d" : " d");
  }

  function applyView(view) {
    root.setAttribute("data-view", view);
    if (wrap) wrap.hidden = view !== "3d";
    toggles.forEach(function (btn) {
      var on = btn.getAttribute("data-aw-view") === view;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("btn-ghost", !on);
    });
    if (view === "3d" && !world) boot();
    if (world && view === "3d") world.frame();
  }

  function stats(next) {
    root.setAttribute("data-draw-calls", next.drawCalls);
    root.setAttribute("data-fps", next.fps || 0);
    window.__appWorld = next;
  }

  function boot() {
    if (loading || world) return;
    loading = true;
    if (skeleton) skeleton.hidden = false;
    import("/world/app-world.js?v=20261124b").then(function (module) {
      world = module.createAppWorld({
        root: root,
        canvas: canvas,
        model: payload,
        locale: payload.locale,
        onSelect: function (sku) { pick(sku); },
        onStock: function (sku, stock) { setStock(sku, stock); },
        onVisibility: function (count) {
          root.setAttribute("data-visible-world", String(count));
          if (visibleNote) visibleNote.textContent = count + " " + TEXT.visible + " " + totalArticles + " " + TEXT.itemsVisible;
        },
        onMode: applyModeUi,
        onStats: stats,
        onExpandCluster: function (block, index) { loadCluster(block, index); },
      });
      world.setStatsHook(stats);
      root.__world = world;
      world.setFilter(currentFilter());
      world.setMode(root.getAttribute("data-mode") || "physical");
      if (simRun) {
        world.setSimulation(simRun);
        world.applySimDay(simDay, false);
      }
      var aisleLabel = root.querySelector("[data-aw-aisle]");
      if (aisleLabel) {
        world.setAisleHook(function (aisle) {
          aisleLabel.textContent = aisle ? aisle.label : (sv ? "Översikt" : "Overview");
        });
      }
      if (skeleton) skeleton.hidden = true;
      loading = false;
      applyView("3d");
      syncWhatIf();
    }).catch(function () {
      loading = false;
      if (skeleton) skeleton.hidden = true;
      root.setAttribute("data-webgl", "unavailable");
      applyView("table");
    });
  }

  var helpButton = root.querySelector("[data-aw-help]");
  if (helpButton && note) {
    helpButton.addEventListener("click", function () {
      var open = note.hidden;
      note.hidden = !open;
      helpButton.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function applyModeUi(mode) {
    if (note && payload.modeNotes && payload.modeNotes[mode]) note.textContent = payload.modeNotes[mode];
    root.setAttribute("data-mode", mode);
    root.querySelectorAll("[data-aw-mode]").forEach(function (btn) {
      var on = btn.getAttribute("data-aw-mode") === mode;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.classList.toggle("is-on", on);
    });
  }

  function currentFilter() {
    var out = {};
    root.querySelectorAll("[data-aw-filter]").forEach(function (select) {
      out[select.getAttribute("data-aw-filter")] = select.value;
    });
    var search = root.querySelector("[data-aw-search]");
    out.query = search ? search.value.trim() : "";
    return out;
  }

  var tableState = { page: 1, sort: "value", dir: "desc" };
  var tableSeq = 0;
  var tableTimer = null;

  function updateSortHeaders() {
    root.querySelectorAll("[data-aw-sort-th]").forEach(function (th) {
      var active = th.getAttribute("data-aw-sort-th") === tableState.sort;
      th.setAttribute("aria-sort", active ? (tableState.dir === "asc" ? "ascending" : "descending") : "none");
      var icon = th.querySelector("[data-aw-sort-icon]");
      if (icon) icon.textContent = active ? (tableState.dir === "asc" ? "↑" : "↓") : "↕";
    });
  }

  function loadTable(page, immediate) {
    clearTimeout(tableTimer);
    var run = function () {
      var state = currentFilter();
      var params = new URLSearchParams();
      params.set("analys", payload.analysisId || "");
      params.set("page", String(page || 1));
      params.set("sort", tableState.sort);
      params.set("dir", tableState.dir);
      ["category", "abc", "xyz", "status"].forEach(function (key) {
        if (state[key]) params.set(key, state[key]);
      });
      if (state.query) params.set("q", state.query);
      var token = ++tableSeq;
      var body = root.querySelector("[data-aw-rows]");
      if (body) body.setAttribute("aria-busy", "true");
      root.setAttribute("data-table-loading", "true");
      fetch("/app/lagervarld/tabell?" + params.toString(), { headers: { accept: "application/json" } })
        .then(function (response) {
          if (!response.ok) throw new Error("table_http_" + response.status);
          return response.json();
        })
        .then(function (data) {
          if (token !== tableSeq) return;
          if (body) {
            body.innerHTML = data.html;
            body.setAttribute("aria-busy", "false");
            body.querySelectorAll("[data-aw-stock]").forEach(function (cell) {
              var sku = cell.getAttribute("data-aw-stock");
              if (sku && Object.prototype.hasOwnProperty.call(stockBySku, sku)) cell.textContent = formatNumber(stockBySku[sku]);
            });
            if (selected) {
              body.querySelectorAll("tr[data-sku]").forEach(function (row) {
                row.classList.toggle("is-selected", row.getAttribute("data-sku") === selected);
              });
            }
          }
          tableState.page = data.page;
          var pager = root.querySelector("[data-aw-pager]");
          if (pager) pager.outerHTML = data.pager;
          var note = root.querySelector("[data-aw-table-note]");
          if (note) {
            var link = note.querySelector("a");
            note.textContent = data.note + " ";
            if (link) note.appendChild(link);
          }
          root.setAttribute("data-visible-rows", String(data.total));
          root.removeAttribute("data-table-loading");
          root.removeAttribute("data-table-error");
          updateSortHeaders();
        })
        .catch(function () {
          if (token !== tableSeq) return;
          root.removeAttribute("data-table-loading");
          root.setAttribute("data-table-error", "true");
          if (body) body.setAttribute("aria-busy", "false");
          var note = root.querySelector("[data-aw-table-note]");
          if (note) note.textContent = sv ? "Kunde inte uppdatera tabellen. Försök igen." : "Could not update the table. Try again.";
        });
    };
    if (immediate) run();
    else tableTimer = setTimeout(run, 140);
  }

  function filterTable() {
    loadTable(1, false);
  }

  function setStock(sku, stock) {
    stockBySku[sku] = stock;
    var cell = root.querySelector('[data-aw-stock="' + (window.CSS && CSS.escape ? CSS.escape(sku) : sku) + '"]');
    if (cell) cell.textContent = formatNumber(stock);
    if (selected === sku) {
      var node = root.querySelector("[data-aw-panel-stock]");
      if (node) node.textContent = formatNumber(stock);
      var available = root.querySelector("[data-aw-panel-available]");
      if (available && available.getAttribute("data-base-available")) {
        available.textContent = formatNumber(Number(available.getAttribute("data-base-available")) + (stock - Number(available.getAttribute("data-base-stock"))));
      }
    }
  }

  function sparkline(values) {
    var svg = root.querySelector("[data-aw-panel-spark]");
    if (!svg) return;
    if (!values || !values.length) { svg.innerHTML = ""; return; }
    var max = Math.max.apply(null, values.concat([1]));
    var step = 220 / Math.max(1, values.length - 1);
    var points = values.map(function (value, index) {
      return (index * step).toFixed(1) + "," + (42 - (value / max) * 36).toFixed(1);
    }).join(" ");
    svg.innerHTML =
      '<polygon points="0,46 ' + points + ' 220,46" fill="rgba(217,163,95,.12)"></polygon>' +
      '<polyline points="' + points + '" fill="none" stroke="#d9a35f" stroke-width="1.6" stroke-linejoin="round"></polyline>';
    var trend = root.querySelector("[data-aw-panel-trend]");
    if (trend) {
      var last = values[values.length - 1];
      var prev = values.length > 1 ? values[values.length - 2] : last;
      var pct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0;
      trend.textContent = (pct > 0 ? "+" : "") + pct + " %";
      trend.setAttribute("data-tone", pct > 0 ? "up" : pct < 0 ? "down" : "flat");
    }
  }

  function set(name, value) {
    var node = root.querySelector("[data-aw-panel-" + name + "]");
    if (node) node.textContent = value == null || value === "" ? "–" : value;
  }

  function pick(sku) {
    selected = sku;
    root.querySelectorAll("[data-aw-rows] tr").forEach(function (row) {
      row.classList.toggle("is-selected", row.getAttribute("data-sku") === sku);
    });
    if (!panel) return;
    fetch("/app/lagervarld/artikel/" + encodeURIComponent(sku), { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (item) {
        if (!item) return;
        if (!body) return;
        body.hidden = false;
        var STATUS = sv
          ? { balanced: "Balanserat", overstock: "Överlager", stockout: "Bristrisk", inactive: "Inaktivt lager" }
          : { balanced: "Balanced", overstock: "Overstock", stockout: "At risk", inactive: "Inactive" };
        set("name", item.name);
        set("sku", item.sku);
        set("status", STATUS[item.status] || item.status);
        set("category", item.category || (sv ? "Utan kategori" : "Uncategorised"));
        set("supplier", item.supplier);
        set("class", item.abc + (item.xyz ? item.xyz : "–"));
        set("location", item.location);
        var slot = slotBySku[item.sku];
        set("pallets", slot && slot.pallets != null ? formatNumber(slot.pallets) : "–");
        set("fill", slot && slot.fill != null ? Math.round(slot.fill * 100) + " %" : "–");
        set("stock", formatNumber(stockBySku[item.sku] != null ? stockBySku[item.sku] : item.stock));
        var availableNode = root.querySelector("[data-aw-panel-available]");
        if (availableNode) {
          availableNode.setAttribute("data-base-stock", String(item.stock));
          availableNode.setAttribute("data-base-available", String(item.available));
          availableNode.textContent = formatNumber(item.available + ((stockBySku[item.sku] != null ? stockBySku[item.sku] : item.stock) - item.stock));
        }
        set("value", formatMoney(item.value));
        set("cost", formatMoney(item.cost));
        set("price", item.price == null ? "–" : formatMoney(item.price));
        set("margin", item.marginPct == null ? "–" : item.marginPct + " %");
        set("cover", formatDate(item.coverDays));
        set("reorder", formatNumber(item.reorderPoint));
        set("overstock", item.overstockQty > 0 ? formatNumber(item.overstockQty) : "–");
        set("demand", formatNumber(item.avgMonthly));
        set("action", item.actionLabel);
        set("why", item.why);
        sparkline(item.demand || []);
        var open = root.querySelector("[data-aw-panel-open]");
        if (open) open.setAttribute("href", item.href);
        var focus = root.querySelector("[data-aw-panel-focus]");
        if (focus) focus.setAttribute("data-focus-sku", item.sku);
      })
      .catch(function () {});
  }

  function focusSkuInWorld(sku) {
    if (!world) return false;
    if (world.focusSku(sku)) return true;
    // Above the detail budget the article is inside an aggregate cluster.
    // Resolve its exact server-side location, expand that cluster on demand
    // and put the camera on the item's shelf level.
    fetch("/app/lagervarld/artikel/" + encodeURIComponent(sku), { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (item) {
        if (item && item.locationPoint) focusLocation(item.locationPoint);
      })
      .catch(function () {});
    return true;
  }

  function focusSku(sku) {
    applyView("3d");
    var stage = root.querySelector(".aw-stage");
    if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start", behavior: "smooth" });
    pick(sku);
    if (focusSkuInWorld(sku)) return;
    var attempt = 0;
    var timer = setInterval(function () {
      attempt++;
      if (world) { focusSkuInWorld(sku); clearInterval(timer); }
      else if (attempt > 40) {
        clearInterval(timer);
        var fallback = root.querySelector('[data-aw-rows] tr[data-sku="' + sku.replace(/"/g, '\\"') + '"]');
        if (fallback) { fallback.hidden = false; fallback.scrollIntoView({ block: "center" }); }
      }
    }, 100);
  }

  function loadCluster(block, index) {
    if (!world) return;
    var id = (block && block.id) || "cluster-" + index;
    fetch("/app/lagervarld/kluster/" + encodeURIComponent(id) + "?analys=" + encodeURIComponent(payload.analysisId || ""), { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (detail) {
        if (!detail || !world) return;
        world.showClusterDetails(detail);
        root.setAttribute("data-aw-cluster", String(detail.cluster.index));
        if (visibleNote) {
          visibleNote.textContent = detail.cluster.label + " · " + formatNumber(detail.cluster.articles) + " " + (sv ? "artiklar" : "items");
        }
      })
      .catch(function () {});
  }

  function focusLocation(point) {
    if (!world || !point) return;
    if (point.clusterIndex == null) {
      world.focusAt(point);
      return;
    }
    var id = point.clusterId || "cluster-" + point.clusterIndex;
    fetch("/app/lagervarld/kluster/" + encodeURIComponent(id) + "?analys=" + encodeURIComponent(payload.analysisId || ""), { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (detail) {
        if (!world) return;
        if (detail) world.showClusterDetails(detail);
        world.focusAt(point);
      })
      .catch(function () { world.focusAt(point); });
  }

  function renderSearchHits(items) {
    if (!searchResults) return;
    searchHits = items || [];
    if (!searchHits.length) {
      searchResults.hidden = true;
      searchResults.innerHTML = "";
      return;
    }
    searchResults.innerHTML = searchHits.map(function (item, index) {
      return '<button class="aw-search-hit" type="button" data-aw-search-hit="' + index + '">' +
        '<span class="aw-search-hit-main"><strong>' + escapeHtml(item.name) + '</strong>' +
        '<small>' + escapeHtml(item.sku) + ' · ' + escapeHtml(item.category || (sv ? "Utan kategori" : "Uncategorised")) + '</small></span>' +
        '<span class="aw-search-hit-loc">' + escapeHtml(item.location) + '</span>' +
        '<span class="aw-search-hit-value">' + formatMoney(item.value) + '</span></button>';
    }).join("");
    searchResults.hidden = false;
  }

  function focusSearchHit(item) {
    if (!item) return;
    if (searchResults) searchResults.hidden = true;
    applyView("3d");
    var stage = root.querySelector(".aw-stage");
    if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start", behavior: "smooth" });
    pick(item.sku);
    focusLocation(item.locationPoint);
  }

  if (searchResults) {
    searchResults.addEventListener("click", function (event) {
      var button = event.target.closest("[data-aw-search-hit]");
      if (!button) return;
      focusSearchHit(searchHits[Number(button.getAttribute("data-aw-search-hit"))]);
    });
  }

  root.addEventListener("click", function (event) {
    var focus = event.target.closest("[data-world-focus]");
    if (focus) {
      var sku = focus.getAttribute("data-world-focus");
      if (sku) focusSku(sku);
      return;
    }
    var sort = event.target.closest("[data-aw-sort]");
    if (sort) {
      var key = sort.getAttribute("data-aw-sort");
      if (!key) return;
      if (tableState.sort === key) tableState.dir = tableState.dir === "asc" ? "desc" : "asc";
      else {
        tableState.sort = key;
        tableState.dir = key === "name" || key === "category" ? "asc" : "desc";
      }
      updateSortHeaders();
      loadTable(1, true);
      return;
    }
    var pageButton = event.target.closest("[data-aw-page]");
    if (pageButton) {
      var page = Number(pageButton.getAttribute("data-aw-page"));
      if (Number.isFinite(page) && page > 0) loadTable(page, true);
    }
  });

  toggles.forEach(function (btn) {
    btn.addEventListener("click", function () { applyView(btn.getAttribute("data-aw-view")); });
  });

  root.querySelectorAll("[data-aw-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-aw-mode");
      applyView("3d");
      applyModeUi(mode);
      if (world) world.setMode(mode);
      else boot();
    });
  });

  var camReset = root.querySelector("[data-aw-cam-reset]");
  if (camReset) {
    camReset.addEventListener("click", function () {
      if (world) world.resetView();
      var label = root.querySelector("[data-aw-aisle]");
      if (label) label.textContent = sv ? "Översikt" : "Overview";
    });
  }
  var camZoomIn = root.querySelector("[data-aw-zoom-in]");
  if (camZoomIn) camZoomIn.addEventListener("click", function () { if (world) world.zoom(0.78); });
  var camZoomOut = root.querySelector("[data-aw-zoom-out]");
  if (camZoomOut) camZoomOut.addEventListener("click", function () { if (world) world.zoom(1.28); });
  var aislePrev = root.querySelector("[data-aw-aisle-prev]");
  if (aislePrev) aislePrev.addEventListener("click", function () { if (world) world.stepAisle(-1); });
  var aisleNext = root.querySelector("[data-aw-aisle-next]");
  if (aisleNext) aisleNext.addEventListener("click", function () { if (world) world.stepAisle(1); });

  root.querySelectorAll("[data-aw-zone]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      root.querySelectorAll("[data-aw-zone]").forEach(function (other) { other.setAttribute("aria-pressed", "false"); });
      btn.setAttribute("aria-pressed", "true");
      simZone = btn.getAttribute("data-aw-zone") || "all";
      applyView("3d");
      if (world) world.focusZone(simZone);
      renderEvents();
    });
  });
  var allZone = root.querySelector('[data-aw-zone="all"]');
  if (allZone) allZone.setAttribute("aria-pressed", "true");

  root.querySelectorAll("[data-aw-filter]").forEach(function (select) {
    select.addEventListener("change", function () {
      filterTable();
      if (world) world.setFilter(currentFilter());
    });
  });

  var search = root.querySelector("[data-aw-search]");
  var searchTimer = null;
  if (search) {
    search.addEventListener("input", function () {
      filterTable();
      if (world) world.setFilter(currentFilter());
      clearTimeout(searchTimer);
      var query = search.value.trim();
      if (query.length < 2) {
        searchSeq++;
        renderSearchHits([]);
        return;
      }
      searchTimer = setTimeout(function () {
        var token = ++searchSeq;
        fetch("/app/lagervarld/sok?q=" + encodeURIComponent(query) + "&analys=" + encodeURIComponent(payload.analysisId || ""), { headers: { accept: "application/json" } })
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (data) {
            if (token !== searchSeq || !data) return;
            renderSearchHits(data.items || []);
          })
          .catch(function () {});
      }, 180);
    });
    search.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      if (searchHits.length) {
        event.preventDefault();
        focusSearchHit(searchHits[0]);
        return;
      }
      var hit = root.querySelector("[data-aw-rows] tr:not([hidden]) [data-world-focus]");
      if (hit) {
        event.preventDefault();
        focusSku(hit.getAttribute("data-world-focus"));
      }
    });
  }

  root.querySelectorAll("[data-aw-quick]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var status = chip.getAttribute("data-aw-quick");
      root.querySelectorAll("[data-aw-quick]").forEach(function (other) { other.classList.remove("is-on"); });
      chip.classList.add("is-on");
      var select = root.querySelector('[data-aw-filter="status"]');
      if (select) select.value = status;
      filterTable();
      if (world) world.setFilter(currentFilter());
    });
  });

  var resetButton = root.querySelector("[data-aw-reset]");
  function resetFilters() {
    var form = root.querySelector("[data-aw-filters]");
    if (form) form.reset();
    root.querySelectorAll("[data-aw-quick]").forEach(function (chip) { chip.classList.remove("is-on"); });
    var all = root.querySelector('[data-aw-quick=""]');
    if (all) all.classList.add("is-on");
    filterTable();
    if (world) world.setFilter(currentFilter());
    renderSearchHits([]);
  }
  root.querySelectorAll("[data-aw-filters] [data-aw-reset]").forEach(function (btn) {
    btn.addEventListener("click", resetFilters);
  });

  root.querySelectorAll("[data-aw-panel-focus]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var sku = btn.getAttribute("data-focus-sku") || selected;
      if (sku && world) world.focusSku(sku);
    });
  });

  root.querySelectorAll("[data-aw-panel-open]").forEach(function (link) {
    link.addEventListener("click", function () {
      if (selected) link.setAttribute("href", articleHref(selected));
    });
  });

  /* ------------------------------------------------------ simulation UI */
  var simDayEl = root.querySelector("[data-aw-day]");
  var simDaysOut = root.querySelector("[data-aw-days-out]");
  var simDateEl = root.querySelector("[data-aw-date]");
  var simScrub = root.querySelector("[data-aw-scrub]");
  var simProgress = root.querySelector("[data-aw-progress]");
  var simEvents = root.querySelector("[data-aw-events]");
  var simEventCount = root.querySelector("[data-aw-event-count]");
  var presetSelect = root.querySelector("[data-aw-preset]");
  var daysSelect = root.querySelector("[data-aw-days]");
  var speedSelect = root.querySelector("[data-aw-speed]");

  var STATUS_TEXT = sv
    ? { balanced: "Balanserat", overstock: "Överlager", stockout: "Bristrisk", inactive: "Inaktivt lager" }
    : { balanced: "Balanced", overstock: "Overstock", stockout: "At risk", inactive: "Inactive" };
  var EVENT_TEXT = sv
    ? {
        delivery_arrived: "Inleverans",
        delivery_delayed: "Försenad leverans",
        order_picked: "Plockad order",
        shipment_sent: "Utgående leverans",
        replenishment_needed: "Påfyllningsbehov",
        low_stock: "Låg lagernivå",
        overstock: "Överlager",
        stockout: "Brist",
        count_mismatch: "Lageravvikelse",
        transfer: "Förflyttning",
        demand_spike: "Efterfrågan",
      }
    : {
        delivery_arrived: "Delivery",
        delivery_delayed: "Delayed delivery",
        order_picked: "Order picked",
        shipment_sent: "Shipment",
        replenishment_needed: "Replenishment",
        low_stock: "Low stock",
        overstock: "Overstock",
        stockout: "Stockout",
        count_mismatch: "Count mismatch",
        transfer: "Transfer",
        demand_spike: "Demand spike",
      };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function articleHref(sku) {
    return "/app/artiklar/" + encodeURIComponent(sku) + "?analys=" + encodeURIComponent(payload.analysisId || "");
  }
  function setText(selector, value) {
    var node = root.querySelector(selector);
    if (node) node.textContent = value;
  }
  function syncPlayButtons() {
    root.querySelectorAll("[data-aw-play]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", playing ? "true" : "false");
      var label = btn.querySelector("span");
      if (label) label.textContent = playing ? TEXT.pause : TEXT.play;
      var glyph = btn.querySelector("svg");
      if (glyph) {
        glyph.innerHTML = playing
          ? '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>'
          : '<path d="M7 4l13 8-13 8V4Z"/>';
      }
    });
    root.setAttribute("data-sim-playing", playing ? "true" : "false");
  }
  function scenarioFromControls() {
    if (!simEngine && !portfolioMode) return null;
    var preset = (presetSelect && presetSelect.value) || "normal";
    var presets = simEngine ? simEngine.SIM_PRESETS : null;
    var base = (presets && presets[preset]) || {
      demandPct: 0,
      leadDays: 0,
      safetyPct: 0,
      moqPct: 0,
      delayDeliveries: false,
      delayRate: 0.04,
    };
    var value = function (selector, fallback) {
      var input = root.querySelector(selector);
      return input ? Number(input.value) : fallback;
    };
    var delay = root.querySelector("[data-aw-sc-delay]");
    var sku = root.querySelector("[data-aw-sc-sku]");
    var boosted = sku && sku.value ? sku.value : null;
    return {
      preset: preset,
      days: Number(daysSelect && daysSelect.value) || 90,
      demandPct: value("[data-aw-sc-demand]", base.demandPct),
      leadDays: value("[data-aw-sc-lead]", base.leadDays),
      safetyPct: value("[data-aw-sc-safety]", base.safetyPct),
      moqPct: value("[data-aw-sc-moq]", base.moqPct),
      delayDeliveries: delay ? delay.checked : base.delayDeliveries,
      delayRate: preset === "custom" ? (delay && delay.checked ? 0.35 : 0.04) : base.delayRate,
      sku: boosted,
      boostPct: value("[data-aw-sc-boost]", 0),
    };
  }
  function syncScenarioLabels() {
    var demand = root.querySelector("[data-aw-sc-demand]");
    var lead = root.querySelector("[data-aw-sc-lead]");
    var safety = root.querySelector("[data-aw-sc-safety]");
    var moq = root.querySelector("[data-aw-sc-moq]");
    var boost = root.querySelector("[data-aw-sc-boost]");
    var sign = function (n) { return n > 0 ? "+" : n < 0 ? "−" : ""; };
    setText("[data-aw-sc-demand-out]", sign(Number(demand && demand.value)) + Math.abs(Number(demand && demand.value) || 0) + " %");
    setText("[data-aw-sc-lead-out]", sign(Number(lead && lead.value)) + Math.abs(Number(lead && lead.value) || 0) + " " + (sv ? "dagar" : "days"));
    setText("[data-aw-sc-safety-out]", sign(Number(safety && safety.value)) + Math.abs(Number(safety && safety.value) || 0) + " %");
    setText("[data-aw-sc-moq-out]", sign(Number(moq && moq.value)) + Math.abs(Number(moq && moq.value) || 0) + " %");
    setText("[data-aw-sc-boost-out]", Math.abs(Number(boost && boost.value) || 0) + " %");
  }
  function applyPresetFields(preset) {
    if (!simEngine) return;
    var base = simEngine.SIM_PRESETS[preset];
    if (!base) return;
    var set = function (selector, value) {
      var input = root.querySelector(selector);
      if (input) input.value = String(value);
    };
    set("[data-aw-sc-demand]", base.demandPct);
    set("[data-aw-sc-lead]", base.leadDays);
    set("[data-aw-sc-safety]", base.safetyPct);
    set("[data-aw-sc-moq]", base.moqPct);
    set("[data-aw-sc-boost]", 0);
    var delay = root.querySelector("[data-aw-sc-delay]");
    if (delay) delay.checked = Boolean(base.delayDeliveries);
    syncScenarioLabels();
  }

  /* Above the detail budget the run is computed on the server from the whole
     data set. The browser only receives the day series, so playback costs the
     same whether the portfolio holds 5 000 or 500 000 articles. */
  function requestPortfolioRun() {
    var scenario = scenarioFromControls();
    if (!scenario) return;
    var seq = ++scenarioRequest;
    pauseSim();
    root.setAttribute("data-simulation", "loading");
    var body = new URLSearchParams();
    body.set("analys", root.getAttribute("data-analysis") || "");
    Object.keys(scenario).forEach(function (key) {
      var value = scenario[key];
      body.set(key, key === "delayDeliveries" ? (value ? "1" : "0") : value == null ? "" : String(value));
    });
    fetch("/app/lagervarld/simulera", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "same-origin",
    })
      .then(function (response) {
        if (!response.ok) throw new Error("simulation");
        return response.json();
      })
      .then(function (run) {
        if (seq !== scenarioRequest) return;
        portfolio = run;
        simRun = run;
        simDay = 0;
        root.setAttribute("data-simulation", "ready");
        if (world) world.setSimulation(run);
        applyDay(0, false);
      })
      .catch(function () {
        if (seq === scenarioRequest) root.setAttribute("data-simulation", "failed");
      });
  }

  function runSimulationNow() {
    if (portfolioMode) {
      requestPortfolioRun();
      return;
    }
    if (!simEngine || !simInput || !simInput.articles || !simInput.articles.length) return;
    pauseSim();
    var scenario = scenarioFromControls();
    if (!scenario) return;
    simRun = simEngine.runSimulation(simInput.articles, scenario, {
      seed: simInput.seed,
      startDate: simInput.startDate,
    });
    simDay = 0;
    if (world) world.setSimulation(simRun);
    applyDay(0, false);
  }

  function applyDay(index, animate) {
    if (!simRun) return;
    var last = simRun.days.length - 1;
    simDay = Math.max(0, Math.min(last, Number(index) || 0));
    var day = simRun.days[simDay];
    if (world) world.applySimDay(simDay, Boolean(animate));
    var metrics = day.metrics;
    setText("[data-aw-day]", String(simDay));
    setText("[data-aw-days-out]", String(last));
    if (simDateEl) simDateEl.textContent = day.date;
    if (simScrub) {
      simScrub.max = String(last);
      if (document.activeElement !== simScrub) simScrub.value = String(simDay);
      simScrub.setAttribute("aria-valuetext", (sv ? "Dag " : "Day ") + simDay + " · " + day.date);
    }
    if (simProgress) simProgress.style.width = (last > 0 ? (simDay / last) * 100 : 0).toFixed(2) + "%";
    setText('[data-aw-metric="onHand"]', formatNumber(metrics.onHand));
    setText('[data-aw-metric="inbound"]', "+" + formatNumber(metrics.inboundUnits));
    setText('[data-aw-metric="outbound"]', "−" + formatNumber(metrics.outboundUnits));
    setText('[data-aw-metric="orders"]', formatNumber(metrics.openOrders) + " · " + formatNumber(metrics.openOrderUnits) + " st");
    setText('[data-aw-metric="expected"]', formatNumber(metrics.openOrderUnits) + " st");
    setText('[data-aw-metric="risk"]', formatNumber(metrics.stockoutCount) + (sv ? " artiklar" : " items"));
    setText('[data-aw-metric="overstock"]', formatNumber(metrics.overstockCount) + (sv ? " artiklar" : " items"));
    setText('[data-aw-metric="capital"]', formatMoney(metrics.capital));
    setText('[data-aw-metric="purchase"]', formatNumber(metrics.purchaseNeedUnits) + " st");
    var riskNode = root.querySelector('[data-aw-metric="risk"]');
    if (riskNode) riskNode.setAttribute("data-tone", metrics.stockoutCount > 0 ? "critical" : "ok");
    var overNode = root.querySelector('[data-aw-metric="overstock"]');
    if (overNode) overNode.setAttribute("data-tone", metrics.overstockCount > 0 ? "warning" : "ok");
    updateRowStatuses(day.changed);
    var statusFilter = root.querySelector('[data-aw-filter="status"]');
    if (statusFilter && statusFilter.value) filterTable();
    renderEvents();
    renderSupport(day.support);
  }

  function updateRowStatuses(changed) {
    for (var i = 0; i < (changed || []).length; i++) {
      var change = changed[i];
      var row = root.querySelector('[data-aw-rows] tr[data-sku="' + (window.CSS && CSS.escape ? CSS.escape(change.sku) : change.sku) + '"]');
      if (!row) continue;
      row.setAttribute("data-status", change.status);
      var cell = row.querySelector("[data-aw-status-cell]");
      if (cell) {
        cell.innerHTML = '<span class="status-dot" data-status="' + escapeHtml(change.status) + '"></span>' + escapeHtml(STATUS_TEXT[change.status] || change.status);
      }
      if (selected === change.sku) set("status", STATUS_TEXT[change.status] || change.status);
      stockBySku[change.sku] = change.stock;
    }
  }

  function renderEvents() {
    if (!simEvents || !simRun) return;
    var items = [];
    var today = 0;
    for (var d = simDay; d >= 0 && items.length < 40; d--) {
      var dayEvents = simRun.days[d].events;
      for (var i = dayEvents.length - 1; i >= 0; i--) {
        var event = dayEvents[i];
        if (simZone !== "all" && event.zone !== simZone) continue;
        if (d === simDay) today++;
        items.push(event);
        if (items.length >= 40) break;
      }
    }
    if (simEventCount) simEventCount.textContent = today + " " + (sv ? "idag" : "today");
    if (!items.length) {
      simEvents.innerHTML =
        '<li class="aw-events-empty">' +
        (sv ? "Inga simulerade händelser i det valda området ännu." : "No simulated events in the selected area yet.") +
        "</li>";
      return;
    }
    simEvents.innerHTML = items
      .map(function (event) {
        var qty = "";
        if (event.qty) {
          var sign = event.type === "delivery_arrived" ? "+" : event.type === "order_picked" || event.type === "shipment_sent" ? "−" : "";
          qty = sign + formatNumber(event.qty) + " st";
        }
        var title = event.sku
          ? '<a href="' + articleHref(event.sku) + '">' + escapeHtml(event.name) + "</a>"
          : escapeHtml(event.name);
        return (
          '<li class="aw-event" data-tone="' + escapeHtml(event.severity) + '" data-type="' + escapeHtml(event.type) + '">' +
          '<div class="aw-event-head"><time>Dag ' + event.day + " · " + escapeHtml(event.date) + "</time>" +
          '<span class="aw-event-type">' + escapeHtml(EVENT_TEXT[event.type] || event.type) + "</span>" +
          (qty ? '<b class="aw-event-qty">' + qty + "</b>" : "") +
          "</div><p>" + title + " <span>" + escapeHtml(event.message) + "</span></p></li>"
        );
      })
      .join("");
  }

  function renderSupport(support) {
    if (!simRun) return;
    support = support || simRun.summary;
    var list = function (kind, rows, render) {
      var node = root.querySelector('[data-aw-support="' + kind + '"]');
      if (!node) return;
      node.innerHTML = rows.length
        ? rows.map(render).join("")
        : '<li class="muted">' + escapeHtml(sv ? "Inget i den här körningen." : "Nothing in this run.") + "</li>";
    };
    list("risk", support.risks, function (row) {
      var riskLabel = row.status === "stockout" ? STATUS_TEXT.stockout : (sv ? "Låg täckning" : "Low cover");
      return (
        '<li><a href="' + articleHref(row.sku) + '">' + escapeHtml(row.name) + "</a>" +
        '<span>' + (row.coverDays == null ? "–" : formatNumber(row.coverDays) + " d") +
        " · " + escapeHtml(riskLabel) + "</span></li>"
      );
    });
    list("overstock", support.overstock, function (row) {
      return (
        '<li><a href="' + articleHref(row.sku) + '">' + escapeHtml(row.name) + "</a>" +
        "<span>+" + formatNumber(row.excess) + " st · " + formatMoney(row.value) + "</span></li>"
      );
    });
    list("purchase", support.purchaseNeeds, function (row) {
      return (
        '<li><a href="' + articleHref(row.sku) + '">' + escapeHtml(row.name) + "</a>" +
        "<span>" + formatNumber(row.qty) + " st · " + formatMoney(row.cost) + "</span></li>"
      );
    });
  }

  function pauseSim() {
    playing = false;
    if (simTimer) {
      clearTimeout(simTimer);
      simTimer = null;
    }
    syncPlayButtons();
  }

  function tickSim() {
    if (!playing || !simRun) return;
    if (simDay >= simRun.days.length - 1) {
      pauseSim();
      return;
    }
    applyDay(simDay + 1, true);
    simTimer = setTimeout(tickSim, Math.max(80, 850 / simSpeed));
  }

  function togglePlay() {
    if (!simRun) return;
    if (playing) {
      pauseSim();
      return;
    }
    if (simDay >= simRun.days.length - 1) applyDay(0, false);
    playing = true;
    syncPlayButtons();
    tickSim();
  }

  root.querySelectorAll("[data-aw-play]").forEach(function (btn) {
    btn.addEventListener("click", togglePlay);
  });

  root.querySelectorAll("[data-aw-sim-reset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      pauseSim();
      if (simRun) applyDay(0, false);
    });
  });

  if (speedSelect) {
    speedSelect.addEventListener("change", function () {
      simSpeed = Math.max(1, Number(speedSelect.value) || 1);
      root.setAttribute("data-sim-speed", String(simSpeed));
      if (playing) {
        if (simTimer) clearTimeout(simTimer);
        tickSim();
      }
    });
  }
  if (daysSelect) {
    daysSelect.addEventListener("change", function () {
      runSimulationNow();
    });
  }
  if (presetSelect) {
    presetSelect.addEventListener("change", function () {
      var preset = presetSelect.value;
      if (preset !== "custom") applyPresetFields(preset);
      runSimulationNow();
    });
  }
  if (simScrub) {
    simScrub.addEventListener("input", function () {
      pauseSim();
      applyDay(Number(simScrub.value) || 0, false);
    });
  }

  var followButton = root.querySelector("[data-aw-follow]");
  if (followButton && simEvents) {
    followButton.addEventListener("click", function () {
      simEvents.scrollTop = 0;
    });
  }

  var scenarioForm = root.querySelector("[data-aw-scenario-form]");
  if (scenarioForm) {
    scenarioForm.querySelectorAll("input[type=range], input[type=checkbox], select").forEach(function (input) {
      input.addEventListener("input", function () {
        if (presetSelect) presetSelect.value = "custom";
        syncScenarioLabels();
      });
    });
    scenarioForm.addEventListener("submit", function (event) {
      event.preventDefault();
      runSimulationNow();
    });
    var scenarioReset = scenarioForm.querySelector("[data-aw-sc-reset]");
    if (scenarioReset) {
      scenarioReset.addEventListener("click", function () {
        if (presetSelect) presetSelect.value = "normal";
        applyPresetFields("normal");
        var sku = root.querySelector("[data-aw-sc-sku]");
        if (sku) sku.value = "";
        if (presetSelect) presetSelect.dispatchEvent(new Event("change"));
      });
    }
    syncScenarioLabels();
  }

  function loadSimulation() {
    if (portfolioMode) {
      if (!portfolio) return;
      simRun = portfolio;
      root.setAttribute("data-simulation", "ready");
      if (world) world.setSimulation(simRun);
      applyDay(0, false);
      return;
    }
    if (!simInput || !simInput.articles || !simInput.articles.length) {
      root.setAttribute("data-simulation", "unavailable");
      root.querySelectorAll("[data-aw-play]").forEach(function (btn) { btn.disabled = true; });
      return;
    }
    import("/world/sim-engine.js?v=20261124a")
      .then(function (engine) {
        simEngine = engine;
        root.setAttribute("data-simulation", "ready");
        runSimulationNow();
      })
      .catch(function () {
        root.setAttribute("data-simulation", "failed");
        pauseSim();
      });
  }

  loadSimulation();

  /* -------------------------------------------------------- what-if form */
  var whatIf = root.querySelector("[data-aw-whatif-form]");
  function syncWhatIf() {
    if (!whatIf) return;
    var lead = whatIf.querySelector("[data-aw-lead]");
    var service = whatIf.querySelector("[data-aw-service]");
    var demand = whatIf.querySelector("[data-aw-demand]");
    var leadOut = whatIf.querySelector("[data-aw-lead-out]");
    var serviceOut = whatIf.querySelector("[data-aw-service-out]");
    var demandOut = whatIf.querySelector("[data-aw-demand-out]");
    if (leadOut && lead) leadOut.textContent = (Number(lead.value) > 0 ? "+" : "") + lead.value;
    if (serviceOut && service) serviceOut.textContent = [90, 95, 98, 99][Number(service.value)] + " %";
    if (demandOut && demand) demandOut.textContent = (Number(demand.value) > 0 ? "+" : "") + demand.value + " %";
  }
  if (whatIf) {
    var whatIfTimer = null;
    whatIf.addEventListener("input", function () {
      syncWhatIf();
      clearTimeout(whatIfTimer);
      whatIfTimer = setTimeout(function () {
        var lead = whatIf.querySelector("[data-aw-lead]").value;
        var service = [0.9, 0.95, 0.98, 0.99][Number(whatIf.querySelector("[data-aw-service]").value)];
        var demand = whatIf.querySelector("[data-aw-demand]").value;
        fetch("/app/lagervarld/simulera?lead=" + encodeURIComponent(lead) + "&service=" + service + "&demand=" + encodeURIComponent(demand), { headers: { accept: "application/json" } })
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (result) {
            if (!result) return;
            Object.keys(result.kpis).forEach(function (key) {
              var node = whatIf.querySelector('[data-aw-out="' + key + '"]');
              if (node && typeof result.kpis[key] === "number") node.textContent = formatMoney(result.kpis[key]);
            });
            var out = whatIf.querySelector("[data-aw-delta]");
            if (out) out.textContent = sv
              ? "Tillfälligt: " + result.counts.overstock + " överlager, " + result.counts.stockout + " bristrisk, " + result.counts.inactive + " inaktiva ställ."
              : "Temporary: " + result.counts.overstock + " overstock, " + result.counts.stockout + " at risk, " + result.counts.inactive + " inactive racks.";
            window.__appWorldStatuses = result.statusBySku;
            if (world) world.setStatuses(result.statusBySku);
            root.querySelectorAll("[data-app-kpi]").forEach(function (node) {
              var key = node.getAttribute("data-app-kpi");
              var value = result.kpis[key];
              if (typeof value !== "number") return;
              if (key === "turns") node.textContent = new Intl.NumberFormat(sv ? "sv-SE" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + " " + (sv ? "ggr/år" : "turns/yr");
              else if (key === "stockoutRiskCount") node.textContent = formatNumber(value) + " " + (sv ? "artiklar" : "items");
              else if (/Value|Release/.test(key)) node.textContent = formatMoney(value);
            });
          })
          .catch(function () {});
      }, 260);
    });
    whatIf.addEventListener("reset", function () {
      setTimeout(function () { syncWhatIf(); if (world) world.setStatuses(null); }, 0);
    });
  }

  document.querySelectorAll("[data-motion-toggle]").forEach(function (toggle) {
    toggle.addEventListener("click", function () {
      window.setTimeout(function () {
        var off = document.documentElement.getAttribute("data-motion") === "paused";
        if (world) world.setPaused(off);
        if (off) applyView("table");
      }, 0);
    });
  });

  filterTable();
  applyModeUi(root.getAttribute("data-mode") || "physical");
  // Användarens paus läses från /motion.js, samma modul som växeln skriver via.
  import("/motion.js")
    .then(function (motion) { return motion.readStoredMotion() === true; })
    .catch(function () { return false; })
    .then(function (motionOff) {
      applyView(reduced || narrow || motionOff ? "table" : "3d");
    });
})();
