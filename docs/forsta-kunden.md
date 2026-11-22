# Från noll till första betalande kund

En plan för 5–10 timmar i veckan. Allt nedan är gjort av dig, inte av systemet –
**skicka ingenting förrän du själv har läst igenom det.**

---

## Utgångsläget

Du har en fungerande produkt. Det du inte har är bevis på att någon vill betala
för den. Nästa steg är inte att bygga fler funktioner – det är att få tre riktiga
CSV-filer i systemet och ett samtal med någon som har ett lager.

**Målet på 14 dagar:** 3 testfiler, 1 betald audit (14 900 kr) eller 1
abonnemang.

**Målet på 60 dagar:** 3 betalande kunder, varav minst en på abonnemang.

---

## Vecka 1: tio samtal, tre filer

### Dag 1 (2 h) – förberedelse

1. Kör igenom flödet själv med `samples/exempel-lagerdata.csv`. Tidtagning: från
   inloggning till färdig PDF ska ta under 5 minuter. Om det tar längre tid, är
   det onboardingen som ska förenklas – inte produkten som ska byggas ut.
2. Bestäm vilket segment du börjar med. **Rekommendation: fackhandel med 5–30
   butiker** (nivå A i prospektlistan). De har breda sortiment, högt lagervärde
   per kvadratmeter och en ägare som kan fatta beslut själv.
3. Skriv ner din egen berättelse i tre meningar: vem du är, vad du gör, varför du
   gör det. Den ska gå att säga i telefon utan att läsa innantill.

### Dag 2 (2 h) – prospektering

Välj 12 bolag från `docs/prospektlista.md`. För varje:

- Slå upp omsättning och antal anställda på allabolag.se.
- Hitta rätt person på LinkedIn (ekonomichef, inköpschef eller VD).
- Läs deras senaste pressmeddelande eller butikssida. En detalj därifrån gör
  första meningen personlig.

Skriv in allt i ett enkelt kalkylark: bolag, roll, namn, e-post, vinkel, datum,
svar.

### Dag 3–5 (1 h/dag) – första kontakten

Skicka **3 per dag**, inte 12 på en gång. Anledningen: du vill hinna justera
formuleringen efter de första svaren.

**Mall 1 – till ekonomichef (den som äger kapitalbindningen):**

> Ämne: Kapital bundet i lager – {Bolag}
>
> Hej {Namn},
>
> Jag håller på att bygga ett verktyg som analyserar lagerkapital åt svenska
> fackhandlare, och jag söker tre företag som vill testa det kostnadsfritt.
>
> Det jag gör: du skickar en CSV-export från ert system – artikelnummer, saldo,
> inköpspris och försäljning per månad. Inom en dag får du en rapport som visar
> vilka artiklar som inte sålt på 180 dagar, hur mycket kapital de binder, vilka
> artiklar som ligger i överlager och vad som realistiskt kan frigöras. Inga
> integrationer, ingen driftsättning.
>
> För er är det gratis mot att jag får feedback på rapporten. Jag delar inget
> vidare och raderar filen när analysen är klar.
>
> Är det intressant att titta på? Jag kan skicka en exempelrapport först om du
> vill se formatet innan du skickar något.
>
> Med vänlig hälsning
> {Ditt namn} · {telefon} · {webbplats}

**Mall 2 – till inköpschef (den som äger sortimentet):**

Kortare version, fokus på sortimentet i stället för kapitalet:

> Hej {Namn},
>
> Kort fråga: har ni koll på hur stor del av ert sortiment som inte sålt något
> under de senaste sex månaderna?
>
> Jag har byggt ett verktyg som räknar ut det från en CSV-export – saldo,
> inköpspris och försäljning per månad. Resultatet är en rapport med inaktivt lager,
> överlager, ABC-klassning och beställningspunkter.
>
> Jag söker tre företag som vill testa gratis i utbyte mot feedback. Vill du se
> ett exempel på hur rapporten ser ut?

**Mall 3 – uppföljning efter 4 dagar (samma tråd, inte nytt ämne):**

