export const regions = [
  { slug: 'abruzzo', name: 'Abruzzo' }, { slug: 'basilicata', name: 'Basilicata' },
  { slug: 'calabria', name: 'Calabria' }, { slug: 'campania', name: 'Campania' },
  { slug: 'emilia-romagna', name: 'Emilia-Romagna' }, { slug: 'friuli-venezia-giulia', name: 'Friuli-Venezia Giulia' },
  { slug: 'lazio', name: 'Lazio' }, { slug: 'liguria', name: 'Liguria' },
  { slug: 'lombardia', name: 'Lombardia' }, { slug: 'marche', name: 'Marche' },
  { slug: 'molise', name: 'Molise' }, { slug: 'piemonte', name: 'Piemonte' },
  { slug: 'puglia', name: 'Puglia' }, { slug: 'sardegna', name: 'Sardegna' },
  { slug: 'sicilia', name: 'Sicilia' }, { slug: 'toscana', name: 'Toscana' },
  { slug: 'trentino-alto-adige', name: 'Trentino-Alto Adige' }, { slug: 'umbria', name: 'Umbria' },
  { slug: 'valle-d-aosta', name: 'Valle d’Aosta' }, { slug: 'veneto', name: 'Veneto' },
] as const;
export const categories = [
  { slug: 'cronaca', name: 'Cronaca' }, { slug: 'politica', name: 'Politica' },
  { slug: 'economia', name: 'Economia' }, { slug: 'lavoro', name: 'Lavoro' },
  { slug: 'salute', name: 'Salute' }, { slug: 'scuola', name: 'Scuola' },
  { slug: 'tecnologia', name: 'Tecnologia' }, { slug: 'sport', name: 'Sport' },
  { slug: 'spettacolo', name: 'Spettacolo' }, { slug: 'ambiente', name: 'Ambiente' },
  { slug: 'meteo', name: 'Meteo e allerte' }, { slug: 'trasporti', name: 'Trasporti' },
  { slug: 'giustizia', name: 'Giustizia' }, { slug: 'eventi', name: 'Eventi locali' },
] as const;
export const categoryName = (slug: string) => categories.find(c => c.slug === slug)?.name ?? slug;
export const regionName = (slug: string | null) => regions.find(r => r.slug === slug)?.name ?? slug;
