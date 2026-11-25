/**
 * Legal documents: privacy policy (/integritet) and terms of service (/villkor).
 *
 * Everything stated as fact below is verified against the implementation:
 * scrypt password hashing, hashed session and API keys, the cookie set, the
 * 24-hour draft cleanup, the 14-day session TTL, the tenant scoping, the
 * non-persistence of raw uploads and the optional, disabled-by-default AI
 * rewording. Anything the founder has to confirm is rendered as a visible
 * [FYLL I …] placeholder instead of being invented.
 *
 * The documents are written in Swedish and mirrored in English because the
 * marketing surface is bilingual. The Swedish text is the binding version.
 */
import { EMAILS } from "../brand.ts";
import { esc, marketingShell } from "../ui/base.ts";
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import { fieldValues } from "../admin/store.ts";
import { previewMode } from "../admin/preview.ts";

export const LEGAL_VERSION = "2.1";
export const LEGAL_DATE_ISO = "2026-11-23";
const DATE_SV = "22 november 2026";
const DATE_EN = "22 November 2026";

const helloLink = EMAILS.hello ? `<a class="mono" href="mailto:${EMAILS.hello}">${EMAILS.hello}</a>` : null;
const privacyLink = EMAILS.privacy ? `<a class="mono" href="mailto:${EMAILS.privacy}">${EMAILS.privacy}</a>` : null;

/** A missing fact. Rendered so it can never be mistaken for published copy. */
/**
 * A structured field. The span carries the field key so the renderer can fill
 * it from the CMS without rebuilding the document strings at module load. An
 * unfilled field keeps the visible [FYLL I …] marker.
 */
const ph = (key: string, label: string): string => `<span class="legal-ph" data-k="${key}">[${label}]</span>`;

/** English copy states only details that are actually published. */
const phEn = (key: string, _label?: string): string => {
  const text: Record<string, string> = {
    "legal.company.name": "STOQWISE",
    "legal.company.orgNumber": "available on request",
    "legal.company.address": "available on request",
    "legal.company.legalAddress": "available on request",
    "legal.company.privacyEmail": "available on request",
    "legal.company.dpo": "available on request",
    "legal.comm.dpaDate": "under the data processing agreement",
    "legal.comm.jointControl": "This assessment is reviewed in each customer agreement.",
    "legal.tech.logs": "kept for security and operations",
    "legal.tech.retentionSupport": "as stated in the customer agreement",
    "legal.tech.retentionSecurity": "as stated in the customer agreement",
    "legal.tech.retentionAnalyses": "The customer controls deletion.",
    "legal.tech.retentionAudit": "as stated in the customer agreement",
    "legal.tech.retentionContact": "as stated in the customer agreement",
    "legal.tech.retentionLogs": "as stated in the customer agreement",
    "legal.tech.retentionBackups": "as stated in the customer agreement",
    "legal.comm.balancingDate": "as documented in our legitimate-interest assessment",
    "legal.tech.accountDeletion": "on request",
    "legal.tech.subprocessors": "listed in the data processing agreement",
    "legal.tech.locations": "as stated in the data processing agreement",
    "legal.tech.aiAgreement": "under the provider's data processing terms",
    "legal.tech.stripeAgreement": "under the provider's data processing terms",
    "legal.tech.emailProvider": "as stated in the customer agreement",
    "legal.tech.emailLocation": "as stated in the customer agreement",
    "legal.tech.transferSafeguards": "with appropriate safeguards",
    "legal.tech.thirdCountry": "",
    "legal.tech.securityMeasures": "and documented in the customer agreement",
    "legal.tech.incident": "under the incident procedure in the customer agreement",
    "legal.tech.cookies": "before any such tools are introduced",
    "legal.comm.versionArchive": "through the contact form",
    "legal.comm.paymentTerms": "as stated in the quotation",
    "legal.comm.reminder": "as agreed",
    "legal.comm.termination": "as agreed",
    "legal.comm.subprocessorNotice": "with reasonable notice",
    "legal.comm.sla": "unless a service level is expressly agreed",
    "legal.comm.support": "during Swedish business hours",
    "legal.comm.exportPeriod": "after termination",
    "legal.comm.deletionPeriod": "within 30 days thereafter",
    "legal.comm.court": "the courts of Sweden",
  };
  return `<span class="legal-ph">${text[key] ?? "as stated in the customer agreement"}</span>`;
};

interface Section {
  id: string;
  title: string;
  body: string;
}

interface DocCopy {
  eyebrow: string;
  title: string;
  lead: string;
  tocLabel: string;
  versionLabel: string;
  updatedLabel: string;
  badge: string;
  notice: string;
  crossLabel: string;
  crossHref: string;
  crossText: string;
  sections: Section[];
}

const table = (headers: string[], rows: string[][]): string =>
  `<div class="legal-table-wrap"><table class="legal-table"><thead><tr>${headers
    .map((h) => `<th scope="col">${h}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

/* ================================================================ privacy sv */