> Hej {Namn}, jag ville bara lägga den här överst i inkorgen. Om det inte är
> aktuellt nu, säg till så hör jag inte av mig igen – och om du känner någon
> annan som har samma fråga får du gärna skicka vidare.

Uppföljningen ger oftare svar än första mejlet. Skicka den en gång, aldrig två.

### Dag 6–7 (2 h) – telefonen

E-post ger ungefär 1 svar per 8–10 utskick. Telefon ger mer, men kräver att du
har något att säga.

Ring dem som öppnat men inte svarat. Manus, 40 sekunder:

> "Hej, mitt namn är {namn}, jag ringer för att jag skickade ett mejl i tisdags om
> lageranalys. Har du 30 sekunder?
>
> Jag bygger ett verktyg som tar en CSV-export från ert system och räknar ut hur
> mycket kapital som sitter i inaktivt lager och överlager. Jag söker tre företag som
> vill testa gratis. Det enda jag behöver är en export – artikelnummer, saldo,
> inköpspris och försäljning per månad.
>
> Har ni en sådan export tillgänglig?"

Tre saker att komma ihåg:
- Fråga om **exporten finns**, inte om de vill köpa. Det är ett mycket lättare ja.
- Om de säger "vi har koll": fråga hur de mäter det i dag, och lyssna. Det svaret
  är din produktbeskrivning.
- Om de säger nej: fråga vad som skulle behöva vara sant för att det skulle vara
  intressant. Skriv ner svaret ordagrant.

---

## Vecka 2: från fil till samtal

### När filen kommer in (30 min per kund)

1. Ladda upp, kontrollera mappningen, kör analysen.
2. **Läs rapporten själv innan du skickar den.** Ser siffrorna rimliga ut? Om
   lagervärdet är 40 Mkr för en butik med 12 anställda är något fel i datan.
3. Skicka PDF:en tillsammans med tre meningar: det viktigaste numret, den
   viktigaste åtgärden, och en fråga.
4. Boka ett 20-minuterssamtal. Skicka aldrig bara rapporten – då blir den en fil
   i en inkorg.

### Samtalet (20 minuter)

| Minut | Vad du gör |
|---|---|
| 0–3 | "Berätta hur ni arbetar med lager i dag." Låt dem prata. |
| 3–8 | Gå igenom de tre viktigaste siffrorna i deras egen rapport. |
| 8–13 | Fråga: "Känner ni igen det här? Vad förvånar er?" |
| 13–17 | Fråga: "Om ni skulle ta tag i dödlagret – vem beslutar det, och vad skulle stoppa er?" |
| 17–20 | Föreslå nästa steg. |

Nästa steg beror på vad de sagt:

- **Om de är engagerade:** "Jag föreslår en fullständig audit för 14 900 kr. Den
  omfattar all historik, åtgärdsplan per artikelgrupp och en genomgång med er.
  Vill du att jag skickar ett underlag?"
- **Om de är tveksamma:** "Vad skulle behöva vara annorlunda i rapporten för att
  den skulle vara värd 15 000 kr för er?" Svaret är antingen ett köp eller en
  produktkravlista – båda är värdefulla.
- **Om de säger att de inte har tid:** fråga om de vill ha rapporten löpande
  varje månad i stället (2 490 kr), så slipper de beställa en analys.

### Vad du inte ska göra

- Inte erbjuda rabatt för att få första kunden. Det sätter priset för alla
  framtida kunder och signalerar att priset var påhittat.
- Inte lova ett belopp i besparingar. Säg "identifierat kapital", aldrig "ni
  kommer att spara X kr".
- Inte skicka rådata vidare till AI-tjänster. Om du aktiverar AI skickas endast
  aggregerade nyckeltal – det är byggt så i koden, men kontrollera i `.env` att
  du inte pekar på en endpoint du inte litar på.

---

## Vecka 3–4: konvertering och systematisering

### Om tre filer är inne

Jämför dem. Vilka två datakällor användes? Vilka kolumner saknades? Vilka
varningar dök upp? Det är din roadmap – inte en lista på funktioner du vill ha.

