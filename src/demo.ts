/**
 * Curated demo environments for STOQWISE.
 *
 * Every company, product, SKU, supplier and figure here is fictional and was
 * written for this project. The data is generated deterministically from
 * explicit product-level demand profiles, so the dashboard, item table,
 * forecasts, recommendations, CSV and PDF all describe the same inventory.
 *
 * The generator does not invent independent KPI numbers. It only produces the
 * inputs a real export would contain (stock, cost, price, lead time, MOQ and a
 * monthly sales history); analysis.ts calculates everything else.
 */
import type { ItemInput } from "./dataset.ts";

export type DemoEnvironmentId = "industri" | "hem" | "foodservice" | "ecommerce";

export interface DemoEnvironmentMeta {
  id: DemoEnvironmentId;
  company: string;
  orgNumber: string;
  industry: string;
  title: string;
  description: string;
  audience: string;
  industryEn: string;
  titleEn: string;
  descriptionEn: string;
  audienceEn: string;
  accentEn: string;
  months: number;
  accent: string;
}

export interface DemoDataset {
  environment: DemoEnvironmentMeta;
  company: string;
  orgNumber: string;
  months: number;
  items: ItemInput[];
}

type DemandPattern =
  | "steady"
  | "growth"
  | "decline"
  | "volatile"
  | "summer"
  | "winter"
  | "q4"
  | "dead"
  | "discontinued"
  | "new"
  | "inactive";

interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  subcategory: string;
  supplier: string;
  cost: number;
  price: number;
  demand: number;
  pattern: DemandPattern;
  /** Stock expressed as months of typical demand. */
  coverage: number;
  leadTimeDays: number;
  moq: number;
  brand: string;
  unit: string;
}

const ENVIRONMENTS: Record<DemoEnvironmentId, DemoEnvironmentMeta> = {
  industri: {
    id: "industri",
    company: "Nordvind Industriförsörjning AB",
    orgNumber: "559214-6031",
    industry: "Industri- och byggvarugrossist",
    title: "Nordisk grossist för industri, bygg och installation",
    industryEn: "Industrial and construction wholesaler",
    titleEn: "Nordic wholesaler for industry, construction and installation",
    descriptionEn:
      "B2B wholesaler with a central warehouse in Örebro and a pickup point in Gothenburg. Sells to installers, contractors and industrial customers. Long lead times on imported components and a clear construction-season peak.",
    audienceEn: "installers, contractors and industrial customers",
    accentEn: "Industry",
    description:
      "B2B-grossist med centrallager i Örebro och utlämning i Göteborg. Säljer till installatörer, byggföretag och industrikunder. Långa ledtider på importerade komponenter och tydliga säsongstopp under byggsäsongen.",
    audience: "installatörer, byggföretag och industrikunder",
    months: 24,
    accent: "Industri",
  },
  hem: {
    id: "hem",
    company: "Ljusgården Hem & Trädgård AB",
    orgNumber: "556903-1184",
    industry: "Hem- och trädgårdsvaruhandel",
    title: "Butikskedja med e-handel inom hem, kök och trädgård",
    industryEn: "Home and garden retail",
    titleEn: "Store chain with e-commerce in home, kitchen and garden",
    descriptionEn:
      "Four stores in the Mälardalen region plus e-commerce. The assortment shifts with seasons and campaigns. High-volume low-price items sit alongside furniture and garden products that tie up more capital.",
    audienceEn: "consumers in stores and online",
    accentEn: "Retail",
    description:
      "Fyra butiker i Mälardalen plus e-handel. Sortimentet växlar mellan säsonger och kampanjer. Lågprisartiklar med hög volym blandas med möbler och trädgårdsprodukter som binder mer kapital.",
    audience: "privatkunder i butik och på nätet",
    months: 24,
    accent: "Handel",
  },
  foodservice: {
    id: "foodservice",
    company: "Solsidan Foodservice AB",
    orgNumber: "559087-4420",
    industry: "Livsmedelsdistribution till restaurang och storkök",
    title: "Distributör av torrvaror, fryst och förpackning",
    industryEn: "Foodservice distribution",
    titleEn: "Distributor of dry goods, frozen food and packaging",
    descriptionEn:
      "Distributes to restaurants, cafés and institutional kitchens in the Stockholm region. Short lead times on fresh goods, FEFO rotation on chilled and frozen lines, fixed minimum quantities on packaging and clear seasonal swings in beverages and ice cream.",
    audienceEn: "restaurants, cafés and institutional kitchens",
    accentEn: "Food service",
    description:
      "Distribuerar till restauranger, caféer och storkök i Stockholmsregionen. Korta ledtider på färskvaror, FEFO-rotation på kylda och frysta varor, fasta minimikvantiteter på förpackning och tydliga säsongsvariationer i dryck och glass.",
    audience: "restauranger, caféer och storkök",
    months: 12,
    accent: "Livsmedel",
  },
  ecommerce: {
    id: "ecommerce",
    company: "Nordbris Lifestyle AB",
    orgNumber: "559331-2078",
    industry: "E-handel inom livsstil och kläder",
    title: "Digitalt först med brett livsstilssortiment",
    industryEn: "Lifestyle and apparel e-commerce",
    titleEn: "Digital-first retailer with a broad lifestyle assortment",
    descriptionEn:
      "Online retailer with a warehouse in Jönköping and dropship for selected accessories. High transaction volume, campaign peaks and short-lived fashion items. Winter and summer collections drive large seasonal swings.",
    audienceEn: "consumers in the Nordics",
    accentEn: "E-commerce",
    description:
      "E-handlare med lager i Jönköping och dropship för utvalda accessoarer. Hög transaktionsvolym, kampanjtoppar och modevaror med kort livslängd. Vinter- och sommarkollektioner driver stora säsongssvängningar.",
    audience: "konsumenter i Norden",
    months: 12,
    accent: "E-handel",
  },
};

