# Den publika SEO-kedjan

Detta dokument förklarar hur de publicerbara sidorna får sina SEO-märkningar och
hur `robots.txt`, `sitemap.xml`, kanoniska länkar och strukturerad data hänger
ihop. Allt kommer från en modul: `src/seo.ts`. Läs det här innan du lägger till
en publik sida eller ändrar en adress.

## En adress per sida

Språket väljs med en cookie (`resolveLocale()` i `src/server.ts`), inte med en
URL-del. Därför finns ingen `/sv/…` och ingen `/en/…` – varje sida har exakt en
adress och behöver ingen `hreflang`-uppsättning. `og:locale` sätts däremot per
språk i `marketingShell()`.

Det som däremot varierar är **query-strängen**: `/produkt?miljo=industri`,
`/kontakt?amne=support` och liknande. Parametrarna styr en *vy* av sidan, inte
ett eget dokument. Därför strippas allt efter `?` och `#` i `absoluteUrl()`.
Om query-strängen fick följa med skulle samma innehåll kunna nås på obegränsat
många adresser: rankningssignaler delas upp, sociala delningar pekar på olika
URL:er och sitemappen får dubletter. Nu pekar `canonical`, `og:url`, `sitemap.xml`
och den strukturerade datan på samma normaliserade adress.

`absoluteUrl()` gör tre saker, i ordning:

1. klipper bort query och fragment;
2. slår ihop dubbla snedstreck (`//` → `/`);
3. tar bort avslutande snedstreck, utom på roten (`/`).

Den privata hjälparen `origin()` tar bort avslutande snedstreck från
`config.appOrigin` innan adresserna sätts ihop. Det är därför en origin som slutar
med `/`, `//` eller `///` inte ger dubbla snedstreck i sitemappen. Ursprunget
kommer från `APP_ORIGIN` (eller `http://localhost:$PORT` lokalt).

## Vem äger vad

| Del | Ägare | Kommentar |
|---|---|---|
| Lista över indexerbara sidor | `PUBLIC_PAGES` i `src/seo.ts` | Matar `sitemapXml()` |
| Lista över privata rutprefix | `PRIVATE_PREFIXES` i `src/seo.ts` | Matar `robotsTxt()` och `isIndexable()` |
| Absolut, normaliserad adress | `absoluteUrl()` | Enda adressbyggaren i systemet |
| `canonical`, `og:url`, `og:image` | `marketingShell()` i `src/ui/base.ts` | Anropar `absoluteUrl()` |
| `robots`-meta, JSON-LD-block | `marketingShell()` i `src/ui/base.ts` | Styrs av `isIndexable()` |
| `robots.txt`, `sitemap.xml` | `robotsTxt()`, `sitemapXml()` i `src/seo.ts` | Serveras som rutter i `src/server.ts` |
| Strukturerad data (innehållet) | `structuredDataJsonLd()` i `src/seo.ts` | `Organization` + `WebSite` |

`marketingShell()` får sidans sökväg i `path`. Varje publik sida skickar sin
egna, bokstavliga sträng (`"/"`, `"/priser"`, `"/produkt"` …), och
`notFoundPage()` skickar `"/404"`. Av den strängen räknas `canonical` och
`indexable` ut:

- indexerbar sida → `<link rel="canonical">` **och** `<script type="application/ld+json">`;
- icke-indexerbar sida → `<meta name="robots" content="noindex, follow">`, och
  varken canonical eller JSON-LD.

`og:title`, `og:url`, `og:description`, `og:image` (1200×630) och de motsvarande
Twitter-taggarna skrivs alltid, även på sidor med `noindex`. Bilden pekas ut av
`OG_IMAGE_PATH` (`/brand/stoqwise-og.png`), som genereras av
`scripts/make-og.ts`. Logotypen i JSON-LD pekas ut av `LOGO_PATH`
(`/brand/stoqwise-logo.svg`).

`structuredDataJsonLd()` innehåller avsiktligt bara namn, logotyp och adress –
allt annat vore påhittat. Adresserna byggs med `absoluteUrl()`, samma funktion
som canonical och sitemap använder, så de tre kan inte glida isär. JSON:et
escapar `<` till `\u003c` så att en oväntad teckenföljd i app-origin inte kan
avsluta `script`-elementet i HTML:en.

