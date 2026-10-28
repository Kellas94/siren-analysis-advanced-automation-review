# Evaluarea formulelor utile pentru Analysis

Autor: Codex `test_claim_review`, evaluator separat, read-only. Baza inspectata este **analysis-count-functions-v1/candidate/analysis**, nu o presupusa implementare Count-text. Aceasta evaluare propune prioritati; nu modifica produsul si nu publica functii in provider. Documentatia DuckDB curenta a fost consultata prin Context7, apoi paginile oficiale DuckDB si Microsoft prin web, la 28 octombrie 2026. Nu s-au executat SQL, aplicatii native, builduri sau teste de performanta.

**Recomandare:** extinderea trebuie sa porneasca de la text si calitatea datelor, apoi reguli conditionale si sumarizare, apoi date calendaristice. Nu este necesara reproducerea tuturor formulelor Excel sau introducerea unui parser de formule libere.

## Ce exista efectiv in baza examinata

| Familie | Stare actuala | Limita importanta |
|---|---|---|
| LEFT, RIGHT, MID, coloana text literala | IMPLEMENTED_UI, New columns | Sursa VARCHAR reala; rezultat VARCHAR; MID de la1; count0..1M; NULL explicit distinct de text gol. Alt nod pentru folosirea unei coloane tocmai derivate. |
| Lookup exact, asemanator XLOOKUP | IMPLEMENTED_UI | Chei VARCHAR, BOOLEAN, integer, DECIMAL de acelasi tip; text binary; duplicate potrivite => eroare, lipsa => NULL. Nu este XLOOKUP complet, cu prima/ultima potrivire sau cautare aproximativa. |
| SUMIF/SUMIFS | IMPLEMENTED_UI | Masura integer/DECIMAL exacta, fara FLOAT/DOUBLE/UHUGEINT; SUMIF1 regula, SUMIFS AND. Rezultatul nativ ramane NULL cand nu exista valori de insumat. |
| COUNT/COUNTIF | IMPLEMENTED_UI in baza numerica acceptata separat | COUNT accepta acum numai coloana numeric-typed; COUNTIF exact1 regula tipizata, inclusiv text/NULL/gol/lista. Noua cerinta de COUNT text este o schimbare viitoare explicita, nu o proprietate a acestei baze. |
| Comparatii, liste, contains/startsWith/endsWith, isNull/isEmpty | IMPLEMENTED_UI, Filter | Reguli pe schema capturata, politici NULL explicite, maxim20; fara presupunerea ca textul numeric este numar. |
| SUM/COUNT/AVG/MIN/MAX in Pivot | IMPLEMENTED_UI ca optiuni generice | Nu implica aceeasi garantie de precizie ca SUMIF exact; tipul rezultatului trebuie observat. |
| Expresii Aggregate si conditie Filter SQL legacy | EXPLICIT_SQL_ONLY pentru formule arbitrare suportate de motor | Expr/condition sunt text SQL introdus explicit. Select & cast citeaza numele coloanelor si face TRY_CAST; nu este un editor general de expresii scalare. |
| TRIM/UPPER/LOWER/LEN/CONCAT/IF/date/numeric ca operatii tipizate noi | PROPOSED | Disponibilitatea functiei in DuckDB nu inseamna existenta unei interfete, contract sau calificare export/save/cold. |

Cod: `engine/derived-columns.js`, `conditional-functions.js`, `conditional-count.js`, `filter-criteria.js`; `src/flow/NodeEditor.jsx:29,36-37`; `engine/pipeline_compiler.js` ramurile derive/filter/aggregate/pivot. Catalogul70 descrie separat actiuni locale si contract comun IN_CONSTRUCTION/endpoint null; nu publica toate functiile de mai jos.

## Ordinea recomandata, cu exemple si politici

