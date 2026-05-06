<?php
/**
 * ============================================================================
 * PEDLET - Smartschool OAuth2 Login Handler
 * ============================================================================
 * Dit script handelt de "Authorization Code Grant" flow af met Smartschool.
 * Het haalt de gebruikergegevens op, lost codering-problemen (zoals "CLoë") op,
 * en stuurt de verwerkte data veilig terug naar de frontend.
 */

session_start();

// ============================================================================
// CONFIGURATIE (Vul hier jouw eigen Smartschool gegevens in)
// ============================================================================
$ss_platform_url = "https://jouwschool.smartschool.be"; // Bv. https://ursula.smartschool.be
$client_id       = "JOUW_SMARTSCHOOL_CLIENT_ID";
$client_secret   = "JOUW_SMARTSCHOOL_CLIENT_SECRET";
$redirect_uri    = "https://jouwdomein.be/backend/loginSS.php"; // Exacte URL naar dit bestand
$frontend_url    = "../login.html"; // Waar de gebruiker naartoe moet na inloggen

// ============================================================================
// HELPER FUNCTIES
// ============================================================================

/**
 * Zorgt ervoor dat alle tekst strikt UTF-8 is (Fix voor de "CLoë" bug).
 */
function forceerUTF8($tekst) {
    if (empty($tekst)) return "";
    // Detecteer de huidige codering en forceer naar UTF-8
    $huidige_codering = mb_detect_encoding($tekst, 'UTF-8, ISO-8859-1, Windows-1252', true);
    if ($huidige_codering !== 'UTF-8') {
        return mb_convert_encoding($tekst, 'UTF-8', $huidige_codering ?: 'auto');
    }
    return $tekst;
}

/**
 * Voert veilige cURL (HTTP) verzoeken uit naar Smartschool.
 */
function voerApiVerzoekUit($url, $post_data = null, $headers = []) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true); // Veiligheid: controleer SSL
    curl_setopt($ch, CURLOPT_TIMEOUT, 15); // Max 15 seconden wachten

    if ($post_data !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post_data));
    }
    if (!empty($headers)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($error || $http_code >= 400) {
        throw new Exception("API Verzoek mislukt (Code: $http_code): $error");
    }

    return json_decode($response, true);
}

// ============================================================================
// HOOFD LOGICA
// ============================================================================

try {
    // STAP 1: Controleer of we een error kregen van Smartschool
    if (isset($_GET['error'])) {
        throw new Exception("Toegang geweigerd door gebruiker of Smartschool: " . htmlspecialchars($_GET['error']));
    }

    // STAP 2: Start de login flow als we geen 'code' hebben
    if (!isset($_GET['code'])) {
        // Genereer CSRF token
        $_SESSION['oauth_state'] = bin2hex(random_bytes(16));
        
        $auth_url = $ss_platform_url . "/oauth/authorize?" . http_build_query([
            'client_id'     => $client_id,
            'response_type' => 'code',
            'redirect_uri'  => $redirect_uri,
            'scope'         => 'userinfo', // Vraag toegang tot profiel data
            'state'         => $_SESSION['oauth_state']
        ]);
        
        header("Location: " . $auth_url);
        exit;
    }

    // STAP 3: Valideer de state (CSRF beveiliging)
    if (!isset($_GET['state']) || $_GET['state'] !== $_SESSION['oauth_state']) {
        throw new Exception("Veiligheidsfout: Ongeldige state token.");
    }

    // STAP 4: Wissel de 'code' in voor een 'access_token'
    $token_url = $ss_platform_url . "/oauth/token";
    $token_data = voerApiVerzoekUit($token_url, [
        'grant_type'    => 'authorization_code',
        'client_id'     => $client_id,
        'client_secret' => $client_secret,
        'code'          => $_GET['code'],
        'redirect_uri'  => $redirect_uri
    ]);

    if (!isset($token_data['access_token'])) {
        throw new Exception("Fout bij ophalen van access token.");
    }
    $access_token = $token_data['access_token'];

    // STAP 5: Haal de gebruikersgegevens op met de access_token
    $userinfo_url = $ss_platform_url . "/api/v1/userinfo";
    $user_data = voerApiVerzoekUit($userinfo_url, null, [
        "Authorization: Bearer " . $access_token
    ]);

    // ========================================================================
    // DATA VERWERKING (Extractie en UTF-8 correctie)
    // ========================================================================
    
    // Bepaal de rol (Leerkracht of Leerling) en klas
    $rol = 'LEERLING';
    $klas = '';
    
    // Smartschool geeft groepen/roles vaak in een array of basis string mee
    // We formatteren dit robuust (Pas dit aan afhankelijk van de specifieke output van jullie school)
    if (isset($user_data['role']) && stripos($user_data['role'], 'leerkracht') !== false || 
        isset($user_data['isTeacher']) && $user_data['isTeacher'] == true) {
        $rol = 'LEERKRACHT';
    } else {
        // Als het een leerling is, haal de klas op (vaak de hoofdgroep of een specifiek veld)
        if (isset($user_data['group'])) {
            $klas = forceerUTF8($user_data['group']);
        } elseif (isset($user_data['groups']) && count($user_data['groups']) > 0) {
            $klas = forceerUTF8($user_data['groups'][0]['name']); // Eerste groep is meestal de klas
        }
    }

    // Bouw de propere dataset op om naar de frontend te sturen
    $propere_data = [
        'ss_id'    => $user_data['uuid'] ?? $user_data['id'],
        'school'   => parse_url($ss_platform_url, PHP_URL_HOST), // Bv. 'ursula.smartschool.be'
        'voornaam' => forceerUTF8($user_data['given_name'] ?? $user_data['first_name'] ?? ''),
        'naam'     => forceerUTF8($user_data['family_name'] ?? $user_data['last_name'] ?? ''),
        'rol'      => $rol,
        'klas'     => $rol === 'LEERKRACHT' ? '' : $klas,
        'geslacht' => forceerUTF8($user_data['gender'] ?? '') // Optioneel, vaak 'M' of 'V'
    ];

    // ========================================================================
    // REDIRECT NAAR FRONTEND
    // ========================================================================
    // We verpakken de data in een veilige Base64 JSON string in de URL, 
    // zodat jouw nieuwe Javascript (auth.js) de data in Supabase kan steken.
    $payload = base64_encode(json_encode([
        'status' => 'success',
        'data'   => $propere_data
    ]));

    header("Location: " . $frontend_url . "?auth_payload=" . urlencode($payload));
    exit;

} catch (Exception $e) {
    // Bij een fout: Stuur de gebruiker terug met een duidelijke foutmelding
    $fout_bericht = $e->getMessage();
    
    // Log de fout lokaal (voor de developer)
    error_log("[Pedlet OAuth Error] " . $fout_bericht);

    $payload = base64_encode(json_encode([
        'status'  => 'error',
        'message' => forceerUTF8($fout_bericht)
    ]));

    header("Location: " . $frontend_url . "?auth_payload=" . urlencode($payload));
    exit;
}