const PRIVACY_SV: Section[] = [
  {
    id: "tillampning",
    title: "1. Inledning och tillämpningsområde",
    body: `
      <p>Den här integritetspolicyn beskriver hur ${ph("legal.company.name", "FYLL I REGISTRERAT FÖRETAGSNAMN")} (nedan STOQWISE) behandlar personuppgifter när du besöker webbplatsen, skapar ett konto, använder plattformen, använder API:et eller kontaktar oss.</p>
      <p>Policyn omfattar den behandling som STOQWISE själv ansvarar för. Den omfattar inte behandling som en kundorganisation utför i sina egna system, och inte heller behandling som sker i tredjepartstjänster som kunden väljer att koppla till tjänsten. För kundens analysdata är STOQWISE personuppgiftsbiträde, se avsnitt 3.</p>
      <p>Text i <span class="legal-ph">[hakparentes]</span> är en uppgift som ännu inte bekräftats av STOQWISE:s företrädare. Sådana uppgifter är inte publicerade som fakta och ska fyllas i innan dokumentet används mot kund.</p>`,
  },
  {
    id: "ansvarig",
    title: "2. Personuppgiftsansvarig",
    body: `
      <p>Personuppgiftsansvarig för behandlingen som beskrivs i denna policy är STOQWISE. Uppgifterna nedan krävs enligt artikel 13.1 a GDPR.</p>
      ${table(
        ["Uppgift", "Värde"],
        [
          ["Registrerat företagsnamn", ph("legal.company.name", "FYLL I REGISTRERAT FÖRETAGSNAMN")],
          ["Organisationsnummer", ph("legal.company.orgNumber", "FYLL I ORGANISATIONSNUMMER")],
          ["Registrerad postadress", ph("legal.company.address", "FYLL I REGISTRERAD POSTADRESS")],
          ["Juridisk kontaktadress", ph("legal.company.legalAddress", "FYLL I JURIDISK KONTAKTADRESS")],
          ["E-post för integritetsärenden", privacyLink ?? ph("legal.company.privacyEmail", "FYLL I E-POST FÖR INTEGRITETSÄRENDEN")],
          ["Dataskyddsombud", ph("legal.company.dpo", "FYLL I DATASKYDDSKONTAKT, om sådant har utsetts")],
        ],
      )}
      <p class="legal-note">Till dess att uppgifterna är bekräftade är dokumentet ett utkast. Bolagsuppgifterna anges i kundavtalet och lämnas på begäran ${helloLink ? `via ${helloLink}` : "via kontaktformuläret på webbplatsen"}.</p>`,
  },
  {
    id: "roller",
    title: "3. Roller enligt GDPR",
    body: `
      <p><strong>STOQWISE som personuppgiftsansvarig.</strong> Vi ansvarar för behandlingen av uppgifter om dig som användare och kontaktperson: namn, e-postadress, företagstillhörighet, inloggningsuppgifter, sessions- och säkerhetsuppgifter, revisionslogg, API-nycklar, kontaktförfrågningar och faktureringsunderlag.</p>
      <p><strong>STOQWISE som personuppgiftsbiträde.</strong> När en kund laddar upp lagerdata som innehåller personuppgifter behandlar vi dem som personuppgiftsbiträde på kundens instruktion. Kunden är personuppgiftsansvarig och bestämmer ändamål och rättslig grund. Behandlingen regleras i personuppgiftsbiträdesavtal enligt artikel 28.3 GDPR ${ph("legal.comm.dpaDate", "FYLL I DATUM FÖR BITRÄDESAVTAL")}.</p>
      <p><strong>Kundens ansvar.</strong> Kunden ansvarar för att den har rätt att behandla och ladda upp uppgifterna, för att ha en rättslig grund, för att informera berörda personer och för att bedöma om uppladdade artikelbenämningar, lagerbeteckningar eller fritextfält innehåller personuppgifter.</p>
      <p><strong>Inget gemensamt ansvar.</strong> Behandlingen bedöms inte utgöra gemensamt personuppgiftsansvar enligt artikel 26 GDPR. ${ph("legal.comm.jointControl", "FYLL I OM ANNAN BEDÖMNING GÖRS EFTER JURIDISK GRANSKNING")}</p>`,
  },
  {
    id: "kategorier",
    title: "4. Kategorier av personuppgifter",
    body: `
      ${table(
        ["Kategori", "Innehåll", "Källa"],
        [
          [
            "Kontouppgifter",
            "Namn, e-postadress, företagsnamn, lösenordshash (scrypt med unikt salt) och tidpunkt för kontots skapande",
            "Du själv vid registrering eller vid accept av inbjudan",
          ],
          [
            "Organisationsuppgifter",
            "Organisationsnamn, abonnemangsplan, medlemskap, roll (ägare, administratör, analytiker, läsare) och organisationsinställningar",
            "Kundens administratör",
          ],
          [
            "Inbjudningar",
            "E-postadress, roll, inbjudans utfärdande och accept",
            "Kundens administratör",
          ],
          [
            "Sessions- och säkerhetsuppgifter",
            "Hash av sessionsidentifierare, utgångstid, IP-adress och tidpunkt vid inloggning",
            "Tekniskt genererad vid användning",
          ],
          [
            "Revisionslogg",
            "Åtgärd, objekt, användar- och organisations-id, IP-adress och tidsstämpel",
            "Tekniskt genererad vid åtgärder i tjänsten",
          ],
          [
            "API-nycklar",
            "Namn, prefix, hash av nyckeln, behörighetsomfattning och tidpunkt för senaste användning",
            "Kundens administratör",
          ],
          [
            "Import- och analysunderlag",
            "Filnamn, antal rader, tolkade artikelrader, beräknade resultat och lagerbeteckning",
            "Kunduppladdning",
          ],
          [
            "Kontaktförfrågningar",
            "Namn, e-postadress, företag, ämne och meddelande",
            "Du själv via kontaktformuläret",
          ],
          [
            "Faktureringsunderlag",
            "Företagsuppgifter, plan, period och betalstatus",
            "Kundavtal och betalningshantering",
          ],
          [
            "Driftloggar",
            ph("legal.tech.logs", "FYLL I TEKNISKA LOGGAR SOM FAKTISKT SPARAS OCH DERAS INNEHÅLL"),
            "Serverdrift",
          ],
        ],
      )}
      <p>Vi efterfrågar inte särskilda kategorier av personuppgifter enligt artikel 9 GDPR och inte heller personnummer. STOQWISE behandlar inga kortuppgifter: betalning sker mot faktura, och om kortbetalning aktiveras hanteras kortuppgifterna av betalningsleverantören som egen personuppgiftsansvarig.</p>`,
  },
  {
    id: "andamal",
    title: "5. Ändamål och rättslig grund",
    body: `
      ${table(
        ["Ändamål", "Uppgifter", "Rättslig grund", "Lagringstid"],
        [
          [
            "Skapa konto, autentisera och tillhandahålla analysfunktionen",
            "Kontouppgifter, organisationsuppgifter, analysunderlag",
            "Art. 6.1 b (avtal)",
            "Till dess att kontot eller organisationen raderas",
          ],
          [
            "Fakturering och bokföring",
            "Företagsuppgifter, fakturaunderlag, betalstatus",
            "Art. 6.1 b och 6.1 c (bokföringslagen 7 kap. 2 §)",
            "7 år",
          ],
          [
            "Support och kunddialog",
            "Namn, e-postadress, ärendets innehåll",
            "Art. 6.1 b och 6.1 f (berättigat intresse)",
            ph("legal.tech.retentionSupport", "FYLL I LAGRINGSTID FÖR SUPPORTÄRENDEN"),
          ],
          [
            "Säkerhet, missbruksskydd och felsökning",
            "IP-adress, sessionsuppgifter, revisionslogg, driftloggar",
            "Art. 6.1 f (berättigat intresse)",
            ph("legal.tech.retentionSecurity", "FYLL I LAGRINGSTID FÖR SÄKERHETSLOGGAR"),
          ],
          [
            "Marknadsföring till företag och organisationer",
            "Namn, e-postadress, företag",
            "Art. 6.1 f samt marknadsföringslagen (2008:486) 19 §",
            "Till dess att du invänder, längst 12 månader",
          ],
          [
            "Fastställa, göra gällande eller försvara rättsliga anspråk",
            "Samtliga kategorier som är relevanta för anspråket",
            "Art. 6.1 f (berättigat intresse)",
            "Till dess att anspråket är slutligt avgjort",
          ],
        ],
      )}
      <p>När behandlingen grundas på berättigat intresse har vi gjort en intresseavvägning ${ph("legal.comm.balancingDate", "FYLL I DATUM FÖR INTRESSEAVVÄGNING")}. Du har rätt att invända mot sådan behandling, se avsnitt 12.</p>`,
  },
  {
    id: "kunddata",
    title: "6. Kundens uppladdade information",
    body: `
      <p>Det underlag en kund laddar upp är i första hand affärsdata: artikelnummer eller SKU, benämning, kategori, leverantör, lagersaldo, inköpspris, försäljningspris, ledtid, minsta orderkvantitet och sålda enheter per månad. Sådana uppgifter är normalt inte personuppgifter, och den omständigheten att de lagras i tjänsten gör dem inte till personuppgifter.</p>
      <p>Underlaget kan ändå innehålla personuppgifter, till exempel om en artikelbenämning, en lagerbeteckning eller ett fritextfält innehåller ett namn, eller om kunden laddar upp uppgifter som rör enskilda anställda eller kunder. Kunden avgör detta och ansvarar för rättslig grund och information.</p>
      <p>Uppladdade filer får inte innehålla särskilda kategorier av personuppgifter enligt artikel 9 GDPR eller uppgifter om brott enligt artikel 10. Sådant underlag ska avidentifieras eller uteslutas innan det laddas upp.</p>
      <p><strong>Råfiler lagras inte.</strong> Filen läses i minnet, tolkas och sparas aldrig som fil på disk. Det som sparas är tolkade rader, beräknat resultat, filnamn, antal rader och tidpunkt. Radering blir därmed fullständig och kan verifieras.</p>
      <p><strong>Tekniska gränser.</strong> En uppladdning får vara högst 12 MB och innehålla högst 200 000 rader. Ett importutkast som inte slutförs raderas automatiskt efter 24 timmar.</p>`,
  },
  {
    id: "lagring",
    title: "7. Lagring och gallring",
    body: `
      <p>Personuppgifter sparas inte längre än vad som behövs för respektive ändamål. Följande tider är verifierade i implementationen eller följer av lag:</p>
      ${table(
        ["Uppgift", "Lagringstid", "Grund"],
        [
          ["Sessionskaka och sessionspost", "14 dagar från inloggning", "Teknisk livslängd i koden"],
          ["Importutkast som aldrig slutförs", "24 timmar, därefter automatisk radering", "Automatisk rensning i koden"],
          ["Analyser och tolkade artikelrader", `Till dess att kunden raderar dem i Inställningar. ${ph("legal.tech.retentionAnalyses", "FYLL I AVTALSMÄSSIG BORTRE GRÄNS")}`, "Kundens val"],
          ["Revisionslogg", ph("legal.tech.retentionAudit", "FYLL I LAGRINGSTID FÖR REVISIONSLOGG"), "Säkerhet och spårbarhet"],
          ["Kontaktförfrågningar", ph("legal.tech.retentionContact", "FYLL I LAGRINGSTID FÖR KONTAKTFÖRFRÅGNINGAR"), "Kunddialog"],
          ["Fakturaunderlag", "7 år", "Bokföringslagen (1999:1078) 7 kap. 2 §"],
          ["Drift- och serverloggar", ph("legal.tech.retentionLogs", "FYLL I LAGRINGSTID FÖR DRIFTLOGGAR"), "Drift och säkerhet"],
          ["Säkerhetskopior", ph("legal.tech.retentionBackups", "FYLL I LAGRINGSTID OCH ROTATION FÖR SÄKERHETSKOPIOR"), "Återställning"],
        ],
      )}
      <p>Kunden kan när som helst exportera hela organisationens data, inklusive fullständiga analysresultat och artikelrader, samt radera samtliga analyser under Inställningar. En ägare kan också radera hela organisationen permanent. Varje användare kan radera sitt eget konto. Radering av organisationen kräver att organisationens namn och lösenordet bekräftas; radering av kontot kräver e-postadress och lösenord. Analyser som en medlem skapat flyttas till en annan aktiv medlem när kontot raderas, så att organisationens data inte försvinner.</p>
      <p>Uppgifter som måste bevaras enligt lag, till exempel fakturaunderlag, raderas inte förrän lagringstiden löpt ut.</p>`,
  },
  {
    id: "underbitraden",
    title: "8. Underbiträden och externa leverantörer",
    body: `
      <p>STOQWISE anlitar underbiträden för drift och vissa funktioner. Underbiträden som behandlar personuppgifter för vår räkning omfattas av personuppgiftsbiträdesavtal enligt artikel 28.3 GDPR. Aktuell förteckning ska hållas tillgänglig för kunden, och kunden har rätt att invända mot ett nytt underbiträde enligt biträdesavtalet.</p>
      ${table(
        ["Funktion", "Leverantör", "Plats", "Avtal"],
        [
          ["Drift, hosting och lagring av databasen", ph("legal.tech.subprocessors", "FYLL I FAKTISKA UNDERBITRÄDEN"), ph("legal.tech.locations", "FYLL I FAKTISKA LAGRINGSPLATSER"), "Personuppgiftsbiträdesavtal"],
          ["Databaslagring", "Samma leverantör som driften; databasen är en fil på en persistent volym", ph("legal.tech.locations", "FYLL I FAKTISKA LAGRINGSPLATSER"), "Ingår i driftavtalet"],
          ["AI-assisterad omformulering (valfri, avstängd som standard)", "OpenAI eller Anthropic beroende på konfiguration", "USA", ph("legal.tech.aiAgreement", "FYLL I AVTAL OCH ÖVERFÖRINGSMekanism")],
          ["Kortbetalning (valfri, aktiveras av operatör)", "Stripe", "Irland och USA", ph("legal.tech.stripeAgreement", "FYLL I AVTAL")],
          ["E-post för rollbrevlådor", ph("legal.tech.emailProvider", "FYLL I LEVERANTÖR"), ph("legal.tech.emailLocation", "FYLL I PLATS"), ph("legal.tech.stripeAgreement", "FYLL I AVTAL")],
          ["Analys-, spårnings- eller annonsverktyg", "Används inte. Ingen extern analys- eller spårningskod laddas på webbplatsen.", "Inte tillämpligt", "Inte tillämpligt"],
        ],
      )}
      <p>AI-funktionen är avstängd om ingen leverantör och nyckel har konfigurerats. När den är aktiverad skickas frågan och det färdiga svar som redan beräknats i tjänsten, inte uppladdade filer och inte artikelrader. Se avsnitt 13.</p>`,
  },
  {
    id: "tredjeland",
    title: "9. Överföringar utanför EU/EES",
    body: `
      <p>Uppgifter lagras hos det driftunderbiträde som anges i avsnitt 8 ${ph("legal.tech.locations", "FYLL I FAKTISKA LAGRINGSPLATSER")}. Om lagring sker utanför EU/EES ska överföringen ha stöd i artikel 45–49 GDPR, normalt EU-kommissionens standardavtalsklausuler (2021/914) tillsammans med en dokumenterad överföringskonsekvensbedömning.</p>
      <p>När AI-omformuleringen är aktiverad skickas frågetext och det färdiga svaret till leverantören i USA. Överföringen ska grunda sig på standardavtalsklausuler ${ph("legal.tech.transferSafeguards", "FYLL I ÖVERFÖRINGSKONSEKVENSBEDÖMNING OCH KOMPLETTERANDE SKYDDSÅTGÄRDER")}. Är funktionen avstängd sker ingen sådan överföring.</p>
      <p>Övriga överföringar utanför EU/EES förekommer inte ${ph("legal.tech.thirdCountry", "FYLL I EVENTUELLA TREDJLANDSÖVERFÖRINGAR")}.</p>`,
  },
  {
    id: "sakerhet",
    title: "10. Informationssäkerhet",
    body: `
      <p>Vi vidtar tekniska och organisatoriska åtgärder enligt artikel 32 GDPR. Följande är verifierat i implementationen:</p>
      <ul>
        <li>Lösenord lagras som scrypt-hash med ett unikt salt per användare och jämförs i konstant tid.</li>
        <li>Sessionsidentifierare är 32 slumpade byte; endast SHA-256-hashen lagras, så en databasläcka ger inte tillgång till aktiva sessioner. Sessionen löper ut efter 14 dagar och raderas vid utloggning.</li>
        <li>Sessionskakan är HttpOnly, SameSite=Lax och Secure i produktionsläge.</li>
        <li>API-nycklar lagras hashade med ett visningsbart prefix och kan återkallas.</li>
        <li>Alla databasanrop för kunddata är begränsade till den egna organisationen; roller styr vad en användare får göra.</li>
        <li>Tillståndsändrande anrop kontrolleras mot samma ursprung, och inloggning, registrering och kontaktformulär är hastighetsbegränsade.</li>
        <li>Uppladdade råfiler sparas inte; endast tolkade rader och beräknade resultat lagras.</li>
      </ul>
      <p>Därutöver krävs följande innan drift mot kund ${ph("legal.tech.securityMeasures", "FYLL I TLS-KONFIGURATION, SÄKERHETSKOPIOR, PENETRATIONSTEST OCH LOGGNING")}. Vid personuppgiftsincident underrättar vi berörd kund utan onödigt dröjsmål och anmäler till IMY inom 72 timmar när anmälningsskyldighet föreligger enligt artikel 33 ${ph("legal.tech.incident", "FYLL I INCIDENTRUTIN OCH ANSVARIG")}.</p>`,
  },
  {
    id: "kakor",
    title: "11. Cookies och lokal lagring",
    body: `
      <p>Cookies och liknande tekniker regleras i 9 kap. 28 § lagen (2022:482) om elektronisk kommunikation. Samtycke krävs inte för lagring som är strikt nödvändig för att tillhandahålla en tjänst som användaren uttryckligen har begärt. STOQWISE sätter endast sådana cookies.</p>
      ${table(
        ["Namn", "Syfte", "Typ", "Lagringstid"],
        [
          ["lr_session", "Håller dig inloggad", "Strikt nödvändig", "14 dagar"],
          ["lr_lang", "Sparar valt språk", "Nödvändig för vald funktion", "12 månader"],
          ["lr_demo_env", "Sparar vald sandboxmiljö", "Nödvändig för vald funktion", "12 månader"],
        ],
      )}
      <p>Utöver detta använder webbläsarens lokala lagring för inställningar som stannar på din enhet och aldrig skickas till servern: <span class="mono">lr-theme</span> (ljust eller mörkt tema), <span class="mono">lr-rail</span> (sidomenyns läge) och <span class="mono">lr-filter:&lt;vy&gt;</span> (senast använda filter i en lista). Du tar bort dem genom att rensa webbläsarens data.</p>
      <p>STOQWISE använder inga annonskakor, ingen tredjepartsanalys, inga spårningspixlar och inga inbäddade tredjepartsskript. Typsnitt och övriga resurser serveras från den egna domänen. Eftersom endast nödvändiga cookies används visas ingen samtyckesbanner. Införs analys- eller marknadsföringsverktyg krävs samtycke och denna policy ska uppdateras först ${ph("legal.tech.cookies", "FYLL I FAKTISKA COOKIEINSTÄLLNINGAR OM SÅDANA INFÖRS")}.</p>`,
  },
  {
    id: "rattigheter",
    title: "12. Dina rättigheter",
    body: `
      <p>Enligt GDPR har du rätt till:</p>
      <ul>
        <li><strong>Tillgång</strong> (art. 15): en kopia av de personuppgifter vi behandlar om dig.</li>
        <li><strong>Rättelse</strong> (art. 16): rättelse av felaktiga eller ofullständiga uppgifter.</li>
        <li><strong>Radering</strong> (art. 17): radering när uppgifterna inte längre behövs eller behandlingen är olaglig.</li>
        <li><strong>Begränsning</strong> (art. 18): behandlingen begränsas under utredning.</li>
        <li><strong>Dataportabilitet</strong> (art. 20): uppgifterna i ett strukturerat, maskinläsbart format.</li>
        <li><strong>Invändning</strong> (art. 21): mot behandling som grundas på berättigat intresse, inklusive marknadsföring.</li>
        <li><strong>Rätt att inte omfattas av automatiserat beslutsfattande</strong> (art. 22), se avsnitt 13.</li>
      </ul>
      <p>I tjänsten kan du själv exportera hela organisationens data som JSON, radera samtliga analyser, radera hela organisationen som ägare och radera ditt eget konto. Övriga begäranden skickas ${privacyLink ? `till ${privacyLink}` : "genom kontaktformuläret på webbplatsen"}. Vi svarar inom en månad; vid komplexa begäranden kan fristen förlängas med två månader enligt artikel 12.3, och vi informerar då om skälet.</p>
      <p>Du har rätt att lämna klagomål till Integritetsskyddsmyndigheten, IMY, Box 8114, 104 20 Stockholm, imy.se. Cookies och lokal lagring omfattas av Post- och telestyrelsens tillsyn, pts.se.</p>`,
  },
  {
    id: "ai",
    title: "13. Automatiserade beslut och AI",
    body: `
      <p>Analysmotorn är deterministisk: den räknar på de rader kunden laddar upp med fasta statistiska metoder och returnerar samma resultat för samma underlag. Den fattar inga automatiserade beslut som har rättslig verkan eller påverkar dig som person på ett betydande sätt enligt artikel 22 GDPR, och den profilerar inte användare för marknadsföring.</p>
      <p>AI-assisterad omformulering är en valfri funktion som är avstängd som standard. När en operatör aktiverar den skickas frågan och det redan beräknade svaret till den konfigurerade leverantören för att formuleras om. Svaret godtas endast om varje tal i texten finns i det beräknade underlaget; annars används den deterministiska texten. Uppladdade filer skickas aldrig till en AI-leverantör.</p>
      <p>AI-texten är ett formuleringsstöd och inte ett beslutsunderlag i sig. Se även användarvillkoren avsnitt 4 om analysresultat och beslutsstöd.</p>`,
  },
  {
    id: "andringar",
    title: "14. Ändringar av policyn",
    body: `
      <p>Aktuell version och uppdateringsdatum anges högst upp i dokumentet. Väsentliga ändringar meddelas berörda kunder i tjänsten eller via e-post i skälig tid innan de träder i kraft, normalt 30 dagar. Ändringar som endast är redaktionella eller som följer av lag träder i kraft vid publicering.</p>
      <p>Tidigare versioner tillhandahålls på begäran ${ph("legal.comm.versionArchive", "FYLL I RUTIN FÖR VERSIONSARKIV")}.</p>`,
  },
  {
    id: "kontakt",
    title: "15. Kontakt",
    body: `
      <p>Frågor om denna policy eller om vår behandling av personuppgifter skickas ${privacyLink ? `till ${privacyLink}` : "genom kontaktformuläret på webbplatsen"} eller per post till ${ph("legal.company.address", "FYLL I REGISTRERAD POSTADRESS")}.</p>
      <p>Kontakt i avtalsfrågor: ${helloLink ? helloLink : '<a href="/kontakt">kontaktformuläret</a>'}. Klagomål på vår behandling kan alltid lämnas till IMY.</p>`,
  },
];

