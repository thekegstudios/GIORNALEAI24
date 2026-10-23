import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Fixtures stay in an isolated database. These tests never fetch official data.
process.env.DATABASE_PATH=':memory:';
delete process.env.DATABASE_URL;
process.env.OPENAI_API_KEY='';
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Network access is forbidden in public-service tests');};
const {execute,query,closeDatabase}=await import('../src/lib/db');
const {parseDelimited,parseRomeTimestamp,normalizeFuelFiles,importFuelSnapshot,searchFuel,getFuelSummary,getFuelHistory}=await import('../src/lib/fuel');
const {ECONOMIC_SOURCES,parseEconomicResponse,storeEconomicObservations,getEconomicLatest}=await import('../src/lib/economy');
const {householdTotals}=await import('../src/lib/household');
const {answerPublicServiceQuestion}=await import('../src/lib/public-service-chat');
after(async()=>{globalThis.fetch=originalFetch;await closeDatabase();});

const now=new Date('2026-10-23T10:00:00Z');
const stationHeader='idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine';
const priceHeader='idImpianto|descCarburante|prezzo|isSelf|dtComu';
const stationRows=[
  '1|TEST ISOLATO|Test|Stradale|TEST "ISOLATO" Palermo vicino|Via prova 1|Palermo|PA|38.11|13.36',
  '2|TEST ISOLATO|Test|Autostradale|TEST ISOLATO Palermo lontano|Via prova 2|Palermo|PA|37.90|13.00',
  '3|TEST ISOLATO|Test|Stradale|TEST ISOLATO Castro BG|Via prova 3|Castro|BG|45.80|10.06',
  '4|TEST ISOLATO|Test|Stradale|TEST ISOLATO Castro LE|Via prova 4|Castro|LE|40.00|18.42',
];
const priceRows=[
  '1|Benzina|1.850|1|21/10/2026 08:00:00',
  '1|Benzina|2.000|0|21/10/2026 08:00:00',
  '1|Metano|1.400|1|21/10/2026 08:00:00',
  '2|Benzina|1.700|1|21/10/2026 08:00:00',
  '3|Benzina|1.500|1|21/10/2026 08:00:00',
  '4|Benzina|1.600|1|21/10/2026 08:00:00',
];
const stations=(date='2026-10-21',rows=stationRows)=>`Estrazione del ${date}\n${stationHeader}\n${rows.join('\n')}\n`;
const prices=(date='2026-10-21',rows=priceRows)=>`Estrazione del ${date}\n${priceHeader}\n${rows.join('\n')}\n`;
async function resetFuel(){for(const table of ['fuel_prices','fuel_stations','fuel_imports','fuel_history'])await execute(`DELETE FROM ${table}`);await execute('DELETE FROM public_data_runtime WHERE id IN (?,?)',['fuel','fuel-snapshot']);}
const economicBody=()=>({id:['freq','unit','coicop18','geo','time'],size:[1,1,1,1,3],updated:'2026-10-21T10:00:00Z',dimension:{freq:{category:{index:{M:0}}},unit:{category:{index:{RCH_A:0}}},coicop18:{category:{index:{TOTAL:0}}},geo:{category:{index:{IT:0}}},time:{category:{index:{'2026-07':0,'2026-08':1,'2026-09':2}}}},value:{'0':1.2,'1':null,'2':0},status:{'2':'p'}});

