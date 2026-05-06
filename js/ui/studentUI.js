/**
 * ============================================================================
 * PEDLET - Student UI (Visuele logica voor het verdelingspaneel)
 * ============================================================================
 * Dit bestand regelt de weergave voor de leerlingen. Het toont de kamers,
 * beheert de 'grid' vs 'list' layout, luistert naar live WebSockets en 
 * verwerkt het claim- en bevestigingsproces.
 */

import { getHuidigeGebruiker, logUit } from '../api/auth.js';
import { getActieveReis, getStudentVoortgang } from '../api/reizen.js';
import { getKamers, subscribeToKamerUpdates, unsubscribeFromUpdates } from '../api/kamers.js';
import { claimKamer, bevestigKamer, annuleerReservering, zoekLeerlingVoorKamer } from '../api/reserveringen.js';
import { genereerVoortgangsBalk, genereerKamerKaart } from './components.js';
import { toonMelding, ontsnapHTML, debounce } from '../utils/helpers.js';

// ============================================================================
// STATE BEHEER
// ============================================================================
let gebruiker = null;
let actieveReis = null;
let actieveHotelId = null;
let geladenKamers = [];
let actieveChannel = null; // Voor de WebSockets

let instellingen = {
    layoutType: 'grid', // 'grid' (blokjes) of 'list' (lijst)
    toonEnkelNietVol: false
};

// ============================================================================
// 1. INITIALISATIE
// ============================================================================

export async function initStudentUI() {
    // 1. Controleer of we ingelogd zijn
    gebruiker = getHuidigeGebruiker();
    if (!gebruiker) {
        window.location.href = 'index.html';
        return;
    }

    // Toon de naam bovenaan
    const naamWeergave = document.getElementById('gebruikerNaamDisplay');
    if (naamWeergave) naamWeergave.textContent = `${gebruiker.vnaam} ${gebruiker.naam}`;

    // 2. Koppel basis knoppen (Uitloggen, Filters)
    setupBasisEvents();

    try {
        // 3. Haal de actieve reis op voor deze school (we halen dit via URL of database)
        // Voor nu gaan we er vanuit dat er 1 actieve reis is per school
        const reizen = await getActieveReis('slug-komt-hier-of-via-sessie'); // Tip: Sla de reis-slug op bij inloggen!
        // (Om de flow simpel te houden, kunnen we ook gewoon getStudentVoortgang aanroepen
        // en die zoekt de reis zelf).

        // Laten we de voortgang direct ophalen, dit bepaalt alles!
        // We gaan ervan uit dat we het reisId in sessionStorage hebben opgeslagen tijdens login
        const opgeslagenReisId = sessionStorage.getItem('pedlet_actieve_reis_id'); 
        
        if (opgeslagenReisId) {
            await laadVoortgangEnHotel(parseInt(opgeslagenReisId));
        } else {
            toonMelding("Fout: Geen actieve reis gevonden. Log opnieuw in.", "error");
        }

    } catch (error) {
        console.error("Fout bij laden dashboard:", error);
    }
}

function setupBasisEvents() {
    const btnUitloggen = document.getElementById('btnUitloggen');
    if (btnUitloggen) btnUitloggen.addEventListener('click', logUit);

    // Filter knop (Volle kamers verbergen)
    const toggleNietVol = document.getElementById('toggleNietVol');
    if (toggleNietVol) {
        toggleNietVol.addEventListener('change', (e) => {
            instellingen.toonEnkelNietVol = e.target.checked;
            renderKamers(); // Herteken het scherm
        });
    }

    // Layout knoppen (Blokjes of Lijst)
    const btnGrid = document.getElementById('btnLayoutGrid');
    const btnList = document.getElementById('btnLayoutList');
    
    if (btnGrid) btnGrid.addEventListener('click', () => veranderLayout('grid'));
    if (btnList) btnList.addEventListener('click', () => veranderLayout('list'));
}

function veranderLayout(type) {
    instellingen.layoutType = type;
    
    // Visuele update van de knoppen zelf (actieve status tonen)
    document.getElementById('btnLayoutGrid')?.classList.toggle('bg-indigo-100', type === 'grid');
    document.getElementById('btnLayoutList')?.classList.toggle('bg-indigo-100', type === 'list');
    
    renderKamers();
}

