import { z } from 'zod';
import { isItalianCountry } from './catalog';
import { sportsEventSchema,type Competition,type SportsEntity,type SportsEvent,type SportsStanding,type StandingRow } from './types';
const obj=z.record(z.string(),z.unknown());
function record(value:unknown):Record<string,unknown>{const parsed=obj.safeParse(value);return parsed.success?parsed.data:{};}
function list(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function text(value:unknown,max=200):string{return typeof value==='string'?value.slice(0,max):'';}
function numeric(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
function id(value:unknown):string{if(typeof value==='number'&&Number.isInteger(value)&&value>0)return String(value);if(typeof value==='string'&&/^[0-9]{1,20}$/.test(value))return value;throw new Error('Identificativo provider non valido');}
export function apiSportsBase(sportId:string){if(sportId==='calcio')return 'https://v3.football.api-sports.io';if(sportId==='pallavolo')return 'https://v1.volleyball.api-sports.io';throw new Error('Adapter non ancora disponibile per questa disciplina.');}
export function normalizedStatus(code:string):SportsEvent['status']{if(['1H','2H','HT','ET','BT','P','LIVE','S1','S2','S3','S4','S5','IN_PROGRESS'].includes(code))return 'live';if(['FT','AET','PEN','AWD','WO'].includes(code))return 'finished';if(['NS','TBD'].includes(code))return 'scheduled';if(['PST'].includes(code))return 'postponed';if(['CANC','ABD'].includes(code))return 'cancelled';if(['INT','SUSP'].includes(code))return 'interrupted';return 'unknown';}
function entity(value:unknown,competition:Competition):SportsEntity{const data=record(value),externalId=id(data.id),country=text(record(data.country).name)||text(data.country)||null;return {id:`api-sports:${competition.sportId}:team:${externalId}`,externalId,name:text(data.name)||(()=>{throw new Error('Partecipante senza nome');})(),sportId:competition.sportId,kind:'team',country,italian:Boolean(country&&isItalianCountry(country))||competition.italianEntityExternalIds.includes(externalId),providerId:'api-sports'};}
export function italyEvidence(competition:Competition,participants:SportsEntity[]):string|null{if(isItalianCountry(competition.country))return `Competizione italiana: ${competition.name}.`;const italian=participants.filter(p=>p.italian);return italian.length?`Partecipazione italiana documentata: ${italian.map(p=>p.name).join(', ')}.`:null;}
export function normalizeApiSportsEvent(raw:unknown,competition:Competition,fetchedAt=new Date().toISOString()):SportsEvent|null{
  const data=record(raw),football=competition.sportId==='calcio',fixture=football?record(data.fixture):data,league=record(data.league);
  if(id(league.id)!==competition.externalId)throw new Error('Evento non appartenente alla competizione richiesta.');
  const suppliedCountry=text(league.country)||text(record(data.country).name)||text(data.country);
  if(isItalianCountry(competition.country)&&!isItalianCountry(suppliedCountry))throw new Error('La fonte non conferma che la competizione sia italiana.');
  const teams=record(data.teams),participants=[entity(teams.home,competition),entity(teams.away,competition)];
  const evidence=italyEvidence(competition,participants);if(!evidence)return null;
  const startsAt=text(fixture.date)||text(data.date);if(!startsAt||Number.isNaN(Date.parse(startsAt)))throw new Error('Data del provider mancante.');
  const status=record(fixture.status),code=text(status.short,30),externalId=id(fixture.id),goals=record(data.goals),scores=record(data.scores),score=record(data.score),periods=record(data.periods);
  const event:SportsEvent={id:`api-sports:${competition.sportId}:event:${externalId}`,externalId,sportId:competition.sportId,competitionId:competition.id,competitionName:competition.name,season:competition.season,startsAt:new Date(startsAt).toISOString(),status:normalizedStatus(code),providerStatus:text(status.long)||code||'Non dichiarato',participants,score:football?{kind:'football',home:numeric(goals.home),away:numeric(goals.away)}:{kind:'volleyball',home:numeric(scores.home),away:numeric(scores.away),sets:[]},round:text(league.round)||text(data.week)||null,venue:text(record(fixture.venue).name)||null,providerId:'api-sports',sourceUrl:`https://api-sports.io/sports/${football?'football':'volleyball'}`,fetchedAt,italyEvidence:evidence,statistics:[],timeline:[],lineups:[]};
  if(event.score.kind==='football'){
    const half=record(score.halftime),penalties=record(score.penalty);
    if(numeric(half.home)!==null||numeric(half.away)!==null)event.score.halfTime={label:'Primo tempo',home:numeric(half.home),away:numeric(half.away)};
    if(numeric(penalties.home)!==null||numeric(penalties.away)!==null)event.score.penalties={label:'Rigori',home:numeric(penalties.home),away:numeric(penalties.away)};
  }else if(event.score.kind==='volleyball'){
    ['first','second','third','fourth','fifth'].forEach((key,index)=>{const part=record(periods[key]??scores[`set_${index+1}`]);if(numeric(part.home)!==null||numeric(part.away)!==null)event.score.kind==='volleyball'&&event.score.sets.push({label:`Set ${index+1}`,home:numeric(part.home),away:numeric(part.away)});});
  }
  return sportsEventSchema.parse(event);
}
export function normalizeStandings(raw:unknown,competition:Competition,fetchedAt=new Date().toISOString()):SportsStanding[]{
  const response=list(raw);for(const item of response){const league=record(record(item).league);if(league.id!==undefined&&id(league.id)!==competition.externalId)throw new Error('Classifica di una competizione diversa.');}const groups:unknown[][]=competition.sportId==='calcio'?response.flatMap(item=>list(record(record(item).league).standings)).filter(Array.isArray):response.every(Array.isArray)?response as unknown[][]:[response];
  return groups.flatMap((group,index)=>{
    const rows:StandingRow[]=group.flatMap(value=>{const data=record(value),team=record(data.team);if(!team.id||!text(team.name))return [];const entityId=`api-sports:${competition.sportId}:team:${id(team.id)}`;const games=record(data.all??data.games);return [{position:numeric(data.rank??data.position),entityId,name:text(team.name),played:numeric(games.played),won:numeric(record(games.win).total??games.win??games.won),drawn:numeric(record(games.draw).total??games.draw),lost:numeric(record(games.lose).total??games.lose??games.lost),points:numeric(data.points),description:text(data.description)||null}];});
    if(!rows.length)return [];
    const data=record(group[0]);return [{id:`${competition.id}:${competition.season}:${index}`,competitionId:competition.id,season:competition.season,group:text(data.group)||`Classifica ${index+1}`,stage:text(data.stage)||null,rows,providerId:'api-sports' as const,sourceUrl:`https://api-sports.io/sports/${competition.sportId==='calcio'?'football':'volleyball'}`,fetchedAt}];
  });
}
export function parseProviderEnvelope(value:unknown):unknown[]{const envelope=record(value);const errors=envelope.errors;if((Array.isArray(errors)&&errors.length)||(errors&&typeof errors==='object'&&Object.keys(errors).length))throw new Error('Il provider ha restituito un errore di dati o autorizzazione.');if(!Array.isArray(envelope.response))throw new Error('Risposta provider non valida.');if(envelope.response.length>5000)throw new Error('Risposta troppo ampia.');return envelope.response;}
