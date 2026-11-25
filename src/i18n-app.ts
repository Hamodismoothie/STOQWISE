/**
 * App catalog.
 *
 * The authenticated product was written in Swedish, and its copy lives inline in
 * the page functions. Rather than move several hundred existing strings into a
 * second set of semantic keys (and keep two Swedish copies in sync), the app
 * catalog is gettext-style: the Swedish source string is the key and English is
 * the translation. `appText("sv", source)` is an identity function, so Swedish
 * rendering is byte-for-byte unchanged.
 *
 * Everything that is not UI copy - item names, categories, filenames - stays as
 * data and is never passed through this catalog.
 */
import { formatNumber, intlFor, type Locale } from "./i18n.ts";

/**
 * Pseudo-locale for CI. It is never user-selectable. Every translated string is
 * wrapped so a rendered page can be checked for strings that never went through
 * the app catalog, and every missing English key becomes a visible marker
 * instead of silently falling back to Swedish.
 */
export const PSEUDO_LOCALE = "en-XA" as const;
export const PSEUDO_OPEN = "⟦";
export const PSEUDO_CLOSE = "⟧";
export const PSEUDO_MISSING = `${PSEUDO_OPEN}missing:`;

const EN: Record<string, string> = {
  /* export guides and the pre-upload check */
  "Exportguider": "Export guides",
  "Menyväg och kolumner för de vanligaste affärs- och butikssystemen.": "Menu paths and columns for the most common business and store systems.",
  "Menyväg och kolumner för de vanligaste affärs- och butikssystemen. Tar en till fem minuter.": "Menu paths and columns for the most common business and store systems. Takes one to five minutes.",
  "Gå direkt till": "Jump to",
  "Ungefär {n} minuter": "About {n} minutes",
  "Menyväg": "Menu path",
  "Kolumner som krävs": "Columns required",
  "Officiell dokumentation": "Official documentation",
  "Tillbaka till importen": "Back to imports",
  "Samma krav oavsett system. Saknas en kolumn kan du mappa den manuellt i nästa steg.": "The same requirements in every system. If a column is missing you can map it manually in the next step.",
  "Två kolumner räcker för att komma igång: saldo och inköpspris.": "Two columns are enough to start: stock and unit cost.",
  "Hitta exporten i ditt system": "Find the export in your system",
  "Öppna exportguiderna": "Open the export guides",
  "Förhandskontroll av filen": "File pre-check",
  "Allt som krävs finns: {found}.": "Everything required is present: {found}.",
  "Saknas: {missing}.": "Missing: {missing}.",
  "Lägg till kolumnen i exporten, eller mappa den manuellt i nästa steg.": "Add the column to the export, or map it manually in the next step.",
  "Artikelidentitet: {header}.": "Item identity: {header}.",
  "Ingen kolumn för artikelnummer eller benämning hittades. Lägg till en sådan i exporten.": "No column for item number or description was found. Add one to the export.",
  "Excel kontrolleras först efter uppladdning. Förhandskontrollen gäller CSV.": "Excel is checked after upload. The pre-check covers CSV.",
  "Filen verkar bara innehålla rubriker.": "The file seems to contain headers only.",
  "Läser filens rubrikrad…": "Reading the header row…",
  /* ------------------------------------------------------------- shell */
  Översikt: "Overview",
  Artiklar: "Items",
  Prognos: "Forecast",
  Simulering: "Simulation",
  Importer: "Imports",
  Integrationer: "Integrations",
  Team: "Team",
  Abonnemang: "Subscription",
  Logg: "Audit log",
  Hjälp: "Help",
  "Hoppa till innehåll": "Skip to content",
  Huvudnavigering: "Main navigation",
  Sök: "Search",
  Tema: "Theme",
  "Byt tema": "Change theme",
  "Byt till mörkt tema": "Switch to dark theme",
  "Byt till ljust tema": "Switch to light theme",
  "Rörelse av: aktivera animationer": "Motion off: resume animations",
  "Rörelse: pausa animationer": "Motion: pause animations",
  "Logga ut": "Sign out",
  "Sök (⌘K)": "Search (⌘K)",
  "Snabbsök": "Quick search",
  "Stäng sökningen": "Close search",
  "Söker…": "Searching…",
  "Sökningen misslyckades": "Search failed",
  "Inga träffar": "No matches",
  "Visa alla resultat": "Show all results",
  Kategorier: "Categories",
  Synonymer: "Synonyms",
  Synonym: "Synonym",
  Översättning: "Translation",
  "Sök artikel, SKU…": "Search item, SKU…",
  "Inloggad användare": "Signed-in user",
  "Inaktivt lager": "Inactive stock",
  "Kapital i inaktiva artiklar": "Capital in inactive items",
  "Hälsopoäng = 0,30 × kapital i inaktiva artiklar + 0,25 × överlager + 0,20 × bristrisk + 0,25 × omsättning, skalad 0–100.":
    "Health score = 0.30 × capital in inactive items + 0.25 × overstock + 0.20 × stockout risk + 0.25 × turnover, scaled 0–100.",
  Bristrisk: "Stockout risk",
  Prognoser: "Forecasts",
  "Simulera scenario": "Simulate scenario",
  "Fråga copiloten": "Ask the copilot",
  Ägare: "Owner",
  Administratör: "Administrator",
  Analytiker: "Analyst",
  Läsare: "Viewer",
  "Prova på": "Trial",
  "Radar Basic": "Radar Basic",
  "Radar Multi": "Radar Multi",
  Enterprise: "Enterprise",
  Språk: "Language",
  "Byt språk": "Change language",
  "Inga rader matchar filtret.": "No rows match the filter.",
  "Prova att rensa filtret eller importera ny data.": "Clear the filter or import new data.",
  Vyer: "Views",
  Sidnavigering: "Pagination",
  "← Föregående": "← Previous",
  "Nästa →": "Next →",
  "Sida {page} av {pages}": "Page {page} of {pages}",
  "Sortera": "Sort",
  "Visar {from}–{to} av {total} artiklar.": "Showing {from}–{to} of {total} items.",

  /* --------------------------------------------------------- dashboard */
  Analys: "Analysis",
  "Fönster (inaktivt lager)": "Window (inactive stock)",
  "90 dagar": "90 days",
  "180 dagar": "180 days",
  "365 dagar": "365 days",
  "Prioriterad av kapitalvikt": "Prioritised by capital weight",
  "Inga artiklar kräver åtgärd": "No items require action",
  "Alla artiklar ligger inom sina beställningspunkter och säljer.":
    "Every item is within its reorder point and selling.",
  "Aldrig såld": "Never sold",
  Överlager: "Overstock",
  Topp: "Spike",
  Fall: "Drop",
  "Inga statistiskt avvikande rörelser i historiken.": "No statistically unusual movements in the history.",
  Lagervärde: "Inventory value",
  "{n} artiklar · {units} enheter": "{n} items · {units} units",
  "{n} artiklar · {share} av värdet": "{n} items · {share} of value",
  "{n} artiklar över beställningspunkt": "{n} items above reorder point",
  Lageromsättning: "Inventory turnover",
  "{n} ggr/år": "{n}× per year",
  "{n} dagars liggtid": "{n} days of cover",
  "saknar historik": "no history",
  "{n} artikel": "{n} item",
  "{n} artiklar": "{n} items",
  "{value} i riskerad försäljning": "{value} in sales at risk",
  "Frigjort kapital": "Releasable capital",
  "25–55 % realisationsgrad": "25–55% realisation rate",
  Lagerhälsa: "Inventory health",
  "Kapital som sitter i fel artiklar drar ned betyget. 100 är ett lager där varje krona rör sig i takt med efterfrågan. Inaktivt lager, överlager, bristrisk och rotation vägs samman.":
    "Capital tied up in the wrong items lowers the score. 100 is an inventory where every krona moves with demand. Inactive stock, overstock, stockout risk and turns are weighed together.",
  Drivare: "Drivers",
  Kapitalfördelning: "Capital allocation",
  "Lagervärde per kategori. Ytan är pengarna.": "Inventory value by category. Area is money.",
  "Var kapitalet sitter mot hur förutsägbar efterfrågan är.":
    "Where capital sits against how predictable demand is.",
  "AX är kärnan: stort värde, jämn efterfrågan. CZ är kandidater för utförsäljning.":
    "AX is the core: high value, steady demand. CZ are clearance candidates.",
  "Prioriterade åtgärder": "Recommended actions",
  "Visa alla åtgärder": "View all recommended actions",
  "Åtgärder": "Recommended actions",
  "Beräknad": "Calculated",
  "Poäng av kapitalvikt, åtgärdens allvar, marginalpåverkan och brådska.":
    "Scored by capital weight, action severity, margin impact and urgency.",
  "Alla →": "All →",
  Riskprofil: "Risk profile",
  "Normaliserat 0–100 per område.": "Normalised 0–100 per area.",
  Brist: "Stockout",
  Rotation: "Turns",
  Marginal: "Margin",
  "Högre värde = mer att åtgärda": "Higher value = more to address",
  "Lagervärde över tid": "Inventory value over time",
  "{n} mätpunkter i organisationen.": "{n} data points in the organisation.",
  "{n} mätpunkter · en per importdag, senaste 24.": "{n} data points · one per import day, latest 24.",
  Lagerhälsokarta: "Inventory health map",
  "En ruta per artikel. Färg = åtgärdsbehov, intensitet = kapital.":
    "One square per item. Colour = action needed, intensity = capital.",
  OK: "OK",
  Bevaka: "Watch",
  Risk: "Risk",
  Avvikelser: "Anomalies",
  "Statistiskt avvikande rörelser i månadshistoriken.": "Statistically unusual movements in the monthly history.",
  Lönsamhet: "Profitability",
  "Täckningsbidrag per artikel, aggregerat.": "Contribution margin per item, aggregated.",
  Bruttomarginal: "Gross margin",
  Täckningsbidrag: "Contribution margin",
  "Låg marginal": "Low margin",
  "Negativ marginal": "Negative margin",
  "Täckningsbidrag per kategori": "Contribution margin by category",
  Rotationskarta: "Turns map",
  "Omsättning mot marginal. Storlek = lagervärde.": "Turns against margin. Size = inventory value.",
  "{m} månaders historik · {n} artiklar · uppdaterad {at}":
    "{m} months of history · {n} items · updated {at}",
  "Ny import": "New import",

  /* -------------------------------------------------------------- items */
  "Artikelnummer eller benämning": "SKU or description",
  Kategori: "Category",
  Åtgärd: "Action",
  Alla: "All",
  Filtrera: "Filter",
  Rensa: "Clear",
  Artikel: "Item",
  Benämning: "Description",
  Saldo: "Stock",
  Sålt: "Sold",
  "Oms.": "Turns",
  Täckning: "Cover",
  "Inga artiklar matchar filtret.": "No items match the filter.",
  "{n} artiklar · lagervärde {value}": "{n} items · inventory value {value}",
  "{n} artikel · lagervärde {value}": "{n} item · inventory value {value}",
  Nedskrivning: "Write-off",
  Realisera: "Liquidate",
  Minska: "Reduce",
  Beställ: "Reorder",
  Granska: "Review",
  "Utan kategori": "Uncategorised",
  "Okänd leverantör": "Unknown supplier",
  Huvudlager: "Main warehouse",
  "← Alla artiklar": "← All items",
  Omsättning: "Turns",
  Prioritet: "Priority",
  "Försäljningspris": "Selling price",
  "saknas": "missing",
  "Inköpspris": "Purchase price",
  "Täckning (d)": "Cover (days)",
  "Marginal %": "Margin %",
  "Sålt i period": "Sold in period",
  "Intäkt i period": "Revenue in period",
  "Efterfrågan och prognos": "Demand and forecast",
  "Modell {method} · konfidens {confidence} · WAPE {wape}":
    "Model {method} · confidence {confidence} · WAPE {wape}",
  "Prognos kräver månadshistorik": "Forecast requires monthly history",
  Historik: "History",
  "95 % intervall": "95% interval",
  Lagerstyrning: "Inventory control",
  "Beräknat med vald servicenivå och artikelns ledtid.":
    "Calculated with the selected service level and the item's lead time.",
  "Prognos/månad": "Forecast/month",
  Säkerhetslager: "Safety stock",
  Beställningspunkt: "Reorder point",
  Orderkvantitet: "Order quantity",
  "Förväntad brist": "Expected shortage",
  "Orderkvantitet är EOQ (beställningskostnad 350 kr, lagerhållningsränta 22 %) avrundat uppåt till minsta orderkvantitet.":
    "Order quantity is EOQ (order cost SEK 350, holding rate 22%) rounded up to minimum order quantity.",
  "Saknar historik för att beräkna beställningspunkt.": "No history to calculate a reorder point.",
  Modelljämförelse: "Model comparison",
  "Backtest på de senaste månaderna. Lägst WAPE vinner.":
    "Backtest on recent months. Lowest WAPE wins.",
  "Ingen backtest möjlig med så kort historik.": "No backtest possible with such short history.",
  "Lika artiklar": "Similar items",
  "Samma kategori, sorterade på kapital.": "Same category, sorted by capital.",
  "Inga jämförbara artiklar i kategorin.": "No comparable items in the category.",
  "Artikeln saknar månadshistorik, så någon prognos kan inte beräknas.":
    "The item has no monthly history, so no forecast can be calculated.",
  "Importera försäljning per månad för att få prognos, beställningspunkt och bristrisk.":
    "Import monthly sales to get a forecast, reorder point and stockout risk.",
  Modell: "Model",
  vald: "selected",
  "Ingen åtgärd krävs. Artikeln ligger inom sina styrgränser.":
    "No action required. The item is within its control limits.",

  /* ----------------------------------------------------------- forecast */
  "Efterfrågeprognoser med modellval via backtest, säkerhetslager och dynamiska beställningspunkter.":
    "Demand forecasts with model selection by backtest, safety stock and dynamic reorder points.",
  Horisont: "Horizon",
  "{n} månader": "{n} months",
  "Största artikeln i prognosvyn": "Largest item in the forecast view",
  "modell {method} · {confidence} konfidens": "model {method} · {confidence} confidence",
  "Faktisk efterfrågan": "Actual demand",
  Osäkerhet: "Uncertainty",
  Modellval: "Model selection",
  "Modeller i motorn": "Models in the engine",
  Naiv: "Naive",
  "senaste månaden": "latest month",
  SES: "SES",
  "exponentiell utjämning": "exponential smoothing",
  Holt: "Holt",
  "nivå + trend": "level + trend",
  "Holt-Winters": "Holt-Winters",
  "säsong, kräver 24 mån": "seasonal, requires 24 months",
  "Croston / SBA": "Croston / SBA",
  "glest förekommande efterfrågan": "intermittent demand",
  TSB: "TSB",
  "sannolikhet × storlek": "probability × size",
  ADIDA: "ADIDA",
  "aggregerad efterfrågan per period": "aggregated demand per period",
  "Valet sker per artikel på lägst WAPE i backtest mot de senaste månaderna. Ingen modell väljs för att den är avancerad.":
    "The model is chosen per item on lowest WAPE in a backtest of recent months. No model is chosen for being advanced.",
  "Kategori Prognos": "Category forecast",
  "Aggregerad efterfrågan för {category}": "Aggregated demand for {category}",
  "Prognos och lagerstyrning per artikel": "Forecast and inventory control per item",
  "Sorterat på lagervärde. Bristrisk är sannolikheten att efterfrågan under ledtid överstiger saldot.":
    "Sorted by inventory value. Stockout risk is the probability that demand during lead time exceeds stock.",
  "Prognos/mån": "Forecast/month",
  Orderqty: "Order qty",
  "Inga artiklar med tillräcklig historik.": "No items with sufficient history.",
  "Ingen artikel med månadshistorik hittades.": "No item with monthly history found.",
  "Kategoriprognos kräver minst två månadskolumner i underlaget.":
    "Category forecast requires at least two monthly columns in the data.",

  /* ----------------------------------------------------------- simulate */
  "Testa ett beslut innan det fattas. Alla utfall räknas med samma motor som analysen.":
    "Test a decision before you make it. Every outcome is calculated by the same engine as the analysis.",
  Scenario: "Scenario",
  "Ändra och kör om.": "Change and run again.",
  Namn: "Name",
  Efterfrågan: "Demand",
  Leveranstid: "Lead time",
  "Försening (dagar)": "Delay (days)",
  "Sannolikhet försening": "Probability of delay",
  Servicenivå: "Service level",
  Lagerreduktion: "Stock reduction",
  "Kör scenario": "Run scenario",
  Spara: "Save",
  "{name} jämfört med basfallet": "{name} compared with the base case",
  "Positivt netto betyder att åtgärden tjänar mer än den kostar i utebliven marginal.":
    "A positive net means the action earns more than it costs in lost margin.",
  "Uppfyllnadsgrad": "Service level",
  "Nettoeffekt/år": "Net effect/year",
  "Utebliven marginal": "Lost margin",
  Lagerhållningskostnad: "Holding cost",
  "Nettoeffekt per år": "Net effect per year",
  Risker: "Risks",
  "Härledda ur siffrorna, inte formulerade i efterhand.":
    "Derived from the numbers, not written after the fact.",
  "Scenariejämförelse": "Scenario comparison",
  "Samma baslinje, flera beslut.": "Same baseline, several decisions.",
  Beräkningsmodell: "Calculation model",
  "Varje rad är en formel som går att granska.": "Every row is a formula you can audit.",
  "Största effekt per artikel": "Largest effect per item",
  Före: "Before",
  Efter: "After",
  Frigjort: "Released",
  "Inget scenario beräknat.": "No scenario calculated.",
  "Inga förhöjda risker identifierade i scenariot.": "No elevated risks identified in the scenario.",
  Mått: "Measure",
  "Bristrisk (artiklar)": "Stockout risk (items)",
  "Årlig nettoeffekt": "Annual net effect",
  Hög: "High",
  Medel: "Medium",
  Låg: "Low",
  Ja: "Yes",
  Nej: "No",

  /* ------------------------------------------------------------ copilot */
  Copilot: "Copilot",
  "Analytisk assistent för lager och supply chain. Svenska och engelska.":
    "Analytical assistant for inventory and supply chain. Swedish and English.",
  Assistenten: "The assistant",
  "Ställ frågan du annars ställer till controllern.": "Ask the question you would otherwise ask your controller.",
  "Copiloten svarar med tal ur analysmotorn. Den kan inte hitta på siffror: varje belopp är spårbart till en beräkning, och ett svar som inför nya tal avvisas.":
    "The copilot answers with numbers from the analysis engine. It cannot invent figures: every amount is traceable to a calculation, and an answer that introduces new numbers is rejected.",
  "Tänker…": "Thinking…",
  "Fråga t.ex. vilka 20 artiklar som binder mest onödigt kapital":
    "Ask e.g. which 20 items tie up the most unnecessary capital",
  Fråga: "Ask",
  "Svaren bygger på {n} tidigare meddelanden i den här konversationen. Följdfrågor som \"och de 10 största?\" behåller sammanhanget.":
    "Answers build on {n} previous messages in this conversation. Follow-ups like \"and the 10 largest?\" keep the context.",
  Förslag: "Suggestions",
  "Tidigare samtal": "Previous conversations",
  "Inga sparade samtal ännu.": "No saved conversations yet.",
  "Så säkras talen": "How the numbers are secured",
  "Frågan tolkas till ett avgränsat syfte. Motorn räknar fram svaret. En språkmodell får bara formulera om texten, och avvisas om den inför ett tal som inte finns i underlaget.":
    "The question is interpreted into a bounded intent. The engine computes the answer. A language model may only rephrase the text, and is rejected if it introduces a number not in the data.",
  Källor: "Sources",
  konfidens: "confidence",
  "AI-formuleringen avvisades eftersom den innehöll tal som inte fanns i underlaget.":
    "The AI wording was rejected because it contained numbers that were not in the data.",

  /* ------------------------------------------------------------- sandbox */
  Sandbox: "Sandbox",
  "Till din analys": "To your analysis",
  "Ingen försäljning i historiken": "No sales in the history",
  "Ingen försäljning på {n} månader": "No sales for {n} months",
  "{n} enheter över beställningspunkt": "{n} units above reorder point",
  "Överlager {value}": "Overstock {value}",
  "Täcker {cover} dagar vid ledtid {lead}": "Covers {cover} days at a lead time of {lead}",
  "Oregelbunden efterfrågan, granska manuellt": "Irregular demand, review manually",
  "Avviker från förväntat mönster": "Deviates from the expected pattern",
  "Inom beställningspunkt": "Within reorder point",
  "Kapital per kategori": "Capital by category",
  "Ytan är lagervärde. Mörk ton betyder att kapitalet inte rör sig.":
    "Area is inventory value. Darker tone means the capital is not moving.",
  "Värde och efterfrågestabilitet per klass.": "Value and demand stability per class.",
  "XYZ saknas": "XYZ missing",
  "Minst sex månader av månadsförsäljning krävs.": "At least six months of monthly sales is required.",
  "Prioriterade artiklar": "Priority items",
  "Sorterat på påverkan i kronor. Öppna en artikel för att se beräkningen.":
    "Sorted by impact in kronor. Open an item to see the calculation.",
  "Inga åtgärder": "No actions",
  "Alla artiklar ligger inom sina beställningspunkter.": "Every item is within its reorder point.",
  "Aggregerad månadsförsäljning med sex månaders framskrivning och osäkerhetsband.":
    "Aggregated monthly sales with a six-month projection and uncertainty band.",
  Faktisk: "Actual",
  "Samma gränssnitt som i din egen analys, med syntetisk data.":
    "The same interface as your own analysis, with synthetic data.",
  "Artikelnummer, benämning eller leverantör": "SKU, description or supplier",
  "Artikelnummer": "SKU",
  Leverantör: "Supplier",
  "Ingående kostnad": "Unit cost",
  "Sålt i perioden": "Sold in the period",
  "Genomsnittlig månadsefterfrågan": "Average monthly demand",
  Ledtid: "Lead time",
  "Tillbaka": "Back",
  Artikeldata: "Item data",
  "Beräknat av analysmotorn på syntetisk data.": "Calculated by the analysis engine on synthetic data.",
  Månadsefterfrågan: "Monthly demand",
  "Sålda enheter per månad i underlaget.": "Units sold per month in the data.",
  "Varför åtgärden föreslås": "Why the action is suggested",
  "Beräkningen utgår från saldo {stock}, ledtid {lead} dagar, säkerhetslager {safety} och beställningspunkt {reorder}. Ingen åtgärd är genomförd. Sandboxen är läsbar och sparar inget.":
    "The calculation uses stock {stock}, lead time {lead} days, safety stock {safety} and reorder point {reorder}. No action has been taken. The sandbox is read-only and saves nothing.",
  "Motsvarande analys körs på din egen export när du laddar upp en fil.":
    "The same analysis runs on your own export when you upload a file.",
  "Analysera din data": "Analyse your data",
  "Ingen månadshistorik för den här artikeln.": "No monthly history for this item.",
  "{n} artiklar · syntetisk data": "{n} items · synthetic data",
  "Artiklar · Sandbox": "Items · Sandbox",

  /* -------------------------------------------------------------- imports */
  Fil: "File",
  Källa: "Source",
  Rader: "Rows",
  Överhoppade: "Skipped",
  Status: "Status",
  Tid: "Time",
  Klar: "Complete",
  Fel: "Error",
  Pågår: "Running",
  "Inga importer ännu.": "No imports yet.",
  "Ladda upp en CSV eller Excel-fil för att komma igång.": "Upload a CSV or Excel file to get started.",
  Skapad: "Created",
  "Öppna →": "Open →",
  "{used} av {limit} analyser använda den här månaden.": "{used} of {limit} analyses used this month.",
  "CSV eller Excel. Automatisk kolumnigenkänning, manuell justering i nästa steg.":
    "CSV or Excel. Automatic column detection, manual adjustment in the next step.",
  "Max 12 MB och 200 000 rader. Filen sparas aldrig på disk, endast tolkade rader.":
    "Max 12 MB and 200,000 rows. The file is never written to disk, only parsed rows are kept.",
  "Lager / enhet": "Warehouse / unit",
  "CSV-export": "CSV export",
  "Läs in och granska": "Load and review",
  "Vad som krävs": "What is required",
  "Lagersaldo": "Stock balance",
  "per artikel (obligatoriskt)": "per item (required)",
  "Försäljning": "Sales",
  "antingen som månadskolumner (2025-01 …) eller som total kvantitet":
    "either as monthly columns (2025-01 …) or as total quantity",
  "Artikelnummer, benämning, kategori, leverantör, ledtid och minsta orderkvantitet höjer kvaliteten":
    "SKU, description, category, supplier, lead time and minimum order quantity improve quality",
  "Kolumnnamn känns igen på svenska och engelska. Saknas något kan du mappa manuellt.":
    "Column names are recognised in Swedish and English. If something is missing you can map it manually.",
  Importhistorik: "Import history",
  "Varje körning loggas med radantal, fel och varningar.":
    "Every run is logged with row count, errors and warnings.",
  Analyser: "Analyses",
  "Granska mappning": "Review mapping",
  "{rows} rader · {cols} kolumner": "{rows} rows · {cols} columns",
  Kolumnmappning: "Column mapping",
  "Förvalt utifrån rubriker och datans form. Ändra där det behövs.":
    "Pre-filled from headers and the shape of the data. Change where needed.",
  "Föreslagen utifrån filens struktur och innehåll. Bekräfta eller ändra innan analysen.":
    "Suggested from the file's structure and content. Confirm or change it before the analysis.",
  Branschprofil: "Industry profile",
  Föreslagna: "Suggested",
  "Alla branscher": "All industries",
  "Osäker identifiering": "Uncertain match",
  "Konfidens {n} %": "Confidence {n}%",
  "Underlaget räcker inte för en säker identifiering. Välj generell profil om du är osäker.":
    "The data does not support a confident match. Choose the general profile if unsure.",
  "Konfidens {n} %. Du kan alltid välja en annan profil.":
    "Confidence {n}%. You can always choose another profile.",
  "Du kan alltid välja en annan profil.": "You can always choose another profile.",
  "Branschen styr standardvärden och vilka attribut som lyfts fram. Importerade värden ändras aldrig av en felaktig identifiering.":
    "The industry controls defaults and which attributes are highlighted. Imported values are never changed by an incorrect match.",
  Inställningar: "Settings",
  "Fönster för inaktivt lager": "Inactive stock window",
  "Kör analys": "Run analysis",
  Månadskolumner: "Monthly columns",
  "Markera de kolumner som innehåller såld kvantitet per månad. Minst två ger säsong och XYZ.":
    "Select the columns containing units sold per month. At least two enable seasonality and XYZ.",
  "Varningar från tolkningen": "Warnings from parsing",
  "Importvarningar": "Import warnings",
  "Filen importerades, men dessa rader eller värden behövde justeras.": "The file was imported, but these rows or values needed adjustment.",
  "Endast de första {n} varningarna visas.": "Only the first {n} warnings are shown.",
  Förhandsgranskning: "Preview",

  /* --------------------------------------------------------- integrations */
  "API, webhooks, importhistorik och förberedda kopplingar mot ERP och WMS.":
    "API, webhooks, import history and prepared connections to ERP and WMS.",
  "Ny API-nyckel skapad. Kopiera den nu. Den visas aldrig igen:<br><code style=\"font-size:13px\">{key}</code>":
    "New API key created. Copy it now. It is never shown again:<br><code style=\"font-size:13px\">{key}</code>",
  Anslutningar: "Connections",
  "Gröna är redo att användas. Gula kräver uppgifter i serverns miljö.":
    "Green are ready to use. Yellow require credentials in the server environment.",
  "API-nycklar": "API keys",
  "Bearer-token för REST-API:t. Endast hash lagras.": "Bearer token for the REST API. Only a hash is stored.",
  Scope: "Scope",
  Läs: "Read",
  "Läs + skriv": "Read + write",
  Skapa: "Create",
  "Din roll kan se men inte hantera API-nycklar.": "Your role can view but not manage API keys.",
  Webhooks: "Webhooks",
  "Signeras med HMAC-SHA256 i header X-STOQWISE-Signature.":
    "Signed with HMAC-SHA256 in the X-STOQWISE-Signature header.",
  Endpoint: "Endpoint",
  Händelser: "Events",
  "Lägg till": "Add",
  Leveranslogg: "Delivery log",
  "Max tre försök per händelse, med backoff.": "At most three attempts per event, with backoff.",
  "Öppna Importer för att se de senaste körningarna och ladda upp en ny fil.":
    "Open Imports to see recent runs and upload a new file.",
  "Till importer →": "Go to imports →",
  Redo: "Ready",
  "Kräver uppgifter": "Requires credentials",
  "Saknas:": "Missing:",
  "Importera fil →": "Import file →",
  Dokumentation: "Documentation",
  Prefix: "Prefix",
  "Senast använd": "Last used",
  aldrig: "never",
  Återkalla: "Revoke",
  "Inga API-nycklar ännu.": "No API keys yet.",
  "Ta bort webhooken?": "Remove the webhook?",
  "Ta bort": "Remove",
  "Inga webhooks registrerade.": "No webhooks registered.",
  Händelse: "Event",
  Svar: "Response",
  "Inga leveranser ännu. De loggas när en händelse skickas.":
    "No deliveries yet. They are logged when an event is sent.",

  /* ---------------------------------------------------------------- team */
  "{n} av {limit} platser använda. Roller styr både meny och behörigheter på servern.":
    "{n} of {limit} seats used. Roles control both the menu and server permissions.",
  Medlemmar: "Members",
  "Bjud in": "Invite",
  "Länken är engångs och giltig i sju dagar.": "The link is single-use and valid for seven days.",
  "Skapa inbjudan": "Create invitation",
  "Inbjudningslänk:": "Invitation link:",
  Roller: "Roles",
  "allt, inkl. fakturering": "everything, incl. billing",
  "team, API, data": "team, API, data",
  "import och analys": "import and analysis",
  "endast läsning": "read only",
  "Din roll kan inte bjuda in användare.": "Your role cannot invite users.",
  Inbjudningar: "Invitations",
  "Giltig till": "Valid until",
  Accepterad: "Accepted",
  Väntar: "Pending",
  "Inga inbjudningar skickade.": "No invitations sent.",
  "Ta bort användaren från organisationen?": "Remove the user from the organisation?",
  "Roll för {email}": "Role for {email}",
  Epost: "Email",

  /* ------------------------------------------------------------- billing */
  "{status} · förnyas {date}": "{status} · renews {date}",
  "{status} · förnyas manuellt": "{status} · renewed manually",
  "Betalningar är inte aktiverade i den här installationen. Planbyten registreras internt och faktureras manuellt. Sätt <code>STRIPE_SECRET_KEY</code> och pris-ID:n i miljön för att aktivera Stripe.":
    "Payments are not enabled in this installation. Plan changes are recorded internally and invoiced manually. Set <code>STRIPE_SECRET_KEY</code> and price IDs in the environment to enable Stripe.",
  "Användning den här månaden": "Usage this month",
  "Copilot-frågor": "Copilot questions",
  Användare: "Users",
  "Artiklar i senaste analys": "Items in the latest analysis",
  Fakturering: "Billing",
  "Fakturaunderlag skickas från <span class=\"mono\">{email}</span> vid månadsskifte.":
    "Invoices are sent from <span class=\"mono\">{email}</span> at the turn of the month.",
  "Fakturaunderlag skickas vid månadsskifte.": "Invoices are sent at the turn of the month.",
  "Betalning sker mot faktura med 30 dagars villkor, eller via kort när Stripe är aktiverat. Avtal och personuppgiftsbiträdesavtal tillhandahålls på begäran.":
    "Payment is by invoice with 30-day terms, or by card when Stripe is enabled. Contracts and data processing agreements are available on request.",
  "Ingen betalning dras automatiskt i den här installationen.":
    "No payment is charged automatically in this installation.",
  "Nuvarande plan": "Current plan",
  Uppgradera: "Upgrade",
  "Byt plan": "Change plan",
  "{n} användare": "{n} users",
  "{n} analyser/mån": "{n} analyses/month",
  "{n} copilot-frågor/mån": "{n} copilot questions/month",
  "REST API": "REST API",
  "Ingen API-åtkomst": "No API access",
  "/mån": "/month",

  /* --------------------------------------------------------------- audit */
  Händelselogg: "Audit log",
  "Spårbarhet för importer, inloggningar, behörighetsändringar och datautlämning.":
    "Traceability for imports, sign-ins, permission changes and data disclosure.",
  "Senaste händelser": "Recent events",
  Objekt: "Object",
  IP: "IP",
  "Inga händelser loggade ännu.": "No events logged yet.",

  /* ------------------------------------------------------------- settings */
  "Organisation, standardvärden och datahantering.": "Organisation, defaults and data handling.",
  Organisation: "Organisation",
  Företagsnamn: "Company name",
  "Kalkylränta (%)": "Capital cost rate (%)",
  "Din roll kan läsa men inte ändra inställningarna.":
    "Your role can read but not change the settings.",
  "Data i organisationen": "Data in the organisation",
  Artikelrader: "Item rows",
  "Exportera all data (JSON)": "Export all data (JSON)",
  "Radera alla analyser i organisationen? Det går inte att ångra.":
    "Delete all analyses in the organisation? This cannot be undone.",
  "Radera alla analyser": "Delete all analyses",
  "Rådata sparas aldrig som fil. Radering tar bort tolkade rader, resultat och artikelrader.":
    "Raw data is never stored as a file. Deletion removes parsed rows, results and item rows.",
  "Sparar…": "Saving…",
  "Läser filen…": "Reading the file…",
  "Analyserar…": "Analysing…",
  "Beräknar…": "Calculating…",

  /* ------------------------------------------------------------ dashboard */
  "Ingen analys ännu": "No analysis yet",
  "Ladda upp en CSV- eller Excel-export för att komma igång. Vill du se gränssnittet först, öppna sandboxen med syntetisk data.":
    "Upload a CSV or Excel export to get started. To see the interface first, open the sandbox with synthetic data.",
  "Ladda upp fil": "Upload file",
  "Öppna sandbox": "Open sandbox",
  "Ingen organisation": "No organisation",

  /* -------------------------------------------------------------- PDF/app */
  "Kapital": "Capital",
  "Lageranalys: {company}": "Inventory analysis: {company}",
  "Lagerkapitalanalys, inaktivt lager och lageroptimering": "Inventory capital analysis, inactive stock and inventory optimisation",
  "lager, inaktivt lager, ABC, XYZ, rörelsekapital": "inventory, inactive stock, ABC, XYZ, working capital",
  "LAGERANALYS  ·  KONFIDENTIELLT": "INVENTORY ANALYSIS  ·  CONFIDENTIAL",
  "Lagerkapitalanalys": "Inventory capital analysis",
  "Underlag: {file}   ·   {months} månaders historik   ·   {n} artiklar": "Source: {file}   ·   {months} months of history   ·   {n} items",
  "Upprättad {date}   ·   Datadriven lageranalys för svensk handel och industri": "Prepared {date}   ·   Data-driven inventory analysis for commerce and industry",
  "Åtgärderna är ordnade efter ekonomisk effekt. Beloppen är uppskattningar utifrån analysens antaganden, inte garantier.": "Actions are ordered by economic impact. The amounts are estimates based on the analysis assumptions, not guarantees.",
  "X = variationskoefficient under 0,5. Y = 0,5–1,0. Z = över 1,0. Z-artiklar kräver manuell styrning eftersom efterfrågan är svår att prognosticera.": "X = coefficient of variation below 0.5. Y = 0.5–1.0. Z = above 1.0. Z items require manual control because demand is hard to forecast.",
  "Ekonomisk sammanfattning": "Economic summary",
  "Nyckeltal": "Key figures",
  "Värde": "Value",
  "Kommentar": "Comment",
  "Varuflöde per år (COGS)": "Annual goods flow (COGS)",
  "Till inköpspris": "At purchase cost",
  "Median artikel: {n}": "Median item: {n}",
  "Genomsnittlig liggtid": "Average days of cover",
  "365 / omsättning": "365 / turns",
  "Långsamt omsatta artiklar": "Slow-moving items",
  "{n} artiklar, >180 d täckning": "{n} items, >180 days of cover",
  "{n} artiklar under ledtid": "{n} items below lead time",
  "Kapitalkostnad per år": "Capital cost per year",
  "{n} % kalkylränta": "{n}% capital cost rate",
  "Frigjort kapital (intervall)": "Releasable capital (range)",
  "Intervall, se antaganden": "Range, see assumptions",
  "Artiklar med bristrisk": "Items with stockout risk",
  "Lagrets ålder": "Inventory ageing",
  "ABC-klassificering": "ABC classification",
  "Klass": "Class",
  "Försäljningsvärde": "Sales value",
  "Andel": "Share",
  "80 % av värdet": "80% of value",
  "ABC räknas på kumulativ andel av försäljningsvärdet. A: andelen före artikeln < 80 %, B: 80–95 %, C: resten. Artikeln som passerar en gräns stannar i klassen före den.": "ABC is based on the cumulative share of sales revenue. A: share before the item < 80%, B: 80–95%, C: the rest. An item that crosses a boundary stays in the class before it.",
  "Utan XYZ": "Without XYZ",
  "15 %": "15%",
  "5 %": "5%",
  "ABC/XYZ-matris (antal artiklar)": "ABC/XYZ matrix (item count)",
  "X: jämn": "X: steady",
  "Y: varierande": "Y: variable",
  "Z: oregelbunden": "Z: irregular",
  "Observationer": "Observations",
  "Nästa steg": "Next step",
  "Största kapitalbindningen": "Largest capital tie-up",
  "Artiklar utan registrerad försäljning: åtgärder": "Inactive stock: items to act on",
  "Artiklar utan försäljning de senaste {days} dagarna, sorterade på lagervärde.": "Items with no sales in the last {days} days, sorted by inventory value.",
  "Saldo utöver förväntad efterfrågan under ledtid plus granskningsperiod. Minska nästa beställning.": "Stock above expected demand during lead time plus the review period. Reduce the next order.",
  "Bristrisk: beställ nu": "Stockout risk: reorder now",
  "Metod och antaganden": "Method and assumptions",
  "Datakälla": "Data source",
  "Kundens export: {file}. Inga uppgifter har hämtats från tredje part.": "The customer export: {file}. No data has been obtained from a third party.",
  "Period": "Period",
  "{n} månaders försäljningshistorik.": "{n} months of sales history.",
  "Saldo × inköpspris. Försäljningspris används aldrig för lagervärde.": "Stock × purchase price. Selling price is never used for inventory value.",
  "Ingen försäljning under {days} dagar trots saldo > 0.": "No sales for {days} days despite stock > 0.",
  "Saldo utöver förväntad efterfrågan under ledtid + {days} dagar, plus säkerhetslager.": "Stock above expected demand during lead time + {days} days, plus safety stock.",
  "Kumulativ andel av försäljningsvärde: A upp till 80 %, B upp till 95 %, C resterande.": "Cumulative share of sales value: A up to 80%, B up to 95%, C the remainder.",
  "Variationskoefficient i månadsförsäljning: X < 0,5, Y 0,5–1,0, Z > 1,0. Kräver minst 6 månader.": "Coefficient of variation in monthly sales: X < 0.5, Y 0.5–1.0, Z > 1.0. Requires at least 6 months.",
  "Kumulativ andel av försäljningsvärde, räknad före aktuell artikel: A < 80 %, B 80–95 %, C resterande. Artikeln som passerar en gräns stannar i klassen före den.": "Cumulative share of sales revenue, measured before the current item: A < 80%, B 80–95%, C the remainder. An item that crosses a boundary stays in the class before it.",
  "Variationskoefficient i månadsförsäljning: X < 0,5, Y 0,5–1,0, Z > 1,0. Kräver minst 6 månader; medelvärde 0 eller saknade värden ger ingen klass.": "Coefficient of variation in monthly sales: X < 0.5, Y 0.5–1.0, Z > 1.0. Requires at least 6 months; a zero mean or missing values give no class.",
  "Kapital i inaktiva artiklar × 25–55 % + överlager × 15–35 %. Realisationsgraden är en bedömning, inte ett utfall.": "Capital in inactive items × 25–55% + overstock × 15–35%. The realisation rate is an assessment, not an outcome.",
  "Datakvalitet": "Data quality",
  "Inga anmärkningar på underlaget.": "No remarks on the data.",
  "Om underlaget": "About the data",
  "Analysen är framtagen av STOQWISE på uppdrag av {company}. Siffrorna är beräknade med deterministisk metod på det underlag som angivits ovan. Rapporten är beslutsunderlag, inte en garanti för ekonomiskt utfall.{contact}": "The analysis was prepared by STOQWISE on behalf of {company}. The figures are calculated with a deterministic method on the data stated above. The report is decision support, not a guarantee of financial outcome.{contact}",
  " Frågor: {email}": " Questions: {email}",
  "Inga artiklar i kategorin.": "No items in the category.",
  "Pris": "Price",
  "ABC \\ XYZ": "ABC \ XYZ",
  "{n} dagar": "{n} days",
  "Företaget": "The company",
  "E-post": "Email",
  "Roll": "Role",
  "Lager": "Inventory",
  "Optimering": "Optimization",
  "AI-insikter": "AI Decision Support",
  "Aktivitetslogg": "Activity log",
  "Visa eller dölj navigering": "Show or hide navigation",
  "Medlem sedan": "Member since",
  "Ingen": "None",
  "dagar": "days",
  "st": "units",
  "sandbox": "sandbox",
  "and {n} days of cover": " and {n} days of cover",
  ", {n} days of cover": ", {n} days of cover",
  "ABC: {n} A-items account for {share}% of sales value.": "ABC: {n} A-items account for {share}% of sales value.",
  "{value} is tied up in stock that is not selling": "{value} is tied up in stock that is not selling",
  "Inventory is turning in line with demand": "Inventory is turning in line with demand",
  "{company} holds {items} items worth {value}. Annual goods flow is {cogs}, giving {turns} turns per year{days}.": "{company} holds {items} items worth {value}. Annual goods flow is {cogs}, giving {turns} turns per year{days}.",
  "{value}, or {share}% of inventory value, sits in {n} items that have not sold in the last {days} days. That is the single largest release opportunity in the analysis.": "{value}, or {share}% of inventory value, sits in {n} items that have not sold in the last {days} days. That is the single largest release opportunity in the analysis.",
  "A further {value} sits in overstock across {n} items: goods that sell, but more slowly than lead time and demand justify.": "A further {value} sits in overstock across {n} items: goods that sell, but more slowly than lead time and demand justify.",
  "In total, {low}–{high} is assessed as releasable within 6–12 months, at a realisation rate of 25–55% of inactive stock and 15–35% of overstock. The range is deliberately conservative: beating a low number is better than defending a high one.": "In total, {low}–{high} is assessed as releasable within 6–12 months, at a realisation rate of 25–55% of inactive stock and 15–35% of overstock. The range is deliberately conservative: beating a low number is better than defending a high one.",
  "At the same time, {n} items sell but cover less than their own lead time. The risk runs the other way there: around {value} in lost sales if nothing is done.": "At the same time, {n} items sell but cover less than their own lead time. The risk runs the other way there: around {value} in lost sales if nothing is done.",
  "Inventory value: {value} across {n} items.": "Inventory value: {value} across {n} items.",
  "Inactive stock: {value} ({n} items, {share}% of inventory value).": "Inactive stock: {value} ({n} items, {share}% of inventory value).",
  "Overstock: {value} ({n} items).": "Overstock: {value} ({n} items).",
  "Slow movers: {value} ({n} items with more than 180 days of cover).": "Slow movers: {value} ({n} items with more than 180 days of cover).",
  "Inventory turns: {turns}× per year{turnsSuffix}.": "Inventory turns: {turns}× per year{turnsSuffix}.",
  "Capital cost: {value} per year at a {rate}% capital cost rate.": "Capital cost: {value} per year at a {rate}% capital cost rate.",
  "The next step is to go through the inactive-stock list item by item and decide the action: campaign, return to supplier or write-off. Experience suggests roughly half can be realised within a quarter if decisions are taken together rather than one at a time.": "The next step is to go through the inactive-stock list item by item and decide the action: campaign, return to supplier or write-off. Experience suggests roughly half can be realised within a quarter if decisions are taken together rather than one at a time.",
  "Inventory is in balance. Focus instead on keeping reorder points current so the level does not drift as demand changes.": "Inventory is in balance. Focus instead on keeping reorder points current so the level does not drift as demand changes.",
  "Så gör ni: {action}": "How to do it: {action}",
  "Vilka 20 artiklar binder mest onödigt kapital?": "Which 20 items tie up the most unnecessary capital?",
  "Vilka produkter riskerar att ta slut inom 14 dagar?": "Which products risk running out within 14 days?",
  "Hur mycket kapital kan frigöras genom att minska överlagret?": "How much capital can be released by reducing overstock?",
  "Vilka leverantörer har störst påverkan på vår lagerhållning?": "Which suppliers have the greatest impact on our inventory?",
  "Vilka produkter har försämrad omsättningshastighet?": "Which products have deteriorating inventory turns?",
  "Vad händer om efterfrågan ökar med 20 procent?": "What happens if demand increases by 20 percent?",
  "Vilka åtgärder skulle ge störst ekonomisk effekt?": "Which actions would have the greatest financial impact?",
  "Laddar upp en export från valfritt system. Automatisk kolumnigenkänning.": "Uploads an export from any system. Automatic column detection.",
  "Läser första kalkylbladet i en xlsx-fil och konverterar det till importformatet.": "Reads the first worksheet in an xlsx file and converts it to the import format.",
  "Artiklar, lagersaldon och fakturarader via Fortnox officiella REST-API.": "Items, stock balances and invoice lines via Fortnox official REST API.",
  "Artikelregister och lagersaldon via Visma Connect.": "Item register and stock balances via Visma Connect.",
  "Item ledger entries och inventory via OData v4 (API-publisher).": "Item ledger entries and inventory via OData v4 (API publisher).",
  "Material master och lagersaldon via OData-tjänster (API_MATERIAL_STOCK_SRV).": "Material master and stock balances via OData services (API_MATERIAL_STOCK_SRV).",
  "product.product, stock.quant och sale.order.line via JSON-RPC.": "product.product, stock.quant and sale.order.line via JSON-RPC.",
  "Generisk WMS-adapter för saldo per lagerplats via REST eller fil.": "Generic WMS adapter for stock by location via REST or file.",
  "Inventory levels och ordrar via Admin GraphQL API.": "Inventory levels and orders via the Admin GraphQL API.",
  "Kunde inte läsa filen.": "Could not read the file.",
  "Välj en fil att ladda upp.": "Choose a file to upload.",
  "Filen är större än {n} MB.": "The file is larger than {n} MB.",
  "Planen {plan} tillåter {n} analyser per månad.": "The {plan} plan allows {n} analyses per month.",
  "Planen {plan} tillåter {n} användare.": "The {plan} plan allows {n} users.",
  "Utkastet är borta. Ladda upp filen igen.": "The draft is gone. Upload the file again.",
  "Analys klar: {n} artiklar.": "Analysis complete: {n} items.",
  "API-nyckeln är återkallad.": "The API key has been revoked.",
  "Webhook-URL måste börja med http:// eller https://.": "The webhook URL must start with http:// or https://.",
  "Webhook tillagd.": "Webhook added.",
  "Webhook borttagen.": "Webhook removed.",
  "Ange en giltig e-postadress.": "Enter a valid email address.",
  "Du kan inte ändra din egen roll.": "You cannot change your own role.",
  "Ägarens roll kan inte ändras.": "The owner's role cannot be changed.",
  "Roll uppdaterad.": "Role updated.",
  "Ägaren kan inte tas bort.": "The owner cannot be removed.",
  "Användaren är borttagen.": "The user has been removed.",
  "Okänd plan.": "Unknown plan.",
  "Plan uppdaterad. Fakturering sker enligt avtal.": "Plan updated. Billing follows the agreement.",
  "Inställningarna sparade.": "Settings saved.",
  "Alla analyser är raderade.": "All analyses have been deleted.",
  "enkel utjämning": "simple exponential smoothing",
  "naivt medel": "naive mean",
  "medelvärde": "mean",
  "ingen historik": "no history",
  "hög": "high",
  "medel": "medium",
  "låg": "low",
  "Reducera överlager 15 %": "Reduce overstock by 15%",
  "Betalningar är inte aktiverade i den här installationen. Planbyten registreras internt och faktureras manuellt. Sätt": "Payments are not enabled in this installation. Plan changes are recorded internally and invoiced manually. Set",
  "Fakturaunderlag skickas vid månadsskifte. Betalning sker mot faktura med 30 dagars villkor, eller via kort när Stripe är aktiverat. Avtal och personuppgiftsbiträdesavtal tillhandahålls på begäran.": "Invoices are issued at the start of each month. Payment is by invoice with 30-day terms, or by card when Stripe is enabled. Agreements and data processing agreements are available on request.",
  "Fakturaunderlag skickas från {email} vid månadsskifte. Betalning sker mot faktura med 30 dagars villkor, eller via kort när Stripe är aktiverat. Avtal och personuppgiftsbiträdesavtal tillhandahålls på begäran.": "Invoices are sent from {email} at the start of each month. Payment is by invoice with 30-day terms, or by card when Stripe is enabled. Agreements and data processing agreements are available on request.",
  "Vilka av dessa bör vi agera på först?": "Which of these should we act on first?",
  "Hur mycket kan frigöras?": "How much can be released?",
  "Visa 20 i stället": "Show 20 instead",
  "Vad bör vi beställa nu?": "What should we order now?",
  "Simulera 20 % högre efterfrågan": "Simulate 20% higher demand",
  "Visa inaktivt lager i stället": "Show inactive stock instead",
  "Vilka artiklar ska realiseras först?": "Which items should be realised first?",
  "Simulera 15 % lagerreduktion": "Simulate a 15% inventory reduction",
  "Visa prioriterade åtgärder": "Show priority actions",
  "Visa bristrisken i procent": "Show stockout risk as a percentage",
  "Simulera längre ledtid": "Simulate a longer lead time",
  "Exportera förslaget": "Export the proposal",
  "Vad består lagervärdet av?": "What makes up the inventory value?",
  "Vilka artiklar binder mest?": "Which items tie up the most?",
  "Visa inaktivt lager": "Show inactive stock",
  "Vilka kategorier binder mest?": "Which categories tie up the most?",
  "Simulera 15 % reduktion": "Simulate a 15% reduction",
  "Vilka artiklar från den största leverantören är inaktiva?": "Which items from the largest supplier are inactive stock?",
  "Visa kategorier i stället": "Show categories instead",
  "Visa de snabbaste i stället": "Show the fastest movers instead",
  "Vilka har låg marginal?": "Which have low margin?",
  "Vad händer vid 30 dagars försening?": "What happens with a 30-day delay?",
  "Visa de 20 högst prioriterade artiklarna": "Show the 20 highest-priority items",
  "Exportera åtgärdslistan": "Export the action list",
  "Vilka ska realiseras först?": "Which should be realised first?",
  "Visa överlager": "Show overstock",
  "Hur påverkar en realisering marginalen?": "How does a realisation affect the margin?",
  "Vilka kategorier har sämst marginal?": "Which categories have the worst margin?",
  "Vad ger störst effekt?": "What has the greatest impact?",
  "Vilken kategori har bäst omsättning?": "Which category has the best turns?",
  "Visa artiklarna i den största kategorin": "Show the items in the largest category",
  "Vilka leverantörer?": "Which suppliers?",
  "Vilka artiklar har avvikelser?": "Which items have anomalies?",
  "Vilka artiklar säljer sämst?": "Which items sell the worst?",
  "Hur påverkar det prognosen?": "How does that affect the forecast?",
  "Vad bör vi beställa?": "What should we order?",
  "Vilka artiklar binder mest kapital?": "Which items tie up the most capital?",
  "och pris-ID:n i miljön för att aktivera Stripe.": "and the price IDs in the environment to enable Stripe.",
  "Aktiv (sålt senaste 90 d)": "Active (sold in the last 90 days)",
  "91–180 dagar": "91–180 days",
  "181–365 dagar": "181–365 days",
  "Över 365 dagar": "Over 365 days",
  "Aldrig såld i perioden": "Never sold in the period",
  "z × standardavvikelse × roten ur (ledtid/30,44) med servicenivå {n} %.": "z × standard deviation × square root of (lead time/30.44) at a {n}% service level.",
  "Kapitalkostnad": "Capital cost",
  "{n} % kalkylränta på bundet lagervärde.": "{n}% imputed interest on tied-up inventory value.",
  "Aktiv (sålt senaste 90 d) ": "Active (sold in the last 90 days)",
  "Lagervärde per kategori": "Capital by category",
  "Kapitalfördelning per kategori": "Capital distribution by category",
  "Historisk efterfrågan och prognos med osäkerhetsintervall": "Historical demand and forecast with uncertainty interval",
  "prognos →": "forecast →",
  "Antal artiklar per ABC- och XYZ-klass": "Items per ABC and XYZ class",
  "ABC och XYZ-matris": "ABC and XYZ matrix",
  "Lagervärdets utveckling": "Inventory value trend",
  "Lagervärdets utveckling visas när organisationen har minst två importer.": "The inventory value trend appears when the organisation has at least two imports.",
  "Importera igen om en månad. Då ritas trenden automatiskt.": "Import again in a month and the trend is drawn automatically.",
  "Lagervärde per importeringstillfälle": "Inventory value per import",
  "kr": "SEK",
  "Reducibelt lager = saldo − beställningspunkt. Reduktionen tillämpas endast där.": "Reducible stock = stock − reorder point. The reduction is applied only there.",
  "Kom igång": "Get started",
  "Välkommen": "Welcome",
  "Dags att se vad lagret kostar.": "Time to see what inventory costs.",
  "Ditt konto är klart med rollen {role}. Tre steg återstår.": "Your account is ready with the {role} role. Three steps remain.",
  "Ladda upp en export": "Upload an export",
  "CSV eller Excel från affärssystemet. Kolumnerna känns oftast igen automatiskt.": "CSV or Excel from your business system. Columns are usually detected automatically.",
  "Granska mappningen": "Review the mapping",
  "Artikelnummer, saldo, pris och rörelse. Avvikelser flaggas innan analysen körs.": "Item number, stock, price and movement. Exceptions are flagged before the analysis runs.",
  "Läs analysen": "Read the analysis",
  "Inaktivt lager, prognos och åtgärdslista. Rapporten kan laddas ner som PDF eller Excel.": "Inactive stock, forecast and action list. The report can be downloaded as PDF or Excel.",
  "Ladda upp en fil": "Upload a file",
  "Öppna sandboxen": "Open the sandbox",
  "Behöver du hjälp?": "Need help?",
  "Kontakta oss": "Contact us",

  /* ------------------------------------------------ commercial workspace */
  "Fiktiv demonstrationsdata. Byt miljö:": "Fictional demonstration data. Switch environment:",
  "Demonstrationsmiljöer": "Demo environments",
  "Underkategori": "Subcategory",
  "Varumärke": "Brand",
  "Reserverat": "Reserved",
  "Tillgängligt": "Available",
  "Hållbarhet": "Shelf life",
  "Förvaring": "Storage",
  "Lagret motsvarar {cover} dagars förbrukning men hållbarheten är {shelf} dagar. Risk för svinn: sälj äldsta partiet först enligt FEFO och minska nästa påfyllning.": "Stock covers {cover} days of demand but shelf life is {shelf} days. Waste risk: sell the oldest batch first under FEFO and reduce the next replenishment.",
  "Enhet": "Unit",
  "Inköpsvärde": "Purchase value",
  "Inköp": "Procurement",
  "Kritisk": "Critical",
  "Planerad": "Planned",
  "Förhöjd risk": "Elevated risk",
  "Stabil": "Stable",
  "Inköpsintelligens": "Procurement intelligence",
  "Beställningsförslag, ledtider och leverantörsrisk från er senaste analys.": "Reorder suggestions, lead times and supplier risk from your latest analysis.",
  "Artiklar att beställa": "Items to order",
  "Utifrån beställningspunkt och ledtid": "Based on reorder point and lead time",
  "Kritiska innan ledtid": "Critical before lead time",
  "Tar slut snabbare än leveranstiden": "Runs out faster than the delivery time",
  "Inköpsvärde, förslag": "Purchase value, suggestions",
  "Vid föreslagen kvantitet": "At the suggested quantity",
  "Leverantörer": "Suppliers",
  "artiklar med bristrisk": "items at stockout risk",
  "Inga akuta inköpsbehov": "No urgent purchasing needs",
  "Alla artiklar ligger över sina beställningspunkter.": "Every item is above its reorder point.",
  "Justera servicegrad eller ledtid i analysen om bilden inte stämmer.": "Adjust the service level or lead time in the analysis if this does not match reality.",
  "Prioriterade inköpsförslag": "Prioritised reorder suggestions",
  "Sorterat på brådskande först, därefter inköpsvärde. Kvantiteten återställer beställningspunkten och täcker cirka {days} dagar.": "Sorted by urgency first, then purchase value. The quantity restores the reorder point and covers about {days} days.",
  "Täcker": "Cover",
  "Att beställa": "To order",
  "Inga förslag.": "No suggestions.",
  "Leverantörsöversikt": "Supplier overview",
  "Leverantörer rankade på bundet lagervärde. Risken bygger på andelen artiklar med bristrisk och andelen inaktiva artiklar.": "Suppliers ranked by tied-up inventory value. Risk is based on the share of items at stockout risk and the share of inactive stock.",
  "Snittledtid": "Average lead time",
  "Bedömning": "Assessment",
  "Leverantörskolumnen saknas i underlaget.": "The supplier column is missing from the source data.",
  "Så räknas förslagen": "How the suggestions are calculated",
  "Beställningspunkt och säkerhetslager kommer från analysens servicegrad och ledtid per artikel.": "Reorder point and safety stock come from the analysis service level and each item's lead time.",
  "Föreslagen kvantitet = högsta värdet av (beställningspunkt − saldo) och {days} dagars genomsnittlig efterfrågan.": "Suggested quantity = the higher of (reorder point − on hand) and {days} days of average demand.",
  "EOQ = √(2 × årsbehov × orderkostnad / (inköpspris × lagerhållningsränta)), med antagandena {cost} per order och {rate} i lagerhållningsränta.": "EOQ = √(2 × annual demand × order cost / (purchase price × holding rate)), assuming {cost} per order and a {rate} holding rate.",
  "Minsta orderkvantitet (MOQ) finns inte i underlaget och kan därför inte tas hänsyn till. Kontrollera kvantiteten mot avtal innan beställning.": "Minimum order quantity (MOQ) is not in the source data and cannot be taken into account. Check the quantity against your agreement before ordering.",
  "{n} artiklar saknar ledtid och använder analysens standardvärde. Kontrollera dessa extra noga.": "{n} items have no lead time and use the analysis default. Review those extra carefully.",
  "Förslagen är beslutsstöd, inte automatiska inköpsordrar. Ingen beställning skickas från STOQWISE.": "The suggestions are decision support, not automatic purchase orders. STOQWISE does not send any order.",
  "Underlag": "Basis",
  "Betalningar är inte aktiverade i den här installationen. Offert, avtal och fakturering hanteras manuellt.": "Payments are not enabled in this installation. Quotes, agreements and invoicing are handled manually.",
  "Er senaste analys": "Your latest analysis",
  "{n} artiklar · {value} i lagervärde · {months} månaders historik.": "{n} items · {value} inventory value · {months} months of history.",
  "Artikelvolym och lagervärde är förifyllda från analysen. Justera vid behov.": "Item volume and inventory value are pre-filled from the analysis. Adjust as needed.",
  "Öppna analysen": "Open the analysis",
  "Formuläret kunde inte läsas.": "The form could not be read.",
  "Ditt prisestimat är beräknat.": "Your pricing estimate has been calculated.",
  "Estimatet är uppdaterat.": "The estimate has been updated.",
  "Offertförfrågan är skickad. Ingen betalning har aktiverats.": "The quote request has been sent. No payment has been activated.",
  "Bekräfta aktiveringsbegäran först.": "Confirm the activation request first.",
  "Aktivering är begärd. Ett avtal och betalning krävs innan kontot aktiveras.": "Activation has been requested. An agreement and payment are required before the account is activated.",
  "Prisreglerna är sparade.": "The pricing rules have been saved.",
  "Scenariot är sparat som antagande, inte faktisk intäkt.": "The scenario has been saved as an assumption, not actual revenue.",
  "Intern konfiguration": "Internal configuration",
  "Pris och omfattning styrs av er affärsprofil och en personlig offert. Här ser ni den interna konfigurationen och användningen.": "Price and scope are governed by your business profile and a personalised quote. This shows the internal configuration and usage.",
  "Visa personligt prisestimat": "View personalised pricing estimate",
  "Ingen betalning aktiveras automatiskt. Offert och avtal krävs.": "No payment is activated automatically. A quote and agreement are required.",
  "Analyser/mån": "Analyses/month",
  "API": "API",
  "Inte ingår": "Not included",
  "Detaljhandel": "Retail",
  "Partihandel": "Wholesale",
  "E-handel": "E-commerce",
  "Livsmedel": "Food",
  "Distribution": "Distribution",
  "Tredjepartslogistik": "Third-party logistics",
  "Tillverkning": "Manufacturing",
  "Annat": "Other",
  "Omnichannel": "Omnichannel",
  "Marknadsplats": "Marketplace",
  "Standard": "Standard",
  "Prioriterad": "Priority",
  "Dedikerad": "Dedicated",
  "Sverige": "Sweden",
  "Annat land": "Other country",
  "Grundläggande uppgifter som påverkar omfattning och support.": "Basic information that affects scope and support.",
  "Bransch": "Industry",
  "Land": "Country",
  "Affärsmodell": "Business model",
  "Antal anställda": "Employees",
  "Antal lagerställen": "Inventory locations",
  "Varav lager": "Of which warehouses",
  "Varav butiker": "Of which stores",
  "Lager och volym": "Inventory and volume",
  "Ungefärliga siffror räcker. Du kan justera dem när du har mer exakt data.": "Approximate figures are enough. You can adjust them when you have more precise data.",
  "Aktiva artiklar (SKU)": "Active items (SKU)",
  "Ungefärligt lagervärde (kr)": "Approximate inventory value (SEK)",
  "Transaktioner per månad": "Transactions per month",
  "Antal leverantörer": "Suppliers",
  "Antal användare": "Users",
  "Ytterligare integrationer": "Additional integrations",
  "Utöver ERP, WMS, POS och e-handel nedan.": "Beyond the ERP, WMS, POS and e-commerce systems below.",
  "System och data": "Systems and data",
  "Ange de system ni använder i dag. Lämna tomt om ni arbetar i kalkylblad.": "List the systems you use today. Leave blank if you work in spreadsheets.",
  "Affärssystem (ERP)": "Business system (ERP)",
  "Till exempel Fortnox, Visma eller SAP.": "For example Fortnox, Visma or SAP.",
  "Lagerhanteringssystem (WMS)": "Warehouse management system (WMS)",
  "Kassasystem (POS)": "Point of sale (POS)",
  "E-handelsplattform": "E-commerce platform",
  "Till exempel Shopify eller WooCommerce.": "For example Shopify or WooCommerce.",
  "Tillgängliga dataformat": "Available data formats",
  "Funktioner": "Capabilities",
  "Välj de områden som ska ingå i er lösning. Lagerintelligens ingår alltid.": "Select the areas to include in your solution. Inventory intelligence is always included.",
  "Supportnivå": "Support level",
  "Faktureringsval": "Billing preference",
  "Månadsvis": "Monthly",
  "Årsvis (rabatt)": "Annual (discount)",
  "Anteckningar": "Notes",
  "Frivilligt. Beskriv till exempel tidsplan, särskilda krav eller pågående systembyte.": "Optional. Describe timelines, special requirements or an ongoing system change.",
  "Övrig information": "Other information",
  "Ingen betalning sker. Estimatet är inte bindande.": "No payment is taken. The estimate is not binding.",
  "Affärsbedömning": "Business assessment",
  "Priset ska spegla verksamheten, inte en generisk tabell.": "Pricing should reflect the business, not a generic table.",
  "Svara på några frågor om företaget, lagret och de funktioner ni behöver. STOQWISE beräknar ett transparent estimat som ni kan justera innan ni begär offert.": "Answer a few questions about the company, inventory and required capabilities. STOQWISE calculates a transparent estimate you can adjust before requesting a quote.",
  "Beskriv verksamheten": "Describe the business",
  "Ungefärliga uppgifter räcker.": "Approximate figures are enough.",
  "Få ett estimat": "Get an estimate",
  "Månadspris, årspris och implementation.": "Monthly price, annual price and implementation.",
  "Begär offert": "Request a quote",
  Provperiod: "Trial",
  "Provperioden har tagit slut.": "Your trial has ended.",
  "Provperioden har tagit slut": "Your trial has ended",
  "Organisationen är i läsbart läge. All data finns kvar och kan läsas eller exporteras.": "The organisation is in read-only mode. All data remains and can be read or exported.",
  "Exportera": "Export",
  "Exportera data": "Export data",
  "Läs mer": "Read more",
  "för att fortsätta.": "to continue.",
  "Sista dagen av provperioden.": "Last day of the trial.",
  "Provperiod: {n} dagar kvar.": "Trial: {n} days left.",
  "Provperioden slutar {date}.": "The trial ends {date}.",
  "för att fortsätta efteråt.": "to continue afterwards.",
  "Läsbart läge": "Read-only mode",
  "Aktiv provperiod": "Active trial",
  "Slutdatum": "End date",
  "Dagar kvar": "Days left",
  "{n} dagar från att organisationen skapades.": "{n} days from when the organisation was created.",
  "Kom igång med din första analys": "Get started with your first analysis",
  "Ladda upp en CSV- eller Excel-export. Analysen visar var kapitalet sitter, vad som riskerar att ta slut och vilka åtgärder som ger störst effekt.": "Upload a CSV or Excel export. The analysis shows where capital is tied up, what risks running out and which actions have the greatest effect.",
  "Ladda upp en export från ert affärs- eller lagersystem.": "Upload an export from your business or inventory system.",
  "Kontrollera kolumnmappningen. Vanliga kolumner känns igen automatiskt.": "Check the column mapping. Common columns are recognised automatically.",
  "Läs analysen och ladda ner rapporten eller beställningsunderlaget.": "Read the analysis and download the report or purchase order.",
  "Provperioden slutar {date}. Efteråt är organisationen läsbar och alla data finns kvar.": "The trial ends {date}. Afterwards the organisation is read-only and all data remains.",
  "Organisationen är i läsbart läge. Det finns ingen analys att visa, men alla data som redan finns kan exporteras. Begär en offert för att aktivera en betald plan och öppna skrivåtkomsten igen.": "The organisation is in read-only mode. There is no analysis to show, but any existing data can be exported. Request a quote to activate a paid plan and restore write access.",
  "Du kan läsa och exportera allt som finns kvar, men nya importer och analyser är blockerade.": "You can read and export everything that remains, but new imports and analyses are blocked.",
  "När provperioden tar slut går organisationen över till läsbart läge. Data raderas inte och kan läsas eller exporteras.": "When the trial ends the organisation switches to read-only mode. Data is not deleted and can be read or exported.",
  "Ingen betalning aktiveras automatiskt.": "No payment is activated automatically.",
  "Uppdatera estimat": "Update estimate",
  "Beräkna mitt estimat": "Calculate my estimate",
  "Det här ingår i bedömningen": "What the assessment covers",
  "Företagsstorlek och bransch": "Company size and industry",
  "Artiklar, lagerställen och transaktioner": "Items, locations and transactions",
  "Användare och supportnivå": "Users and support level",
  "Valda analysmoduler": "Selected analysis modules",
  "Systemintegrationer och implementation": "System integrations and implementation",
  "Ditt senaste estimat": "Your latest estimate",
  "Beräknat {monthly} per månad.": "Calculated at {monthly} per month.",
  "Visa prisestimat": "View pricing estimate",
  "Priset är ett indicativt estimat. Det binds först i en signerad offert.": "The price is an indicative estimate. It becomes binding only in a signed quote.",
  "Personlig prissättning för {org}": "Personalised pricing for {org}",
  "Aktivering begärd · väntar på avtal": "Activation requested · awaiting agreement",
  "Offertförfrågan mottagen": "Quote request received",
  "Offerten är hanterad": "Quote handled",
  "Offertförfrågan avvisades": "Quote request declined",
  "Planen är aktiverad": "Plan activated",
  "Post": "Line",
  "Per månad": "Per month",
  "Varje rad kommer från ett konfigurerat prisblock.": "Every line comes from a configured pricing block.",
  "Omfattning": "Scope",
  "Engångskostnad": "One-time cost",
  "Implementation debiteras separat och bekräftas efter teknisk genomgång.": "Implementation is invoiced separately and confirmed after technical review.",
  "Endast kärnplattformen.": "Core platform only.",
  "Prisestimat": "Pricing estimate",
  "Beräknat {date} · uppdateras när underlaget ändras": "Calculated {date} · updates when the profile changes",
  "Your estimated investment": "Your estimated investment",
  "/månad": "/month",
  "Rekommenderad konfiguration: {package}. Priset bygger på er affärsprofil och kan justeras nedan.": "Recommended configuration: {package}. The price is based on your business profile and can be adjusted below.",
  "Estimat": "Estimate",
  "Exkl. moms": "Excl. VAT",
  "Ingen bindning": "No commitment",
  "Årsvis fakturering": "Annual billing",
  "Årskostnad": "Annual cost",
  "Implementation": "Implementation",
  "Hur priset byggs upp": "How the price is built",
  "Rekommenderad konfiguration": "Recommended configuration",
  "Paketet är en intern konfiguration. Funktionerna nedan är valda utifrån er profil.": "The package is an internal configuration. The capabilities below are selected from your profile.",
  "Ingår": "Included",
  "Lagerintelligens": "Inventory intelligence",
  "Tillval": "Add-ons",
  "Faktorer i beräkningen": "Pricing factors",
  "Andra faktorer: valda moduler, supportnivå, integrationer och implementation.": "Other factors: selected modules, support level, integrations and implementation.",
  "Estimatet är inte ett bindande erbjudande. Begär en formell offert eller ett aktiveringsärende. Ingen betalning dras automatiskt.": "The estimate is not a binding offer. Request a formal quote or an activation request. No payment is taken automatically.",
  "Meddelande till säljteamet": "Message to the sales team",
  "Tidsplan, frågor eller särskilda krav": "Timeline, questions or special requirements",
  "Begär formell offert": "Request a formal quote",
  "Bekräfta att du vill begära aktivering. Ingen betalning sker automatiskt.": "Confirm that you want to request activation. No payment is taken automatically.",
  "Jag har läst estimatet och vill begära aktivering.": "I have read the estimate and want to request activation.",
  "Begär aktivering": "Request activation",
  "Senaste förfrågan": "Latest request",
  "Justera underlaget": "Adjust the profile",
  "Ändra en eller flera uppgifter och beräkna om estimatet direkt.": "Change one or more details and recalculate the estimate.",
  "Beräkna om estimatet": "Recalculate the estimate",
  "Estimatet är indicativt och baseras på de uppgifter som lämnats. Det är inte ett bindande erbjudande. Moms tillkommer. Offert och avtal krävs innan aktivering.": "The estimate is indicative and based on the information provided. It is not a binding offer. VAT is added. A quote and agreement are required before activation.",
  "Max artiklar": "Maximum items",
  "Max användare": "Maximum users",
  "Max lagerställen": "Maximum locations",
  "0 betyder ingen gräns.": "0 means no limit.",
  "Prissättning": "Pricing",
  "Interna prisregler som styr varje personligt estimat.": "Internal pricing rules that drive every personalised estimate.",
  "Ändringar påverkar nya estimat och omräkningar. Redan sparade offerter behåller sitt ursprungliga underlag.": "Changes affect new estimates and recalculations. Saved quotes keep their original basis.",
  "Bas och rabatt": "Base and discount",
  "Grundavgift, minimiavgift och årsrabatt.": "Base fee, minimum fee and annual discount.",
  "Basavgift per månad": "Base fee per month",
  "Minimiavgrift per månad": "Minimum fee per month",
  "Årsrabatt (%)": "Annual discount (%)",
  "Avrundning (kr)": "Rounding (SEK)",
  "Volymblock": "Volume blocks",
  "Ingående volym och pris per extra block.": "Included volume and price per additional block.",
  "Ingående artiklar": "Included items",
  "Artikelblock": "Item block",
  "Pris per artikelblock": "Price per item block",
  "Ingående användare": "Included users",
  "Pris per extra användare": "Price per additional user",
  "Ingående lagerställen": "Included locations",
  "Pris per extra lagerställe": "Price per additional location",
  "Ingående transaktioner": "Included transactions",
  "Transaktionsblock": "Transaction block",
  "Pris per transaktionsblock": "Price per transaction block",
  "Ingående leverantörer": "Included suppliers",
  "Leverantörsblock": "Supplier block",
  "Pris per leverantörsblock": "Price per supplier block",
  "Ingående anställda": "Included employees",
  "Anställdablock": "Employee block",
  "Pris per anställdablock": "Price per employee block",
  "Ingående lagervärde": "Included inventory value",
  "Lagervärdesblock": "Inventory value block",
  "Pris per lagervärdesblock": "Price per inventory value block",
  "Moduler och support": "Modules and support",
  "Pris per vald modul och supportnivå.": "Price per selected module and support level.",
  "Support · standard": "Support · standard",
  "Support · prioriterad": "Support · priority",
  "Support · dedikerad": "Support · dedicated",
  "Integration och implementation": "Integration and implementation",
  "Löpande integrationsavgift och engångsinsats.": "Recurring integration fee and one-time effort.",
  "Per integration / månad": "Per integration / month",
  "Implementation · bas": "Implementation · base",
  "Implementation · per integration": "Implementation · per integration",
  "Implementation · per extra lager": "Implementation · per additional warehouse",
  "Paketgränser": "Package limits",
  "Används för att rekommendera en intern konfiguration.": "Used to recommend an internal configuration.",
  "Spara prisregler": "Save pricing rules",
  "Endast behöriga administratörer kan ändra reglerna.": "Only authorised administrators can change the rules.",
  "Affärsplan": "Commercial plan",
  "Intern planering · antaganden, inte faktisk intäkt": "Internal planning · assumptions, not actual revenue",
  "Det här är ett scenario för intern planering. Siffrorna är antaganden, inte faktisk intäkt eller prognos från kunddata.": "This is an internal planning scenario. The figures are assumptions, not actual revenue or a forecast from customer data.",
  "Antaganden": "Assumptions",
  "Betalande kunder": "Paying customers",
  "Intäkt per kund / månad (kr)": "Revenue per customer / month (SEK)",
  "Nya kunder / månad": "New customers / month",
  "Månatlig churn (%)": "Monthly churn (%)",
  "Kundanskaffningskostnad (kr)": "Customer acquisition cost (SEK)",
  "Bruttomarginal (%)": "Gross margin (%)",
  "Operativa kostnader / månad (kr)": "Operating costs / month (SEK)",
  "Planeringshorisont (månader)": "Planning horizon (months)",
  "Beräkna scenario": "Calculate scenario",
  "Scenarioresultat": "Scenario results",
  "MRR": "MRR",
  "ARR": "ARR",
  "Bruttovinst / månad": "Gross profit / month",
  "Rörelseresultat / månad": "Operating result / month",
  "LTV": "LTV",
  "LTV / CAC": "LTV / CAC",
  "CAC payback": "CAC payback",
  "mån": "months",
  "Kunder efter horisonten": "Customers at the end of the horizon",
  "Formler: MRR = kunder × ARPU. LTV = ARPU × bruttomarginal ÷ churn. CAC payback = CAC ÷ månatlig bruttovinst per kund.": "Formulas: MRR = customers × ARPU. LTV = ARPU × gross margin ÷ churn. CAC payback = CAC ÷ monthly gross profit per customer.",
  "Sparade scenarier": "Saved scenarios",
  "Kunder": "Customers",
  "Sparad": "Saved",
  "Inga sparade scenarier ännu.": "No saved scenarios yet.",
  "Pausa animationer": "Pause animations",
  "Aktivera animationer": "Resume animations",
  "Rörelse": "Motion",
  "Rörelse av": "Motion off",
  "Bidrag till lagerhälsan": "Contribution to inventory health",
  "Import-id": "Import ID",
  "Analys-id": "Analysis ID",
  "Import": "Import",
  "Inget kapital att frigöra": "No capital to release",
  "Övriga kategorier": "Other categories",
  "Alla artiklar har en XYZ-klass.": "Every item has an XYZ class.",
  "{n} har noll efterfrågan": "{n} have zero demand",
  "{n} har kortare historik än {months} månader": "{n} have less than {months} months of history",
  "{n} saknar månadshistorik": "{n} have no monthly history",
  "{n} har saknade värden i historiken": "{n} have missing values in the history",
  "{n} av {total} artiklar kan inte XYZ-klassificeras tillförlitligt: {reasons}. Variationskoefficienten beräknas inte när medelefterfrågan är 0 eller underlaget är otillräckligt.": "{n} of {total} items cannot be XYZ-classified reliably: {reasons}. The coefficient of variation is not calculated when mean demand is 0 or the basis is insufficient.",
  "Ingen månadshistorik finns, så efterfrågan kan inte klassificeras.": "There is no monthly history, so demand cannot be classified.",
  "Historiken är kortare än 6 månader, så variationskoefficienten är inte tillförlitlig.": "The history is shorter than 6 months, so the coefficient of variation is not reliable.",
  "Medelefterfrågan är noll. Variationskoefficienten beräknas inte och artikeln tvingas inte in i en XYZ-klass.": "Mean demand is zero. The coefficient of variation is not calculated and the item is not forced into an XYZ class.",
  "Historiken innehåller saknade värden, så artikeln klassificeras inte.": "The history contains missing values, so the item is not classified.",
  "{n} av {total} artiklar saknar efterfrågeklass (ingen försäljning i historiken).": "{n} of {total} items have no demand class (no sales in the history).",
  "Inaktivt lager, överlager, bristrisk och rotation vägt samman. Drivarnas bidrag summerar till poängen; 100 = varje krona rör sig med efterfrågan.": "Inactive stock, overstock, stockout risk and turns weighted together. The driver contributions add up to the score; 100 = every krona moves with demand.",
  "Inaktivt lager, överlager, bristrisk och rotation vägt samman. Bidragen avrundas till en decimal och summerar exakt till totalpoängen; 100 = varje krona rör sig med efterfrågan.": "Inactive stock, overstock, stockout risk and turns weighted together. Contributions are rounded to one decimal and add up exactly to the total score; 100 = every krona moves with demand.",
  "{rate} realisationsgrad · inaktiva och överlager": "{rate} realisation rate · inactive stock and overstock",
  "{rate} realisationsgrad · inaktiva artiklar": "{rate} realisation rate · inactive stock",
  "{rate} realisationsgrad · överlager": "{rate} realisation rate · overstock",
  "Lageröversikt": "Inventory overview",
  "Balanserat": "Balanced",
  "Slät yta": "Smooth surface",
  "Streckad yta": "Striped surface",
  "Prickad yta": "Dotted surface",
  "artiklar": "items",
  "{n} artiklar i {aisles} kategorier. A närmast docken, C längst bort.": "{n} items in {aisles} categories. A nearest the dock, C furthest away.",
  "Syntetisk demodata, inte verkliga kunddata": "Synthetic demo data, not real customer data",
  "Lagervärld": "Warehouse world",
  "Tabell": "Table",
  "Vy": "View",
  "Visa i 3D": "Show in 3D",
  "Visa i tabell": "Show in table",
  "Öppna artikeln": "Open the item",
  "Öppna Lager": "Open Inventory",
  "Sök artikel": "Search item",
  "Namn eller SKU": "Name or SKU",
  "Överlagervärde": "Overstock value",
  "Riskerad försäljning": "Revenue at risk",
  "Tänk om": "What if",
  "Återställ": "Reset",
  "ggr/år": "turns/yr",
  "Månadsreglage · utflöde mot dockan": "Month slider · outbound flow to the dock",
  "Försäljningsintäkt": "Sales revenue",
  "Försäljningsintäkt i period": "Sales revenue for the period",
  "Inköpskostnad (COGS)": "Cost of goods sold (COGS)",
  "Bruttovinst": "Gross profit",
  "Lagervärde / kapitalbindning": "Inventory value / capital tied",
  "Försäljningsvärde i lager": "Inventory at selling price",
  "Samtliga fält som styr analysen. Värdena kommer från samma importerade datamängd som översikten.": "All fields that drive the analysis. Values come from the same imported dataset as the overview.",
  "Lagerplats": "Storage location",
  "Lagerstatus": "Stock status",
  "Bruttomarginal per enhet": "Gross margin per unit",
  "Ekonomi": "Economics",
  "Inköpskostnad, intäkt och kapitalbindning är separata mått.": "Purchase cost, revenue and capital tied are separate measures.",
  "Kapitalbindning": "Capital tied",
  "Lagervärde och kapitalbindning värderas till inköpspris. Försäljningsvärde i lager värderas till försäljningspris och är inte en intäkt förrän varan säljs.": "Inventory value and capital tied are valued at purchase cost. Inventory at selling price is valued at the selling price and is not revenue until the item is sold.",
  "Utfall mot prognos": "Actuals vs forecast",
  "Backtest på de senaste månaderna. Utfall är faktisk försäljning, prognos är modellens skattning före perioden.": "Backtest on the most recent months. Actual is real sales; forecast is the model estimate made before the period.",
  "Utfall": "Actual",
  "Avvikelse": "Deviation",
  "Ingen backtest är möjlig med så kort historik.": "No backtest is possible with such a short history.",
  "Historik: {months} månader · {total} enheter · snitt {avg}/månad · senaste månad {last} · {zero} nollmånader.": "History: {months} months · {total} units · average {avg}/month · latest month {last} · {zero} zero months.",
  "Identifierat": "Identified",
  "Varför det är viktigt": "Why it matters",
  "Data bakom": "Data behind it",
  "Rekommenderad åtgärd": "Recommended action",
  "Uppskattad ekonomisk effekt": "Estimated financial effect",
  "Osäkerheter och antaganden": "Uncertainties and assumptions",
  "Alla leverantörer": "All suppliers",
  "Visar endast förslag från {supplier}.": "Showing suggestions from {supplier} only.",
  "Alla leverantörer visas.": "All suppliers are shown.",
  "Gruppera per leverantör": "Group by supplier",
  "Visa som en lista": "Show as one list",
  "Förväntad efterfrågan": "Expected demand",
  "Efter leverans": "After delivery",
  "Bristrisk utan order": "Stockout risk without order",
  "{n} förslag · inköpsvärde {value}": "{n} suggestions · purchase value {value}",
  "Sorterat på brådskande först, därefter inköpsvärde. Kvantiteten återställer beställningspunkten och täcker cirka {days} dagar, avrundad till MOQ.": "Sorted by urgency, then purchase value. The quantity restores the reorder point and covers about {days} days, rounded to MOQ.",
  "Föreslagen kvantitet = högsta värdet av (beställningspunkt − saldo) och {days} dagars genomsnittlig efterfrågan, avrundad uppåt till MOQ.": "Suggested quantity = the higher of (reorder point − available) and average demand for {days} days, rounded up to MOQ.",
  "Förväntad efterfrågan under ledtid och bristrisk kommer från prognosmotorn när månadshistorik finns. Utan historik används historiskt medelvärde och risken visas som –.": "Expected demand during lead time and stockout risk come from the forecast engine when monthly history exists. Without history, the historical average is used and risk is shown as –.",
  "MOQ används när artikeln har en minsta orderkvantitet i underlaget. Saknas den antas 1 och kvantiteten måste kontrolleras mot avtal.": "MOQ is used when the item has a minimum order quantity in the source data. If missing, 1 is assumed and the quantity must be checked against the agreement.",
  "Tabellvy": "Table view",
  "Välj ett ställ i världen eller en rad i tabellen.": "Pick a rack in the world or a row in the table.",
  "Klicka på ett ställ, eller sök och hoppa.": "Click a rack, or search and jump.",

  /* ---------------------------------------------------- live warehouse */
  "Alla zoner": "All zones",
  Inleverans: "Inbound",
  Lagring: "Storage",
  Plockzon: "Picking area",
  Packning: "Packing",
  Utlastning: "Outbound",
  "Slut i lager": "Out of stock",
  "Under beställningspunkt": "Below reorder point",
  "Kortare täckning än ledtid": "Less cover than lead time",
  "Visualiseringsläge": "View mode",
  Snabbfilter: "Quick filters",
  "Alla artiklar": "All items",
  "Endast överlager": "Overstock only",
  "Endast bristrisk": "Stockout risk only",
  "Endast inaktiva": "Inactive only",
  "Spela upp flödet": "Play the flow",
  Spela: "Play",
  "Återställ saldo och tid": "Reset stock and time",
  Zoner: "Zones",
  Inaktivt: "Inactive",
  Fyllnad: "Fill rate",
  "nära utlastning": "near outbound",
  "längst bort": "furthest away",
  "Välj en artikel": "Select an item",
  "Klicka på en pall eller en rad i tabellen.": "Select a pallet or a row in the table.",
  Placering: "Location",
  "Pallplatser": "Pallet positions",
  "Pallfyllnad": "Pallet fill",
  "Simulerad placering": "Simulated placement",
  "Kamera": "Camera",
  "Återställ kameran": "Reset camera",
  "Föregående gång": "Previous aisle",
  "Nästa gång": "Next aisle",
  "Zooma in": "Zoom in",
  "Zooma ut": "Zoom out",
  "3D-vy av lagret. Piltangenter roterar, plus och minus zoomar, 0 återställer kameran.": "3D warehouse view. Arrow keys rotate, plus and minus zoom, 0 resets the camera.",
  "Dra för att rotera · scroll för att zooma · shift-dra för att panorera": "Drag to orbit · scroll to zoom · shift-drag to pan",
  "Snitt/månad": "Average/month",
  "Efterfrågan, 12 mån": "Demand, 12 months",
  Månadsförsäljning: "Monthly sales",
  "Zooma hit": "Zoom to",
  Påfyllningsbehov: "Replenishment requirements",
  "Inget påfyllningsbehov i den här analysen.": "No replenishment requirements in this analysis.",
  "Simulerad dag": "Simulated day",
  Hastighet: "Speed",
  Typ: "Type",
  "Normal drift": "Normal operation",
  Efterfrågetopp: "Demand peak",
  Leveransstörning: "Supply disruption",
  Stresscenario: "Stress scenario",
  Anpassat: "Custom",
  "Lager i simuleringen": "Inventory in the simulation",
  "In idag": "In today",
  "Ut idag": "Out today",
  "Öppna ordrar": "Open orders",
  "Förväntade leveranser": "Expected deliveries",
  Beställningsbehov: "Reorder requirements",
  Simuleringsscenario: "Simulation scenario",
  "Extra försäljning": "Additional sales",
  "Artikel för extra försäljning": "Item for additional sales",
  "Försena leveranser": "Delay deliveries",
  Nollställ: "Reset",

  /* --------------------------------------------------- catalog gaps */
  Övriga: "Other",
  Efterfrågeprognos: "Demand forecast",
  Fördelning: "Distribution",
  "Omsättning mot marginal": "Turns vs margin",
  "Varje punkt är en artikel: omsättningshastighet mot marginal, storlek efter lagervärde":
    "Each point is an item: inventory turns against margin, sized by inventory value",
  "Omsättning (ggr/år) →": "Turns (× per year) →",
  "Marginal % →": "Margin % →",
  "En ruta per artikel, färg efter åtgärdsbehov och intensitet efter lagervärde":
    "One square per item, coloured by action needed and shaded by inventory value",
  "DEMOMILJÖ  ·  EXEMPELDATA": "DEMO ENVIRONMENT  ·  SAMPLE DATA",
  "Senaste körningarna.": "Recent runs.",
  "Varje manuell import loggas med radantal, fel och varningar.":
    "Every manual import is logged with row count, errors and warnings.",
  "Produktdemonstration. Byt miljö:": "Product demo. Switch environment:",
  "Inaktivitetsfönster": "Inactive stock window",
  "Inga avvikande rörelser i historiken.": "No unusual movements in the history.",
  "ABC / XYZ": "ABC / XYZ",
  ABC: "ABC",
  XYZ: "XYZ",
  "Live Warehouse": "Live Warehouse",
  "AX = stort värde, jämn efterfrågan. CZ = kandidater för utförsäljning.":
    "AX = high value, steady demand. CZ = clearance candidates.",
  "Kapitalvikt, allvar, marginal och brådska.": "Capital weight, severity, margin and urgency.",
  "En ruta per artikel. Färg = åtgärdsbehov.": "One square per item. Colour = action needed.",
  "Färg = andel inaktivt kapital": "Colour = share of inactive capital",
  "Friskt kapital": "Healthy capital",
  "Delvis inaktivt": "Partly inactive",
  "Inaktivt kapital": "Inactive capital",
  "Klicka på en ruta för att se artikel, åtgärd och lagervärde.":
    "Select a square to see the item, its action and inventory value.",
  "Omsättning mot marginal. Storlek = värde.": "Turns against margin. Size = value.",
  Balanserad: "Balanced",
  "Modellval, säkerhetslager och beställningspunkter.":
    "Model selection, safety stock and reorder points.",
  "Valet sker per artikel på lägst WAPE i backtest mot de senaste månaderna. Ingen modell väljs för att den är avancerad. MAPE visas endast när alla utfallsperioder är större än noll; WAPE är då det jämförbara måttet.":
    "The model is selected per item by lowest WAPE in a backtest of recent months. No model is chosen for being advanced. MAPE is shown only when every outcome period is above zero; WAPE is then the comparable measure.",
  "Ledtid (dagar)": "Lead time (days)",
  Beställning: "Purchase order",
  "Ladda ner CSV": "Download CSV",
  "Ladda ner Excel": "Download Excel",
  "Filen innehåller samtliga {n} förslag, grupperade per leverantör, redo att skickas till inköp.":
    "The file contains all {n} suggestions, grouped by supplier, ready to send to purchasing.",

  /* ---------------------------------------------------- deletion and selection */
  " and {n} days of cover": " and {n} days of cover",
  "{n} artiklar i {file} tas bort permanent.": "{n} items in {file} will be permanently deleted.",
  "{n} av {total} artiklar tas bort permanent.": "{n} of {total} items will be permanently deleted.",
  "0 markerade": "0 selected",
  "All organisationsdata raderas i en transaktion. Misslyckas något steg rullas hela raderingen tillbaka.":
    "All organization data is deleted in one transaction. If any step fails, the entire deletion is rolled back.",
  "Analys, nyckeltal, ABC/XYZ och åtgärdsförslag räknas om från kvarvarande artiklar.":
    "Analysis, KPIs, ABC/XYZ and suggested actions are recalculated from the remaining items.",
  "Analyser du skapat i en organisation flyttas till en annan aktiv medlem. Organisationens data finns kvar.":
    "Analyses you created in an organization are moved to another active member. The organization's data remains.",
  "Analyser skapade av dig": "Analyses created by you",
  "Andra organisationer och deras data påverkas inte.": "Other organizations and their data are not affected.",
  "Anpassa scenario": "Adjust scenario",
  "Artiklar kvar": "Items left",
  "Artiklar med kortare täckning än ledtid": "Items with less cover than lead time",
  Avbryt: "Cancel",
  "Bekräfta med ditt lösenord": "Confirm with your password",
  "Beräkningen utgår från tillgängligt saldo {stock}, ledtid {lead} dagar, säkerhetslager {safety} och beställningspunkt {reorder}. Ingen åtgärd är genomförd. Sandboxen är läsbar och sparar inget.":
    "The calculation uses available stock {stock}, lead time {lead} days, safety stock {safety} and reorder point {reorder}. No action has been performed. The sandbox is read-only and stores nothing.",
  "Copilot-samtal": "Copilot conversations",
  "Data och integritet": "Data and privacy",
  Dataset: "Dataset",
  Data: "Data",
  Scenarier: "Scenarios",
  Meddelanden: "Messages",
  "Schemalagda synkningar": "Scheduled syncs",
  "Offertförfrågningar": "Quote requests",
  "Kommersiella scenarier": "Commercial scenarios",
  Granskningslogg: "Audit log",
  "Inga importer ännu": "No imports yet",
  "Detta är en permanent radering. All data i organisationen tas bort och kan inte återställas.":
    "This is a permanent deletion. All data in the organization is removed and cannot be restored.",
  "Detta är en permanent radering. Kontrollera urvalet innan du fortsätter.":
    "This is a permanent deletion. Check the selection before continuing.",
  "Ditt konto och dess personuppgifter raderas permanent. Det går inte att ångra.":
    "Your account and its personal data are permanently deleted. This cannot be undone.",
  "Ett konto som bara tillhörde den här organisationen loggas ut. Kontot kan logga in igen och skapa en ny organisation.":
    "An account that belonged only to this organization is signed out. The account can sign in again and create a new organization.",
  "Exporten innehåller fullständiga analysresultat, narrativ, indata och alla artikelrader. Radering av organisationen kräver ägarroll, organisationens namn och ditt lösenord. Radering av kontot kräver din e-postadress och ditt lösenord.":
    "The export contains complete analysis results, narratives, input data and all item rows. Deleting the organization requires the owner role, the organization name and your password. Deleting the account requires your email address and password.",
  "Exportera hela organisationen eller radera den permanent.": "Export the entire organization or delete it permanently.",
  "Granskningsloggen för organisationen tas bort. En separat post om raderingen sparas utan organisationskoppling.":
    "The organization's audit log is deleted. A separate record of the deletion is kept without an organization link.",
  "Hela datasetet tas bort": "The entire dataset is deleted",
  "Hela organisationen tas bort": "The entire organization is deleted",
  "In total, {low}–{high} is assessed as releasable within 6–12 months, at a realisation rate of 25–55% of capital in inactive items and 15–35% of overstock. The range is conservatively set.":
    "In total, {low}–{high} is assessed as releasable within 6–12 months, at a realisation rate of 25–55% of capital in inactive items and 15–35% of overstock. The range is conservatively set.",
  Inaktiva: "Inactive",
  "Inventory analysis: {company}": "Inventory analysis: {company}",
  "Jag förstår att kontot raderas permanent.": "I understand that the account will be permanently deleted.",
  "Jag förstår att organisationen och all dess data raderas permanent.":
    "I understand that the organization and all its data will be permanently deleted.",
  "Kontot kan inte raderas ännu eftersom du är ensam ägare till en eller flera organisationer.":
    "The account cannot be deleted yet because you are the sole owner of one or more organizations.",
  "Ladda ner en export först om du behöver behålla analysresultat eller artikelrader.":
    "Download an export first if you need to keep analysis results or item rows.",
  "Lagervärde som tas bort": "Inventory value being deleted",
  "Markera {n}": "Select {n}",
  "Markera alla på sidan": "Select all on this page",
  "Markerade artiklar tas bort": "Selected items will be deleted",
  "Medlemmarnas användarkonton finns kvar, men medlemskapet i organisationen tas bort.":
    "Members' user accounts remain, but their membership in the organization is removed.",
  "Modell {method} · konfidens {confidence} · WAPE {wape} · MAPE {mape}":
    "Model {method} · confidence {confidence} · WAPE {wape} · MAPE {mape}",
  "Möjligt vid realisering, intervall": "Potential at realisation, range",
  Obegränsat: "Unlimited",
  "Organisationen {name} raderas med analyser, artikelrader, importer, scenarier, samtal, integrationer, abonnemang och medlemskap.":
    "The organization {name} is deleted together with analyses, item rows, imports, scenarios, conversations, integrations, subscription and memberships.",
  Organisationer: "Organizations",
  "Pallens fyllnadsgrad visar saldo": "Pallet fill level shows stock",
  "Permanent radering av hela organisationen.": "Permanent deletion of the entire organization.",
  "Prognoser, inköpsförslag och Lagervärld läser samma analys och ändras därför direkt.":
    "Forecasts, purchase suggestions and Inventory world read the same analysis and therefore update immediately.",
  Radera: "Delete",
  "Radera artiklar": "Delete items",
  "Radera artiklarna": "Delete the items",
  "Radera dataset": "Delete dataset",
  "Radera datasetet": "Delete the dataset",
  "Radera hela organisationen": "Delete the entire organization",
  "Radera kontot": "Delete the account",
  "Radera markerade": "Delete selected",
  "Radera mitt konto": "Delete my account",
  "Radera organisationen": "Delete the organization",
  "Radera organisationen först. När den är borta kan du radera kontot härifrån.":
    "Delete the organization first. Once it is gone you can delete the account here.",
  "Raderar…": "Deleting…",
  "Radering av ditt personliga konto.": "Deletion of your personal account.",
  "Raderingen kan inte ångras.": "The deletion cannot be undone.",
  "Rapporter och exporter som redan laddats ner påverkas inte.":
    "Reports and exports already downloaded are not affected.",
  "Saldo × inköpspris": "Stock × unit cost",
  "Skriv din e-postadress för att bekräfta": "Enter your email address to confirm",
  "Skriv organisationens namn för att bekräfta": "Enter the organization name to confirm",
  "Sparade vyer": "Saved views",
  "Vad påverkas": "What is affected",
  "Vad som händer": "What happens",
  "Vad visar läget?": "What does the situation show?",
  "Värde över ledtid + 30 dagars behov": "Value above lead time + 30 days of demand",
  "Ytmönster visar XYZ: slät, streckad eller prickad": "Surface pattern shows XYZ: smooth, dashed or dotted",
  "Årlig varukostnad / lagervärde": "Annual cost of goods / inventory value",
};

