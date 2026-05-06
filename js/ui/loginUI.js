/**
 * ============================================================================
 * PEDLET - Login UI (Visuele logica voor het inlogscherm)
 * ============================================================================
 * Dit bestand beheert de login pagina. Het haalt de schoolgegevens op,
 * past de achtergrond aan, controleert de time-gates en verwerkt de 
 * terugkeer-data (payload) van de Smartschool OAuth koppeling.
 */

import { supabase } from '../config/supabase.js';
import { verwerkSmartschoolLogin, loginManueel, checkReisToegang } from '../api/auth.js';
import { toonMelding, formatteerDatumTijd, ontsnapHTML } from '../utils/helpers.js';

// Globale state voor deze pagina
let actieveSchool = null;
let actieveReis = null;

// ============================================================================
// 1. INITIALISATIE (Start van de pagina)
// ============================================================================

export async function initLoginUI() {
    const urlParams = new URLSearchParams(window.location.search);
    const schoolSlug = urlParams.get('school');
    const authPayload = urlParams.get('auth_payload');

    // A. Als we terugkomen van Smartschool met data
    if (authPayload) {
        await verwerkTerugkeerVanSmartschool(authPayload);
        return; // Stop verdere UI inlaad, we gaan redirecten
    }

    // B. Normale inlaad: we hebben een school nodig
    if (!schoolSlug) {
        toonMelding("Geen school geselecteerd. Je wordt teruggestuurd.", "error");
        setTimeout(() => window.location.href = 'index.html', 2000);
        return;
    }

    // C. Laad de school en de actieve reis op de achtergrond
    await laadSchoolEnReisData(schoolSlug);
    
    // D. Koppel de knoppen
    setupEventListeners();
}

// ============================================================================
// 2. DATA LADEN & UI UPDATEN
// ============================================================================

async function laadSchoolEnReisData(schoolSlug) {
    try {
        // 1. Zoek de school
        const { data: school, error: schoolErr } = await supabase
            .from('school')
            .select('*')
            .eq('slug', schoolSlug)
            .single();

        if (schoolErr || !school) throw new Error("School niet gevonden.");
        actieveSchool = school;

        // 2. Zoek de actieve reis voor deze school
        const { data: reis, error: reisErr } = await supabase
            .from('reis')
            .select('*')
            .eq('school_id', school.id)
            .eq('is_actief', true)
            .single(); // We gaan ervan uit dat er max 1 inschrijving tegelijk actief is

        if (!reisErr && reis) {
            actieveReis = reis;
        }

        updateSchermVisuals();

    } catch (error) {
        toonMelding(error.message, "error");
        setTimeout(() => window.location.href = 'index.html', 2000);
    }
}

