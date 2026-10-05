# Agenda proprietaria Desideri di Felicità

Il sito, il calendario e l’agenda usano lo stesso servizio Railway. Non richiedono
un abbonamento a un gestionale o un database esterno. Restano il consumo Railway
e l’eventuale costo dei messaggi stabilito da Meta.

## Prima apertura

1. Aprire il collegamento privato `/admin#attiva=…` fornito alla titolare.
   Il token è forte, ha una scadenza e può creare un solo account; viene rimosso
   subito dalla barra dell’indirizzo. Non condividerlo né inserirlo nel repository.
2. Scegliere email e password di almeno 12 caratteri. I dati clienti sono visibili
   solo dopo l’accesso. La sessione scade dopo 12 ore; logout revoca il cookie.
3. Il calendario pubblico riceve già richieste con servizio, giorno e orario
   desiderato, anche senza durate configurate. In **Richieste**, Jessica verifica
   data, ora e durata effettiva e conferma o rifiuta. Una richiesta ancora pendente
   non occupa un appuntamento e non genera promemoria.
4. Per la conferma immediata, impostare in **Servizi** le durate reali e abilitare
   i servizi; in **Impostazioni**, verificare orari/chiusure e attivare «Conferma
   automaticamente i servizi configurati». Gli altri servizi continuano a ricevere
   richieste. «Ricevi richieste dal calendario» permette di sospenderle separatamente.
5. Inserire nell’agenda gli appuntamenti già presenti sulla carta: devono occupare
   gli orari prima di aprire il calendario alle clienti.

Il portale è disponibile su `/admin`, con `/agenda` mantenuto come collegamento compatibile.
La panoramica mostra le richieste da confermare, gli appuntamenti e una guida alla configurazione.

L’agenda permette inserimento, modifica, spostamento, cancellazione, vista giornaliera
e settimanale ed esportazione CSV. Le clienti non creano un account; la conferma
sul sito include un riferimento e distingue **Richiesta ricevuta** da
**Appuntamento confermato**. Retry identici di una richiesta restituiscono lo
stesso riferimento, senza creare duplicati. Anche la conferma immediata dal
calendario usa un identificatore di invio: riprovare lo stesso invio non crea un
secondo appuntamento. Non sono previsti pagamenti sul sito.

## Percorso cliente

Le schede dei servizi aprono il calendario con il servizio già scelto. Una ricerca
di massimo 14 giorni mostra il primo orario disponibile o il primo orario da
richiedere, senza confondere richiesta e conferma. Il riepilogo accompagna la scelta;
nome, telefono e nota facoltativa vengono richiesti soltanto per inviare la prenotazione.
La galleria permette di filtrare i lavori e ingrandire le foto già pubblicate.

La ricevuta può includere un collegamento personale `/appuntamento/#chiave=…`:
la cliente lo conserva per ritrovare lo stato senza creare un account. Una richiesta
pendente può essere ritirata; quando Jessica la conferma, lo stesso collegamento
mostra l’appuntamento. Un appuntamento può essere annullato o spostato su un orario
realmente disponibile entro le regole impostate dal salone. Uno spostamento conserva
durata e tempo di preparazione dell’appuntamento, anche se il catalogo viene modificato.
Le modifiche concorrenti vengono rilevate prima di salvare.

Il link è personale e scade sette giorni dopo la fine dell’appuntamento, o dopo
l’orario richiesto finché la richiesta è pendente. Il token non viene messo nelle query HTTP,
nei log applicativi o nel browser storage; la pagina lo usa in memoria e lo rimuove
subito dalla barra dell’indirizzo. La chiave di accesso viene derivata, con un dominio
separato, dalla chiave server `WHATSAPP_CONFIG_KEY`: conservarla privatamente serve
anche a mantenere questi collegamenti dopo un ripristino. In installazioni senza
chiave server l’agenda funziona e rimane disponibile l’assistenza del salone.
Il portale permette di copiare il collegamento per una cliente; nessuna API invia
automaticamente quel link. Sostituire un collegamento invalida quello precedente;
cambiare il numero della cliente revoca anche l’accesso precedente. La pagina
personale permette di copiare il collegamento prima di chiuderla: ricaricare
l’indirizzo senza la chiave non recupera l’accesso.

Solo gli appuntamenti confermati e ancora programmati hanno il download calendario `.ics`, con orari
effettivi e indirizzo. Il file non contiene token, nome, numero cliente o note.
Il download non attiva una sincronizzazione: dopo uno spostamento occorre aggiornare
l’evento nel proprio calendario.

## Promemoria e costi

