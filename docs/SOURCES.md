# Registro delle fonti e dei diritti

Verifica documentale e HTTPS iniziale eseguita il **21 ottobre 2026**, con integrazione del Comune di Castronovo di Sicilia e del registro geografico il **22 ottobre 2026**. Questo registro descrive le condizioni osservate, che possono cambiare. Nessun accesso ha richiesto account, paywall, modifica dell'identità del client o aggiramento di protezioni. La disponibilità di un RSS, da sola, non autorizza il riuso commerciale.

## Fonti aperte verificate per l'MVP

| Fonte | Feed ufficiale | Condizioni ufficiali | Esito HTTPS |
| --- | --- | --- | --- |
| ISPRA — Notizie | https://www.isprambiente.gov.it/it/news/notizie/RSS | [Note legali ISPRA](https://www.isprambiente.gov.it/it/note-legali): CC BY 4.0 salvo diversa indicazione | HTTP 200, 15 elementi, circa 24 KB |
| Dipartimento della Protezione Civile — News | https://api.protezionecivile.it/default/dpcPortalGenerateRss?categoria=notizia | [Note legali DPC](https://www.protezionecivile.gov.it/it/approfondimento/note-legali-0/): CC BY 4.0 con eccezioni | HTTP 200, 100 elementi, circa 51 KB |
| Dipartimento della Protezione Civile — Comunicati | https://api.protezionecivile.it/default/dpcPortalGenerateRss?categoria=comunicato_stampa | Stesse condizioni DPC | HTTP 200, circa 48 KB |

