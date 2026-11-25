# Stoqwise

Lageranalys för svensk handel och industri. Stoqwise tar en
CSV-export från kassasystem, ERP eller lager­system och svarar på fyra frågor som
annars kräver en controller och en konsult: **var sitter kapitalet, vad kommer
att hända, vad händer om vi ändrar oss, och vad ska vi göra på måndag.**

**Status:** fungerande plattform, testad end-to-end. `bun run typecheck` grönt,
**378 automatiska tester** (motor, prognos, simulering, copilot, Excel, RBAC,
API, tenant-isolering, licensgrind och ett riktigt HTTP-flöde), två
runtime-beroenden (`three`, `pdfkit`). Mätt: 1,5 ms för demokörningen (46
artiklar), 83 ms på 50 000.

---

## Design

Gränssnittet är en **lagerbok**: varmt papper, bläck och oxiderad koppar, hårlinjer
i stället för kort, folionummer i navigationen och siffror satta i mono. Tre
OFL-licensierade typsnitt bär identiteten: Geist (gränssnitt), Geist Mono
(data) och Newsreader (kursiv serif i PDF). Logotypen är den
Stoqwise-konsten (`public/brand/`, SVG med ordmärket anpassat till namnet) och används som bild i
varje yta: rail, sidhuvud, auth, favicon och PDF (som vektor). Inget UI-bibliotek, inga
runtime-beroenden för ytan: designsystemet ligger i `public/v3.css`, logotyp och
ikoner i `src/ui/base.ts`, och visualiseringarna ritas som SVG i `src/ui/charts.ts`.

Art direction, förkastade riktningar och rörelseprinciper: `docs/design-riktning.md`.
Varumärke, typografi, färg och användningsregler: `docs/varumarke.md`.

---

## Vad som ingår

### 1. Advanced Inventory Intelligence
Inaktivt lager, överlager, bristrisk, ABC/XYZ, lagerhälsa 0–100 med drivare,
prioriteringspoäng per artikel, kapitalfördelning per kategori och leverantör,
säsongsmönster och anomalier. Varje artikel får en åtgärd: `write_off`,
`liquidate`, `reduce`, `reorder` eller `ok` – med belopp och motivering.

### 2. Predictive Analytics
Sju prognosmodeller (SES, Holt, Holt-Winters, Croston, SBA, TSB och ADIDA)
väljs per artikel genom ett läckagefritt backtest på WAPE, med MAE, RMSE och
bias redovisade. En champion-challenger-grind behåller SES när en komplex
modell inte bevisar sig på en längre holdout. Konfidensintervall,
vecko- och dagsfrekvens, ledtidsbehov och beställningspunkt ur efterfrågans
standardavvikelse och vald servicenivå.

### 3. Supply Chain Simulation
Scenarier för efterfrågan, ledtid, leverantörsförsening, servicenivå,
lagerreduktion och inköpsfrekvens. Varje utfall redovisar **formlerna** bakom
siffrorna, nettoeffekt i kronor, kapitalbehov, uppfyllnadsgrad och risker.
Sparade scenarier kan jämföras mot samma baslinje.

### 4. AI Copilot
Frågor på svenska besvaras av en deterministisk motor med 13 avsikter –
topplista på kapital, frigjort kapital, inaktivt lager, bristrisk, säsong, leverantörer,
åtgärder, artikeluppslag, simulering med mera. Varje svar bär `facts`, `sources`
och tabell. Ett valfritt LLM-lager får formulera om texten men aldrig införa nya
tal: `isGrounded` avvisar svaret annars.

### 5. Enterprise Integration
REST-API med scoped nycklar (`read`/`write`), rate limit, paginering, filter och
export. Webhooks med HMAC-signatur, importhistorik och adaptrar för ERP. Adaptrarna är ärliga: utan kundens credentials svarar de
`requires_credentials` i stället för att låtsas.

### 6. Commercial SaaS
Organisationer, roller (owner/admin/analyst/viewer), inbjudningar, audit log,
abonnemang och fyra planer. Plattformsadmin på `/admin` (kräver
`PLATFORM_ADMINS`).

---

## Snabbstart

```bash
bun install
bun run dev            # http://localhost:3000
```

