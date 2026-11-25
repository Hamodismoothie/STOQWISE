# Arbetsstatus — STOQWISE

Senast uppdaterad: 2026-11-25 (natt).

Det här dokumentet är återupptagningspunkten: en ny session (eller en människa)
ska kunna läsa det här och veta vad som är gjort, vad som är verifierat och vad
som är nästa prioritering. Det ersätter inte `AGENTS.md`, som är bindande.

## Verifierat läge

| Kontroll | Resultat |
|---|---|
| `bun run typecheck` | 0 fel |
| `bun test` | 485 godkända, 1 överhoppad, 0 fel (486 tester, 42 filer) |
| `bun scripts/autopilot.ts` | typkontroll + tester + smoke: alla gröna |
| `bun scripts/link-check.ts` | 25 publika sidor, 0 trasiga länkar |
| launchd `ai.stoqwise.worker` | `state = running`, hjärtslag var 30:e minut, kraschåterstart verifierad |
| Utvecklingsslingan | 13 uppgifter genomförda, verifierade och committade av agenten själv |
| Självåterhämtning | 12 kontrollerade felscenarier i `tests/agent-recovery.test.ts` |

Smoke-steget kontrollerar nu även `/priser`, `/produkt` och `/kontakt`.

## Så fungerar den autonoma slingan

`scripts/worker.ts` verifierar först och låter sedan `scripts/dev-agent.ts` ta en
uppgift från `docs/backlog.json`. Agenten är Hermes (redan installerad) med en
gratismodell på det redan autentiserade Nous-kontot:

| Modell | Roll |
|---|---|
| `tencent/hy4-flash:free` | standard |
| `upstage/solar-mini4:free` | reserv |
| `stepfun/step-3.7-flash:free` | reserv |

Varje försök tar en ögonblicksbild, släpper bara igenom filer under `src/`,
`public/`, `tests/`, `docs/` och `scripts/`, kräver typkontroll + testsvit +
uppgiftens acceptanskontroll, och återställer allt vid minsta fel. Godkända uppgifter committas lokalt (endast agentens filer). Kön fylls på manuellt;
när den är tom föreslår agenten tre nya uppgifter i `docs/backlog-proposals.md` —
utan tidsgräns sedan 2026-11-24, med de senaste `done`-titlarna som kontext, och
en ny sats så snart `docs/backlog.json` ändrats.
Full dokumentation: `docs/agent.md`.

## Kvällens arbete (2026-11-23)

1. **Kanonisk adress och delningsmetadata** — `absoluteUrl()`, canonical, `og:url`,
   `og:image`, `twitter:card`, `noindex` på `/404` och sessionsrutterna.
2. **Delningsbild** `public/brand/stoqwise-og.png` (1200×630) via
   `scripts/make-og.ts`; filservern serverar rasterbilder under `/brand/`.
3. **Balanserad sidfot** med kolumnen Resurser; rutnätet mätt vid 1440/1280/1100/
   1000/760/390 px utan tomma spår eller overflow.
4. **Driftvakt** för ofyllda juridiska platshållare (35 + 13 kända) i arbetaren.
5. **Autonom utvecklingsslinga** — backlog, Hermes-integration, lås,
   ögonblicksbilder, hashbaserad ändringsdetektering, grindar, commit och
   återupptagning.
6. **Fyra agentuppgifter** genomförda och committade: fler sidor i smoke-testet
   (`a76246d`), sitemap utan dubbla snedstreck + test (`f5b8b2b`), test som
   skyddar sidfotens länkar (`9486f76`), JSON-LD för Organization/WebSite
   (`c4486f6`). Testsiffran steg från 460 till 463.

## Självåterhämtande arbetsmotor (2026-11-25)

Slingan fastnade tidigare av två skäl som båda var miljöfel, inte kodfel:

1. `tar --no-read-sparse` fallerade på iCloud-volymen med
   `lseek(SEEK_HOLE) failed: Resource deadlock avoided`. Varje cykel kastade
   därför innan någon uppgift startade (cykel 56–58).
2. 614 iCloud-dubbletter (`tests/arcade.d 2.ts`, `newsreader-400-italic 2.ttf`
   m.fl.) fällde typkontrollen och licenstestet. Ingen uppgift kunde någonsin
   bli grön, hur bra agentens ändring än var.

