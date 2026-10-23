import { execute, query, transaction } from './db';
import { regions } from './regions';
import type { Source } from './types';
import type { VerificationReport } from './newsroom-types';
const catalogue = 'https://schema.gov.it/lodview/data/distribution/regions_CSV';
const verifiedAt = '2026-10-21';
const codes: Record<string, string> = { piemonte:'01', 'valle-d-aosta':'02', lombardia:'03', 'trentino-alto-adige':'04', veneto:'05', 'friuli-venezia-giulia':'06', liguria:'07', 'emilia-romagna':'08', toscana:'09', umbria:'10', marche:'11', lazio:'12', abruzzo:'13', molise:'14', campania:'15', puglia:'16', basilicata:'17', calabria:'18', sicilia:'19', sardegna:'20' };
const normalize = (value:string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export async function initializeGeography() {
  await transaction(async () => {
    for (const region of regions) await execute('INSERT INTO geographic_units (id,level,parent_id,label,slug,source_url,checked_at,metadata) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING', [`region:${codes[region.slug]}`, 'region', null, region.name, region.slug, catalogue, verifiedAt, JSON.stringify({ license:'CC BY 4.0', authority:'Dipartimento per la trasformazione digitale / ISTAT', scope:'Regioni amministrative; nessuna coordinata o luogo di evento dedotto' })]);
    const localSource='https://www.comune.castronovodisicilia.pa.it/';
    for(const unit of [{id:'province:palermo',level:'province',parent:'region:19',label:'Palermo',slug:'palermo'},{id:'municipality:castronovo-di-sicilia',level:'municipality',parent:'province:palermo',label:'Castronovo di Sicilia',slug:'castronovo-di-sicilia'}])await execute('INSERT INTO geographic_units (id,level,parent_id,label,slug,source_url,checked_at,metadata) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',[unit.id,unit.level,unit.parent,unit.label,unit.slug,localSource,'2026-10-22',JSON.stringify({license:'CC BY 4.0',authority:'Comune di Castronovo di Sicilia',scope:'Copertura istituzionale e recapiti territoriali del Comune; identificatori locali, non codici ISTAT'})]);
  });
}
export async function resolveSourceGeography(source:Source):Promise<VerificationReport['geography']> {
  const unknown:VerificationReport['geography'] = { level:'undetermined',region:null,province:null,municipality:null,evidence:null };
  if (!source.authorized || !source.official) return unknown;
  await initializeGeography();
  if (source.territory) {
    try {
      const evidence = new URL(source.territory.evidenceUrl);
      if (evidence.protocol !== 'https:' || evidence.hostname !== new URL(source.homepage).hostname) return unknown;
      const rows = await query('SELECT id,level,parent_id,label,slug FROM geographic_units WHERE id=?', [source.territory.unitId]);
      if (!rows[0]) return unknown;
      const unit = rows[0];
      let region = unit.level === 'region' ? unit : null;
      let province:Record<string,unknown>|null = unit.level === 'province' ? unit : null;
      if (unit.level === 'municipality' && unit.parent_id) province = (await query('SELECT id,level,parent_id,label,slug FROM geographic_units WHERE id=? AND level=?',[unit.parent_id,'province']))[0] || null;
      if (!region && province?.parent_id) region = (await query('SELECT id,level,parent_id,label,slug FROM geographic_units WHERE id=? AND level=?',[province.parent_id,'region']))[0] || null;
      if (!region) return unknown;
      return { level:unit.level as 'region'|'province'|'municipality', region:String(region.slug), province:province?String(province.label):null, municipality:unit.level === 'municipality'?String(unit.label):null, evidence:`Copertura territoriale documentata della fonte: ${source.territory.evidenceUrl}. Non equivale alla localizzazione precisa dell'evento.` };
    } catch { return unknown; }
  }
  if (!source.region) return unknown;
  const region = regions.find(unit => normalize(unit.slug) === normalize(source.region!) || normalize(unit.name) === normalize(source.region!));
  if (!region) return unknown;
  return { level:'region', region:region.slug, province:null, municipality:null, evidence:`Copertura regionale configurata per la fonte istituzionale ${source.name}: ${source.homepage}. Registro: ${catalogue}. Nessuna localizzazione dedotta da menzioni nel testo.` };
}
