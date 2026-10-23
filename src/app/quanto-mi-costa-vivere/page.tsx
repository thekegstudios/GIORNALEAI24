import { PageIntro } from '@/components/news';
import { HouseholdCalculator } from '@/components/household-calculator';
import { getEconomicLatest } from '@/lib/economy';
export const metadata={title:'Quanto mi costa vivere?',robots:{index:false,follow:true}};
export default async function HouseholdPage(){const inflation=(await getEconomicLatest()).find(row=>row.seriesId==='inflazione-ipca')||null;return <div className="wrap page"><PageIntro eyebrow="LA GUERRA SILENZIOSA / IL TUO BILANCIO" title="Quanto mi costa vivere?" description="Metti in ordine le spese e prova uno scenario. Calcoli semplici sul tuo dispositivo, senza account e senza inviare i tuoi importi."/><HouseholdCalculator inflation={inflation}/></div>;}
