# API v1

REST-API för integrationer. Allt som webbgränssnittet kan göra går att göra via
API:t, med samma beräkningsmotor och samma tenant-isolering.

Bas-URL: `https://din-instans/api/v1`

## Autentisering

Skapa en nyckel under **Integrationer → API-nycklar**. Nyckeln visas en gång.

```http
Authorization: Bearer lr_write_3f9c…
```

- `lr_read_…` – läsa analyser, artiklar, prognoser, exporter.
- `lr_write_…` – även skapa analyser, simuleringar och copilot-frågor.

Nycklar hashas med SHA-256 innan de lagras. Återkallning gäller omedelbart.
Gräns: **240 anrop per minut och nyckel** (`429` med `retry-after`).

## Endpoints

| Metod | Väg | Beskrivning |
|---|---|---|
| GET | `/health` | Publik hälsokontroll, ingen nyckel |
| GET | `/me` | Organisation, plan, scopes, antal analyser |
| GET | `/analyses` | Senaste 100 analyserna |
| POST | `/analyses` | Ny analys (multipart `file`, valfria `warehouse`, `serviceLevel`, `deadStockDays`) |
| GET | `/analyses/:id` | Nyckeltal, insikter, prioriteringar |
| GET | `/analyses/:id/items` | Artiklar med filter och paginering |
| GET | `/analyses/:id/forecast?sku=&horizon=` | Prognos med intervall och metod |
| POST | `/analyses/:id/simulate` | Scenario, JSON-body |
| GET | `/analyses/:id/export.xlsx` | Excel-export |
| GET | `/analyses/:id/report.pdf` | PDF-rapport |
| GET | `/items/:sku` | Artikel ur senaste analysen |
| POST | `/copilot` | Fråga mot analysen, med siffergrind |

### GET /me

```json
{
  "organization": { "name": "Nordkap Fackhandel AB", "plan": "basic" },
  "plan": { "id": "basic", "maxSkus": 10000, "maxAnalysesPerMonth": 10, "apiAccess": true },
  "scopes": ["read", "write"],
  "analyses": 4
}
```

### GET /analyses/:id/items

Query-parametrar: `page` (1), `pageSize` (1–200, default 50), `q`, `action`
(`write_off|liquidate|reduce|reorder|ok`), `abc` (`A|B|C`), `xyz` (`X|Y|Z`),
`sort` (`value|turns|stock|priority|sku`), `dir` (`asc|desc`).

```json
{
  "data": [
    { "sku": "48213", "name": "Proffs Skruvdragare", "stock": 42, "value": 18900,
      "action": "reduce", "abcValue": "A", "xyz": "X", "priority": 71 }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 380, "pages": 8 }
}
```

### POST /analyses

```bash
curl -X POST https://din-instans/api/v1/analyses \
  -H "Authorization: Bearer $LR_KEY" \
  -F "file=@lager.csv" \
  -F "warehouse=Huvudlager" \
  -F "serviceLevel=0.95"
```

Svar `201` med `{ id, kpis, insights }`. Filen tolkas med samma
kolumnigenkänning som i webbgränssnittet; okända format ger `422` med
`{ error: "parse_failed", message, warnings }`.

### POST /analyses/:id/simulate

```json
{
  "name": "Efterfrågan +20 %",
  "demandMultiplier": 1.2,
  "stockReductionPct": 0.15,
  "serviceLevel": 0.95,
  "leadTimeMultiplier": 1,
  "supplierDelayDays": 0,
  "supplierDelayProbability": 0
}
```

Svar: `{ scenario, deltas, totals, byCategory, risks, formulas }`.
`formulas` redovisar varje siffra så att svaret kan granskas av en controller.

### POST /copilot

```json
{ "question": "Vilka 10 artiklar binder mest kapital?", "analysisId": "…" }
```

```json
{
  "intent": "top_capital",
  "answer": "De 10 största artiklarna binder 1 842 300 kr …",
  "facts": ["…"],
  "sources": ["items.value", "kpis.inventoryValue"],
  "table": { "columns": ["Artikel", "Värde"], "rows": [["48213", "18 900"]] },
  "confidence": "high",
  "grounded": true
}
```

Copiloten får inte införa nya tal. `grounded: false` kan bara uppstå om ett
LLM-lager är påslaget och bryter mot regeln – då returneras motorsvaret i stället.

## Felformat

```json
{ "error": "forbidden", "message": "Nyckeln saknar skrivbehörighet." }
```

| Status | Betydelse |
|---|---|
| 400 | Ogiltig body eller parameter |
| 401 | Saknad, okänd eller återkallad nyckel |
| 403 | Nyckeln saknar scope (t.ex. `read` vid POST) |
| 404 | Resursen finns inte **i din organisation** |
| 402 | Planens gräns nådd (analyser per månad) |
| 413 | Filen är för stor |
| 422 | Filen kunde inte tolkas |
| 429 | Rate limit |

## Webhooks

Utgående webhooks signeras med HMAC-SHA256 i `X-Lagerradar-Signature` över
`timestamp.body`. Mottagaren ska verifiera signaturen och avvisa äldre
tidsstämplar än fem minuter. Leveranser loggas med status och retry-räknare.

## Versionering

`/api/v1` är stabilt. Brytande ändringar släpps som `/api/v2` med minst sex
månaders överlapp. Nya fält kan tillkomma i svar utan att versionen ändras.
