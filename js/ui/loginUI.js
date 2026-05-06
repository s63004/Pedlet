/**
 * ============================================================================
 * PEDLET - Login UI (Visuele logica voor het geanimeerde inlogscherm)
 * ============================================================================
 * Dit bestand beheert de login pagina. Het haalt de schoolgegevens op,
 * past de dynamische achtergrond aan, controleert de time-gates en verwerkt 
 * zowel de leerlingen- als leerkrachten logica.
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
    
    // D. Koppel de acties aan beide formulieren
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

        // 2. Zoek automatisch de actieve/recente reis voor deze school
        // OPLOSSING: We gebruiken maybeSingle() in plaats van single() om 406 fouten te voorkomen 
        // als er (nog) geen zichtbare reis bestaat voor deze school.
        const { data: reis, error: reisErr } = await supabase
            .from('reis')
            .select('*')
            .eq('school_id', school.id)
            .eq('is_zichtbaar', true)
            .order('datum_start', { ascending: false })
            .limit(1)
            .maybeSingle(); 

        if (!reisErr && reis) {
            actieveReis = reis;
            // Sla het reis ID op voor later gebruik (bijv. na Smartschool redirect)
            sessionStorage.setItem('pedlet_actieve_reis_id', reis.id);
        }

        updateSchermVisuals();

    } catch (error) {
        toonMelding(error.message, "error");
        setTimeout(() => window.location.href = 'index.html', 2000);
    }
}

function updateSchermVisuals() {
    // 1. Pas titels aan (het linker animerende paneel)
    const titelEl = document.getElementById('loginTitel');
    const subtitelEl = document.getElementById('loginSubtitel');
    
    if (titelEl && actieveReis) {
        titelEl.textContent = ontsnapHTML(actieveReis.naam);
    } else if (titelEl) {
        titelEl.textContent = "Geen actieve reis";
    }
    
    if (subtitelEl) {
        subtitelEl.textContent = ontsnapHTML(actieveSchool.naam);
    }

    // 2. Achtergrond aanpassen op het dynamic-bg element
    if (actieveReis && actieveReis.login_bg) {
        const bgEl = document.getElementById('dynamic-bg');
        if (bgEl) bgEl.style.backgroundImage = `url('${actieveReis.login_bg}')`;
    }

    // 3. Time-Gate Controle voor leerlingen (Mag men er al op?)
    if (actieveReis && actieveReis.datum_online) {
        const nu = new Date();
        const onlineDatum = new Date(actieveReis.datum_online);
        
        if (nu < onlineDatum) {
            toonTijdslotWaarschuwing(onlineDatum);
        }
    }
}

function toonTijdslotWaarschuwing(onlineDatum) {
    const waarschuwingDiv = document.getElementById('tijdslotWaarschuwing');
    if (!waarschuwingDiv) return;

    waarschuwingDiv.innerHTML = `
        <div class="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6 rounded-r-lg w-full">
            <div class="flex">
                <div class="flex-shrink-0">
                    <i data-lucide="clock" class="h-5 w-5 text-orange-400"></i>
                </div>
                <div class="ml-3">
                    <p class="text-sm text-orange-700 font-bold">Inschrijvingen nog gesloten</p>
                    <p class="text-sm text-orange-600 mt-1">
                        Toegang vanaf <strong>${formatteerDatumTijd(actieveReis.datum_online)}</strong>.
                    </p>
                </div>
            </div>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ============================================================================
// 3. INLOG ACTIES (Leerlingen & Leerkrachten)
// ============================================================================

function setupEventListeners() {
    
    // --- A. SMARTSCHOOL KNOP ---
    const btnSS = document.getElementById('btnSmartschoolLogin');
    if (btnSS) {
        btnSS.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = `backend/loginSS.php?school=${actieveSchool.id}`;
        });
    }

    // --- B. LEERLINGEN MANUEEL FORMULIER ---
    const formManueel = document.getElementById('manueelLoginForm');
    if (formManueel) {
        formManueel.addEventListener('submit', async (e) => {
            e.preventDefault();
            const vnaam = document.getElementById('inputVnaam').value.trim();
            const naam = document.getElementById('inputNaam').value.trim();
            const klas = document.getElementById('inputKlas').value.trim();

            if (!vnaam || !naam || !klas) return toonMelding("Vul alle velden in.", "error");

            try {
                const btn = formManueel.querySelector('button[type="submit"]');
                btn.innerHTML = "Bezig met inloggen...";
                btn.disabled = true;

                // Call de API
                const gebruiker = await loginManueel(actieveSchool.id, vnaam, naam, klas);
                
                // Controleer rechten (Time-gate)
                if (actieveReis) {
                    const toegestaan = checkReisToegang(actieveReis, gebruiker);
                    if (!toegestaan.toegang) throw new Error(toegestaan.reden);
                }

                // Succes -> Ga naar verdeling
                toonMelding(`Welkom ${ontsnapHTML(gebruiker.vnaam)}!`, "success");
                
                // Trigger de exit animatie van login.html
                document.getElementById('auth-container').classList.add('exit-slide');
                setTimeout(() => window.location.href = 'verdeling.html', 550);

            } catch (error) {
                toonMelding(error.message, "error");
                const btn = formManueel.querySelector('button[type="submit"]');
                btn.innerHTML = "Doorgaan als Leerling";
                btn.disabled = false;
            }
        });
    }

    // --- C. LEERKRACHTEN FORMULIER ---
    const formLeerkracht = document.getElementById('teacherLoginForm');
    if (formLeerkracht) {
        formLeerkracht.addEventListener('submit', async (e) => {
            e.preventDefault();
            const vnaam = document.getElementById('inputLkrVnaam').value.trim();
            const naam = document.getElementById('inputLkrNaam').value.trim();
            const wachtwoord = document.getElementById('inputLkrWachtwoord').value;

            if (!vnaam || !naam || !wachtwoord) return toonMelding("Vul alle velden in.", "error");

            try {
                const btn = formLeerkracht.querySelector('button[type="submit"]');
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Bezig...';
                btn.disabled = true;

                // 1. Controleer het wachtwoord veilig via de database RPC
                const { data: isGeldig, error } = await supabase.rpc('verify_teacher_password', {
                    p_password: wachtwoord,
                    p_school_id: actieveSchool.id
                });

                if (error || !isGeldig) throw new Error("Ongeldig schoolwachtwoord.");

                // 2. Zoek of we deze leerkracht al in de database hebben staan (of maak aan)
                let { data: lkrData } = await supabase.from('persoon')
                    .select('*')
                    .eq('school_id', actieveSchool.id)
                    .ilike('vnaam', vnaam)
                    .ilike('naam', naam)
                    .eq('rol', 'LEERKRACHT')
                    .maybeSingle();

                if (!lkrData) {
                    // Maak een nieuw record aan in de database voor deze leerkracht
                    const { data: nieuwLkr, error: insertErr } = await supabase.from('persoon')
                        .insert([{ school_id: actieveSchool.id, vnaam, naam, rol: 'LEERKRACHT' }])
                        .select().single();
                    if (insertErr) throw new Error("Kon profiel niet registreren.");
                    lkrData = nieuwLkr;
                }

                // 3. Sla lokaal op en redirect
                sessionStorage.setItem('pedlet_user', JSON.stringify(lkrData));
                toonMelding(`Welkom beheerder ${ontsnapHTML(lkrData.vnaam)}!`, "success");
                
                // Animatie
                document.getElementById('auth-container').classList.add('exit-slide');
                setTimeout(() => window.location.href = 'admin.html', 550);

            } catch (error) {
                toonMelding(error.message, "error");
                const btn = formLeerkracht.querySelector('button[type="submit"]');
                btn.innerHTML = "Inloggen als Beheerder";
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
        
        // 1. Verwerk de data in de database
        const gebruiker = await verwerkSmartschoolLogin(payload);
        
        // 2. Rol-gebaseerde redirect (Leerkracht = admin, Leerling = verdeling)
        if (gebruiker.rol === 'LEERKRACHT') {
            toonMelding(`Welkom beheerder ${ontsnapHTML(gebruiker.vnaam)}!`, "success");
            setTimeout(() => window.location.href = 'admin.html', 1000);
            return;
        }

        // 3. Voor leerlingen: Check time-gates op de laatst bezochte reis
        const opgeslagenReisId = sessionStorage.getItem('pedlet_actieve_reis_id');
        let reisQuery = supabase.from('reis').select('*').eq('school_id', gebruiker.school_id);
        
        if (opgeslagenReisId) {
            reisQuery = reisQuery.eq('id', opgeslagenReisId);
        } else {
            reisQuery = reisQuery.eq('is_zichtbaar', true).order('datum_start', { ascending: false }).limit(1);
        }

        // Ook hier maybeSingle() gebruiken om de 406 fout te voorkomen
        const { data: reis } = await reisQuery.maybeSingle();

        if (reis) {
            const toegestaan = checkReisToegang(reis, gebruiker);
            if (!toegestaan.toegang) {
                toonMelding(toegestaan.reden, "error");
                sessionStorage.removeItem('pedlet_user');
                setTimeout(() => {
                    const schoolSlug = new URLSearchParams(window.location.search).get('school');
                    window.location.href = `login.html?school=${schoolSlug}`;
                }, 4000);
                return;
            }
        }

        toonMelding(`Welkom ${ontsnapHTML(gebruiker.vnaam)}!`, "success");
        setTimeout(() => window.location.href = 'verdeling.html', 1000);

    } catch (error) {
        toonMelding(error.message, "error");
        setTimeout(() => {
            const schoolSlug = new URLSearchParams(window.location.search).get('school');
            window.location.href = `login.html?school=${schoolSlug}`;
        }, 3000);
    }
}

// Start het script
document.addEventListener('DOMContentLoaded', initLoginUI);
