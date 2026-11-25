# Kunskapsgrund, metoder och datarealitet

Detta dokument är STOQWISE:s redovisade kunskapsgrund. Det ska läsas innan en
beräkning, prognos, simulering eller ett demo-/testdataset ändras. Syftet är att
göra det möjligt att granska varje siffra: vilken metod den kommer från, vilka
antaganden den vilar på och vilka källor som faktiskt är verifierade.

## 1. Primär logistisk referens

**Oskarsson, B., Aronsson, H. & Ekdahl, B. (2021).** *Modern logistik – för ökad
lönsamhet.* 5 uppl. Liber. ISBN 978-91-47-14421-1.
Projektets OCR-kopia omfattar kapitel 1–14 och används som primär referens för
logistiksystem, lagerfunktioner, ledtidsanalys, lagerstyrning, servicemätning och
logistikkostnader.

Viktiga avsnitt för koden:

| Område | Referens i boken | Används för |
|---|---|---|
| Lagerfunktioner och lagerorsaker | kap. 3, s. 93–130 | begrepp, säkerhetslager, omsättningslager |
| Lageromsättning och kapitalbindning | kap. 9, s. 227–262 | lagerhälsa, dagar i lager |
| Beställningspunkt | kap. 11.2, s. 279–280 | `reorderPoint` |
| Wilsonformeln / EOQ | kap. 11.2, s. 276–278 | `economicOrderQuantity` |
| Säkerhetslager SERV1 | kap. 11.6, s. 290–295 | `safetyStock`, `sigmaDemandDuringLeadTime` |
| Säkerhetslager SERV2 | kap. 11.6, s. 295–297 | dokumenterad utbyggnadspunkt |
| Differentierad styrning | kap. 12, s. 303–316 | ABC/XYZ och artikelåtgärder |

OCR-texten kan innehålla teckenfel. Vid extern publicering ska sidhänvisningar
kontrolleras mot tryckt upplaga. Numeriska exempel som används i tester är
kontrollerade mot den OCR-text som finns i projektet.

## 2. Kompletterande och verifierade källor

Dessa används för metoder som går utöver eller preciserar boken. De är inte
dekorativa referenser: varje rad har en konkret användning i koden eller i
kvalitetsreglerna.