/* ================================================================ privacy en */

const PRIVACY_EN: Section[] = [
  {
    id: "tillampning",
    title: "1. Introduction and scope",
    body: `
      <p>This privacy policy explains how ${phEn("legal.company.name", "FYLL I REGISTRERAT FÖRETAGSNAMN")} (STOQWISE) processes personal data when you visit the website, create an account, use the platform or the API, or contact us.</p>
      <p>The policy covers processing for which STOQWISE is responsible. It does not cover processing a customer organisation performs in its own systems, nor processing in third-party services the customer chooses to connect. For customer analysis data, STOQWISE acts as a processor; see section 3.</p>
      <p>The controller details that apply to your agreement are provided in the customer agreement and on request.</p>`,
  },
  {
    id: "ansvarig",
    title: "2. Data controller",
    body: `
      <p>The controller for the processing described here is STOQWISE. Registered company details, postal address and data protection contact are set out in the customer agreement and are available ${privacyLink ? `at ${privacyLink}` : "through the contact form on this site"}.</p>`,
  },
  {
    id: "roller",
    title: "3. Roles under the GDPR",
    body: `
      <p><strong>STOQWISE as controller.</strong> We control the processing of data about you as a user and contact person: name, email address, company, credentials, session and security data, audit log, API keys, contact requests and invoicing records.</p>
      <p><strong>STOQWISE as processor.</strong> When a customer uploads inventory data that contains personal data, we process it as a processor on the customer's instruction. The customer is the controller and decides purpose and legal basis. Processing is governed by a data processing agreement under Article 28(3) GDPR ${phEn("legal.comm.dpaDate", "FYLL I DATUM FÖR BITRÄDESAVTAL")}.</p>
      <p><strong>Customer responsibility.</strong> The customer is responsible for having the right to process and upload the data, for having a legal basis, for informing data subjects, and for assessing whether uploaded item names, warehouse labels or free-text fields contain personal data.</p>
      <p><strong>No joint controllership.</strong> The processing is not considered joint controllership under Article 26 GDPR. ${phEn("legal.comm.jointControl", "FYLL I OM ANNAN BEDÖMNING GÖRS EFTER JURIDISK GRANSKNING")}</p>`,
  },
  {
    id: "kategorier",
    title: "4. Categories of personal data",
    body: `
      ${table(
        ["Category", "Content", "Source"],
        [
          ["Account data", "Name, email address, company, password hash (scrypt with a unique salt) and account creation time", "You, on registration or invitation acceptance"],
          ["Organisation data", "Organisation name, plan, membership, role (owner, admin, analyst, viewer) and settings", "The customer's administrator"],
          ["Invitations", "Email address, role, issue and acceptance time", "The customer's administrator"],
          ["Session and security data", "Hashed session identifier, expiry, IP address and sign-in time", "Generated when you use the service"],
          ["Audit log", "Action, target, user and organisation id, IP address and timestamp", "Generated by actions in the service"],
          ["API keys", "Name, prefix, key hash, scopes and last use", "The customer's administrator"],
          ["Import and analysis data", "Filename, row count, parsed item rows, computed results and warehouse label", "Customer upload"],
          ["Contact requests", "Name, email address, company, subject and message", "You, through the contact form"],
          ["Invoicing records", "Company details, plan, period and payment status", "Customer agreement and payment handling"],
          ["Operational logs", phEn("legal.tech.logs", "FYLL I TEKNISKA LOGGAR SOM FAKTISKT SPARAS OCH DERAS INNEHÅLL"), "Server operations"],
        ],
      )}
      <p>We do not request special categories of personal data under Article 9 GDPR and we do not process national identity numbers. STOQWISE does not process card data: payment is by invoice, and if card payment is enabled the card details are handled by the payment provider as its own controller.</p>`,
  },
  {
    id: "andamal",
    title: "5. Purposes and legal bases",
    body: `
      ${table(
        ["Purpose", "Data", "Legal basis", "Retention"],
        [
          ["Create the account, authenticate and provide the analysis features", "Account data, organisation data, analysis input", "Art. 6(1)(b) contract", "Until the account or organisation is deleted"],
          ["Invoicing and bookkeeping", "Company details, invoicing records, payment status", "Art. 6(1)(b) and 6(1)(c) (Swedish Bookkeeping Act, ch. 7 s. 2)", "7 years"],
          ["Support and customer dialogue", "Name, email address, case content", "Art. 6(1)(b) and 6(1)(f)", phEn("legal.tech.retentionSupport", "FYLL I LAGRINGSTID FÖR SUPPORTÄRENDEN")],
          ["Security, abuse prevention and troubleshooting", "IP address, session data, audit log, operational logs", "Art. 6(1)(f) legitimate interest", phEn("legal.tech.retentionSecurity", "FYLL I LAGRINGSTID FÖR SÄKERHETSLOGGAR")],
          ["Business-to-business marketing", "Name, email address, company", "Art. 6(1)(f) and the Swedish Marketing Act (2008:486) s. 19", "Until you object, at most 12 months"],
          ["Establish, exercise or defend legal claims", "Categories relevant to the claim", "Art. 6(1)(f)", "Until the claim is finally settled"],
        ],
      )}
      <p>Where processing relies on legitimate interest we have carried out a balancing test ${phEn("legal.comm.balancingDate", "FYLL I DATUM FÖR INTRESSEAVVÄGNING")}. You may object; see section 12.</p>`,
  },
  {
    id: "kunddata",
    title: "6. Information uploaded by the customer",
    body: `
      <p>The material a customer uploads is primarily business data: SKU, item name, category, supplier, stock on hand, cost, price, lead time, minimum order quantity and units sold per month. Such data is normally not personal data, and storing it in the service does not make it personal data.</p>
      <p>The material may still contain personal data, for example if an item name, warehouse label or free-text field contains a name, or if the customer uploads data about individual employees or customers. The customer makes that assessment and is responsible for legal basis and information.</p>
      <p>Uploaded files must not contain special categories of personal data under Article 9 GDPR or data on criminal offences under Article 10. Such material must be anonymised or removed before upload.</p>
      <p><strong>Raw files are not stored.</strong> The file is read in memory, parsed and never written to disk. What is stored is parsed rows, the computed result, filename, row count and timestamp. Deletion is therefore complete and verifiable.</p>
      <p><strong>Technical limits.</strong> An upload may be at most 12 MB and contain at most 200,000 rows. An import draft that is never completed is deleted automatically after 24 hours.</p>`,
  },
  {
    id: "lagring",
    title: "7. Storage and erasure",
    body: `
      <p>Personal data is not kept longer than necessary for each purpose. The following periods are verified in the implementation or required by law:</p>
      ${table(
        ["Data", "Retention", "Basis"],
        [
          ["Session cookie and session record", "14 days from sign-in", "Technical lifetime in the code"],
          ["Import drafts never completed", "24 hours, then automatically deleted", "Automatic cleanup in the code"],
          ["Analyses and parsed item rows", `Until the customer deletes them in Settings. ${phEn("legal.tech.retentionAnalyses", "FYLL I AVTALSMÄSSIG BORTRE GRÄNS")}`, "Customer choice"],
          ["Audit log", phEn("legal.tech.retentionAudit", "FYLL I LAGRINGSTID FÖR REVISIONSLOGG"), "Security and traceability"],
          ["Contact requests", phEn("legal.tech.retentionContact", "FYLL I LAGRINGSTID FÖR KONTAKTFÖRFRÅGNINGAR"), "Customer dialogue"],
          ["Invoicing records", "7 years", "Swedish Bookkeeping Act (1999:1078) ch. 7 s. 2"],
          ["Operational and server logs", phEn("legal.tech.retentionLogs", "FYLL I LAGRINGSTID FÖR DRIFTLOGGAR"), "Operations and security"],
          ["Backups", phEn("legal.tech.retentionBackups", "FYLL I LAGRINGSTID OCH ROTATION FÖR SÄKERHETSKOPIOR"), "Recovery"],
        ],
      )}
      <p>Customers can export all organisation data, including complete analysis results and item rows, at any time and delete all analyses under Settings. An owner can also delete the entire organisation permanently. Every user can delete their own account. Deleting an organisation requires the organisation name and password to be confirmed; deleting an account requires the email address and password. Analyses created by a member are reassigned to another active member when the account is deleted, so organisation data is not lost.</p>
      <p>Data that must be retained by law, such as invoicing records, is not deleted before the statutory period has expired.</p>`,
  },
  {
    id: "underbitraden",
    title: "8. Sub-processors and external providers",
    body: `
      <p>STOQWISE engages sub-processors for hosting and certain features. Sub-processors that process personal data on our behalf are covered by data processing agreements under Article 28(3) GDPR. A current list is provided to customers, and the customer may object to a new sub-processor under the processing agreement.</p>
      ${table(
        ["Function", "Provider", "Location", "Agreement"],
        [
          ["Operations, hosting and database storage", phEn("legal.tech.subprocessors", "FYLL I FAKTISKA UNDERBITRÄDEN"), phEn("legal.tech.locations", "FYLL I FAKTISKA LAGRINGSPLATSER"), "Data processing agreement"],
          ["Database storage", "Same provider as operations; the database is a file on a persistent volume", phEn("legal.tech.locations", "FYLL I FAKTISKA LAGRINGSPLATSER"), "Covered by the hosting agreement"],
          ["Optional AI rephrasing (off by default)", "OpenAI or Anthropic, depending on configuration", "United States", phEn("legal.tech.aiAgreement", "FYLL I AVTAL OCH ÖVERFÖRINGSMekanism")],
          ["Optional card payment (enabled by an operator)", "Stripe", "Ireland and the United States", phEn("legal.tech.stripeAgreement", "FYLL I AVTAL")],
          ["Email for role mailboxes", phEn("legal.tech.emailProvider", "FYLL I LEVERANTÖR"), phEn("legal.tech.emailLocation", "FYLL I PLATS"), phEn("legal.tech.stripeAgreement", "FYLL I AVTAL")],
          ["Analytics, tracking or advertising tools", "None. No external analytics or tracking code is loaded on the site.", "Not applicable", "Not applicable"],
        ],
      )}
      <p>AI rephrasing is disabled unless a provider and key are configured. When enabled, the question and the already computed answer are sent, not uploaded files and not item rows. See section 13.</p>`,
  },
  {
    id: "tredjeland",
    title: "9. Transfers outside the EU/EEA",
    body: `
      <p>Data is stored with the hosting sub-processor named in section 8 ${phEn("legal.tech.locations", "FYLL I FAKTISKA LAGRINGSPLATSER")}. If storage takes place outside the EU/EEA, the transfer must rely on Article 45–49 GDPR, normally the Standard Contractual Clauses (2021/914) together with a documented transfer impact assessment.</p>
      <p>When AI rephrasing is enabled, the question and the computed answer are sent to a provider in the United States. The transfer relies on the Standard Contractual Clauses ${phEn("legal.tech.transferSafeguards", "FYLL I ÖVERFÖRINGSKONSEKVENSBEDÖMNING OCH KOMPLETTERANDE SKYDDSÅTGÄRDER")}. With the feature disabled, no such transfer takes place.</p>
      <p>No other transfers outside the EU/EEA occur ${phEn("legal.tech.thirdCountry", "FYLL I EVENTUELLA TREDJLANDSÖVERFÖRINGAR")}.</p>`,
  },
  {
    id: "sakerhet",
    title: "10. Information security",
    body: `
      <p>We apply technical and organisational measures under Article 32 GDPR. The following is verified in the implementation:</p>
      <ul>
        <li>Passwords are stored as scrypt hashes with a unique salt per user and compared in constant time.</li>
        <li>Session identifiers are 32 random bytes; only the SHA-256 hash is stored, so a database leak does not expose live sessions. Sessions expire after 14 days and are removed on sign-out.</li>
        <li>The session cookie is HttpOnly, SameSite=Lax and Secure in production.</li>
        <li>API keys are stored hashed with a displayable prefix and can be revoked.</li>
        <li>Every customer data query is scoped to the organisation, and roles determine what a user may do.</li>
        <li>State-changing requests are checked against the same origin, and sign-in, registration and the contact form are rate limited.</li>
        <li>Raw uploads are not persisted; only parsed rows and computed results are stored.</li>
      </ul>
      <p>The following must be documented before customer operations ${phEn("legal.tech.securityMeasures", "FYLL I TLS-KONFIGURATION, SÄKERHETSKOPIOR, PENETRATIONSTEST OCH LOGGNING")}. In a personal data breach we notify the affected customer without undue delay and report to IMY within 72 hours where Article 33 requires it ${phEn("legal.tech.incident", "FYLL I INCIDENTRUTIN OCH ANSVARIG")}.</p>`,
  },
  {
    id: "kakor",
    title: "11. Cookies and local storage",
    body: `
      <p>Cookies and similar techniques are governed by chapter 9, section 28 of the Swedish Electronic Communications Act (2022:482). Consent is not required for storage that is strictly necessary to provide a service the user has explicitly requested. STOQWISE sets only such cookies.</p>
      ${table(
        ["Name", "Purpose", "Type", "Retention"],
        [
          ["lr_session", "Keeps you signed in", "Strictly necessary", "14 days"],
          ["lr_lang", "Remembers the chosen language", "Necessary for a requested feature", "12 months"],
          ["lr_demo_env", "Remembers the chosen sandbox environment", "Necessary for a requested feature", "12 months"],
        ],
      )}
      <p>The browser's local storage is used for preferences that stay on your device and are never sent to the server: <span class="mono">lr-theme</span> (light or dark theme), <span class="mono">lr-rail</span> (sidebar state) and <span class="mono">lr-filter:&lt;view&gt;</span> (last used filters in a list). You remove them by clearing browser data.</p>
      <p>STOQWISE uses no advertising cookies, no third-party analytics, no tracking pixels and no embedded third-party scripts. Fonts and other assets are served from our own domain. Because only necessary cookies are used, no consent banner is shown. If analytics or marketing tools are introduced, consent is required and this policy must be updated first ${phEn("legal.tech.cookies", "FYLL I FAKTISKA COOKIEINSTÄLLNINGAR OM SÅDANA INFÖRS")}.</p>`,
  },
  {
    id: "rattigheter",
    title: "12. Your rights",
    body: `
      <p>Under the GDPR you have the right to:</p>
      <ul>
        <li><strong>Access</strong> (Art. 15): a copy of the personal data we process about you.</li>
        <li><strong>Rectification</strong> (Art. 16): correction of inaccurate or incomplete data.</li>
        <li><strong>Erasure</strong> (Art. 17): deletion where data is no longer needed or processing is unlawful.</li>
        <li><strong>Restriction</strong> (Art. 18): processing limited while a matter is investigated.</li>
        <li><strong>Portability</strong> (Art. 20): data in a structured, machine-readable format.</li>
        <li><strong>Objection</strong> (Art. 21): to processing based on legitimate interest, including marketing.</li>
        <li><strong>Not to be subject to automated decision-making</strong> (Art. 22); see section 13.</li>
      </ul>
      <p>You can export all organisation data as JSON, delete all analyses, delete the entire organisation as an owner and delete your own account. Other requests go ${privacyLink ? `to ${privacyLink}` : "through the contact form on this site"}. We answer within one month; for complex requests the period may be extended by two further months under Article 12(3), and we will explain why.</p>
      <p>You may lodge a complaint with the Swedish Authority for Privacy Protection (IMY), Box 8114, 104 20 Stockholm, imy.se. Cookies and local storage are supervised by the Swedish Post and Telecom Authority, pts.se.</p>`,
  },
  {
    id: "ai",
    title: "13. Automated decisions and AI",
    body: `
      <p>The analysis engine is deterministic: it computes on the uploaded rows with fixed statistical methods and returns the same result for the same input. It does not make automated decisions with legal effects or similarly significant effects under Article 22 GDPR, and it does not profile users for marketing.</p>
      <p>AI-assisted rephrasing is an optional feature that is off by default. When an operator enables it, the question and the already computed answer are sent to the configured provider for rewording. The text is accepted only if every number in it exists in the computed material; otherwise the deterministic text is used. Uploaded files are never sent to an AI provider.</p>
      <p>AI text is a wording aid, not decision support in itself. See also section 4 of the terms of service on analysis results and decision support.</p>`,
  },
  {
    id: "andringar",
    title: "14. Changes to this policy",
    body: `
      <p>The current version and update date are shown at the top of the document. Material changes are announced to affected customers in the service or by email in reasonable time before they take effect, normally 30 days. Editorial changes and changes required by law take effect on publication.</p>
      <p>Previous versions are available on request ${phEn("legal.comm.versionArchive", "FYLL I RUTIN FÖR VERSIONSARKIV")}.</p>`,
  },
  {
    id: "kontakt",
    title: "15. Contact",
    body: `
      <p>Questions about this policy or our processing are sent ${privacyLink ? `to ${privacyLink}` : "through the contact form on this site"} or by post to ${phEn("legal.company.address", "FYLL I REGISTRERAD POSTADRESS")}.</p>
      <p>Contract enquiries: ${helloLink ? helloLink : '<a href="/kontakt">the contact form</a>'}. Complaints about our processing can always be lodged with IMY.</p>`,
  },
];

