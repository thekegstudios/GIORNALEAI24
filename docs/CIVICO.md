# Servizi civici di GIORNALE AI24

Implementazione del 22 ottobre 2026 nel progetto esistente. Non sono state aggiunte notizie, ordinanze o norme dimostrative al database pubblico.

## Il mio Comune

`/il-mio-comune` mostra avvisi ufficiali e articoli già pubblicati del territorio selezionato. Il registro iniziale comprende Sicilia → Palermo → Castronovo di Sicilia: non rappresenta una copertura dei Comuni italiani completa. I filtri mostrano soltanto il territorio collegato.

Ogni avviso conserva ente, categoria, titolo, riepilogo editoriale, data di pubblicazione della fonte, URL originale, eventuale decorrenza/scadenza, verifica e stato di pubblicazione. La validità è distinta dalla data della notizia: una scadenza passata viene etichettata automaticamente «Scaduto» usando Europe/Rome. Se il documento non dichiara una validità, la pagina lo dice; non considera l’avviso in vigore per il solo fatto di essere recente. Un avviso fino a revoca invita a ricontrollare eventuali aggiornamenti nella fonte.

Il [sito istituzionale del Comune](https://www.comune.castronovodisicilia.pa.it/) pubblica [condizioni CC BY 4.0 salvo eccezioni e contenuti di terzi](https://www.comune.castronovodisicilia.pa.it/note-legali/), verificate il 22 ottobre 2026. Il [registro pubblico dei tipi WordPress](https://www.comune.castronovodisicilia.pa.it/wp-json/wp/v2/types) ha risposto HTTP 200; espone articoli, pagine, servizi e unità organizzative, ma non un tipo di avvisi/notizie consultabile tramite il registro. Il feed già verificato è di archivio, con ultimo elemento del 18 giugno 2026. Non è stato dichiarato un collegamento corrente all’albo pretorio e non sono state aggirate limitazioni del sito.

`runCivicCycle()` legge solo gli articoli pubblicati nel database, provenienti dalla fonte comunale ufficiale autorizzata, con Comune corrispondente e data della fonte negli ultimi trenta giorni. Li inserisce in **revisione**, con validità non dichiarata. Non effettua richieste di rete né attribuisce autonomamente scadenze. Gli articoli ritirati smettono di alimentare avvisi visibili. La frequenza può essere collegata al worker esistente senza cambiare il ciclo delle notizie.

## Cosa cambia davvero?

`/cosa-cambia-davvero` distingue annuncio, proposta, disegno di legge, approvazione, pubblicazione ufficiale, entrata in vigore, scadenza, modifica e stato non verificabile.

La scheda comprende spiegazione semplice, informazioni per i cittadini, fonte istituzionale, date di pubblicazione/efficacia/scadenza, testo che supporta lo stato e cronologia dei passaggi. Non viene usato un modello AI per stabilire l’efficacia giuridica. Un annuncio o una proposta non possono avere una data di efficacia presentata come verificata.

Lo stato «In vigore» richiede un documento su Gazzetta Ufficiale o Normattiva, una disposizione esplicita registrata dal revisore, una data di efficacia non futura e nessuna scadenza già trascorsa. Il sistema impedisce di usare un comunicato politico come unica prova. Questo è un controllo editoriale sui dati inseriti, non una verifica automatica del contenuto dei documenti o una consulenza legale. Le modifiche successive devono essere registrate e controllate dal gestore.

Il registro ammette i domini istituzionali di Camera, Senato, Governo, Gazzetta Ufficiale, Normattiva, INPS, Agenzia delle Entrate e i ministeri indicati nel codice. Sono ammessi documenti HTTPS, non la sola homepage; hostname simili, credenziali nell’URL e domini esterni vengono rifiutati. Aggiungere nuove istituzioni richiede una verifica del registro.

## Gestione concreta

Accedere a `/admin`, quindi `/admin/servizi-civici`.

1. Inserire un ID stabile e i dati dell’avviso o provvedimento. Il documento deve appartenere al dominio istituzionale previsto.
2. Salvare in revisione e controllare il documento originale, i diritti di riuso del riepilogo e le date.
3. Registrare la nota di verifica, il passaggio che supporta lo stato e l’eventuale cronologia; selezionare la conferma del controllo originale.
4. Selezionare «Pubblicato» e salvare. I record in revisione non compaiono nelle letture pubbliche.
5. Per una correzione modificare la scheda; per un ritiro selezionare «Ritirato». Le versioni precedenti restano nel database e le operazioni vengono registrate nel log della redazione. Le versioni non approvate non vengono esposte dal servizio pubblico.

La presenza di una URL istituzionale non prova da sola il contenuto: è richiesta una verifica editoriale effettiva. In assenza di un canale corrente e autorizzato, il sistema mantiene questo flusso di revisione manuale e indica la copertura limitata.

## Integrazione

- Tabelle già presenti nella migrazione `005_public_services.sql`: `municipal_notices`, `civic_measures`. Lo stato del ciclo usa `public_data_runtime`; l’audit usa il log esistente. Non servono nuove variabili d’ambiente, chiavi API, abbonamenti o servizi esterni.
- `src/lib/civic.ts`: `runCivicCycle`, `getCivicNotices`, `getCivicMeasures`, `getCivicOverview`, `saveCivicNotice`, `saveCivicMeasure`, `noticeValidity`, `measureState`.
- `GET /api/civic?kind=notices&municipality=castronovo-di-sicilia`: lettura del database, cache 60 secondi, rate limit. `kind=measures` legge i provvedimenti. Ogni risposta distingue la validità/stato corrente dai campi originali conservati.
- `GET/POST /api/admin/civic`: sessione amministrativa esistente, Origin obbligatorio per le scritture, rate limit, JSON limitato a 32 KB e schema rigoroso. Comandi: `notice`, `measure`, `collect-public-articles`.
- Il bootstrap PostgreSQL deve proteggere le tabelle con RLS e revocare l’accesso diretto dei ruoli REST pubblici come per le altre tabelle editoriali.

## Verifica

`node node_modules/tsx/dist/cli.mjs --test tests/civic.test.ts`: test in un database isolato in memoria. Verificano i domini istituzionali, i controlli prima della pubblicazione, gli stati di validità, la separazione annunci/norme, i requisiti di efficacia, scadenze, ritiro, versioni private e comportamento del ciclo senza fonte corrente. I documenti di prova non sono fonti reali e non vengono salvati nel sito pubblico.
