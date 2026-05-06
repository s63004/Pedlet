/**
 * ============================================================================
 * PEDLET - Admin UI (Visuele logica voor leerkrachten)
 * ============================================================================
 * Dit bestand regelt de weergave van het dashboard, de drag-and-drop acties,
 * de geavanceerde filters en de Excel-exports.
 */

import { 
    getReizenAdmin, 
    getBestemmingenAdmin, 
    getKamersMetBezetting, 
    getPersonenUitgebreid,
    forceerKamerToewijzing,
    resetReisInschrijvingen
} from '../api/adminData.js';

import { formatteerDatumKort, toonMelding, ontsnapHTML } from '../utils/helpers.js';

// ============================================================================
// STATE BEHEER (Houdt bij wat de leerkracht momenteel aan het bekijken is)
// ============================================================================
let actieveSchoolId = null;
let actieveReisId = null;
let actieveHotelId = null;
let geladenKamers = [];
let actieveFilters = {
    toonEnkelNietVol: false,
    zoekTerm: ''
};

// ============================================================================
// 1. INITIALISATIE
// ============================================================================

export async function initAdminUI() {
    // 1. Haal de ingelogde leerkracht op uit de sessie
    const userString = sessionStorage.getItem('pedlet_user');
    if (!userString) {
        window.location.href = 'login.html';
        return;
    }
    const user = JSON.parse(userString);
    if (user.rol !== 'LEERKRACHT') {
        alert("Geen toegang. Dit is alleen voor leerkrachten.");
        window.location.href = 'verdeling.html';
        return;
    }
    
    actieveSchoolId = user.school_id;

    // 2. Koppel alle knoppen en filters aan events
    setupEventListeners();

    // 3. Laad de initiële data (Reizen)
    await laadReizenDropdown();
}

function setupEventListeners() {
    // Filter: Toon enkel onvolledige kamers
    const filterToggle = document.getElementById('filterNietVolToggle');
    if (filterToggle) {
        filterToggle.addEventListener('change', (e) => {
            actieveFilters.toonEnkelNietVol = e.target.checked;
            renderKamers(); // Teken de kamers opnieuw met de nieuwe filter
        });
    }

    // Gevaarlijke actie: Reset Reis
    const btnReset = document.getElementById('btnResetReis');
    if (btnReset) {
        btnReset.addEventListener('click', handleResetReis);
    }

    // Export actie: Excel
    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) {
        btnExport.addEventListener('click', handleExportExcel);
    }
}

// ============================================================================
// 2. DATA LADEN & WEERGEVEN (RENDER FUNCTIES)
// ============================================================================

async function laadReizenDropdown() {
    try {
        const reizen = await getReizenAdmin(actieveSchoolId);
        const select = document.getElementById('reisSelectie');
        if (!select) return;

        select.innerHTML = '<option value="">-- Kies een activiteit/reis --</option>';
        reizen.forEach(reis => {
            select.innerHTML += `<option value="${reis.id}">${ontsnapHTML(reis.naam)} (${formatteerDatumKort(reis.datum_start)})</option>`;
        });

        // Als een reis gekozen wordt, laad de bijbehorende hotels/onderdelen
        select.addEventListener('change', async (e) => {
            actieveReisId = e.target.value;
            if (actieveReisId) {
                await laadHotelsDropdown(actieveReisId);
            }
        });
    } catch (error) {
        toonMelding(error.message, 'error');
    }
}

async function laadHotelsDropdown(reisId) {
    try {
        const hotels = await getBestemmingenAdmin(reisId);
        const select = document.getElementById('hotelSelectie');
        if (!select) return;

        select.innerHTML = '<option value="">-- Kies een onderdeel --</option>';
        hotels.forEach(hotel => {
            // Duidelijk tonen of het een hotel of iets anders is
            const typeLabel = hotel.type_bestemming === 'hotel' ? '🏨 Hotel' : '🎯 Activiteit';
            select.innerHTML += `<option value="${hotel.id}">${typeLabel} - ${ontsnapHTML(hotel.naam)}</option>`;
        });

        select.addEventListener('change', async (e) => {
            actieveHotelId = e.target.value;
            if (actieveHotelId) {
                await laadKamers(actieveHotelId);
            }
        });
    } catch (error) {
        toonMelding("Fout bij laden onderdelen", 'error');
    }
}

async function laadKamers(hotelId) {
    try {
        geladenKamers = await getKamersMetBezetting(hotelId);
        renderKamers();
    } catch (error) {
        toonMelding("Fout bij laden van de indeling.", 'error');
    }
}

function renderKamers() {
    const container = document.getElementById('kamersContainerAdmin');
    if (!container) return;

    container.innerHTML = ''; // Maak leeg

    let gefilterdeKamers = geladenKamers;

    // TOEPASSEN VAN FILTERS: "Kamers niet vol"
    if (actieveFilters.toonEnkelNietVol) {
        gefilterdeKamers = gefilterdeKamers.filter(kamer => kamer.bezetting < kamer.capaciteit);
    }

    if (gefilterdeKamers.length === 0) {
        container.innerHTML = '<p class="text-gray-500 italic p-4">Geen kamers gevonden die aan de filters voldoen.</p>';
        return;
    }

    gefilterdeKamers.forEach(kamer => {
        // Capaciteit visueel veel overzichtelijker maken
        const isVol = kamer.bezetting >= kamer.capaciteit;
        const statusKleur = isVol ? 'bg-red-100 border-red-300' : 'bg-green-50 border-green-300';
        
        // Bouw het kamer kaartje
        const kamerDiv = document.createElement('div');
        kamerDiv.className = `border rounded-lg shadow-sm p-4 ${statusKleur} flex flex-col`;
        
        kamerDiv.innerHTML = `
            <div class="flex justify-between items-center mb-4 border-b pb-2">
                <h3 class="font-bold text-lg">${ontsnapHTML(kamer.kamer_nr)}</h3>
                <span class="text-sm font-medium ${isVol ? 'text-red-600' : 'text-green-600'}">
                    ${kamer.bezetting} / ${kamer.capaciteit} plaatsen
                </span>
            </div>
            <!-- Hier komen de leerlingen in (Wordt een Sortable lijst) -->
            <ul class="flex-grow min-h-[50px] space-y-2 sortable-list" data-kamer-id="${kamer.id}">
                ${genereerLeerlingLijst(kamer.reservering)}
            </ul>
        `;
        
        container.appendChild(kamerDiv);
    });

    // Activeer Drag & Drop voor leerkrachten (Vereist SortableJS in de HTML)
    activeerDragAndDrop();
}

