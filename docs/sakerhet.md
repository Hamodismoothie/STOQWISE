# Säkerhet och behörigheter

## Hotmodell i korthet

Lagerradar hanterar kundernas lagerdata – i praktiken inköpspriser, marginaler och
leverantörsrelationer. Det som skyddas är (1) att fel organisation aldrig ser
annan organisations data, (2) att en läsare inte kan ändra något, (3) att
API-nycklar inte kan läcka via loggar eller klientkod, och (4) att copiloten
inte kan presentera påhittade siffror som fakta.

## Autentisering

- Lösenord hashas med **scrypt** (Bun:s `Bun.password`) med per-användare-salt.
  Minst 10 tecken. Ingen egen kryptografi.
- Sessioner är slumpade 32-byte-tokens. Endast SHA-256-hashen lagras.
  Cookien `lr_session` är `HttpOnly`, `SameSite=Lax`, `Path=/` och `Secure`
  när applikationen körs över https. Utgång efter 30 dagar, förnyas vid aktiv användning.
- Inloggning svarar med samma fel och samma tidsåtgång för okänt konto och fel
  lösenord.
- Utloggning raderar sessionen i databasen, inte bara cookien.

## CSRF och headers

- Alla muterande formulär kräver `Origin`/`Referer` som matchar `APP_ORIGIN`
  (`isSameOrigin`). Saknas headern nekas begäran.
- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`.
  Ingen inline-JS, ingen extern resurs. `unsafe-inline` gäller endast CSS
  (tema och diagramfärger sätts som CSS-variabler).
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` utan
  kamera/mikrofon/plats.
- All användarinmatning escapas i HTML (`esc`), och CSV-exporter skyddas mot
  formelinjektion (celler som börjar med `=`, `+`, `-`, `@` prefixas).

## Roller

| Behörighet | owner | admin | analyst | viewer |
|---|:--:|:--:|:--:|:--:|
| `data.read` | ✓ | ✓ | ✓ | ✓ |
| `data.write` (import, analys, scenario) | ✓ | ✓ | ✓ | – |
| `data.delete` | ✓ | ✓ | ✓ | – |
| `copilot.use` | ✓ | ✓ | ✓ | ✓ |
| `members.manage` | ✓ | ✓ | – | – |
| `api.manage` | ✓ | ✓ | – | – |
| `org.manage` | ✓ | ✓ | – | – |
| `billing.manage` | ✓ | – | – | – |

`can(role, permission)` i `src/data/repo.ts` är enda källan. Rollen läses från
`members` vid varje begäran – den finns aldrig i cookien. En borttagen medlem
tappar åtkomst omedelbart. Ägaren kan inte tas bort eller degraderas om hen är
den sista ägaren.

## Tenant-isolering

- Varje fråga tar `orgId` och filtrerar i SQL. Inget objekts-ID är ensamt
  behörighetsgivande.
- API:t svarar `404` (inte `403`) när en resurs tillhör en annan organisation.
- Integrationstestet registrerar två organisationer och verifierar att den andra
  varken kan läsa analysen via webben eller via API, samt att en läsnyckel nekas
  skrivning.
- Nedladdningar (PDF/Excel) går genom samma `loadAnalysis(orgId, id)`.

## API-nycklar

- Format `lr_read_…` / `lr_write_…`, 32 byte slump. Endast hash lagras.
- Klartexten visas en gång, i redirecten efter skapandet. Den loggas aldrig och
  skrivs aldrig i HTML efteråt.
- Scope kontrolleras per endpoint (`requireScope(auth, "write")`).
- Rate limit 240 anrop/minut/nyckel. `last_used_at` uppdateras för revision.
- Återkallning sätter `revoked_at`; `findApiKey` accepterar aldrig återkallade nycklar.

## AI-copilotens siffergrind

Copiloten är först en deterministisk motor: intent → beräkning → svar med
`facts` och `sources`. Frivilligt LLM-lager (`AI_API_KEY`) får endast formulera om
texten. `isGrounded(text, allowed)` extraherar varje tal ur svaret och avvisar
det om det inte matchar ett tal som motorn producerat (med tolerans för
avrundning och tal under 100 i löptext). Vid avslag returneras motorsvaret.
Testet `tests/copilot.test.ts` verifierar både att korrekta tal accepteras och
att påhittade tal avvisas.

## Hemligheter

| Variabel | Krävs | Beskrivning |
|---|---|---|
| `SESSION_SECRET` | ja i drift | Signerar sessionsrelaterade värden |
| `APP_ORIGIN` | ja i drift | Exakt origin för CSRF och cookies |
| `AI_API_KEY` | nej | Endast om LLM-omskrivning ska användas |
| `STRIPE_SECRET_KEY` | nej | Endast vid riktig fakturering |
| `PLATFORM_ADMINS` | nej | Kommaseparerade e-postadresser för `/admin` |

Hemligheter hör i miljön, aldrig i repot. `.env` är gitignorerad. Externa
nycklar aktiveras först när kunden/ägaren själv sätter dem; utan dem fungerar
allt utom just den externa tjänsten, och gränssnittet visar det uttryckligen.

## GDPR

- Personuppgifter som lagras: namn, e-post, IP i audit log, samt aggregerad
  lagerdata (inga kundpersonuppgifter från kassasystemet).
- Rättslig grund: avtal (kund) och berättigat intresse (säkerhetslogg).
- Radering: en organisations data raderas per tabell med `org_id`; audit log
  behålls enligt avtal eller max 24 månader.
- Ingen data lämnar EU i standardkonfigurationen. LLM-lagret är avstängt som
  standard och dokumenterar leverantör separat om det slås på.