| Källa | Varför den används |
|---|---|
| Silver, E. A., Pyke, D. F. & Thomas, D. J. (2016). *Inventory and Production Management in Supply Chains*, 4th ed. CRC Press. DOI [10.1201/9781315374406](https://doi.org/10.1201/9781315374406). | Oberoende referens för lagerstyrning, säkerhetslager och orderkvantiteter. |
| Axsäter, S. (2015). *Inventory Control*, 3rd ed. Springer. DOI [10.1007/978-3-319-15729-0](https://doi.org/10.1007/978-3-319-15729-0). | Teoretisk referens för beställningspunkt, ledtid och flernivålager. |
| Hyndman, R. J. & Athanasopoulos, G. (2021). *Forecasting: Principles and Practice*, 3rd ed. OTexts. [otexts.com/fpp3](https://otexts.com/fpp3/). | Prognosmetoder, utvärdering och varsel om att modellval ska göras på utfall, inte tycke. |
| Croston, J. D. (1972). Forecasting and Stock Control for Intermittent Demands. *Journal of the Operational Research Society*, 23, 289–303. DOI [10.1057/jors.1972.50](https://doi.org/10.1057/jors.1972.50). | Glest förekommande efterfrågan; separata skattningar av storlek och intervall. |
| Syntetos, A. A. & Boylan, J. E. (2005). The accuracy of intermittent demand estimates. *International Journal of Forecasting*, 21(2), 303–314. DOI [10.1016/j.ijforecast.2004.10.001](https://doi.org/10.1016/j.ijforecast.2004.10.001). | SBA-metoden och varför Croston behöver korrigeras. |
| ASCM. *SCOR Digital Standard (SCOR DS)*, version 14.0, 2025. [ascm.org/corporate-solutions/standards-tools/scor-ds](https://www.ascm.org/corporate-solutions/standards-tools/scor-ds). | Gemensam terminologi för leveransförmåga, perfekt order och lagerdagar. STOQWISE gör **inte** anspråk på SCOR-certifiering. |
| GS1. *GS1 General Specifications*, release 26.0, januari 2026. [gs1.org/standards/barcodes-epcrfid-id-keys/gs1-general-specifications](https://www.gs1.org/standards/barcodes-epcrfid-id-keys/gs1-general-specifications). | Referens för artikel- och platsidentifierare. STOQWISE använder kundens SKU; det är inte automatiskt en GTIN. |

Källor som inte kan verifieras ska inte citeras. En källa får inte tillskrivas
ett påstående som inte uttryckligen står i den.

## 3. Metoder i koden

### EOQ / Wilsonformeln

```text
Q* = sqrt(2 × K × D / (r × p))
```

- `K` = ordersärkostnad per order
- `D` = årsbehov
- `r` = lagerhållningsränta
- `p` = artikelvärde per enhet

Kod: `economicOrderQuantity()` i `src/core/forecast.ts`. Testet återger bokens
Flexilek-exempel: `D=1000`, `K=400`, `r=0,25`, `p=55` ger `241,2 → 241 st.`
(`tests/forecast.test.ts`).

Antaganden som måste vara synliga för kunden: jämn känd efterfrågan, inga
kvantitetsrabatter, ingen kapacitetsbegränsning och en ordersärkostnad som är
oberoende av kvantiteten. STOQWISE använder för närvarande `K = 350 kr` och
`r = 22 %` som projektdefault; dessa är **inte** universella sanningar och ska
ersättas med kundens verkliga kostnader när de finns.

### Beställningspunkt

```text
BP = SL + D_LT − n × Q
```

Kod: `reorderPoint = demandDuringLeadTime + safetyStock`. Modellen antar högst
en uteliggande order (`n = 0`). Om flera order är öppna samtidigt måste
`n × Q` dras av; det kräver öppna orderrader i indata och är en dokumenterad
utbyggnadspunkt, inte något som döljs i beräkningen.

### Säkerhetslager enligt SERV1

```text
SL = k × sqrt((σ_d)^2 × LT + (σ_LT)^2 × D^2)
```

Där `σ_d` är standardavvikelsen i efterfrågan per tidsenhet, `LT` ledtid i samma
tidsenhet, `σ_LT` ledtidens standardavvikelse och `D` efterfrågan per tidsenhet.
Kod: `sigmaDemandDuringLeadTime()` och `supplyPlan()`.

- Om prognos används ska `σ` vara standardavvikelsen i **prognosfelet**, inte
  spridningen i historiska utfall. `forecastSeries()` beräknar därför
  ett-stegsprognosfel: varje prediktion görs innan utfallet observeras.
- Om ingen prognos används kan historisk efterfrågevariation användas. Det är
  vad `analysis.ts` gör, och det redovisas som en förenkling.
- Ledtidsosäkerhet är valfri via `leadTimeSigmaDays` på artikeln eller i
  `supplyPlan`-anropet. Saknas värdet används endast efterfrågeosäkerhet; planen
  flaggar `leadTimeVariabilityIncluded = false`.
- Servicenivån räknas om till en z-faktor med en invers normalfördelning, så
  även 92 % eller 97 % får rätt faktor. Ingen tyst fallback till 95 %.

Testet återger bokens Flexilek-exempel: veckoefterfrågan 19,2 st., `σ_d=3,99`,
`LT=1 vecka`, `σ_LT=0,12 veckor`, SERV1=99 % ger `σ_DLT≈4,61` och
`SL≈10,7 → 11 st.` (`tests/forecast.test.ts`).

### SERV2

SERV2 (lagertillgänglighet, andel efterfrågan som levereras direkt) är
dokumenterad i boken men ännu inte ett separat val i gränssnittet. Nuvarande
`stockoutProbability` är en SERV1-liknande sannolikhet för brist under ledtid.
Att kalla den SERV2 vore fel. En framtida SERV2-beräkning ska använda
servicefunktionen `f(k)` och orderkvantiteten enligt boken s. 295–297.

### Prognoser

Modellval sker på backtest med WAPE, med MAE som tie-break. WAPE används för att
den inte exploderar på månader med nollförsäljning; MAPE redovisas endast när
alla utfall är nollskilda och annars som `null`. Glest förekommande efterfrågan
(`> 40 %` nollmånader) går till Croston/SBA i stället för exponential smoothing.
Detta följer Croston (1972), Syntetos & Boylan (2005) och den allmänna
principen i Hyndman & Athanasopoulos att modeller jämförs på utfall.

Osäkerhetsintervallet är `1,96 × σ × sqrt(horisont)`. Det är ett
normalfördelningsantagande och ska läsas som ett ungefärligt intervall, inte en
garanti. Extremvärden kapas endast för modellpassningen; historiken och
backtestens utfall visas oförändrade.

## 4. Parametrar som är antaganden, inte fakta

Dessa värden är konfigurerbara eller dokumenterade defaultvärden. De får inte
presenteras som branschsanning eller som kundens faktiska kostnader.

| Parameter | Default | Status |
|---|---:|---|
| Ordersärkostnad | 350 kr | projektantagande i `forecast.ts`; ska bli kundspecifik |
| Lagerhållningsränta | 22 % | projektantagande; kan skickas per anrop |
| Kapitalkostnad i analysen | 8 % | organisationsinställning |
| Servicenivå | 95 % | organisationsinställning; 90/95/98/99 i admin |
| Död lager-gräns | 180 dagar | organisationsinställning, inte en lag |
| Standardledtid | 30 dagar | endast när artikeln saknar ledtid |
| Prognoshorisont | 6 månader | UI-default |

## 5. Datarealitet

All test- och demodata ska vara märkt som syntetisk och uppfylla samma
integritetsregler som en riktig export:

1. Kvantiteter och lager är icke-negativa heltal i enheter som anges av
   artikelns `unit`.
2. Försäljningspris är högre än inköpspris där båda finns; annars flaggas
   datakvaliteten.
3. `reserved` är högst `stock`; tillgängligt lager är `stock − reserved`.
4. `totalSold` är summan av månadshistoriken, aldrig ett separat påhittat tal.
5. Alla härledda KPI:er (lageromsättning, dagar i lager, överlager, frigjort
   kapital) beräknas från lager, kostnad och historik. Demo-generatorn får inte
   skriva egna KPI-siffror.
6. Säsong ska följa en angiven efterfrågeprofil (sommar, vinter, Q4, avveckling,
   noll efterfrågan), inte slumpas fram per graf.
7. Glest förekommande och helt inaktiv efterfrågan ska bevaras som nollor. Att
   fylla ut dem med ett medelvärde skulle förstöra både Croston och
   dödlagersanalysen.
8. Alla syntetiska företag, artiklar, leverantörer och organisationsnummer ska
   vara tydligt fiktiva. De får inte förväxlas med verkliga kunder.
9. Deterministisk seed ska ge samma data vid samma indata, så att tester och
   rapporter kan reproduceras.
10. Varje demoartikel har en ledtidsstandardavvikelse på 16–25 % av den nominella
    ledtiden. Det gör att SERV1 kombinerar efterfråge- och ledtidsvariation i
    stället för att anta att varje leverans anländer exakt på dagen. Värdet är
    ett modellantagande om leverantörens variation, inte leverantörsdata.
11. Simulerade inköpsordrar är hela multiplar av artikelns MOQ. Köpförslag,
    artikelvy och simulering använder samma ekonomiska antaganden (350 kr per
    order och 22 % lagerhållningsränta); tidigare hade inköpsvyn 750 kr och 20 %,
    vilket gav olika EOQ för samma artikel beroende på sida.

`tests/data-realism.test.ts` verifierar dessa invarianter för alla fyra
demo-miljöer, inklusive att historiken är deterministisk och att livsmedel har
hållbarhet och förvaring.

## 6. Käll- och granskningsdisciplin

- Primär källa för logistikbegrepp: Oskarsson m.fl. (2021).
- Vetenskaplig metod: peer-reviewed artikel eller etablerad lärobok, med DOI.
- Standard: officiell standardsida och version, inte ett blogginlägg.
- Kundens data: enda källan för kundspecifika kostnader, ledtider och volymer.
- En siffra utan källa får inte kallas faktum. Den ska märkas som antagande,
  scenario eller syntetiskt testvärde.
- Vid tvekan: redovisa osäkerheten och utelämna slutsatsen. Hellre ett ärligt
  `null` än en påhittad precision.

## 7. Kvarstående gap

1. **Ledtidsosäkerhet i CSV.** Fältet finns i datamodellen och i beräkningen,
   men importerade CSV-filer har ännu ingen standardkolumn för `σ_LT`. Tills den
   finns används efterfrågeosäkerhet och planen flaggar detta.
2. **Flera uteliggande order.** Beställningspunkten justeras inte med `n × Q`.
   Det kräver öppna orderrader i indata.
3. **SERV2.** Beräknas inte som ett eget servicemått; nuvarande
   bristssannolikhet är SERV1-liknande.
4. **SCOR.** Terminologin är en referens, inte en certifiering eller full
   implementering av alla 300+ mätetal.
5. **GS1.** Kundens SKU är inte verifierad som GTIN. Ingen GS1-anslutning görs.
6. **Parametrar.** Ordersärkostnad och lagerränta är projektdefaultvärden tills
   kundspecifika värden kan sättas i organisationens inställningar.

## 8. Verifiering

```bash
bun run typecheck
bun test
```

Formeltesterna ligger i `tests/forecast.test.ts` och `tests/analysis.test.ts`;
datarealiseringstesterna i `tests/data-realism.test.ts`. En ändring av en formel
ska alltid åtföljas av ett test som återger ett känt exempel eller en känd
invariant.