export type AppTranslate = (source: string, vars?: Record<string, string | number>) => string;

export function isPseudoLocale(locale: Locale): locale is typeof PSEUDO_LOCALE {
  return locale === PSEUDO_LOCALE;
}

export function hasAppTranslation(source: string): boolean {
  return Object.prototype.hasOwnProperty.call(EN, source);
}

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}

/** Swedish source string in, locale-appropriate string out. */
export function appText(locale: Locale, source: string, vars?: Record<string, string | number>): string {
  if (isPseudoLocale(locale)) {
    const translated = EN[source];
    return fill(
      translated === undefined
        ? `${PSEUDO_MISSING}${source}${PSEUDO_CLOSE}`
        : `${PSEUDO_OPEN}${translated}${PSEUDO_CLOSE}`,
      vars,
    );
  }
  return fill(locale === "en" ? EN[source] ?? source : source, vars);
}

export function appTranslator(locale: Locale): AppTranslate {
  return (source, vars) => appText(locale, source, vars);
}

/* ------------------------------------------------------------- formatting */

export function appNum(locale: Locale, value: number, decimals = 0): string {
  return Number.isFinite(value) ? formatNumber(locale, value, decimals) : "–";
}

/**
 * SEK in every locale. Swedish keeps the product's existing shorthand
 * (`kr`, `Mkr`); English spells the currency code for an international reader.
 */
