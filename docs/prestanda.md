# Prestanda — baslinje

Mätt 2026-11-24, innan någon optimering gjorts. Syftet är att ha en siffra att
jämföra mot, så att en framtida ändring kan sägas göra nytta eller inte.

## Metod

| Del | Värde |
|---|---|
| Test | `e2e/perf.spec.ts` (Playwright, Chromium headless) |
| Kommando | `bunx playwright test e2e/perf.spec.ts` |
| Server | projektets egen server på `http://127.0.0.1:3199`, databas i `data/e2e` |
| Vy | 1280 × 720 (Playwright-projektets `devices["Desktop Chrome"]`) |
| Mätning | `PerformanceObserver` i sidan: `largest-contentful-paint` och `layout-shift` utan nylig inmatning |
| Väntetid | sidan får stå still 1,5 s efter `load` så att sena skiften räknas |
| Rådata | `reports/e2e/web-vitals.json`, frametider i `reports/e2e/perf.json` |

Mätningen är en laboratoriemätning på en lokal server utan nätverksfördröjning.
Den säger alltså inget om verkliga användares nätverk, men den är jämförbar med
sig själv mellan körningar, vilket är det som behövs för att avgöra om en ändring
hjälper.

## Baslinje

| Sida | LCP | CLS | Tolkning |
|---|---|---|---|
| `/` | 212 ms | 0 | LCP långt under 2,5 s (Googles gräns för "bra"), inga layoutskiften |
| `/produkt` | 960 ms | 0 | LCP under gränsen, inga layoutskiften |

Båda sidorna ligger redan inom "bra" för både LCP och CLS. **Slutsats: det finns
ingen prestandaproblem att åtgärda i dag, och ingen optimering är gjord.** Att
banta bilder, skjuta upp skript eller bygga om hero-sektionen nu skulle vara
gissningsarbete utan mätbart mål.

## 3D-scenen (sekundär mätning)

Samma test mäter frametid i scen 2 och 3 på startsidan, med och utan 4×
CPU-throttling (120 rAF-delta efter uppvärmning, medelvärde och p95):

| Mätning | Medel | p95 |
|---|---|---|
| Scen 2 | 31,5 ms | 33,4 ms |
| Scen 3 | 30,8 ms | 33,4 ms |
| Scen 2, 4× CPU | 33,5 ms | 50,0 ms |
| Scen 3, 4× CPU | 33,5 ms | 49,9 ms |

Det är ~30 fps i headless Chromium med mjukvarurenderare (SwiftShader), vilket
är förväntat utan GPU. Siffran är en golv-nivå för regressionskontroll, inte ett
mått på upplevd flyt på en riktig dator.

## Så mäts det om

```bash
cd STOQWISE
bunx playwright test e2e/perf.spec.ts
cat reports/e2e/web-vitals.json
```

Testet kräver inga tröskelvärden: det mäter och skriver, och fallerar bara om LCP
är 0 (det vill säga om mätningen inte fungerade). Nästa steg, om en ändring ska
bedömas, är att köra samma test före och efter och jämföra tabellen ovan — inte
att lägga till hårdare gränser i förväg.
