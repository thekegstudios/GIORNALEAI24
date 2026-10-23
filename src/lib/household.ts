export const EXPENSES=['Alimentari','Carburante','Energia elettrica','Gas','Affitto','Mutuo','Trasporti','Telefonia','Altre spese'];
export function householdTotals(values:number[],percent:number){
  if(values.some(value=>!Number.isFinite(value)||value<0||value>1_000_000)||!Number.isFinite(percent)||percent< -100||percent>100)throw new Error('Importi o scenario non validi');
  const cents=values.map(value=>Math.round((value+Number.EPSILON*Math.max(1,value))*100)),monthlyCents=cents.reduce((sum,value)=>sum+value,0),scenarioCents=Math.round(monthlyCents*(1+percent/100));
  return {monthly:monthlyCents/100,annual:monthlyCents*12/100,scenarioMonthly:scenarioCents/100,scenarioAnnual:scenarioCents*12/100,difference:(scenarioCents-monthlyCents)/100,shares:cents.map(value=>monthlyCents?value/monthlyCents*100:0)};
}