/* ================================================================== terms sv */

const TERMS_SV: Section[] = [
  {
    id: "parter",
    title: "1. Avtalets parter och tillämpning",
    body: `
      <p>Dessa användarvillkor gäller mellan ${ph("legal.company.name", "FYLL I REGISTRERAT FÖRETAGSNAMN")}, org.nr ${ph("legal.company.orgNumber", "FYLL I ORGANISATIONSNUMMER")}, ${ph("legal.company.address", "FYLL I REGISTRERAD POSTADRESS")} (nedan STOQWISE) och den organisation som tecknar abonnemang på tjänsten (nedan kunden).</p>
      <p>Villkoren riktar sig till företag och organisationer som handlar i sin yrkesverksamhet. De utgör ett avtal när kunden skapar ett konto, tecknar abonnemang eller använder tjänsten. Om kunden och STOQWISE har tecknat ett separat skriftligt avtal, inklusive personuppgiftsbiträdesavtal, har det företräde framför dessa villkor vid motstridighet.</p>
      <p>Den som accepterar villkoren för en organisations räkning bekräftar att han eller hon har behörighet att företräda organisationen.</p>`,
  },
  {
    id: "omfattning",
    title: "2. Tjänstens omfattning",
    body: `
      <p>STOQWISE är en molntjänst för lageranalys och beslutsstöd för inköp och lagerstyrning. Tjänsten omfattar, beroende på abonnemang:</p>
      <ul>
        <li>Import av lagerdata från CSV- och Excel-exporter och tolkning av kolumner till ett datamodell för artiklar.</li>
        <li>Beräkning av lagervärde, omsättningshastighet, dödlager, överlager, ABC/XYZ-klassificering, täckningsgrad och riskindikatorer.</li>
        <li>Efterfrågeprognoser med osäkerhetsintervall, säkerhetslager, beställningspunkt och inköpsförslag.</li>
        <li>Scenarier och simuleringar av efterfrågan, ledtid, leverantörsförseningar, pris och servicegrad.</li>
        <li>Den deterministiska lagerassistenten (copilot) som besvarar frågor med beräknade tal.</li>
        <li>Export i PDF och Excel, API med nyckelbaserad åtkomst samt webhookar för händelser.</li>
        <li>Rollbaserad åtkomst för ägare, administratör, analytiker och läsare.</li>
      </ul>
      <p>Tjänsten tillhandahålls i befintligt skick inom ramen för det abonnemang som kunden tecknat. Funktioner som anges som valfria, till exempel AI-assisterad omformulering, kan vara avstängda i installationen. STOQWISE äger rätt att förbättra, ändra och avveckla enskilda funktioner enligt avsnitt 11.</p>`,
  },
  {
    id: "kundens-ansvar",
    title: "3. Kundens ansvar",
    body: `
      <ul>
        <li>Kunden ansvarar för att underlaget som laddas upp är korrekt, fullständigt och rättighetsmässigt får behandlas, och för att ha rättslig grund för personuppgifter som ingår.</li>
        <li>Kunden ansvarar för att underlaget inte innehåller särskilda kategorier av personuppgifter enligt artikel 9 GDPR eller uppgifter om brott enligt artikel 10.</li>
        <li>Kunden ansvarar för att kolumnmappning, lagerbeteckningar, servicegrad, dödlagerdefinition och andra inställningar motsvarar den egna verksamhetens förutsättningar.</li>
        <li>Kunden ansvarar för att skydda inloggningsuppgifter, API-nycklar och webhookadresser samt för att tilldela roller enligt minsta behörighet. Delade konton är inte tillåtna.</li>
        <li>Kunden ansvarar för att ha nödvändiga rättigheter till de system och exporter som används för att ta fram underlaget.</li>
        <li>Kunden ska omedelbart informera STOQWISE vid misstanke om obehörig åtkomst eller säkerhetsincident som rör kontot.</li>
      </ul>`,
  },
  {
    id: "analysresultat",
    title: "4. Analysresultat och beslutsstöd",
    body: `
      <p>Tjänsten är ett beslutsstöd. Beräkningar, prognoser, klassificeringar, scenarier och inköpsrekommendationer bygger på det underlag kunden laddar upp och på de inställningar kunden väljer. Resultaten är matematiska och statistiska skattningar, inte garantier om framtida efterfrågan, lagervärde, marginal eller ekonomiskt utfall.</p>
      <p>Kunden fattar själv sina affärsbeslut. Kunden ansvarar för att värdera resultaten mot egen kunskap om marknad, säsong, kampanjer, leverantörsvillkor, avtal och redovisningsprinciper, och för att stämma av väsentliga inköp innan de genomförs.</p>
      <p>Detta begränsar inte STOQWISE:s ansvar enligt avsnitt 12. STOQWISE ansvarar för att tjänsten i huvudsak utför de beräkningar som beskrivs i dokumentationen och för att uppsåtliga eller grovt vårdslösa fel inte uppstår. STOQWISE ansvarar inte för beslut som kunden fattar i strid med vad resultatet visar eller utan att beakta kända förhållanden som inte ingår i underlaget.</p>`,
  },
  {
    id: "konto",
    title: "5. Konto, användare och behörigheter",
    body: `
      <p>Kunden ansvarar för de användare som bjuds in till organisationen. Behörigheter styrs av roll:</p>
      ${table(
        ["Roll", "Typisk behörighet"],
        [
          ["Ägare", "Full åtkomst, abonnemang, organisation, medlemmar, data och API"],
          ["Administratör", "Medlemmar, integrationer, API-nycklar och data"],
          ["Analytiker", "Import, analys, scenarier, copilot och export"],
          ["Läsare", "Läsa dashboard, artiklar, prognoser och rapporter"],
        ],
      )}
      <p>STOQWISE kan stänga av ett konto som används i strid med villkoren eller som utgör en säkerhetsrisk, enligt avsnitt 14. Kunden ansvarar för att ta bort användare som lämnat organisationen.</p>`,
  },
  {
    id: "abonnemang",
    title: "6. Abonnemang, priser och betalning",
    body: `
      <p>Abonnemang tillhandahålls enligt den plan kunden väljer. Priser, planomfattning och volymgränser framgår av offert eller avtal ${ph("legal.comm.paymentTerms", "FYLL I BETALNINGSVILLKOR")}.</p>
      <p>Betalning sker mot faktura med 30 dagars betalningsvillkor om inget annat avtalats. När kortbetalning är aktiverad hanteras betalningen av betalningsleverantören enligt dennes villkor. STOQWISE behandlar inga kortuppgifter.</p>
      <p>Priser anges exklusive moms om inget annat anges. STOQWISE har rätt att justera priser med 60 dagars skriftligt varsel. Justeringen gäller från och med nästa förnyelseperiod; kunden kan säga upp abonnemanget före dess enligt avsnitt 7.</p>
      <p>Vid försenad betalning har STOQWISE rätt till dröjsmålsränta enligt lag och att stänga av tjänsten efter skriftlig påminnelse ${ph("legal.comm.reminder", "FYLL I PÅMINNELSETID")}. Abonnemangsgränser, till exempel antal artiklar, användare eller analyser per månad, framgår av planen.</p>`,
  },
  {
    id: "avtalstid",
    title: "7. Avtalstid och uppsägning",
    body: `
      <p>Abonnemanget löper tills vidare med månadsvis förnyelse om inget annat avtalats. Uppsägning ska ske skriftligt senast 30 dagar före periodens slut ${ph("legal.comm.termination", "FYLL I UPPSÄGNINGSVILLKOR")}. Uppsägning gäller från och med nästa förnyelseperiod; redan betald period återbetalas inte om inte annat följer av tvingande lag.</p>
      <p>Vid uppsägning gäller avsnitt 14 om åtkomst till data efter avtalets upphörande. Bestämmelser om immateriella rättigheter, sekretess, ansvarsbegränsning och tillämplig lag fortsätter att gälla efter upphörandet.</p>`,
  },
  {
    id: "kunddata-ipr",
    title: "8. Kunddata och immateriella rättigheter",
    body: `
      <p>Kunden behåller alla rättigheter till det underlag kunden laddar upp och till de resultat som beräknas på underlaget (nedan kunddata). STOQWISE behandlar kunddata endast för att tillhandahålla, säkra och förbättra tjänsten enligt avtalet och personuppgiftsbiträdesavtalet.</p>
      <p>STOQWISE innehar alla rättigheter till tjänsten, programvaran, analysmetoderna, gränssnittet, dokumentationen och varumärkena. Kunden får en icke-exklusiv, icke överlåtbar rätt att använda tjänsten under abonnemangstiden.</p>
      <p>Kunden får inte kopiera, avkoda, sälja vidare eller använda tjänsten för att bygga en konkurrerande produkt. Återkoppling och förbättringsförslag får användas av STOQWISE utan ersättning, utan att kundens konfidentiella information röjs.</p>
      <p>Kunddata raderas enligt avsnitt 14 och enligt integritetspolicyn.</p>`,
  },
  {
    id: "personuppgifter",
    title: "9. Personuppgifter och sekretess",
    body: `
      <p>För personuppgifter i kunddata är kunden personuppgiftsansvarig och STOQWISE personuppgiftsbiträde. Behandlingen regleras av personuppgiftsbiträdesavtal enligt artikel 28.3 GDPR ${ph("legal.comm.dpaDate", "FYLL I DATUM FÖR BITRÄDESAVTAL")}. STOQWISE behandlar personuppgifterna endast enligt kundens dokumenterade instruktion, vidtar lämpliga säkerhetsåtgärder enligt artikel 32, bistår vid begäranden från registrerade och underrättar om incidenter utan onödigt dröjsmål.</p>
      <p>STOQWISE får anlita underbiträden enligt den förteckning som hålls tillgänglig för kunden. Kunden underrättas i skälig tid innan ett nytt underbiträde anlitas och har rätt att invända ${ph("legal.comm.subprocessorNotice", "FYLL I VARSELTID FÖR NYA UNDERBITRÄDEN")}.</p>
      <p>Båda parter ska hålla den andra partens konfidentiella information hemlig och använda den endast för att fullgöra avtalet. Sekretessen gäller även efter avtalets upphörande och omfattar affärshemligheter, priser, kunddata och tekniska detaljer.</p>`,
  },
  {
    id: "tillganglighet",
    title: "10. Tillgänglighet, underhåll och support",
    body: `
      <p>STOQWISE strävar efter att tjänsten ska vara tillgänglig dygnet runt, men lovar inte en viss tillgänglighet om inte en servicenivå uttryckligen avtalats ${ph("legal.comm.sla", "FYLL I EVENTUELLA SERVICENIVÅER")}. Planerat underhåll aviseras i förväg när det inte är akut.</p>
      <p>Driftstörningar åtgärdas med skälig skyndsamhet under svensk kontorstid ${ph("legal.comm.support", "FYLL I SUPPORTTIDER OCH SVARSTID")}. Support nås ${helloLink ? `via ${helloLink}` : "via kontaktformuläret på webbplatsen"}.</p>
      <p>Tjänsten tillhandahålls i befintligt skick. STOQWISE ansvarar inte för avbrott som beror på kundens nätverk, kundens egna system, tredjepartstjänster som kunden anslutit eller förhållanden utanför STOQWISE:s kontroll enligt avsnitt 13.</p>`,
  },
  {
    id: "andringar-tjanst",
    title: "11. Ändringar i tjänsten",
    body: `
      <p>STOQWISE utvecklar tjänsten löpande och får ändra, förbättra och avveckla funktioner. Väsentliga försämringar av en funktion som kunden använder aviseras minst 30 dagar i förväg om de inte följer av lag, säkerhet eller tredjepartsleverantörs villkor.</p>
      <p>Om en väsentlig ändring påverkar kundens användning på ett betydande sätt har kunden rätt att säga upp abonnemanget med verkan från ändringens ikraftträdande.</p>`,
  },
  {
    id: "ansvar",
    title: "12. Ansvarsbegränsning",
    body: `
      <p>STOQWISE ansvarar för direkt skada som orsakas av vårdslöshet eller fel i tjänsten. Ansvaret är begränsat till det belopp som kunden betalat för tjänsten under de tolv månader som föregår den skadeståndsgrundande händelsen. Om abonnemanget löpt kortare tid utgör de faktiskt betalda avgifterna gränsen.</p>
      <p>STOQWISE ansvarar inte för indirekta skador, såsom utebliven vinst, utebliven besparing, produktionsbortfall, förlust av goodwill eller skada på grund av att kunden förlitat sig på ett analysresultat i strid med avsnitt 4.</p>
      <p>Begränsningen gäller inte vid uppsåt eller grov vårdslöshet, vid personuppgiftsincident som orsakats av STOQWISE:s bristande säkerhet, vid brott mot sekretess eller vid ansvar som inte får begränsas enligt tvingande lag, inklusive produktansvar och ansvar enligt dataskyddsförordningen.</p>
      <p>Kunden ska framställa krav inom skälig tid efter att ha upptäckt skadan, och senast tolv månader efter händelsen.</p>`,
  },
  {
    id: "force-majeure",
    title: "13. Force majeure",
    body: `
      <p>Part är befriad från ansvar för underlåtenhet att fullgöra förpliktelse om underlåtenheten beror på omständighet utanför partens rimliga kontroll, såsom naturkatastrof, krig, terrorism, pandemi, strejk, myndighetsbeslut, omfattande nät- eller kraftavbrott, cyberangrepp mot samhällsviktig infrastruktur eller leverantörsavbrott som inte kunnat förebyggas med skäliga åtgärder.</p>
      <p>Part ska underrätta den andra parten utan onödigt dröjsmål. Om hindret varar längre än 60 dagar får endera parten säga upp avtalet med omedelbar verkan, utan skadestånd utöver vad som följer av avsnitt 7.</p>`,
  },
  {
    id: "avstangning",
    title: "14. Avstängning, upphörande och data efter avtalets slut",
    body: `
      <p>STOQWISE får stänga av åtkomsten helt eller delvis om kunden inte betalar förfallen faktura efter skriftlig påminnelse, om kunden använder tjänsten i strid med villkoren eller lag, om användningen innebär en säkerhetsrisk för tjänsten eller andra kunder, eller om det krävs enligt lag eller myndighetsbeslut. Avstängning sker i första hand för den berörda funktionen eller användaren.</p>
      <p>Vid uppsägning eller upphörande har kunden under 30 dagar rätt att exportera kunddata ${ph("legal.comm.exportPeriod", "FYLL I PERIOD FÖR EXPORT EFTER AVTALETS SLUT")}. Därefter raderas kunddata ${ph("legal.comm.deletionPeriod", "FYLL I RADERINGSFRIST EFTER AVTALETS SLUT")}, om inte lagring krävs enligt lag. Säkerhetskopior ersätts enligt den rotation som anges i integritetspolicyn.</p>
      <p>STOQWISE får säga upp avtalet med omedelbar verkan om kunden gör sig skyldig till väsentligt avtalsbrott som inte rättats inom 14 dagar efter skriftlig anmodan.</p>`,
  },
  {
    id: "lag-tvist",
    title: "15. Tillämplig lag och tvist",
    body: `
      <p>Svensk rätt tillämpas på avtalet, utan hänsyn till lagvalsregler som skulle leda till tillämpning av annan lag. Tvist som parterna inte kan lösa genom förhandling ska avgöras av ${ph("legal.comm.court", "FYLL I DOMSTOL ELLER SKILJENÄMND")} som första instans.</p>
      <p>Konsumentskyddslagstiftning tillämpas inte, eftersom tjänsten tillhandahålls till företag och organisationer i deras yrkesverksamhet. Om en bestämmelse i villkoren skulle vara ogiltig påverkas inte övriga bestämmelser.</p>`,
  },
  {
    id: "villkorsandringar",
    title: "16. Ändringar av villkoren",
    body: `
      <p>STOQWISE får ändra dessa villkor. Ändringar meddelas kunden skriftligt, normalt via e-post till organisationens administratör eller i tjänsten, minst 30 dagar innan de träder i kraft. Ändringar som endast är redaktionella eller följer av lag träder i kraft vid publicering.</p>
      <p>Om kunden inte accepterar en väsentlig ändring får kunden säga upp abonnemanget före ikraftträdandet. Fortsatt användning efter ikraftträdandet innebär att ändringen godtas. Aktuell version och uppdateringsdatum anges högst upp i dokumentet.</p>`,
  },
];

