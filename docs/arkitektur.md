# Arkitektur och tekniska beslut

Detta dokument förklarar **varför** koden ser ut som den gör. Läs det innan du
ändrar något strukturellt.

---

## 1. Översikt

En process. En databasfil. Inget byggsteg.

```
                    ┌──────────────────────────────────────────┐
  webbläsare ──────►│  Bun.serve  (src/server.ts)              │
  HTML + 1 CSS      │  ├─ router (publikt / auth / app / api)  │
  + 1 JS            │  ├─ session, CSRF, rate limit            │
                    │  └─ säkerhetsheaders, felhantering       │
                    └───┬───────────┬───────────┬──────────────┘
                        │           │           │
                 ┌──────▼──┐  ┌─────▼─────┐ ┌───▼──────┐
                 │ tolkning│  │  analys   │ │ rapport  │
                 │ csv →   │  │ analysis  │ │ insights │
                 │ mappning│  │  .ts      │ │ + pdf    │
                 │ →dataset│  └─────┬─────┘ └───┬──────┘
                 └──────┬──┘        │           │
                        └───────────┴───────────┘
                                    │
                            ┌───────▼────────┐
                            │ bun:sqlite     │
                            │ data/*.db WAL  │
                            └────────────────┘
```

**Varför inte Next.js + Postgres + S3?**

Varje lager är en sak som går sönder, kostar pengar eller måste uppdateras. För
en produkt med 1–30 kunder och en utvecklare är den här arkitekturen snabbare att
leverera i, billigare att drifta och enklare att felsöka. Skalningstaket är
mätt: 50 000 artiklar analyseras på 87 ms. När du når taket byter du ut en fil,
inte hela systemet.

**Vad som är medvetet utelämnat:** React, ett API-lager, en jobbkö, Redis,
Docker, en ORM och en betalintegration. Alla skulle de lägga till arbete utan att
lösa ett problem som finns i dag.

---

## 2. Datamodell

`data/lagerradar.db`, SQLite i WAL-läge.

### `users`

| Kolumn | Typ | Not |
|---|---|---|
| `id` | TEXT PK | uuid |
| `email` | TEXT UNIQUE | lower-case, normaliserad |
| `name`, `company` | TEXT | |
| `password_hash` | TEXT | `scrypt$N$r$p$salt$hash` |
| `plan` | TEXT | `trial` / `basic` / `multi` – endast informativ |
| `created_at` | TEXT | ISO 8601 |

### `sessions`

| Kolumn | Not |
|---|---|
| `token_hash` | SHA-256 av cookiens värde. **Token lagras aldrig i klartext.** |
| `user_id` | FK, `ON DELETE CASCADE` |
| `expires_at` | 30 dagar |

### `analyses`

| Kolumn | Not |
|---|---|
| `id`, `user_id` | tenant-nyckel i varje fråga |
| `company`, `filename` | |
| `status` | `draft` / `ok` / `failed` |
| `rows` | antal artiklar |
| `input_json` | tolkade rader + mappning (för omkörning) |
| `result_json` | hela analysresultatet |
| `narrative_json` | rapporttext (mall eller AI) |
| `settings_json` | tröskelvärden som användes |
| `created_at`, `updated_at` | |

Resultatet lagras färdigräknat. Att öppna en analys är en enda `SELECT` – ingen
omräkning, ingen extern tjänst.

### `events`

`id`, `user_id`, `type`, `detail`, `created_at`. Används för spårbarhet:
`analysis.created`, `analysis.deleted`, `user.deleted`, `login.failed`. Ingen
känslig data i `detail`.

### `leads`

Kontaktformuläret. Ingen koppling till konton. Raderas manuellt eller via SQL.

**Tenant-isolering:** varje fråga i `src/db.ts` tar `user_id` som första argument
och har det i `WHERE`. Det finns ingen funktion som hämtar en analys utan
användare. Det är enklare att granska än ett rollsystem.

---

## 3. Flödet för en analys

