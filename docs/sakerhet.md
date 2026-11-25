# Säkerhet och behörigheter

## Hotmodell i korthet

Lagerradar hanterar kundernas lagerdata – i praktiken inköpspriser, marginaler och
leverantörsrelationer. Det som skyddas är (1) att fel organisation aldrig ser
annan organisations data, (2) att en läsare inte kan ändra något, (3) att
API-nycklar inte kan läcka via loggar eller klientkod, och (4) att copiloten
inte kan presentera påhittade siffror som fakta.

## Autentisering

- Lösenord hashas med **scrypt** (`node:crypto`) med per-användare-salt och
  konstant-tids-jämförelse. Minst 10 och högst 200 tecken. Ingen egen kryptografi.
- Sessioner är slumpade 32-byte-tokens. Endast SHA-256-hashen lagras. Cookien
  `lr_session` är `HttpOnly`, `SameSite=Lax`, `Path=/` och `Secure` när
  `NODE_ENV=production` eller `APP_ORIGIN` är https. Fast utgång efter 14 dagar;
  det finns ingen förnyelse eller separat idle-timeout.
- Inloggning svarar med samma fel och kör alltid scrypt (även för okänt konto),
  så svarstiden inte avslöjar om e-postadressen finns. Rate limit finns separat
  per IP och per konto.
- Utloggning raderar sessionen i databasen, inte bara cookien.

## CSRF och headers

- Alla muterande formulär kräver `Origin`/`Referer` som matchar `APP_ORIGIN`
  (`isSameOrigin`). Saknas båda, eller är `Origin: null`, nekas begäran. Det
  gäller även utloggning, medlemsborttagning och webhook-radering.
- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`.
  Ingen inline-JS, ingen extern resurs. `unsafe-inline` gäller endast CSS
  (tema och diagramfärger sätts som CSS-variabler).
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` utan
  kamera/mikrofon/plats.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy:
  same-origin`, `X-Permitted-Cross-Domain-Policies: none` och HSTS när appen
  körs över https.
- All användarinmatning escapas i HTML (`esc`), och CSV-exporter skyddas mot
  formelinjektion (`csvCell` prefixar celler som börjar med `=`, `+`, `-`, `@`,
  tabb eller CR med apostrof; numeriska negativa tal förblir numeriska).

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
tappar åtkomst omedelbart och alla dennes sessioner raderas. En användare kan
aldrig ändra sin egen roll, tilldela en roll som är lika hög som eller högre än
sin egen, ändra en medlem med högre rang, ta bort ägaren eller bjuda in en ny
ägare. Teamvyn kräver `members.manage`.

## Tenant-isolering

- Varje fråga tar `orgId` och filtrerar i SQL. Inget objekts-ID är ensamt
  behörighetsgivande.
- API:t svarar `404` (inte `403`) när en resurs tillhör en annan organisation.
- Integrationstestet registrerar två organisationer och verifierar att den andra
  varken kan läsa analysen via webben eller via API, samt att en läsnyckel nekas
  skrivning.
- Nedladdningar (PDF/Excel) går genom samma `loadAnalysis(orgId, id)`.
- Copilot-konversationer är scopade både på organisation och användare. Ett
  samtal som tillhör en annan användare eller en annan analys kan inte läsas
  eller användas som mål för nya meddelanden.

## API-nycklar

- Format `lr_read_…` / `lr_write_…`, 32 byte slump. Endast hash lagras.
- Klartexten visas en gång, i redirecten efter skapandet. Den loggas aldrig och
  skrivs aldrig i HTML efteråt.
- Scope kontrolleras per endpoint (`requireScope(auth, "write")`).
- Rate limit 240 anrop/minut/nyckel. `last_used_at` uppdateras för revision.
- Återkallning sätter `revoked_at`; `findApiKey` accepterar aldrig återkallade nycklar.

## AI-copilotens siffergrind

Copiloten är först en deterministisk motor: intent → beräkning → svar med
`facts` och `sources`. Frivilligt LLM-lager får endast formulera om texten och
aktiveras bara när både `AI_API_KEY` och `AI_DATA_PROCESSING_APPROVED=true` finns.
En nyckel ensam är alltså inte samtycke till extern behandling. `isGrounded(text,
allowed)` extraherar varje tal ur svaret och avvisar det om det inte matchar ett
tal som motorn producerat (med tolerans för avrundning och tal under 100 i
löptext). Vid avslag returneras motorsvaret. Dokumentera leverantör, region,
överföringsmekanism och DPA innan flaggan sätts.
Testet `tests/copilot.test.ts` verifierar både att korrekta tal accepteras och
att påhittade tal avvisas.

## Hemligheter

| Variabel | Krävs | Beskrivning |
|---|---|---|
| `SESSION_SECRET` | reserverad | Används inte av nuvarande sessioner; slumpade tokens hashas i databasen |
| `APP_ORIGIN` | ja i drift | Exakt origin för CSRF och cookies |
| `TRUST_PROXY` | nej | Endast `true` bakom betrodd proxy som skriver över `X-Forwarded-For` |
| `AI_API_KEY` | nej | Endast om LLM-omskrivning ska användas |
| `AI_DATA_PROCESSING_APPROVED` | nej | Krävs utöver nyckeln för extern AI-behandling |
| `STRIPE_SECRET_KEY` | nej | Endast vid riktig fakturering |
| `PLATFORM_ADMINS` | nej | Kommaseparerade e-postadresser för interna pris-/ekonomiytor i kundappen; `/admin` har separata konton |
| `ADMIN_SETUP_TOKEN` | endast första admin | Engångstoken (minst 16 tecken) för att skapa första `/admin`-kontot; ta bort efteråt |

Hemligheter hör i miljön, aldrig i repot. `.env` är gitignorerad. Externa
nycklar aktiveras först när kunden/ägaren själv sätter dem; utan dem fungerar
allt utom just den externa tjänsten, och gränssnittet visar det uttryckligen.

## GDPR

- Personuppgifter som lagras: namn, e-post, IP i audit log, samt aggregerad
  lagerdata (inga kundpersonuppgifter från kassasystemet).
- Rättslig grund: avtal (kund) och berättigat intresse (säkerhetslogg).
- Radering: "Radera alla analyser" tar bort artikelrader, analyser, importer,
  scenarier, sparade vyer och copilot-konversationer för organisationen i en
  transaktion. Audit log och kontouppgifter behålls; det finns ännu ingen
  självbetjäningsfunktion för att radera hela kontot. Audit log har ingen
  automatisk gallring – lagringstiden måste beslutas och verkställas i drift.
- Ingen data lämnar EU i standardkonfigurationen. LLM-lagret är avstängt som
  standard och kräver uttryckligt godkännande enligt ovan.

## Kvarstående risker (måste hanteras i drift)

- **Kryptering i vila saknas:** SQLite-filen och dess WAL är okrypterade. Använd
  krypterad volym eller krypterad databastjänst; testa återläsning av backup.
- **Backup är en manuell rutin:** `VACUUM INTO` finns dokumenterad men schemaläggs
  inte av appen. Backuper ska krypteras, åtkomstbegränsas och roteras.
- **E-postverifiering, lösenordsåterställning, självbetjäning för lösenordsbyte
  och kund-2FA saknas.** Det kräver e-postleverantör och är inte påhittat som
  "klart". Admin-2FA finns separat.
- **TOTP- och webhookhemligheter ligger plaintext i databasen.** Ett
  databasläckage kan därför ge lösenordshashar, TOTP-fröer och
  webhooksigneringsnycklar. Kryptera fälten med en nyckel från
  KMS/hemlighetshanterare innan produktion med verkliga kunder.
- **Rate limits är per process och i minne.** Flera instanser kräver delad
  räknare (Redis) eller regler i lastbalanseraren. Kontobaserad inloggningsgräns
  kan också användas för att tillfälligt låsa ett konto (medveten avvägning).
- **API-nycklar har ingen utgång och ingen IP-begränsning.** Rotera dem och
  återkalla vid misstanke; överväg utgångsdatum och scopes per endpoint.
- **Webhook-SSRF har ett DNS-rebinding-fönster** mellan uppslagning och anrop.
  Redirects följs inte och privata adresser blockeras, men en betrodd egress-proxy
  med statisk allowlist är starkare.
- **Ingen central audit-gallring eller incidentprocess i koden.** Bestäm
  lagringstid, åtkomst och larm; dokumentera kontaktväg och 72-timmarsrutin.
