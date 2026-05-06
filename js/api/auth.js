/**
 * ============================================================================
 * PEDLET - Auth & Toegangscontrole API
 * ============================================================================
 * Dit bestand beheert het inloggen van gebruikers (zowel Smartschool als manueel)
 * en controleert of een gebruiker (leerling/leerkracht) rechten heeft om een 
 * specifieke reis te bekijken op basis van de ingestelde time-gates.
 */

import { supabase } from '../config/supabase.js';

// ============================================================================
// 1. INLOGGEN (SMARTSCHOOL & MANUEEL)
// ============================================================================

/**
 * Verwerkt de veilige Base64 payload die terugkomt van loginSS.php.
 * OPLOSSING VOOR LEERKRACHTEN-BUG: Checkt op bestaand ss_id en voorkomt dubbele accounts.
 * * @param {string} base64Payload - De versleutelde JSON string van Smartschool
 * @returns {Object} Het ingelogde persoon-object uit de database
 */
export async function verwerkSmartschoolLogin(base64Payload) {
    try {
        // 1. Decodeer de payload van PHP
        const jsonString = atob(decodeURIComponent(base64Payload));
        const payload = JSON.parse(jsonString);

        if (payload.status === 'error') {
            throw new Error(payload.message || 'Fout bij inloggen via Smartschool.');
        }

        const userData = payload.data; // Bevat: ss_id, school, voornaam, naam, rol, klas, geslacht

        // 2. Zoek het correcte school_id in Pedlet op basis van de Smartschool domeinnaam (slug)
        // Bijv. 'ursula.smartschool.be' -> we zoeken naar de school met slug 'ursula'
        let schoolSlug = userData.school.split('.')[0]; 
        const { data: schoolData, error: schoolErr } = await supabase
            .from('school')
            .select('id')
            .eq('slug', schoolSlug)
            .single();

        if (schoolErr || !schoolData) {
            throw new Error(`Jouw school (${schoolSlug}) is nog niet geregistreerd in Pedlet.`);
        }

        // 3. Update of Insert de persoon in de database (Upsert)
        // Omdat ss_id UNIQUE is in de database (zie SQL), zal dit NOOIT een dubbele leerkracht maken.
        const { data: persoonData, error: persoonErr } = await supabase
            .from('persoon')
            .upsert({
                ss_id: userData.ss_id,
                school_id: schoolData.id,
                vnaam: userData.voornaam,
                naam: userData.naam,
                rol: userData.rol,
                // Voor leerkrachten slaan we klas en geslacht bewust NIET op
                klas: userData.rol === 'LEERKRACHT' ? null : userData.klas,
                geslacht: userData.rol === 'LEERKRACHT' ? null : userData.geslacht 
            }, {
                onConflict: 'ss_id' // Dit is de magic trick tegen duplicaten!
            })
            .select()
            .single();

        if (persoonErr) throw new Error("Kon gebruikersgegevens niet opslaan: " + persoonErr.message);

        // 4. Sla de gebruiker lokaal op in de browser sessie
        sessionStorage.setItem('pedlet_user', JSON.stringify(persoonData));
        
        return persoonData;

    } catch (error) {
        console.error("Login verwerkingsfout:", error);
        throw error;
    }
}

/**
 * Manuele login (als de reis-instelling 'manueel' of 'beide' toelaat)
 */
export async function loginManueel(schoolId, vnaam, naam, klas) {
    // Manuele logins hebben geen ss_id, dus we zoeken op basis van voornaam, naam en klas
    const { data: bestaandePersoon, error: zoekErr } = await supabase
        .from('persoon')
        .select('*')
        .eq('school_id', schoolId)
        .ilike('vnaam', vnaam) // Case-insensitive zoeken
        .ilike('naam', naam)
        .eq('klas', klas)
        .single();

    let persoonData = bestaandePersoon;

    if (!bestaandePersoon) {
        // Maak nieuwe manuele leerling aan
        const { data: nieuwePersoon, error: insertErr } = await supabase
            .from('persoon')
            .insert([{
                school_id: schoolId,
                vnaam: vnaam,
                naam: naam,
                klas: klas,
                rol: 'LEERLING'
            }])
            .select()
            .single();

        if (insertErr) throw new Error("Fout bij het aanmaken van manuele login.");
        persoonData = nieuwePersoon;
    }

    sessionStorage.setItem('pedlet_user', JSON.stringify(persoonData));
    return persoonData;
}

// ============================================================================
// 2. TOEGANGSCONTROLE (GATEKEEPING)
// ============================================================================

/**
 * Controleert of een gebruiker momenteel rechten heeft om de reis te zien.
 * Dit checkt de "wanneer online komen" time-gate en de zichtbaarheid settings.
 * * @param {Object} reis - Het reis object uit de database (inclusief datum_online, is_zichtbaar)
 * @param {Object} gebruiker - Het ingelogde persoon object
 * @returns {Object} { toegang: boolean, reden: string }
 */
export function checkReisToegang(reis, gebruiker) {
    // 1. Leerkrachten mogen altijd overal aan (om te testen en in te stellen)
    if (gebruiker.rol === 'LEERKRACHT') {
        return { toegang: true };
    }

    // 2. Is de reis verborgen voor leerlingen? (is_zichtbaar setting)
    if (!reis.is_zichtbaar) {
        return { 
            toegang: false, 
            reden: "Deze activiteit is momenteel nog verborgen door de leerkracht." 
        };
    }

    // 3. Time-Gating Check: Mag men er al op? (datum_online)
    if (reis.datum_online) {
        const nu = new Date();
        const onlineDatum = new Date(reis.datum_online);
        
        if (nu < onlineDatum) {
            // Formatteer de datum mooi voor de foutmelding
            const opties = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' };
            const mooieDatum = onlineDatum.toLocaleDateString('nl-BE', opties);
            
            return { 
                toegang: false, 
                reden: `De inschrijvingen voor deze activiteit openen pas op ${mooieDatum}. Nog even geduld!` 
            };
        }
    }

    // 4. Toegelaten Jaren/Groepen check (bijv. "Alleen 6de jaar")
    if (reis.toegelaten_jaren && reis.toegelaten_jaren !== '*') {
        // Een simpele check: als de tekst '6de' in de instelling staat, moet de klas van de leerling ook met '6' beginnen.
        // (Dit kan je later nog veel specifieker maken op basis van jullie schoolstructuur)
        if (!gebruiker.klas || !gebruiker.klas.includes(reis.toegelaten_jaren.charAt(0))) {
            return {
                toegang: false,
                reden: `Je klas (${gebruiker.klas}) heeft geen toegang tot deze specifieke reis.`
            };
        }
    }

    // Als alle checks slagen:
    return { toegang: true };
}

// ============================================================================
// 3. SESSIE BEHEER
// ============================================================================

/**
 * Haalt de actieve gebruiker op uit de browser opslag.
 */
export function getHuidigeGebruiker() {
    const userString = sessionStorage.getItem('pedlet_user');
    return userString ? JSON.parse(userString) : null;
}

/**
 * Logt de gebruiker uit.
 */
export function logUit() {
    sessionStorage.removeItem('pedlet_user');
    window.location.href = 'login.html';
}