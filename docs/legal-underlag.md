# Underlag för juridik och företagsuppgifter

Dokumentet listar vad som måste fyllas i av grundaren innan integritetspolicy,
villkor och kundavtal kan betraktas som juridiskt granskade. Ingen av punkterna
är påhittad i webbplatsens texter — de hänvisas i stället till "på begäran" eller
till kundavtalet.

## Krävs från grundaren

| Uppgift | Används i | Status |
| --- | --- | --- |
| Registrerat företagsnamn | Integritetspolicy, villkor, fakturaunderlag | Saknas |
| Organisationsnummer | Integritetspolicy, villkor, fakturor | Saknas |
| Registrerad adress | Integritetspolicy, villkor | Saknas |
| Momsregistrering (SE + eventuellt OSS) | Priser, fakturor | Saknas |
| Kontakt för dataskydd (privacy@) | Integritetspolicy | Publiceras först när `BRAND_EMAIL_DOMAIN` är satt och brevlådan finns |
| Personuppgiftsbiträdesavtal (mall) | Kundavtal | Saknas |
| Underbiträden och hostingleverantör | Integritetspolicy, DPA | Saknas (namn och region) |
| Lagringstider som ska gälla avtalsmässigt | Integritetspolicy | Förslag: 24 månader efter senaste inloggning |
| Betalningsvillkor och uppsägningstid | Villkor | Förslag: 30 dagar, månadsvis i förskott |

## Varumärkesadresser

Ingen e-postadress publiceras förrän `BRAND_EMAIL_DOMAIN` är satt till en domän
bolaget äger. Utan variabeln visar sidor, PDF:er och fakturaunderlag ingen
adress alls — kontakt sker via formuläret — så sajten kan aldrig peka på en
brevlåda vi inte kontrollerar. Det finns ingen reservdomän i koden.

När domänen är satt används `hello@` (publik kontakt och rapporter), `privacy@`
(dataskydd) och `billing@` (fakturor). Rolladresserna ska vara skapade och
testade innan variabeln sätts i drift.

## Vad som redan är korrekt i texterna

- Session-cookie är den enda cookien; ingen analys- eller annonsspårning.
- Rådatafiler lagras inte, endast tolkade rader och beräknade resultat.
- AI-funktioner är avstängda som standard och skickar aggregerade mått, inte artikelrader.
- Användaren kan exportera och radera all data i inställningarna.
- Ansvar är begränsat till avgifterna för de senaste tolv månaderna.

## Kvar att juridiskt granska

Integritetspolicy och villkor är skrivna för att vara läsbara och sakliga, men de
är inte granskade av jurist. De bör granskas innan de används mot kund, särskilt
avsnitten om personuppgiftsbiträde, överföring till tredjeland och ansvarsbegränsning.
Det gäller både den engelska och den svenska versionen; den svenska är en
översättning av samma text och ska granskas i samma omgång.
