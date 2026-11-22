# Kostnadsmodell och prissättning

Alla siffror är antingen **mätta på din MacBook Air M4** (`bun run bench`) eller
**verifierade priser** från leverantörernas prissidor i november 2026. Inget är
påhittat, och inget är ett löfte om intäkter.

---

## 1. Vad en analys kostar att producera

Mätt med `bun run bench` på MacBook Air M4:

| Steg | 380 artiklar |
|---|---|
| Tolkning av CSV | 0,4 ms |
| Kolumnigenkänning | 0,6 ms |
| Validering och typning | 0,7 ms |
| Analys | 1,0 ms |
| Rapporttext (mall) | 0,3 ms |
| **Summa** | **3,0 ms** |
| PDF-generering | ~40 ms (8 sidor, 21 kB) |

Skalning:

| Artiklar | Tid |
|---|---|
| 5 000 | 11 ms |
| 20 000 | 37 ms |
| 50 000 | 87 ms |

**Slutsats:** beräkningskostnaden per analys är i praktiken noll. Även om du
körde 1 000 analyser i månaden skulle CPU-tiden vara under en minut. Det som
kostar är server, domän, betalningsavgifter – och din tid.

Lagring: **77 kB JSON per analys.** 100 kunder × 12 månader = 92 MB. En SQLite-fil
på under 100 MB behöver ingen databasplan.

---

## 2. Fasta kostnader

| Post | Månad | Per år | Källa |
|---|---|---|---|
| VPS Hetzner CX23 (2 vCPU / 4 GB / 40 GB) | 5,49 EUR + 0,50 EUR IPv4 ≈ **65 kr** | 780 kr | Hetzner prissida, nov 2026 |
| Domän `.se` | ~10 kr | ~120 kr | Registrator |
| E-post (transaktionellt, gratisnivå) | 0 kr | 0 kr | Leverantörens gratisnivå |
| Sentry (gratisnivå) | 0 kr | 0 kr | |
| healthchecks.io (gratisnivå) | 0 kr | 0 kr | |
| **Summa** | **~75 kr** | **~900 kr** | Exkl. moms |

Under utvecklingsfasen kör allt lokalt: **0 kr/mån**.

---

## 3. Rörliga kostnader per kund

| Post | Per månad | Not |
|---|---|---|
| AI (om aktiverad) | 25 kr | 2 M input + 0,3 M output på en liten modell ≈ 4 kr; räkna högt |
| Lagring och backup | 5 kr | 77 kB per analys |
| Beräkning | ~0 kr | 3 ms |
| Stripe på 2 490 kr | 39 kr | 1,5 % + 1,80 kr |
| **Summa rörligt** | **~69 kr** | |
| **Bruttomarginal** | **97 %** | |

Med 4 900 kr/mån: 1,5 % + 1,80 kr = 75 kr, plus AI och lagring ≈ **105 kr**,
marginal **98 %**.

Enda kostnaden som kan bli stor är AI om du skickar rådata i stället för
aggregerade nyckeltal. Gör inte det – det är både dyrare och sämre för GDPR.

---

## 4. Prissättning och varför den håller

| Nivå | Pris | Vem |
|---|---|---|
| Lageraudit | 14 900 kr engångs | Första affär, alla segment |
| Radar Basic | 2 490 kr/mån | En butik eller kanal, ≤10 000 artiklar |
| Radar Multi | 4 900 kr/mån | Flera butiker/kanaler, ≤50 000 artiklar |
| Enterprise | 14 900 kr/mån | Kedja eller industri, ≤500 000 artiklar, API och audit |

Prova på-planen är gratis i 14 dagar (3 analyser, 5 000 artiklar) och kostar
endast sin egen lagring. API ingår från Basic och uppåt.

**Jämförelsepunkter som gör priset försvarbart:**

- Konsultarvode för supply chain i Sverige: **700–1 500 kr/h**. En analys som
  tar en konsult 20 timmar kostar 14 000–30 000 kr.
- Ett svenskt konsultbolag publicerar **25 000 kr** som fastpris för en
  supply chain-analys på kundens data.
- Internationella SaaS-verktyg: Prediko från **49 USD/mån** (Shopify-only),
  Inventory Planner ca **120 USD/mån**, Netstock från **900 USD/mån** (ERP).
  Dessa kräver integration och är byggda för andra kanaler.

Din audit är alltså **billig jämfört med en konsult** och **dyr jämfört med en
app** – vilket är rätt position. Du säljer en analys med ett belopp i kronor,
inte en licens.

