
## 2026-11-23 22:16 (tencent/hy4-flash:free)

1. **Sitemappen får inte annonsera en omdirigering** — `PUBLIC_PAGES` i `src/seo.ts` innehåller `/dokumentation`, men servern svarar 301 till `/kom-igang`; då listas en kanonisk adress som inte serverar något dokument. Filer: `src/seo.ts`, `tests/integration.test.ts` (behåll länken i navigering/sidfot, lägg till test som hämtar varje `<loc>` med `redirect: "manual"` och kräver 200). Klart när: `bun run typecheck` och `bun test` är gröna och testet fallerar om `/dokumentation` läggs tillbaka.

2. **Utvecklardokumentationen ska vara noindex** — `/utvecklare` kräver behörighet men `isIndexable()` returnerar true, så sidan får canonical och JSON-LD och robots.txt saknar Disallow för den. Filer: `src/seo.ts`, `tests/integration.test.ts` (lägg till `/utvecklare` i `PRIVATE_PREFIXES`; testet kontrollerar `isIndexable("/utvecklare") === false` och `Disallow: /utvecklare`). Klart när: typkontroll och testsvit gröna och den behöriga sidan bär `<meta name="robots" content="noindex, follow">` i stället för canonical.

3. **Den inloggadeappen behöver egen noindex** — `appShell` i `src/ui/base.ts` förlitar sig enbart på robots.txt; om en appadress delas eller länkas saknar HTML-själva signalen om att den inte ska indexeras. Filer: `src/ui/base.ts`, `tests/integration.test.ts` (ett `<meta name="robots">` i app-head och ett integrationstest som hämtar `/app` med sessionscookie och kräver noindex och frånvaro av canonical). Klart när: `bun run typecheck` och `bun test` gröna och testet fallerar om metatagen tas bort.

## 2026-11-24 07:48 (tencent/hy4-flash:free)

1. **Koppla meta descriptions till de CMS-fält som redan finns** — `site.meta.pricing.description` och `site.meta.contact.description` är registrerade i `src/admin/fields.ts` men läses aldrig: `/priser` använder den synliga ingressen direkt och `/kontakt` faller tillbaka till startsidans beskrivning, medan `/kom-igang` använder `site.meta.about.description`. Redigeringar i CMS får alltså ingen effekt och flera sidor delar fel sökbeskrivning.
   - Varför: en redaktör som ändrar "Kontakt: beskrivning" ser ingen förändring, och sökresultat/sociala delningar visar startsidans eller om-oss-texten på fel adress.
   - Filer: `src/pages/public.ts`, `src/admin/fields.ts` (nytt `site.meta.start.description`), `tests/integration.test.ts`.
   - Klart när: `bun run typecheck` och `bun test` går gröna, och ett integrationstest hämtar `/`, `/priser`, `/kontakt`, `/kom-igang` och `/om-oss` och kräver att varje sida har en egen icke-tom `<meta name="description">` samt att `/kom-igang` inte längre återanvänder om-oss-texten.

2. **Deterministiska id:n i språkväljaren** — `langSwitchSeq` i `src/ui/base.ts` ökar globalt för varje render, så samma sida får olika `id` på `<label>`/`<select>` mellan requests (`lang-sv-4`, `lang-sv-8`), trots att sidan är statisk.
   - Varför: instabil markup försvårar snapshot-/a11y-tester och gör fokusordningen svårare att granska; id:t ska vara en funktion av språk och instans, inte av hur många gånger servern har renderat.
   - Filer: `src/ui/base.ts`, `tests/integration.test.ts`.
   - Klart när: `bun run typecheck` och `bun test` går gröna, och ett test som renderar två språkväljare två gånger visar att samma argument ger samma id varje gång medan de två väljarna på samma sida (mobil/desktop) fortfarande har olika id`.

3. **`aria-current="page"` i den publika navigeringen** — `marketingShell` markerar aktiv sida bara med CSS-klassen `is-active`, medan appens navigering i samma fil sätter `aria-current="page"`.
   - Varför: hjälpmedel kan inte avgöra vilken sida som är aktiv i toppmenyn; samma regel bör gälla på båda ytorna.
   - Filer: `src/ui/base.ts`, `tests/integration.test.ts`.
   - Klart när: `bun run typecheck` och `bun test` går gröna, och ett integrationstest hämtar `/priser`, `/om-oss` och `/produkt` och kontrollerar att länken i `<nav class="site-nav">` som pekar på aktuell sida har `aria-current="page"` och att ingen annan nav-länk har det.

## 2026-11-24 09:14 (tencent/hy4-flash:free)

1. **Autocomplete på kontaktformulärets fält** — Varför: `/kontakt` är det enda publika formuläret där namn, e-post och företag saknar `autocomplete`, medan inloggning och registrering redan har det; det gör ifyllnad långsammare och inkonsekvent. Filier: `src/pages/public.ts`, `tests/integration.test.ts`. Klart när: `autocomplete="name"`, `"email"` och `"organization"` sitter på fälten `#n`, `#e` och `#c`, ett integrationstest kontrollerar det på svensk och engelsk /kontakt, och `bun run typecheck` + `bun test` är gröna.

2. **Skip-länkens mål görs fokuserbart i båda skalen** — Varför: länken "Hoppa till innehåll" pekar på `<main id="main">` utan `tabindex="-1"` i både `marketingShell` och `appShell`, så fokus kan stanna kvar på länken i stället för att landa i huvudinnehållet. Filer: `src/ui/base.ts`, `tests/integration.test.ts`. Klart när: `<main id="main" tabindex="-1">` finns i båda skalen, ett integrationstest hämtar en publik sida och en inloggad appsida och kräver attributet, och `bun run typecheck`, `bun test` samt `bun run test:e2e` (tangentbordstestet) passerar.

3. **Test som skyddar rubrikstrukturen på publika sidor** — Varför: varje publik sida förlitar sig på exakt en `<h1>` för orientering och SEO, men ingen befintlig kontroll fångar en tillagd eller borttappad h1 när CMS-texter eller sidkomponenter ändras. Filer: endast `tests/integration.test.ts`. Klart när: ett test hämtar `/`, `/produkt`, `/priser`, `/om-oss`, `/kontakt`, `/kom-igang`, `/hjalp`, `/integritet`, `/villkor`, `/404` samt `/utvecklare` och räknar `<h1>` till exakt ett per sida, och `bun run typecheck` + `bun test` är gröna.