Båda är åtgärdade i `scripts/dev-agent.ts`:

- **Feldetektering per steg** — `snapshot`, `agent`, `guard`, `typecheck`,
  `tests`, `accept` och `blocked-task`. Fel efter en grön förkontroll loggas som
  regression.
- **Reservstrategier i stege** — varje feltyp har 1–3 olika åtgärder (reparera
  med det verkliga felutdraget, annan modell, fler turer, snävare räckvidd,
  omstart från ögonblicksbilden). Samma strategi-id används aldrig två gånger.
- **Begränsade försök** — `AGENT_MAX_ATTEMPTS` (4) och en väggklocka på 900 s;
  tidsbrist lämnar uppgiften som `pending` utan att bränna strategier.
- **Säker återställning** — selektiv: bara försökets filer läses tillbaka, bara
  försökets nyskapade filer tas bort. Utan ögonblicksbild startas ingen uppgift.
- **BLOCKED med bevis** — feltyp, antal försök, använda strategier,
  verifieringsresultat och felet, plus `data/agent/reports/<id>-<tid>.json`.
- **Förkontroll** — röd typkontroll eller testsvit före uppgiften stoppar
  utvecklingen med ett exakt besked i stället för att bränna modellanrop.
- **Dubblettkarantän** — äkta iCloud-dubbletter flyttas (aldrig raderas) till
  `data/agent/quarantine/<tid>/` med manifest, före varje cykel.

De fyra uppgifterna `d3-01` och `d3-02` blockerades av miljöfelet ovan och är
återköade till `pending` med oförändrad prioritet.

## Kända luckor och nästa prioriteringar

1. **Betalmodell för bättre kodkvalitet.** Nous-kontot är `anonymous` utan
   krediter, så slingan kör gratismodeller. De klarar små, avgränsade uppgifter
   men är svagare på större refaktoreringar. Antingen krediter på
   portal.nousresearch.com eller en nyckel till en annan leverantör
   (`AGENT_MODEL` + `hermes auth`) höjer kvaliteten utan kodändring.
2. **Basen är ocommittad.** Repot har ett stort antal ocommittade filer från
   tidigare arbete. Agenten committar bara filer som git redan spårar (plus egna
   nya filer), så ändringar i ospårade filer skyddas av ögonblicksbilden i
   stället för av git. En samlad bascommit skulle göra återrullning enklare.
3. **Karantänen bör städas** — 614 iCloud-dubbletter ligger i
   `data/agent/quarantine/`; när ägaren bekräftat att originalen är de rätta kan
   mappen tas bort manuellt.
4. **Sidfotens socialikon på mobil** — verifiera i webbläsare vid 390 px.
5. **Prestanda** — baslinjen finns i `docs/prestanda.md` (LCP 212 ms på `/`,
   960 ms på `/produkt`, CLS 0). Optimera bara om en ny mätning visar behov.
6. **Fler uppgifter i kön** — `docs/backlog-proposals.md` fylls på automatiskt när
   kön är tom; granska och flytta de som är värda att köra till `docs/backlog.json`.

## Så återupptas arbetet

```bash
cd "/Users/mohammadalkakouni/Library/Mobile Documents/com~apple~CloudDocs/Downloads/STOQWISE"
cat AGENTS.md docs/arbetsstatus.md docs/agent.md
tail -n 40 data/autopilot/worker-$(date +%F).log
launchctl print gui/$(id -u)/ai.stoqwise.worker | head -20
bun scripts/dev-agent.ts --dry-run
bun scripts/autopilot.ts
```

Om ett steg misslyckas: läs `data/autopilot/last-run.json` och
`data/agent/history.jsonl`, åtgärda grundorsaken, kör om samma steg. Dokumentera
blockeringen här och gå vidare till nästa punkt i stället för att stanna.

## Gränser som gäller

Arbetet får inte ändra affärslogik, prissättning, abonnemang, behörigheter,
produktionsdata eller göra produktionsdistributioner utan uttryckligt uppdrag.
Inget pushas eller deployas. Arbetaren rör ingen produktionsdata och skickar
ingen e-post.
