# Designriktning — Stoqwise (Lagerbok)

Detta dokument är art direction, inte dekoration. Varje val nedan har ett skäl, och
skälet ska gå att säga högt i ett kundmöte.

## Utgångspunkt

Stoqwise säljer en enda sak: **kapital som står stilla**. Produkten räknar ut var
pengar sitter fast, vad de kostar per dag och vad som händer om man flyttar dem.
Det är ett finansiellt och operationellt verktyg — inte en marknadsföringssajt.

Därför är den bärande metaforen **lagerboken**: den svenska handelsbokens rad för
rad, där varje artikel är en post och varje post har ett belopp. Boken är
precis, granskbar och lugn. Den är också motsatsen till det som gör SaaS-gränssnitt
generiska: flytande kort, mjuka skuggor, slumpmässiga gradienter och en hero som
ser ut som alla andra.

## Tre prövade riktningar

### A. Lagerbok — vald
**Koncept:** en svensk finanspublikation möter ett kalibrerat mätinstrument.
Papper, bläck och oxiderad koppar. Tunna regler i stället för kort. Folionummer,
marginalanteckningar och tabellsiffror som bär hela hierarkin.

- **Färg:** varmt papper `#F4F0E6`, bläck `#16180F`, koppar `#96482A`, tall `#234A38`,
  roströd `#8A2F1E`. Mörkt läge: arkivbläck `#101209` med benvit text.
- **Typografi:** Newsreader (editorial röst, rubriker och citat), Schibsted
  Grotesk (gränssnitt och etiketter), Geist Mono (belopp, SKU, tidsstämplar).
- **Layout:** 12-kolumns rutnät med hårlinjer, asymmetrisk vänstermarginal,
  sektionsfolio, stora negativa ytor kring viktiga beslut.
- **Navigation:** typografiskt index i vänsterkolumnen — nummer + namn, ingen ikonrad.
- **Visualisering:** "graverad" data — 1 px linjer, punktad prognos, skrafterad
  osäkerhetsyta, koppar som enda accent, etiketter i mono.
- **Rörelse:** pappersliknande, 160–420 ms, inga studs. Siffror rullar, linjer ritas.
- **Landing:** en redaktionell förstasida med masthead, platta I–III och noter —
  inte hero + skärmbild.
- **Dashboard:** en liggare i stället för ett kortbord: siffror på regler, sektioner
  med folio, åtgärder som rader.

**Varför den vinner:** den är kategoriskt sann (lagerbok är ett riktigt begrepp i
svensk handel), den gör exakta belopp vackra i stället för att gömma dem i kort,
och den är omedelbart igenkännbar i en marknad där alla andra är mörka dashboards
med lila gradienter. Den fungerar lika bra i styrelserummet som på lagergolvet.

### B. Instrument
**Koncept:** industrialism och mätteknik. Grafit, fosforgul och säkerhetsorange;
kondenserade versaler, täta tabeller, oscilloskopliknande kurvor, rutnät som i en
kontrollpanel. Densiteten är poängen: allt samtidigt, allt kalibrerat.
**Varför den inte valdes:** imponerande men tröttande över en arbetsdag, och den
låser produkten till "lagerlokal" i stället för "ekonomichefens bord".

### C. Atlas
**Koncept:** arkitektonisk kartografi. Benvit och ultramarin, enorma tomma ytor,
hårlinjer, planritningar och isometriska flödesdiagram, allt i en grotesk.
**Varför den inte valdes:** vackert för en rapport, men för tunt för daglig
operativ användning och för nära den minimalistiska SaaS-estetik som redan finns.

## Varumärket

**Logotypen är levererad av uppdragsgivaren** och ersätter den tidigare skissen
"den hållna raden". Den används exakt som levererad: `public/brand/` innehåller
originalets SVG-filer oförändrade, och gränssnittet refererar dem som bilder så
att ingen kod kan rita om dem. Märkets guld (`#C8A66A`) är den enda guldtonen i
systemet; gränssnittets accent är fortfarande oxiderad koppar (`#96482A`) — två
toner av samma metall, där guldet bär märket och kopparn bär betydelsen.