export function appSek(locale: Locale, value: number, compact = false): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (locale === "sv") {
    if (compact && abs >= 1_000_000) return `${appNum(locale, value / 1_000_000, 1)} Mkr`;
    if (compact && abs >= 10_000) return `${appNum(locale, Math.round(value / 1000))} tkr`;
    return `${appNum(locale, Math.round(value))} kr`;
  }
  if (compact && abs >= 1_000_000) return `SEK ${appNum(locale, value / 1_000_000, 1)}m`;
  if (compact && abs >= 10_000) return `SEK ${appNum(locale, Math.round(value / 1000))}k`;
  return `SEK ${appNum(locale, Math.round(value))}`;
}

export function appPct(locale: Locale, value: number, decimals = 1): string {
  return locale === "en" ? `${appNum(locale, value, decimals)}%` : `${appNum(locale, value, decimals)} %`;
}

export function appDate(locale: Locale, iso: string): string {
  return new Date(iso).toLocaleDateString(intlFor(locale), { year: "numeric", month: "short", day: "numeric" });
}

export function appDateTime(locale: Locale, iso: string): string {
  return new Date(iso).toLocaleString(intlFor(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function appRole(locale: Locale, role: "owner" | "admin" | "analyst" | "viewer"): string {
  return appText(locale, { owner: "Ägare", admin: "Administratör", analyst: "Analytiker", viewer: "Läsare" }[role]);
}

export function appAction(locale: Locale, action: string): string {
  const source =
    { write_off: "Nedskrivning", liquidate: "Realisera", reduce: "Minska", reorder: "Beställ", review: "Granska", ok: "OK" }[
      action
    ] ?? action;
  return appText(locale, source);
}

export function appMethod(locale: Locale, method: string): string {
  const source =
    {
      ses: "enkel utjämning",
      holt: "Holt",
      holt_winters: "Holt-Winters",
      croston: "Croston",
      sba: "SBA",
      tsb: "TSB",
      adida: "ADIDA",
      naive: "naivt medel",
      mean: "medelvärde",
      zero: "ingen historik",
    }[method] ?? method;
  return appText(locale, source);
}

export function appConfidence(locale: Locale, confidence: string): string {
  const source = { high: "hög", medium: "medel", low: "låg" }[confidence] ?? confidence;
  return appText(locale, source);
}

/**
 * Engine-generated prose. The analysis engine writes Swedish reasons, anomaly
 * notes and scenario formulas; these patterns carry them into English without
 * changing the computation or the numbers.
 */
export function appDynamic(locale: Locale, text: string): string {
  if (locale === "sv" || !text) return text;
  return englishFormatting(translateDynamic(text));
}

/** Rewrites engine numbers into international English notation. */
function englishFormatting(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/(\d) (?=\d{3}(?:\D|$))/g, "$1,")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d) %/g, "$1%")
    .replace(/([\d][\d,.]*) kr\b/g, "SEK $1")
    .replace(/([\d][\d,.]*) Mkr\b/g, "SEK $1m")
    .replace(/([\d][\d,.]*) tkr\b/g, "SEK $1k");
}

