/**
 * ============================================================================
 * PEDLET - Reizen & Voortgang API
 * ============================================================================
 * Dit bestand is verantwoordelijk voor het ophalen van de publiek zichtbare
 * reizen, de bijbehorende bestemmingen (hotels/activiteiten) en het berekenen
 * van de persoonlijke voortgang van een leerling.
 */

import { supabase } from '../config/supabase.js';

// ============================================================================
// 1. REIS & BESTEMMINGEN OPHALEN
// ============================================================================

/**
 * Haalt de details van de geselecteerde reis op via de URL slug.
 * Controleert ook of de reis daadwerkelijk op 'actief' en 'zichtbaar' staat.
 * * @param {string} slug - De unieke URL-naam van de reis (bijv. 'italie-2026')
 * @returns {Object} Het reis object
 */
export async function getActieveReis(slug) {
    const { data, error } = await supabase
        .from('reis')
        .select(`
            id,
            naam,
            login_bg,
            is_actief,
            is_zichtbaar,
            datum_online,
            toegelaten_jaren,
            soort_activiteit
        `)
        .eq('slug', slug)
        .eq('is_actief', true) // Reis moet globaal actief zijn
        .single();

    if (error || !data) {
        console.error("Reis niet gevonden of niet actief:", error);
        throw new Error("Deze activiteit is momenteel niet beschikbaar.");
    }

    return data;
}

/**
 * Haalt alle bestemmingen (hotels, bussen, activiteiten) op voor de reis.
 * Geeft direct de juiste weergave (layout_type) en extra huisregels mee.
 * * @param {number} reisId - Het ID van de actieve reis
 * @returns {Array} Lijst met bestemmingen, gesorteerd op volgorde
 */
export async function getBestemmingen(reisId) {
    const { data, error } = await supabase
        .from('hotel')
        .select(`
            id,
            naam,
            bg_image,
            type_bestemming,
            layout_type,
            extra_info
        `)
        .eq('reis_id', reisId)
        .eq('is_actief', true)
        .order('id', { ascending: true }); // Zorgt dat hotel 1 voor hotel 2 komt

    if (error) {
        throw new Error("Fout bij ophalen van de bestemmingen: " + error.message);
    }

    return data;
}

// ============================================================================
// 2. VOORTGANG BEREKENEN (Gamification & Duidelijkheid)
// ============================================================================

/**
 * Berekent de exacte voortgang van een specifieke leerling voor een reis.
 * Dit beantwoordt de eis: "Duidelijker tonen welke kamers je nog moet doen".
 * * @param {number} reisId - ID van de huidige reis
 * @param {number} persoonId - ID van de ingelogde leerling
 * @returns {Object} Voortgangsobject met afgeronde en de 'huidige/volgende' bestemming
 */
export async function getStudentVoortgang(reisId, persoonId) {
    try {
        // 1. Haal eerst alle bestemmingen van deze reis op
        const bestemmingen = await getBestemmingen(reisId);
        
        if (!bestemmingen || bestemmingen.length === 0) {
            return { bestemmingen: [], huidigActiefId: null, isKlaar: false };
        }

        // 2. Haal alle reserveringen van deze specifieke student op 
        // We joinen met 'kamer' om te weten in welk 'hotel_id' ze zitten
        const { data: reserveringen, error: resErr } = await supabase
            .from('reservering')
            .select(`
                status,
                kamer ( hotel_id )
            `)
            .eq('persoon_id', persoonId)
            .eq('status', 'confirmed'); // Enkel afgeronde keuzes tellen mee

        if (resErr) throw resErr;

        // Maak een simpele lijst (Array) van de hotel_id's waar de student al in zit
        const voltooideHotelIds = reserveringen.map(res => res.kamer.hotel_id);

        // 3. Loop door de bestemmingen en bereken de status
        let huidigActiefId = null;
        let isKlaar = true;

        const voortgangLijst = bestemmingen.map(bestemming => {
            const isVoltooid = voltooideHotelIds.includes(bestemming.id);
            
            // Als we een onvoltooide bestemming vinden, en we hebben nog geen 'huidige' gezet,
            // dan is DIT de halte waar de leerling nu iets moet kiezen.
            let isHuidig = false;
            if (!isVoltooid && huidigActiefId === null) {
                huidigActiefId = bestemming.id;
                isHuidig = true;
                isKlaar = false; // Leerling is nog niet klaar met de hele reis
            } else if (!isVoltooid) {
                isKlaar = false;
            }

            return {
                ...bestemming,
                is_voltooid: isVoltooid,
                is_huidig: isHuidig
            };
        });

        return {
            lijst: voortgangLijst,        // Voor de navigatiebalk bovenaan (✅ en ⏳ icoontjes)
            huidigActiefId: huidigActiefId, // Het hotel dat direct geopend moet worden op het scherm
            isKlaar: isKlaar              // True als de leerling voor alle onderdelen een plaats heeft
        };

    } catch (error) {
        console.error("Fout bij berekenen voortgang:", error);
        throw new Error("Kon je persoonlijke voortgang niet laden.");
    }
}