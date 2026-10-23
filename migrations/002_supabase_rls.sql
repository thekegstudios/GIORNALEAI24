-- PostgreSQL / Supabase only: run after 001_schema.sql using the database owner.
-- The application uses a direct server-side connection. Never expose DATABASE_URL.
-- No anonymous/authenticated policy grants access to these private editorial tables.
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['sources','settings','ingested_items','events','generated_summaries','citations','article_versions','editorial_reviews','corrections','pipeline_runs','pipeline_locks','ai_usage','daily_digests','daily_metrics','reports','rate_limits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END $$;
