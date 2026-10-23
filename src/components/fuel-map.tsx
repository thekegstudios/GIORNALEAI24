'use client';
import { useEffect,useRef,useState } from 'react';
import type { FuelResult } from '@/lib/fuel';
const project=(lat:number,lon:number,zoom:number)=>{const size=256*2**zoom,sin=Math.sin(lat*Math.PI/180);return {x:(lon+180)/360*size,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size};};
export function FuelMap({items}:{items:FuelResult[]}){
  const points=items.filter(item=>item.station.latitude!==null&&item.station.longitude!==null).slice(0,25),first=points[0];
  const [selected,setSelected]=useState(first),[zoom,setZoom]=useState(12),[width,setWidth]=useState(600),[center,setCenter]=useState({lat:first?.station.latitude||42,lon:first?.station.longitude||12});
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!container.current)return;const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(container.current);return()=>observer.disconnect();},[]);
  if(!first)return null;
  const origin=project(center.lat,center.lon,zoom),height=360,left=origin.x-width/2,top=origin.y-height/2,tiles=[];
  for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++)if(x>=0&&y>=0&&x<2**zoom&&y<2**zoom)tiles.push({x,y});
  return <div className="fuel-map-wrap"><div ref={container} className="fuel-map" role="region" aria-label="Mappa interattiva dei distributori selezionati">
    {tiles.map(tile=><img alt="" key={`${zoom}/${tile.x}/${tile.y}`} className="fuel-map-tile" width={256} height={256} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} style={{left:tile.x*256-left,top:tile.y*256-top}} referrerPolicy="strict-origin-when-cross-origin"/>)}
    {points.map(item=>{const point=project(item.station.latitude!,item.station.longitude!,zoom),x=point.x-left,y=point.y-top;if(x<0||y<0||x>width||y>height)return null;return <button key={`${item.stationId}-${item.fuel}-${item.service}`} className={`fuel-map-marker ${selected.stationId===item.stationId?'selected':''}`} style={{left:x,top:y}} onClick={()=>setSelected(item)} aria-label={`${item.station.name}, ${item.price} ${item.unit}`}>{item.price.toFixed(3)}</button>;})}
    <div className="fuel-map-controls"><button aria-label="Ingrandisci mappa" disabled={zoom>=17} onClick={()=>setZoom(zoom+1)}>+</button><button aria-label="Riduci mappa" disabled={zoom<=7} onClick={()=>setZoom(zoom-1)}>−</button></div>
    <a className="fuel-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
  </div><div className="fuel-map-selection"><strong>{selected.station.name}</strong><p>{selected.station.address} · {selected.station.municipality} — {selected.price.toFixed(3)} {selected.unit} ({selected.service})</p><label>Centra un distributore<select value={`${selected.stationId}:${selected.fuel}:${selected.service}`} onChange={event=>{const item=points.find(point=>`${point.stationId}:${point.fuel}:${point.service}`===event.target.value)!;setSelected(item);setCenter({lat:item.station.latitude!,lon:item.station.longitude!});}}>{points.map(item=><option key={`${item.stationId}:${item.fuel}:${item.service}`} value={`${item.stationId}:${item.fuel}:${item.service}`}>{item.station.name} · {item.price.toFixed(3)} {item.unit}</option>)}</select></label><small>Sulla mappa: fino a 25 prezzi con coordinate ufficiali. Cartografia esterna caricata su richiesta.</small></div></div>;
}
