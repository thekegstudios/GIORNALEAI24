'use client';
import { useRef, useState } from 'react';
import { Fuel, LocateFixed, MapPin, Search, Map as MapIcon } from 'lucide-react';
import type { FuelResult,FuelStatus } from '@/lib/fuel';
import { fullDate } from '@/lib/format';
import { FuelMap } from './fuel-map';
import './public-services.css';

export function FuelBrowser({fuels,status:initialStatus}:{fuels:string[];status:FuelStatus}) {
  const [municipality,setMunicipality]=useState(''),[province,setProvince]=useState(''),[fuel,setFuel]=useState('Benzina'),[service,setService]=useState('self'),[network,setNetwork]=useState(''),[radius,setRadius]=useState(10);
  const [location,setLocation]=useState<{latitude:number;longitude:number}|null>(null),[items,setItems]=useState<FuelResult[]>([]),[status,setStatus]=useState(initialStatus),[pending,setPending]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false),[showMap,setShowMap]=useState(false);
  const controller=useRef<AbortController|null>(null);
  async function search(coordinates=location){
    if(!municipality.trim()&&!province.trim()&&!coordinates){setError('Inserisci un Comune, una provincia o usa la tua posizione.');return;}
    controller.current?.abort();const abort=new AbortController();controller.current=abort;setPending(true);setError('');
    const params=new URLSearchParams();if(fuel)params.set('fuel',fuel);if(service)params.set('service',service);if(network)params.set('network',network);
    if(coordinates){params.set('latitude',String(coordinates.latitude));params.set('longitude',String(coordinates.longitude));params.set('radiusKm',String(radius));}else{if(municipality.trim())params.set('municipality',municipality.trim());if(province.trim())params.set('province',province.trim());}
    try{const response=await fetch(`/api/carburanti?${params}`,{signal:abort.signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ricerca non disponibile.');setItems(data.items);setStatus(data.status);setSearched(true);}catch(caught){if(!abort.signal.aborted)setError(caught instanceof Error?caught.message:'Connessione non disponibile.');}finally{if(!abort.signal.aborted)setPending(false);}
  }
  function locate(){
    if(!navigator.geolocation){setError('La geolocalizzazione non è disponibile su questo browser.');return;}
    setPending(true);setError('');navigator.geolocation.getCurrentPosition(position=>{const coordinates={latitude:position.coords.latitude,longitude:position.coords.longitude};setLocation(coordinates);void search(coordinates);},()=>{setPending(false);setError('Posizione non disponibile. Puoi cercare per Comune o provincia.');},{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
  }
  return <section className="fuel-search" aria-label="Ricerca prezzi carburanti">
    <form onSubmit={event=>{event.preventDefault();void search();}} className="service-filters">
      <label>Comune<input value={municipality} maxLength={150} placeholder="Es. Milano" onChange={event=>{setMunicipality(event.target.value);setLocation(null);}} /></label>
      <label>Provincia (sigla)<input value={province} maxLength={2} placeholder="Es. MI" onChange={event=>{setProvince(event.target.value);setLocation(null);}} /></label>
      <label>Carburante<select value={fuel} onChange={event=>setFuel(event.target.value)}>{(fuels.length?fuels:['Benzina','Gasolio','GPL','Metano']).map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Erogazione<select value={service} onChange={event=>setService(event.target.value)}><option value="self">Self</option><option value="servito">Servito</option><option value="">Tutte</option></select></label>
      <label>Rete<select value={network} onChange={event=>setNetwork(event.target.value)}><option value="">Tutte</option><option value="stradale">Stradale</option><option value="autostradale">Autostradale</option></select></label>
      <label>Distanza<select value={radius} onChange={event=>setRadius(Number(event.target.value))}>{[3,5,10,25,50,100].map(value=><option key={value} value={value}>{value} km</option>)}</select></label>
      <button className="button" disabled={pending}><Search size={17}/>{pending?'Ricerca…':'Confronta i prezzi'}</button>
      <button type="button" className="button button-outline" onClick={locate} disabled={pending}><LocateFixed size={17}/>Vicino a me</button>
    </form>
    <p className="small-muted">La posizione viene richiesta solo premendo “Vicino a me”, usata per questa ricerca e non salvata. Il CAP non è un campo strutturato del dataset.</p>
    {location&&<p className="small-muted">Ricerca entro {radius} km dalla posizione autorizzata. <button className="text-link" onClick={()=>setLocation(null)}>Rimuovi posizione</button></p>}
    {error&&<p role="alert" className="error-message">{error}</p>}
    {status.lastError&&<div className="notice-panel"><p>L’ultimo aggiornamento non è riuscito. Mostriamo il dataset salvato: {status.datasetDate||'nessuno disponibile'}.</p></div>}
    <div aria-live="polite" className="service-results-title"><h2>{searched?`${items.length} prezzi disponibili`:'Trova un distributore nella tua zona'}</h2>{items.some(item=>item.station.latitude!==null)&&<button className="button button-outline" onClick={()=>setShowMap(!showMap)}><MapIcon size={16}/>{showMap?'Chiudi mappa':'Mostra mappa'}</button>}</div>
    {!searched&&<div className="service-empty"><Fuel size={26}/><p>Scegli una zona per confrontare i prezzi comunicati dai gestori. I risultati sono ordinati per prezzo crescente, con data di comunicazione visibile.</p></div>}
    {searched&&!items.length&&<div className="service-empty"><MapPin size={26}/><p>Nessun prezzo corrisponde ai filtri nel dataset disponibile. Prova un altro carburante o una zona più ampia.</p></div>}
    {showMap&&items.length>0&&<FuelMap key={items.map(item=>`${item.stationId}:${item.fuel}:${item.service}:${item.reportedAt}`).join('|')} items={items}/>}
    {items.length>0&&<div className="service-table-scroll"><table className="service-table"><caption>Primi {items.length} prezzi corrispondenti ai filtri, in ordine crescente. Fonte MIMIT, estrazione {status.datasetDate}.</caption><thead><tr><th>Distributore</th><th>Prezzo</th><th>Modalità</th><th>Comunicazione</th></tr></thead><tbody>{items.map(item=><tr key={`${item.stationId}:${item.fuel}:${item.service}`}><td><strong>{item.station.name}</strong><span>{item.station.brand} · {item.station.address}</span><span>{item.station.municipality} ({item.station.province}) · {item.station.network}{item.distanceKm!==null?` · ${item.distanceKm.toFixed(1)} km in linea d’aria`:''}</span>{item.station.latitude!==null&&item.station.longitude!==null&&<a target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${item.station.latitude}&mlon=${item.station.longitude}#map=16/${item.station.latitude}/${item.station.longitude}`}>Apri posizione ↗</a>}</td><td className="fuel-price">{item.price.toLocaleString('it-IT',{minimumFractionDigits:3,maximumFractionDigits:3})}<small>{item.unit} · {item.fuel}</small></td><td>{item.service}</td><td><time dateTime={item.reportedAt}>{fullDate(item.reportedAt)}</time>{item.stale&&<span className="data-stale">Dato oltre 7 giorni</span>}</td></tr>)}</tbody></table></div>}
  </section>;
}
