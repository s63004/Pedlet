/**
 * ============================================================================
 * PEDLET - Supabase Configuratie
 * ============================================================================
 * Dit bestand initialiseert de verbinding met de Pedlet Supabase database.
 * Vul hier jouw eigen unieke URL en ANON KEY in die je vindt in het 
 * Supabase dashboard onder Project Settings > API.
 */

// We importeren de Supabase client direct via de officiële CDN 
// Dit is perfect voor projecten zonder ingewikkelde build-tools (zoals Vite/Webpack)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// 1. Jouw Project URL (Begint meestal met https:// en eindigt op .supabase.co)
const SUPABASE_URL = 'https://tzokmegduddzhwwmpkyw.supabase.co/rest/v1/'; 

// 2. Jouw Anon/Public Key (Een hele lange reeks letters en cijfers)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6b2ttZWdkdWRkemh3d21wa3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjMzNDUsImV4cCI6MjA5MzYzOTM0NX0.kBHOmd7hxNF6f-nN_21pQ1bwSRIVDnNkRDaj-uyIbeQ';

// ============================================================================
// INITIALISATIE
// ============================================================================

// We maken de connectie aan en exporteren deze zodat al onze andere API 
// bestanden (zoals auth.js en reserveringen.js) deze 'supabase' variabele 
// kunnen hergebruiken zonder telkens opnieuw in te loggen.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);