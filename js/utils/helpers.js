/**
 * ============================================================================
 * PEDLET - Helper Functies (Gereedschapskist)
 * ============================================================================
 * Dit bestand bevat kleine, herbruikbare functies die in de hele applicatie
 * gebruikt worden. Ze helpen bij het mooi tonen van datums, het beveiligen
 * van tekst en het tonen van meldingen aan de gebruiker.
 */

// ============================================================================
// 1. DATUM & TIJD FORMATTERING
// ============================================================================

/**
 * Zet een database datumstring om naar een leesbare Belgische datum en tijd.
 * Bijv: "6 mei 2026 om 14:30"
 * @param {string} datumString - De ISO datum uit de database
 * @returns {string} Geformatteerde datum
 */
export function formatteerDatumTijd(datumString) {
    if (!datumString) return "Geen datum";
    const datum = new Date(datumString);
    return datum.toLocaleDateString('nl-BE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) + ' uur';
}

/**
 * Zet een database datumstring om naar enkel de datum (zonder tijd).
 * Bijv: "06/05/2026"
 * @param {string} datumString - De ISO datum uit de database
 * @returns {string} Geformatteerde korte datum
 */
export function formatteerDatumKort(datumString) {
    if (!datumString) return "";
    const datum = new Date(datumString);
    return datum.toLocaleDateString('nl-BE');
}

// ============================================================================
// 2. GEBRUIKERSMELDINGEN (Toasts / Alerts)
// ============================================================================

/**
 * Toont een tijdelijke visuele melding (toast) op het scherm.
 * Veel professioneler dan een standaard window.alert().
 * @param {string} bericht - De tekst die je wilt tonen
 * @param {string} type - 'success', 'error', of 'info' (bepaalt de kleur)
 */
export function toonMelding(bericht, type = 'info') {
    // Maak een nieuw div element aan
    const meldingDiv = document.createElement('div');
    
    // Voeg basis CSS klassen toe (we gaan er vanuit dat je Tailwind of vergelijkbaar gebruikt)
    meldingDiv.className = `fixed bottom-5 right-5 p-4 rounded shadow-lg text-white z-50 transition-opacity duration-300 transform translate-y-0`;
    
    // Kleur bepalen op basis van het type
    if (type === 'success') meldingDiv.classList.add('bg-green-500');
    else if (type === 'error') meldingDiv.classList.add('bg-red-500');
    else meldingDiv.classList.add('bg-blue-500'); // info
    
    meldingDiv.textContent = bericht;
    
    // Voeg toe aan de pagina
    document.body.appendChild(meldingDiv);
    
    // Verwijder de melding automatisch na 3.5 seconden
    setTimeout(() => {
        meldingDiv.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => meldingDiv.remove(), 300); // Wacht op de CSS fade out
    }, 3500);
}

// ============================================================================
// 3. VEILIGHEID & DATA SCHOONMAKEN
// ============================================================================

/**
 * Beveiligt tekst tegen XSS (Cross-Site Scripting) aanvallen.
 * Gebruik dit ALTIJD als je namen of tekst van gebruikers direct in HTML plakt.
 * @param {string} onveiligeTekst - Tekst direct uit de database of input
 * @returns {string} Veilige tekst waarbij HTML tags onschadelijk zijn gemaakt
 */
export function ontsnapHTML(onveiligeTekst) {
    if (!onveiligeTekst) return "";
    const div = document.createElement('div');
    div.textContent = onveiligeTekst;
    return div.innerHTML;
}

// ============================================================================
// 4. PRESTATIES (Optimalisatie)
// ============================================================================

/**
 * Vertraagt de uitvoering van een functie totdat er [delay] milliseconden 
 * verstreken zijn sinds de laatste aanroep. 
 * PERFECT voor de zoekbalk: voorkomt dat we bij elke letter die je typt 
 * de database bestoken met verzoeken.
 * @param {Function} func - De functie die je wilt vertragen
 * @param {number} delay - Wachttijd in milliseconden
 * @returns {Function}
 */
export function debounce(func, delay = 300) {
    let timeoutId;
    return function (...args) {
        // Wis de vorige timer
        clearTimeout(timeoutId);
        // Start een nieuwe timer
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}