### Vad priset ska försvaras med

Inte "vi sparar dig X kr" (ett löfte du kan bli ansvarig för) utan:
"Analysen identifierar 1,4 Mkr i inaktivt lager. Vad ni gör med den siffran är ert
beslut – men ni kan inte fatta det utan att veta den."

---

## 5. Tre scenarier, 12 månader

Antaganden: 5–10 h/vecka, ingen betald marknadsföring, ingen lön till dig,
omsättning exklusive moms, churn 2 %/mån i realistiskt scenario.

| | Försiktigt | Realistiskt | Optimistiskt |
|---|---|---|---|
| **Månad 3** | | | |
| Kunder | 1 | 1 | 3 |
| MRR | 2 490 | 2 490 | 7 470 |
| Kumulativ omsättning | 30 000 | 35 000 | 55 000 |
| Kostnader | 2 000 | 2 000 | 3 000 |
| **Resultat före skatt** | **28 000** | **33 000** | **52 000** |
| **Månad 6** | | | |
| Kunder | 2 | 4 | 9 |
| MRR | 4 980 | 12 370 | 28 000 |
| Kumulativ omsättning | 55 000 | 95 000 | 180 000 |
| Kostnader | 4 000 | 5 000 | 8 000 |
| **Resultat före skatt** | **51 000** | **90 000** | **172 000** |
| **Månad 12** | | | |
| Kunder | 4 | 12 | 20 |
| MRR | 9 960 | 37 110 | 65 000 |
| ARR (run-rate) | 120 000 | 445 000 | 780 000 |
| Kumulativ omsättning | 95 000 | 265 000 | 420 000 |
| Kostnader år 1 | 7 000 | 12 000 | 25 000 |
| **Resultat före skatt** | **88 000** | **253 000** | **395 000** |

Efter det: egenavgifter **28,97 %** på överskottet (2026), därefter kommunalskatt.
Räkna med att ungefär hälften av resultatet före skatt blir kvar efter skatt.

**Vad som måste vara sant för det optimistiska scenariot:** en återförsäljarkanal
fungerar (branschorganisation, redovisningsbyrå eller POS-leverantör) och du
klarar onboarding av 2–3 kunder per månad på 8 timmar i veckan. Behandla det som
ett tak, inte som en prognos.

**Break-even:**
- På kassaflöde: **månad 2** (kostnaderna är ~75 kr/mån).
- På din tid, om du värderar den till 300 kr/h och lägger 8 h/vecka
  (9 600 kr/mån): **4 kunder**.

Det andra måttet är det som spelar roll. Ett projekt som ger 3 000 kr/mån för
8 timmar i veckan är sämre betalt än att jobba extra – men det bygger en tillgång
som kan säljas, och det är hela poängen.

---

## 6. Enhetskonomi vid skalning

| Kunder | MRR | Fasta kostnader | Rörliga | Resultat/mån | Marginal |
|---|---|---|---|---|---|
| 1 | 2 490 | 75 | 69 | 2 346 | 94 % |
| 5 | 12 450 | 75 | 345 | 12 030 | 97 % |
| 12 | 37 110 | 340 | 828 | 35 942 | 97 % |
| 30 | 92 700 | 340 | 2 070 | 90 290 | 97 % |
| 100 | 309 000 | 900 | 6 900 | 301 200 | 97 % |

Vid 30 kunder behöver du byta till en större VPS (~250 kr/mån) och vid 100
kunder till en hanterad databas. Det ändrar marginalen med ungefär en
procentenhet.

**Den verkliga kostnaden vid skalning är din tid.** Vid 30 min per kund och månad
är 30 kunder 15 timmar i månaden – mer än du har. Det är därför pris och
automatiseringsgrad, inte kundantal, är de två rattar du ska skruva på.

---

## 7. När ekonomin säger att du ska göra något annat

- **Om ingen betalar efter 20 seriösa samtal:** problemet är inte priset, det är
  målgruppen. Byt segment (från e-handel till fackhandel) innan du byter produkt.
- **Om kunder betalar men churnar efter 2 månader:** produkten löser ett
  engångsproblem, inte ett löpande. Sälj då fler auditer i stället för
  abonnemang – men räkna om värderingen, för återkommande intäkt är borta.
- **Om du lägger mer än 45 minuter per kund och månad:** automatisera
  datastädningen innan du tar nästa kund. Annars äter driften upp marginalen i
  tid i stället för i pengar.
