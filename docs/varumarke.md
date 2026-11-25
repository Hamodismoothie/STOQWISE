# Varumärke: Stoqwise

Riktlinjer för hur Stoqwise ser ut, låter och rör sig. Dokumentet är normativt:
avvikelser ska vara medvetna och motiverade, inte ett resultat av att en komponent
råkade ärva något.

---

## 1. Idé

**Lagerbok.** En svensk finanspublikation möter ett kalibrerat mätinstrument.
Stoqwise redovisar kapital som en bokföring: varje post har ett värde, en ålder
och en konsekvens. Ytan är varmt papper, texten är bläck, och det som avviker
markeras i oxiderad koppar.

Positionering: *inventory intelligence för svensk handel, grossist och industri.*
Löfte: **varje krona i lagret ska gå att förklara.**

Tonen är saklig och konkret. Siffror före adjektiv. Ingen tillväxtretorik, inga
utropstecken, inga metaforer om resor eller resor mot målet.

| Gör | Gör inte |
|---|---|
| "690 360 kr ligger i artiklar som inte sålt på 180 dagar." | "Unlock hidden cash in your inventory!" |
| "Prognosen är osäker: WAPE 31 %." | "AI-driven prediction magic." |
| "Åtgärd: minska 38 artiklar." | "Ta kontroll över din lagerhantering." |

---

## 2. Märket

Logotypen utgår från **den levererade konsten** och är den auktoritativa
referensen. S-formen är orörd. Ordmärket är omställt från STOCKWISE till
STOQWISE i samma konstruerade geometri: Q-et är O-formen i samma bredd som
C-et hade, med ett ben under baslinjen, och resterande bokstäver behåller
ursprunglig tracking. Märket byggs inte om i övrigt och ersätts inte.

| Fil | Användning |
|---|---|
| `public/brand/stoqwise-logo.svg` | Sidhuvud, sidfot, auth, e-post, dokumentation |
| `public/brand/stoqwise-mark.svg` | Vänsterrail (staplad), tryckomslag |
| `public/favicon.svg` | Favicon: märket på pappersplatta, samma proportioner |

- **Färg:** märket är `#111214`, bryggan `#C8A66A`. Ingen annan färgsättning av
  konsten. Den enda tillåtna behandlingen är en pappersplatta bakom märket när
  det annars skulle försvinna mot en mörk yta (mörkt läge).
- **Proportion:** alltid `img` med bevarat förhållande (401:108 respektive
  220:216). Aldrig sträckt, beskuret eller omritat, aldrig i cirkel eller
  rundad behållare.
- **Storlek i gränssnittet:** 26 px höjd i sidhuvud, 23 px i mobil, 104 px bredd
  i railen, 172 px i PDF-omslaget (som vektor).
- **Frizon:** minst höjden på S-formens övre arm, alltid minst 16 px.
- **Minsta storlek:** 20 px höjd för liggande låsning, 64 px bredd för staplad.
- **Favicon:** märket, inte ordmärket. Pappersplatta `#F4F0E6` så att det syns i
  både ljusa och mörka flikar.
- **Förbjudet:** rotera, spegla, ändra färg, lägga i gradient, animera märket,
  lägga till slogan i låsningen, använda S-formen som separat ikon utan ordmärke
  i marknadsföring.

**Editionstext** används inte. Logotypen står ensam i sidhuvud, rail och sidfot;
ingen utgåva, årtal eller undertitel sätts bredvid märket. Den tidigare
editionstexten sattes i Geist Mono 9 px, versaler, +0,14 em, `--ink-muted`, och hölls åtskild
med en hårlinje. Den får aldrig smälta in i ordmärket.

---

## 3. Typografi

Fyra roller, fyra typsnitt. Alla är OFL-licensierade och ligger i
`public/fonts/` med licensfil (`OFL-*.txt`). Ingen proprietär font används eller
påstås vara licensierad.

