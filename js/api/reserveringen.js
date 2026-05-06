/**
 * ============================================================================
 * PEDLET - Reserveringen & Locking API
 * ============================================================================
 * Dit bestand communiceert met de beveiligde SQL-functies (RPC's) in Supabase.
 * Het zorgt ervoor dat het claimen van kamers 100% veilig (zonder dubbele 
 * boekingen) verloopt en regelt de logica voor het toevoegen van kamergenoten.
 */

import { supabase } from '../config/supabase.js';

// ============================================================================
// 1. KAMER CLAIMEN (Pessimistic Locking)
// ============================================================================

/**
 * Probeert een kamer te reserveren (zet de status tijdelijk op 'pending').
 * Roept de veilige SQL functie 'claim_kamer' aan in de database.
 * * @param {number} kamerId - Het ID van de gekozen kamer/groep
 * @param {number} persoonId - Het ID van de ingelogde leerling
 * @param {number} hotelId - Het ID van het huidige hotel (ter controle)
 * @returns {Object} Resultaat met 'success' en eventueel een 'message'
 */
export async function claimKamer(kamerId, persoonId, hotelId) {
    try {
        const { data, error } = await supabase.rpc('claim_kamer', {
            p_kamer_id: kamerId,
            p_persoon_id: persoonId,
            p_hotel_id: hotelId
        });

        if (error) {
            console.error("Fout bij aanroepen claim_kamer:", error);
            throw new Error("Er ging iets mis bij het contacteren van de server.");
        }

        // De SQL functie geeft een JSON object terug (data)
        if (!data.success) {
            throw new Error(data.message); // Bijv: "Deze kamer is vol"
        }

        return data; // Bevat: success: true, res_id, server_ts

    } catch (error) {
        throw error;
    }
}

// ============================================================================
// 2. KAMER DEFINITIEF BEVESTIGEN
// ============================================================================

/**
 * Bevestigt de 'pending' kamer definitief en voegt optioneel vrienden toe.
 * Roept de veilige SQL functie 'bevestig_kamer' aan.
 * * @param {number} persoonId - Het ID van de leerling die de actie uitvoert
 * @param {Array<number>} roommateIds - (Optioneel) Lijst met ID's van gekozen vrienden
 * @returns {Object} Resultaat met 'success' en eventueel een 'message'
 */
export async function bevestigKamer(persoonId, roommateIds = []) {
    try {
        const { data, error } = await supabase.rpc('bevestig_kamer', {
            p_persoon_id: persoonId,
            p_roommate_ids: roommateIds
        });

        if (error) {
            console.error("Fout bij aanroepen bevestig_kamer:", error);
            throw new Error("Kan reservering niet voltooien. Probeer opnieuw.");
        }

        if (!data.success) {
            throw new Error(data.message); // Bijv: "Te veel personen" of "Vriend heeft al een kamer"
        }

        return data; // success: true

    } catch (error) {
        throw error;
    }
}

// ============================================================================
// 3. RESERVERING ANNULEREN (Vrijgeven)
// ============================================================================

/**
 * Verwijdert een reservering. Dit wordt gebruikt als een leerling op "Annuleren"
 * klikt nadat hij een kamer in 'pending' heeft gezet, of als de timer afloopt.
 * * @param {number} persoonId - Het ID van de leerling
 * @param {number} kamerId - Het ID van de specifieke kamer
 */
export async function annuleerReservering(persoonId, kamerId) {
    try {
        const { error } = await supabase
            .from('reservering')
            .delete()
            .eq('persoon_id', persoonId)
            .eq('kamer_id', kamerId)
            // We laten leerlingen enkel hun eigen pending (of evt confirmed als toegestaan) wissen
            .eq('status', 'pending'); 

        if (error) {
            throw new Error("Kon de reservering niet vrijgeven.");
        }
        
        return true;
    } catch (error) {
        console.error("Fout bij annuleren:", error);
        return false;
    }
}

// ============================================================================
// 4. VRIENDEN ZOEKEN VOOR DE KAMER
// ============================================================================

/**
 * Zoekt naar mede-leerlingen in dezelfde school om toe te voegen aan een kamer.
 * Handig voor de auto-complete/zoekbalk in de frontend.
 * * @param {string} zoekterm - De naam of voornaam om op te zoeken
 * @param {number} schoolId - Om enkel binnen de eigen school te zoeken
 * @returns {Array} Lijst met gevonden personen
 */
export async function zoekLeerlingVoorKamer(zoekterm, schoolId) {
    if (!zoekterm || zoekterm.length < 2) return [];

    const { data, error } = await supabase
        .from('persoon')
        .select('id, vnaam, naam, klas')
        .eq('school_id', schoolId)
        .eq('rol', 'LEERLING')
        .or(`vnaam.ilike.%${zoekterm}%,naam.ilike.%${zoekterm}%`) // Zoek in voor- of achternaam
        .limit(10); // Beperk de resultaten voor snelheid

    if (error) {
        console.error("Fout bij zoeken leerling:", error);
        return [];
    }

    return data;
}