/* ================================================================== terms en */

const TERMS_EN: Section[] = [
  {
    id: "parter",
    title: "1. Parties and application",
    body: `
      <p>These terms apply between ${phEn("legal.company.name", "FYLL I REGISTRERAT FÖRETAGSNAMN")}, company registration number ${phEn("legal.company.orgNumber", "FYLL I ORGANISATIONSNUMMER")}, ${phEn("legal.company.address", "FYLL I REGISTRERAD POSTADRESS")} (STOQWISE) and the organisation subscribing to the service (the customer).</p>
      <p>The terms are addressed to businesses and organisations acting in the course of their professional activity. They form an agreement when the customer creates an account, subscribes or uses the service. A separate written agreement, including a data processing agreement, prevails over these terms in case of conflict.</p>
      <p>A person accepting the terms on behalf of an organisation confirms that he or she is authorised to represent it.</p>`,
  },
  {
    id: "omfattning",
    title: "2. Scope of the service",
    body: `
      <p>STOQWISE is a cloud service for inventory analysis and decision support for purchasing and inventory management. Depending on the subscription, the service includes:</p>
      <ul>
        <li>Import of inventory data from CSV and Excel exports, with column detection for items.</li>
        <li>Inventory value, turnover, dead stock, overstock, ABC/XYZ classification, coverage and risk indicators.</li>
        <li>Demand forecasts with uncertainty intervals, safety stock, reorder points and purchase proposals.</li>
        <li>Scenarios and simulations of demand, lead time, supplier delays, price and service level.</li>
        <li>The deterministic inventory copilot that answers with computed figures.</li>
        <li>PDF and Excel export, an API with key-based access, and webhooks for events.</li>
        <li>Role-based access for owner, admin, analyst and viewer.</li>
      </ul>
      <p>The service is provided as is within the subscribed plan. Features described as optional, such as AI-assisted rephrasing, may be disabled in the installation. STOQWISE may improve, change and retire individual features under section 11.</p>`,
  },
  {
    id: "kundens-ansvar",
    title: "3. Customer responsibilities",
    body: `
      <ul>
        <li>The customer is responsible for the accuracy and completeness of uploaded data and for having the right to process it, including a legal basis for any personal data.</li>
        <li>The customer must ensure the data contains no special categories of personal data under Article 9 GDPR and no data on criminal offences under Article 10.</li>
        <li>The customer is responsible for column mapping, warehouse labels, service level, dead-stock definitions and other settings matching its own operation.</li>
        <li>The customer must protect credentials, API keys and webhook endpoints and assign roles on least privilege. Shared accounts are not permitted.</li>
        <li>The customer must hold the necessary rights to the systems and exports used to produce the data.</li>
        <li>The customer must inform STOQWISE immediately of suspected unauthorised access or a security incident affecting the account.</li>
      </ul>`,
  },
  {
    id: "analysresultat",
    title: "4. Analysis results and decision support",
    body: `
      <p>The service is decision support. Calculations, forecasts, classifications, scenarios and purchase recommendations are based on the data the customer uploads and the settings the customer chooses. Results are mathematical and statistical estimates, not guarantees of future demand, inventory value, margin or financial outcome.</p>
      <p>The customer makes its own business decisions and must weigh results against its own knowledge of market, seasonality, campaigns, supplier terms, contracts and accounting principles, and must review material purchases before committing.</p>
      <p>This does not limit STOQWISE's liability under section 12. STOQWISE is responsible for the service substantially performing the calculations described in the documentation and for the absence of intentional or grossly negligent errors. STOQWISE is not responsible for decisions the customer makes contrary to the result or without regard to known circumstances not present in the data.</p>`,
  },
  {
    id: "konto",
    title: "5. Account, users and permissions",
    body: `
      <p>The customer is responsible for the users invited to its organisation. Permissions follow the role:</p>
      ${table(
        ["Role", "Typical permissions"],
        [
          ["Owner", "Full access: subscription, organisation, members, data and API"],
          ["Admin", "Members, integrations, API keys and data"],
          ["Analyst", "Import, analysis, scenarios, copilot and export"],
          ["Viewer", "Read dashboards, items, forecasts and reports"],
        ],
      )}
      <p>STOQWISE may suspend an account used in breach of these terms or posing a security risk, under section 14. The customer must remove users who have left the organisation.</p>`,
  },
  {
    id: "abonnemang",
    title: "6. Subscription, prices and payment",
    body: `
      <p>Subscriptions are provided according to the selected plan. Prices, plan scope and volume limits are stated in the quotation or agreement ${phEn("legal.comm.paymentTerms", "FYLL I BETALNINGSVILLKOR")}.</p>
      <p>Payment is by invoice with 30-day terms unless otherwise agreed. Where card payment is enabled, it is handled by the payment provider under its terms. STOQWISE does not process card data.</p>
      <p>Prices exclude VAT unless stated otherwise. STOQWISE may adjust prices with 60 days' written notice. The adjustment applies from the next renewal period; the customer may terminate before then under section 7.</p>
      <p>On late payment STOQWISE may charge statutory late-payment interest and suspend the service after written reminder ${phEn("legal.comm.reminder", "FYLL I PÅMINNELSETID")}. Plan limits, such as items, users or monthly analyses, are stated in the plan.</p>`,
  },
  {
    id: "avtalstid",
    title: "7. Term and termination",
    body: `
      <p>The subscription runs until further notice with monthly renewal unless otherwise agreed. Termination must be in writing no later than 30 days before the end of the period ${phEn("legal.comm.termination", "FYLL I UPPSÄGNINGSVILLKOR")}. Termination takes effect from the next renewal period; fees already paid are not refunded unless mandatory law requires it.</p>
      <p>On termination, section 14 governs access to data. Clauses on intellectual property, confidentiality, limitation of liability and governing law survive termination.</p>`,
  },
  {
    id: "kunddata-ipr",
    title: "8. Customer data and intellectual property",
    body: `
      <p>The customer retains all rights to the data it uploads and to the results computed from it (customer data). STOQWISE processes customer data only to provide, secure and improve the service under the agreement and the data processing agreement.</p>
      <p>STOQWISE owns all rights to the service, the software, the analysis methods, the interface, the documentation and the trademarks. The customer receives a non-exclusive, non-transferable right to use the service during the subscription term.</p>
      <p>The customer may not copy, reverse engineer, resell or use the service to build a competing product. Feedback and improvement suggestions may be used by STOQWISE without compensation, provided the customer's confidential information is not disclosed.</p>
      <p>Customer data is deleted under section 14 and the privacy policy.</p>`,
  },
  {
    id: "personuppgifter",
    title: "9. Personal data and confidentiality",
    body: `
      <p>For personal data in customer data, the customer is the controller and STOQWISE the processor. Processing is governed by a data processing agreement under Article 28(3) GDPR ${phEn("legal.comm.dpaDate", "FYLL I DATUM FÖR BITRÄDESAVTAL")}. STOQWISE processes personal data only on the customer's documented instruction, applies appropriate security measures under Article 32, assists with data subject requests and notifies incidents without undue delay.</p>
      <p>STOQWISE may engage sub-processors according to the list made available to the customer. The customer is notified in reasonable time before a new sub-processor is engaged and may object ${phEn("legal.comm.subprocessorNotice", "FYLL I VARSELTID FÖR NYA UNDERBITRÄDEN")}.</p>
      <p>Each party keeps the other's confidential information secret and uses it only to perform the agreement. Confidentiality survives termination and covers trade secrets, prices, customer data and technical details.</p>`,
  },
  {
    id: "tillganglighet",
    title: "10. Availability, maintenance and support",
    body: `
      <p>STOQWISE aims for round-the-clock availability but does not promise a specific level of availability unless a service level is expressly agreed ${phEn("legal.comm.sla", "FYLL I EVENTUELLA SERVICENIVÅER")}. Planned maintenance is announced in advance unless urgent.</p>
      <p>Incidents are addressed with reasonable promptness during Swedish business hours ${phEn("legal.comm.support", "FYLL I SUPPORTTIDER OCH SVARSTID")}. Support is reached ${helloLink ? `via ${helloLink}` : "through the contact form on this site"}.</p>
      <p>The service is provided as is. STOQWISE is not liable for interruptions caused by the customer's network, the customer's own systems, third-party services the customer connects, or circumstances outside STOQWISE's control under section 13.</p>`,
  },
  {
    id: "andringar-tjanst",
    title: "11. Changes to the service",
    body: `
      <p>STOQWISE develops the service continuously and may change, improve and retire features. Material deterioration of a feature the customer uses is announced at least 30 days in advance unless required by law, security or a third-party provider's terms.</p>
      <p>If a material change significantly affects the customer's use, the customer may terminate the subscription with effect from the change taking effect.</p>`,
  },
  {
    id: "ansvar",
    title: "12. Limitation of liability",
    body: `
      <p>STOQWISE is liable for direct loss caused by negligence or defects in the service. Liability is limited to the amount the customer paid for the service during the twelve months preceding the event giving rise to the claim. If the subscription has run for a shorter period, the fees actually paid are the cap.</p>
      <p>STOQWISE is not liable for indirect loss, such as lost profit, lost savings, loss of production, loss of goodwill, or loss caused by the customer relying on an analysis result contrary to section 4.</p>
      <p>The limitation does not apply to intent or gross negligence, to a personal data breach caused by STOQWISE's inadequate security, to breach of confidentiality, or to liability that cannot be limited under mandatory law, including product liability and liability under the GDPR.</p>
      <p>The customer must present a claim within reasonable time after discovering the loss, and no later than twelve months after the event.</p>`,
  },
  {
    id: "force-majeure",
    title: "13. Force majeure",
    body: `
      <p>A party is relieved of liability for failure to perform an obligation caused by a circumstance beyond its reasonable control, such as natural disaster, war, terrorism, pandemic, strike, government decision, extensive network or power outage, cyber attack on critical infrastructure, or supplier failure that could not be prevented with reasonable measures.</p>
      <p>The party must notify the other without undue delay. If the impediment lasts more than 60 days, either party may terminate with immediate effect, without damages beyond what follows from section 7.</p>`,
  },
  {
    id: "avstangning",
    title: "14. Suspension, termination and data after the agreement",
    body: `
      <p>STOQWISE may suspend access in whole or in part if the customer fails to pay a due invoice after written reminder, uses the service in breach of these terms or the law, poses a security risk to the service or other customers, or where required by law or a public authority. Suspension is applied first to the affected feature or user.</p>
      <p>On termination the customer may export customer data for 30 days ${phEn("legal.comm.exportPeriod", "FYLL I PERIOD FÖR EXPORT EFTER AVTALETS SLUT")}. Thereafter customer data is deleted ${phEn("legal.comm.deletionPeriod", "FYLL I RADERINGSFRIST EFTER AVTALETS SLUT")} unless retention is required by law. Backups are replaced according to the rotation stated in the privacy policy.</p>
      <p>STOQWISE may terminate with immediate effect if the customer commits a material breach not remedied within 14 days of written notice.</p>`,
  },
  {
    id: "lag-tvist",
    title: "15. Governing law and disputes",
    body: `
      <p>Swedish law applies to the agreement, without regard to conflict-of-law rules that would lead to another law. Disputes the parties cannot resolve through negotiation shall be decided by ${phEn("legal.comm.court", "FYLL I DOMSTOL ELLER SKILJENÄMND")} as the first instance.</p>
      <p>Consumer protection legislation does not apply, as the service is provided to businesses and organisations in their professional activity. If a provision is invalid, the remaining provisions remain in force.</p>`,
  },
  {
    id: "villkorsandringar",
    title: "16. Changes to the terms",
    body: `
      <p>STOQWISE may amend these terms. Amendments are notified in writing, normally by email to the organisation's administrator or in the service, at least 30 days before they take effect. Editorial changes and changes required by law take effect on publication.</p>
      <p>If the customer does not accept a material amendment, the customer may terminate before it takes effect. Continued use after it takes effect constitutes acceptance. The current version and update date are shown at the top of the document.</p>`,
  },
];

