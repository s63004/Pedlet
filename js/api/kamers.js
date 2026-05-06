/**
 * ============================================================================
 * PEDLET - Kamers & Real-time API
 * ============================================================================
 * Dit bestand haalt de kamers (of groepen/plaatsen) op voor een specifieke 
 * activiteit/hotel en stelt de live WebSocket verbindingen in. 
 * Hierdoor kunnen we "Selective DOM Updates" doen: we updaten enkel de kamer
 * die daadwerkelijk verandert in de database, niet heel het scherm.
 */

import { supabase } from '../config/supabase.js';

// ============================================================================
// 1. KAMERS OPHALEN
// ============================================================================

/**
 * Haalt alle kamers voor een specifiek hotel/onderdeel op.
 * Berekent direct de huidige bezetting en kijkt of er "pending" aanvragen zijn.
 * * @param {number} hotelId - Het ID van het huidige hotel/activiteit
 * @returns {Array} Lijst van kamers met hun berekende status
 */
export async function getKamers(hotelId) {
    const { data, error } = await supabase
        .from('kamer')
        .select(`
            id, 
            kamer_nr, 
            capaciteit, 
            geslacht,
            reservering ( id, status, persoon_id )
        `)
        .eq('hotel_id', hotelId)
        .order('kamer_nr', { ascending: true }); // Sorteer netjes op kamernummer of naam

    if (error) {
        console.error("Fout bij ophalen kamers:", error);
        throw new Error("Kon de indeling niet laden.");
    }

    // Verwerk de data zodat de frontend makkelijk filters kan toepassen (zoals 'verberg volle kamers')
    return data.map(kamer => {
        // Tel hoeveel bevestigde reserveringen er zijn
        const bevestigd = kamer.reservering ? kamer.reservering.filter(r => r.status === 'confirmed').length : 0;
        
        // Kijk of er iemand momenteel deze kamer aan het claimen is (slotje)
        const inBehandeling = kamer.reservering ? kamer.reservering.filter(r => r.status === 'pending').length > 0 : false;

        return {
            ...kamer,
            bezetting: bevestigd,
            is_vol: bevestigd >= kamer.capaciteit,
            in_behandeling: inBehandeling,
            // We sturen de reserveringen mee zodat we later namen kunnen koppelen
            reserveringen: kamer.reservering 
        };
    });
}

// ============================================================================
// 2. REAL-TIME UPDATES (WEBSOCKETS)
// ============================================================================

/**
 * Luistert live naar wijzigingen in de reservering-tabel.
 * Dit is cruciaal voor de Pedlet-eis: "alleen nodige kamers vervangen".
 * * @param {number} hotelId - ID van het actieve hotel (voor een unieke kanaalnaam)
 * @param {Array} kamerIds - Lijst met kamer IDs die bij dit hotel horen
 * @param {Function} callback - Functie die wordt aangeroepen met het gewijzigde kamer_id
 * @returns {Object} De actieve Supabase channel (bewaar dit om later af te sluiten!)
 */
export function subscribeToKamerUpdates(hotelId, kamerIds, callback) {
    const channelName = `public:reservering:hotel_${hotelId}`;

    const channel = supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            { 
                event: '*', // Luister naar INSERT, UPDATE en DELETE
                schema: 'public', 
                table: 'reservering' 
            },
            (payload) => {
                // Zoek uit welke kamer er is aangepast
                const gewijzigdKamerId = payload.new ? payload.new.kamer_id : payload.old.kamer_id;

                // Controleer of deze kamer bij ons huidige hotel/scherm hoort
                if (kamerIds.includes(gewijzigdKamerId)) {
                    // Stuur ENKEL het ID van de gewijzigde kamer terug naar de UI
                    callback(gewijzigdKamerId);
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log(`Live verbinding gestart voor hotel ${hotelId}`);
            }
        });

    return channel;
}

/**
 * Sluit de live verbinding netjes af. 
 * Heel belangrijk om te doen als een leerling naar een "volgend hotel" klikt, 
 * anders gaat je app crashen door te veel verbindingen.
 * * @param {Object} channel - De channel die je kreeg van subscribeToKamerUpdates
 */
export function unsubscribeFromUpdates(channel) {
    if (channel) {
        supabase.removeChannel(channel);
        console.log("Live verbinding netjes afgesloten.");
    }
}