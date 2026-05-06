/**
 * ============================================================================
 * PEDLET - UI Components (HTML Generatoren)
 * ============================================================================
 * Dit bestand bevat functies die pure data (zoals een kamer-object) 
 * omzetten naar mooie, herbruikbare stukken HTML met Tailwind CSS.
 * Dit houdt de rest van de code schoon en overzichtelijk.
 */

import { ontsnapHTML } from '../utils/helpers.js';

// ============================================================================
// 1. VOORTGANGSBALK (Navigatie & Overzicht)
// ============================================================================

/**
 * Genereert de HTML voor de stappen/voortgangsbalk bovenaan het scherm.
 * Toont visueel in welk hotel men al zit, en wat de volgende stap is.
 * @param {Object} voortgang - Het object uit reizen.js (getStudentVoortgang)
 * @returns {string} HTML string
 */
export function genereerVoortgangsBalk(voortgang) {
    if (!voortgang || !voortgang.lijst || voortgang.lijst.length === 0) {
        return '';
    }

    let stappenHtml = voortgang.lijst.map((stap, index) => {
        let statusKleur = 'text-gray-400';
        let icoon = '<i data-lucide="circle" class="w-5 h-5"></i>';
        let bgKleur = 'bg-white border-gray-200';

        if (stap.is_voltooid) {
            statusKleur = 'text-green-600';
            icoon = '<i data-lucide="check-circle-2" class="w-6 h-6"></i>';
            bgKleur = 'bg-green-50 border-green-200';
        } else if (stap.is_huidig) {
            statusKleur = 'text-indigo-600 font-bold';
            icoon = '<i data-lucide="clock" class="w-6 h-6 animate-pulse"></i>';
            bgKleur = 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-500 ring-opacity-50';
        }

        const typeLabel = stap.type_bestemming === 'hotel' ? '🏨' : '🎯';

        return `
            <div class="flex-1 min-w-[120px] p-3 border rounded-lg flex flex-col items-center justify-center text-center transition-all ${bgKleur}">
                <div class="${statusKleur} mb-1 flex justify-center w-full">
                    ${icoon}
                </div>
                <span class="text-xs uppercase tracking-wider text-gray-500 mb-1">${typeLabel} Stap ${index + 1}</span>
                <span class="text-sm ${statusKleur} truncate w-full" title="${ontsnapHTML(stap.naam)}">
                    ${ontsnapHTML(stap.naam)}
                </span>
            </div>
        `;
    }).join('');

    return `
        <div class="flex items-center gap-4 overflow-x-auto pb-4 hide-scrollbar">
            ${stappenHtml}
        </div>
    `;
}

// ============================================================================
// 2. KAMER / ACTIVITEIT KAARTJES (Blokjes of Lijst view)
// ============================================================================

/**
 * Genereert de HTML voor 1 kamer/plaats. Wisselt automatisch tussen een
 * 'grid' (blokje) of 'list' (rij) weergave afhankelijk van de instelling.
 * @param {Object} kamer - Het kamer object uit de database
 * @param {string} layoutType - 'grid' of 'list'
 * @returns {string} HTML string
 */