| Roll | Typsnitt | Vikt | Användning |
|---|---|---|---|
| Display | **Newsreader** | 300, 400, 400 italic | Sidrubriker, hero, plattor, citat, stora beslut |
| Editorial | Newsreader | 400 | Ingresser, förklaringar, brödtext i rapporter |
| Interface | **Schibsted Grotesk** | 400, 500, 700 | Navigering, knappar, etiketter, formulär |
| Data | **Geist Mono** | 400, 500 | Belopp, antal, procent, datum, SKU, tabellhuvuden |

Regler:

- Rubriker sätts med négativ tracking (`-0.02em` till `-0.035em`) och line-height
  1,02–1,1. Brödtext har 1,6.
- Versala mono-etiketter: 10–11 px, `+0.12em` till `+0.16em`, `--ink-muted`.
  De är metadata, aldrig innehåll: en hel mening sätts aldrig i versaler.
- Siffror är högerställda i tabeller och använder tabular figures. Belopp skrivs
  med tunt mellanslag som tusentalsavgränsare (`6 618 210 kr`), decimaler med
  komma (`3,30`).
- Svenska tecken (å, ä, ö) är en del av provsättningen: Newsreader och Schibsted
  Grotesk är valda för att de har korrekt svensk form, inte som reserv.
- Kursiv är betoning i editorial text, aldrig i gränssnittslabels.

---

## 4. Färg

| Token | Hex | Roll |
|---|---|---|
| `--paper` | `#F4F0E6` | Bakgrund, papper |
| `--paper-2` | `#EBE5D5` | Förhöjd yta, tabellhuvud |
| `--ink` | `#16180F` | Primär text, regler |
| `--ink-soft` | `#4C4F42` | Sekundär text |
| `--ink-muted` | `#5F6154` | Metadata, etiketter |
| `--copper` | `#96482A` | Aktivt läge, avvikelse, prognos |
| `--pine` | `#234A38` | Bekräftat, hälsosamt, tålighet |
| `--rust` | `#8A2F1E` | Fel, inaktivt lager, risk |
| `--ochre` | `#86611A` | Varning, överlager |
| `--rule` | `#D4CBB7` | Hårlinje |
| `--wash` | `#EFE7D3` | Betonad yta, första nyckeltal |
| `--brass` (logotyp) | `#C8A66A` | Endast i märket; aldrig som textfärg |

- **Fördelning:** 80 % papper, 15 % bläck, 5 % accent. Accentfärg markerar
  betydelse; den får aldrig dekorera.
- **Semantik:** koppar = uppmärksamhet och prognos, roströd = förlust och fel,
  ockra = varning, tall = bekräftelse. Samma betydelse på alla sidor.
- **Mörkt läge:** papper → `#14150F`, bläck → `#EFE9DA`, koppar ljusas till
  `#C8794F` för att behålla 4,5:1 på mörk yta. Ytor får aldrig ren svart.
- **Kontrast:** all text ska nå 4,5:1, stora rubriker 3:1. Accentfärg används
  aldrig som enda bärare av betydelse, etikett eller form följer med.

---

## 5. Layout

- 12-kolumnsgrid, 24 px mellanrum, maxbredd 1240 px, sidmarginal 24–40 px.
- **Hårlinjer i stället för kort.** En sektion avgränsas av en 1 px linje i
  `--rule`; en viktig sektion av en 1 px linje i `--ink`.
- Hörnradie: 2 px på inmatningsfält och knappar, 0 på paneler och tabeller.
- **Folio:** varje navigationspost har ett tvåsiffrigt nummer (01–11) satt i mono.
  Numret är navigationens ikonografi, aldrig i kombination med en ikon.
- **Asymmetri är regel:** en sida får ha en tung vänsterkolumn och en lätt
  marginalnot. Layouten upprepas inte mellan sidor; dashboarden är tät,
  landningen är rymlig, prognosen är en enda stor platta.
- Negativ yta är ett verktyg: en sida får vara halvtom om det som står där är
  viktigare än det som kunde ha fyllt ytan.

