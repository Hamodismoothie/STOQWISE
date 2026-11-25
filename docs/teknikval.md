# Teknikval och öppna resurser

**Datum:** 2026-11-23  
**Omfattning:** inventering av befintlig stack, licensbedömning och första integrerade förbättring.  
**Licensregister:** [`THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md)

## Sammanfattning

STOQWISE är en ren Bun/TypeScript-tjänst med två runtime-beroenden: three.js för 3D och pdfkit för PDF. Beräkningarna är egna, deterministiska TypeScript-funktioner. Det gör att plattformen kan behålla tenant-isolering, förutsägbarhet och låg driftskostnad.

Den största tekniska vinsten den här omgången kommer inte från att lägga till fler bibliotek. Den kommer från att förbättra den egna prognosmotorn med två beprövade metoder för intermittent efterfrågan (TSB och ADIDA), ta bort läckage i modellvalets backtest och införa en grind som behåller SES när en mer komplex modell inte bevisar sig. Inga kunddata lämnar tjänsten.

## A. Befintliga resurser som behålls

| Resurs | Licens | Varför den behålls |
|---|---|---|
| three.js 0.187.0 | MIT | 3D-Lagervärlden är redan byggd kring three.js med instancing och låg draw-call-nivå. Den är rätt verktyg för interaktiv 3D och har en licens som passar kommersiell SaaS. |
| pdfkit 0.21.0 | MIT | Används för att generera rapporten. Ett byte skulle kräva ny layout, ny fontinbäddning och nya tester utan att förbättra kundvärdet. |
| Geist Sans/Mono | SIL OFL 1.1 | Används i gränssnitt och PDF. Licensfilerna finns i `public/fonts`. |
| Newsreader Italic | SIL OFL 1.1 | Används i PDF:ens kursiva serif. Licensfilen finns. |
| Egen SVG-diagrammotor | Egen kod | Serverrenderade diagram är lätta, tillgängliga och kräver ingen klient-JavaScript-bundle. |
| Egen prognos- och lager motor | Egen kod | Ger deterministiska resultat, spårbarhet och samma siffror i alla vyer. |
| Bun | MIT | Runtime. Används av plattformen och buntas inte in i applikationen. |

## B. Nya resurser som kan användas direkt

### TSB och ADIDA i prognosmotorn

Båda är självständiga implementationer av etablerade metoder, inte kopierad tredjepartskod. De kräver ingen ny dependency och ingen extern tjänst.

- **TSB** modellerar sannolikheten för efterfrågan separat från storleken och uppdaterar sannolikheten även under nollperioder. Det gör modellen känsligare för avtagande efterfrågan och dödlager än Croston/SBA.
- **ADIDA** aggregerar glesa perioder till tätare bucketar, prognostiserar bucketarna och delar tillbaka till ursprunglig period. Det är ett komplement när en serie har långa nollperioder.

Modellerna är kandidater endast för serier där mer än 40 % av perioderna är noll. Valet sker med samma backtest som övriga modeller; ingen modell väljs för att den är avancerad.

### Läckagefritt modellval

Tidigare utvärderades kandidater på ett holdout som låg inom det historikfönster som modellen redan hade sett. Det gav optimistiska WAPE-värden. Nu:

1. Kandidaten tränas på perioder före varje utfall.
2. Prognosen jämförs med utfallet i ett rullande ett-stegs-backtest.
3. Den slutliga modellen tränas om på hela historiken.
4. En champion-challenger-grind jämför kandidaten med SES på en fast tre-månadersholdout. SES behålls om kandidaten inte är bättre.

Grinden är viktig eftersom korta månadsserier är brusiga. En modell som vinner med en hårsmån på två månader är inte nödvändigtvis bättre än en enkel utjämning.

### Licensregister och automatiskt test

`THIRD_PARTY_LICENSES.md` är nu den centrala förteckningen. `tests/licenses.test.ts` kontrollerar att:

- alla runtime-beroenden har en tillåten licens och finns i registret,
- varje publikt teckensnitt har en OFL-fil,
- oanvända legacy-teckensnitt inte ligger i den publika fontvägen,
- forskningsreferenserna för prognosmetoderna finns dokumenterade.

## C. Kräver ytterligare utvärdering

| Resurs | Varför den inte integreras nu |
|---|---|
| StatsForecast | Apache-2.0 och stark för ARIMA/Croston/TSB, men Python. Skulle kräva separat beräkningstjänst, drift, versionering och dataöverföring. Den befintliga TypeScript-motorn täcker de metoder som används i produkten. |
| Stockpyl | MIT, men Python och inriktat på flerledsoptimering. Kan bli aktuellt om STOQWISE får ett uttalat behov av flerleds- eller networksoptimering. |
| Google OR-Tools | Apache-2.0. Rätt för kapacitets- och leverantörsbegränsad optimering, men en CP-SAT-tjänst är en ny runtime. Nuvarande EOQ/MOQ är enklare att granska och räcker för enlagerförslagen. |
| Darts | Apache-2.0, men stora modellberoenden och Python. Skulle duplicera prognosmotorn och göra determinismen svårare att verifiera. |
| scikit-learn | BSD-3-Clause. Ingen aktuell klassificerings- eller klustringsuppgift motiverar en ny runtime. |
| LightGBM | MIT. Kräver träningsdata, modellartefakter och MLOps. Inte aktuellt utan ett tydligt prognoscase och en dataägarprocess. |
| Plotly.js | MIT, men skulle duplicera den serverrenderade SVG-motorn och öka bundle-storleken. Utvärderas igen om behovet av interaktiva diagram blir större än vad SVG-lagret klarar. |
| Externa 3D-modeller/texturer | Endast resurser med uttrycklig kommersiell licens och rätt att modifiera. Ingen sådan har integrerats. |
| Oanvända teckensnitt | Flyttade till `assets/legacy-fonts/` och serveras inte. Kräver licensverifiering innan de får användas. |

## D. Ska inte användas

- Resurser med CC BY-NC eller andra icke-kommersiella villkor.
- Resurser utan angiven licens eller med oklar rättighetskedja.
- Modeller, texturer eller bilder från marknadsplatser där licensen inte uttryckligen täcker kommersiell webbdistribution och modifiering.
- GPL/AGPL/SSPL-komponenter i den distribuerade applikationen utan föregående juridisk och teknisk bedömning.
- Externa AI- eller prognostjänster som tar emot kunddata utan uttryckligt godkännande och avtal.

## Mätning

### Prognoskvalitet

Kommando: `bun run forecast:bench`

Benchmarken tränar på all historik utom de tre sista månaderna och jämför mot SES med optimerad alpha och mot naiv prognos. Den är medvetet svårare än motorns interna modellval.

Senaste mätning på de fyra demomiljöerna:

| Miljö | Artiklar | Motor | SES | Naiv |
|---|---:|---:|---:|---:|
| Industri | 44 | 33,9 % | 32,2 % | 33,4 % |
| Livsmedel | 41 | 31,6 % | 31,3 % | 31,7 % |
| Foodservice | 35 | 20,3 % | 20,3 % | 21,4 % |
| E-handel | 36 | 46,5 % | 46,0 % | 46,2 % |

Resultatet är ärligt negativt mot SES på den sammanvägda WAPE:n (cirka 34,3 % mot 33,7 %), och skillnaden är liten. Det betyder inte att koden är sämre: de korta, stabila demoserierna gynnar en enkel utjämning, och champion-challenger-grinden väljer därför SES i de flesta fall. TSB/ADIDA används bara när de faktiskt slår den på holdouten. Slutsatsen är att ingen aggregate accuracy-förbättring kan påstås för demoserierna; värdet ligger i att motorn nu hanterar intermittent efterfrågan korrekt, inte i att tvinga fram en komplex modell.

## Prestanda

Före ändringen, `bun run bench`:

- 5 000 artiklar: 12 ms
- 20 000 artiklar: 33 ms
- 50 000 artiklar: 81 ms

Efter ändringen, samma kommando och samma maskin:

- 5 000 artiklar: 11 ms
- 20 000 artiklar: 35 ms
- 50 000 artiklar: 83 ms

Skillnaderna ligger inom mätbruset. Prognosmotorns egna demokörning låg på 0,2–3,6 ms för 37–46 artiklar före och 2–3 ms efter. TSB/ADIDA läggs bara till för serier med hög nollandel och påverkar därför inte den breda analysen nämnvärt. Ingen prestandaregression har kunnat påvisas.

## Dataskydd och arkitektur

- Ingen ny extern nätverkstrafik, inga modell-API:er och ingen dataöverföring till tredje part.
- Externa beräkningsbibliotek är inte inkopplade i request-vägen.
- Tenant-isolering och befintliga databasfrågor är oförändrade.
- Alla nya beräkningar är deterministiska och kan reproduceras i test.
- Licensregistret och testerna är en del av repositoryt, inte en separat wiki.

## Nästa steg

1. Utvärdera en separat Python-tjänst endast om flerledsoptimering eller avancerade statistiska modeller blir ett konkret kundbehov.
2. Mät prognoskvalitet på riktiga kunders historik innan någon modell blir standard för en bransch.
3. Lägg till fler kontroller i licensgrinden när fler assets (3D, ikoner, ljud) införs.