Skapa konto på `/skapa-konto`, ladda upp `samples/exempel-lagerdata.csv`, mappa
kolumnerna och kör. Det är hela onboardingen. Vill du bara se produkten: `/demo`
och `/exempelrapport.pdf` kräver inget konto.

### Kommandon

| Kommando | Gör |
|---|---|
| `bun run dev` | Startar med hot reload |
| `bun start` | Startar utan watch |
| `bun test` | 378 tester: parser, motor, prognos, simulering, copilot, xlsx, RBAC, API, licenser, E2E |
| `bun run typecheck` | `tsc --noEmit`, strict |
| `bun run sample` | Genererar exempel-CSV och exempel-PDF |
| `bun run bench` | Prestandamätning |
| `bun run forecast:bench` | Prognosbenchmark mot SES och naiv prognos |

---

## Arkitektur

```
src/
  core/          forecast.ts · simulate.ts · intelligence.ts · copilot.ts
  data/          migrate.ts (8 versioner) · repo.ts (all SQL, roller, planer)
  pages/         public.ts · core.ts · admin.ts
  ui/            base.ts (designsystem) · charts.ts (SVG)
  server.ts      routing, sessioner, formulär, nedladdningar
  api.ts         /api/v1
  pipeline.ts    förhandsgranskning, ingest, omkörning
  xlsx.ts        egen ZIP+XML-implementation
  analysis.ts    beräkningsmotorn (v1, vidareutvecklad)
public/          v2.css · v2.js (tema, kommandopalett, animationer)
docs/            arkitektur · databas · api · säkerhet · drift · kostnad · prospekt
```

Server-renderad HTML, inga klientramverk, inga byggsteg. All interaktivitet är
progressiv förbättring: formulär fungerar utan JS, kommandopaletten och
diagramanimationerna kräver det. Se `docs/arkitektur.md` för varför.

---

## Planer

| Plan | Pris/mån | Artiklar | Användare | Analyser/mån | API |
|---|---:|---:|---:|---:|:--:|
| Prova på | 0 kr | 5 000 | 3 | 3 | – |
| Radar Basic | 2 490 kr | 10 000 | 3 | 10 | ✓ |
| Radar Multi | 4 900 kr | 50 000 | 10 | 50 | ✓ |
| Enterprise | 14 900 kr | 500 000 | 100 | 500 | ✓ |

Prova på gäller i 14 dagar från att arbetsytan skapas. När provperioden tar slut
går organisationen över till läsbart läge: analyser, artikelrader, scenarier och
rapporter finns kvar och kan läsas och exporteras, men nya importer, analyser och
andra ändringar av kunddata blockeras. Fyra livscykelmejl följer perioden; de och
det läsbara läget beskrivs i `docs/drift.md`.

Kostnads- och prismodellens antaganden finns i `docs/kostnadsmodell.md`.

---

## API

```bash
curl -H "Authorization: Bearer $LR_KEY" \
  "https://din-instans/api/v1/analyses/$ID/items?action=write_off&pageSize=50"
```

Fullständig referens: `docs/api.md`. Databasschema och migreringar:
`docs/databas.md`. Säkerhet, roller och GDPR: `docs/sakerhet.md`. Drift, backup
och kapacitet: `docs/drift.md`.

Kunskapsgrund, formler, källor och regler för realistisk testdata:
`docs/kunskapsgrund.md`.

Teknikinventering, licensbedömning och mätresultat: `docs/teknikval.md`.
Tredjepartsregister: `THIRD_PARTY_LICENSES.md`.

---

## Vad som kräver extern aktivering

Byggt och testat internt, men kräver att ägaren sätter en nyckel:

- **LLM-omskrivning av copilotsvar** – kräver både `AI_API_KEY` och
  `AI_DATA_PROCESSING_APPROVED=true`. Utan dem används den deterministiska
  motorn, som är fullt fungerande. En nyckel ensam är aldrig samtycke till
  extern databehandling.
- **Betalningar** – `STRIPE_SECRET_KEY`. Abonnemang kan sättas manuellt.
- **E-postutskick** – kräver leverantörsnyckel; inbjudningar visas som länk.
- **ERP-synk** – kräver kundens egna API-uppgifter per system.

Inget av detta är påhittat eller simulerat: gränssnitten visar sitt verkliga
tillstånd och API:t svarar med vad som saknas.