| Prioritate | Increment finit | Exemplu de utilizare | Politica tipizata si limita de acceptare |
|---|---|---|---|
| P0 | COUNT non-NULL pentru text si scalari suportati | `COUNT(customer_code)` pentru coduri `00120`, `''`, NULL | Noua copie/versionare a semanticii: textul gol este valoare, NULL nu este. Zero si false se numara. Lista explicita de tipuri, fara conversie numerica; tipurile nestandard refuzate. DATE nu devine automat suportat end-to-end. |
| P1.1 | TRIM-margin, UPPER, LOWER, LEN | cheie furnizor ` ACME `; lungime cod | Functii pe VARCHAR, NULL ramane NULL; sursa originala pastrata intr-o coloana separata. Alegere documentata caractere Unicode/codepoints vs grapheme si case policy. Nu promite normalizare universala a identitatii. |
| P1.2 | CONCAT/CONCAT_WS si SUBSTITUTE-all literal | `entity + ':' + invoice_id`; inlocuire separator | Input VARCHAR sau conversie explicita separata; separator literal. Politica NULL declarata: propagate sau skip, fara concatenare automata a numarului rotunjit. Versiunea initiala inlocuieste toate aparitiile literale, nu regex/nth occurrence. |
| P1.3 | IF/CASE si COALESCE | `amount<0 -> 'credit'`, altfel `'debit'`; lipsa cod -> `'UNKNOWN'` | Ramuri de acelasi tip explicit; conditie NULL are cale documentata, nu coerciere implicita in false/zero. COALESCE trateaza numai NULL, nu `''`,0 sau false. |
| P2.1 | COUNTIFS si distinct count | tranzactii `status='open' AND amount>100`; furnizori unici | Refoloseste reguli tipizate AND, fara wildcard implicit. Distinct exclude NULL in mod implicit SQL, dar include text gol ca valoare; explicita case/binary policy. Nu echivala distinct count cu deduplicarea randurilor. |
| P2.2 | MIN/MAX si sumarizare configurabila | cea mai mare valoare, minim pe categorie | Agregari pe integer/DECIMAL/VARCHAR cu politica tipului si ordinii textului. NULL pe populatie goala; nu inventa zero. SUMIFS exista deja, deci nu necesita nod duplicat. |
| P2.3 | ABS, ROUND, TRUNC | variatie absoluta; suma monetara la2 zecimale | Rezultate si overflow observate pe tip real; minimul unui integer semnat poate depasi domeniul ABS. ROUND cere regula de tie explicita, inclusiv valori negative. DECIMAL ramane exact pana la o rotunjire declarata. |
| P3.1 | TEXTBEFORE/AFTER si split pe pozitie | parte de dinainte de `'-'`; segment2 al codului | Mai intai rezultat scalar VARCHAR, cu index1-based si regula explicita delimiter lipsa/repetat/gol; nu asuma identitate Excel. Split-to-columns poate veni separat cu schema limita. Split-to-rows modifica populatia si are nevoie de provenienta cardinalitatii. |
| P3.2 | YEAR/MONTH, month-end/EOMONTH, date difference | luna contabila, scadenta, vechime factura | DATE/format ISO explicite; text localizat refuzat fara format ales. EOMONTH include offset explicit; diferenta de zile/calendar boundaries nu este automat durata in24h. DATE/TIMESTAMP trebuie probate in schema/wire/Docs. |
| P3.3 | AVG/AVERAGEIF(S), medie ponderata | pret mediu; total ponderat / cantitate | Nu prezenta AVG(DECIMAL) drept exact: verifica tipul nativ, de regula DOUBLE. Pentru bani: fie rezultat aproximativ etichetat, fie algoritm exact cu scala/rotunjire aprobate. Ponderata cere denominator zero/NULL si unitati explicite. |
| P4 | Business days, rank/lag/cumulative/as-of | zile lucratoare, sold cumulativ, ultima rata valabila | Calendar de sarbatori versionat, weekend si interval incluziv/exclusiv; pentru ordonare cheia si tie-breaker sunt obligatorii. Nu folosi numarul vizual al randului ca cheie sau ordine stabila. |

P0 este cerinta imediata, P1 urmatorul pachet practic, P2 dupa stabilizarea textului/conditiilor. P3/P4 au cost semantic mai mare si se implementeaza doar cu teste dedicate. Acesta este un clasament de utilitate/risc, nu un angajament de a implementa toate randurile.

## Diferente pe care interfata trebuie sa le explice