test('MIMIT parser preserves literal quotes in pipe names and rejects one malformed row in a small file',()=>{
  const parsed=parseDelimited(`\uFEFF${stations()}`);assert.equal(parsed.rows[0]['Nome Impianto'],'TEST "ISOLATO" Palermo vicino');assert.equal(parsed.invalidRows,0);
  const semicolon=parseDelimited('Estrazione del 2026-10-21\nidImpianto;Nome Impianto\n1;"TEST; ISOLATO"');assert.equal(semicolon.rows[0]['Nome Impianto'],'TEST; ISOLATO');
  assert.throws(()=>parseDelimited(`${prices()}bad|row`),/Troppe righe/);
  // Exactly 1% may be discarded; even a small excess must fail the whole file.
  const repeated=Array.from({length:99},()=>priceRows[0]);assert.equal(parseDelimited(prices('2026-10-21',[...repeated,'bad|row'])).invalidRows,1);
  assert.throws(()=>parseDelimited(prices('2026-10-21',[...repeated.slice(1),'bad|row'])),/Troppe righe/);
  assert.throws(()=>parseDelimited(stations('2026-02-30')));
});
test('Rome wall clocks use their actual DST offset and reject missing or ambiguous hours and invalid dates',()=>{
  assert.equal(parseRomeTimestamp('29/03/2026 01:30:00'),'2026-03-29T00:30:00.000Z');
  assert.equal(parseRomeTimestamp('29/03/2026 03:30:00'),'2026-03-29T01:30:00.000Z');
  assert.equal(parseRomeTimestamp('29/03/2026 02:30:00'),null);
  assert.equal(parseRomeTimestamp('25/10/2026 01:30:00'),'2026-10-24T23:30:00.000Z');
  assert.equal(parseRomeTimestamp('25/10/2026 03:30:00'),'2026-10-25T02:30:00.000Z');
  assert.equal(parseRomeTimestamp('25/10/2026 02:30:00'),null);
  assert.equal(parseRomeTimestamp('31/02/2026 10:00:00'),null);assert.equal(parseRomeTimestamp('21/10/2026 24:00:00'),null);
});
test('fuel normalization rejects future/mismatched extractions and keeps the newest price for each service and unit',()=>{
  assert.throws(()=>normalizeFuelFiles(stations('2026-10-24'),prices('2026-10-24'),now.getTime()),/futuro/);
  assert.throws(()=>normalizeFuelFiles(stations('2026-10-21'),prices('2026-10-22'),now.getTime()),/estrazioni diverse/);
  const result=normalizeFuelFiles(stations(),prices('2026-10-21',[...priceRows,'1|Benzina|1.900|1|20/10/2026 08:00:00']),now.getTime());
  assert.equal(result.prices.length,6);assert.equal(result.prices.find(row=>row.stationId==='1'&&row.fuel==='Benzina'&&row.service==='self')?.price,1.85);
  assert.equal(result.prices.find(row=>row.fuel==='Metano')?.unit,'€/kg');assert.equal(result.prices.find(row=>row.service==='servito')?.unit,'€/l');
  assert.throws(()=>normalizeFuelFiles(stations(),prices('2026-10-21',[...priceRows,'1|Gasolio|1.500|1|23/10/2026 13:00:00']),now.getTime()),/troppe righe/);
});
test('bad input and database write failures preserve the complete last good fuel snapshot atomically',async()=>{
  await resetFuel();await importFuelSnapshot(stations(),prices(),now);
  const before=await query('SELECT station_id,fuel,service,price FROM fuel_prices ORDER BY station_id,fuel,service');
  await assert.rejects(importFuelSnapshot(stations(),prices('2026-10-21',[...priceRows,'1|Benzina|-1|1|21/10/2026 08:00:00']),now));
  // A duplicate station passes parsing but fails after DELETE inside the transaction.
  await assert.rejects(importFuelSnapshot(stations('2026-10-22',[...stationRows,stationRows[0]]),prices('2026-10-22'),now));
  assert.deepEqual(await query('SELECT station_id,fuel,service,price FROM fuel_prices ORDER BY station_id,fuel,service'),before);
  assert.equal(Number((await query('SELECT COUNT(*) AS n FROM fuel_imports'))[0].n),1);
});
test('fuel imports are idempotent and a known old extraction or replaced same-day revision cannot masquerade as current',async()=>{
  await resetFuel();assert.equal((await importFuelSnapshot(stations(),prices(),now)).changed,true);
  assert.equal((await importFuelSnapshot(stations(),prices(),now)).changed,false);
  const revised=priceRows.filter(row=>!row.includes('|Metano|')).map(row=>row.startsWith('1|Benzina|1.850|1')?row.replace('1.850','1.800'):row);
  await importFuelSnapshot(stations(),prices('2026-10-21',revised),now);
  await assert.rejects(importFuelSnapshot(stations(),prices(),now),/Revisione.*sostituita/);
  assert(!(await getFuelSummary()).some(row=>row.fuel==='Metano'));
  await importFuelSnapshot(stations('2026-10-22'),prices('2026-10-22',revised),now);
  await assert.rejects(importFuelSnapshot(stations(),prices(),now),/più vecchia/);
  assert.equal((await query('SELECT DISTINCT dataset_date FROM fuel_prices'))[0].dataset_date,'2026-10-22');
});
test('fuel retrieval separates self, served, units, motorway networks and distance filtering',async()=>{
  await resetFuel();await importFuelSnapshot(stations(),prices(),now);
  const self=await searchFuel({municipality:'pàlermo',fuel:'Benzina',service:'self'});assert.deepEqual(self.map(row=>row.price),[1.7,1.85]);
  const served=await searchFuel({municipality:'Palermo',fuel:'Benzina',service:'servito'});assert.equal(served.length,1);assert.equal(served[0].price,2);
  const near=await searchFuel({latitude:38.11,longitude:13.36,radiusKm:2,fuel:'Benzina',service:'self'});assert.equal(near.length,1);assert.equal(near[0].stationId,'1');assert.equal(near[0].distanceKm,0);
  assert.equal((await searchFuel({fuel:'Metano'}))[0].unit,'€/kg');assert.equal((await searchFuel({network:'autostradale'}))[0].stationId,'2');
  const summary=(await getFuelSummary()).find(row=>row.fuel==='Benzina'&&row.service==='self'&&row.network==='stradale')!;assert.equal(summary.samples,3);assert(Math.abs(summary.average-1.65)<1e-10);assert.equal(summary.previousAverage,null);
  assert.equal((await getFuelHistory()).length,1);
});
test('JSON-stat retains Italy-only periods and zero values while missing observations stay missing',()=>{
  const values=parseEconomicResponse(economicBody(),ECONOMIC_SOURCES[0],now);assert.deepEqual(values.map(row=>[row.period,row.value]),[['2026-07',1.2],['2026-09',0]]);assert.equal(values[1].flag,'p');assert.equal(values[1].unit,'% annuo');assert(values.every(row=>row.apiUrl.includes('geo=IT')));
  const wrongGeo=economicBody();wrongGeo.dimension.geo.category.index={FR:0} as unknown as {IT:number};assert.throws(()=>parseEconomicResponse(wrongGeo,ECONOMIC_SOURCES[0],now),/Italia/);
  const absent=structuredClone(economicBody());delete (absent.value as Record<string,number|null>)['0'];assert.equal(parseEconomicResponse(absent,ECONOMIC_SOURCES[0],now).length,1);
});
test('JSON-stat rejects malformed dimensions, flattened indices, cardinalities, flags and future periods',()=>{
  const mutations:Array<(body:ReturnType<typeof economicBody>)=>void>=[
    body=>{body.id[4]='geo';},body=>{body.id.pop();},body=>{body.size[4]=4;},body=>{body.dimension.time.category.index['2026-09']=1;},
    body=>{body.dimension.time.category.index['2026-09']=3;},body=>{body.dimension.time.category.index['2026-09']=1.5;},
    body=>{(body.value as Record<string,unknown>)['3']=2;},body=>{(body.value as Record<string,unknown>)['01']=2;},
    body=>{(body.value as Record<string,unknown>)['0']='1.2';},body=>{(body.status as Record<string,unknown>)['2']={untrusted:'flag'};},
    body=>{body.updated='2026-10-24T10:00:00Z';},body=>{delete (body.dimension.time.category.index as Record<string,number>)['2026-09'];(body.dimension.time.category.index as Record<string,number>)['2026-11']=2;},
  ];
  for(const mutate of mutations){const body=economicBody();mutate(body);assert.throws(()=>parseEconomicResponse(body,ECONOMIC_SOURCES[0],now));}
  assert.throws(()=>parseEconomicResponse(null,ECONOMIC_SOURCES[0],now));
});
test('economic revisions retain the previous official observation only when its value or flag changes',async()=>{
  await execute('DELETE FROM economic_indicators');await execute('DELETE FROM economic_indicator_versions');const values=parseEconomicResponse(economicBody(),ECONOMIC_SOURCES[0],now);
  await storeEconomicObservations(values);await storeEconomicObservations(values);assert.equal(Number((await query('SELECT COUNT(*) AS n FROM economic_indicator_versions'))[0].n),0);
  await storeEconomicObservations([{...values[1],value:0.3,flag:null}]);assert.equal(Number((await query('SELECT COUNT(*) AS n FROM economic_indicator_versions'))[0].n),1);
  const latest=(await getEconomicLatest())[0];assert.equal(latest.value,0.3);assert.equal(latest.previousValue,1.2);
});
test('household amounts round to cents before totals and reject invalid inputs without treating scenarios as predictions',()=>{
  const result=householdTotals([1.005,2.675,0.1,0.2],10);assert.equal(result.monthly,3.99);assert.equal(result.annual,47.88);assert.equal(result.scenarioMonthly,4.39);assert.equal(result.scenarioAnnual,52.68);assert.equal(result.difference,0.4);assert(Math.abs(result.shares.reduce((sum,share)=>sum+share,0)-100)<1e-10);
  assert.equal(householdTotals([100],-100).scenarioMonthly,0);assert.deepEqual(householdTotals([],0).shares,[]);
  for(const value of [NaN,Infinity,-1,1_000_001])assert.throws(()=>householdTotals([value],0));assert.throws(()=>householdTotals([1],101));
});
test('service chat retrieves factual local prices, distinguishes ambiguous/unknown places and never substitutes a model price',async()=>{
  await resetFuel();await importFuelSnapshot(stations(),prices(),now);
  const local=await answerPublicServiceQuestion('Quanto costa la benzina a Palermo?');assert(local);assert(local.answer.includes('1.700 €/l'));assert(local.answer.includes('2026-10-21'));assert(!local.answer.includes('null'));assert.equal(local.mode,'archive');assert.equal(local.citations[0].sourceName,'MIMIT · IODL 2.0');
  assert((await answerPublicServiceQuestion('Benzina Palermo servito'))?.answer.includes('2.000 €/l'));
  assert((await answerPublicServiceQuestion('Prezzo benzina a Castro'))?.answer.includes('più province'));
  const province=await answerPublicServiceQuestion('Prezzo benzina Castro (LE)');assert(province);assert(province.answer.includes('1.600 €/l'));assert(!province.answer.includes('1.500 €/l'));
  assert((await answerPublicServiceQuestion('Prezzo benzina Palermo (MI)'))?.answer.includes('Non ho trovato'));
  const unknown=await answerPublicServiceQuestion('Quanto costa benzina a ComuneSconosciuto?');assert(unknown);assert(unknown.answer.includes('Non ho riconosciuto'));assert(!unknown.answer.includes('media aritmetica'));
  const national=await answerPublicServiceQuestion('Quanto costa la benzina in Italia?');assert(national);assert(national.answer.includes('media aritmetica'));assert(national.uncertainties.length>0);
  assert((await answerPublicServiceQuestion('Quanto costa il GPL a Palermo?'))?.answer.includes('Non ho prezzi GPL'));
  assert.equal(await answerPublicServiceQuestion('Spiegami il documento istituzionale'),null);
});
test('service chat quotes an archived official economic period and explicitly reports unavailable indicators',async()=>{
  await execute('DELETE FROM economic_indicators');assert((await answerPublicServiceQuestion('Quale valore ha inflazione?'))?.answer.includes('Non ho ancora acquisito'));
  await storeEconomicObservations(parseEconomicResponse(economicBody(),ECONOMIC_SOURCES[0],now));
  const answer=await answerPublicServiceQuestion('Quanto vale inflazione italiana?');assert(answer);assert(answer.answer.includes('2026-09'));assert(answer.answer.includes('0 % annuo'));assert(answer.answer.includes('o una previsione'));assert.equal(answer.citations[0].sourceName,'Eurostat · Italia');assert(answer.uncertainties.some(value=>value.includes('Contrassegno')));
});