/* ================================================================= rendering */

function copyFor(kind: "integritet" | "villkor", locale: Locale): DocCopy {
  const sv = locale === "sv";
  const privacy = kind === "integritet";
  return {
    eyebrow: sv ? "Juridik" : "Legal",
    title: privacy ? (sv ? "Integritetspolicy" : "Privacy policy") : sv ? "Användarvillkor" : "Terms of service",
    lead: privacy
      ? sv
        ? "Hur STOQWISE behandlar personuppgifter i konto, tjänst och på webbplatsen, och vilka rättigheter du har."
        : "How STOQWISE processes personal data in the account, the service and on this site, and the rights you have."
      : sv
        ? "Villkor för abonnemang på STOQWISE: tjänstens omfattning, kundens ansvar, analysresultat, betalning och ansvar."
        : "Terms for a STOQWISE subscription: scope, customer responsibilities, analysis results, payment and liability.",
    tocLabel: sv ? "Innehåll" : "Contents",
    versionLabel: sv ? `Version ${LEGAL_VERSION}` : `Version ${LEGAL_VERSION}`,
    updatedLabel: sv ? `Uppdaterad ${DATE_SV}` : `Updated ${DATE_EN}`,
    badge: "",
    notice: "",
    crossLabel: privacy ? (sv ? "Se även" : "See also") : sv ? "Se även" : "See also",
    crossHref: privacy ? "/villkor" : "/integritet",
    crossText: privacy ? (sv ? "användarvillkoren" : "the terms of service") : sv ? "integritetspolicyn" : "the privacy policy",
    sections: privacy ? (sv ? PRIVACY_SV : PRIVACY_EN) : sv ? TERMS_SV : TERMS_EN,
  };
}