// ============================================================================
// 2. DATA LADEN (Voortgang & Kamers)
// ============================================================================

async function laadVoortgangEnHotel(reisId) {
    try {
        // Bereken waar de leerling momenteel zit (uit reizen.js)
        const voortgang = await getStudentVoortgang(reisId, gebruiker.id);
        
        // Teken de balk bovenaan (uit components.js)
        const voortgangContainer = document.getElementById('voortgangsBalkContainer');
        if (voortgangContainer) {
            voortgangContainer.innerHTML = genereerVoortgangsBalk(voortgang);
        }

        if (voortgang.isKlaar) {
            toonSchermKlaar();
            return;
        }

        // Bepaal welk hotel we moeten laden
        if (voortgang.huidigActiefId) {
            actieveHotelId = voortgang.huidigActiefId;
            
            // Stel de standaard layout in op basis van het hotel (bijv. een bus is liever 'list')
            const huidigHotel = voortgang.lijst.find(h => h.id === actieveHotelId);
            if (huidigHotel && huidigHotel.layout_type) {
                instellingen.layoutType = huidigHotel.layout_type;
            }

            await laadKamersVoorActiefHotel();
        }

    } catch (error) {
        toonMelding("Kon je voortgang niet laden.", "error");
    }
}

async function laadKamersVoorActiefHotel() {
    try {
        document.getElementById('kamersLadenSpinner')?.classList.remove('hidden');
        
        // 1. Haal alle kamers op
        geladenKamers = await getKamers(actieveHotelId);
        
        // 2. Teken ze op het scherm
        renderKamers();

        document.getElementById('kamersLadenSpinner')?.classList.add('hidden');

        // 3. Start de real-time updates (WebSockets)
        // Eerst eventuele oude verbinding afsluiten
        unsubscribeFromUpdates(actieveChannel);
        
        const kamerIds = geladenKamers.map(k => k.id);
        actieveChannel = subscribeToKamerUpdates(actieveHotelId, kamerIds, handleLiveUpdate);

    } catch (error) {
        toonMelding(error.message, "error");
    }
}

// ============================================================================
// 3. SCHERM TEKENEN (Render)
// ============================================================================

function renderKamers() {
    const container = document.getElementById('kamersContainer');
    if (!container) return;

    container.innerHTML = ''; // Maak leeg

    // Toepassen van filters
    let gefilterdeKamers = geladenKamers;
    if (instellingen.toonEnkelNietVol) {
        gefilterdeKamers = gefilterdeKamers.filter(kamer => kamer.bezetting < kamer.capaciteit);
    }

    // Zet de CSS van de container goed (Grid vs List)
    if (instellingen.layoutType === 'grid') {
        container.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6';
    } else {
        container.className = 'flex flex-col space-y-2';
    }

    // Genereer HTML per kamer via components.js
    gefilterdeKamers.forEach(kamer => {
        container.innerHTML += genereerKamerKaart(kamer, instellingen.layoutType);
    });

    // Koppel de klik-events aan de nieuwe blokjes
    koppelKamerKlikEvents();
}

/**
 * DE OPLOSSING VOOR HET FLIKKEREN: Selective DOM Update
 * Wordt aangeroepen door WebSockets als er IETS verandert.
 */
async function handleLiveUpdate(gewijzigdKamerId) {
    // 1. Haal de nieuwe status van ALLE kamers stilletjes op
    const nieuweKamers = await getKamers(actieveHotelId);
    geladenKamers = nieuweKamers;

    // 2. Zoek de specifieke kamer die veranderd is
    const nieuweKamerData = nieuweKamers.find(k => k.id === gewijzigdKamerId);
    if (!nieuweKamerData) return;

    // 3. Zoek exact dát HTML blokje op het scherm
    const bestaandKaartje = document.querySelector(`.kamer-kaart[data-id="${gewijzigdKamerId}"]`);

    if (bestaandKaartje) {
        // Genereer nieuwe HTML voor enkel dit kaartje
        const nieuweHtml = genereerKamerKaart(nieuweKamerData, instellingen.layoutType);
        
        // Magische truc om de HTML te vervangen zonder de hele container te wissen
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = nieuweHtml;
        const nieuwElement = tempDiv.firstElementChild;
        
        bestaandKaartje.replaceWith(nieuwElement);
        
        // Koppel het klik-event opnieuw, want dit is een nieuw HTML element!
        koppelKamerKlikEvents();
    } else {
        // Als het kaartje er niet stond (bijv. verborgen door filter en nu wel weer beschikbaar),
        // dan hertekenen we voor de zekerheid toch alles.
        renderKamers();
    }
}

