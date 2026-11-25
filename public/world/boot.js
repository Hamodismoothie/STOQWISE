/**
 * Boots the public warehouse section without three.js.
 *
 * This file is tiny on purpose: it renders the static state, wires the DOM
 * controls, and only then imports `warehouse.js` (which pulls in three.js) when
 * the browser allows 3D. With reduced motion or no WebGL nothing heavy is
 * downloaded at all, and every number, link and slider still works.
 *
 * No inventory maths happens here: the payload comes from the server-side
 * scene adapter, and the what-if sliders call the analysis endpoint.
 */
const CARTON_LABEL = {
  sv: {
    staticReduced: "Rörelsen är pausad enligt din systeminställning. Lagret visas som en statisk bild; all text och alla siffror finns kvar.",
    staticNoGl: "WebGL är inte tillgängligt i den här webbläsaren. Lagret visas som en statisk bild; all text och alla siffror finns kvar.",
    demo: "Syntetisk demodata, inte verkliga kunddata.",
    unchanged: "Oförändrat mot demofilen.",
    failed: "Kunde inte räkna om just nu. Försök igen.",
    showing: (company, industry) => `Visar ${company} (${industry}). Syntetisk demodata.`,
    months: ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"],
    items: "artiklar",
    turns: "ggr/år",
  },
  en: {
    staticReduced: "Motion is paused by your system setting. The warehouse is shown as a still image; all text and figures remain.",
    staticNoGl: "WebGL is not available in this browser. The warehouse is shown as a still image; all text and figures remain.",
    demo: "Synthetic demo data, not real customer data.",
    unchanged: "Unchanged from the demo file.",
    failed: "Could not recalculate right now. Try again.",
    showing: (company, industry) => `Showing ${company} (${industry}). Synthetic demo data.`,
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    items: "items",
    turns: "turns/yr",
  },
};

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

const reducedMotion = () =>
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;

/** The product-wide pause switch (see ui/motion.ts) also stops the world. */
function storedPause() {
  try {
    return localStorage.getItem("lr-motion") === "paused";
  } catch {
    return false;
  }
}

