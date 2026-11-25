# Drift

## Krav

- Bun 1.4 eller senare. Ingen Node, ingen extern databas, ingen byggkedja.
- En persistent volym för `data/` (SQLite + WAL).
- Utgående nätverk krävs bara för valfria integrationer (LLM, Stripe, ERP).

## Miljövariabler

| Variabel | Standard | Kommentar |
|---|---|---|
| `PORT` | `3000` | HTTP-port |
| `APP_ORIGIN` | `http://localhost:$PORT` | Exakt origin; styr cookies och CSRF |
| `BRAND_EMAIL_DOMAIN` | *(tom)* | Domän för hello@, privacy@ och billing@. Tomt värde döljer alla adresser i sidor, PDF och fakturor |
| `RESEND_API_KEY` | tom | API-nyckel för transaktionell e-post. Utan nyckel och avsändare hamnar mejlen i `mail_log` (outbox) i stället för att skickas |
| `MAIL_FROM` | tom | Avsändare, till exempel `STOQWISE <hello@example.se>`; domänen måste vara verifierad hos Resend |
| `MAIL_NOTIFY` | `hello@` | Mottagare av kontaktformulärets notiser |
| `SESSION_SECRET` | osäker dev-sträng | Reserverad; nuvarande sessioner använder slumpade tokens som hashas i databasen |
| `DB_PATH` | `data/lagerradar.db` | Används av tester och för att flytta databasen |
| `PLATFORM_ADMINS` | tom | E-postlista för interna pris-/ekonomiytor i kundappen. `/admin` har separata konton och påverkas inte |
| `ADMIN_SETUP_TOKEN` | tom | Engångstoken för att skapa första `/admin`-kontot; kan tas bort efteråt |
| `TRUST_PROXY` | `false` | Sätt till `true` endast om en betrodd proxy skriver över `X-Forwarded-For`; annars används socket-adressen |
| `AI_API_KEY` | tom | API-nyckel för valfri LLM-omskrivning |
| `AI_DATA_PROCESSING_APPROVED` | `false` | Krävs utöver nyckeln innan kunddata får skickas till extern AI-leverantör |
| `STRIPE_SECRET_KEY` | tom | Endast vid riktig betalning |

Saknas `PLATFORM_ADMINS` är pris-/ekonomiytorna i kundappen stängda. `/admin`
fungerar ändå, men kräver att första kontot skapas med `ADMIN_SETUP_TOKEN`.

## Provperiod

En provperiod är 14 dagar från att arbetsytan skapas. Slutdatumet lagras i
`organizations.trial_ends_at`; `TRIAL_DAYS` i `src/trial-state.ts` är källan.
Provperioden är en kalenderperiod, inte en planetikett: banner, skrivskydd och
mejl läser samma slutdatum.

`runTrialLifecycle` i `src/trial.ts` körs vid start och därefter varje timme.
Den skickar fyra mejl till organisationens aktiva ägare:

| `mail_log.kind` | När | Innehåll |
|---|---|---|
| `trial_welcome` | När arbetsytan skapas; sweepen tar den om det första försöket inte gick fram | Slutdatum, vad som ingår och att data finns kvar efteråt |
| `trial_midpoint` | När 7 dagar återstår | Halvtid, nästa steg och att provperioden slutar i läsbart läge |
| `trial_ending` | När 2 dagar återstår | Sista påminnelsen före läsbart läge |
| `trial_ended` | När slutdatumet har passerat | Läsbart läge, export och hur man begär offert |

Varje steg markeras i `organizations` (`trial_*_sent_at`) innan utskicket.
Därför är sweepen idempotent: en omstart eller två samtidiga instanser skickar
inte samma steg två gånger. Om ett senare steg är det första som är aktuellt
markeras de tidigare stegen som hanterade, så en sen start inte skickar en skur
av gamla mejl. Om alla mottagare misslyckas frigörs markeringen och nästa sweep
försöker igen. Försöken loggas i `mail_log` med kategorierna ovan.

Alla fyra livscykelmejl följer mottagarens språk (svenska eller engelska).
Samma sweep kan köras manuellt från `/admin/plattform` av en ägaradministratör,
och de senaste trialmejlen visas där med status och felorsak.

Efter slutdatumet är organisationen i läsbart läge. `requireWritable` nekar
ändringar av kunddata: nya importer, nya analyser, ändrade inställningar och
API-skrivningar blockeras. Läsning, nedladdning av rapporter och export fungerar
fortsatt, och inga analyser, artikelrader, scenarier eller rapporter raderas.