function translateDynamic(text: string): string {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(\d+) rader hoppades över eftersom saldo eller inköpspris saknades eller inte var ett tal\. Exempel: (.+)\.$/)))
    return `${m[1]} rows were skipped because stock or unit cost was missing or not a number. Examples: ${m[2]}.`;
  if ((m = text.match(/^(\d+) dubbletter på artikelnummer slogs ihop \(saldo och försäljning summerades\)\.$/)))
    return `${m[1]} duplicate item numbers were merged (stock and sales were summed).`;
  if ((m = text.match(/^(\d+) artiklar hade negativt saldo och sattes till 0\. Kontrollera om det beror på ej registrerade inleveranser\.$/)))
    return `${m[1]} items had negative stock and were set to 0. Check whether the cause is unrecorded receipts.`;
  if ((m = text.match(/^(\d+) artiklar saknar inköpspris\. Deras lagervärde räknas som 0, vilket underskattar det bundna kapitalet\.$/)))
    return `${m[1]} items are missing a unit cost. Their inventory value is counted as 0, which underestimates tied-up capital.`;
  if ((m = text.match(/^(\d+) artiklar saknar försäljningspris\. ABC-analysen använder då inköpspris i stället, vilket ger samma rangordning men lägre belopp\.$/)))
    return `${m[1]} items are missing a selling price. ABC analysis then uses unit cost instead, which keeps the ranking but lowers the amount.`;
  if ((m = text.match(/^Endast (\d+) månader av försäljningshistorik hittades\. XYZ-analys kräver minst 6 månader och hoppas över\.$/)))
    return `Only ${m[1]} months of sales history were found. XYZ analysis needs at least 6 months and is skipped.`;
  if ((m = text.match(/^(\d+) rader hade ett annat antal kolumner än rubrikraden \((.+) mot (\d+)\)\. Korta rader fylldes ut med tomma värden\.$/)))
    return `${m[1]} rows had a different number of columns than the header row (${m[2]} against ${m[3]}). Short rows were padded with empty values.`;
  if ((m = text.match(/^(.+) % av lagervärdet i en artikel$/)))
    return `${m[1]}% of inventory value in one item`;
  if ((m = text.match(/^Överlager (\d+) enheter$/))) return `Overstock ${m[1]} units`;
  if ((m = text.match(/^Täcker ([\d\s.,]+) dagar mot ([\d\s.,]+) dagars ledtid$/)))
    return `Covers ${m[1]} days against a ${m[2]}-day lead time`;
  if ((m = text.match(/^Låg marginal \((.+) %\)$/))) return `Low margin (${m[1]}%)`;
  if ((m = text.match(/^(\d+) avvikande månader i historiken\. Senaste månaden ([+-]?\d+) % mot snittet före\.$/)))
    return `${m[1]} unusual months in the history. Last month ${m[2]}% against the preceding average.`;
  if ((m = text.match(/^Ingen försäljning alls under (\d+) månader men ([\d\s.,]+) enheter i lager\.$/)))
    return `No sales at all for ${m[1]} months but ${m[2]} units in stock.`;
  if ((m = text.match(/^(\d+) artiklar har inte sålt något under de senaste (\d+) dagarna och binder (.+)\. Börja med de (\d+) största posterna: kampanj, outlet, retur till leverantör eller nedskrivning\.$/)))
    return `${m[1]} items have not sold in the last ${m[2]} days and tie up ${m[3]}. Start with the ${m[4]} largest: campaign, outlet, return to supplier or write-off.`;
  if ((m = text.match(/^(\d+) artiklar täcker mindre än sin egen ledtid\. Det motsvarar cirka (.+) i försäljning som riskerar att utebli under nästa ledtid\.$/)))
    return `${m[1]} items cover less than their own lead time, representing about ${m[2]} in sales at risk during the next lead time.`;
  if ((m = text.match(/^(.+) avvikande månader/))) return text;

  const exact: Record<string, string> = {
    "Ingen försäljning i perioden": "No sales in the period",
    "Filen innehöll null-tecken som rensades bort.": "The file contained null characters, which were removed.",
    "Filen innehåller inga rader.": "The file contains no rows.",
    "Ingen månadsuppdelad historik hittades. Säsong och variation kan inte beräknas, så XYZ-analysen hoppas över. Inaktivt lager bedöms på hela perioden.":
      "No monthly history was found. Seasonality and variation cannot be calculated, so XYZ analysis is skipped. Inactive stock is assessed over the whole period.",
    "Ingen registrerad försäljning under ett år": "Inactive stock for over a year",
    "Negativt täckningsbidrag": "Negative contribution margin",
    "Risk för brist inom ledtid": "Risk of stockout within lead time",
    "Lägre servicenivå": "Lower service level",
    "Fler artiklar i riskzonen": "More items at risk",
    "Leverantörsförsening": "Supplier delay",
    "Förlorat täckningsbidrag": "Lost contribution margin",
    "Stor reduktion": "Large reduction",
    "utmärkt": "excellent",
    "god": "good",
    "svag": "weak",
    "kritisk": "critical",
    "Överlager": "Overstock",
    "Omsättningshastighet": "Inventory turns",
    "Efterfrågan under ledtid = dygnsefterfrågan × ledtid (prognos, justerad med scenariots multiplikator).":
      "Demand during lead time = daily demand × lead time (forecast, adjusted by the scenario multiplier).",
    "Säkerhetslager = z(servicenivå) × σ_månad × √(ledtid / 30,44).":
      "Safety stock = z(service level) × σ_month × √(lead time / 30.44).",
    "Reduceribelt lager = saldo − beställningspunkt. Reduktionen tillämpas endast där.":
      "Reducible stock = stock − reorder point. The reduction is applied only there.",
    "Förväntad brist = σ_LT × normalförlust(z), z = (saldo − μ_LT) / σ_LT.":
      "Expected shortage = σ_LT × normal loss(z), z = (stock − μ_LT) / σ_LT.",
    "Förlorad marginal = förväntad brist i enheter × (försäljningspris − inköpspris).":
      "Lost margin = expected shortage in units × (selling price − purchase price).",
    "Kapitalbehov = Σ(beställningspunkt × inköpspris). Det är den nivå scenariot kräver, till skillnad från dagens saldo.":
      "Capital requirement = Σ(reorder point × purchase price). That is the level the scenario requires, unlike today's stock.",
    "Årlig nettoeffekt = frigjort kapital × lagerhållningsränta − förlorad marginal − ökad kapitalbindning i inköp × 8 %.":
      "Annual net effect = released capital × holding rate − lost margin − increased purchase capital × 8%.",
    "Uppfyllnadsgrad = 1 − förväntad brist / förväntad årsefterfrågan.":
      "Service level = 1 − expected shortage / expected annual demand.",
  };
  if (exact[text]) return exact[text];
  if (text.startsWith("Reducibelt lager ="))
    return "Reducible stock = stock − reorder point. The reduction is applied only there.";
  if ((m = text.match(/^Beräknad uppfyllnadsgrad faller från ([\d.,]+) % till ([\d.,]+) %\. Det motsvarar ([\d\s.,]+) enheter i förväntad brist\.$/)))
    return `Calculated service level falls from ${m[1]}% to ${m[2]}%, corresponding to ${m[3]} units of expected shortage.`;
  if ((m = text.match(/^(\d+) artiklar till hamnar under sin beställningspunkt\.$/)))
    return `${m[1]} more items fall below their reorder point.`;
  if ((m = text.match(/^(\d+) % sannolikhet för (\d+) dagars försening ökar säkerhetslagret med ([\d\s.,]+) kr i bundet kapital\.$/)))
    return `${m[1]}% probability of a ${m[2]}-day delay increases safety stock by SEK ${m[3]} in tied-up capital.`;
  if ((m = text.match(/^Beräknad utebliven marginal ökar med ([\d\s.,]+) kr under en ledtid\.$/)))
    return `Calculated lost margin increases by SEK ${m[1]} during one lead time.`;
  if ((m = text.match(/^Simulera (\d+) % i stället$/))) return `Simulate ${m[1]}% instead`;
  if ((m = text.match(/^Prognos för (.+)$/))) return `Forecast for ${m[1]}`;
  if (text === "Reduktion över 30 % av överskottslagret kräver att efterfrågeprognosen är stabil. Backtesta prognosen innan beslutet.")
    return "A reduction above 30% of excess stock requires a stable demand forecast. Backtest the forecast before deciding.";
  return appText("en", text);
}

/** Exposed for the catalog completeness test. */
export function appCatalog(): Readonly<Record<string, string>> {
  return EN;
}