## robots.txt och sitemap.xml

Båda genereras i `src/server.ts` (`/robots.txt` och `/sitemap.xml`) från
funktionerna i `src/seo.ts`; ingen av filerna är en statisk fil på disk.

`robotsTxt()` skriver `User-agent: *`, `Allow: /`, en `Disallow`-rad per
`PRIVATE_PREFIXES` och till sist `Sitemap: <origin>/sitemap.xml`. Sitemap-raden
gör att crawlern hittar kartan utan att behöva gissa adressen.

`sitemapXml()` går igenom `PUBLIC_PAGES`, kör varje sökväg genom
`absoluteUrl()` och XML-escapar värdet. Det finns alltså bara en förteckning
över vilka publika sidor som ska crawlas. Notera att `/dokumentation` finns i
listan trots att rutten gör en 301 till `/kom-igang` – både målet och den gamla
adressen är alltså med i kartan.

## Varför /404 och sessionsrutterna får noindex

`isIndexable()` är den enda domänen för detta. Den klipper först bort query och
fragment och gör sedan två saker:

- `/404` är alltid icke-indexerbart. Sidan används både för okända adresser
  (fallbacken längst ned i `src/server.ts`) och för ogiltiga inbjudningar och
  saknade objekt. Att indexera den skulle fylla sökresultaten med tunna
  felsidor som dessutom visas på många olika adresser. Den får i stället normalt
  HTTP 404 + `noindex, follow`.
- Allt som matchar ett prefix i `PRIVATE_PREFIXES` (`/app`, `/admin`, `/api/`,
  `/logga-in`, `/logga-ut`, `/skapa-konto`, `/glomt-losenord`) är icke-indexerbart.
  Rutterna kräver session, returnerar JSON eller visar användarspecifikt
  tillstånd och har inget värde i ett sökindex. `/api/` har avslutande
  snedstreck och matchas därför som prefix; övriga matchas exakt eller som
  underväg (`/app/…`).

Valet av `noindex, follow` i stället för `nofollow` är medvetet: crawlern får
inte spara sidan, men får fortfarande följa länkar vidare ut på den publika
ytan. Adminvyerna i `src/admin/pages.ts` använder en egen skal med
`noindex, nofollow` och går inte genom `marketingShell()`.

`robots.txt` kompletterar men ersätter inte metataggen: `Disallow` hindrar
crawlning, medan `noindex` hindrar indexering av en sida som redan är crawlad.
Därför finns båda. `/404` behöver ingen `Disallow`-regel – HTTP-statusen och
metataggen räcker.

## Så lägger du till en ny publik sida

Det finns ingen automatisk koppling från routern till SEO-listorna. Tre ställen
måste hålla ihop:

1. **Routen** i `src/server.ts`: `router.get("/ny-sida", …)` som renderar sidan
   med `pageLocale(ctx)`.
2. **Sidfunktionen** i `src/pages/public.ts`: anropa `marketingShell()` med
   `path: "/ny-sida"`. Strängen är bokstavlig och är den som blir canonical och
   `og:url`. Glömmer du `path` faller den tillbaka på `"/"` och sidan får fel
   kanonisk adress.
3. **Listan** `PUBLIC_PAGES` i `src/seo.ts`: lägg till samma sträng så hamnar
   sidan i `sitemap.xml`. `robots.txt` behöver normalt ingen ändring – `Allow: /`
   gäller allt som inte är privat.

Om sidan i stället är inloggnings- eller API-relaterad: lägg prefixet i
`PRIVATE_PREFIXES`, inte i `PUBLIC_PAGES`. Då sätts `noindex` automatiskt och
`robots.txt` får en `Disallow`-rad.

Till sist: lägg till ett fall i `tests/integration.test.ts` som kontrollerar att
den nya adressen finns i sitemappen och att sidan har canonical/og:url mot sig
själv samt saknar `noindex`. Testerna är skyddet mot att listorna glider isär.
Kör `bun run typecheck` och `bun test` innan du är klar. Ny synlig text ska följa
det vanliga mönstret med `cmsText()` och finnas i både svensk och engelsk
katalog i `src/i18n.ts`.
