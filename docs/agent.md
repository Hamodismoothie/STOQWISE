# Autonom utvecklingsslinga

`scripts/dev-agent.ts` gör arbetaren till en utvecklingsagent: den tar nästa
uppgift från `docs/backlog.json`, låter en riktig kodande agent (Hermes, redan
installerad på datorn) genomföra den, och behåller bara resultatet om projektets
egna grindar passerar.

Den **ersätter inte** `scripts/worker.ts` utan anropas av den: verifieringen körs
först, därefter en utvecklingsuppgift, därefter sov cykeln. Samma launchd-agent
(`ai.stoqwise.worker`) driver båda.

## Kedjan

```
launchd ai.stoqwise.worker
  └─ scripts/worker.ts            var 30:e minut
       ├─ autopilot --quick       typkontroll + smoke (var 6:e timme även hela testsviten)
       ├─ link-check              25 publika sidor + juridiska platshållare
       └─ scripts/dev-agent.ts    en uppgift per cykel
            ├─ flytta iCloud-dubbletter till karantän (aldrig radera)
            ├─ välj nästa pending-uppgift (lägst priority)
            ├─ förkontroll: typkontroll + testsvit måste vara gröna
            ├─ kontrollera modell (cache 6 h)
            ├─ ögonblicksbild: tar, annars filkopia, annars ingen uppgift
            ├─ försök 1…N, ett per reservstrategi:
            │    ├─ hermes chat --oneshot --query-file …
            │    ├─ jämför innehållshashar före/efter
            │    ├─ grind: endast tillåtna filer
            │                ├─ grind: typkontroll + tester (+ uppgiftens `verify`-kommando)
            │    └─ fel → nästa strategi för den feltypen, aldrig samma igen
            ├─ grönt  → git commit (bara agentens filer) + backlog uppdateras
            └─ rött   → selektiv återställning + BLOCKED (eller väntar)
```

## Varför Hermes och inte en egen agent

Hermes Agent v0.23.3 finns redan installerad (`~/.local/bin/hermes`) med
verktygsanrop, `--oneshot`, `--query-file`, `--yolo`, `--max-turns`,
`--run-budget`, `--in` och sessionsåterupptagning. Att bygga en egen
LLM-slinga hade varit en duplicerad agent med egna verktygsdefinitioner. Här
återanvänds den befintliga: vi äger bara **uppgiften, grindarna och
återställningen**.

Providern är Nous Portal, redan autentiserad på datorn med OAuth. Kontot är
`anonymous` och saknar krediter för betalmodeller, så slingan använder de
gratis modeller som samma konto erbjuder:

| Modell | Status |
|---|---|
| `tencent/hy4-flash:free` | standard, klarar verktygsanrop |
| `upstage/solar-mini4:free` | reserv |
| `stepfun/step-3.7-flash:free` | reserv |

Modellen kan bytas med `AGENT_MODEL` (till exempel en betalmodell om kontot får
krediter) utan att någon kod ändras.

### Utbytbar backend (2026-11-25)

Hermes-binären försvann från `~/.local/bin` samma kväll som Fas 0 verifierades.
Varje cykel kastade då `ENOENT` **efter** att uppgiften valts, vilket såg ut som
ett kodfel men var en saknad förutsättning. Motorn äger uppgiften, grindarna och
återställningen; agenten är nu en utbytbar kommandolinje:

| Prioritet | Backend | Kommando | Modell |
|---|---|---|---|
| 1 | `claude` | `claude -p … --output-format json --permission-mode acceptEdits` | Claude Codes egen modell |
| 2 | `codex` | `codex exec --sandbox workspace-write --skip-git-repo-check` | ChatGPT-planens modell |
| 3 | `hermes` | `hermes chat --oneshot --query-file …` | Nous gratismodeller |

`AGENT_CLI` kan tvinga fram en enda backend; annars gäller ordningen ovan och
hälsan per backend sparas i `data/agent/backends.json`. Ett svar klassas som
**kvot** (`usage limit`, `429`, `quota`), **auth** (`401`, inloggning) eller
**saknad binär** (`ENOENT`), och varje klass har sin egen åtgärd:

- kvot eller saknad binär → backend i cooldown 15 min → 45 min → 2 h → 6 h, och
  nästa backend provas **en** gång för samma försök;
- auth → ingen cooldown (det läker inte av sig självt), uppgiften parkeras;
- mitt i en uppgift bryter felet försöksloopen direkt: uppgiften ligger kvar som
  `pending` och **inga strategier förbrukas**;
- är alla backends i cooldown väntar cykeln (`väntar på kvot: …`) utan att välja
  uppgift, så en slut kvot kostar kön ingenting.

