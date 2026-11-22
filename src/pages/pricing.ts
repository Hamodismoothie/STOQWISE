/**
 * Commercial workspace: business assessment, personalised estimate, quote
 * request and the internal commercial rule editor. All figures come from
 * `pricing.ts`; these pages only collect inputs and present the result.
 */
import { alert, card, esc, flash, icon, shell, table } from "../ui/base.ts";
import { appDate, appNum, appPct, appSek, appText, appTranslator } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
import { EMAILS } from "../brand.ts";
import {
  MODULES,
  type BillingCycle,
  type ModuleId,
  type PriceEstimate,
  type PricingProfile,
  type PricingRules,
  type SupportLevel,
} from "../pricing.ts";
import type { PageContext } from "./core.ts";

const num = (locale: Locale, n: number, d = 0): string => appNum(locale, n, d);
const sek = (locale: Locale, n: number): string => appSek(locale, n);
const pct = (locale: Locale, n: number, d = 1): string => appPct(locale, n, d);
const date = (locale: Locale, iso: string): string => appDate(locale, iso);
const isSv = (locale: Locale): boolean => locale === "sv";

const defaultProfile: PricingProfile = {
  industry: "Retail",
  country: "SE",
  businessType: "Omnichannel",
  employees: 10,
  locations: 1,
  warehouses: 1,
  stores: 1,
  skus: 2_000,
  inventoryValue: 2_000_000,
  monthlyTransactions: 3_000,
  suppliers: 10,
  users: 3,
  modules: ["inventory", "forecast", "optimization", "procurement", "product", "ai"],
  support: "standard",
  billingCycle: "monthly",
  integrations: 0,
  erp: "",
  wms: "",
  pos: "",
  ecommerce: "",
  dataFormats: ["csv"],
  notes: "",
};

function checked(value: boolean): string {
  return value ? "checked" : "";
}

function field(input: {
  name: string;
  label: string;
  value: string | number;
  type?: string;
  hint?: string;
  min?: number;
  step?: number;
  required?: boolean;
  wide?: boolean;
}): string {
  return `<div class="form-row${input.wide ? " span-2" : ""}">
    <label for="p-${input.name}">${esc(input.label)}</label>
    <input id="p-${input.name}" name="${input.name}" type="${input.type ?? "text"}" value="${esc(String(input.value))}"${
      input.min !== undefined ? ` min="${input.min}"` : ""
    }${input.step !== undefined ? ` step="${input.step}"` : ""}${input.required ? " required" : ""} autocomplete="off">
    ${input.hint ? `<span class="hint">${esc(input.hint)}</span>` : ""}
  </div>`;
}