1. **COUNT nu este un alias accidental pentru Excel COUNT.** SQL COUNT(col) numara valori non-NULL, pe cand Excel COUNT este numeric. Noua cerinta a utilizatorului poate urma prima regula, cu textul gol inclus, fara a adauga COUNTA ca dublura cu acelasi comportament. Eventual, o optiune separata "text ne-gol" ar insemna predicate explicite, nu schimbarea ascunsa a COUNT. Documentatia Microsoft distinge COUNTA, inclusiv textul gol, de COUNT numeric; SQL distinge COUNT(*) de COUNT(col). [DuckDB aggregates](https://duckdb.org/docs/2.0/sql/functions/aggregates), [Microsoft COUNT/COUNTA](https://support.microsoft.com/en-us/excel/ways-to-count-values-in-a-worksheet).

2. **TRIM nu inseamna acelasi lucru peste tot.** DuckDB trim elimina caractere de la margini; Excel TRIM reduce si spatiile ASCII interioare la unul, fara a elimina NBSP. Recomand moduri numite "margin spaces" si, separat, "collapse ASCII spaces". CLEAN necesita o politica de caractere, nu o eticheta "remove all invisible Unicode": Microsoft CLEAN vizeaza ASCII0..31, iar eliminarea TAB/newline poate lipi cuvinte. NBSP, zero-width si diacriticele cer optiuni separate, niciodata stergere tacita a identificatorilor. [DuckDB text](https://duckdb.org/docs/2.0/sql/functions/text), [Microsoft TRIM](https://support.microsoft.com/en-us/excel/functions/trim-function), [Microsoft CLEAN](https://support.microsoft.com/en-us/excel/functions/clean-function?nochrome=true).

3. **Concatenarea si separarea pot schimba NULL si cardinalitatea.** DuckDB concat/concat_ws sar peste NULL; operatorul `||` propaga NULL. split_part in afara intervalului produce text gol, diferit de o eroare Excel TEXTBEFORE pentru delimiter absent. Politicile trebuie declarate; rezultatul LIST al split nu este un scalar pe care sa-l trimitem implicit ca `[object Object]`. [DuckDB text](https://duckdb.org/docs/2.0/sql/functions/text), [Microsoft TEXTBEFORE](https://support.microsoft.com/en-us/excel/functions/textbefore-function).

4. **Lookup existent nu necesita o noua implementare pentru text.** El foloseste text binary si chei tipizate. Excel XLOOKUP poate alege prima potrivire; Analysis refuza duplicatele potrivite si intoarce NULL pentru lipsa. Orice optiune first/last/nearest este un contract nou cu ordine/cheie stabila, nu un buton fara politica. [Microsoft XLOOKUP](https://support.microsoft.com/en-us/excel/functions/xlookup-function).

5. **Mediile si rotunjirea nu sunt automat exacte.** DuckDB documenteaza aritmetica DECIMAL exacta pentru +,-,* cu limite de latime, dar impartirea foloseste floating point. Documentatia2.0 introduce `decimal_average`, cu aritmetica integer si half-even la scala intrarii; aceasta este o propunere interesanta, nu dovada ca ruta noastra o poate rula/exporta exact. Calificare separata pe runtime-ul copiat si scala reala, fara substituire tacita a AVG si fara ingustarea HUGEINT/UHUGEINT. `round_even` este explicit half-even; tie policy se afiseaza. [DuckDB numeric types](https://duckdb.org/docs/2.0/sql/data_types/numeric), [DuckDB aggregates](https://duckdb.org/docs/2.0/sql/functions/aggregates), [DuckDB numeric functions](https://duckdb.org/docs/2.0/sql/functions/numeric).

6. **Datele necesita un "as of" capturat.** YEAR/MONTH sunt utile inainte de calendar business. Nu interpreta automat `01/02/2026`; nu amesteca DATE cu TIMESTAMPTZ sau timezone local fara declaratie. Pentru "today" salveaza data/timestamp/timezone folosite la executie. date_diff numara limite de interval, nu simplu ore/24. Business days necesita calendar si weekend versionate, nu un date_diff('weekday') presupus echivalent. [DuckDB dates](https://duckdb.org/docs/current/sql/functions/date.html), [Microsoft NETWORKDAYS.INTL](https://support.microsoft.com/en-gb/excel/functions/networkdays-intl-function).

7. **Nu introduce IFERROR la nivelul jobului.** COALESCE rezolva NULL, TRY_CAST poate exprima o conversie toleranta declarata; niciuna nu transforma crash/anulare/eroare IPC intr-un rezultat reusit. Pentru erori pe rand, un model separat trebuie sa pastreze indicatorul de conversie/eroare si populatia afectata. [DuckDB NULL](https://duckdb.org/docs/2.0/sql/data_types/nulls), [DuckDB CASE](https://duckdb.org/docs/2.0/sql/expressions/case).

## Cel mai mic pachet urmator si probele necesare

- Intai COUNT text/non-NULL pe schema reala: VARCHAR `00120`, `''`, `'='`, NULL, numeric0, BOOLEANfalse, exact BIGINT/DECIMAL; respingere tip nesuportat; sursa80 cu preview50 trebuie numarata integral. Nu schimba copia acceptata numeric90042.
- Apoi noua versiune New columns cu TRIM-margin/UPPER/LOWER/LEN, CONCAT si SUBSTITUTE-all. Pastrarea sursei, aliasuri ASCII-case, NULL/gol/spatii/NBSP/Unicode, ghilimele si text incepand cu `=`; rezultate comparate cu oracol independent, nu preview calculat in renderer.
- Abia apoi IF/COALESCE si COUNTIFS, folosind scheme/criterii capturate si validarea worker existenta. Conditional branch mix de tipuri, un rezultat NULL legitim, no-match si input gol sunt cazuri distincte.
- Fiecare increment: helper strict versionat, schema observata, recheck worker, editor fara auto Run/Save, history/drafts/stale callbacks, Cancel/eroare/retry, export→Docs→Save/Quit/cold cu bytes exacti si control corupt. Datele mari raman in motor; populatiile sursa/rezultat/transferate raman separate.
- Providerul comun are nevoie de whitelist/compiler/wire/schema/publication si review propriu. Catalogul provizoriu nu executa. Formularele vechi trebuie sa-si pastreze pinurile sau sa primeasca refuz explicit, fara migrare ascunsa. Nu se fac schimbari UI Builder-owner, instalare sau release prin aceasta evaluare.

Inventarul de surse/pinuri si consultarile documentatiei sunt in `formula-roadmap-sources.json`. Nu s-au calificat executii noi; exemplele de mai sus sunt specificatii reprezentative, nu rezultate native observate.