export function genereerKamerKaart(kamer, layoutType = 'grid') {
    const isVol = kamer.is_vol;
    const capaciteitTekst = `${kamer.bezetting} / ${kamer.capaciteit}`;
    
    // Bepaal de kleuren op basis van de status
    let randKleur = isVol ? 'border-red-200' : 'border-gray-200 hover:border-indigo-400';
    let achtergrondKleur = isVol ? 'bg-red-50' : (kamer.in_behandeling ? 'bg-orange-50' : 'bg-white');
    let tekstKleur = isVol ? 'text-red-600' : 'text-green-600';
    let cursor = isVol ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:shadow-md transform hover:-translate-y-1 transition-all duration-200';

    // Voeg een slotje toe als iemand anders momenteel deze kamer bekijkt
    const slotjeHtml = kamer.in_behandeling && !isVol 
        ? `<div class="absolute -top-2 -right-2 bg-orange-500 text-white p-1 rounded-full shadow" title="Iemand is deze kamer aan het claimen"><i data-lucide="lock" class="w-4 h-4"></i></div>` 
        : '';

    // ==========================================
    // OPTIE A: BLOKJES WEERGAVE (Grid)
    // ==========================================
    if (layoutType === 'grid') {
        return `
            <div class="relative border-2 rounded-xl p-5 ${achtergrondKleur} ${randKleur} ${cursor} kamer-kaart" data-id="${kamer.id}" data-vol="${isVol}">
                ${slotjeHtml}
                <div class="flex justify-between items-start mb-4">
                    <h3 class="text-xl font-extrabold text-gray-800">${ontsnapHTML(kamer.kamer_nr)}</h3>
                    <div class="flex flex-col items-end">
                        <span class="text-sm font-bold bg-white px-2 py-1 rounded shadow-sm border ${tekstKleur}">
                            ${capaciteitTekst} <i data-lucide="users" class="inline w-4 h-4 ml-1"></i>
                        </span>
                        ${kamer.geslacht ? `<span class="text-xs text-gray-500 mt-1 uppercase">${ontsnapHTML(kamer.geslacht)}</span>` : ''}
                    </div>
                </div>
                
                <!-- Weergave van de bezette plaatsen (Avatars) -->
                <div class="flex flex-wrap gap-2 mt-4">
                    ${genereerBezettingAvatars(kamer.capaciteit, kamer.reserveringen)}
                </div>
            </div>
        `;
    } 
    
    // ==========================================
    // OPTIE B: LIJST WEERGAVE (List)
    // ==========================================
    else {
        return `
            <div class="relative flex items-center justify-between border-2 rounded-lg p-3 mb-2 ${achtergrondKleur} ${randKleur} ${cursor} kamer-kaart" data-id="${kamer.id}" data-vol="${isVol}">
                ${slotjeHtml}
                <div class="flex items-center gap-4 w-1/3">
                    <h3 class="text-lg font-bold text-gray-800 w-24">${ontsnapHTML(kamer.kamer_nr)}</h3>
                    ${kamer.geslacht ? `<span class="text-xs text-gray-500 uppercase border px-2 py-1 rounded">${ontsnapHTML(kamer.geslacht)}</span>` : ''}
                </div>
                
                <div class="flex items-center gap-1 flex-grow justify-center">
                    ${genereerBezettingAvatars(kamer.capaciteit, kamer.reserveringen, true)}
                </div>

                <div class="w-1/4 text-right">
                    <span class="text-sm font-bold bg-white px-3 py-2 rounded-full shadow-sm border ${tekstKleur}">
                        ${capaciteitTekst}
                    </span>
                </div>
            </div>
        `;
    }
}

// ============================================================================
// 3. HELPER: AVATARS GENEREREN
// ============================================================================

/**
 * Genereert de visuele "poppetjes" of lege vakjes voor in een kamerkaart.
 * @param {number} capaciteit - Totaal aantal plaatsen
 * @param {Array} reserveringen - De huidige reserveringen (voor de ID's/Namen)
 * @param {boolean} isKlein - Of de avatars kleiner getoond moeten worden (voor lijstweergave)
 * @returns {string} HTML string
 */
function genereerBezettingAvatars(capaciteit, reserveringen = [], isKlein = false) {
    const sizeClasses = isKlein ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';
    let html = '';
    
    const bevestigdeReserveringen = reserveringen.filter(r => r.status === 'confirmed');

    for (let i = 0; i < capaciteit; i++) {
        const reservering = bevestigdeReserveringen[i];
        
        if (reservering) {
            // Bezet: Toon een gekleurd poppetje (of de initialen als we die gejoined hebben)
            html += `
                <div class="${sizeClasses} rounded-full bg-indigo-100 border border-indigo-300 flex items-center justify-center text-indigo-700" title="Bezet door leerling ${reservering.persoon_id}">
                    <i data-lucide="user" class="${isKlein ? 'w-3 h-3' : 'w-4 h-4'}"></i>
                </div>
            `;
        } else {
            // Vrij: Toon een leeg, gestippeld vakje
            html += `
                <div class="${sizeClasses} rounded-full bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                    <!-- Leeg -->
                </div>
            `;
        }
    }
    
    return html;
}