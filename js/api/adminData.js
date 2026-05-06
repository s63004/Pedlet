/**
 * ============================================================================
 * PEDLET - Admin Data API
 * ============================================================================
 * Dit bestand bevat alle Supabase database-queries specifiek voor het 
 * Admin / Leerkrachten dashboard. Bevat geavanceerde filters, massa-acties
 * en override-rechten.
 */

import { supabase } from '../config/supabase.js';

// ============================================================================
// 1. REIZEN & INSTELLINGEN (De nieuwe Pedlet velden)
// ============================================================================

/**
 * Haalt alle reizen/activiteiten op inclusief de nieuwe instellingen.
 * @param {number} schoolId - Het ID van de huidige school
 */
export async function getReizenAdmin(schoolId) {
    const { data, error } = await supabase
        .from('reis')
        .select(`
            *,
            deelschool ( id, naam )
        `)
        .eq('school_id', schoolId)
        .order('datum_start', { ascending: false });

    if (error) {
        console.error("Fout bij ophalen reizen:", error);
        return null;
    }
    return data;
}

/**
 * Maakt een nieuwe reis aan of updatet een bestaande, 
 * inclusief ALLE 8 nieuwe parameters uit het Pedlet document.
 */
export async function saveReis(reisData) {
    const { data, error } = await supabase
        .from('reis')
        .upsert([{
            id: reisData.id || undefined, // undefined zorgt voor een INSERT als het nieuw is
            school_id: reisData.school_id,
            deelschool_id: reisData.deelschool_id || null,
            naam: reisData.naam,
            slug: reisData.slug,
            inlogmethode: reisData.inlogmethode || 'beide',
            toegelaten_jaren: reisData.toegelaten_jaren || '*',
            zichtbaarheid_groep: reisData.zichtbaarheid_groep || '*',
            is_zichtbaar: reisData.is_zichtbaar || false,
            datum_start: reisData.datum_start,
            datum_eind: reisData.datum_eind,
            datum_online: reisData.datum_online, // Time-gating!
            soort_activiteit: reisData.soort_activiteit || 'reis',
            frequentie: reisData.frequentie || 'eenmalig'
        }])
        .select();

    if (error) throw new Error("Fout bij opslaan reis: " + error.message);
    return data[0];
}

// ============================================================================
// 2. BESTEMMINGEN & KAMERS (Met capaciteit filters)
// ============================================================================

/**
 * Haalt hotels/activiteiten op met hun weergave instellingen.
 */
export async function getBestemmingenAdmin(reisId) {
    const { data, error } = await supabase
        .from('hotel')
        .select('*')
        .eq('reis_id', reisId)
        .order('id', { ascending: true });

    if (error) throw new Error(error.message);
    return data;
}

/**
 * Haalt kamers op én berekent direct de huidige bezetting.
 * Handig voor de "kamers niet vol" filter in je frontend.
 */
export async function getKamersMetBezetting(hotelId) {
    const { data, error } = await supabase
        .from('kamer')
        .select(`
            *,
            reservering ( id, status )
        `)
        .eq('hotel_id', hotelId);

    if (error) throw new Error(error.message);

    // Bereken de bezetting in JavaScript voor makkelijke filtering later
    return data.map(kamer => {
        const bevestigd = kamer.reservering ? kamer.reservering.filter(r => r.status === 'confirmed').length : 0;
        return {
            ...kamer,
            bezetting: bevestigd,
            is_vol: bevestigd >= kamer.capaciteit
        };
    });
}

// ============================================================================
// 3. PERSONENLIJST & EXPORT DATA
// ============================================================================

/**
 * Haalt een uitgebreide personenlijst op voor data export en filters.
 * Haalt de schoolnaam op, én in welk hotel/kamer ze momenteel zitten.
 */
export async function getPersonenUitgebreid(schoolId) {
    const { data, error } = await supabase
        .from('persoon')
        .select(`
            *,
            school ( naam ),
            reservering (
                id,
                status,
                kamer ( id, kamer_nr, hotel_id, hotel ( naam ) )
            )
        `)
        .eq('school_id', schoolId)
        .order('naam', { ascending: true });

    if (error) throw new Error(error.message);
    return data;
}

// ============================================================================
// 4. BEHEERDER ACTIES & OVERRIDES (Macht voor leerkrachten)
// ============================================================================

/**
 * Leerkracht actie: Zelf een leerling in een kamer forceren (override).
 * Dit omzeilt de standaard pending-flow van de leerling zelf.
 */
export async function forceerKamerToewijzing(persoonId, kamerId) {
    // 1. Verwijder eventuele oude reserveringen van deze persoon voor dit specifiek hotel
    // (Dit vereist een iets complexere query of we doen een directe insert/update)
    
    const serverTijd = Date.now();
    const resId = `res_admin_${serverTijd}_${Math.floor(Math.random() * 1000)}`;

    const { data, error } = await supabase
        .from('reservering')
        .insert([{
            id: resId,
            kamer_id: kamerId,
            persoon_id: persoonId,
            status: 'confirmed', // Direct bevestigd door admin!
            timestamp: serverTijd
        }]);

    if (error) throw new Error("Kon leerling niet toewijzen: " + error.message);
    return true;
}

/**
 * MASSA VERWIJDERING (Reset voor een volgend jaar)
 * Let op: Deze functie is gevaarlijk en moet goed afgeschermd worden in de UI!
 * @param {number} reisId - De reis waarvan alle inschrijvingen gewist moeten worden
 */
export async function resetReisInschrijvingen(reisId) {
    // Om alle reserveringen van één reis te wissen, moeten we de reserveringen
    // zoeken die gekoppeld zijn aan de kamers van de hotels van deze reis.
    
    // Stap 1: Zoek alle kamers die bij deze reis horen
    const { data: hotels, error: hotelErr } = await supabase
        .from('hotel')
        .select('kamer ( id )')
        .eq('reis_id', reisId);

    if (hotelErr) throw new Error("Fout bij ophalen van reis structuur.");

    // Verzamel alle kamer IDs
    let kamerIds = [];
    hotels.forEach(h => {
        if(h.kamer) {
            kamerIds = kamerIds.concat(h.kamer.map(k => k.id));
        }
    });

    if (kamerIds.length === 0) return true; // Niets om te wissen

    // Stap 2: Verwijder alle reserveringen in deze kamers
    const { error: deleteErr } = await supabase
        .from('reservering')
        .delete()
        .in('kamer_id', kamerIds);

    if (deleteErr) throw new Error("Fout bij het wissen van de inschrijvingen: " + deleteErr.message);
    
    return true;
}

// ============================================================================
// 5. DEELSCHOLEN
// ============================================================================

/**
 * Haalt de deelscholen op voor de dropdowns.
 */
export async function getDeelscholen(schoolId) {
    const { data, error } = await supabase
        .from('deelschool')
        .select('*')
        .eq('school_id', schoolId)
        .order('naam', { ascending: true });

    if (error) throw new Error(error.message);
    return data;
}