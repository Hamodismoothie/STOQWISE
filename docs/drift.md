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
| `SESSION_SECRET` | osäker dev-sträng | **Måste sättas** i drift |
| `DB_PATH` | `data/lagerradar.db` | Används av tester och för att flytta databasen |
| `PLATFORM_ADMINS` | tom | E-postlista; tom betyder att ingen kommer åt `/admin` (inloggning krävs, därefter 404) |
| `AI_API_KEY` | tom | Slår på LLM-omskrivning av copilotsvar |
| `STRIPE_SECRET_KEY` | tom | Endast vid riktig betalning |

Saknas `PLATFORM_ADMINS` finns ingen plattformsadministration alls – en medveten
standard, så att en felkonfigurerad instans inte exponerar en adminyta.

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

## Loggar och övervakning

- Strukturerade händelser skrivs till `events` och `audit_log` (inte till stdout
  i klartext). `/halsa` svarar `{ status: "ok", version, db }`.
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
- Ingen e-postutskick: inbjudningar visas som länk i gränssnittet i stället för
  att skickas. Det kräver en e-postleverantör och en nyckel som ägaren sätter.
- Ingen betalningsdrift: abonnemang kan sättas manuellt av plattformsadmin;
  Stripe kopplas in först när nyckeln finns.