### Tidsgräns är inte ett avbrott

Bun dödar en agent som spränger sin `timeout` med SIGTERM, och det registreras som
exit 143 — samma kod som en extern signal. Motorn skiljer dem åt genom att mäta
tiden (`ranOutOfTime`): en körning som tar slut först vid gränsen är ett
**misslyckat försök** och går vidare i strategistegen, medan en signal mitt i
körningen lämnar uppgiften orörd. Utan den skillnaden upprepas en uppgift som
aldrig hinner bli klar i oändlighet — det var d3-06:s 720-sekundersloop.

### Kvittologi: tre sorters pengar

Varje körning skriver en rad i `data/agent/usage.jsonl` (`buildReceipt`):

| Fält | Betyder |
|---|---|
| `tokens` (in/ut/cache) | förbrukning i prenumerationens kvotfönster |
| `billing` | `subscription`, `api` eller `unknown` — avgörs av om `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` finns |
| `actualCostUsd` | **verklig extra kostnad**: 0 i prenumerationsläge, annars CLI:ts `total_cost_usd` |
| `apiEquivalentUsd` | vad samma tokens skulle kosta på API:t (endast Claude rapporterar den) |

`bun scripts/dev-agent.ts --usage` summerar per backend: körningar, output-tokens,
faktisk extra kostnad och API-motsvarighet — siffrorna hålls åtskilda i stället för
att slås ihop till ett "värde". `AGENT_DAILY_MAX` (6) räknar modellkörningar per
dygn i `state.json`.

## Grindar och säkerhet

- **Endast** `src/`, `public/`, `tests/`, `docs/`, `scripts/` får ändras.
- Förbjudna filer: `package.json`, `bun.lock`, `.env*`, `data/`, `docs/backlog.json`,
  `docs/agent-progress.md`, `scripts/dev-agent.ts`, `scripts/worker.ts`.
  Träffar agenten dem återställs hela försöket.
- Prissättning, abonnemang, behörigheter, säkerhetslogik och produktionsdata är
  uttryckligen förbjudna i uppgiftsprompter och ska inte läggas i backloggen.
- Inga nya beroenden, ingen `git push`, ingen deploy, ingen e-post.
- Ändringar jämförs med **innehållshashar**, inte `git status`, eftersom repot
  redan bär ocommittat arbete som annars skulle dölja en ändring.
- Varje lyckad uppgift committas enskilt (bara agentens filer) så att den kan
  rullas tillbaka med `git revert <sha>`. Filer som git ännu inte spårar
  committas inte — de skulle dras in hela och blanda in orelaterat arbete — utan
  skyddas av ögonblicksbilden. Repot bär i dag mycket ocommittat arbete, så
  committen blir exakt så stor som agentens ändring i spårade filer.
- Varje uppgift har en ögonblicksbild i `data/agent/snapshots/` (de fem senaste
  sparas). Först `tar` utan sparse-flaggor, annars en ren filkopia; går ingendera
  startas ingen uppgift. Misslyckas grinden återställs **endast** de filer
  försöket rörde, och **endast** filer som försöket själv skapade tas bort.
- Redigera inte projektet manuellt medan en agentkörning pågår. Körningen jämför
  innehållet före och efter, så en mänsklig ändring mitt i räknas som agentens och
  rullas tillbaka tillsammans med försöket. Låset i `data/agent/run.lock` skyddar
  bara mot en andra agentkörning.
- iCloud-synkade dubbletter ("fil 2.txt") ignoreras i jämförelsen och flyttas
  före varje cykel till `data/agent/quarantine/`; de är synkbrus, inte utveckling.

## Självåterhämtning

Slingan fastnar inte på ett återkommande fel. Varje steg namnger sin feltyp,
och varje feltyp har en ordnad stege av reservstrategier. Strategi 1 används
först, sedan 2, sedan 3. Ett strategi-id som redan misslyckats för uppgiften
används aldrig igen — en ny strategi är alltid en **annan åtgärd**: en
reparationsprompt med det verkliga felutdraget, en annan modell, fler turer,
en snävare filräckvidd eller en omstart från ögonblicksbilden.