---

## 6. Ikonografi

- En linje, 1,5 px, inga fyllda ytor, inga rundade ändar utom där formen kräver.
- 24 px rutnät, optisk centrering. Ikoner används bara där de ersätter en
  förklarande text (ladda ner, ladda upp, stäng), aldrig som dekoration i
  rubriker eller menyer.
- Riktningen är teknisk ritning, inte vardagsikon: pilen är en streckpil med
  öppen skänkel, nedladdning är en linje mot en baslinje. Inga emoji.

---

## 7. Datavisualisering

Visualiseringarna är egen kod i `src/ui/charts.ts`, ritade i SVG med samma
linjevikt som gränssnittet.

- **Trädkarta:** area = kapital, färg = andel inaktiva artiklar relativt värsta kategorin.
  Etiketter döljs under 52×24 px; då visas endast ytan.
- **Prognos:** historik i bläck, prognos i koppar, osäkerhet som ett enda
  band i 12 % koppar. Vertikal streckad linje markerar övergången, aldrig en
  färgad yta.
- **Hälsoband:** en ring med poäng i mono, drivare som horisontella linjer.
  Inga staplar med rundade hörn, inga 3D-effekter, inga skuggor.
- **Axlar:** endast horisontella hårlinjer, etiketter i mono 10 px. Enheter
  skrivs ut en gång, inte per punkt.
- **Färgskala:** papper → koppar i fem steg (`--viz-1`…`--viz-5`). Skalan är
  alltid relativ till urvalet som visas, så att kontrasten finns kvar även när
  hela lagret är friskt.
- Varje diagram har en läsbar sammanfattning i text och en tabell eller lista
  med samma siffror. Färg är aldrig enda informationsbärare.

---

## 8. Rörelse

| Token | Värde | Användning |
|---|---|---|
| `--t-fast` | 140 ms | Hover, fokus, tryck |
| `--t-base` | 240 ms | Paneler, flikar, dialog |
| `--t-slow` | 420 ms | Sidbyte, stora ytor |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | Standard |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Lägesbyten |

- Endast `transform` och `opacity` animeras. Ingen `transition: all`.
- Siffror räknas upp en gång vid laddning (600 ms), aldrig vid hover.
- Diagram ritas i sin slutposition; ingen loopande animation.
- `prefers-reduced-motion: reduce` stänger av all rörelse, inklusive
  sifferräkning och mjuk scroll.
- Ingen bounce, ingen parallax, ingen animation som kräver att användaren väntar.

---

## 9. Bild och illustration

Inga stockfoton, inga AI-illustrationer, inga 3D-renderingar av lagerlokaler.
"Plattor" (Platta I–III) är genererade diagram ur demon, satta som figurtexter
med folio. När en bild behövs är den ett **diagram**, inte en illustration.

---

## 10. Tillgänglighet

- WCAG 2.2 AA är målet: kontrast 4,5:1, fokusring 2 px i koppar med 2 px
  offset, träffytor minst 24×24 px, inga rörelser som inte kan stängas av.
- Formulär har alltid synlig etikett, aldrig bara placeholder. Fel beskrivs i
  text nära fältet och i en `role="alert"`.
- Status förändras aldrig enbart genom färg: etikett, ikon eller text följer.
- Tabellhuvuden är `th` med `scope`; siffror har `font-variant-numeric: tabular-nums`.

---

## 11. Anti-mönster

Förbjudet i Stoqwise:

- Kort med skugga och 16 px radie som bär all information.
- Gradient­knappar, glasmorfism, neonsken.
- Inter, Roboto, Arial eller systemfont som bärare av varumärket.
- Ikonrader med återkommande symboler före varje rubrik.
- Diagram i bibliotekets standardpalett.
- "AI"-gnistor som dekor, emoji i gränssnittet.
- Animation som spelar utan att användaren gjort något.
- Rubriker som säljer i stället för att förklara.