- Il consenso WhatsApp è facoltativo e inizialmente non selezionato. Nessun marketing.
- Orario: 18:00 Europe/Rome, la sera precedente. Questa versione mantiene un orario fisso.
- Un solo promemoria automatico per appuntamento, anche se viene spostato dopo
  un invio già accettato o dall’esito incerto. In quel caso Jessica comunica
  manualmente il nuovo orario; l’agenda lo indica. Nessun invio automatico di conferma.
- **Modalità risparmio attiva inizialmente:** massimo 10 invii al giorno e 60 al mese.
  Le quote configurate preesistenti restano conservate, ma il limite effettivo usa
  il minore fra la quota scelta e il tetto della modalità risparmio. Un limite 0
  continua a sospendere gli invii. Jessica può modificare le quote e la modalità
  nelle Impostazioni: l’agenda mostra i limiti effettivi e la quota ancora disponibile.
  Gli esiti incerti consumano quota prudentemente. I conteggi non sono una fattura
  né un tetto di spesa in euro: la tariffa applicabile la determina Meta.
- Cancellazioni e spostamenti invalidano i lavori ancora da inviare. Il sistema
  controlla ancora l’appuntamento prima di contattare Meta e registra il suo ID.
- Solo un rifiuto esplicito 429 può essere riprovato, con attesa e massimo 3 tentativi.
  Timeout, errore di rete, 5xx o risposta ambigua diventano **Da verificare**:
  nessun reinvio automatico che rischi un secondo messaggio a pagamento.
- I riavvii conservano la coda. Non vengono recuperati messaggi dopo la fine del
  giorno precedente all’appuntamento. Limiti raggiunti possono lasciare un promemoria
  sospeso fino a quella scadenza; l’agenda mostra lo stato senza inventare consegne.
- La sezione Promemoria mostra inizialmente quelli previsti oggi, con filtri per
  domani o lo storico. Il pulsante manuale apre WhatsApp con testo preparato: la
  titolare deve premere **Invia** nell’app. Aprire il link non registra un invio.
  Dopo averlo effettivamente inviato, può confermare **Ho inviato il promemoria**:
  il sistema registra la dichiarazione della titolare e blocca ulteriori invii API
  per quell’appuntamento. Non simula una consegna Meta, non costa una chiamata API
  e non libera la quota già consumata da un eventuale invio dall’esito incerto.

Le limitazioni sono deliberate per ridurre traffico, reinvii e servizi separati.
Non garantiscono consegna se numero, connessione o fornitore non sono disponibili.

## Scelta economica

Il software mantiene gli invii automatici attraverso la Cloud API diretta di Meta,
con il modello utility approvato, senza canoni o maggiorazioni di intermediari.
Finché il collegamento non è configurato e attivato, il software non avvia invii API;
Jessica può lavorare con calendario, agenda e promemoria manuali dall’app esistente.