**Hantering:** pappersplatta endast i mörkt läge, aldrig omfärgning, aldrig
cirkel, aldrig sträckning. Detaljer i `docs/varumarke.md`.

**Typografisk regel:** serifen talar, grotesken förklarar, monon räknar. Ingen
blandning utan skäl.

**Röst:** saklig, svensk, sifferdriven. Inga superlativ i produkten; beloppen är
argumentet.

## Typografi i detalj

| Roll | Typsnitt | Användning |
|---|---|---|
| Display | Newsreader 300/400 + kursiv | Förstasidans statement, sidrubriker, citat, sektionsnummer |
| Editorial | Newsreader 400 | Ingresser, förklaringar, rapporttext |
| Interface | Schibsted Grotesk 400/500/700 | Navigation, knappar, etiketter, tabeller |
| Data | Geist Mono 400/500 | Belopp, antal, procent, datum, SKU, axlar |

Alla tre är Open Font License och serveras lokalt från `public/fonts/` med
licenstext. Ingen proprietär font påstås vara licensierad.

Sifferregler: tabular-nums överallt, `-0.03em` spärrning på stora belopp, enhet i
mindre grad än talet, alltid hårt mellanslag mellan tal och enhet.

## Färg och kontrast

Koppar används som enda accent och aldrig som stor yta. Den bär markering,
aktivt läge och den enda siffran som ska läsas först. Tall och roströd används
endast för positiva respektive kritiska tillstånd. WCAG 2.2 AA verifieras för
text mot papper; fokusmarkering är 2 px koppar med 2 px offset.

## Rörelse

| Token | Värde | Används till |
|---|---|---|
| `--t-fast` | 140 ms | Hover, fokus, små tillstånd |
| `--t-base` | 240 ms | Paneler, rader, meny |
| `--t-slow` | 420 ms | Sidointräde, grafer |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | In, avslut |
| `--ease-inout` | `cubic-bezier(.65,0,.35,1)` | Lägesbyten |

Ingen rörelse är dekorativ: den förklarar var data kommer ifrån, vad som ändrades
eller vad som är klickbart. `prefers-reduced-motion` stänger av allt utom
färg- och opacitetsbyten.

## Granskning och iterationer

Arbetet drevs i rundor. Varje runda avslutades med en kritisk genomgång i
webbläsaren vid 991 px och 390 px, och det som inte höll måttet ändrades.

| Runda | Vad som gjordes | Vad granskningen hittade | Åtgärd |
|---|---|---|---|
| 1 | Tre riktningar: Lagerbok, Instrument, Atlas | Instrument var tröttande över tid, Atlas för tunt operativt | Lagerbok valdes |
| 2 | Typografi, färg, symbol, favicon, rörelsetoken | Fyra typsnitt kräver tydliga roller, annars blir allt serif | Roller lästa i tabell och tillämpade |
| 3 | `v3.css` med tokens, skal, tabeller, formulär, diagram | Kortlayouten återkom i dashboarden | Nyckeltal blev liggare med hårlinjer i stället för kort |
| 4 | Landning, dashboard, trädkarta, hälsoband | Trädkartan blev beige och otydlig; två KPI:er per rad såg tomt ut | Färgskala relativ till värsta kategori; brytpunkter 1180/1040/620 |
| 5 | Artiklar, prognos, simulering, copilot, priser | Reglage kollapsade; priskorten saknade liststil; copilot visade förslag två gånger | Reglage i tre kolumner; priskort med folio och liststil; dubblett borttagen |
| 6 | Auth, onboarding, 404, 500, mobil | Auth låg kvar i gamla mallen; rubriken krockade i mobil | Ny auth-komposition, onboarding som steglista, rubrik utan radbrytning i mobil |

Kvar att granska vid nästa runda: importflödet med verklig fil, artikelns
detaljpanel vid 390 px, samt kontrastmätning av `--ink-faint` mot `--paper-2`.

## Vad som uttryckligen inte används

Inter, Roboto, Arial, systemfont som varumärke, lila gradienter, glasmorphism,
24 px rundade kort, skuggor som hierarki, ikonrader som navigation, sex identiska
kort i ett rutnät, dekorativa illustrationer och animationer utan funktion.
