# Verdict — text COUNT and retained formula route

**Acceptat în scop delimitat**, pentru candidatul izolat exact de mai jos: COUNT pe coloane numerice/VARCHAR/BOOLEAN, COUNTIF cu un criteriu tipat și traseul finit text→LEFT/RIGHT/MID/coloană literală→Filter→Lookup exact→COUNT/COUNTIF→fișiere Docs, inclusiv salvarea și redeschiderea fluxului Analysis. Evaluarea celorlalte formule este livrată ca propunere prioritizată, nu ca implementare.

| Identitate | Fișiere / bytes | SHA256 roster |
|---|---:|---|
|candidate/analysis|2469 /970016066|`15830f7226a05be010e3e9d6396105045cdc44ebb614297c50f12f6d6930fb9b`|
|desktop_package întreg|710 /884194076|`f2223ad354f9951b6ac6c695aeef59d89a726a16906a0bd650a159ef8d4ac1cf`|

Manifestele înainte/final coincid;7 fișiere schimbate față de baza numerică90042, fără adăugări/ștergeri;164+2 surse din maps și18 perechi corespund. Donorul numeric rămâne nemodificat. Runtime observat Electron44.9.3/Chrome152.0.7977.167/Node24.22.0; acesta nu califică migrarea SIREN.

Root a integrat helperul și editorul și a operat execuțiile reale. Review-ul separat a verificat sursele și artefactele rezultate, fără a pretinde o a doua execuție nativă independentă. Root a citit integral aceste rapoarte finale:

- source-state-review.md — `16dc9fb84f47d2f216a6f917ef7c74ffee842d39b4d2dfbcae9e3e5c679dcef5`;
- count-text-engine-review.md — `e777b9d032c7c8e85b7632f2332142e82215352273310d45931960be4aad69a8`;
- count-text-ipc-review.md — `79257d86a1bdbb024904140bd3f43a2b687f03b6f091df8bfdb977d5b2f5fd86`;
- count-text-physical-review.md — `b385fb556dc793de14eab54fa9d00ffb0261ef0ab7b7661f30d54d54d14fe685`;
- catalog-text-review.md — `4cf57ce158d674a1ee646102a758e04febbcaba34984ac0fef118f2a7eba50d0`.

Separat:9 grupuri AUTHOR pure;9 grupuri source/state și un mutant;8 grupuri engine/VM și7 mutanți;27 joburi IPC curente (24finalizate,2refuzate înainte deSQL,1schemă refuzată; retry64) și22 coruperi refuzate;8 scenarii native/7 joburi UI și18 coruperi fizice/semantice refuzate; inventarul de catalog are un control pozitiv și12 coruperi refuzate. Aceste populații nu se însumează.

COUNT include textul gol/zero/false și exclude NULL pe tipurile admise. `00120`, spațiile, Unicode și textul care începe cu `=` rămân text. Sursa90, rezultatul Lookup80, previzualizarea50, numărările70/50/10/10/10/64/80 și unicul rând agregat sunt distincte. COUNTIF păstrează un criteriu; COUNTIFS rămâne propus. Modelul analysis.conditional-count/1 și SQL-ul numeric valid sunt păstrate.

Salvarea fizică23512B/SHA4b2deaf0ad164034e3142719e8515ad10a0d7c8ba48cb44d467d7d39bc28f053 păstrează13noduri/12legături și se execută corect după Quit/pornire nouă/Open. Fișierul numeric anterior5340B/SHA65f271b897bb81bfcb5bc045a59fa41ce9710fca946e9a5f89f0056ef5bc7dd6 rămâne identic și produce64/20 pe sursa80. Cele două procese native distincte ies normal0, fără curățare forțată; verificările limitate propriei copii nu arată procese rămase. Metadatele inaccesibile ale altor procese rămân necunoscute.

Două fișiere Docs reale, legate de jobul final anterior redeschiderii: Count70/COMPLETE1 și Lookup80/SAMPLED50, ambele sursa90. Tipurile, valorile raw, NULL/gol, proveniența și850 de celule Lookup sunt verificate separat. Nu s-a lansat editorul Docs în acest increment. Snapshoturile salvate nu se actualizează la un nou Run.

Catalogul local provizoriu1.11/70/SHA30a1b086c370dce3f3cf06c54526b8775694bcb660b477a7f856a29f08d2c42e este acceptat doar ca inventar neadoptat: COUNTconfigure1.1, COUNTIF1.0.1 editorial,68obiecte neschimbate, endpointurilenull/commonIN_CONSTRUCTION. Providerul comun nu admite încă conditional_count. Nu se declară o nouă descoperire/execuție COUNT în UI Builder, migrare de referințe salvate sau istoric durabil de catalog.

Limite rămase: DATE/composite COUNT, Excel complet/XLOOKUP aproximativ/first-last, COUNTIFS, formulele propuse, segmente Unicode generale, un nou set nativ de anulare/crash/răspunsuri întârziate, export complet80 rânduri transformate, redeschidere în editorul Docs, Count→Charts, offline prin deconectare,120M reexecutat sau orice dataset/operație. Probele vechi rămân istorice și delimitate; erorile instrumentelor de verificare sunt păstrate separat. Nicio acceptare main/instalat/migrare/release.

Vezi [probe și limite](EVIDENCE_NOTES.md), [continuare](HANDOFF.md) și [formule recomandate](FORMULA_ROADMAP.md). Nu s-au modificat originalele sau sursele/sesiunile celorlalte taskuri. Fără instalare, publicare, merge sau release.
