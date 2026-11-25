# Tredjepartslicenser och externa resurser

Detta dokument är STOQWISE:s centrala register över externa resurser. Det ska uppdateras när en dependency, font, modell, texture eller annan digital tillgång läggs till eller byts ut.

**Senast kontrollerad:** 2026-11-23  
**Kontrollmetod:** installerade paket i `node_modules/*/package.json`, låsta versioner i `bun.lock`, licensfiler i respektive paket samt `public/fonts/OFL-*.txt`.

## Princip

STOQWISE är en kommersiell SaaS-produkt. Endast resurser vars licens uttryckligen tillåter kommersiell användning, modifiering och distribution får ingå i den publika produkten. Resurser med okänd licens integreras inte. Copyleft-licenser (GPL, AGPL, SSPL) och licenser med kommersiella begränsningar kräver separat juridisk och teknisk granskning innan de används.

## A. Runtime-beroenden som ingår i produkten

| Resurs | Version | Officiell URL | Licens | Används till | Modifierad | Attribution |
|---|---:|---|---|---|---|---|
| three.js | 0.187.0 | https://github.com/mrdoob/three.js | MIT | 3D-Lagervärld, pallställ, kameror, instancing | Nej | Copyright © 2010–2026 three.js authors |
| pdfkit | 0.21.0 | https://github.com/foliojs/pdfkit | MIT | PDF-rapporter | Nej | Copyright (c) 2014 Devon Govett |

### Transitiva runtime-beroenden

`pdfkit` drar in följande paket. Alla är MIT enligt respektive installerat pakets `license`-fält. De levereras som del av serverberoendet och påverkar inte STOQWISE:s källkod.

| Paket | Version | Licens |
|---|---:|---|
| @noble/ciphers | 2.4.0 | MIT |
| @noble/hashes | 2.4.0 | MIT |
| base64-js | 1.5.1 | MIT |
| brotli | 2.1.0 | MIT |
| dfa | 2.0.0 | MIT |
| fflate | 0.8.3 | MIT |
| fontkit | 3.0.0 | MIT |
| linebreak | 2.0.0 | MIT |
| png-js | 3.0.0 | MIT |
| restructure | 3.0.2 | MIT |
| unicode-properties | 2.0.2 | MIT |
| unicode-trie | 3.0.0 | MIT |

### MIT-licensen

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## B. Teckensnitt och digitala tillgångar

| Resurs | Fil(er) | Licens | Används till | Modifierad | Attribution |
|---|---|---|---|---|---|
| Geist Sans | `public/fonts/geist-sans-*.woff2`, `.ttf` | SIL OFL 1.1 | Gränssnitt och PDF | Formatkonverterad till WOFF2; inga namnändringar | Copyright 2024/2026 The Geist Project Authors |
| Geist Mono | `public/fonts/geist-mono-*.woff2`, `.ttf` | SIL OFL 1.1 | Siffertabeller, kod, PDF | Formatkonverterad till WOFF2 | Copyright 2024 The Geist Project Authors |
| Newsreader Italic | `public/fonts/newsreader-400-italic.ttf` | SIL OFL 1.1 | Kursiv serif i PDF | Nej | Copyright 2020 The Newsreader Project Authors |

Licenstexterna finns i:

- `public/fonts/OFL-geist-sans.txt`
- `public/fonts/OFL-geist-mono.txt`
- `public/fonts/OFL-newsreader.txt`

OFL tillåter användning, modifiering och inbäddning i kommersiell programvara under förutsättning att copyright- och licensmeddelandet följer med, att fonten inte säljs separat och att Reserved Font Name inte används för modifierade versioner. STOQWISE distribuerar fontfilerna tillsammans med licenserna.

### 3D, ikoner och illustrationer

3D-miljön byggs proceduralt i `public/world/warehouse.js` med three.js. Det finns inga externa 3D-modeller, HDR-miljöer eller texturbilder i produkten. Ikoner är inline-SVG som är skapade för STOQWISE. Inga tredjepartsbilder eller illustrationspaket används.

## C. Utvecklingsverktyg – ingår inte i den publika produkten

| Resurs | Version | Licens | Används till | Distribution |
|---|---:|---|---|---|
| Bun | 1.4.5 | MIT | Serverruntime och testkörning | Körs av plattformen, buntas inte in |
| TypeScript | 5.9.3 | Apache-2.0 | Typkontroll | Endast utveckling |
| Playwright | 1.65.1 | Apache-2.0 | E2E- och prestandatester | Endast utveckling |
| Lighthouse | 13.6.0 | Apache-2.0 | Prestandamätning | Endast utveckling |
| @axe-core/playwright | 4.14.0 | MPL-2.0 | Tillgänglighetstester | Endast utveckling |
| @types/bun | 1.4.5 | MIT | Typer | Endast utveckling |
| @types/pdfkit | 0.13.9 | MIT | Typer | Endast utveckling |

