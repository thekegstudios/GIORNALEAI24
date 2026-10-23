import { createHash, randomUUID } from 'node:crypto';
import { query, execute, transaction } from './db';
import { romeDate } from './budget';
import { logAction } from './audit';

export const FUEL_SOURCE = 'https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti';
const STATIONS_URL = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
const PRICES_URL = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
export interface FuelStation { id:string; name:string; brand:string; address:string; municipality:string; province:string; latitude:number|null; longitude:number|null; network:string }
export interface FuelPrice { stationId:string; fuel:string; service:'self'|'servito'; price:number; unit:'€/l'|'€/kg'; reportedAt:string; datasetDate:string }
export interface FuelResult extends FuelPrice {station:FuelStation; distanceKm:number|null; stale:boolean}
export interface FuelStatus { lastCheckedAt:string|null; lastSuccessAt:string|null; lastError:string|null; datasetDate:string|null; failures:number; nextAttemptAt:string|null }
export interface FuelSummary {fuel:string; service:string; network:string; average:number; samples:number; day:string; previousAverage:number|null; change:number|null; unit:string}
const emptyStatus:FuelStatus={lastCheckedAt:null,lastSuccessAt:null,lastError:null,datasetDate:null,failures:0,nextAttemptAt:null};
const romeTimestampFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export const normalizePlace=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();