## E-post

Lösenordsåterställning, inbjudningar och kontaktformulärets notiser går genom
`src/mail.ts`. Med `RESEND_API_KEY` och `MAIL_FROM` skickas mejlen via Resend.
Utan dem skrivs de till tabellen `mail_log` med status `outbox`, så flödena kan
köras lokalt utan leverantör. Endast i outbox-läget sparas meddelandets text,
inklusive länken; skickade och misslyckade mejl loggas utan brödtext.

Kontrollera de senaste försöken:

```bash
sqlite3 data/lagerradar.db "SELECT created_at, kind, status, to_email, error FROM mail_log ORDER BY id DESC LIMIT 10"
```

Offertförfrågningar och aktiveringsbegäranden skickar två mejl: en intern notis
till `MAIL_NOTIFY` (eller `hello@` när domänen är satt) och en bekräftelse till
kunden. De visas i `/admin/offerter`. När en betald plan slås på skickas ett
välkomstmejl till organisationens ägare, och öppna ärenden markeras som
aktiverade. Mejlen loggas som `quote_requested`, `quote_confirmation`,
`activation_requested`, `activation_confirmation` och `plan_activated`.

## Start

```bash
bun install
PORT=3000 APP_ORIGIN=https://radar.example.se SESSION_SECRET=… bun start
```

Första starten skapar databasen och kör alla migreringar. Startloggen skriver
port, databassökväg, schema­version och om admin är aktiverat.

Kontroll:

```bash
curl -fsS localhost:3000/halsa
curl -fsS localhost:3000/api/v1/health
```

## Backup

SQLite i WAL-läge ska säkerhetskopieras med `VACUUM INTO` eller genom att stoppa
processen och kopiera `data/` inklusive `-wal` och `-shm`.

```bash
sqlite3 data/lagerradar.db "VACUUM INTO 'backup/lagerradar-$(date +%F).db'"
```

Återställning: stoppa tjänsten, ersätt databasfilen, starta. Migreringar körs om
och är idempotenta. Ta backup före varje uppgradering som höjer `user_version`.

Backuperna innehåller personuppgifter och företagsdata. De ska lagras krypterat,
åtkomstbegränsas och testas genom återläsning. SQLite-filen är inte krypterad av
appen; det måste lösas på volymnivå (LUKS, krypterad molnvolym) eller genom att
databasen flyttas till en krypterad hanterad tjänst.

## Loggar och övervakning

- Strukturerade händelser skrivs till `events` och `audit_log` (inte till stdout
  i klartext). `/halsa` svarar `{ status: "ok", version, uptime }`.
- Bevaka: svarskod 5xx, `rate_limited` (429), misslyckade importer (`imports.status`),
  och att `PRAGMA user_version` matchar förväntad version efter deploy.
- Långsamma frågor: `items` ska alltid filtreras på `analysis_id` eller `org_id`;
  index finns för båda.

## Kapacitet

| Volym | Analys | Databas |
|---|---|---|
| 380 artiklar | ~3 ms | < 1 MB |
| 5 000 artiklar | ~10 ms | ~10 MB |
| 50 000 artiklar | ~87 ms | ~120 MB per 10 analyser |

En instans klarar normal svensk SMF-last på en liten VM. Skalning sker först när
skrivvolymen blir hög; då flyttas `items` till en separat tabell/instans med
samma `org_id`-kontrakt. API:t är stateless och kan köras bakom en lastbalanserare
om databasen flyttas till en delad volym.

## Uppgradering

1. Ta backup (`VACUUM INTO`).
2. Kör `bun run typecheck && bun test`.
3. Deploya. Migreringar körs vid start; en misslyckad migrering stoppar starten
   hellre än att köra vidare på ett halvt schema.
4. Verifiera `/halsa`, en inloggning och en export.

## Vad som medvetet inte är automatiskt

- Ingen schemaläggare i processen. `sync_schedules` lagrar önskat schema, men en
  extern cron (eller framtida worker) måste anropa sync-endpointen.
- Inga marknadsföringsmejl. Transaktionella mejl, inklusive trialens fyra steg,
  kräver `RESEND_API_KEY` och `MAIL_FROM`; utan dem hamnar de i `mail_log` som
  `outbox`, och inbjudningar visas även som länk i gränssnittet.
- Ingen betalningsdrift: abonnemang kan sättas manuellt av plattformsadmin;
  Stripe kopplas in först när nyckeln finns.
