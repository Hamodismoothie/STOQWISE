# Autopilot — löpande kontroll av STOQWISE

Autopilot är projektets **verifieringscykel**: den kör typkontroll, testsviten och
en riktig uppstart av servern mot en temporär databas, och skriver ett spårbart
resultat. Den är byggd för att ett obemannat arbetspass — eller en människa som
kommer tillbaka nästa morgon — ska kunna se exakt vad som hände utan att gissa.

Den **ändrar ingen kod**, **rör ingen produktionsdata** och **deployar inget**.

## Vad ett pass gör

| Steg | Kommando/innehåll | Tidsgräns |
|---|---|---|
| `typecheck` | `bun run typecheck` (strict, `tsc --noEmit`) | 3 min |
| `test` | `bun test` (enhets- och integrationstester) | 10 min |
| `smoke` | Startar `src/server.ts` på port `3996` med `DB_PATH=data/autopilot/smoke.db`, hämtar `/halsa`, `/`, `/om-oss`, `/robots.txt` och `/sitemap.xml`, stänger servern | 25 s uppstart |

`--quick` hoppar över testsviten och kör bara typkontroll + smoke.

Ett pass i taget: en låsfil (`data/autopilot/run.lock`) med pid och tidsstämpel
förhindrar samtidiga körningar. Ett låst pass som är äldre än två timmar eller
vars process inte längre lever tas över automatiskt, så ett avbrott låser inte
cykeln.

## Loggar och återupptagning

- `data/autopilot/YYYY-MM-DD.jsonl` — en rad per pass med alla steg, tider och
  utfall. Append-only, så historiken går att läsa bakåt.
- `data/autopilot/last-run.json` — senaste passet i läsbar form.
- `data/autopilot/run.lock` — försvinner när passet är klart; finns den kvar har
  ett pass avbrutits och kan köras om direkt.

Exitkod `0` betyder att alla steg var gröna, `1` att något misslyckades (detaljer i
loggen) och `2` att ett annat pass redan körde.

## Manuell körning

```bash
bun scripts/autopilot.ts          # full cykel
bun scripts/autopilot.ts --quick  # snabb: typkontroll + smoke
```

## Schemaläggning — installerad launchd-agent

Sedan 2026-11-23 finns en beständig användaragent på datorn:

| Del | Värde |
|---|---|
| Label | `ai.stoqwise.worker` |
| Plist | `~/Library/LaunchAgents/ai.stoqwise.worker.plist` |
| Program | `<projekt>/scripts/worker.ts` via `~/.bun/bin/bun` |
| Start | vid inloggning (`RunAtLoad`) och vid krasch (`KeepAlive`, minst 30 s mellan försök) |
| Loggar | `data/autopilot/worker.out.log`, `worker.err.log` och `data/autopilot/worker-YYYY-MM-DD.log` |

Arbetaren (`scripts/worker.ts`) kör i en oändlig cykel:

1. `scripts/autopilot.ts --quick` var `WORKER_CYCLE_MINUTES` (standard 30) minut.
2. Full svit (`bun test`) var `WORKER_FULL_EVERY_HOURS` (standard 6) timme.
3. Publik länkkontroll mot en temporär server på port `3997` var
   `WORKER_LINK_EVERY_HOURS` (standard 12) timme, samt räkning av ofyllda
   `[FYLL I …]`-fakta på `/integritet` och `/villkor`. Summan skrivs i hjärtat och
   en varning loggas om antalet ökar sedan föregående crawl.

Efter varje cykel skrivs `data/autopilot/heartbeat.json` (pid, cykelnummer, utfall,
nästa körning) och `data/autopilot/worker-state.json` (räknare och tidsstämplar).
En död process syns direkt: `launchctl print gui/$(id -u)/ai.stoqwise.worker`
visar `state = running` och en färsk pid, och hjärtat slår var 30:e minut.

### Installation, kontroll och borttagning

```bash
bash scripts/install-launchd.sh                      # skriver plist, laddar, väntar på hjärtslag
launchctl print gui/$(id -u)/ai.stoqwise.worker      # state, pid, antal körningar
tail -f data/autopilot/worker-$(date +%F).log        # cykellogg
launchctl bootout gui/$(id -u)/ai.stoqwise.worker     # stoppa
rm ~/Library/LaunchAgents/ai.stoqwise.worker.plist    # ta bort helt
```

Installerat och verifierat 2026-11-23: agenten laddades, första cykeln var grön
(autopilot + 25 sidor länkkontroll), och efter `kill -9` på arbetsprocessen
startade launchd om den med ny pid inom 45 sekunder.

Datorn måste vara på och användaren inloggad; launchd kör ikapp på vaket läge men
kan inte köra medan maskinen sover. E-post, produktionsdata och deploy berörs inte.

## Vad autopilot inte är

Autopilot och arbetaren ersätter inte utvecklaren. De upptäcker regressioner,
verifierar att appen bootar och lämnar ett spår — men de skriver ingen ny kod och
fattar inga produktbeslut. Själva utvecklingsarbetet sker i en aktiv session som
läser `AGENTS.md`, `docs/arbetsstatus.md` och loggen, och fortsätter där det senast
slutade. Arbetaren håller vakt mellan passen; den utvecklar inte själv.