const RAW: Record<DemoEnvironmentId, string> = {
  industri: `
PT-10106|18V borstlös slagskruvdragare|Elverktyg|Slagskruvdragare|Nordvind Verktyg AB|1180|1890|46|steady|2.0|21|6|Nordvent|st
HT-10002|Professionell polyuretanhammare 450 g|Handverktyg|Hammare|Nordvind Verktyg AB|184|319|74|steady|3.0|14|12|Hantverka|st
HT-10003|Ledad skiftnyckel 250 mm|Handverktyg|Skiftnycklar|Nordvind Verktyg AB|142|249|58|steady|2.5|14|12|Hantverka|st
HT-10004|Spärrskaft 1/2 tum 250 mm|Handverktyg|Spärrskaft|Nordvind Verktyg AB|268|449|41|steady|2.0|21|6|Nordvent|st
HT-10005|Bitsats 32 delar i metallbox|Handverktyg|Bitsatser|Nordvind Verktyg AB|196|349|66|steady|2.5|21|12|Nordvent|st
HT-10006|Vattenpass 600 mm|Handverktyg|Mätverktyg|Nordvind Verktyg AB|154|279|37|steady|2.0|21|12|Hantverka|st
HT-10007|Justerskruvmejsel 3–8 mm|Handverktyg|Skruvmejslar|Nordvind Verktyg AB|82|149|53|steady|3.0|14|24|Hantverka|st
PT-10101|18V vinkelslip 125 mm|Elverktyg|Vinkelslipar|Nordvind Verktyg AB|1260|1990|22|growth|1.5|30|4|Nordvent|st
PT-10102|18V cirkelsåg 165 mm|Elverktyg|Cirkelsågar|Nordvind Verktyg AB|1480|2390|17|summer|2.5|30|4|Nordvent|st
PT-10103|SDS-plus borrhammare 800 W|Elverktyg|Borrhammare|Nordvind Verktyg AB|1740|2790|14|steady|2.0|30|4|Nordvent|st
PT-10104|18V batteri 5,0 Ah|Elverktyg|Batterier|Nordvind Verktyg AB|690|1090|64|growth|1.2|21|6|Nordvent|st
PT-10105|18V arbetslampa 40 W|Elverktyg|Arbetsbelysning|Nordvind Verktyg AB|420|699|38|winter|2.0|21|6|Nordvent|st
FA-10201|M8 sexkantsbult varmförzinkad 60 mm, 100-pack|Fästmaterial|Bult och mutter|Svea Fästelement AB|188|299|142|summer|0.5|18|20|Svea|pack
FA-10202|M6 vingmutter rostfri A4, 200-pack|Fästmaterial|Muttrar|Svea Fästelement AB|96|169|88|steady|2.4|18|20|Svea|pack
FA-10203|Ankarbult M10 100 mm, 25-pack|Fästmaterial|Förankring|Svea Fästelement AB|214|359|63|summer|2.2|18|12|Svea|pack
FA-10204|Gängstång M8 1 m|Fästmaterial|Gängstänger|Svea Fästelement AB|52|89|120|steady|3.5|18|25|Svea|st
FA-10205|Gipsskruv 3,5×25 mm, 1000-pack|Fästmaterial|Skruv|Svea Fästelement AB|134|219|185|summer|1.5|18|20|Svea|pack
EL-10301|Jordfelsbrytare 2-polig 40 A|Elkomponenter|Jordfelsbrytare|Elinor Komponent AB|612|949|28|volatile|2.2|35|5|Elinor|st
EL-10302|Vägguttag IP44 dubbelt|Elkomponenter|Uttag|Elinor Komponent AB|78|139|164|steady|2.8|28|25|Elinor|st
EL-10303|Kabelvinda 3G2,5 25 m|Elkomponenter|Kabel|Elinor Komponent AB|548|849|36|summer|2.0|28|4|Elinor|st
EL-10304|LED-armatur 40 W IP65|Elkomponenter|Belysning|Elinor Komponent AB|486|759|31|winter|7.0|35|6|Ljusverk|st
EL-10305|Kontaktor 25 A 230 V|Elkomponenter|Styrning|Elinor Komponent AB|302|489|19|steady|8.0|42|10|Elinor|st
PL-10401|Kopparrör 15 mm, 2,5 m|VVS|Kopparrör|Värmdals VVS AB|168|259|96|summer|2.4|21|10|Värmdal|st
PL-10402|Mässingskulventil 22 mm|VVS|Ventiler|Värmdals VVS AB|124|209|72|steady|2.5|21|12|Värmdal|st
PL-10403|Rostfri slangklämma 32 mm, 10-pack|VVS|Klammer|Värmdals VVS AB|46|85|210|steady|3.0|14|40|Värmdal|pack
PL-10404|PEX-rör 15 mm, 50 m|VVS|PEX|Värmdals VVS AB|396|629|44|summer|2.2|21|5|Värmdal|rulle
PL-10405|Vattenlås 1 1/2 tum|VVS|Avlopp|Värmdals VVS AB|88|149|34|steady|4.5|21|12|Värmdal|st
PI-10501|Presskoppling 15 mm rak|Rör och kopplingar|Presskopplingar|Värmdals VVS AB|34|59|260|summer|2.6|21|50|Värmdal|st
PI-10502|Vinkel 90 grader 22 mm|Rör och kopplingar|Vinklar|Värmdals VVS AB|42|75|148|steady|3.0|21|25|Värmdal|st
PI-10503|Reduktion 22/15 mm|Rör och kopplingar|Reduktioner|Värmdals VVS AB|38|69|112|steady|3.2|21|25|Värmdal|st
PI-10504|Pressverktyg 15–22 mm|Rör och kopplingar|Verktyg|Värmdals VVS AB|1240|1890|7|inactive|6.0|35|1|Värmdal|st
CM-10601|Byggskiva OSB3 12 mm, 2500×1200|Byggmaterial|Skivmaterial|Byggmaterial Nord AB|198|289|126|summer|2.0|14|30|Nordboard|st
CM-10602|Mineralull 95 mm, 5,0 m²|Byggmaterial|Isolering|Byggmaterial Nord AB|148|229|168|winter|6.0|14|24|Nordboard|pack
CM-10603|Fogskum 750 ml|Byggmaterial|Tätning|Byggmaterial Nord AB|74|129|96|steady|2.4|14|12|Nordboard|st
SF-10701|Skyddshandskar nitril, storlek 10|Skyddsutrustning|Handskar|Skydda Arbetsmiljö AB|48|89|320|steady|0.3|14|24|Skydda|par
SF-10702|Skyddsglasögon EN 166|Skyddsutrustning|Ögonskydd|Skydda Arbetsmiljö AB|62|109|118|steady|2.0|14|12|Skydda|st
SF-10703|Hörselskydd SNR 31 dB|Skyddsutrustning|Hörselskydd|Skydda Arbetsmiljö AB|118|199|86|steady|2.2|14|12|Skydda|st
SF-10704|Skyddsväst klass 2, XL|Skyddsutrustning|Varselkläder|Skydda Arbetsmiljö AB|96|169|54|steady|2.8|21|10|Skydda|st
AS-10801|Silikon neutral vit 300 ml|Lim och fog|Silikon|Kemiproffs Sverige AB|58|99|176|summer|2.2|21|12|Kemiproffs|st
AS-10802|PU-lim 600 ml|Lim och fog|Lim|Kemiproffs Sverige AB|124|199|82|steady|2.4|21|12|Kemiproffs|st
AS-10803|Butyltejp 10 m|Lim och fog|Tejp|Kemiproffs Sverige AB|68|119|64|steady|3.0|21|12|Kemiproffs|st
WS-10901|Verktygsvagn 7 lådor|Verkstad|Förvaring|Nordvind Verktyg AB|1980|2990|11|steady|2.0|35|2|Nordvent|st
WS-10902|Arbetsbänk 1500 mm|Verkstad|Arbetsbänkar|Nordvind Verktyg AB|2240|3390|8|steady|2.5|35|2|Nordvent|st
WS-10903|Skruvstycke 125 mm|Verkstad|Skruvstycken|Nordvind Verktyg AB|486|759|22|steady|2.4|21|4|Hantverka|st
WS-10904|Oljeabsorbent 40 L|Verkstad|Absorbenter|Kemiproffs Sverige AB|212|349|18|dead|5.0|21|6|Kemiproffs|säck
WS-10905|Förlängningskabel 25 m 16 A|Verkstad|Elmaterial|Elinor Komponent AB|342|549|46|winter|2.8|28|6|Elinor|st
`,
  hem: `
RS-20001|Stackbar förvaringslåda 45 L|Förvaring|Lådor|Hemma & Trädgård Norden AB|86|149|280|steady|2.4|21|12|Ordna|st
RS-20002|Fällbar hylla 80×30 cm|Förvaring|Hyllor|Hemma & Trädgård Norden AB|128|229|94|steady|2.0|28|6|Ordna|st
RS-20003|Plastback 20 L med lock|Förvaring|Backar|Hemma & Trädgård Norden AB|42|79|360|steady|2.8|21|24|Ordna|st
RS-20004|Klädbox 60 L, 2-pack|Förvaring|Klädboxar|Hemma & Trädgård Norden AB|118|199|118|q4|2.2|28|8|Ordna|pack
RS-20005|Verktygslåda 16 tum|Förvaring|Verktygslådor|Hemma & Trädgård Norden AB|146|249|48|steady|2.5|21|8|Ordna|st
KT-20101|Rostfri köksblandare med svängbar pip|Kök|Blandare|Kökspartner Sverige AB|468|799|42|growth|1.4|35|4|Kök&Co|st
KT-20102|Digital köksvåg 5 kg|Kök|Vågar|Kökspartner Sverige AB|92|169|156|q4|2.2|28|12|Kök&Co|st
KT-20103|Gjutjärnspanna 28 cm|Kök|Stekpannor|Kökspartner Sverige AB|214|379|58|winter|2.0|35|6|Kök&Co|st
KT-20104|Skärbräda bambu 40×30|Kök|Skärbrädor|Kökspartner Sverige AB|64|119|132|steady|2.6|21|12|Kök&Co|st
KT-20105|Vakuumtermos 500 ml|Kök|Termosar|Kökspartner Sverige AB|118|219|104|winter|2.0|28|12|Kök&Co|st
TR-20201|Trädgårdsslang 25 m med kopplingar|Trädgård|Slangar|Grönskande Trädgård AB|186|329|96|summer|3.0|21|6|Grönskande|st
TR-20202|Handgräsklippare 38 cm|Trädgård|Gräsklippare|Grönskande Trädgård AB|548|899|28|volatile|2.4|35|4|Grönskande|st
TR-20203|Planteringsspade i rostfritt stål|Trädgård|Handredskap|Grönskande Trädgård AB|78|139|142|summer|2.8|21|12|Grönskande|st
TR-20204|Häcksax manuell 55 cm|Trädgård|Häcksaxar|Grönskande Trädgård AB|146|249|64|summer|2.2|28|6|Grönskande|st
TR-20205|Trädgårdsdyna 50×50 cm|Trädgård|Dynor|Grönskande Trädgård AB|118|199|72|summer|4.5|28|8|Grönskande|st
BE-20301|LED-taklampa 24 W|Belysning|Taklampor|Ljusgården Import AB|168|299|84|winter|2.2|35|6|Ljusgården|st
BE-20302|LED-glödlampa E27 9 W, 3-pack|Belysning|Lampor|Ljusgården Import AB|58|109|420|winter|2.0|21|24|Ljusgården|pack
BE-20303|Utomhuslampa IP44|Belysning|Utomhus|Ljusgården Import AB|124|219|68|summer|6.5|28|8|Ljusgården|st
BE-20304|Ljuskedja 20 m, 100 LED|Belysning|Säsong|Ljusgården Import AB|72|139|210|q4|2.4|28|12|Ljusgården|st
ST-20401|Mikrofiberduk 10-pack|Städning|Dukar|Städproffs Norden AB|38|69|310|steady|3.2|14|30|Städproffs|pack
ST-20402|Fönsterskrapa 35 cm|Städning|Fönster|Städproffs Norden AB|52|99|86|summer|3.0|14|12|Städproffs|st
ST-20403|Golvmopp med teleskopskaft|Städning|Moppar|Städproffs Norden AB|94|169|124|steady|2.2|21|12|Städproffs|st
ST-20404|Universalrengöring 1 L|Städning|Rengöring|Städproffs Norden AB|28|55|480|steady|2.0|21|24|Städproffs|st
ST-20405|Kompostpåse 10 L, 25-pack|Städning|Påsar|Städproffs Norden AB|36|69|168|steady|3.8|21|24|Städproffs|pack
FY-20501|Ergonomiskt roller-set 25 cm|Färg|Roller|Färg & Yta AB|68|129|156|summer|2.2|21|12|Yta|set
FY-20502|Penselset 5 delar|Färg|Penslar|Färg & Yta AB|56|109|184|summer|2.5|21|12|Yta|set
FY-20503|Maskeringstejp 50 mm, 50 m|Färg|Tejp|Färg & Yta AB|24|49|520|summer|2.2|21|36|Yta|st
FY-20504|Spackel 5 kg|Färg|Spackel|Färg & Yta AB|78|139|128|steady|2.8|21|12|Yta|st
FY-20505|Grundfärg 5 L|Färg|Färg|Färg & Yta AB|196|329|42|summer|3.0|28|4|Yta|st
SE-20601|Julgransbelysning 100 LED|Säsong|Jul|Ljusgården Import AB|48|99|260|q4|1.2|28|12|Ljusgården|st
SE-20602|Adventsstake 7 ljus|Säsong|Jul|Ljusgården Import AB|86|159|148|q4|1.8|28|8|Ljusgården|st
SE-20603|Utomhusgran 180 cm|Säsong|Jul|Ljusgården Import AB|286|499|36|q4|7.0|35|4|Ljusgården|st
SE-20604|Sommardyna 50×50 cm|Säsong|Sommar|Ljusgården Import AB|112|199|88|summer|0.4|28|8|Ljusgården|st
HW-20701|Alkaliska AA-batterier 8-pack|Järnhandel|Batterier|Hemma & Trädgård Norden AB|36|69|540|q4|0.4|21|36|Ordna|pack
HW-20702|Dörrhake rostfri 75 mm|Järnhandel|Beslag|Hemma & Trädgård Norden AB|28|55|142|steady|3.4|14|25|Ordna|st
HW-20703|Möbeltassar 20-pack|Järnhandel|Skydd|Hemma & Trädgård Norden AB|18|39|220|steady|4.0|14|40|Ordna|pack
HW-20704|Cykellås 90 cm|Järnhandel|Lås|Hemma & Trädgård Norden AB|168|299|54|summer|1.0|28|6|Ordna|st
UT-20801|Fällbar trädgårdsstol|Utemöbler|Stolar|Hemma & Trädgård Norden AB|286|499|44|summer|7.5|35|4|Grönskande|st
UT-20802|Grillöverdrag 145 cm|Utemöbler|Grill|Hemma & Trädgård Norden AB|96|179|58|summer|2.8|28|6|Grönskande|st
UT-20803|Picknickfilt 140×170 cm|Utemöbler|Filtar|Hemma & Trädgård Norden AB|128|229|62|summer|2.2|28|8|Grönskande|st
UT-20804|Utomhusförlängningskabel 10 m IP44|Utemöbler|El|Hemma & Trädgård Norden AB|148|269|76|summer|1.6|28|6|Ljusgården|st
UT-20805|Vakuumflaska 500 ml|Utemöbler|Dryck|Hemma & Trädgård Norden AB|84|159|112|winter|2.4|28|12|Grönskande|st
ZZ-20901|Gammal trädgårdsfontän 60 cm|Utgående|Trädgård|Grönskande Trädgård AB|642|999|1|inactive|60|35|1|Grönskande|st
`,
  foodservice: `
FD-40001|Arabica kaffebönor 1 kg|Torrvaror|Kaffe|Kafferosteriet Almnäs AB|148|219|360|steady|0.4|14|12|Almnäs|påse
FD-40002|Tomatpassata 500 g, 12-pack|Torrvaror|Konserver|Solsidan Livsmedel AB|168|249|82|summer|8.5|18|6|Solsidan|pack
FD-40003|Havredryck Barista 1 L, 6-pack|Torrvaror|Dryck|Mejeri Dalby AB|78|119|210|growth|1.5|10|8|Dalby|pack
FD-40004|Olivolja Extra Virgin 1 L|Torrvaror|Olja|Olivgården Import AB|84|139|124|steady|2.2|28|6|Olivgården|flaska
FD-40005|Basmatiris 5 kg|Torrvaror|Ris|Solsidan Livsmedel AB|112|169|96|steady|2.4|21|4|Solsidan|säck
FD-40006|Vetemjöl 10 kg|Torrvaror|Bageri|Solsidan Livsmedel AB|96|149|88|steady|3.0|21|4|Solsidan|säck
FD-40007|Strösocker 5 kg|Torrvaror|Bageri|Solsidan Livsmedel AB|58|89|72|steady|2.8|21|4|Solsidan|säck
FD-40008|Penne 5 kg|Torrvaror|Pasta|Solsidan Livsmedel AB|118|179|102|steady|2.2|21|4|Solsidan|säck
FD-40009|Krossade tomater 2,5 kg, 6-pack|Torrvaror|Konserver|Solsidan Livsmedel AB|186|279|64|winter|7.0|18|4|Solsidan|pack
FD-40101|Apelsinjuice 1 L, 8-pack|Dryck|Juice|Solsidan Livsmedel AB|96|149|148|winter|1.4|10|6|Solsidan|pack
FD-40102|Kolsyrat vatten 33 cl, 24-pack|Dryck|Vatten|Solsidan Livsmedel AB|78|129|186|summer|0.8|14|6|Solsidan|pack
FD-40103|Äppelmust 1 L, 6-pack|Dryck|Must|Solsidan Livsmedel AB|108|169|92|q4|1.6|14|6|Solsidan|pack
FD-40104|Kaffeautomat, bönmodell|Dryck|Utrustning|Kafferosteriet Almnäs AB|5480|7900|3|inactive|1.0|35|1|Almnäs|st
FD-40201|Fryst kycklingfilé 2,5 kg|Fryst|Kyckling|Nordhav Frys AB|218|309|126|steady|1.0|12|6|Nordhav|påse
FD-40202|Fryst laxfilé 1 kg|Fryst|Fisk|Nordhav Frys AB|164|249|98|steady|0.8|12|6|Nordhav|påse
FD-40203|Pommes frites 2,5 kg|Fryst|Potatis|Nordhav Frys AB|58|99|194|steady|1.6|12|8|Nordhav|påse
FD-40204|Frysta blåbär 1 kg|Fryst|Bär|Nordhav Frys AB|72|119|86|volatile|1.2|12|8|Nordhav|påse
FD-40205|Vaniljglass 5 L|Fryst|Glass|Mejeri Dalby AB|128|199|132|summer|0.7|10|4|Dalby|st
FD-40301|Matlagningsgrädde 1 L, 6-pack|Mejeri|Grädde|Mejeri Dalby AB|112|169|146|winter|1.0|7|6|Dalby|pack
FD-40302|Smör 5 kg|Mejeri|Smör|Mejeri Dalby AB|486|649|44|winter|1.4|7|2|Dalby|st
FD-40303|Lagrad ost 5 kg|Mejeri|Ost|Mejeri Dalby AB|612|849|32|steady|1.2|10|2|Dalby|st
FD-40304|Naturell yoghurt 5 kg|Mejeri|Yoghurt|Mejeri Dalby AB|118|179|96|steady|5.0|7|4|Dalby|st
FD-40401|Matslåda 750 ml, 500-pack|Förpackning|Livsmedel|Förpackningshuset AB|286|399|78|steady|2.0|18|4|Förpacka|pack
FD-40402|Kraftpåse stor, 250-pack|Förpackning|Påsar|Förpackningshuset AB|168|249|64|steady|7.0|18|4|Förpacka|pack
FD-40403|Pappersservett 500-pack|Förpackning|Servetter|Förpackningshuset AB|54|89|246|steady|2.0|18|12|Förpacka|pack
FD-40404|Plastfolie 45 cm, 300 m|Förpackning|Folie|Förpackningshuset AB|96|149|72|steady|2.6|18|6|Förpacka|rulle
FD-40405|Aluminiumfolie 45 cm, 300 m|Förpackning|Folie|Förpackningshuset AB|104|159|58|steady|2.4|18|6|Förpacka|rulle
FD-40501|Nitrilhandskar M, 100-pack|Engångsmaterial|Handskar|Hygien & Servering AB|68|109|320|steady|0.3|14|12|Hygien|pack
FD-40502|Pappersmugg 200 ml, 100-pack|Engångsmaterial|Dryck|Hygien & Servering AB|42|75|280|steady|2.0|14|12|Hygien|pack
FD-40503|Träbestick 3-i-1, 500-pack|Engångsmaterial|Bestick|Hygien & Servering AB|96|149|112|steady|2.2|14|6|Hygien|pack
FD-40601|Maskindiskmedel 5 L|Rengöring|Disk|Hygien & Servering AB|148|229|84|steady|1.8|14|4|Hygien|dunk
FD-40602|Handdesinfektion 5 L|Rengöring|Hygien|Hygien & Servering AB|188|279|62|steady|6.0|14|4|Hygien|dunk
FD-40603|Golvrengöring 5 L|Rengöring|Städ|Hygien & Servering AB|132|209|58|steady|2.6|14|4|Hygien|dunk
FD-40701|Gastronormbricka 1/1 rostfri|Restaurangutrustning|Brickor|Solsidan Livsmedel AB|286|429|24|steady|2.0|28|4|Solsidan|st
FD-40702|Skärbräda HACCP 50×30|Restaurangutrustning|Skärbrädor|Solsidan Livsmedel AB|248|389|18|dead|4.0|28|4|Solsidan|st
FD-40703|Kockkniv 21 cm|Restaurangutrustning|Knivar|Solsidan Livsmedel AB|342|529|22|steady|1.8|28|4|Solsidan|st
FD-40704|Vakuumpåsar 20×30, 100-pack|Restaurangutrustning|Förvaring|Förpackningshuset AB|86|139|76|steady|2.0|18|6|Förpacka|pack
`,
  ecommerce: `
CL-50001|Merinoulltröja herr|Kläder|Tröjor|Atelier Nord AB|428|899|92|decline|2.2|35|6|Atelier|st
CL-50002|Löparjacka dam|Kläder|Jackor|Löparlabbet AB|386|799|118|summer|1.6|35|6|Löparlabbet|st
CL-50003|Vinterjacka med huva|Kläder|Jackor|Atelier Nord AB|824|1699|64|winter|2.0|45|4|Atelier|st
CL-50004|Oversized hoodie i bomull|Kläder|Hoodies|Atelier Nord AB|286|599|186|q4|2.4|35|8|Atelier|st
CL-50005|T-shirt i ekologisk bomull|Kläder|T-shirts|Atelier Nord AB|96|249|420|summer|0.6|28|12|Atelier|st
CL-50006|Kompressionsstrumpor löpning 3-pack|Kläder|Strumpor|Löparlabbet AB|118|249|284|summer|1.8|28|10|Löparlabbet|pack
CL-50007|Träningstights dam|Kläder|Tights|Löparlabbet AB|246|499|168|winter|1.4|35|6|Löparlabbet|st
CL-50008|Keps i tvättad bomull|Kläder|Kepsar|Atelier Nord AB|86|199|224|summer|9.0|28|12|Atelier|st
AC-50101|Lättviktsryggsäck 22 L|Accessoarer|Ryggsäckar|Friluftsliv AB|348|699|104|summer|1.8|35|4|Friluft|st
AC-50102|Bältesväska i återvunnen nylon|Accessoarer|Väskor|Atelier Nord AB|168|349|142|steady|2.2|28|8|Atelier|st
AC-50103|Ullhalsduk i ribbstick|Accessoarer|Scarfs|Atelier Nord AB|148|299|88|winter|8.0|35|6|Atelier|st
AC-50104|Vinterhandskar med touch|Accessoarer|Handskar|Atelier Nord AB|128|249|116|winter|1.6|35|6|Atelier|par
AC-50105|Stickad mössa|Accessoarer|Mössor|Atelier Nord AB|86|179|164|winter|2.2|28|10|Atelier|st
AC-50106|Solglasögon polariserade|Accessoarer|Glasögon|Friluftsliv AB|186|379|96|summer|0.6|28|6|Friluft|st
EL-50201|Trådlösa hörlurar over-ear|Elektronik|Ljud|Ljud & Bild Norden AB|648|1299|76|q4|1.4|35|4|Ljud&Co|st
EL-50202|USB-C laddkabel 2 m|Elektronik|Kablar|Ljud & Bild Norden AB|48|129|520|steady|0.5|21|20|Ljud&Co|st
EL-50203|Powerbank 20 000 mAh|Elektronik|Laddning|Ljud & Bild Norden AB|286|599|118|summer|1.8|35|6|Ljud&Co|st
EL-50204|Bärbar högtalare IPX7|Elektronik|Ljud|Ljud & Bild Norden AB|386|799|84|volatile|1.2|35|4|Ljud&Co|st
EL-50205|Telefonställ i aluminium|Elektronik|Tillbehör|Ljud & Bild Norden AB|62|149|186|steady|6.5|21|12|Ljud&Co|st
EL-50206|Armband till smartklocka 22 mm|Elektronik|Tillbehör|Ljud & Bild Norden AB|78|179|132|steady|3.0|28|10|Ljud&Co|st
HM-50301|Rostfri vattenflaska 750 ml|Hem|Dryck|Vardagsrum Design AB|96|219|238|summer|0.5|28|10|Vardag|st
HM-50302|Ljusstake i keramik|Hem|Inredning|Vardagsrum Design AB|74|169|124|winter|2.6|28|8|Vardag|st
HM-50303|Ullpläd 130×170|Hem|Textil|Vardagsrum Design AB|318|649|58|winter|7.0|35|4|Vardag|st
HM-50304|Förvaringskorg i rotting|Hem|Förvaring|Vardagsrum Design AB|186|379|72|summer|2.4|35|6|Vardag|st
HM-50305|Skrivbordslampa i metall|Hem|Belysning|Vardagsrum Design AB|168|349|94|q4|2.0|35|6|Vardag|st
PC-50401|Ansiktskräm med hyaluron|Personvård|Hudvård|Hudvård Nord AB|112|249|196|winter|1.2|28|10|Nordan|st
PC-50402|Schampokaka oparfymerad|Personvård|Hårvård|Hudvård Nord AB|48|109|284|steady|2.0|28|12|Nordan|st
PC-50403|Tandborsthuvuden, 4-pack|Personvård|Munvård|Hudvård Nord AB|96|199|148|steady|2.2|35|8|Nordan|pack
PC-50404|Handkräm shea 75 ml|Personvård|Hudvård|Hudvård Nord AB|38|89|320|winter|1.5|28|12|Nordan|st
SP-50501|Yogamatta 6 mm|Sport|Yoga|Friluftsliv AB|168|349|108|steady|1.8|35|6|Friluft|st
SP-50502|Motståndsband 3-pack|Sport|Träning|Friluftsliv AB|62|149|214|steady|2.2|28|12|Friluft|pack
SP-50503|Hantlar 2×5 kg|Sport|Styrka|Friluftsliv AB|248|499|48|volatile|1.8|35|4|Friluft|par
SP-50504|Löparbälte med flaskhållare|Sport|Löpning|Löparlabbet AB|118|249|96|summer|1.4|28|8|Löparlabbet|st
SP-50505|Badshorts snabbtorkande|Sport|Simning|Löparlabbet AB|148|299|164|summer|0.5|28|10|Löparlabbet|st
SP-50506|Regnjacka packbar|Sport|Friluft|Friluftsliv AB|386|799|82|winter|1.0|35|6|Friluft|st
SP-50507|Sommarsandaler|Sport|Skor|Löparlabbet AB|168|349|136|summer|2.0|35|6|Löparlabbet|par
ZZ-50601|Utgången vintermössa 2024|Utgående|Accessoarer|Atelier Nord AB|68|149|1|inactive|30|28|10|Atelier|st
`,
};