MPL-2.0 är en filbaserad copyleft-licens. `@axe-core/playwright` används endast i testverktyg, buntas inte in i applikationen och påverkar därför inte STOQWISE:s egen kod eller SaaS-distribution. Detta är dokumenterat och godkänt för utvecklingsmiljön.

## D. Egen implementerad matematik och forskningsunderlag

Följande metoder är implementerade självständigt i TypeScript utan kopierad kod, text, figur eller tabell från någon publikation. De är inte tredjepartskod och omfattas av STOQWISE:s egen kodbas.

- Croston och SBA för intermittent efterfrågan.
- TSB för intermittent efterfrågan med sannolikhet och storlek separerade.
- ADIDA för aggregering av gles efterfrågan.
- SES, Holt och additiv Holt-Winters.
- EOQ, säkerhetslager, beställningspunkt och SERV1-formeln.

Vetenskaplig grund:

1. Croston, J. D. (1972). *Forecasting and Stock Control for Intermittent Demands*. Operational Research Quarterly, 23(3), 289–303.
2. Syntetos, A. A. & Boylan, J. E. (2005). *The accuracy of intermittent demand estimates*. International Journal of Forecasting, 21(2), 303–314.
3. Teunter, R. H., Syntetos, A. A. & Babai, M. Z. (2011). *Intermittent demand: Linking forecasting to inventory obsolescence*. European Journal of Operational Research, 214(3), 606–615.
4. Nikolopoulos, K. et al. (2011). *An aggregate–disaggregate intermittent demand approach (ADIDA) to forecasting: an empirical proposition and analysis*. Journal of the Operational Research Society, 62(3), 544–554.
5. Silver, E. A., Pyke, D. F. & Thomas, D. J. *Inventory and Production Management in Supply Chains*. EOQ, säkerhetslager och servicenivå.
6. Oskarsson, B., Aronsson, H. & Ekdahl, B. *Modern logistik*. Beställningspunkt, SERV1 och lagerhållningskostnad; används även i befintliga beräkningstester.

## E. Utvärderade men inte integrerade resurser

Dessa är kända och licensmässigt intressanta, men de passar inte den befintliga Bun/TypeScript-arkitekturen utan en separat tjänst eller en större omskrivning. De är därför inte integrerade.

| Resurs | Licens | Bedömning |
|---|---|---|
| StatsForecast | Apache-2.0 | Python. Skulle kräva separat beräkningstjänst, drift och dataöverföring. Croston/SBA/TSB/ADIDA är i stället implementerade lokalt. |
| Stockpyl | MIT | Python/Operations Research. Möjlig framtida tjänst för flerledsoptimering; inte motiverat för nuvarande enlagerberäkningar. |
| Google OR-Tools | Apache-2.0 | Kraftfullt för constrained optimization, men Python/CP-SAT kräver separat runtime. Nuvarande MOQ- och EOQ-logik är deterministisk och granskningsbar. |
| Darts | Apache-2.0 | Python och stora modellberoenden. Skulle duplicera befintlig prognosmotor och försvåra determinismen. |
| scikit-learn | BSD-3-Clause | Python. Ingen aktuell klassificerings- eller klustringsuppgift som motiverar en ny runtime. |
| LightGBM | MIT | Python/native. Kräver träningsdata, modellartefakter och MLOps; inte lämpligt utan ett tydligt prognoscase och dataägande. |
| Plotly.js | MIT | Skulle duplicera befintliga serverrenderade SVG-diagram och öka bundle-storleken väsentligt. Behålls som utvärderat alternativ. |
| Externa 3D-modeller och texturer | Varierar | Används inte. Endast resurser med uttrycklig kommersiell licens och rätt att modifiera får läggas till; källan ska då registreras här. |

## F. Ej använda fontfiler

Tidigare låg flera oanvända teckensnitt i `public/fonts`. De refererades inte av CSS, PDF eller HTML och exponerades därför onödigt via den publika fontvägen. De har flyttats till `assets/legacy-fonts/` och serveras inte längre. De får inte flyttas tillbaka eller användas förrän källa, exakt licens och kommersiella rättigheter är verifierade och dokumenterade här.

Berörda filer: Instrument Sans, Inter, JetBrains Mono, Manrope, Newsreader WOFF2/300/400 samt Schibsted Grotesk.

## G. Granskningschecklista vid ny resurs

1. Exakt version och källa.
2. Licens och fullständig licenstext.
3. Kommersiell användning, modifiering och distribution.
4. Attributionskrav och eventuella varumärkes-/RFN-krav.
5. Transitiva beroenden och separata tillgångar i paketet.
6. Om resursen buntas, serveras eller bara används i utveckling.
7. Dataskydd: ingen kunddata skickas till extern tjänst utan uttryckligt godkännande.
8. Registrering i denna fil och, där det är relevant, ett automatiskt test som kontrollerar att registret är uppdaterat.
