import { getSportsStandings } from '@/lib/sports/store';
import { Standings } from '@/components/sports-ui';
export const dynamic='force-dynamic';
export default async function Rankings(){return <><h1>Classifiche</h1><p>Classifiche importate dalle fonti, senza ricalcolare punti o penalizzazioni.</p><Standings tables={await getSportsStandings()}/></>;}
