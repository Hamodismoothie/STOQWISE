/**
 * Field registry for the administration system.
 *
 * Every editable value on the public site and in the legal documents is named
 * here once. The CMS, the publish flow, the "missing information" list and the
 * legal renderer all read from this registry, so adding a field never requires
 * touching the rendering code.
 *
 * `required` fields are the ones a published document or page should not go
 * without. They drive the blocker list in the admin dashboard and the warning
 * on the publish screen.
 */

export type FieldScope = "site" | "legal";

export interface FieldDef {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
}

export interface FieldGroup {
  id: string;
  title: string;
  description: string;
  scope: FieldScope;
  fields: FieldDef[];
}

/* ------------------------------------------------------------------- legal */

export const LEGAL_GROUPS: FieldGroup[] = [
  {
    id: "company",
    title: "Företagsuppgifter",
    description: "Publiceras i integritetspolicyns avsnitt 2 och i villkorens avsnitt 1. Krävs enligt artikel 13.1 a GDPR.",
    scope: "legal",
    fields: [
      { key: "legal.company.name", label: "Registrerat företagsnamn", required: true, maxLength: 120 },
      { key: "legal.company.orgNumber", label: "Organisationsnummer", required: true, maxLength: 20 },
      { key: "legal.company.address", label: "Registrerad postadress", required: true, maxLength: 160 },
      { key: "legal.company.legalAddress", label: "Juridisk kontaktadress", help: "Om annan än besöksadress.", maxLength: 160 },
      { key: "legal.company.privacyEmail", label: "E-post för integritetsärenden", required: true, maxLength: 160 },
      { key: "legal.company.dpo", label: "Dataskyddsombud", help: "Lämna tomt om inget ombud är utsett, då säger texten det.", maxLength: 120 },
    ],
  },
  {
    id: "technical",
    title: "Tekniska uppgifter",
    description: "Underbiträden, lagring, överföringar och lagringstider. Används i policyns avsnitt 7–11.",
    scope: "legal",
    fields: [
      { key: "legal.tech.subprocessors", label: "Hosting- och driftleverantör", required: true, maxLength: 160 },
      { key: "legal.tech.locations", label: "Lagringsplatser", help: "Region och land, till exempel europe-west, London.", required: true, maxLength: 160 },
      { key: "legal.tech.logs", label: "Tekniska loggar som sparas", required: true, multiline: true, maxLength: 400 },
      { key: "legal.tech.retentionAnalyses", label: "Lagringstid för analyser", required: true, maxLength: 200 },
      { key: "legal.tech.retentionAudit", label: "Lagringstid för revisionslogg", required: true, maxLength: 160 },
      { key: "legal.tech.retentionSupport", label: "Lagringstid för supportärenden", maxLength: 160 },
      { key: "legal.tech.retentionSecurity", label: "Lagringstid för säkerhetsloggar", maxLength: 160 },
      { key: "legal.tech.retentionContact", label: "Lagringstid för kontaktförfrågningar", maxLength: 160 },
      { key: "legal.tech.retentionLogs", label: "Lagringstid för driftloggar", maxLength: 160 },
      { key: "legal.tech.retentionBackups", label: "Lagringstid och rotation för säkerhetskopior", required: true, maxLength: 200 },
      { key: "legal.tech.accountDeletion", label: "Rutin för att radera konto", required: true, multiline: true, maxLength: 400 },
      { key: "legal.tech.transferSafeguards", label: "Skyddsåtgärder vid tredjelandsöverföring", multiline: true, maxLength: 400 },
      { key: "legal.tech.thirdCountry", label: "Övriga tredjelandsöverföringar", help: "Skriv \"Inga\" om det inte förekommer några.", maxLength: 200 },
      { key: "legal.tech.aiAgreement", label: "Avtal med AI-leverantör", multiline: true, maxLength: 300 },
      { key: "legal.tech.stripeAgreement", label: "Avtal med betalningsleverantör", maxLength: 200 },
      { key: "legal.tech.emailProvider", label: "Leverantör för e-post", maxLength: 120 },
      { key: "legal.tech.emailLocation", label: "Plats för e-postleverantör", maxLength: 120 },
      { key: "legal.tech.securityMeasures", label: "Tekniska säkerhetsåtgärder i drift", help: "TLS, säkerhetskopior, penetrationstest, loggning.", required: true, multiline: true, maxLength: 400 },
      { key: "legal.tech.incident", label: "Incidentrutin och ansvarig", required: true, multiline: true, maxLength: 300 },
      { key: "legal.tech.cookies", label: "Cookieinformation om verktyg införs", maxLength: 300 },
    ],
  },
  {
    id: "commercial",
    title: "Kommersiella uppgifter",
    description: "Betalning, uppsägning, servicenivå och tvist. Används i villkorens avsnitt 6–15.",
    scope: "legal",
    fields: [
      { key: "legal.comm.paymentTerms", label: "Betalningsvillkor", required: true, multiline: true, maxLength: 300 },
      { key: "legal.comm.reminder", label: "Påminnelsetid vid försenad betalning", maxLength: 160 },
      { key: "legal.comm.termination", label: "Uppsägningstid", required: true, maxLength: 200 },
      { key: "legal.comm.sla", label: "Servicenivåer", help: "Skriv \"Ingen avtalad servicenivå\" om ingen garanteras.", required: true, maxLength: 300 },
      { key: "legal.comm.support", label: "Supporttider och svarstid", required: true, maxLength: 200 },
      { key: "legal.comm.court", label: "Domstol eller skiljenämnd", required: true, maxLength: 160 },
      { key: "legal.comm.exportPeriod", label: "Exportperiod efter avtalets slut", maxLength: 160 },
      { key: "legal.comm.deletionPeriod", label: "Raderingstid efter avtalets slut", required: true, maxLength: 200 },
      { key: "legal.comm.subprocessorNotice", label: "Varseltid för nytt underbiträde", maxLength: 160 },
      { key: "legal.comm.dpaDate", label: "Datum för personuppgiftsbiträdesavtal", maxLength: 120 },
      { key: "legal.comm.balancingDate", label: "Datum för intresseavvägning", maxLength: 120 },
      { key: "legal.comm.jointControl", label: "Bedömning av gemensamt ansvar", maxLength: 300 },
      { key: "legal.comm.versionArchive", label: "Rutin för versionsarkiv", maxLength: 200 },
    ],
  },
];