Le condizioni Meta vanno verificate sulle
[regole di tariffazione](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/)
e sulle [FAQ ufficiali](https://business.whatsapp.com/resources/faq/). Al 5 ottobre 2026
la documentazione sviluppatori indica tariffazione anche per i template utility nella
finestra di assistenza dal 1 ottobre. La logica quindi non presume gratuità delle 24 ore
né applica ai template la quota gratuita dei messaggi di servizio. Non è stata verificata
una tariffa italiana del conto; tutti gli invii sono conteggiati prudentemente nei limiti.

Railway ospita un solo processo e SQLite sul volume esistente. Le
[tariffe del piano](https://docs.railway.com/pricing/plans) prevedono per Hobby un minimo
di $5 al mese con $5 di consumi inclusi: ridurre un consumo già sotto il minimo non
riduce quel minimo. I consumi osservati non rappresentano una fattura o una garanzia
dei mesi successivi; piano attivo, altri progetti, traffico e imposte possono incidere.
Le build sono gratuite; non sono stati creati database o worker aggiuntivi.

Lo [spegnimento automatico](https://docs.railway.com/deployments/serverless) fermerebbe
i timer dei promemoria e non viene abilitato. Il worker evita transazioni di scrittura
quando è sospeso o non ha lavori scaduti, mantenendo recupero sicuro e controllo minuto
per minuto. Non si abbassano limiti RAM solo per dichiarare un risparmio: la memoria
è misurata sul consumo effettivo.

## Attivare WhatsApp automatico

Serve un account WhatsApp Business Platform con numero registrato, token server
e un template **utility approvato**. La logica proprietaria usa esclusivamente la
[Cloud API ufficiale](https://developers.facebook.com/documentation/business-messaging/whatsapp/).
Le credenziali non sono disponibili in questa sessione: il software è predisposto,
ma non dichiara attivo l’invio finché mancano.

Jessica può configurare il collegamento dalla sezione **Collega WhatsApp** del portale,
confermando con la propria password. I segreti non vengono mai restituiti dal server: un
campo vuoto mantiene il valore salvato. Il token di verifica si genera e si copia prima
del salvataggio, per usarlo anche nel pannello Meta. Salvare le credenziali mantiene
gli invii sospesi; il comando **Attiva promemoria automatici** è separato e protetto
dalla password. Il salvataggio non verifica l’approvazione del modello e non invia test.

I dati vengono cifrati con AES-256-GCM nel database persistente; `WHATSAPP_CONFIG_KEY`,
chiave casuale di 32 byte in base64, resta nelle variabili server Railway, fuori dal
database e dal repository. Per un ripristino su un altro server serve conservare anche
questa chiave in modo privato. Una chiave assente o diversa sospende gli invii e impedisce
modifiche alle credenziali cifrate, senza ricadere su vecchie credenziali dell’ambiente.

Le variabili seguenti restano supportate per installazioni configurate dall’infrastruttura,
finché non viene salvato un collegamento nel portale. Le impostazioni del portale prevalgono
poi sulle variabili e si applicano subito, anche dopo un riavvio:

Variabili server Railway (mai nel frontend o nel repository):

| Variabile | Contenuto |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Token permanente del system user con accesso al numero |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificativo Meta del numero, non il numero telefonico |
| `WHATSAPP_TEMPLATE_NAME` | Nome esatto del template utility approvato |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Lingua del template, inizialmente `it` |
| `WHATSAPP_GRAPH_VERSION` | Versione supportata, inizialmente `v26.0` |
| `WHATSAPP_APP_SECRET` | Segreto dell’app per verificare la firma webhook |
| `WHATSAPP_VERIFY_TOKEN` | Token casuale forte per la verifica iniziale webhook |

Esempio testo da sottoporre ad approvazione, con **tre parametri body posizionali**:

> Ciao {{1}}, ti ricordiamo l’appuntamento da Desideri di Felicità il {{2}} alle {{3}}.
> Per modifiche o cancellazioni contatta il salone.

I parametri contengono nome, data italiana e ora. Non aggiungere header, bottoni o
parametri che l’adapter non invia. Configurare il webhook pubblico
`https://desideri-di-felicita-production.up.railway.app/api/whatsapp/webhook` e
sottoscrivere gli eventi `messages`. Il server verifica HMAC sul corpo originale,
deduplica gli eventi e registra stati consegnato/letto/errore senza rispondere
automaticamente ai messaggi ricevuti.

L’uso dello stesso numero già presente nell’app WhatsApp Business va verificato:
la coexistence dipende dal percorso di onboarding ufficiale e non si abilita
semplicemente copiando un token. Potrebbero servire onboarding compatibile,
migrazione o un numero dedicato. Nessuna automazione WhatsApp Web o sessione QR.
Le [tariffe Meta](https://business.whatsapp.com/products/platform-pricing) dipendono
da paese, categoria e regole applicabili; non è stato fissato un prezzo italiano.

## Servizi, clienti e disponibilità

In **Servizi**, Jessica può aggiungere e rinominare i servizi, impostare descrizione,
durata reale, prezzo facoltativo fisso o “da”, tempo di preparazione dopo il servizio,
conferma automatica e visibilità. I campi non compilati non generano prezzi o durate
inventati. Il catalogo pubblico legge le impostazioni salvate quando l’API è disponibile;
su Pages resta il contenuto statico confermato come fallback.
Nascondere un servizio non cancella appuntamenti o richieste preesistenti; può essere
ripristinato. Le durate non vengono precompilate senza una decisione della titolare.

Ogni variante è un servizio indipendente: per esempio, taglio corto e taglio lungo
possono avere nome, descrizione, prezzo, durata e tempi di riordino diversi. **Crea
variante** prepara un nuovo servizio partendo dai dati già salvati; Jessica può
modificare tutti i campi prima di crearlo. La variante non cambia l’originale e la
conferma automatica parte disattivata. Una bozza non viene pubblicata prima del salvataggio.

**Rimuovi dal catalogo** toglie il servizio dal sito e dalle nuove prenotazioni,
conservando appuntamenti e richieste nello storico. **Ripristina nel catalogo**
lo rende nuovamente visibile senza riattivare automaticamente la conferma immediata.
La ricerca e i filtri **Visibili**, **Archiviati** e **Tutti** aiutano a trovare
anche i servizi rimossi. Le modifiche non salvate restano in memoria tra i filtri.

La home, il catalogo pubblico e il calendario leggono i servizi pubblicati. La
specialità riccio è collegata al servizio originale tramite il suo identificativo,
così rinominarlo non lo duplica e rimuoverlo nasconde anche la sua scheda dedicata.
In assenza di API o JavaScript resta la vetrina statica di fallback.

Il tempo di preparazione impedisce una prenotazione consecutiva troppo ravvicinata,
ma non allunga la durata del trattamento mostrata alla cliente. Parte da 0 minuti;
una modifica del servizio si applica ai nuovi appuntamenti, senza modificare quelli
già salvati. L’agenda mostra i tempi occupati e le pause; le richieste pendenti non
occupano capacità. Il riepilogo della giornata usa soltanto gli intervalli reali.

**Orari e impostazioni** usa campi ora per ogni giorno e un calendario per aggiungere
le chiusure straordinarie. Le fasce aggiornano il calendario clienti e, con JavaScript,
gli orari pubblici in Contatti e nel footer; il contenuto statico confermato resta come
fallback su Pages e quando non si raggiunge l’API. Le modifiche non annullano appuntamenti
già confermati. Il calendario e il server usano Europe/Rome.

Il preavviso minimo di prenotazione e quello per le modifiche cliente partono da 0,
per conservare il comportamento attuale: Jessica può aumentare i valori e sospendere
le modifiche autonome. In Appuntamenti può inserire pause o altri blocchi con orario
e durata. I blocchi escludono quegli intervalli dal calendario clienti; il sistema
impedisce di sovrapporli ad appuntamenti già confermati.

**Clienti** permette ricerca per nome o telefono e consultazione dello storico. La
rubrica deriva soltanto dai dati già raccolti per appuntamenti e richieste. I conteggi
includono i record annullati/rifiutati, mentre ultima e prossima data riguardano
appuntamenti confermati. Le preferenze possono essere annotate privatamente nella
scheda: non vengono mostrate alle clienti o inviate a Meta. Le modifiche concorrenti
alle note richiedono una nuova verifica, senza sovrascrivere una bozza. **Riprenota**
riporta nome, telefono, servizio e durata effettiva dello storico; Jessica sceglie
la nuova data e verifica di nuovo il consenso al promemoria. Gli esiti **Completato**
e **Assente** vengono registrati esplicitamente, mai dedotti dal solo passare del tempo.

**Accesso e backup** consente di modificare email e password; gli altri accessi vengono
revocati. Il CSV esporta gli appuntamenti nell’intervallo scelto, fino a un anno per file. Il backup completo scarica uno snapshot
SQLite coerente dopo verifica della password, senza pubblicare file accessibili sul sito.
Contiene dati clienti, hash password, sessioni e configurazione: va conservato privatamente.
Il ripristino resta un’operazione tecnica e non carica o sostituisce dati dal browser.

## Runtime, backup e manutenzione

- Node 24 con SQLite integrato, database in `DATA_DIR`; in produzione `/data` deve
  essere un **volume persistente**. Il server rifiuta una produzione senza DATA_DIR.
- Una replica Railway; non collegare più writer allo stesso file su storage di rete.
- `APP_ORIGIN` è l’origine HTTPS completa, senza path; deve corrispondere al dominio
  usato nel browser. Dopo un cambio dominio aggiornare anche SITE_URL e ricostruire.
- Non abilitare Railway Serverless/sleep: i timer non girano mentre il servizio dorme.
- Backup SQLite privati quotidiani in `/data/backups/`, ultime 7 copie, snapshot
  autonomi e pubblicazione atomica. Copie nello stesso volume proteggono da errori
  applicativi, non dalla perdita del volume: configurare anche backup Railway o
  scaricare periodicamente una copia privata. Il CSV è un’esportazione leggibile,
  non un backup di account, impostazioni e coda.
- Per ripristinare, fermare il servizio, conservare il file attuale e sostituire
  `/data/agenda.sqlite` con lo snapshot scelto; rimuovere solo i sidecar WAL/SHM
  riferiti al database fermo. Riavviare e verificare prima l’agenda e i promemoria.
  Non forzare a pending lavori già inviati o dall’esito incerto.
- In caso di perdita della password non cancellare il database: il token iniziale
  non ricrea un secondo proprietario. Recuperare l’accesso con manutenzione privata,
  derivando una nuova password con lo stesso modulo auth e revocando tutte le sessioni.
  Non implementare un endpoint pubblico di reset privo di verifica.

## Verifiche

`npm test` usa database temporanei e provider Meta simulato: concorrenza su slot,
timezone/DST, accesso e CSRF, revoca sessioni, webhook, quote, cancellazioni,
timeout e duplicati. Nessun test invia messaggi a clienti. `npm audit --omit=dev`
controlla le dipendenze presenti nel runtime dopo il prune; il tooling Astro è
usato solo per compilare. La build Pages resta supportata con fallback WhatsApp.