function foodStorage(category: string, subcategory: string): { days: number; storage: string } {
  switch (category) {
    case "Torrvaror":
      return { days: 365, storage: "Torrt, 15–25 °C" };
    case "Dryck":
      return subcategory === "Utrustning"
        ? { days: 3650, storage: "Torrt, rumstemperatur" }
        : { days: 180, storage: "Torrt eller kyld 2–8 °C" };
    case "Fryst":
      return { days: 365, storage: "Fryst, -18 °C eller kallare" };
    case "Mejeri":
      return subcategory === "Smör"
        ? { days: 90, storage: "Kyld 2–8 °C" }
        : subcategory === "Ost"
          ? { days: 120, storage: "Kyld 2–8 °C" }
          : { days: 21, storage: "Kyld 2–4 °C" };
    case "Förpackning":
    case "Engångsmaterial":
    case "Rengöring":
      return { days: 730, storage: "Torrt, rumstemperatur" };
    case "Restaurangutrustning":
      return { days: 1825, storage: "Torrt, rumstemperatur" };
    default:
      return { days: 365, storage: "Torrt, rumstemperatur" };
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseProducts(raw: string): DemoProduct[] {
  const products: DemoProduct[] = [];
  const seen = new Set<string>();
  for (const line of raw.trim().split("\n")) {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 14) throw new Error(`Invalid demo row (${parts.length} fields): ${line}`);
    const [sku, name, category, subcategory, supplier, cost, price, demand, pattern, coverage, lead, moq, brand, unit] = parts;
    if (seen.has(sku!)) throw new Error(`Duplicate demo SKU: ${sku}`);
    seen.add(sku!);
    const parsed: DemoProduct = {
      sku: sku!,
      name: name!,
      category: category!,
      subcategory: subcategory!,
      supplier: supplier!,
      cost: Number(cost),
      price: Number(price),
      demand: Number(demand),
      pattern: pattern as DemandPattern,
      coverage: Number(coverage),
      leadTimeDays: Number(lead),
      moq: Number(moq),
      brand: brand!,
      unit: unit!,
    };
    if (
      !parsed.sku ||
      !parsed.name ||
      parsed.cost <= 0 ||
      parsed.price <= 0 ||
      parsed.price <= parsed.cost ||
      parsed.leadTimeDays <= 0 ||
      parsed.coverage < 0
    ) {
      throw new Error(`Invalid demo product: ${line}`);
    }
    products.push(parsed);
  }
  return products;
}

function demandFactor(pattern: DemandPattern, index: number, total: number, rand: () => number): number {
  const phase = (index % 12) / 12;
  const wave = (peak: number, amplitude: number) =>
    1 + amplitude * Math.cos((phase - peak / 12) * Math.PI * 2);
  const noise = 0.88 + rand() * 0.24;
  switch (pattern) {
    case "growth":
      return (0.72 + (index / Math.max(1, total - 1)) * 0.62) * noise;
    case "decline":
      return (1.32 - (index / Math.max(1, total - 1)) * 0.72) * noise;
    case "volatile":
      return (0.2 + rand() * 1.8) * noise;
    case "summer":
      return wave(7, 0.85) * noise;
    case "winter":
      return wave(1, 0.75) * noise;
    case "q4":
      return wave(10, 0.95) * noise;
    case "dead":
      return index < 2 ? noise : 0;
    case "discontinued":
      return index < 4 ? noise : 0;
    case "new":
      return index >= total - 5 ? noise : 0;
    case "inactive":
      return 0;
    default:
      return noise;
  }
}

function monthlyHistory(product: DemoProduct, months: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const history: number[] = [];
  for (let i = 0; i < months; i++) {
    const qty = Math.round(product.demand * demandFactor(product.pattern, i, months, rand));
    history.push(Math.max(0, qty));
  }
  return history;
}

function buildEnvironment(id: DemoEnvironmentId): DemoDataset {
  const meta = ENVIRONMENTS[id];
  const products = parseProducts(RAW[id]);
  const items: ItemInput[] = products.map((product, index) => {
    const monthly = monthlyHistory(product, meta.months, 7919 + index * 104729 + id.length * 31);
    // Ordinary replenishment stock is intentionally lean. Overstock and dead
    // stock use the explicit high coverage values in the catalog.
    let coverage = product.coverage;
    if (coverage >= 0.9 && coverage < 5) {
      // Healthy replenishment stock covers the supplier lead time with a small
      // buffer, but not more than the overstock review window.
      coverage = Math.max(coverage * 0.65, (product.leadTimeDays * 1.35) / 30.44);
      coverage = Math.min(coverage, (product.leadTimeDays + 18) / 30.44);
    }
    const stock = Math.max(0, Math.round(product.demand * coverage));
    // A share of the physical stock is allocated to open customer orders in
    // every environment, so available stock differs from the warehouse balance.
    const reserved = index % 3 === 0 ? Math.min(stock, Math.round(stock * (0.04 + (index % 5) * 0.02))) : 0;
    const totalSold = monthly.reduce((sum, value) => sum + value, 0);
    const perishable = id === "foodservice" ? foodStorage(product.category, product.subcategory) : null;
    return {
      sku: product.sku,
      name: product.name,
      category: product.category,
      subcategory: product.subcategory,
      brand: product.brand,
      unit: product.unit,
      shelfLifeDays: perishable?.days ?? null,
      storage: perishable?.storage ?? null,
      supplier: product.supplier,
      stock,
      reserved,
      cost: product.cost,
      price: product.price,
      leadTimeDays: product.leadTimeDays,
      moq: product.moq,
      monthly,
      totalSold,
      totalRevenue: totalSold * product.price,
    };
  });

  return {
    environment: meta,
    company: meta.company,
    orgNumber: meta.orgNumber,
    months: meta.months,
    items,
  };
}

export const DEMO_ENVIRONMENTS: DemoEnvironmentMeta[] = Object.values(ENVIRONMENTS);

export const DEFAULT_DEMO_ENVIRONMENT: DemoEnvironmentId = "industri";

export function isDemoEnvironment(value: string | null | undefined): value is DemoEnvironmentId {
  return value === "industri" || value === "hem" || value === "foodservice" || value === "ecommerce";
}

export function getDemoEnvironmentMeta(id: DemoEnvironmentId): DemoEnvironmentMeta {
  return ENVIRONMENTS[id];
}

export function buildDemoDataset(id: DemoEnvironmentId = DEFAULT_DEMO_ENVIRONMENT): DemoDataset {
  return buildEnvironment(id);
}

/** Renders the environment as a CSV that looks like a real ERP/POS export. */
export function demoCsv(dataset: DemoDataset): string {
  const now = new Date();
  const labels: string[] = [];
  for (let i = dataset.months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const header = [
    "Artikelnummer",
    "Benämning",
    "Kategori",
    "Underkategori",
    "Varumärke",
    "Enhet",
    "Hållbarhet dagar",
    "Förvaring",
    "Leverantör",
    "Lagersaldo",
    "Reserverat",
    "Inköpspris",
    "Försäljningspris",
    "Ledtid dagar",
    "MOQ",
    ...labels,
  ];

  const lines = [header.join(";")];
  for (const item of dataset.items) {
    const row = [
      item.sku,
      quote(item.name),
      quote(item.category ?? ""),
      quote(item.subcategory ?? ""),
      quote(item.brand ?? ""),
      quote(item.unit ?? ""),
      item.shelfLifeDays === null ? "" : String(item.shelfLifeDays),
      quote(item.storage ?? ""),
      quote(item.supplier ?? ""),
      String(item.stock),
      String(item.reserved ?? 0),
      decimal(item.cost),
      decimal(item.price ?? 0),
      String(item.leadTimeDays ?? ""),
      String(item.moq ?? ""),
      ...(item.monthly ?? []).map((v) => String(v)),
    ];
    lines.push(row.join(";"));
  }
  return lines.join("\r\n") + "\r\n";
}

function quote(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function decimal(value: number): string {
  return value.toFixed(2).replace(".", ",");
}
