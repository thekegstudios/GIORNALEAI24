# Dati e strumenti pubblici

Implementazione locale aggiornata il **23 ottobre 2026**. Le pagine leggono dati condivisi già importati nel database; non interrogano le fonti ufficiali a ogni visita e non creano automaticamente articoli da un numero. Gli stati vuoti e gli errori conservano la distinzione tra dato assente, dataset vecchio e ultimo controllo riuscito.

## Carburanti MIMIT

`/carburanti` permette confronto per Comune o sigla della provincia, carburante, self/servito e rete stradale/autostradale; la ricerca vicino alla posizione richiede un clic esplicito. Il dataset non offre un CAP strutturato, e il progetto non ne inventa uno.

Fonti originali:

- [Dataset e metadati MIMIT](https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti).
- [Anagrafica degli impianti attivi](https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv).
- [Prezzi alle 8](https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv).

Il Ministero pubblica i prezzi comunicati dai gestori, con aggiornamento quotidiano riferito alle informazioni in vigore alle ore 8 del giorno precedente. Il formato usa il separatore `|` dal 10 febbraio 2026. I dati sono distribuiti con **IODL 2.0**, come riportato dal [registro open data MIMIT](https://www.mimit.gov.it/it/open-data). La lettura sul giornale non garantisce il prezzo effettivo al momento del rifornimento: conservare fonte, estrazione e data della comunicazione e ricontrollare presso il distributore.

Entrambi i CSV originali hanno risposto **HTTP 200** durante la raccolta reale della sessione. Lo snapshot importato, con **estrazione 21 ottobre 2026**, comprende **23.810 impianti**, **92.286 prezzi normalizzati** e **535 righe scartate**. Sono conteggi di quell'importazione, non una promessa sui file futuri o una prova che ogni prezzo sia stato aggiornato quel giorno. Il parser rifiuta estrazioni discordanti o future, prezzi senza impianto, date/unità non valide e dataset con scarti eccessivi. Una transazione sostituisce le tabelle correnti soltanto dopo i controlli; hash persistente e lease evitano importazioni duplicate. Un errore mantiene lo snapshot precedente e viene registrato.

`scripts/data-worker.ts` controlla le scadenze ogni minuto; dopo un successo MIMIT viene ricontrollato dopo **12 ore**. Il dato resta un'estrazione quotidiana condivisa, non una richiesta live all'Osservatorio. In caso di errore il retry cresce da 15 minuti fino a sei ore. `FUEL_DATA_ENABLED=false` disabilita il connettore. Non occorrono chiavi o abbonamenti.

Ogni prezzo mostra `€/l`, oppure **`€/kg` per metano/CNG/LNG/GNL**, modalità di erogazione e data di comunicazione. Le voci oltre sette giorni sono etichettate come vecchie. La distanza è in linea d'aria, non un percorso stradale. Le coordinate fuori dall'ambito italiano previsto non diventano marker.

Le medie esposte in `/italia-in-numeri` e nel confronto sono **medie aritmetiche calcolate da GIORNALE AI24 sui prezzi del dataset comunicati da non oltre sette giorni**, separate per carburante, modalità e rete. Non sono le medie ponderate ufficiali del Ministero. Lo storico inizia dalle importazioni realmente eseguite: nessuna serie passata viene ricostruita o simulata. La differenza fra due estrazioni non è necessariamente la variazione di un identico campione di impianti.

## Inflazione, alimentari ed energia

`/italia-in-numeri` e `/guerra-silenziosa` usano il dataset Eurostat **`prc_hicp_minr`**, con classificazione 2026 **`coicop18`**, `geo=IT`, `freq=M`, `unit=RCH_A` e un massimo di 36 periodi per serie. La fonte è [Eurostat: indici armonizzati mensili](https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en).

| Serie del giornale | Codice | Unità e significato |
| --- | --- | --- |
| Inflazione IPCA italiana | `TOTAL` | Percentuale rispetto allo stesso mese dell'anno precedente |
| Alimentari e bevande analcoliche | `CP01` | Variazione annua dell'IPCA della categoria |
| Elettricità, gas e altri combustibili | `CP045` | Variazione annua dell'IPCA della categoria; non un prezzo dell'energia |

L'IPCA armonizzato non è intercambiabile con gli indici nazionali NIC o FOI. La variazione annua non è una variazione mensile; la differenza fra due variazioni annue è indicata in **punti percentuali**. L'indice dell'energia non rappresenta la bolletta individuale né una tariffa ARERA. Non sono attivi connettori diretti ISTAT, ARERA, stipendi o pensioni: aggiungerli richiede fonti e unità documentate.

La prima importazione reale ha salvato **108 osservazioni complessive** nelle tre serie. Il periodo più recente era **settembre 2026**; il corpo del dataset riportava aggiornamento **16 ottobre 2026**. Queste date restano separate dal momento del download e dal controllo odierno. Non vengono esposti numeri di settembre come dati del giorno corrente.

Dopo un successo il worker ricontrolla dopo **24 ore**; un errore prevede un nuovo tentativo dopo un'ora, conserva le serie già salvate e segnala il problema. `ECONOMIC_DATA_ENABLED=false` disabilita il connettore. Il parser JSON-stat controlla tutte le dimensioni filtrate, periodo, valori e data della fonte. Le revisioni di valori o flag conservano la versione precedente. Eventuali contrassegni della fonte vengono mantenuti, senza dichiarare definitivi i valori provvisori.

Le [condizioni Eurostat](https://ec.europa.eu/eurostat/help/copyright-notice), ricontrollate il 23 ottobre, consentono il riuso commerciale dei dati italiani qui selezionati con attribuzione, fatte salve le eccezioni indicate dalla fonte. Grafici, differenze e presentazione sono elaborazioni di GIORNALE AI24; **Eurostat non ne è responsabile**. Loghi, immagini e dati di terzi non sono inclusi automaticamente nell'autorizzazione.

## Posizione, cartografia e simulatore

Premere “Vicino a me” può aprire il permesso del browser. Le coordinate sono inviate all'API del giornale per la singola ricerca e restano nella memoria della pagina, senza archivio di posizioni. Non configurare log del reverse proxy che conservino i parametri di `/api/carburanti`. È sempre disponibile la ricerca manuale per Comune o provincia.

“Mostra mappa” carica le tessere esterne OpenStreetMap per l'area dei distributori selezionati, fino a 25 prezzi con coordinate. Il browser contatta il fornitore con IP, informazioni tecniche e area cartografica richiesta; la posizione precisa del lettore non viene inserita come marker. I link “Apri posizione” aprono il sito esterno con le coordinate del distributore. Attribuzione e [policy delle tessere OSM](https://operations.osmfoundation.org/policies/tiles/) devono restare visibili e rispettate; il servizio pubblico non offre SLA e non consente scaricamenti massivi o mappe offline. Il service worker del giornale non salva queste tessere.

`/quanto-mi-costa-vivere` calcola totale mensile/annuo, ripartizione e uno scenario percentuale scelto dal lettore. Gli importi restano **solo nella memoria della pagina**, senza upload o localStorage. La percentuale è uno scenario aritmetico su tutte le spese inserite, non una previsione dell'inflazione personale, del mutuo o del reddito e non una consulenza finanziaria. Il riferimento IPCA è accompagnato dal proprio periodo.

## Esecuzione, API e verifiche

```powershell
pnpm data:import
pnpm data:worker
```

Il primo comando esegue un solo ciclo rispettando le scadenze; il secondo è un processo indipendente. Nel compose è `data-worker`, con lo stesso database persistente del web. Le tabelle sono nella migrazione `005_public_services.sql`, protette dal bootstrap PostgreSQL come le altre tabelle applicative. `GET /api/carburanti` legge soltanto lo snapshot con filtri convalidati e rate limit; non scarica i CSV.

Le verifiche del supervisore includono dataset vecchi, date di controllo distinte e righe scartate in `tests/service-health.test.ts`. Le importazioni reali citate sopra dimostrano il flusso dei due provider nel momento della raccolta, senza assicurare disponibilità futura. Il registro aggiornato delle prove effettivamente eseguite è [VALIDATION](VALIDATION.md); una prova tecnica non conferma resa mobile o installazione PWA. Il browser automatico della sessione è stato bloccato dalla policy.

Per avvisi locali e provvedimenti vedere [CIVICO](CIVICO.md). Per cartografia offline esclusa, articoli salvati e dati locali vedere [PWA](PWA.md). Per stato dei connettori, allarmi e recuperi vedere [AUTOCONTROLLO](AUTOCONTROLLO.md).