// ============================================================================
// 4. INTERACTIE (Kamer claimen)
// ============================================================================

function koppelKamerKlikEvents() {
    const kaartjes = document.querySelectorAll('.kamer-kaart');
    kaartjes.forEach(kaartje => {
        kaartje.addEventListener('click', async (e) => {
            const kamerId = parseInt(kaartje.getAttribute('data-id'));
            const isVol = kaartje.getAttribute('data-vol') === 'true';

            if (isVol) {
                toonMelding("Deze kamer is helaas al vol.", "error");
                return;
            }

            await startKamerClaim(kamerId);
        });
    });
}

async function startKamerClaim(kamerId) {
    try {
        // 1. Roep backend aan (pessimistic lock)
        const claimResult = await claimKamer(kamerId, gebruiker.id, actieveHotelId);
        
        if (claimResult.success) {
            // 2. Lock gelukt! Toon direct de modal om eventueel vrienden toe te voegen
            // of om definitief te bevestigen.
            toonBevestigingsModal(kamerId, claimResult.res_id);
        }
    } catch (error) {
        toonMelding(error.message, "error");
    }
}

// ============================================================================
// 5. MODAL & BEVESTIGEN (Vrienden toevoegen)
// ============================================================================

let gekozenVriendenIds = [];

function toonBevestigingsModal(kamerId, pendingResId) {
    // Vind de kamer details om te tonen in de modal
    const kamer = geladenKamers.find(k => k.id === kamerId);
    gekozenVriendenIds = []; // Reset lijst

    // Bereken vrije plaatsen (Capaciteit - Bezetting - Jijzelf)
    const vrijePlaatsen = kamer.capaciteit - kamer.bezetting - 1;

    // HTML voor de modal (die we dynamisch in de body injecteren voor veiligheid)
    const modalHtml = `
        <div id="claimModal" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-fade-in-up">
                <h2 class="text-2xl font-bold mb-2">Bevestig je keuze</h2>
                <p class="text-gray-600 mb-6">Je hebt een plaats gereserveerd in <strong>${ontsnapHTML(kamer.kamer_nr)}</strong>.</p>
                
                ${vrijePlaatsen > 0 ? `
                    <div class="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-100">
                        <label class="block text-sm font-bold text-blue-900 mb-2">
                            Wil je vrienden toevoegen? (Nog ${vrijePlaatsen} plaats(en))
                        </label>
                        <input type="text" id="vriendZoekBalk" class="w-full p-2 border rounded focus:ring focus:ring-blue-200" placeholder="Zoek op naam...">
                        <ul id="vriendZoekResultaten" class="mt-2 max-h-32 overflow-y-auto bg-white border rounded hidden"></ul>
                        
                        <div id="gekozenVriendenLijst" class="mt-3 flex flex-wrap gap-2"></div>
                    </div>
                ` : '<p class="text-green-600 font-bold mb-6">Jij neemt de laatste plaats in deze groep in!</p>'}

                <div class="flex justify-end gap-3">
                    <button id="btnAnnuleerClaim" class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-100 transition-colors">
                        Annuleren
                    </button>
                    <button id="btnDefinitiefBevestigen" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors font-bold flex items-center gap-2">
                        <i data-lucide="check" class="w-4 h-4"></i> Definitief Bevestigen
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    lucide.createIcons();

    // Event Listeners voor de Modal
    document.getElementById('btnAnnuleerClaim').addEventListener('click', async () => {
        document.getElementById('claimModal').remove();
        await annuleerReservering(gebruiker.id, kamerId);
        toonMelding("Selectie geannuleerd.", "info");
    });

    document.getElementById('btnDefinitiefBevestigen').addEventListener('click', async () => {
        try {
            const btn = document.getElementById('btnDefinitiefBevestigen');
            btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Bezig...';
            btn.disabled = true;

            await bevestigKamer(gebruiker.id, gekozenVriendenIds);
            
            document.getElementById('claimModal').remove();
            toonMelding("Plaats(en) succesvol bevestigd!", "success");
            
            // Herlaad de voortgang, misschien moet de leerling nu naar een volgende activiteit!
            const opgeslagenReisId = sessionStorage.getItem('pedlet_actieve_reis_id');
            await laadVoortgangEnHotel(parseInt(opgeslagenReisId));

        } catch (error) {
            toonMelding(error.message, "error");
            document.getElementById('btnDefinitiefBevestigen').innerHTML = 'Probeer opnieuw';
            document.getElementById('btnDefinitiefBevestigen').disabled = false;
        }
    });

    // Vrienden zoeklogica (met debounce om spammen te voorkomen)
    const zoekBalk = document.getElementById('vriendZoekBalk');
    if (zoekBalk) {
        zoekBalk.addEventListener('input', debounce(async (e) => {
            const term = e.target.value;
            const resultatenLijst = document.getElementById('vriendZoekResultaten');
            
            if (term.length < 2) {
                resultatenLijst.classList.add('hidden');
                return;
            }

            const personen = await zoekLeerlingVoorKamer(term, gebruiker.school_id);
            
            resultatenLijst.innerHTML = '';
            if (personen.length > 0) {
                resultatenLijst.classList.remove('hidden');
                personen.forEach(p => {
                    // Verberg onszelf en al gekozen vrienden
                    if (p.id !== gebruiker.id && !gekozenVriendenIds.includes(p.id)) {
                        const li = document.createElement('li');
                        li.className = 'p-2 border-b cursor-pointer hover:bg-indigo-50';
                        li.innerHTML = `${ontsnapHTML(p.vnaam)} ${ontsnapHTML(p.naam)} <span class="text-xs text-gray-500">(${ontsnapHTML(p.klas)})</span>`;
                        li.addEventListener('click', () => voegVriendToe(p, vrijePlaatsen));
                        resultatenLijst.appendChild(li);
                    }
                });
            } else {
                resultatenLijst.classList.remove('hidden');
                resultatenLijst.innerHTML = '<li class="p-2 text-gray-500 text-sm">Geen leerlingen gevonden.</li>';
            }
        }, 300));
    }
}

function voegVriendToe(persoon, maxPlaatsen) {
    if (gekozenVriendenIds.length >= maxPlaatsen) {
        toonMelding("Je kan niet meer personen toevoegen aan deze kamer.", "error");
        return;
    }

    gekozenVriendenIds.push(persoon.id);
    document.getElementById('vriendZoekResultaten').classList.add('hidden');
    document.getElementById('vriendZoekBalk').value = '';

    // Toon het gekozen vriendje als een 'tag'
    const tag = document.createElement('div');
    tag.className = 'bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full text-sm flex items-center gap-2';
    tag.innerHTML = `
        ${ontsnapHTML(persoon.vnaam)} ${ontsnapHTML(persoon.naam)}
        <button class="text-indigo-500 hover:text-indigo-700 font-bold ml-1" title="Verwijder">×</button>
    `;
    
    // Verwijder knopje op de tag
    tag.querySelector('button').addEventListener('click', () => {
        gekozenVriendenIds = gekozenVriendenIds.filter(id => id !== persoon.id);
        tag.remove();
    });

    document.getElementById('gekozenVriendenLijst').appendChild(tag);
}

// ============================================================================
// 6. KLAAR SCHERM
// ============================================================================

function toonSchermKlaar() {
    const container = document.getElementById('hoofdInhoudStudent');
    if (!container) return;

    container.innerHTML = `
        <div class="text-center py-20 animate-fade-in-up">
            <div class="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-green-100 mb-6">
                <i data-lucide="check-circle" class="h-12 w-12 text-green-600"></i>
            </div>
            <h2 class="text-3xl font-extrabold text-gray-900 mb-4">Je bent helemaal klaar!</h2>
            <p class="text-lg text-gray-600 max-w-xl mx-auto">
                Je hebt voor alle onderdelen van deze reis succesvol een keuze gemaakt. 
                Je kunt deze pagina nu sluiten. We wensen je een fantastische tijd!
            </p>
        </div>
    `;
    lucide.createIcons();
}

// Start de interface zodra het bestand laadt in verdeling.html
document.addEventListener('DOMContentLoaded', initStudentUI);