/* ------------------------------------------------------------- CMS overrides */

/** Fills [FYLL I …] markers with published (or previewed draft) field values. */
function resolveFields(markup: string, values: Record<string, string>): string {
  return markup.replace(/<span class="legal-ph" data-k="([^"]+)">\[([^\]]*)\]<\/span>/g, (_all, key: string, label: string) => {
    const value = values[key];
    return value ? `<span class="legal-value">${esc(value)}</span>` : `<span class="legal-ph">[${label}]</span>`;
  });
}

/**
 * Section bodies edited in the admin are plain text: blank line = paragraph,
 * "- " = list item, [text](/path) = link. Everything else is escaped, so a
 * pasted script tag can never reach the page.
 */
export function sectionTextToHtml(body: string): string {
  const inline = (line: string): string =>
    esc(line).replace(/\[([^\]]+)\]\((\/[a-z0-9\-/]*)\)/gi, '<a href="$2">$1</a>');

  const blocks: string[] = [];
  for (const chunk of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((line) => line.startsWith("- "))) {
      blocks.push(`<ul>${lines.map((line) => `<li>${inline(line.slice(2).trim())}</li>`).join("")}</ul>`);
    } else {
      blocks.push(`<p>${lines.map(inline).join("<br>")}</p>`);
    }
  }
  return blocks.join("\n");
}