/** MIMIT's pipe format treats quotation marks inside names as literal data. */
export function parseDelimited(text:string):{date:string;rows:Record<string,string>[];invalidRows:number} {
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  const extracted=lines[0]?.match(/Estrazione del\s+(\d{4}-\d{2}-\d{2})/i);
  if(!extracted||!/^\d{4}-\d{2}-\d{2}$/.test(extracted[1])||new Date(`${extracted[1]}T12:00:00Z`).toISOString().slice(0,10)!==extracted[1])throw new Error('Data di estrazione MIMIT non valida');
  const separator=lines[1]?.includes('|')?'|':';';
  function split(line:string){const fields:string[]=[];let current='',quoted=false;for(let index=0;index<line.length;index++){const char=line[index];if(char==='"'){if(quoted&&line[index+1]==='"'){current+='"';index++;}else quoted=!quoted;}else if(char===separator&&!quoted){fields.push(current.trim());current='';}else current+=char;}if(quoted)throw new Error('Campo CSV non chiuso');fields.push(current.trim());return fields;}
  const headers=split(lines[1]||'');
  if(!headers.includes('idImpianto'))throw new Error('Intestazione MIMIT non riconosciuta');
  const rows:Record<string,string>[]= [];let invalidRows=0;
  for(const line of lines.slice(2)){const fields=separator==='|'?line.split('|').map(field=>field.trim()):split(line);if(fields.length!==headers.length){invalidRows++;continue;}rows.push(Object.fromEntries(headers.map((header,index)=>[header,fields[index]])));}
  if(invalidRows>(lines.length-2)*.01)throw new Error('Troppe righe MIMIT con colonne incoerenti');
  return {date:extracted[1],rows,invalidRows};
}
export function parseRomeTimestamp(value:string):string|null {
  const match=value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);if(!match)return null;
  const [,day,month,year,hour,minute,second]=match,date=`${year}-${month}-${day}`;
  if(Number(hour)>23||Number(minute)>59||Number(second)>59)return null;
  const noon=new Date(`${date}T12:00:00Z`);if(!Number.isFinite(noon.getTime())||noon.toISOString().slice(0,10)!==date)return null;
  // Validate the local wall clock against both contemporary Rome offsets.
  // A missing spring hour or an ambiguous autumn hour has no unique instant.
  const expected:Record<string,string>={year,month,day,hour,minute,second};
  const candidates=['+01:00','+02:00'].map(offset=>new Date(`${date}T${hour}:${minute}:${second}${offset}`)).filter(time=>Number.isFinite(time.getTime())&&romeTimestampFormatter.formatToParts(time).filter(part=>part.type in expected).every(part=>part.value===expected[part.type]));
  return candidates.length===1?candidates[0].toISOString():null;
}
export function normalizeFuelFiles(stationText:string,priceText:string,now=Date.now()) {
  const stationsFile=parseDelimited(stationText),pricesFile=parseDelimited(priceText);
  if(stationsFile.date!==pricesFile.date)throw new Error('I due file MIMIT si riferiscono a estrazioni diverse; conservato il dataset precedente');
  if(pricesFile.date>romeDate(new Date(now)))throw new Error('Estrazione MIMIT nel futuro');
  const stations:FuelStation[]=stationsFile.rows.map(row=>{
    const lat=Number(row.Latitudine?.replace(',','.')),lon=Number(row.Longitudine?.replace(',','.'));
    const coordinates=Boolean(row.Latitudine&&row.Longitudine)&&Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=35&&lat<=48&&lon>=6&&lon<=19;
    if(!/^\d+$/.test(row.idImpianto)||!row.Comune?.trim()||!row.Provincia?.trim())throw new Error('Anagrafica MIMIT priva di identificativo o territorio');
    return {id:row.idImpianto,name:(row['Nome Impianto']||`Impianto ${row.idImpianto}`).slice(0,300),brand:(row.Bandiera||'').slice(0,150),address:(row.Indirizzo||'').slice(0,500),municipality:row.Comune.slice(0,150),province:row.Provincia.slice(0,100),latitude:coordinates?lat:null,longitude:coordinates?lon:null,network:/autostrad/i.test(row['Tipo Impianto']||'')?'autostradale':'stradale'};
  });
  const ids=new Set(stations.map(station=>station.id)),prices=new Map<string,FuelPrice>();let rejected=pricesFile.invalidRows+stationsFile.invalidRows;
  for(const row of pricesFile.rows){
    const price=Number(row.prezzo?.replace(',','.')),reportedAt=parseRomeTimestamp(row.dtComu||'');
    if(!ids.has(row.idImpianto)||!row.descCarburante?.trim()||!['0','1'].includes(row.isSelf)||!Number.isFinite(price)||price<=0||price>20||!reportedAt||new Date(reportedAt).getTime()>now+5*60_000){rejected++;continue;}
    const entry:FuelPrice={stationId:row.idImpianto,fuel:row.descCarburante.trim().slice(0,100),service:row.isSelf==='1'?'self':'servito',price,unit:/metano|cng|lng|gnl/i.test(row.descCarburante)?'€/kg':'€/l',reportedAt,datasetDate:pricesFile.date};
    const key=`${entry.stationId}:${entry.fuel}:${entry.service}`,previous=prices.get(key);if(!previous||entry.reportedAt>previous.reportedAt)prices.set(key,entry);
  }
  if(!stations.length||!prices.size||rejected>(pricesFile.rows.length+pricesFile.invalidRows)*.01)throw new Error('Dataset MIMIT vuoto o con troppe righe non valide');
  return {date:pricesFile.date,stations,prices:[...prices.values()],rejected};
}
export async function getFuelStatus():Promise<FuelStatus>{const row=(await query('SELECT payload FROM public_data_runtime WHERE id=?',['fuel']))[0];return {...emptyStatus,...(row?JSON.parse(String(row.payload)): {})};}
async function saveStatus(status:FuelStatus){await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',['fuel',JSON.stringify(status),new Date().toISOString()]);}
async function download(url:string){const response=await fetch(url,{signal:AbortSignal.timeout(45_000),redirect:'error',headers:{'User-Agent':'GiornaleAI24/0.1 (MIMIT open data; daily shared import)'}});if(!response.ok)throw new Error(`MIMIT HTTP ${response.status}`);const reader=response.body?.getReader();if(!reader)throw new Error('Dataset MIMIT vuoto');const chunks:Uint8Array[]=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>25_000_000){await reader.cancel();throw new Error('Dataset MIMIT oltre il limite consentito');}chunks.push(value);}}finally{reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');}
async function insertBatch(table:string,columns:string[],rows:unknown[][]){for(let offset=0;offset<rows.length;offset+=150){const batch=rows.slice(offset,offset+150);await execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')}`,batch.flat());}}
export async function importFuelSnapshot(stationText:string,priceText:string,now=new Date()) {
  const normalized=normalizeFuelFiles(stationText,priceText,now.getTime()),hash=createHash('sha256').update(stationText).update(priceText).digest('hex');
  return transaction(async()=>{
    const latest=(await query('SELECT dataset_date,input_hash FROM fuel_imports ORDER BY dataset_date DESC,imported_at DESC LIMIT 1'))[0];if(latest&&String(latest.dataset_date)>normalized.date)throw new Error('Estrazione più vecchia del dataset già disponibile');
    if((await query('SELECT id FROM fuel_imports WHERE input_hash=?',[hash])).length){
      const installed=(await query('SELECT payload FROM public_data_runtime WHERE id=?',['fuel-snapshot']))[0];
      const currentHash=installed?JSON.parse(String(installed.payload)).hash:latest?.input_hash;
      if(currentHash!==hash)throw new Error('Revisione MIMIT già sostituita da un dataset successivo');
      return {changed:false,...normalized,hash};
    }
    await execute('DELETE FROM fuel_prices');await execute('DELETE FROM fuel_stations');
    await insertBatch('fuel_stations',['id','municipality','province','latitude','longitude','network','payload'],normalized.stations.map(station=>[station.id,normalizePlace(station.municipality),normalizePlace(station.province),station.latitude,station.longitude,station.network,JSON.stringify(station)]));
    await insertBatch('fuel_prices',['station_id','fuel','service','price','unit','reported_at','dataset_date'],normalized.prices.map(price=>[price.stationId,price.fuel,price.service,price.price,price.unit,price.reportedAt,price.datasetDate]));
    await execute('DELETE FROM fuel_history WHERE day=?',[normalized.date]);
    const aggregates=await query('SELECT p.fuel,p.service,s.network,AVG(p.price) AS average,COUNT(*) AS samples FROM fuel_prices p JOIN fuel_stations s ON s.id=p.station_id WHERE p.reported_at>=? GROUP BY p.fuel,p.service,s.network',[new Date(now.getTime()-7*86400_000).toISOString()]);
    for(const row of aggregates)await execute('INSERT INTO fuel_history (day,fuel,service,network,average,samples,source_url) VALUES (?,?,?,?,?,?,?) ON CONFLICT(day,fuel,service,network) DO UPDATE SET average=excluded.average,samples=excluded.samples',[normalized.date,row.fuel,row.service,row.network,row.average,row.samples,FUEL_SOURCE]);
    await execute('INSERT INTO fuel_imports (id,dataset_date,imported_at,station_count,price_count,input_hash,source_url) VALUES (?,?,?,?,?,?,?)',[randomUUID(),normalized.date,now.toISOString(),normalized.stations.length,normalized.prices.length,hash,FUEL_SOURCE]);
    await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',['fuel-snapshot',JSON.stringify({hash,datasetDate:normalized.date}),now.toISOString()]);
    await logAction('researcher','fuel-snapshot-imported',normalized.date,{stations:normalized.stations.length,prices:normalized.prices.length,rejected:normalized.rejected,license:'IODL 2.0',noArticleAutoPublished:true});
    return {changed:true,...normalized,hash};
  });
}
export async function runFuelImport({force=false}:{force?:boolean}={}) {
  if(process.env.FUEL_DATA_ENABLED==='false')return {status:'disabled'};
  const previous=await getFuelStatus(),now=new Date();
  if(!force&&previous.nextAttemptAt&&previous.nextAttemptAt>now.toISOString())return {status:'skipped'};
  const owner=randomUUID(),expires=new Date(now.getTime()+5*60_000).toISOString();
  const lock=await query('INSERT INTO pipeline_locks (id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE pipeline_locks.expires_at<=? RETURNING owner',['fuel-import',owner,expires,now.toISOString()]);if(lock[0]?.owner!==owner)return {status:'locked'};
  try{
    const [stations,prices]=await Promise.all([download(STATIONS_URL),download(PRICES_URL)]),result=await importFuelSnapshot(stations,prices,now);
    await saveStatus({lastCheckedAt:now.toISOString(),lastSuccessAt:new Date().toISOString(),lastError:null,datasetDate:result.date,failures:0,nextAttemptAt:new Date(Date.now()+12*3600_000).toISOString()});
    return {status:'completed',changed:result.changed,datasetDate:result.date,stations:result.stations.length,prices:result.prices.length,rejected:result.rejected};
  }catch(error){const message=error instanceof Error?error.message:'Importazione MIMIT non riuscita',failures=previous.failures+1;await saveStatus({...previous,lastCheckedAt:now.toISOString(),lastError:message,failures,nextAttemptAt:new Date(Date.now()+Math.min(6*3600_000,15*60_000*2**Math.min(failures-1,5))).toISOString()});await logAction('supervisor','fuel-import-failed',null,{error:message,failures,previousDatasetKept:true});return {status:'failed',error:message};}
  finally{await execute('DELETE FROM pipeline_locks WHERE id=? AND owner=?',['fuel-import',owner]);}
}
export function distanceKm(lat1:number,lon1:number,lat2:number,lon2:number){const rad=(n:number)=>n*Math.PI/180,a=Math.sin(rad(lat2-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}
export async function searchFuel(filters:{municipality?:string;province?:string;fuel?:string;service?:string;network?:string;latitude?:number;longitude?:number;radiusKm?:number;limit?:number}={}) {
  const conditions:string[]=[],params:unknown[]=[];
  if(filters.municipality){conditions.push('s.municipality=?');params.push(normalizePlace(filters.municipality));}
  if(filters.province){conditions.push('s.province=?');params.push(normalizePlace(filters.province));}
  if(filters.fuel){conditions.push('p.fuel=?');params.push(filters.fuel);}
  if(filters.service){conditions.push('p.service=?');params.push(filters.service);}
  if(filters.network){conditions.push('s.network=?');params.push(filters.network);}
  const geo=Number.isFinite(filters.latitude)&&Number.isFinite(filters.longitude),radius=Math.min(100,Math.max(1,filters.radiusKm||10));
  if(geo){conditions.push('s.latitude BETWEEN ? AND ? AND s.longitude BETWEEN ? AND ?');params.push(filters.latitude!-radius/111,filters.latitude!+radius/111,filters.longitude!-radius/(111*Math.cos(filters.latitude!*Math.PI/180)),filters.longitude!+radius/(111*Math.cos(filters.latitude!*Math.PI/180)));}
  const rows=await query(`SELECT p.*,s.payload FROM fuel_prices p JOIN fuel_stations s ON s.id=p.station_id ${conditions.length?`WHERE ${conditions.join(' AND ')}`:''} ORDER BY p.price ASC,p.reported_at DESC LIMIT ?`,[...params,geo?10000:Math.min(200,filters.limit||100)]);
  const results=rows.map(row=>{const station=JSON.parse(String(row.payload)) as FuelStation,km=geo&&station.latitude!==null&&station.longitude!==null?distanceKm(filters.latitude!,filters.longitude!,station.latitude,station.longitude):null;return {stationId:String(row.station_id),fuel:String(row.fuel),service:row.service as FuelPrice['service'],price:Number(row.price),unit:row.unit as FuelPrice['unit'],reportedAt:String(row.reported_at),datasetDate:String(row.dataset_date),station,distanceKm:km,stale:Date.now()-new Date(String(row.reported_at)).getTime()>7*86400_000} satisfies FuelResult;}).filter(result=>!geo||result.distanceKm!==null&&result.distanceKm<=radius).slice(0,Math.min(200,filters.limit||100));
  return results;
}
export async function getFuelOptions(){const [places,fuels]=await Promise.all([query('SELECT DISTINCT municipality,province FROM fuel_stations ORDER BY municipality'),query('SELECT DISTINCT fuel FROM fuel_prices ORDER BY fuel')]);return {places:places.map(row=>({municipality:String(row.municipality),province:String(row.province)})),fuels:fuels.map(row=>String(row.fuel))};}
export async function getFuelSummary():Promise<FuelSummary[]>{
  const latest=(await query('SELECT MAX(day) AS day FROM fuel_history'))[0]?.day;if(!latest)return [];
  const rows=await query('SELECT * FROM fuel_history WHERE day=? ORDER BY fuel,service,network',[latest]);
  return Promise.all(rows.map(async row=>{const previous=(await query('SELECT average FROM fuel_history WHERE fuel=? AND service=? AND network=? AND day<? ORDER BY day DESC LIMIT 1',[row.fuel,row.service,row.network,row.day]))[0];return {fuel:String(row.fuel),service:String(row.service),network:String(row.network),average:Number(row.average),samples:Number(row.samples),day:String(row.day),previousAverage:previous?Number(previous.average):null,change:previous?Number(row.average)-Number(previous.average):null,unit:/metano|cng|lng|gnl/i.test(String(row.fuel))?'€/kg':'€/l'};}));
}
export async function getFuelHistory(fuel='Benzina'){return (await query('SELECT * FROM fuel_history WHERE fuel=? AND service=? AND network=? ORDER BY day DESC LIMIT 366',[fuel,'self','stradale'])).reverse().map(row=>({day:String(row.day),value:Number(row.average),samples:Number(row.samples)}));}