```
POST /app/ladda-upp   (multipart, max 12 MB)
   │  läser filen i minnet – skriver aldrig till disk
   ▼
parseCsv           → headers, rows, warnings
detectMapping      → fält → kolumn, konfidens, månadskolumner
insertDraft        → status='draft', input_json
   ▼
GET /app/analys/:id/mappning
   │  användaren ser och kan ändra mappningen
   ▼
POST /app/analysera
   │  buildDataset (validering, dubbletter, negativa saldon)
   │  analyze (all aritmetik)
   │  buildTemplateNarrative (+ ev. AI)
   ▼
completeAnalysis   → status='ok', result_json
   ▼
GET /app/analys/:id           dashboard
GET /app/analys/:id/rapport.pdf   PDF, genereras på begäran
```

PDF:en cachas inte per analys. Den tar ~40 ms att bygga och genereras alltid ur
det lagrade resultatet – vilket garanterar att PDF och dashboard visar samma tal.

Utkast (`status='draft'`) som är äldre än 24 timmar rensas vid uppstart och vid
ny uppladdning. En avbruten uppladdning lämnar aldrig skräp kvar.

---

## 4. Analysmotorn

`analyze(items, settings, warnings) → AnalysisResult`. Ren funktion: inga
sidoeffekter, ingen klocka, inget I/O, ingen slump. Samma indata ger alltid samma
utdata, vilket är förutsättningen för att talen ska gå att försvara i ett möte.

Ordförklaringar:

- **Efterfrågan** = såld kvantitet under fönstret, omräknad till dygn.
- **Ledtid** = artikelns egen ledtid om den finns, annars 30 dagar.
- **Säkerhetslager** = `z × σ × √(ledtid / 30,44)`, där σ är standardavvikelsen i
  månadsförsäljning. z hämtas ur en tabell per servicenivå (90/95/98/99 %).
- **Överlager** = `saldo − (dygnsefterfrågan × (ledtid + granskningsperiod) +
  säkerhetslager)`, endast om positivt.
- **Inaktivt lager** = `saldo > 0` och ingen försäljning i fönstret. Klassas separat
  från överlager – samma artikel räknas aldrig i båda.
- **ABC** på kumulativ andel försäljningsvärde: A ≤ 80 %, B ≤ 95 %, C resten.
  Andelen beräknas **före** artikeln läggs till, annars kan en dominant artikel
  aldrig bli A.
- **XYZ** kräver minst 6 månader. CV = σ/μ. X < 0,5, Y 0,5–1,0, Z > 1,0. Noll
  försäljning ger Z, inte X – en artikel som säljer noll är inte jämn, den är
  oberäknelig.
- **Frigjort kapital** = `kapital i inaktiva artiklar × 25–55 %` + `överlager × 15–35 %`. Alltid
  intervall. Realisationsgraden är antagandet som avgör allt, så den redovisas
  öppet i rapporten.

Alla trösklar är inställningsbara per analys och sparas i `settings_json`, så en
gammal rapport kan alltid förklaras i efterhand.

---

## 5. AI-lagret och siffergrinden

Detta är den enda delen där en modell påverkar texten. Skyddet är byggt i fyra
steg:

1. `buildFacts(result)` plockar ut exakt de tal som får nämnas, som strängar.
2. Modellen får endast faktaobjektet – aldrig rådata – och ombeds svara i JSON.
3. `aiTextIsGrounded(text, facts)` extraherar varje tal ur svaret (även svenska
   format som `1 234,5` och `12 %`) och jämför med mängden tillåtna tal.
   **Ett enda okänt tal kastar hela texten.**
4. Fallback är den deterministiska mallen, som alltid finns. AI är en
   förbättring, aldrig ett beroende.

Belopp i åtgärdslistan (`impact`) sätts av motorn och skrivs aldrig av modellen.
Rapporten markerar AI-genererad text.

**Konsekvens:** AI kan göra texten bättre formulerad. Den kan inte göra en siffra
fel. Det är hela poängen med konstruktionen.

---

## 6. Säkerhetsmodell