| Feltyp | Upptäcks av | Strategi 1 | Strategi 2 | Strategi 3 |
|---|---|---|---|---|
| `snapshot` | `tar`/kopiering eller saknad arkivfil | tar utan sparse-flaggor | filkopia utan externa verktyg | ingen uppgift startas |
| `agent` | exitkod, slut på turer, inga filer ändrade | snävare instruktion | annan modell + fler turer | omstart med en enda fil |
| `guard` | fil utanför uppdraget | upprepa med explicit räckvidd | — (blockeras) | — |
| `typecheck` | `tsc --noEmit` | reparera de exakta felen | annan modell | omstart, enklare lösning |
| `tests` | `bun test` | reparera orsaken i koden | annan modell, enskilt test först | omstart, minimal beteendepåverkan |
| `accept` | uppgiftens `verify`-kommando | reparera mot kommandot | annan modell | — |
| `blocked-task` | agentens `BLOCKED`-svar | — (kräver människa) | — | — |

Ett fel som uppstår efter en grön förkontroll loggas dessutom som **regression**,
eftersom baslinjen då var grön och felet därmed är nytt.

Gränser:

- `AGENT_MAX_ATTEMPTS` (4) försök per uppgift, ett per strategi.
- `AGENT_TASK_WALL_SECONDS` (900) väggklocka; återstår mindre än två minuter
  avbryts uppgiften mjukt och ligger kvar som `pending` — inga strategier har då
  förbrukats i onödan.
- När stegen är slut markeras uppgiften `blocked` med feltyp, antal försök,
  använda strategier, verifieringsresultat och det senaste felet. Slingan går
  vidare med nästa oberoende uppgift; inga prioriteringar ändras.
- En uppgift som en människa sätter tillbaka till `pending` får en ren stege
  igen (historiken nollställs), så en återköad uppgift inte blockeras direkt.
- Utan en fungerande ögonblicksbild startas ingen uppgift alls: en uppgift får
  aldrig påbörjas utan en väg tillbaka.

Återställningen är **selektiv**: bara de filer försöket rörde läses tillbaka ur
arkivet, och bara filer som försöket själv skapade tas bort. En mänsklig ändring
i en annan fil mitt i en körning rullas därför inte tillbaka.

Rapportering per uppgift skrivs till `data/agent/reports/<uppgift>-<tid>.json`
och som en rad i `data/agent/recovery.jsonl`: uppgiftens id, feltyp, använda
strategier, antal försök, verifieringsresultat, ändrade filer och slutstatus.
Samma sammanfattning hamnar i `docs/agent-progress.md` och i arbetarens logg.

## Acceptanskriterier: `verify` och `acceptance`

En uppgift har två fält för samma sak, och de får aldrig blandas:

- `verify` — **ett kommando**, kört från projektroten med `bash -lc`, till exempel
  `bun test tests/motion.test.ts`. Det är den enda delen av acceptansen maskinen
  kör.
- `acceptance` (och det äldre `accept`) — **prosa** som beskriver kriteriet för en
  människa. Den läses och rapporteras, men körs aldrig.
- `manual: true` — en människa måste göra uppgiften. Slingan väljer den aldrig.

Bakgrunden: slingan delade tidigare hela `accept`-texten på mellanslag och körde
den som ett program. En uppgift vars kriterium började med "GET /perf.js svarar
200" körde alltså programmet `GET` och kastade
`Executable not found in $PATH: "GET"` — två cykler i rad, efter att agenten
redan gjort klart arbetet. Nu gäller:

- ett fel i ett `verify`-kommando blir en **check som failar** (`accept`), aldrig
  ett kastat undantag; `run()` fångar även en saknad körbar fil;
- en uppgift som bara har prosa får checken `accept (prosa, ej maskinellt
  verifierad)` i rapporten, så ingen förväxlar "testerna är gröna" med
  "kriteriet är uppfyllt";
- `manual`-uppgifter filtreras bort innan modellen anropas.

Verktyg:

```bash
bun scripts/backlog-lint.ts             # strukturfel (exit 1) och kvalitetsvarningar
bun scripts/backlog-verify.ts           # visa vilka uppgifter som kan få verify
bun scripts/backlog-verify.ts --write   # skriv migreringen (rör aldrig accept-texten)
```

Linten körs före varje uppgift: strukturfel stoppar cykeln innan ett modellanrop
spenderas, varningar loggas. Efter migreringen 2026-11-25 har 97 av 97 väntande
uppgifter ett körbart `verify`; två är parkerade som `manual` (d3-04, qa-08) där
kriteriet bara går att läsa.

## iCloud-dubbletter

iCloud Drive skapar kopior som `tests/arcade.d 2.ts` och `geist-sans-500 3.ttf`.
De är inte källkod men fångas av både `tsc` och testsviten: en enda dubblett
fällde typkontrollen och licenstestet i varje cykel, vilket gjorde att ingen
uppgift kunde bli godkänd. Före varje cykel flyttas därför **äkta** dubbletter
(där originalfilen ligger bredvid) från `src/`, `tests/`, `e2e/`, `public/` och
`scripts/` till `data/agent/quarantine/<tid>/` med ett manifest. Ingenting
raderas, och `docs/` och `data/` lämnas orörda så att anteckningar och
säkerhetskopior stannar där de ligger.