export function bootWorld() {
  const root = document.querySelector("[data-world]");
  if (!root) return;
  const canvas = root.querySelector("[data-world-canvas]");
  const dataTag = root.querySelector("[data-world-data]");
  if (!canvas || !dataTag) return;

  let data;
  try {
    data = JSON.parse(dataTag.textContent || "[]");
  } catch {
    return;
  }
  if (!Array.isArray(data) || !data.length) return;

  const sv = document.documentElement.lang !== "en";
  const copy = sv ? CARTON_LABEL.sv : CARTON_LABEL.en;
  const intl = new Intl.NumberFormat(sv ? "sv-SE" : "en-US", { maximumFractionDigits: 2 });
  // Same label shape as the server-rendered figures: "SEK 1 109 026".
  const money = (value) => `SEK ${new Intl.NumberFormat(sv ? "sv-SE" : "en-US", { maximumFractionDigits: 0 }).format(Math.round(value))}`;

  const stage = root.querySelector("[data-world-stage]");
  const status = root.querySelector("[data-world-status]");
  const poster = root.querySelector(".world-poster");
  const fallback = root.querySelector("[data-world-fallback]");
  const progressBar = root.querySelector("[data-world-progress]");
  const say = (text) => {
    if (status) status.textContent = text;
  };

  let current = data[0];
  let instance = null;
  let pendingEnvironment = null;
  let statusBySku = null;
  let whatIfParams = { lead: 0, service: 0.95, demand: 0 };

  function paintKpis(kpis) {
    for (const node of root.querySelectorAll("[data-world-kpi]")) {
      const key = node.getAttribute("data-world-kpi");
      const value = kpis[key];
      if (value === null || value === undefined) continue;
      if (key === "turns") node.textContent = `${intl.format(value)} ${copy.turns}`;
      else if (key === "stockoutRiskCount") node.textContent = `${intl.format(value)} ${copy.items}`;
      else if (key === "potentialReleaseLow") node.textContent = `${money(kpis.potentialReleaseLow)}–${money(kpis.potentialReleaseHigh)}`;
      else node.textContent = money(value);
      node.dataset.raw = String(value);
    }
  }

  function staticMode(reason) {
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = reason;
    }
    canvas.hidden = true;
    poster?.classList.add("is-static");
    root.dataset.worldStatic = "true";
    say(copy.demo);
  }

  /* Scroll drives the camera; the page itself always scrolls normally. */
  let rafPending = false;
  function updateProgress() {
    rafPending = false;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const total = Math.max(1, rect.height - window.innerHeight * 0.4);
    const p = Math.min(1, Math.max(0, -rect.top / total));
    if (progressBar) progressBar.style.transform = `scaleX(${p.toFixed(3)})`;
    root.dataset.worldAct = String(Math.min(3, Math.floor(p * 4)));
    instance?.setProgress(p);
  }
  const schedule = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(updateProgress);
  };

  /* ------------------------------------------------------------- what-if */
  const form = root.querySelector("[data-whatif-form]");
  const deltaOut = form?.querySelector("[data-whatif-delta]");
  const leadInput = form?.querySelector("[data-whatif-lead]");
  const serviceInput = form?.querySelector("[data-whatif-service]");
  const demandInput = form?.querySelector("[data-whatif-demand]");
  const serviceOptions = [0.9, 0.95, 0.98, 0.99];
  let fetchTimer = 0;
  let controller = null;

  function paintWhatIf(result) {
    const { kpis, delta, params } = result;
    if (form) {
      const leadOut = form.querySelector("[data-whatif-lead-out]");
      const serviceOut = form.querySelector("[data-whatif-service-out]");
      const demandOut = form.querySelector("[data-whatif-demand-out]");
      if (leadOut) leadOut.textContent = `${params.leadDeltaDays > 0 ? "+" : ""}${params.leadDeltaDays}`;
      if (serviceOut) serviceOut.textContent = sv ? `${Math.round(params.serviceLevel * 100)} %` : `${Math.round(params.serviceLevel * 100)}%`;
      if (demandOut) demandOut.textContent = sv ? `${params.demandPct > 0 ? "+" : ""}${params.demandPct} %` : `${params.demandPct > 0 ? "+" : ""}${params.demandPct}%`;
      const outs = {
        overstockValue: money(kpis.overstockValue),
        stockoutRiskValue: money(kpis.stockoutRiskValue),
        potentialReleaseLow: `${money(kpis.potentialReleaseLow)}–${money(kpis.potentialReleaseHigh)}`,
      };
      for (const node of form.querySelectorAll("[data-whatif-out]")) {
        const value = outs[node.getAttribute("data-whatif-out")];
        if (value) node.textContent = value;
      }
      const changed = params.leadDeltaDays !== 0 || params.demandPct !== 0 || params.serviceLevel !== 0.95;
      if (deltaOut) {
        if (!changed) deltaOut.textContent = copy.unchanged;
        else {
          const sign = (n) => (n >= 0 ? "+" : "−");
          deltaOut.textContent = sv
            ? `Överlager ${sign(delta.overstockValue)}${money(Math.abs(delta.overstockValue))} · riskerad försäljning ${sign(delta.stockoutRiskValue)}${money(Math.abs(delta.stockoutRiskValue))}`
            : `Overstock ${sign(delta.overstockValue)}${money(Math.abs(delta.overstockValue))} · revenue at risk ${sign(delta.stockoutRiskValue)}${money(Math.abs(delta.stockoutRiskValue))}`;
        }
      }
    }
    statusBySku = result.statusBySku;
    instance?.setStatuses(result.statusBySku);
    paintKpis(result.kpis);
  }

  function runWhatIf() {
    if (!form) return;
    whatIfParams = {
      lead: Number(leadInput?.value ?? 0),
      service: serviceOptions[Number(serviceInput?.value ?? 1)],
      demand: Number(demandInput?.value ?? 0),
    };
    controller?.abort();
    controller = new AbortController();
    const query = new URLSearchParams({
      environment: current.id,
      lead: String(whatIfParams.lead),
      service: String(whatIfParams.service),
      demand: String(whatIfParams.demand),
      locale: sv ? "sv" : "en",
    });
    fetch(`/api/v1/demo/what-if?${query.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(paintWhatIf)
      .catch((error) => {
        if (error.name !== "AbortError" && deltaOut) deltaOut.textContent = copy.failed;
      });
  }

  function scheduleWhatIf() {
    window.clearTimeout(fetchTimer);
    fetchTimer = window.setTimeout(runWhatIf, 180);
  }

  [leadInput, serviceInput, demandInput].forEach((input) => input?.addEventListener("input", scheduleWhatIf));
  form?.addEventListener("reset", () => window.setTimeout(runWhatIf, 0));

  /* ------------------------------------------------------- environment */
  // The four steps are rendered once per environment; only the matching panel
  // is visible, so a switch can never mix figures from two datasets.
  function setStory(id) {
    for (const panel of root.querySelectorAll("[data-world-story]")) {
      const active = panel.getAttribute("data-world-story") === id;
      panel.classList.toggle("is-active", active);
      if (active) panel.removeAttribute("aria-hidden");
      else panel.setAttribute("aria-hidden", "true");
    }
  }

  function setEnvironment(next) {
    current = next;
    root.setAttribute("data-world-current", next.id);
    root.querySelectorAll("[data-world-env]").forEach((button) =>
      button.setAttribute("aria-pressed", String(button.getAttribute("data-world-env") === next.id)),
    );
    setStory(next.id);
    paintKpis(next.kpis);
    if (instance) {
      instance.setEnvironment(next, statusBySku);
      // Re-apply the current what-if after the environment swap.
      if (statusBySku) scheduleWhatIf();
    } else {
      pendingEnvironment = next;
    }
  }

  root.querySelectorAll("[data-world-env]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = data.find((environment) => environment.id === button.getAttribute("data-world-env"));
      if (!next || next.id === current.id) return;
      root.classList.add("is-switching");
      window.setTimeout(() => {
        setEnvironment(next);
        root.classList.remove("is-switching");
        say(copy.showing(next.company, next.industry));
      }, 180);
    });
  });

  /* --------------------------------------------------------- forecast views */
  root.querySelectorAll("[data-world-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".world-story-block");
      if (!group) return;
      const id = button.getAttribute("data-world-scenario");
      for (const option of group.querySelectorAll("[data-world-scenario]")) {
        option.setAttribute("aria-pressed", String(option === button));
      }
      for (const view of group.querySelectorAll("[data-world-fc]")) {
        view.hidden = view.getAttribute("data-world-fc") !== id;
      }
    });
  });

  /* ------------------------------------------------------------ month */
  const monthInput = root.querySelector("[data-world-month]");
  const monthOut = root.querySelector("[data-world-month-out]");
  monthInput?.addEventListener("input", () => {
    const value = Number(monthInput.value);
    instance?.setMonth(value);
    if (monthOut) monthOut.textContent = copy.months[value - 1] ?? String(value);
  });

  /* --------------------------------------------------------- explore */
  const exploreButton = root.querySelector("[data-world-explore]");
  exploreButton?.addEventListener("click", () => instance?.startExplore());
  root.querySelector("[data-world-exit]")?.addEventListener("click", () => instance?.stopExplore());
  root.querySelector("[data-world-exit-2]")?.addEventListener("click", () => instance?.stopExplore());

  /* --------------------------------------------------------- reveals */
  const revealObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add("is-in");
          },
          { rootMargin: "-12% 0px -22% 0px" },
        )
      : null;
  root.querySelectorAll(".world-act").forEach((node) => revealObserver?.observe(node));

  /* KPI counters count up once, when the analysis act comes into view. The
     final value is already in the DOM; the animation only re-renders it, and it
     is skipped entirely when motion is paused. */
  let counted = false;
  function countUp() {
    if (counted) return;
    counted = true;
    if (reducedMotion() || storedPause()) return;
    const nodes = [...root.querySelectorAll("[data-world-kpi]")];
    const start = performance.now();
    const run = (now) => {
      const t = Math.min(1, (now - start) / 800);
      const ease = 1 - (1 - t) ** 3;
      for (const node of nodes) {
        const raw = Number(node.dataset.raw);
        if (!Number.isFinite(raw)) continue;
        const key = node.getAttribute("data-world-kpi");
        const value = raw * ease;
        if (key === "turns") node.textContent = `${intl.format(Math.round(value * 100) / 100)} ${copy.turns}`;
        else if (key === "stockoutRiskCount") node.textContent = `${intl.format(Math.round(value))} ${copy.items}`;
        else if (key === "potentialReleaseLow") node.textContent = money(value);
        else node.textContent = money(value);
      }
      if (t < 1) requestAnimationFrame(run);
      else paintKpis(current.kpis);
    };
    requestAnimationFrame(run);
  }

  const kpiBlock = root.querySelector("[data-world-kpis]");
  if (kpiBlock && "IntersectionObserver" in window) {
    const kpiObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        countUp();
        kpiObserver.disconnect();
      }
    }, { rootMargin: "-10% 0px -20% 0px" });
    kpiObserver.observe(kpiBlock);
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  updateProgress();
  // Render the server figures through the same formatter so `data-raw` exists
  // before the counters animate.
  paintKpis(current.kpis);
  root.dataset.worldReady = "dom";
  say(copy.demo);

  const still = reducedMotion() || storedPause();
  if (still || !webglAvailable()) {
    staticMode(still ? copy.staticReduced : copy.staticNoGl);
    exploreButton?.setAttribute("disabled", "true");
    exploreButton?.setAttribute("aria-disabled", "true");
    if (exploreButton) exploreButton.title = copy.staticReduced;
    return;
  }

  /* ------------------------------------------------------------- 3D */
  const idle =
    typeof requestIdleCallback === "function"
      ? (fn) => requestIdleCallback(fn, { timeout: 1800 })
      : (fn) => window.setTimeout(fn, 220);
  idle(() => {
    import("/world/warehouse.js?v=20261126a")
      .then(({ createWorld }) => {
        instance = createWorld({
          root,
          canvas,
          data,
          locale: sv ? "sv" : "en",
          onStats: (stats) => {
            window.__worldStats = stats;
            root.dataset.worldDrawCalls = String(stats.drawCalls);
            root.dataset.worldTriangles = String(stats.triangles);
            root.dataset.worldFps = String(stats.fps);
          },
        });
        window.__world = instance;
        canvas.hidden = false;
        poster?.classList.add("is-behind");
        root.dataset.worldReady = "3d";
        if (pendingEnvironment) instance.setEnvironment(pendingEnvironment, statusBySku);
        if (statusBySku) instance.setStatuses(statusBySku);
        instance.setMonth(Number(monthInput?.value ?? 12));
        updateProgress();
      })
      .catch(() => {
        staticMode(copy.staticNoGl);
        root.dataset.worldReady = "fallback";
      });
  });

  /* Light cursor on precise pointers only. */
  if (!matchMedia("(pointer: coarse)").matches) {
    const cursor = document.createElement("div");
    cursor.className = "world-cursor";
    cursor.setAttribute("aria-hidden", "true");
    root.appendChild(cursor);
    let cx = 0;
    let cy = 0;
    let tx = 0;
    let ty = 0;
    window.addEventListener("pointermove", (event) => {
      tx = event.clientX;
      ty = event.clientY;
      cursor.classList.add("is-on");
    }, { passive: true });
    const follow = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }
}