function applyOverrides(kind: "integritet" | "villkor", sections: Section[], values: Record<string, string>, locale: Locale): Section[] {
  if (locale !== "sv") return sections.map((section) => ({ ...section, body: resolveFields(section.body, values) }));
  return sections.map((section) => {
    const prefix = `legal.sections.${kind}.${section.id}`;
    const title = values[`${prefix}.title`];
    const body = values[`${prefix}.body`];
    return {
      id: section.id,
      title: title ? title : section.title,
      body: body ? sectionTextToHtml(body) : resolveFields(section.body, values),
    };
  });
}

/** The shipped section, used as the starting point in the admin editor. */
export function legalSectionSource(doc: "integritet" | "villkor", id: string): { title: string; body: string } | null {
  const list = doc === "integritet" ? PRIVACY_SV : TERMS_SV;
  const section = list.find((entry) => entry.id === id);
  return section ? { title: section.title, body: section.body } : null;
}

/** Section index for the admin editor. Swedish is the binding version. */
export function legalSectionIndex(): Array<{ doc: "integritet" | "villkor"; id: string; title: string }> {
  return [
    ...PRIVACY_SV.map((section) => ({ doc: "integritet" as const, id: section.id, title: section.title })),
    ...TERMS_SV.map((section) => ({ doc: "villkor" as const, id: section.id, title: section.title })),
  ];
}

function renderSection(section: Section): string {
  return `<section class="legal-section" id="${section.id}">
    <h2>${section.title}<a class="legal-anchor" href="#${section.id}" aria-label="${section.title}">#</a></h2>
    ${section.body}
  </section>`;
}

export function legalPage(kind: "integritet" | "villkor", user: { name: string } | null, locale: Locale = DEFAULT_LOCALE): string {
  const copy = copyFor(kind, locale);
  const values = fieldValues("legal", locale, previewMode());
  const sections = applyOverrides(kind, copy.sections, values, locale);
  const toc = `<nav class="legal-toc" aria-label="${copy.tocLabel}">
    <p class="legal-toc-title">${copy.tocLabel}</p>
    <ol>${sections.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join("")}</ol>
    <p class="legal-toc-foot">${copy.versionLabel} · ${copy.updatedLabel}</p>
  </nav>`;

  return marketingShell({
    title: kind === "integritet" ? (locale === "sv" ? "Integritet · STOQWISE" : "Privacy · STOQWISE") : locale === "sv" ? "Villkor · STOQWISE" : "Terms · STOQWISE",
    user,
    locale,
    path: kind === "integritet" ? "/integritet" : "/villkor",
    content: `<section class="site-wrap legal-page" id="top">
      <header class="legal-head">
        <p class="eyebrow">${copy.eyebrow}</p>
        <h1>${copy.title}</h1>
        <p class="legal-lead">${copy.lead}</p>
        <div class="legal-meta">
          <span>${copy.versionLabel}</span>
          <span>${copy.updatedLabel}</span>
          ${copy.badge ? `<span class="legal-badge">${copy.badge}</span>` : ""}
        </div>
        ${copy.notice ? `<p class="legal-notice">${copy.notice}</p>` : ""}
      </header>
      <div class="legal-layout">
        ${toc}
        <div class="legal-body">
          ${sections.map(renderSection).join("\n")}
          <p class="legal-crosslink">${copy.crossLabel} <a href="${copy.crossHref}">${copy.crossText}</a>. · <a href="#top">${locale === "sv" ? "Till toppen" : "Back to top"}</a></p>
        </div>
      </div>
    </section>`,
  });
}

export { PRIVACY_SV, PRIVACY_EN, TERMS_SV, TERMS_EN };