function updateSchermVisuals() {
    // 1. Pas teksten aan
    const titelEl = document.getElementById('loginTitel');
    const subtitelEl = document.getElementById('loginSubtitel');
    
    if (titelEl) titelEl.textContent = `Welkom bij ${ontsnapHTML(actieveSchool.naam)}`;
    
    if (subtitelEl && actieveReis) {
        subtitelEl.textContent = `Inloggen voor: ${ontsnapHTML(actieveReis.naam)}`;
    } else if (subtitelEl) {
        subtitelEl.textContent = "Er is momenteel geen actieve inschrijving.";
    }

    // 2. Achtergrond aanpassen (als de reis een custom bg heeft)
    if (actieveReis && actieveReis.login_bg) {
        document.body.style.backgroundImage = `url('${actieveReis.login_bg}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    }

    // 3. Time-Gate Controle (Mag men er al op?)
    if (actieveReis && actieveReis.datum_online) {
        const nu = new Date();
        const onlineDatum = new Date(actieveReis.datum_online);
        
        if (nu < onlineDatum) {
            toonTijdslotWaarschuwing(onlineDatum);
        }
    }

    // 4. Inlogmethode UI aanpassen (verberg manueel of smartschool indien nodig)
    if (actieveReis && actieveReis.inlogmethode === 'smartschool') {
        const manueelForm = document.getElementById('manueelLoginForm');
        if (manueelForm) manueelForm.style.display = 'none';
    } else if (actieveReis && actieveReis.inlogmethode === 'manueel') {
        const ssKnop = document.getElementById('btnSmartschoolLogin');
        if (ssKnop) ssKnop.style.display = 'none';
    }
}

function toonTijdslotWaarschuwing(onlineDatum) {
    const waarschuwingDiv = document.getElementById('tijdslotWaarschuwing');
    if (!waarschuwingDiv) return;

    waarschuwingDiv.innerHTML = `
        <div class="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6">
            <div class="flex">
                <div class="flex-shrink-0">
                    <i data-lucide="clock" class="h-5 w-5 text-orange-400"></i>
                </div>
                <div class="ml-3">
                    <p class="text-sm text-orange-700 font-bold">Inschrijvingen nog gesloten!</p>
                    <p class="text-sm text-orange-600 mt-1">
                        Leerlingen hebben pas toegang vanaf <br>
                        <strong>${formatteerDatumTijd(actieveReis.datum_online)}</strong>.
                    </p>
                    <p class="text-xs text-orange-500 mt-2 italic">Leerkrachten kunnen wel al inloggen om te testen.</p>
                </div>
            </div>
        </div>
    `;
    // Update de iconen
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ============================================================================
// 3. INLOG ACTIES
// ============================================================================

function setupEventListeners() {
    // Smartschool Knop
    const btnSS = document.getElementById('btnSmartschoolLogin');
    if (btnSS) {
        btnSS.addEventListener('click', () => {
            // Verwijs naar de PHP backend, geef eventuele parameters mee als nodig
            // In loginSS.php is alles al ingesteld.
            window.location.href = `backend/loginSS.php`;
        });
    }

    // Manueel Formulier
    const formManueel = document.getElementById('manueelLoginForm');
    if (formManueel) {
        formManueel.addEventListener('submit', async (e) => {
            e.preventDefault();
            const vnaam = document.getElementById('inputVnaam').value.trim();
            const naam = document.getElementById('inputNaam').value.trim();
            const klas = document.getElementById('inputKlas').value.trim();

            if (!vnaam || !naam || !klas) {
                toonMelding("Vul alle velden in.", "error");
                return;
            }

            try {
                // Toon laad-status
                const btn = formManueel.querySelector('button[type="submit"]');
                const origineleTekst = btn.textContent;
                btn.textContent = "Bezig met inloggen...";
                btn.disabled = true;

                // Call the API
                const gebruiker = await loginManueel(actieveSchool.id, vnaam, naam, klas);
                
                // Controleer rechten (Time-gate)
                if (actieveReis) {
                    const toegestaan = checkReisToegang(actieveReis, gebruiker);
                    if (!toegestaan.toegang) {
                        throw new Error(toegestaan.reden);
                    }
                }

                toonMelding(`Welkom ${ontsnapHTML(gebruiker.vnaam)}!`, "success");
                setTimeout(() => window.location.href = 'verdeling.html', 1000);

            } catch (error) {
                toonMelding(error.message, "error");
                const btn = formManueel.querySelector('button[type="submit"]');
                btn.textContent = "Log in";
                btn.disabled = false;
            }
        });
    }
}

/**
 * Wordt aangeroepen als we met een ?auth_payload terugkomen van loginSS.php
 */
async function verwerkTerugkeerVanSmartschool(payload) {
    try {
        toonMelding("Smartschool data verwerken...", "info");
        
        // 1. Verwerk de data in de database via auth.js
        const gebruiker = await verwerkSmartschoolLogin(payload);
        
        // 2. Haal de reis op om te checken of hij/zij erin mag
        const { data: reis } = await supabase
            .from('reis')
            .select('*')
            .eq('school_id', gebruiker.school_id)
            .eq('is_actief', true)
            .single();

        if (reis) {
            // 3. Time-gate en rechten check
            const toegestaan = checkReisToegang(reis, gebruiker);
            if (!toegestaan.toegang) {
                // Toegang geweigerd (bijv. te vroeg voor leerlingen)
                toonMelding(toegestaan.reden, "error");
                // Gooi de sessie weer leeg
                sessionStorage.removeItem('pedlet_user');
                
                // Stuur ze na 4 seconden terug naar het lege inlogscherm van hun school
                setTimeout(() => {
                    const schoolSlug = new URLSearchParams(window.location.search).get('school');
                    window.location.href = `login.html?school=${schoolSlug}`;
                }, 4000);
                return;
            }
        }

        // 4. Alles oké! Doorsturen naar het dashboard
        toonMelding(`Welkom ${ontsnapHTML(gebruiker.vnaam)}!`, "success");
        setTimeout(() => window.location.href = 'verdeling.html', 1000);

    } catch (error) {
        toonMelding(error.message, "error");
        // Haal de payload uit de URL zodat we niet in een loop blijven hangen
        setTimeout(() => {
            const schoolSlug = new URLSearchParams(window.location.search).get('school');
            window.location.href = `login.html?school=${schoolSlug}`;
        }, 3000);
    }
}

// Start het script
document.addEventListener('DOMContentLoaded', initLoginUI);