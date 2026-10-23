import { randomUUID } from 'node:crypto';
import { query, execute, transaction } from './db';
import { logAction } from './audit';
import { romeDate } from './budget';
export interface EconomicObservation {id:string;seriesId:string;name:string;value:number;unit:string;period:string;frequency:'monthly';sourceName:string;sourceUrl:string;apiUrl:string;sourceUpdatedAt:string;importedAt:string;flag:string|null;method:string}
export const ECONOMIC_SOURCES=[
  {id:'inflazione-ipca',name:'Inflazione IPCA italiana',code:'TOTAL',method:'Variazione rispetto allo stesso mese dell’anno precedente. Indice armonizzato IPCA; non è l’indice nazionale NIC.'},
  {id:'alimentari-ipca',name:'Alimentari e bevande analcoliche',code:'CP01',method:'Variazione annua dell’indice armonizzato italiano per alimentari e bevande analcoliche.'},
  {id:'energia-domestica-ipca',name:'Elettricità, gas e altri combustibili',code:'CP045',method:'Variazione annua dell’indice armonizzato italiano per elettricità, gas e altri combustibili; non è una tariffa o una bolletta individuale.'},
];
type Series=typeof ECONOMIC_SOURCES[number];
export function economicApiUrl(series:Series){return `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?lang=EN&geo=IT&coicop18=${series.code}&unit=RCH_A&freq=M&lastTimePeriod=36`;}
export function parseEconomicResponse(body:unknown,series:Series,now=new Date()):EconomicObservation[]{
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Formato JSON-stat non valido');
  const data=body as {id?:string[];size?:number[];updated?:string;dimension?:Record<string,{category?:{index?:Record<string,number>;label?:Record<string,string>}}> ;value?:Record<string,unknown>;status?:Record<string,string>};
  const required=['freq','unit','coicop18','geo','time'];
  if(!Array.isArray(data.id)||!Array.isArray(data.size)||data.id.length!==required.length||data.id.length!==data.size.length||new Set(data.id).size!==data.id.length||data.id.some(id=>!required.includes(id))||data.size.some(size=>!Number.isSafeInteger(size)||size<1)||!data.dimension||typeof data.dimension!=='object'||!data.value||typeof data.value!=='object'||typeof data.updated!=='string')throw new Error('Formato JSON-stat non valido');
  for(const [position,dimension] of data.id.entries()){
    const indices=data.dimension[dimension]?.category?.index,size=data.size[position];
    if(!indices||typeof indices!=='object'||Array.isArray(indices)||Object.keys(indices).length!==size||new Set(Object.values(indices)).size!==size||Object.values(indices).some(index=>!Number.isSafeInteger(index)||index<0||index>=size))throw new Error('Indici JSON-stat non validi');
  }
  const cells=data.size.reduce((total,size)=>total*size,1);
  if(!Number.isSafeInteger(cells)||Object.keys(data.value).some(index=>!/^\d+$/.test(index)||String(Number(index))!==index||Number(index)>=cells))throw new Error('Cardinalità JSON-stat non valida');
  if(data.status&&(typeof data.status!=='object'||Object.entries(data.status).some(([index,flag])=>!/^\d+$/.test(index)||String(Number(index))!==index||Number(index)>=cells||flag!==null&&typeof flag!=='string')))throw new Error('Contrassegni JSON-stat non validi');
  if(data.dimension.geo?.category?.index?.IT!==0||Object.keys(data.dimension.geo.category.index).length!==1||data.dimension.unit?.category?.index?.RCH_A!==0||data.dimension.coicop18?.category?.index?.[series.code]!==0||data.dimension.freq?.category?.index?.M!==0)throw new Error('Il dataset non corrisponde a Italia, indicatore e unità richiesti');
  if(data.id.some((dimension,index)=>dimension!=='time'&&data.size![index]!==1))throw new Error('Il dataset contiene dimensioni non filtrate');
  const updated=new Date(data.updated);if(!Number.isFinite(updated.getTime())||updated.getTime()>now.getTime()+5*60_000)throw new Error('Data di aggiornamento della fonte non valida');
  const times=data.dimension.time?.category?.index;if(!times)throw new Error('Periodi statistici assenti');
  const sourceUpdatedAt=updated.toISOString(),currentMonth=romeDate(now).slice(0,7),observations:EconomicObservation[]=[];
  for(const [period,index] of Object.entries(times)){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period>currentMonth)throw new Error('Periodo statistico non valido');
    const value=data.value[String(index)];if(value===null||value===undefined)continue;
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000)throw new Error('Valore statistico non valido');
    observations.push({id:`${series.id}:${period}`,seriesId:series.id,name:series.name,value,unit:'% annuo',period,frequency:'monthly',sourceName:'Eurostat',sourceUrl:'https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en',apiUrl:economicApiUrl(series),sourceUpdatedAt,importedAt:now.toISOString(),flag:data.status?.[String(index)]||null,method:series.method});
  }
  if(!observations.length)throw new Error('Nessuna osservazione disponibile');return observations;
}
export async function storeEconomicObservations(observations:EconomicObservation[]){return transaction(async()=>{
  for(const observation of observations){
    const old=(await query('SELECT payload FROM economic_indicators WHERE id=?',[observation.id]))[0];
    if(old){const previous=JSON.parse(String(old.payload)) as EconomicObservation;if(previous.value!==observation.value||previous.flag!==observation.flag)await execute('INSERT INTO economic_indicator_versions (id,observation_id,payload,changed_at) VALUES (?,?,?,?)',[randomUUID(),observation.id,String(old.payload),new Date().toISOString()]);}
    await execute('INSERT INTO economic_indicators (id,series_id,period,published_at,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at',[observation.id,observation.seriesId,observation.period,observation.sourceUpdatedAt,JSON.stringify(observation)]);
  }
});}
export async function getEconomicSeries(id?:string):Promise<EconomicObservation[]>{return (await query(`SELECT payload FROM economic_indicators ${id?'WHERE series_id=?':''} ORDER BY period ASC`,id?[id]:[])).map(row=>JSON.parse(String(row.payload)));}
export async function getEconomicLatest(){const rows=await getEconomicSeries();return ECONOMIC_SOURCES.flatMap(series=>{const values=rows.filter(row=>row.seriesId===series.id),last=values.at(-1),previous=values.at(-2);return last?[{...last,previousValue:previous?.value??null,change:previous?last.value-previous.value:null}]:[];});}
export async function getEconomyStatus(){const row=(await query('SELECT payload FROM public_data_runtime WHERE id=?',['economy']))[0];return row?JSON.parse(String(row.payload)) as {lastCheckedAt:string;lastSuccessAt:string|null;lastError:string|null;nextAttemptAt:string}:null;}
export async function runEconomicImport({force=false}:{force?:boolean}={}){
  if(process.env.ECONOMIC_DATA_ENABLED==='false')return {status:'disabled'};
  const previous=await getEconomyStatus(),now=new Date(),owner=randomUUID();if(!force&&previous?.nextAttemptAt&&previous.nextAttemptAt>now.toISOString())return {status:'skipped'};
  const lock=await query('INSERT INTO pipeline_locks (id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE pipeline_locks.expires_at<=? RETURNING owner',['economic-import',owner,new Date(now.getTime()+5*60_000).toISOString(),now.toISOString()]);if(lock[0]?.owner!==owner)return {status:'locked'};
  const errors:string[]= [];let observations=0;
  try{
    for(const series of ECONOMIC_SOURCES){try{const response=await fetch(economicApiUrl(series),{redirect:'error',signal:AbortSignal.timeout(25_000),headers:{'User-Agent':'GiornaleAI24/0.1 (Italy-only statistical dashboard)'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);const text=await response.text();if(text.length>2_000_000)throw new Error('Risposta troppo grande');const values=parseEconomicResponse(JSON.parse(text),series,now);await storeEconomicObservations(values);observations+=values.length;}catch(error){errors.push(`${series.name}: ${error instanceof Error?error.message:'Fonte non disponibile'}`);}}
    const state={lastCheckedAt:now.toISOString(),lastSuccessAt:observations?new Date().toISOString():previous?.lastSuccessAt||null,lastError:errors.length?errors.join(' · '):null,nextAttemptAt:new Date(Date.now()+(errors.length?3600_000:24*3600_000)).toISOString()};
    await execute('INSERT INTO public_data_runtime (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',['economy',JSON.stringify(state),new Date().toISOString()]);
    await logAction('analyst','economic-data-imported',null,{observations,errors,geo:'IT',dataset:'prc_hicp_minr',unit:'RCH_A',source:'Eurostat'});return {status:errors.length?'partial':'completed',observations,errors};
  }finally{await execute('DELETE FROM pipeline_locks WHERE id=? AND owner=?',['economic-import',owner]);}
}
