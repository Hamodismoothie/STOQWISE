# Databas

Lagerradar använder SQLite via `bun:sqlite` i WAL-läge. Ingen extern databasserver,
ingen ORM. Allt schema ägs av `src/data/migrate.ts` och versioneras med
`PRAGMA user_version`.

## Migreringar

| Version | Innehåll |
|---|---|
| 0 → 1 | `users`, `sessions`, `analyses`, `events`, `leads` (v1) |
| 1 → 2 | `organizations`, `members`, `invitations`, `audit_log`, `org_id` på `analyses` |
| 2 → 3 | `items` – normaliserad artikeltabell för filtrering och API |
| 3 → 4 | `api_keys`, `webhooks`, `webhook_deliveries`, `imports`, `sync_schedules` |
| 4 → 5 | `conversations`, `messages`, `scenarios`, `saved_views`, `subscriptions` |

Migreringen körs automatiskt vid import av `src/db.ts` och är idempotent:
varje steg ligger i en transaktion och `user_version` sätts först när steget
lyckats. En halvkörd migrering rullas tillbaka.

```bash
# Kontrollera version och tabeller
sqlite3 data/lagerradar.db "PRAGMA user_version; .tables"
```

## Tabeller

### Identitet och åtkomst
- **users** – e-post (unik), namn, företag, lösenordshash (scrypt), `is_platform_admin`.
- **sessions** – tokenhash, `user_id`, utgångstid. Cookien `lr_session` är HttpOnly,
  SameSite=Lax och sätts med `Secure` när `APP_ORIGIN` är https.
- **organizations** – namn, organisationsnummer, plan, `trial_ends_at` samt
  `trial_welcome_sent_at`, `trial_midpoint_sent_at`, `trial_ending_sent_at` och
  `trial_ended_sent_at`. Provperioden är 14 dagar; markeringarna gör
  livscykelmejlen idempotenta. Läsbart läge beräknas ur `trial_ends_at` och
  raderar ingen data.
- **members** – `(org_id, user_id)` unik, roll `owner|admin|analyst|viewer`.
- **invitations** – e-post, roll, tokenhash, utgångstid, `accepted_at`.
- **api_keys** – namn, `key_hash` (SHA-256), prefix, scopes (`read,write`),
  `last_used_at`, `revoked_at`. Nyckeln visas i klartext **en gång** vid skapandet.

### Data och analys
- **analyses** – en körning: filnamn, källa, lager, period, `result_json`
  (fullständigt `AnalysisResult`), `narrative_json`, status, `org_id`, `created_by`.
- **items** – en rad per artikel och analys. Kolumner för SKU, namn, kategori,
  leverantör, saldo, värde, kostnad, pris, ledtid, MOQ, sålda enheter, intäkt,
  omsättning, dagar i lager, ABC/XYZ, åtgärd och prioritet.
  Index: `(org_id, sku)`, `(analysis_id, value DESC)`, `(analysis_id, action)`.
- **imports** – spårbarhet per uppladdning: fil, storlek, rader, status, fel,
  användare, tidsstämplar. Används av importvyn och för felsökning.
- **scenarios** – sparade simuleringar med `input_json` och `result_json`.
- **saved_views** – sparade filter per användare/organisation.

### Drift och kommers
- **audit_log** – append-only: aktör, handling, objekt, metadata, IP, tid.
  Index `(org_id, id DESC)`. Skrivs av inloggning, import, analys, rollbyte,
  nyckelhantering, abonnemangsändring och inställningar.
- **events** – produkttelemetri (intern): händelsenamn, metadata.
- **mail_log** – varje utskicksförsök: mottagare, ämne, `kind`, status
  (`sent`/`outbox`/`failed`), leverantörens id, fel och tid. Brödtext sparas
  endast i `outbox`-läge. Trialens steg loggas som `trial_welcome`,
  `trial_midpoint`, `trial_ending` och `trial_ended`.
- **leads** – kontaktformulär och demo-förfrågningar.
- **subscriptions** – plan, status, period, Stripe-referenser (valfritt).
- **webhooks** / **webhook_deliveries** – utgående integrationer med HMAC-signatur,
  retry-räknare och svarsstatus.
- **sync_schedules** – förberedd tabell för ERP-synk. Ingen schemaläggare körs i dag.
- **conversations** / **messages** – copilotens historik med intent, parametrar,
  svar och spårbarhet till källor.

## Tenant-isolering

Varje datatabell som innehåller kunddata har `org_id`. Alla frågor i
`src/data/repo.ts` tar `orgId` som första argument och filtrerar på det.
Det finns ingen "hämta alla"-funktion i API-lagret. Analys-ID:n är UUID v4,
men slumpen är inte säkerheten: även med ett korrekt ID returnerar frågan
`null` om `org_id` inte matchar, och API:t svarar 404 (inte 403) för att inte
avslöja att resursen finns.

## Lagring och retention

- Databasen ligger i `data/lagerradar.db` (WAL-filer `-wal`/`-shm` hör till).
- `DB_PATH` kan peka ut en annan fil, vilket används av integrationstesterna.
- Rådata lagras inte: endast den tolkade analysen och artikelraderna. Den
  uppladdade filen släpps efter att analysen körts.
- Raderingsregler är avsiktligt manuella i denna version. `data/` ska säkerhetskopieras
  som en enhet (se `docs/drift.md`), och en borttagen organisation ska tas bort med
  `DELETE ... WHERE org_id = ?` i samma ordning som tabellerna skapas.

## Prestanda

- 380 artiklar: ~3 ms per analys. 50 000 artiklar: ~87 ms (mätt med `bun run bench`).
- `items` är den enda tabellen som växer snabbt. 50 000 artiklar × 12 månader ger
  cirka 77 kB JSON per analys; artikelnormaliseringen är billigare att filtrera än
  att parsa JSON och används därför av explorer, API och export.
- Skrivningar sker i transaktioner; WAL gör att läsning inte blockeras av import.