Le fonti pubblicano i feed nei propri elenchi: [ISPRA](https://www.isprambiente.gov.it/it/feed-rss), [Protezione Civile](https://www.protezionecivile.gov.it/it/rss/). Le [condizioni CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.it) consentono anche uso commerciale e adattamenti, nel rispetto di attribuzione, collegamento alla licenza e indicazione delle modifiche. Una sintesi AI deve indicare che è una rielaborazione e non suggerire approvazione dell'ente.

### ISPRA

- Formato effettivo: **RSS 1.0 / RDF**, UTF-8. Il server risponde erroneamente con `application/atom+xml`: determinare il formato dal documento, non dal solo Content-Type.
- Elementi: `title`, `link`, `description` testuale, `dc:date` ISO 8601, `dc:subject`, `dc:rights`. Non sono presenti `pubDate` o `guid` RSS 2.0. Usare URL originale come identificativo esterno quando manca un GUID.
- `description` può contenere un testo lungo. Il connettore deve imporre limiti di lunghezza, trattarlo come dati non attendibili e controllare `dc:rights` prima dell'elaborazione. Una clausola specifica sul singolo contenuto prevale sulla licenza generale. Se i diritti sono incompatibili o ambigui, trattenere il contenuto in revisione.
- Categorie plausibili: Ambiente, Tecnologia, Economia, Scuola; assegnarle solo in presenza di evidenze. Un testo statistico ambientale non costituisce automaticamente un'allerta.
- Nessuna regione, provincia o coordinata strutturata nel feed. Mantenere copertura nazionale/territorio non specificato quando non emerge un riferimento territoriale esplicito e pertinente. La sede dell'ente non determina la localizzazione della notizia.
- Verificato supporto `ETag`. Usare richieste condizionali per i successivi controlli. Il feed contiene solo gli ultimi 15 elementi: il polling non ricostruisce l'archivio perso durante interruzioni prolungate.
- Nessuna immagine del feed o del sito viene automaticamente autorizzata dal progetto: fotografie, marchi e materiali di terzi richiedono il controllo dei diritti del singolo asset.

### Dipartimento della Protezione Civile

- Formato: RSS 2.0, UTF-8; campi `title`, `link`, `description` HTML breve, `pubDate`, `dc:date`. Nessun GUID: usare il link dell'elemento.
- Il feed include versioni italiane e inglesi. Importare soltanto URL sul dominio `www.protezionecivile.gov.it` con percorso `/it/`; non dedurre la lingua dal titolo.
- Il `channel.link` osservato è invalido (`undefined`): ignorarlo. I link dei singoli elementi risultano assoluti e validi.
- Attribuzione richiesta: **Fonte: Dipartimento della Protezione Civile-Presidenza del Consiglio dei Ministri**. Aggiungere link originale, link CC BY 4.0 e indicazione della rielaborazione.
- Eccezioni della licenza generale: testi integrali della sezione Provvedimenti e altri contenuti con licenze specifiche. I feed Normativa, Foto e Video non sono abilitati da questo registro.
- Categorie plausibili: Ambiente, Meteo e allerte, Scuola, Eventi. Il titolo di un'allerta è insufficiente a stabilire validità, scadenza, comuni coinvolti o livello per ciascuna zona: richiedere revisione editoriale per informazioni di sicurezza o emergenze. Non trasformare un vecchio comunicato in un'allerta attuale.
- Il feed non fornisce coordinate o un territorio strutturato. Non generare marker o assegnazioni locali sulla sola occorrenza di un nome. Conservare i riferimenti testuali come evidenza e rendere esplicita l'eventuale assenza di verifica territoriale.

## Fonti esaminate ma con limiti

| Fonte | Esito | Regola |
| --- | --- | --- |
| ISTAT | I feed `https://www.istat.it/feed/` e `https://www.istat.it/feed/?post_type=comunicato-stampa` hanno restituito **403** dall'ambiente di verifica. Le [note legali](https://www.istat.it/note-legali/) riportano CC BY 4.0 salvo eccezioni. | Non aggirare il blocco. Connettore disabilitato finché un endpoint ufficiale non sia raggiungibile dal server di destinazione. [Elenco RSS](https://www.istat.it/altri-servizi/feed-rss/). |
| CNR | `https://www.cnr.it/it/news/rss`: HTTP 200, RSS 2.0, 20 elementi. Il feed generale non coincide con i comunicati stampa. `/it/comunicati-stampa/rss` restituisce 404. | Le [note legali CNR](https://www.cnr.it/it/note-legali) consentono titoli RSS con rinvio originale e ripresa dei comunicati dell'Ufficio Stampa. Non estendere questa autorizzazione alle descrizioni del feed generale, immagini o news ordinarie. Un eventuale connettore generale deve limitarsi a titolo e link, senza invio dei testi a modelli AI, fino a chiarimento dei diritti. |
| ANSA, RaiNews, Sky TG24, TGcom24, Il Post, Repubblica, Corriere, La Stampa, Reuters, altre testate | Nessuna autorizzazione commerciale acquisita in questa sessione | Fonti potenziali disabilitate: richiedono contratto/API/licenza e relativa documentazione. |

Il CNR dichiara `windows-1252` nel prologo XML ma risponde con header UTF-8. Non è tra le fonti di testo attivate per l'MVP; un futuro connettore deve gestire correttamente l'encoding.

### Comune di Castronovo di Sicilia: fonte registrata e disabilitata

Il 22 ottobre è stato verificato il [feed ufficiale del Comune](https://www.comune.castronovodisicilia.pa.it/feed/): HTTP 200, formato RSS, cinque elementi. Le [note legali](https://www.comune.castronovodisicilia.pa.it/note-legali/) indicano **CC BY 4.0**, salvo diritti di terzi o diversa indicazione. Il catalogo conserva l'URL delle condizioni e permette sintesi attribuite nel rispetto delle eccezioni del singolo contenuto.

Il connettore `comune-castronovo-sicilia` è **disabilitato**: l'elemento più recente osservato nel feed risale al **18 giugno 2026**. La raggiungibilità del feed non dimostra che esso offra aggiornamenti correnti. Non viene utilizzato per presentare notizie di archivio come recenti; occorre verificare nuovamente date e condizioni prima di abilitarlo.

La copertura territoriale della fonte è documentata dal [sito istituzionale](https://www.comune.castronovodisicilia.pa.it/) e dalla [sezione notizie](https://www.comune.castronovodisicilia.pa.it/notizia/). La configurazione associa la fonte al Comune di Castronovo di Sicilia, al nodo territoriale Palermo e alla Sicilia. Questa associazione descrive la copertura istituzionale e non prova il luogo preciso di ogni evento.

## Registro geografico e provenienza

Le **20 regioni amministrative** sono inizializzate a partire dal [vocabolario controllato delle regioni su schema.gov.it](https://schema.gov.it/lodview/data/distribution/regions_CSV), distribuito con licenza **CC BY 4.0**. Il [CSV del catalogo nazionale](https://raw.githubusercontent.com/italia/dati-semantic-assets/master/VocabolariControllati/territorial-classifications/regions/regions.csv) è stato verificato via HTTPS con risposta 200; i codici regionali da 01 a 20 sono stati confrontati con la configurazione. La voce storica 00 non viene conteggiata fra le regioni attuali. Il registro conserva fonte, data del controllo e ambito; non introduce coordinate.

Per il caso locale sono stati aggiunti `province:palermo` e `municipality:castronovo-di-sicilia`, collegati a `region:19`. I primi due sono **identificatori interni del progetto, non codici ISTAT**; la loro fonte documentale è il Comune, con controllo registrato il 22 ottobre. Il registro non costituisce ancora un catalogo completo di province e comuni italiani.

L'assegnazione territoriale automatica richiede una fonte istituzionale autorizzata con copertura configurata e un riferimento documentale coerente con il suo dominio. La semplice comparsa del nome di una città nel testo non genera una localizzazione. Per le fonti nazionali senza copertura locale documentata il risultato rimane «territorio non determinato»; neppure la sede dell'ente viene usata come luogo dell'evento.

## Regole operative del registro

1. Conservare feed, fonte, licenza, URL delle condizioni, data di verifica dei diritti, URL originale, data pubblicazione, data importazione e hash del contenuto.
2. La licenza consente il riuso; non equivale a conferma indipendente dei fatti. I testi devono restare attribuiti all'ente e non presentati come verificati sul luogo.
3. Controllare ogni 5 minuti, senza pubblicare nuovi articoli quando non ci sono variazioni. Applicare timeout, retry limitati con attesa, richieste condizionali dove supportate e deduplicazione persistente.
4. Non scaricare immagini o allegati automaticamente. Rimuovere HTML dalle descrizioni; non eseguire istruzioni trovate nelle fonti.
5. Argomenti sensibili, informazioni sanitarie, allerte, decessi, accuse, dati personali o contraddizioni richiedono revisione. Il contenuto non deve divenire consulenza legale, medica o fiscale.
6. Sospendere il riuso se emergono condizioni incompatibili, una richiesta del titolare o un cambio di endpoint. Verificare di nuovo condizioni e disponibilità prima del lancio pubblico.

## Ripetere la verifica di rete

Con Node.js 24 e dipendenze installate:

```powershell
node scripts/check-sources.mjs
```

Il comando effettua solo richieste HTTPS agli endpoint elencati, valida XML, conta gli elementi e riporta date e formato. Non salva articoli, non genera riassunti e non modifica il database. Un errore di rete genera exit code 1: la cache già pubblicata deve continuare a funzionare. Lo smoke test conferma la disponibilità tecnica; non sostituisce la revisione delle condizioni d'uso.