| Risk | Åtgärd |
|---|---|
| Lösenordsläcka | scrypt, unikt salt, konstant tidsjämförelse |
| Sessionskapning | 32 byte slump, endast hash lagrad, HttpOnly + SameSite=Lax |
| CSRF | Origin/Referer måste matcha värden på alla POST |
| Triggning av annans data | `user_id` i varje `WHERE`, uuid som inte går att gissa |
| Path traversal | `safeJoin()` för statiska filer, vitlista på filändelser |
| XSS | allt som skrivs ut går genom `esc()` – även data från CSV |
| Resursutmattning | 12 MB / 200 000 rader, `maxRequestBodySize` 13 MB |
| Brute force | 8 inloggningsförsök per e-post och 15 minuter |
| Skrapning av kontaktformulär | 5 per timme per IP |
| Klickkapning | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` |
| Datahemsprövning | ingen spårning, inga externa resurser i HTML |
| Dataförlust | `sqlite3 .backup` dagligen (se README) |

**Vad som inte är byggt:** tvåfaktorsautentisering, SSO, IP-tillåtelselista,
kryptering av databasfilen i vila. För en B2B-tjänst med en handfull kunder är
detta rätt avvägning – men det ska stå i avtalet att filen raderas efter analys.

---

## 7. Gränssnittet

Server-renderade strängar i `src/views/`. Ingen virtuell DOM, inget byggsteg.

- `layout.ts` – skal, `esc()`, `money()`, `num()`, `pct()`, `bar()`.
- `landing.ts` – startsida, priser, kontakt, integritet, 404, fel.
- `app.ts` – konto, uppladdning, mappning, analyslista, tack.
- `analysis.ts` – dashboarden.

`public/app.js` (≈3 kB) lägger bara till sådant som kräver JavaScript:
filnamn vid val, drag-and-drop, `data-confirm`-dialoger. Sidan fungerar utan.

**Formatering:** `Intl.NumberFormat("sv-SE")` för tal, `sv-SE` för datum.
Belopp under 1 000 kr skrivs ut, över skrivs de som `1,4 Mkr` / `590 tkr` där
utrymmet är litet – men alltid med exakt belopp i tabellerna.

---

## 8. Var du ska ändra saker

| Du vill… | Ändra i |
|---|---|
| Justera trösklar eller realisationsgrader | `src/analysis.ts`, `defaultSettings` |
| Lägga till en kolumn som ska kännas igen | `src/mapping.ts`, `ALIASES` |
| Ändra rapportens texter | `src/insights.ts`, `buildTemplateNarrative` |
| Ändra PDF-layout | `src/pdf.ts` |
| Byta databas | `src/db.ts` – behåll funktionssignaturerna |
| Lägga till en sida | `src/views/` + en rutt i `src/server.ts` |
| Byta AI-leverantör | `src/insights.ts`, `enrichWithAi` |

---

## 9. Kända begränsningar

- **Prognoser kräver historik.** Under sex månader faller motorn tillbaka på ett
  naivt medelvärde och rapporterar låg konfidens i stället för att låtsas ha en
  säsong. Säsongsmönster kräver minst 12 månader.
- **Simuleringen är deterministisk.** Den räknar förväntvärden, inte
  Monte Carlo-spridning; `supplierDelayProbability` viktar väntevärdet.
- **Ingen valutaomräkning.** Allt antas vara SEK. Import i EUR ger fel lagervärde
  om ingen räknat om det före vyn.
- **Ingen artikelhierarki.** Varianter (färg/storlek) behandlas som separata
  artiklar om de har egna artikelnummer. Det är rätt för inaktivt lager, men gör
  överlager trubbigt för mode.
- **Returer ingår inte** om de inte redan är avdragna i exporten.
- **En process.** Startar den om tappar pågående uppladdningar sina utkast – det
  är acceptabelt, utkast är billiga att göra om.
- **Ingen e-postutskick.** Lösenordsåterställning sker manuellt av dig. Det är
  medvetet: ett e-postberoende är ett driftberoende.

Dessa är dokumenterade för att de ska kunna förklaras för en kund, inte för att
de ska byggas bort i förtid.