function genereerLeerlingLijst(reserveringen) {
    if (!reserveringen || reserveringen.length === 0) return '';
    
    // We tonen enkel bevestigde reserveringen in dit admin overzicht
    return reserveringen
        .filter(r => r.status === 'confirmed')
        .map(r => `
            <li class="bg-white p-2 rounded border border-gray-200 shadow-sm cursor-grab flex justify-between items-center" data-persoon-id="${r.persoon_id}">
                <span class="text-sm">👤 ID: ${r.persoon_id}</span> <!-- Je kan hier later de echte naam joinen -->
            </li>
        `).join('');
}

// ============================================================================
// 3. DRAG & DROP LOGICA (Leerlingen verplaatsen)
// ============================================================================

function activeerDragAndDrop() {
    // Check of de externe library Sortable is geladen
    if (typeof Sortable === 'undefined') {
        console.warn("SortableJS is niet geladen. Drag & drop is uitgeschakeld.");
        return;
    }

    const lijsten = document.querySelectorAll('.sortable-list');
    lijsten.forEach(lijst => {
        new Sortable(lijst, {
            group: 'kamers', // Laat toe om tussen verschillende kamers te slepen
            animation: 150,
            ghostClass: 'bg-blue-100', // Kleur tijdens het slepen
            onEnd: async function (evt) {
                const itemEl = evt.item; // Het HTML element dat gesleept is
                const persoonId = itemEl.getAttribute('data-persoon-id');
                const nieuweKamerId = evt.to.getAttribute('data-kamer-id');
                
                // Als het in dezelfde kamer is gebleven, doe niets
                if (evt.from === evt.to) return;

                try {
                    // Update in de database via onze backend functie
                    await forceerKamerToewijzing(persoonId, nieuweKamerId);
                    toonMelding("Leerling succesvol verplaatst!", "success");
                    
                    // Herlaad de data om de capaciteit overal correct aan te passen
                    await laadKamers(actieveHotelId);
                } catch (error) {
                    toonMelding("Kon leerling niet verplaatsen: " + error.message, "error");
                    // Zet de UI terug naar hoe het was als het faalt
                    await laadKamers(actieveHotelId); 
                }
            },
        });
    });
}

// ============================================================================
// 4. MASSA ACTIES & EXPORT
// ============================================================================

async function handleResetReis() {
    if (!actieveReisId) {
        toonMelding("Selecteer eerst een reis om te resetten.", "error");
        return;
    }

    const select = document.getElementById('reisSelectie');
    const reisNaam = select.options[select.selectedIndex].text;

    // HARDE BEVESTIGING (Veiligheid)
    const bevestiging = prompt(`GEVAARLIJKE ACTIE!\nJe staat op het punt om ALLE inschrijvingen voor '${reisNaam}' te wissen voor een volgend jaar. De kamers zelf blijven bestaan.\n\nTyp 'VERWIJDER' om te bevestigen:`);
    
    if (bevestiging === 'VERWIJDER') {
        try {
            await resetReisInschrijvingen(actieveReisId);
            toonMelding("Alle inschrijvingen zijn succesvol gewist.", "success");
            // Herlaad het scherm
            if (actieveHotelId) await laadKamers(actieveHotelId);
        } catch (error) {
            toonMelding(error.message, "error");
        }
    } else {
        toonMelding("Reset geannuleerd.", "info");
    }
}

async function handleExportExcel() {
    if (!actieveSchoolId) return;

    try {
        toonMelding("Excel bestand wordt gegenereerd...", "info");
        
        // Haal de uitgebreide lijst op (wie in welk hotel/kamer zit)
        const personen = await getPersonenUitgebreid(actieveSchoolId);
        
        // ==============================================================
        // Hier zou je met ExcelJS (externe library) een bestand bouwen.
        // Omdat de focus op de data ligt, toon ik hoe we jouw specifieke
        // Pedlet filters (missende leerlingen, vrije plaatsen) berekenen:
        // ==============================================================

        let totaalLeerlingen = personen.length;
        let aantalZonderKamer = personen.filter(p => !p.reservering || p.reservering.length === 0).length;
        
        // Deze data kun je dan in rij 1, 2 en 3 van je Excel zetten ter overzicht!
        console.log("EXCEL STATS:", {
            "Totaal leerlingen": totaalLeerlingen,
            "Leerlingen zonder kamer": aantalZonderKamer
        });

        toonMelding("Export succesvol! (Statistieken in console)", "success");

    } catch (error) {
        toonMelding("Fout bij genereren Excel: " + error.message, "error");
    }
}

// Start de interface zodra het script laadt
document.addEventListener('DOMContentLoaded', initAdminUI);