function select(input: { name: string; label: string; value: string; options: Array<{ value: string; label: string }> }): string {
  return `<div class="form-row"><label for="p-${input.name}">${esc(input.label)}</label>
    <select id="p-${input.name}" name="${input.name}">${input.options
      .map((o) => `<option value="${esc(o.value)}" ${o.value === input.value ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("")}</select></div>`;
}

function profileForm(profile: PricingProfile, locale: Locale, action: string, submitLabel: string): string {
  const t = appTranslator(locale);
  const industryOptions = [
    { value: "Retail", label: t("Detaljhandel") },
    { value: "Wholesale", label: t("Partihandel") },
    { value: "E-commerce", label: t("E-handel") },
    { value: "Food", label: t("Livsmedel") },
    { value: "Distribution", label: t("Distribution") },
    { value: "3PL", label: t("Tredjepartslogistik") },
    { value: "Manufacturing", label: t("Tillverkning") },
    { value: "Other", label: t("Annat") },
  ];
  const businessOptions = [
    { value: "B2B", label: "B2B" },
    { value: "B2C", label: "B2C" },
    { value: "Omnichannel", label: t("Omnichannel") },
    { value: "Marketplace", label: t("Marknadsplats") },
  ];
  const supportOptions = [
    { value: "standard", label: t("Standard") },
    { value: "priority", label: t("Prioriterad") },
    { value: "dedicated", label: t("Dedikerad") },
  ];
  const countryOptions = [
    { value: "SE", label: t("Sverige") },
    { value: "NO", label: "Norge" },
    { value: "DK", label: "Danmark" },
    { value: "FI", label: "Finland" },
    { value: "DE", label: "Deutschland" },
    { value: "NL", label: "Nederland" },
    { value: "GB", label: "United Kingdom" },
    { value: "Other", label: t("Annat land") },
  ];
  return `<form method="post" action="${esc(action)}" class="commercial-form" data-busy="${esc(t("Beräknar…"))}">
    <section class="form-section">
      <div class="form-section-head"><span class="folio">01</span><div><h3>${t("Företaget")}</h3><p>${t("Grundläggande uppgifter som påverkar omfattning och support.")}</p></div></div>
      <div class="form-grid">
        ${select({ name: "industry", label: t("Bransch"), value: profile.industry, options: industryOptions })}
        ${select({ name: "country", label: t("Land"), value: profile.country, options: countryOptions })}
        ${select({ name: "businessType", label: t("Affärsmodell"), value: profile.businessType, options: businessOptions })}
        ${field({ name: "employees", label: t("Antal anställda"), value: profile.employees, type: "number", min: 1 })}
        ${field({ name: "locations", label: t("Antal lagerställen"), value: profile.locations, type: "number", min: 1 })}
        ${field({ name: "warehouses", label: t("Varav lager"), value: profile.warehouses, type: "number", min: 0 })}
        ${field({ name: "stores", label: t("Varav butiker"), value: profile.stores, type: "number", min: 0 })}
      </div>
    </section>

    <section class="form-section">
      <div class="form-section-head"><span class="folio">02</span><div><h3>${t("Lager och volym")}</h3><p>${t("Ungefärliga siffror räcker. Du kan justera dem när du har mer exakt data.")}</p></div></div>
      <div class="form-grid">
        ${field({ name: "skus", label: t("Aktiva artiklar (SKU)"), value: profile.skus, type: "number", min: 1 })}
        ${field({ name: "inventoryValue", label: t("Ungefärligt lagervärde (kr)"), value: profile.inventoryValue, type: "number", min: 0, step: 1000 })}
        ${field({ name: "monthlyTransactions", label: t("Transaktioner per månad"), value: profile.monthlyTransactions, type: "number", min: 0, step: 100 })}
        ${field({ name: "suppliers", label: t("Antal leverantörer"), value: profile.suppliers, type: "number", min: 0 })}
        ${field({ name: "users", label: t("Antal användare"), value: profile.users, type: "number", min: 1 })}
        ${field({ name: "integrations", label: t("Ytterligare integrationer"), value: profile.integrations, type: "number", min: 0, hint: t("Utöver ERP, WMS, POS och e-handel nedan.") })}
      </div>
    </section>

    <section class="form-section">
      <div class="form-section-head"><span class="folio">03</span><div><h3>${t("System och data")}</h3><p>${t("Ange de system ni använder i dag. Lämna tomt om ni arbetar i kalkylblad.")}</p></div></div>
      <div class="form-grid">
        ${field({ name: "erp", label: t("Affärssystem (ERP)"), value: profile.erp, hint: t("Till exempel Fortnox, Visma eller SAP.") })}
        ${field({ name: "wms", label: t("Lagerhanteringssystem (WMS)"), value: profile.wms })}
        ${field({ name: "pos", label: t("Kassasystem (POS)"), value: profile.pos })}
        ${field({ name: "ecommerce", label: t("E-handelsplattform"), value: profile.ecommerce, hint: t("Till exempel Shopify eller WooCommerce.") })}
      </div>
      <div class="form-row"><span class="label">${t("Tillgängliga dataformat")}</span>
        <div class="check-row">${["CSV", "Excel", "API", "Database"]
          .map(
            (format) =>
              `<label class="check"><input type="checkbox" name="dataFormats" value="${format}" ${checked(profile.dataFormats.includes(format))}> <span>${format}</span></label>`,
          )
          .join("")}</div>
      </div>
    </section>

    <section class="form-section">
      <div class="form-section-head"><span class="folio">04</span><div><h3>${t("Funktioner")}</h3><p>${t("Välj de områden som ska ingå i er lösning. Lagerintelligens ingår alltid.")}</p></div></div>
      <div class="module-grid">${MODULES.map(
        (module) =>
          `<label class="module-option"><input type="checkbox" name="modules" value="${module.id}" ${checked(profile.modules.includes(module.id))} ${
            module.id === "inventory" ? "disabled" : ""
          }><span><strong>${esc(isSv(locale) ? module.sv : module.en)}</strong><small>${esc(isSv(locale) ? module.descriptionSv : module.descriptionEn)}</small></span></label>`,
      ).join("")}</div>
      <input type="hidden" name="modules" value="inventory">
      <div class="form-grid mt-3">
        ${select({ name: "support", label: t("Supportnivå"), value: profile.support, options: supportOptions })}
        ${select({
          name: "billingCycle",
          label: t("Faktureringsval"),
          value: profile.billingCycle,
          options: [
            { value: "monthly", label: t("Månadsvis") },
            { value: "annual", label: t("Årsvis (rabatt)") },
          ],
        })}
      </div>
    </section>

    <section class="form-section">
      <div class="form-section-head"><span class="folio">05</span><div><h3>${t("Anteckningar")}</h3><p>${t("Frivilligt. Beskriv till exempel tidsplan, särskilda krav eller pågående systembyte.")}</p></div></div>
      <div class="form-row"><label for="p-notes">${t("Övrig information")}</label><textarea id="p-notes" name="notes" rows="3">${esc(profile.notes)}</textarea></div>
    </section>

    <div class="form-actions"><button class="btn" type="submit">${esc(submitLabel)} ${icon("arrow", 15)}</button>
      <span class="hint">${t("Ingen betalning sker. Estimatet är inte bindande.")}</span></div>
  </form>`;
}

function profileFromInput(profile: PricingProfile | null): PricingProfile {
  return profile ?? defaultProfile;
}

export function pricingStartPage(input: PageContext & {
  profile: PricingProfile | null;
  estimate: PriceEstimate | null;
  dataSummary: { skus: number; inventoryValue: number; months: number } | null;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const profile = input.profile ?? {
    ...defaultProfile,
    ...(input.dataSummary
      ? {
          skus: input.dataSummary.skus,
          inventoryValue: Math.round(input.dataSummary.inventoryValue),
          modules: (input.dataSummary.months < 6
            ? ["inventory", "optimization", "procurement", "product"]
            : defaultProfile.modules) as ModuleId[],
        }
      : {}),
  };
  const content = `
    ${flash(input.url, locale)}
    <div class="grid">
      <div class="span-8">
        <div class="commercial-intro">
          <p class="eyebrow">${t("Affärsbedömning")}</p>
          <h1 class="commercial-title">${t("Priset ska spegla verksamheten, inte en generisk tabell.")}</h1>
          <p class="lead">${t("Svara på några frågor om företaget, lagret och de funktioner ni behöver. STOQWISE beräknar ett transparent estimat som ni kan justera innan ni begär offert.")}</p>
          <div class="commercial-steps">
            <div><span>01</span><strong>${t("Beskriv verksamheten")}</strong><small>${t("Ungefärliga uppgifter räcker.")}</small></div>
            <div><span>02</span><strong>${t("Få ett estimat")}</strong><small>${t("Månadspris, årspris och implementation.")}</small></div>
            <div><span>03</span><strong>${t("Begär offert")}</strong><small>${t("Ingen betalning aktiveras automatiskt.")}</small></div>
          </div>
        </div>
        ${profileForm(profile, locale, "/start", input.estimate ? t("Uppdatera estimat") : t("Beräkna mitt estimat"))}
      </div>
      <aside class="span-4 commercial-aside">
        ${card({
          title: t("Det här ingår i bedömningen"),
          body: `<ul class="check-list">
            <li>${icon("check", 14)} ${t("Företagsstorlek och bransch")}</li>
            <li>${icon("check", 14)} ${t("Artiklar, lagerställen och transaktioner")}</li>
            <li>${icon("check", 14)} ${t("Användare och supportnivå")}</li>
            <li>${icon("check", 14)} ${t("Valda analysmoduler")}</li>
            <li>${icon("check", 14)} ${t("Systemintegrationer och implementation")}</li>
          </ul>`,
        })}
        ${input.dataSummary ? card({ title: t("Er senaste analys"), body: `<p class="muted">${t("{n} artiklar · {value} i lagervärde · {months} månaders historik.", { n: num(locale, input.dataSummary.skus), value: sek(locale, input.dataSummary.inventoryValue), months: num(locale, input.dataSummary.months) })}</p><p class="hint">${t("Artikelvolym och lagervärde är förifyllda från analysen. Justera vid behov.")}</p><a class="btn btn-ghost btn-block" href="/app">${t("Öppna analysen")}</a>` }) : ""}
        ${input.estimate ? card({ title: t("Ditt senaste estimat"), body: `<p class="muted">${t("Beräknat {monthly} per månad.", { monthly: sek(locale, input.estimate.monthly) })}</p><a class="btn btn-block" href="/app/prisestimat">${t("Visa prisestimat")}</a>` }) : ""}
        <div class="aside-note">${icon("radar", 20)}<p>${t("Priset är ett indicativt estimat. Det binds först i en signerad offert.")}</p></div>
      </aside>
    </div>`;
  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Affärsbedömning"),
    active: "estimate",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Personlig prissättning för {org}", { org: esc(input.org.name) }),
    content,
  });
}

export function estimatePage(input: PageContext & {
  profile: PricingProfile;
  estimate: PriceEstimate;
  quotes: Array<{ status: string; created_at: string }>;
  rules: PricingRules;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const e = input.estimate;
  const latest = input.quotes[0];
  const quoteStatus = (status: string): string =>
    status === "accepted_pending_payment"
      ? t("Aktivering begärd · väntar på avtal")
      : status === "requested"
        ? t("Offertförfrågan mottagen")
        : status;
  const lines = table({
    columns: [
      { key: "line", label: t("Post") },
      { key: "detail", label: t("Underlag") },
      { key: "amount", label: t("Per månad"), align: "right" },
    ],
    rows: e.recurringLines.map((line) => ({
      line: `<strong>${esc(isSv(locale) ? line.sv : line.en)}</strong>`,
      detail: `<span class="muted">${esc(isSv(locale) ? line.detailSv : line.detailEn)}</span>`,
      amount: sek(locale, line.amount),
    })),
    caption: t("Varje rad kommer från ett konfigurerat prisblock."),
  });
  const implementation = table({
    columns: [
      { key: "line", label: t("Post") },
      { key: "detail", label: t("Omfattning") },
      { key: "amount", label: t("Engångskostnad"), align: "right" },
    ],
    rows: e.implementationLines.map((line) => ({
      line: esc(isSv(locale) ? line.sv : line.en),
      detail: `<span class="muted">${esc(isSv(locale) ? line.detailSv : line.detailEn)}</span>`,
      amount: sek(locale, line.amount),
    })),
    caption: t("Implementation debiteras separat och bekräftas efter teknisk genomgång."),
  });
  const moduleList = e.additionalModules.length
    ? e.additionalModules.map((m) => `<li>${icon("check", 14)} ${esc(isSv(locale) ? m.sv : m.en)}</li>`).join("")
    : `<li class="muted">${t("Endast kärnplattformen.")}</li>`;
  const factors = e.factors
    .filter((f) => f.value > 0)
    .map((f) => `<div><dt>${esc(isSv(locale) ? f.sv : f.en)}</dt><dd>${num(locale, f.value)}</dd></div>`)
    .join("");

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Prisestimat"),
    active: "estimate",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Beräknat {date} · uppdateras när underlaget ändras", { date: date(locale, new Date().toISOString()) }),
    content: `
    ${flash(input.url, locale)}
    <div class="estimate-hero">
      <div>
        <p class="eyebrow">${isSv(locale) ? "Din beräknade investering" : "Your estimated investment"}</p>
        <h1 class="estimate-amount">${sek(locale, e.monthly)}<small>${t("/månad")}</small></h1>
        <p class="lead">${t("Rekommenderad konfiguration: {package}. Priset bygger på er affärsprofil och kan justeras nedan.", { package: esc(isSv(locale) ? e.recommendedPackage.sv : e.recommendedPackage.en) })}</p>
        <div class="estimate-badges"><span class="badge badge-info">${t("Estimat")}</span><span class="badge">${t("Exkl. moms")}</span><span class="badge">${t("Ingen bindning")}</span></div>
      </div>
      <div class="estimate-side">
        <div><span>${t("Årsvis fakturering")}</span><strong>${sek(locale, e.annualMonthly)}<small>${t("/mån")}</small></strong></div>
        <div><span>${t("Årskostnad")}</span><strong>${sek(locale, e.annualTotal)}</strong></div>
        <div><span>${t("Implementation")}</span><strong>${sek(locale, e.implementation)}</strong></div>
      </div>
    </div>

    <div class="grid">
      <div class="span-8">
        ${card({ title: t("Hur priset byggs upp"), body: lines })}
        ${card({ title: t("Implementation"), body: implementation })}
      </div>
      <aside class="span-4">
        ${card({
          title: t("Rekommenderad konfiguration"),
          body: `<p class="package-name">${esc(isSv(locale) ? e.recommendedPackage.sv : e.recommendedPackage.en)}</p>
            <p class="muted">${t("Paketet är en intern konfiguration. Funktionerna nedan är valda utifrån er profil.")}</p>
            <h4 class="mini-head">${t("Ingår")}</h4><ul class="check-list"><li>${icon("check", 14)} ${t("Lagerintelligens")}</li></ul>
            <h4 class="mini-head">${t("Tillval")}</h4><ul class="check-list">${moduleList}</ul>`,
        })}
        ${card({
          title: t("Faktorer i beräkningen"),
          body: `<dl class="kv compact">${factors}</dl><p class="hint">${t("Andra faktorer: valda moduler, supportnivå, integrationer och implementation.")}</p>`,
        })}
        ${card({
          title: t("Nästa steg"),
          body: `<p class="muted">${t("Estimatet är inte ett bindande erbjudande. Begär en formell offert eller ett aktiveringsärende. Ingen betalning dras automatiskt.")}</p>
            <form method="post" action="/app/prisestimat/offert" class="stack-sm">
              <div class="form-row"><label for="quote-note">${t("Meddelande till säljteamet")}</label><textarea id="quote-note" name="note" rows="2" placeholder="${t("Tidsplan, frågor eller särskilda krav")}"></textarea></div>
              <button class="btn btn-block" type="submit">${t("Begär formell offert")}</button>
            </form>
            <form method="post" action="/app/prisestimat/acceptera" class="stack-sm mt-3" data-confirm="${t("Bekräfta att du vill begära aktivering. Ingen betalning sker automatiskt.")}">
              <label class="check"><input type="checkbox" name="confirm" value="yes" required> <span>${t("Jag har läst estimatet och vill begära aktivering.")}</span></label>
              <button class="btn btn-ghost btn-block" type="submit">${t("Begär aktivering")}</button>
            </form>`,
        })}
        ${latest ? card({ title: t("Senaste förfrågan"), body: `<p><strong>${esc(quoteStatus(latest.status))}</strong></p><p class="hint">${date(locale, latest.created_at)}</p>` }) : ""}
      </aside>
    </div>

    <div class="grid mt-4">
      <div class="span-12">${card({ title: t("Justera underlaget"), subtitle: t("Ändra en eller flera uppgifter och beräkna om estimatet direkt."), body: profileForm(input.profile, locale, "/app/prisestimat", t("Beräkna om estimatet")) })}</div>
    </div>
    <p class="compliance-note">${t("Estimatet är indicativt och baseras på de uppgifter som lämnats. Det är inte ett bindande erbjudande. Moms tillkommer. Offert och avtal krävs innan aktivering.")} ${EMAILS.hello ? `<a href="mailto:${EMAILS.hello}">${EMAILS.hello}</a>` : ""}</p>`,
  });
}

export function pricingRulesPage(input: PageContext & { rules: PricingRules }): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const r = input.rules;
  const numberRow = (name: string, label: string, value: number, step = 1): string =>
    `<div class="form-row"><label for="r-${name}">${esc(label)}</label><input id="r-${name}" name="${name}" type="number" min="0" step="${step}" value="${value}"></div>`;
  const moduleRows = MODULES.map((m) => numberRow(`module_${m.id}`, isSv(locale) ? m.sv : m.en, r.modulePrices[m.id], 10)).join("");
  const packageRows = r.packages
    .map(
      (p, i) => `<div class="rule-package"><h4>${esc(isSv(locale) ? p.sv : p.en)}</h4>
        <div class="form-grid">
          ${numberRow(`pkg_${i}_skus`, t("Max artiklar"), p.maxSkus === Number.MAX_SAFE_INTEGER ? 0 : p.maxSkus)}
          ${numberRow(`pkg_${i}_users`, t("Max användare"), p.maxUsers === Number.MAX_SAFE_INTEGER ? 0 : p.maxUsers)}
          ${numberRow(`pkg_${i}_locations`, t("Max lagerställen"), p.maxLocations === Number.MAX_SAFE_INTEGER ? 0 : p.maxLocations)}
        </div><p class="hint">${t("0 betyder ingen gräns.")}</p></div>`,
    )
    .join("");

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Prissättning"),
    active: "pricing-admin",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Interna prisregler som styr varje personligt estimat."),
    content: `
    ${flash(input.url, locale)}
    ${alert(t("Ändringar påverkar nya estimat och omräkningar. Redan sparade offerter behåller sitt ursprungliga underlag."), "info")}
    <form method="post" action="/app/prissattning" class="commercial-form" data-busy="${t("Sparar…")}">
      <section class="form-section"><div class="form-section-head"><span class="folio">01</span><div><h3>${t("Bas och rabatt")}</h3><p>${t("Grundavgift, minimiavgift och årsrabatt.")}</p></div></div>
        <div class="form-grid">
          ${numberRow("baseMonthly", t("Basavgift per månad"), r.baseMonthly, 10)}
          ${numberRow("minimumMonthly", t("Minimiavgrift per månad"), r.minimumMonthly, 10)}
          ${numberRow("annualDiscountPct", t("Årsrabatt (%)"), r.annualDiscountPct, 0.5)}
          ${numberRow("roundingSek", t("Avrundning (kr)"), r.roundingSek)}
        </div>
      </section>
      <section class="form-section"><div class="form-section-head"><span class="folio">02</span><div><h3>${t("Volymblock")}</h3><p>${t("Ingående volym och pris per extra block.")}</p></div></div>
        <div class="form-grid">
          ${numberRow("includedSkus", t("Ingående artiklar"), r.includedSkus)}
          ${numberRow("skuBlock", t("Artikelblock"), r.skuBlock)}
          ${numberRow("skuBlockPrice", t("Pris per artikelblock"), r.skuBlockPrice, 10)}
          ${numberRow("includedUsers", t("Ingående användare"), r.includedUsers)}
          ${numberRow("extraUserPrice", t("Pris per extra användare"), r.extraUserPrice, 10)}
          ${numberRow("includedLocations", t("Ingående lagerställen"), r.includedLocations)}
          ${numberRow("extraLocationPrice", t("Pris per extra lagerställe"), r.extraLocationPrice, 10)}
          ${numberRow("includedTransactions", t("Ingående transaktioner"), r.includedTransactions)}
          ${numberRow("transactionBlock", t("Transaktionsblock"), r.transactionBlock)}
          ${numberRow("transactionBlockPrice", t("Pris per transaktionsblock"), r.transactionBlockPrice, 10)}
          ${numberRow("includedSuppliers", t("Ingående leverantörer"), r.includedSuppliers)}
          ${numberRow("supplierBlock", t("Leverantörsblock"), r.supplierBlock)}
          ${numberRow("supplierBlockPrice", t("Pris per leverantörsblock"), r.supplierBlockPrice, 10)}
          ${numberRow("includedEmployees", t("Ingående anställda"), r.includedEmployees)}
          ${numberRow("employeeBlock", t("Anställdablock"), r.employeeBlock)}
          ${numberRow("employeeBlockPrice", t("Pris per anställdablock"), r.employeeBlockPrice, 10)}
          ${numberRow("includedInventoryValue", t("Ingående lagervärde"), r.includedInventoryValue, 100000)}
          ${numberRow("inventoryValueBlock", t("Lagervärdesblock"), r.inventoryValueBlock, 100000)}
          ${numberRow("inventoryValueBlockPrice", t("Pris per lagervärdesblock"), r.inventoryValueBlockPrice, 10)}
        </div>
      </section>
      <section class="form-section"><div class="form-section-head"><span class="folio">03</span><div><h3>${t("Moduler och support")}</h3><p>${t("Pris per vald modul och supportnivå.")}</p></div></div>
        <div class="form-grid">${moduleRows}
          ${numberRow("support_standard", t("Support · standard"), r.supportPrices.standard, 10)}
          ${numberRow("support_priority", t("Support · prioriterad"), r.supportPrices.priority, 10)}
          ${numberRow("support_dedicated", t("Support · dedikerad"), r.supportPrices.dedicated, 10)}
        </div>
      </section>
      <section class="form-section"><div class="form-section-head"><span class="folio">04</span><div><h3>${t("Integration och implementation")}</h3><p>${t("Löpande integrationsavgift och engångsinsats.")}</p></div></div>
        <div class="form-grid">
          ${numberRow("integrationMonthly", t("Per integration / månad"), r.integrationMonthly, 10)}
          ${numberRow("implementationBase", t("Implementation · bas"), r.implementationBase, 100)}
          ${numberRow("implementationPerIntegration", t("Implementation · per integration"), r.implementationPerIntegration, 100)}
          ${numberRow("implementationPerWarehouse", t("Implementation · per extra lager"), r.implementationPerWarehouse, 100)}
        </div>
      </section>
      <section class="form-section"><div class="form-section-head"><span class="folio">05</span><div><h3>${t("Paketgränser")}</h3><p>${t("Används för att rekommendera en intern konfiguration.")}</p></div></div>
        <div class="rule-packages">${packageRows}</div>
      </section>
      <div class="form-actions"><button class="btn" type="submit">${t("Spara prisregler")} ${icon("arrow", 15)}</button>
        <span class="hint">${t("Endast behöriga administratörer kan ändra reglerna.")}</span></div>
    </form>`,
  });
}

export function commercialPage(input: PageContext & {
  assumptions: Record<string, number>;
  results: Record<string, number>;
  scenarios: Array<{ name: string; created_at: string; input_json: string; output_json: string }>;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const a = input.assumptions;
  const r = input.results;
  const fieldRow = (name: string, label: string, value: number, step = 1): string =>
    `<div class="form-row"><label for="c-${name}">${esc(label)}</label><input id="c-${name}" name="${name}" type="number" min="0" step="${step}" value="${value}"></div>`;
  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Affärsplan"),
    active: "commercial",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Intern planering · antaganden, inte faktisk intäkt"),
    content: `
    ${flash(input.url, locale)}
    ${alert(t("Det här är ett scenario för intern planering. Siffrorna är antaganden, inte faktisk intäkt eller prognos från kunddata."), "warn")}
    <div class="grid">
      <div class="span-7">${card({
        title: t("Antaganden"),
        body: `<form method="post" action="/app/ekonomi" class="form-grid" data-busy="${t("Beräknar…")}">
          ${fieldRow("customers", t("Betalande kunder"), a.customers)}
          ${fieldRow("arpu", t("Intäkt per kund / månad (kr)"), a.arpu, 100)}
          ${fieldRow("newCustomers", t("Nya kunder / månad"), a.newCustomers)}
          ${fieldRow("churnPct", t("Månatlig churn (%)"), a.churnPct, 0.1)}
          ${fieldRow("cac", t("Kundanskaffningskostnad (kr)"), a.cac, 100)}
          ${fieldRow("grossMarginPct", t("Bruttomarginal (%)"), a.grossMarginPct, 0.5)}
          ${fieldRow("operatingCosts", t("Operativa kostnader / månad (kr)"), a.operatingCosts, 1000)}
          ${fieldRow("months", t("Planeringshorisont (månader)"), a.months)}
          <div class="span-2 form-actions"><button class="btn" type="submit">${t("Beräkna scenario")}</button></div>
        </form>`,
      })}</div>
      <div class="span-5">${card({
        title: t("Scenarioresultat"),
        body: `<dl class="kv scenario-results">
          <div><dt>${t("MRR")}</dt><dd>${sek(locale, r.mrr)}</dd></div>
          <div><dt>${t("ARR")}</dt><dd>${sek(locale, r.arr)}</dd></div>
          <div><dt>${t("Bruttovinst / månad")}</dt><dd>${sek(locale, r.grossProfit)}</dd></div>
          <div><dt>${t("Rörelseresultat / månad")}</dt><dd>${sek(locale, r.operatingResult)}</dd></div>
          <div><dt>${t("LTV")}</dt><dd>${sek(locale, r.ltv)}</dd></div>
          <div><dt>${t("LTV / CAC")}</dt><dd>${num(locale, r.ltvCac, 1)}×</dd></div>
          <div><dt>${t("CAC payback")}</dt><dd>${num(locale, r.paybackMonths, 1)} ${t("mån")}</dd></div>
          <div><dt>${t("Kunder efter horisonten")}</dt><dd>${num(locale, r.customersEnd)}</dd></div>
        </dl><p class="hint">${t("Formler: MRR = kunder × ARPU. LTV = ARPU × bruttomarginal ÷ churn. CAC payback = CAC ÷ månatlig bruttovinst per kund.")}</p>`,
      })}</div>
    </div>
    <div class="span-12 mt-4">${card({
      title: t("Sparade scenarier"),
      body: input.scenarios.length
        ? table({
            columns: [
              { key: "name", label: t("Namn") },
              { key: "customers", label: t("Kunder") },
              { key: "mrr", label: t("MRR") },
              { key: "created", label: t("Sparad") },
            ],
            rows: input.scenarios.map((s) => {
              const saved = JSON.parse(s.input_json) as Record<string, number>;
              const savedResult = JSON.parse(s.output_json) as Record<string, number>;
              return {
                name: esc(s.name),
                customers: num(locale, saved.customers),
                mrr: sek(locale, savedResult.mrr),
                created: date(locale, s.created_at),
              };
            }),
          })
        : `<p class="muted">${t("Inga sparade scenarier ännu.")}</p>`,
    })}</div>`,
  });
}