## Styrning

```bash
bun scripts/dev-agent.ts --dry-run     # visa nästa uppgift, ändra inget
bun scripts/dev-agent.ts --once        # kör en uppgift
bun scripts/dev-agent.ts               # arbeta igenom backloggen
bun scripts/dev-agent.ts --propose     # analysera repot och skriv tre förslag
touch data/agent/STOP                  # stoppa slingan mjukt
rm data/agent/STOP                     # starta igen
```

När kön är tom används cykeln till att föreslå nytt: agenten läser `AGENTS.md`,
`docs/arbetsstatus.md` och backloggen, får de tolv senaste `done`-titlarna som
"redan genomfört" och skriver tre små, verifierbara förslag till
`docs/backlog-proposals.md`. Förslagen förs aldrig in i `docs/backlog.json`
automatiskt — omfattning är ett produktbeslut, så en människa väljer vad som ska
köras.

Det finns ingen tidsgräns (24-timmarsspärren togs bort 2026-11-24): första tomma
cykeln skriver förslag, och nästa sats skrivs så snart `docs/backlog.json`
ändrats — det vill säga när en människa har promotat eller avvisat de
föregående. Tills dess står cykeln still med beskedet att förslagen väntar på
granskning, så modellen inte anropas i onödan. Om modellen ändå ger exakt samma
text som förra gången skrivs ingen ny rubrik, utan bara en rad i loggen.

Miljövariabler: `AGENT_CLI` (tvingar fram `claude`, `codex` eller `hermes`),
`CLAUDE_BIN`, `CODEX_BIN`, `AGENT_DAILY_MAX` (6
modellkörningar per dygn), `AGENT_MODEL`, `AGENT_TASK_BUDGET_SECONDS` (600 per agentkörning),
`AGENT_MAX_TURNS` (30), `AGENT_MAX_ATTEMPTS` (4, ett per reservstrategi),
`AGENT_TASK_WALL_SECONDS` (900, väggklocka per uppgift), `WORKER_DEV_AGENT=false`
(stänger av utveckling men behåller verifieringen), `WORKER_AGENT_TASKS` (2,
uppgifter per arbetarcykel), `WORKER_AGENT_MINUTES` (20, tidsbudget per cykel)
och `AGENT_LOOP_LIMIT` (20).

`bun scripts/dev-agent.ts --repair` flyttar iCloud-dubbletter till karantän utan
att köra någon uppgift.

## Tillstånd och återupptagning

- `docs/backlog.json` — uppgifterna. `pending`, `done` eller `blocked`, med
  prioritet, notering, commit och tidpunkt.
- `data/agent/state.json` — vald modell, pågående uppgift, försök per uppgift.
  Innehåller `inFlight` med ögonblicksbild och ändrade filer, så en avbruten
  körning (krasch, omstart) återställs innan nästa uppgift börjar.
- `data/agent/history.jsonl` — en rad per avslutad uppgift (status, strategier,
  ändrade filer).
- `data/agent/recovery.jsonl` och `data/agent/reports/` — rapport per uppgift:
  feltyp, strategier, antal försök, verifieringsresultat och slutstatus.
- `docs/agent-progress.md` — läsbar logg, committas med projektet.
- `data/agent/logs/` — hela agentens utdata per uppgift, plus prompten.
- `data/agent/quarantine/` — iCloud-dubbletter som flyttats undan, med manifest.
- `data/agent/snapshots/` — de fem senaste ögonblicksbilderna (tar eller filkopia).

## Vad slingan inte gör

Den skriver inte nya uppgifter i backloggen, ändrar inte `AGENTS.md`, rör inte
repots ocommittade bas och fattar inga produktbeslut. Den föreslår, implementerar
inom givna ramar, verifierar och loggar. När kön är slut och förslagen är
skrivna fortsätter arbetaren med verifiering tills någon fyller på.

## Läget på den här datorn

Verifierat 2026-11-23: Hermes svarar headless, skapar filer via verktygsanrop
med gratismodell, och hela kedjan (välj uppgift → ögonblicksbild → agent →
hashdiff → grind → commit eller återställning) är körd. Betalmodellerna
(`anthropic/claude-opus-4.6` m.fl.) svarar `insufficient_credits_for_paid_model`
eftersom Nous-kontot är anonymous utan krediter; det är den enda delen som
skulle ge märkbart bättre kodkvalitet.