/* -------------------------------------------------------------------- site */

export const SITE_GROUPS: FieldGroup[] = [
  {
    id: "hero",
    title: "Startsida: hero",
    description: "Rubrik, accentrad och ingress högst upp på startsidan.",
    scope: "site",
    fields: [
      { key: "site.home.title1", label: "Rubrik, rad 1", required: true, maxLength: 60 },
      { key: "site.home.title2", label: "Rubrik, rad 2 (accent)", required: true, maxLength: 60 },
      { key: "site.home.eyebrow", label: "Överrubrik", maxLength: 100 },
      { key: "site.home.lead", label: "Ingress", required: true, multiline: true, maxLength: 240 },
    ],
  },
  {
    id: "sections",
    title: "Sektioner och beskrivningar",
    description: "Inledande texter för funktioner, branscher, om oss och prissättning.",
    scope: "site",
    fields: [
      { key: "site.home.valueTitle", label: "Rubrik: var analysen används", maxLength: 120 },
      { key: "site.home.valueNote", label: "Beskrivning: var analysen används", multiline: true, maxLength: 240 },
      { key: "site.home.ctaTitle", label: "Rubrik: avslutande uppmaning", maxLength: 120 },
      { key: "site.home.ctaText", label: "Text: avslutande uppmaning", multiline: true, maxLength: 300 },
      { key: "site.about.lead", label: "Om oss: ingress", required: true, multiline: true, maxLength: 300 },
      { key: "site.pricing.sub", label: "Prissättning: ingress", required: true, multiline: true, maxLength: 300 },
      { key: "site.pricing.vat", label: "Prissättning: moms och betalning", maxLength: 240 },
      { key: "site.help.lead", label: "Hjälpcenter: ingress", maxLength: 240 },
    ],
  },
  {
    id: "contact",
    title: "Kontakt",
    description: "Kontaktuppgifter som visas på kontaktsidan.",
    scope: "site",
    fields: [
      { key: "site.contact.h1", label: "Rubrik", required: true, maxLength: 120 },
      { key: "site.contact.lead", label: "Ingress", required: true, multiline: true, maxLength: 300 },
      { key: "site.contact.emailLabel", label: "Etikett för e-post", maxLength: 60 },
      { key: "site.contact.demoLink", label: "Text för demobokning", maxLength: 120 },
    ],
  },
  {
    id: "faq",
    title: "Vanliga frågor",
    description: "Frågor och svar i hjälpcentret. Lämna tomt för att behålla den inbyggda texten.",
    scope: "site",
    fields: [
      ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [
        { key: `site.help.faq.${n}.q`, label: `Fråga ${n}`, maxLength: 160 },
        { key: `site.help.faq.${n}.a`, label: `Svar ${n}`, multiline: true, maxLength: 600 },
      ]),
    ],
  },
  {
    id: "footer",
    title: "Sidfot",
    description: "Texter som visas i sidfoten på alla publika sidor.",
    scope: "site",
    fields: [
      { key: "site.footer.tagline", label: "Tagline", required: true, maxLength: 160 },
      { key: "site.footer.note", label: "Notis", maxLength: 160 },
      { key: "site.footer.rights", label: "Rättighetsrad", maxLength: 120 },
    ],
  },
  {
    id: "meta",
    title: "Sidmetadata",
    description: "Meta description för sökmotorer. Rubriken i fliken påverkas inte.",
    scope: "site",
    fields: [
      { key: "site.meta.home.description", label: "Startsida: beskrivning", required: true, multiline: true, maxLength: 300 },
      { key: "site.meta.start.description", label: "Kom igång: beskrivning", maxLength: 300 },
      { key: "site.meta.about.description", label: "Om oss: beskrivning", maxLength: 300 },
      { key: "site.meta.pricing.description", label: "Prissättning: beskrivning", maxLength: 300 },
      { key: "site.meta.product.description", label: "Produkt: beskrivning", maxLength: 300 },
      { key: "site.meta.contact.description", label: "Kontakt: beskrivning", maxLength: 300 },
    ],
  },
];

export const ALL_GROUPS: FieldGroup[] = [...SITE_GROUPS, ...LEGAL_GROUPS];

/** Every field with the scope of its group attached. */
export const ALL_FIELDS: Array<FieldDef & { scope: FieldScope }> = ALL_GROUPS.flatMap((group) =>
  group.fields.map((field) => ({ ...field, scope: group.scope })),
);

export function groupById(id: string): FieldGroup | undefined {
  return ALL_GROUPS.find((group) => group.id === id);
}

export function fieldByKey(key: string): FieldDef | undefined {
  return ALL_FIELDS.find((field) => field.key === key);
}

/** Section-level overrides for the two legal documents. */
export const LEGAL_SECTION_KEYS = (doc: "integritet" | "villkor", sectionId: string, part: "title" | "body"): string =>
  `legal.sections.${doc}.${sectionId}.${part}`;