Om samma kolumn saknas hos två av tre kunder, bygg stöd för det. Om en kund
behöver ERP-integration: säg nej, erbjud manuell export i stället. Integrationer
är det som dödar små produktbolag.

### Om ingen fil har kommit in efter 20 förfrågningar

Bytt inte produkt. Byt **målgrupp** först:

1. Prova franchise-handlare i stället för kedjehuvudkontor (nivå B). De har
   kortare beslutsväg.
2. Prova e-handel (nivå C). De har redan exporten och är vana vid verktyg.
3. Prova redovisnings- eller revisionsbyråer som kund till dig – de har 30 kunder
   var och kan sälja analysen vidare. Det är den snabbaste vägen till volym, men
   kräver att du har ett case först.

Om 40 förfrågningar i tre segment ger noll svar är problemet formuleringen, inte
marknaden. Be någon i målgruppen läsa mejlet och säga vad som fick dem att inte
svara.

---

## Juridik och personuppgifter – innan första riktiga filen

Detta ska vara klart innan du tar emot data från ett företag. Det är inte
byråkrati: ett företags artikelregister är affärshemlig information.

- [ ] **Personuppgiftsbiträdesavtal** med kunden om filen innehåller
      personuppgifter (t.ex. säljare per rad). En enkel bilaga som säger: du
      behandlar endast på uppdrag, raderar inom 30 dagar, och använder inga
      underbiträden utan godkännande.
- [ ] **Integritetspolicy** på webbplatsen (finns på `/integritet` – läs igenom
      och fyll i dina uppgifter).
- [ ] **Register över behandling** – en sida räcker: vilka uppgifter, varför,
      var de lagras, hur länge.
- [ ] **Radering** – funktionen finns i gränssnittet. Skriv i avtalet att data
      raderas senast 30 dagar efter avslutad analys.
- [ ] **Bolagsform** – fakturering kräver F-skatt. Enskild firma räcker för
      första kunden; kolla med Skatteverket innan du fakturerar.
- [ ] **Ansvarsbegränsning** i avtalet: rapporten är ett beslutsunderlag, inte
      en garanti för ekonomiskt utfall. Utan den meningen bär du risken för
      kundens inköpsbeslut.

---

## Vad du mäter

| Mått | Mål | Var |
|---|---|---|
| Förfrågningar skickade | 40 på 4 veckor | Kalkylark |
| Svarsfrekvens | > 10 % | Kalkylark |
| Testfiler mottagna | 3 | `/app` |
| Tid från fil till skickad rapport | < 45 min | Tidtagning |
| Samtal bokade | 5 | Kalender |
| Betalande kunder | 1 | Faktura |

Om svarsfrekvensen är under 5 %: ändra ämnesraden, inte brödtexten. Om folk
svarar men ingen skickar fil: förenkla exportinstruktionen. Om de skickar fil men
ingen köper: priset eller rapportens tydlighet.

---

## De tre invändningarna du kommer att möta

**"Vi har redan koll på vårt lager."**
> "Det tror jag. Frågan är om ni har det per artikel och i kronor. De flesta har
> koll på totalen men inte på vilka 200 artiklar som står för den. Det tar en
> CSV-export att ta reda på."

**"Vi har ingen tid."**
> "Det är därför jag frågar. Analysen tar er fem minuter – en export. Resten gör
> jag. Om rapporten inte säger er något nytt, har ni förlorat fem minuter."

**"Vi använder redan {system}."**
> "Bra – då har ni siffrorna. Det jag gör är att räkna om dem till kapital och
> åtgärder. Era system visar saldo; de brukar inte visa vad saldot kostar."

---

## Efter första betalande kunden

Gör exakt tre saker, i den ordningen:

1. **Skriv ner vad som hände** – från första mejl till faktura, med datum. Det är
   din säljprocess, och den är nu bevisad.
2. **Be om en referens** – en mening du får citera, och frågan "känner du någon
   annan med samma problem?". De flesta säger ja till det andra.
3. **Bygg inget nytt på två veckor.** Använd tiden till att sälja den andra
   kunden. Produkten är tillräcklig; det är distributionen som saknas.
