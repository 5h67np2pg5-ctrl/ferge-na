const state = {
  position: null,
  selectedTerminalId: null,
  travelMode: "vehicle",
  language: localStorage.getItem("ferge-na-language") || "no",
  destination: null,
  destinationSearchTimer: null,
  routes: [],
  map: {
    points: [],
    path: [],
    zoom: 13,
    watchId: null,
    selectedRouteId: null,
    lastPathOrigin: null,
    routeUpdateInFlight: false,
    followVehicle: true
  }
};

const APP_VERSION = "v43";
const API_BASE =
  window.location.hostname === "localhost" && window.location.port === "3000"
    ? "http://localhost:3002"
    : "";

const TRANSLATIONS = {
  no: {
    appName: "Fergetider",
    usePosition: "Bruk min posisjon",
    locating: "Henter posisjon",
    positionActive: "Posisjon aktiv",
    refresh: "Oppdater",
    updating: "Oppdaterer",
    finalDestination: "Endelig destinasjon",
    destinationPlaceholder: "Skriv sted, adresse eller kai",
    nextFerry: "Neste ferge",
    normalDrive: "Normal kjøretid",
    quayWait: "Ventetid ved kai",
    showMap: "Vis kart",
    closeMap: "Lukk kart",
    crossing: "Overfart",
    onwardFromQuay: "Videre fra kai",
    toDestination: "Til destinasjon",
    routeListDestination: "Aktuelle samband",
    routeListNearest: "5 nærmeste samband",
    noRoutes: "Ingen fergestrekninger funnet for posisjon og reisemåte.",
    noDestinationFerry: "Fant ingen ferge på beregnet korteste rute til destinasjonen.",
    noCurrentFerry: "Ingen aktuell ferge",
    noDepartureQuay: "Ingen aktuell avgangskai",
    changeDestinationPosition: "Endre destinasjon eller posisjon.",
    chooseRoute: "Velg samband",
    chooseFerryRoute: "Velg fergestrekning",
    selectRouteInstruction: "Trykk på ønsket samband i listen for å hente neste avgang, kjøretid og overfart.",
    findNearest: "Finn nærmeste fergesamband",
    sharePosition: "Del posisjon for å se aktuell avreiseside og om du rekker avgangen.",
    routesFetched: "Ruter hentet",
    decisionUnavailable: "Kunne ikke hente neste avgang akkurat nå, men sambandslisten er oppdatert.",
    sourceUnknown: "Ukjent",
    enturUnavailable: "Entur utilgjengelig",
    fetchError: "Kunne ikke hente autoritative fergestrekninger akkurat nå.",
    loadingRoutes: "Henter fergestrekninger...",
    selected: "Valgt",
    select: "Velg",
    carFerry: "bilferge",
    fastBoat: "hurtigbåt",
    toDepartureQuay: "km til avgangskai",
    toQuay: "km til kai",
    onwardFrom: "videre fra",
    totalRoute: "km total rute",
    ferryOrdinal: (index) => `${index + 1} ferge`,
    routeToDestination: (from, to) => `${from} til ${to}`,
    routeToQuay: (from) => `Til ${from} ferjekai`,
    loadingRoad: "Henter vei...",
    vehicle: "Kjøretøy",
    arrival: "Ankomst",
    destination: "Destinasjon",
    routeSummary: (drive, crossing, onward, total) => `Til destinasjon: ${drive} til kai + ${crossing} overfart + ${onward} videre = ${total}.`,
    noGeolocationDemo: "Nettleseren støtter ikke posisjon. Viser demo.",
    locationFailedDemo: "Fikk ikke posisjon. Viser demo ved Halhjem.",
    demoActive: "Demo er aktiv. Del posisjon for nøyaktig beregning.",
    statusHigh: "Rekker trolig",
    statusMedium: "Mulig, liten margin",
    statusLow: "Usikkert",
    minute: "min",
    hour: "t"
  },
  en: {
    appName: "Ferry Times",
    usePosition: "Use my location",
    locating: "Getting location",
    positionActive: "Location active",
    refresh: "Refresh",
    updating: "Updating",
    finalDestination: "Final destination",
    destinationPlaceholder: "Type place, address or quay",
    nextFerry: "Next ferry",
    normalDrive: "Normal drive time",
    quayWait: "Wait at quay",
    showMap: "Show map",
    closeMap: "Close map",
    crossing: "Crossing",
    onwardFromQuay: "After quay",
    toDestination: "To destination",
    routeListDestination: "Relevant routes",
    routeListNearest: "5 nearest routes",
    noRoutes: "No ferry routes found for position and travel mode.",
    noDestinationFerry: "No ferry found on the calculated shortest route to the destination.",
    noCurrentFerry: "No current ferry",
    noDepartureQuay: "No current departure quay",
    changeDestinationPosition: "Change destination or position.",
    chooseRoute: "Choose route",
    chooseFerryRoute: "Choose ferry route",
    selectRouteInstruction: "Tap a route in the list to fetch next departure, drive time and crossing.",
    findNearest: "Find nearest ferry route",
    sharePosition: "Share location to see the right departure side and whether you can make it.",
    routesFetched: "Routes fetched",
    decisionUnavailable: "Could not fetch next departure right now, but the route list is updated.",
    sourceUnknown: "Unknown",
    enturUnavailable: "Entur unavailable",
    fetchError: "Could not fetch authoritative ferry routes right now.",
    loadingRoutes: "Fetching ferry routes...",
    selected: "Selected",
    select: "Select",
    carFerry: "car ferry",
    fastBoat: "express boat",
    toDepartureQuay: "km to departure quay",
    toQuay: "km to quay",
    onwardFrom: "onward from",
    totalRoute: "km total route",
    ferryOrdinal: (index) => `Ferry ${index + 1}`,
    routeToDestination: (from, to) => `${from} to ${to}`,
    routeToQuay: (from) => `To ${from} ferry quay`,
    loadingRoad: "Fetching route...",
    vehicle: "Vehicle",
    arrival: "Arrival",
    destination: "Destination",
    routeSummary: (drive, crossing, onward, total) => `To destination: ${drive} to quay + ${crossing} crossing + ${onward} onward = ${total}.`,
    noGeolocationDemo: "Browser does not support location. Showing demo.",
    locationFailedDemo: "Could not get location. Showing demo at Halhjem.",
    demoActive: "Demo is active. Share location for exact calculation.",
    statusHigh: "Likely to make it",
    statusMedium: "Possible, tight margin",
    statusLow: "Uncertain",
    minute: "min",
    hour: "h"
  },
  de: {
    appName: "Fährzeiten",
    usePosition: "Meine Position verwenden",
    locating: "Position wird ermittelt",
    positionActive: "Position aktiv",
    refresh: "Aktualisieren",
    updating: "Aktualisiert",
    finalDestination: "Endziel",
    destinationPlaceholder: "Ort, Adresse oder Kai eingeben",
    nextFerry: "Nächste Fähre",
    normalDrive: "Normale Fahrzeit",
    quayWait: "Wartezeit am Kai",
    showMap: "Karte anzeigen",
    closeMap: "Karte schließen",
    crossing: "Überfahrt",
    onwardFromQuay: "Weiter ab Kai",
    toDestination: "Zum Ziel",
    routeListDestination: "Relevante Verbindungen",
    routeListNearest: "5 nächste Verbindungen",
    noRoutes: "Keine Fährverbindungen für Position und Reiseart gefunden.",
    noDestinationFerry: "Keine Fähre auf der berechneten kürzesten Route zum Ziel gefunden.",
    noCurrentFerry: "Keine aktuelle Fähre",
    noDepartureQuay: "Kein aktueller Abfahrtskai",
    changeDestinationPosition: "Ziel oder Position ändern.",
    chooseRoute: "Verbindung wählen",
    chooseFerryRoute: "Fährverbindung wählen",
    selectRouteInstruction: "Verbindung antippen, um nächste Abfahrt, Fahrzeit und Überfahrt zu laden.",
    findNearest: "Nächste Fährverbindung finden",
    sharePosition: "Position teilen, um die richtige Abfahrtsseite und die Erreichbarkeit zu sehen.",
    routesFetched: "Routen geladen",
    decisionUnavailable: "Nächste Abfahrt konnte gerade nicht geladen werden, aber die Liste ist aktualisiert.",
    sourceUnknown: "Unbekannt",
    enturUnavailable: "Entur nicht verfügbar",
    fetchError: "Autoritative Fährdaten konnten gerade nicht geladen werden.",
    loadingRoutes: "Fährverbindungen werden geladen...",
    selected: "Gewählt",
    select: "Wählen",
    carFerry: "Autofähre",
    fastBoat: "Schnellboot",
    toDepartureQuay: "km zum Abfahrtskai",
    toQuay: "km zum Kai",
    onwardFrom: "weiter ab",
    totalRoute: "km Gesamtroute",
    ferryOrdinal: (index) => `${index + 1}. Fähre`,
    routeToDestination: (from, to) => `${from} nach ${to}`,
    routeToQuay: (from) => `Zum Fährkai ${from}`,
    loadingRoad: "Route wird geladen...",
    vehicle: "Fahrzeug",
    arrival: "Ankunft",
    destination: "Ziel",
    routeSummary: (drive, crossing, onward, total) => `Zum Ziel: ${drive} zum Kai + ${crossing} Überfahrt + ${onward} weiter = ${total}.`,
    noGeolocationDemo: "Browser unterstützt keine Position. Demo wird angezeigt.",
    locationFailedDemo: "Position nicht erhalten. Demo bei Halhjem wird angezeigt.",
    demoActive: "Demo ist aktiv. Position für genaue Berechnung teilen.",
    statusHigh: "Wahrscheinlich erreichbar",
    statusMedium: "Möglich, knappe Zeit",
    statusLow: "Unsicher",
    minute: "min",
    hour: "Std."
  },
  es: {
    appName: "Horarios de ferry",
    usePosition: "Usar mi ubicación",
    locating: "Obteniendo ubicación",
    positionActive: "Ubicación activa",
    refresh: "Actualizar",
    updating: "Actualizando",
    finalDestination: "Destino final",
    destinationPlaceholder: "Escribe lugar, dirección o muelle",
    nextFerry: "Próximo ferry",
    normalDrive: "Tiempo normal en coche",
    quayWait: "Espera en el muelle",
    showMap: "Ver mapa",
    closeMap: "Cerrar mapa",
    crossing: "Travesía",
    onwardFromQuay: "Después del muelle",
    toDestination: "Al destino",
    routeListDestination: "Rutas relevantes",
    routeListNearest: "5 rutas más cercanas",
    noRoutes: "No se encontraron rutas de ferry para la posición y modo de viaje.",
    noDestinationFerry: "No se encontró ferry en la ruta más corta calculada al destino.",
    noCurrentFerry: "No hay ferry actual",
    noDepartureQuay: "No hay muelle de salida actual",
    changeDestinationPosition: "Cambia destino o posición.",
    chooseRoute: "Elegir ruta",
    chooseFerryRoute: "Elegir ruta de ferry",
    selectRouteInstruction: "Toca una ruta para obtener próxima salida, conducción y travesía.",
    findNearest: "Buscar ruta de ferry cercana",
    sharePosition: "Comparte ubicación para ver el lado correcto de salida y si llegas a tiempo.",
    routesFetched: "Rutas cargadas",
    decisionUnavailable: "No se pudo obtener la próxima salida ahora, pero la lista está actualizada.",
    sourceUnknown: "Desconocido",
    enturUnavailable: "Entur no disponible",
    fetchError: "No se pudieron obtener rutas oficiales de ferry ahora.",
    loadingRoutes: "Cargando rutas de ferry...",
    selected: "Elegido",
    select: "Elegir",
    carFerry: "ferry para coches",
    fastBoat: "barco rápido",
    toDepartureQuay: "km al muelle de salida",
    toQuay: "km al muelle",
    onwardFrom: "continuar desde",
    totalRoute: "km ruta total",
    ferryOrdinal: (index) => `Ferry ${index + 1}`,
    routeToDestination: (from, to) => `${from} a ${to}`,
    routeToQuay: (from) => `Al muelle de ferry ${from}`,
    loadingRoad: "Cargando ruta...",
    vehicle: "Vehículo",
    arrival: "Llegada",
    destination: "Destino",
    routeSummary: (drive, crossing, onward, total) => `Al destino: ${drive} al muelle + ${crossing} travesía + ${onward} más = ${total}.`,
    noGeolocationDemo: "El navegador no admite ubicación. Mostrando demo.",
    locationFailedDemo: "No se obtuvo ubicación. Mostrando demo en Halhjem.",
    demoActive: "Demo activa. Comparte ubicación para cálculo exacto.",
    statusHigh: "Probablemente llegas",
    statusMedium: "Posible, poco margen",
    statusLow: "Incierto",
    minute: "min",
    hour: "h"
  },
  fr: {
    appName: "Horaires des ferries",
    usePosition: "Utiliser ma position",
    locating: "Position en cours",
    positionActive: "Position active",
    refresh: "Actualiser",
    updating: "Mise à jour",
    finalDestination: "Destination finale",
    destinationPlaceholder: "Saisir lieu, adresse ou quai",
    nextFerry: "Prochain ferry",
    normalDrive: "Temps de route normal",
    quayWait: "Attente au quai",
    showMap: "Afficher la carte",
    closeMap: "Fermer la carte",
    crossing: "Traversée",
    onwardFromQuay: "Après le quai",
    toDestination: "Vers destination",
    routeListDestination: "Liaisons pertinentes",
    routeListNearest: "5 liaisons proches",
    noRoutes: "Aucune liaison ferry trouvée pour la position et le mode de voyage.",
    noDestinationFerry: "Aucun ferry trouvé sur l’itinéraire le plus court calculé.",
    noCurrentFerry: "Aucun ferry actuel",
    noDepartureQuay: "Aucun quai de départ actuel",
    changeDestinationPosition: "Changer destination ou position.",
    chooseRoute: "Choisir liaison",
    chooseFerryRoute: "Choisir ferry",
    selectRouteInstruction: "Touchez une liaison pour charger départ, trajet et traversée.",
    findNearest: "Trouver le ferry le plus proche",
    sharePosition: "Partagez la position pour voir le bon quai et si vous arrivez à temps.",
    routesFetched: "Liaisons chargées",
    decisionUnavailable: "Impossible de charger le prochain départ, mais la liste est à jour.",
    sourceUnknown: "Inconnu",
    enturUnavailable: "Entur indisponible",
    fetchError: "Impossible de charger les données ferry officielles.",
    loadingRoutes: "Chargement des ferries...",
    selected: "Choisi",
    select: "Choisir",
    carFerry: "ferry voiture",
    fastBoat: "bateau rapide",
    toDepartureQuay: "km au quai de départ",
    toQuay: "km au quai",
    onwardFrom: "suite depuis",
    totalRoute: "km trajet total",
    ferryOrdinal: (index) => `Ferry ${index + 1}`,
    routeToDestination: (from, to) => `${from} vers ${to}`,
    routeToQuay: (from) => `Vers le quai ferry ${from}`,
    loadingRoad: "Chargement de l’itinéraire...",
    vehicle: "Véhicule",
    arrival: "Arrivée",
    destination: "Destination",
    routeSummary: (drive, crossing, onward, total) => `Vers destination : ${drive} au quai + ${crossing} traversée + ${onward} ensuite = ${total}.`,
    noGeolocationDemo: "Le navigateur ne prend pas en charge la position. Démo affichée.",
    locationFailedDemo: "Position non obtenue. Démo à Halhjem.",
    demoActive: "Démo active. Partagez la position pour un calcul exact.",
    statusHigh: "Probablement à temps",
    statusMedium: "Possible, marge faible",
    statusLow: "Incertain",
    minute: "min",
    hour: "h"
  },
  it: {
    appName: "Orari traghetti",
    usePosition: "Usa la mia posizione",
    locating: "Rilevamento posizione",
    positionActive: "Posizione attiva",
    refresh: "Aggiorna",
    updating: "Aggiornamento",
    finalDestination: "Destinazione finale",
    destinationPlaceholder: "Scrivi luogo, indirizzo o molo",
    nextFerry: "Prossimo traghetto",
    normalDrive: "Tempo normale in auto",
    quayWait: "Attesa al molo",
    showMap: "Mostra mappa",
    closeMap: "Chiudi mappa",
    crossing: "Traversata",
    onwardFromQuay: "Dopo il molo",
    toDestination: "Alla destinazione",
    routeListDestination: "Collegamenti rilevanti",
    routeListNearest: "5 collegamenti vicini",
    noRoutes: "Nessun collegamento ferry trovato per posizione e modalità.",
    noDestinationFerry: "Nessun traghetto trovato sul percorso più breve calcolato.",
    noCurrentFerry: "Nessun traghetto attuale",
    noDepartureQuay: "Nessun molo di partenza attuale",
    changeDestinationPosition: "Cambia destinazione o posizione.",
    chooseRoute: "Scegli collegamento",
    chooseFerryRoute: "Scegli traghetto",
    selectRouteInstruction: "Tocca un collegamento per caricare partenza, guida e traversata.",
    findNearest: "Trova il traghetto più vicino",
    sharePosition: "Condividi la posizione per vedere il molo corretto e se arrivi in tempo.",
    routesFetched: "Collegamenti caricati",
    decisionUnavailable: "Impossibile caricare la prossima partenza, ma la lista è aggiornata.",
    sourceUnknown: "Sconosciuto",
    enturUnavailable: "Entur non disponibile",
    fetchError: "Impossibile caricare dati ufficiali dei traghetti.",
    loadingRoutes: "Caricamento collegamenti...",
    selected: "Scelto",
    select: "Scegli",
    carFerry: "traghetto auto",
    fastBoat: "aliscafo",
    toDepartureQuay: "km al molo di partenza",
    toQuay: "km al molo",
    onwardFrom: "prosegue da",
    totalRoute: "km percorso totale",
    ferryOrdinal: (index) => `Traghetto ${index + 1}`,
    routeToDestination: (from, to) => `${from} a ${to}`,
    routeToQuay: (from) => `Al molo traghetti ${from}`,
    loadingRoad: "Caricamento percorso...",
    vehicle: "Veicolo",
    arrival: "Arrivo",
    destination: "Destinazione",
    routeSummary: (drive, crossing, onward, total) => `Alla destinazione: ${drive} al molo + ${crossing} traversata + ${onward} oltre = ${total}.`,
    noGeolocationDemo: "Il browser non supporta la posizione. Demo mostrata.",
    locationFailedDemo: "Posizione non ottenuta. Demo a Halhjem.",
    demoActive: "Demo attiva. Condividi posizione per calcolo esatto.",
    statusHigh: "Probabilmente arrivi",
    statusMedium: "Possibile, poco margine",
    statusLow: "Incerto",
    minute: "min",
    hour: "h"
  }
};

const ARIA_TRANSLATIONS = {
  no: {
    languageChoice: "Velg språk",
    openMain: "Åpne hovedside",
    status: "Status",
    start: "Start",
    travelOnward: "Reise videre",
    alerts: "Varsler",
    map: "Kart",
    routeMap: "Kart over valgt rute",
    zoom: "Zoom"
  },
  en: {
    languageChoice: "Choose language",
    openMain: "Open main page",
    status: "Status",
    start: "Start",
    travelOnward: "Continue journey",
    alerts: "Alerts",
    map: "Map",
    routeMap: "Map of selected route",
    zoom: "Zoom"
  },
  de: {
    languageChoice: "Sprache wählen",
    openMain: "Hauptseite öffnen",
    status: "Status",
    start: "Start",
    travelOnward: "Weiterreise",
    alerts: "Hinweise",
    map: "Karte",
    routeMap: "Karte der gewählten Route",
    zoom: "Zoom"
  },
  es: {
    languageChoice: "Elegir idioma",
    openMain: "Abrir página principal",
    status: "Estado",
    start: "Inicio",
    travelOnward: "Continuar viaje",
    alerts: "Avisos",
    map: "Mapa",
    routeMap: "Mapa de la ruta elegida",
    zoom: "Zoom"
  },
  fr: {
    languageChoice: "Choisir la langue",
    openMain: "Ouvrir la page principale",
    status: "Statut",
    start: "Départ",
    travelOnward: "Suite du trajet",
    alerts: "Alertes",
    map: "Carte",
    routeMap: "Carte de l’itinéraire choisi",
    zoom: "Zoom"
  },
  it: {
    languageChoice: "Scegli lingua",
    openMain: "Apri pagina principale",
    status: "Stato",
    start: "Avvio",
    travelOnward: "Proseguimento",
    alerts: "Avvisi",
    map: "Mappa",
    routeMap: "Mappa del percorso scelto",
    zoom: "Zoom"
  }
};

const elements = {
  frontPage: document.querySelector("#frontPage"),
  appShell: document.querySelector("#appShell"),
  enterAppButton: document.querySelector("#enterAppButton"),
  languageButtons: [...document.querySelectorAll(".language-option")],
  locateButton: document.querySelector("#locateButton"),
  refreshButton: document.querySelector("#refreshButton"),
  statusPill: document.querySelector("#statusPill"),
  updatedAt: document.querySelector("#updatedAt"),
  departureTime: document.querySelector("#departureTime"),
  normalDriveTime: document.querySelector("#normalDriveTime"),
  margin: document.querySelector("#margin"),
  routeName: document.querySelector("#routeName"),
  recommendation: document.querySelector("#recommendation"),
  crossingTime: document.querySelector("#crossingTime"),
  onwardMetric: document.querySelector("#onwardMetric"),
  onwardTime: document.querySelector("#onwardTime"),
  totalMetric: document.querySelector("#totalMetric"),
  totalTime: document.querySelector("#totalTime"),
  destinationInput: document.querySelector("#destinationInput"),
  destinationSuggestions: document.querySelector("#destinationSuggestions"),
  noticeStack: document.querySelector("#noticeStack"),
  routeList: document.querySelector("#routeList"),
  routeListTitle: document.querySelector("#routeListTitle"),
  sourceLabel: document.querySelector("#sourceLabel"),
  mapButton: document.querySelector("#mapButton"),
  mapSheet: document.querySelector("#mapSheet"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapTitle: document.querySelector("#mapTitle"),
  closeMapButton: document.querySelector("#closeMapButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton")
};

elements.languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language || "no"));
});
elements.enterAppButton.addEventListener("click", enterApp);
elements.locateButton.addEventListener("click", locate);
elements.refreshButton.addEventListener("click", refresh);
elements.destinationInput.addEventListener("input", handleDestinationInput);
elements.destinationInput.addEventListener("focus", handleDestinationInput);
elements.destinationInput.addEventListener("keydown", handleDestinationKeydown);
elements.mapButton.addEventListener("click", showMap);
elements.closeMapButton.addEventListener("click", closeMap);
elements.zoomInButton.addEventListener("click", () => zoomMap(1));
elements.zoomOutButton.addEventListener("click", () => zoomMap(-1));
window.addEventListener("resize", () => {
  if (!elements.mapSheet.hidden) renderMap();
});
document.addEventListener("pointerdown", closeSuggestionsOnOutsideClick);

disableServiceWorkerCache();

initialize();

function initialize() {
  setLanguage(state.language, { persist: false });
  seedDemo();
  renderRouteLoading();
}

function t(key, ...args) {
  const value = (TRANSLATIONS[state.language] || TRANSLATIONS.no)[key] ?? TRANSLATIONS.no[key] ?? key;
  return typeof value === "function" ? value(...args) : value;
}

function tAria(key) {
  return (ARIA_TRANSLATIONS[state.language] || ARIA_TRANSLATIONS.no)[key] ?? ARIA_TRANSLATIONS.no[key] ?? key;
}

function setLanguage(language, options = {}) {
  state.language = TRANSLATIONS[language] ? language : "no";
  if (options.persist !== false) localStorage.setItem("ferge-na-language", state.language);
  document.documentElement.lang = state.language;
  elements.languageButtons.forEach((button) => {
    const active = button.dataset.language === state.language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  applyTranslations();
  renderRoutes();
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", tAria(node.dataset.i18nAria));
  });
  if (!state.position) {
    elements.statusPill.textContent = t("noCurrentFerry");
    elements.routeName.textContent = t("findNearest");
    elements.recommendation.textContent = t("sharePosition");
  }
}

async function enterApp() {
  elements.frontPage.hidden = true;
  elements.appShell.hidden = false;
  await locate();
}

async function locate() {
  setLoading(t("locating"));
  elements.locateButton.disabled = true;
  elements.locateButton.textContent = t("locating");

  if (!navigator.geolocation) {
    await setDemoPosition(t("noGeolocationDemo"));
    elements.locateButton.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      state.position = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      elements.locateButton.textContent = t("positionActive");
      elements.locateButton.disabled = false;
      await refresh();
    },
    async () => {
      await setDemoPosition(t("locationFailedDemo"));
      elements.locateButton.textContent = t("usePosition");
      elements.locateButton.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
  );
}

async function setDemoPosition(message) {
  state.position = { lat: 60.1838, lon: 5.4659 };
  elements.recommendation.textContent = message;
  await refresh();
}

async function refresh() {
  if (!state.position) {
    await setDemoPosition(t("demoActive"));
    return;
  }

  try {
    setLoading(t("updating"));
    renderRouteLoading();
    const nearby = await fetchNearbyRoutes(true);
    const destinationFiltered = Boolean(state.destination);

    state.routes = nearby.routes || [];
    elements.routeListTitle.textContent = destinationFiltered ? t("routeListDestination") : t("routeListNearest");
    elements.sourceLabel.textContent = `${nearby.source === "entur-authoritative" ? "Entur" : t("sourceUnknown")} · ${APP_VERSION}`;

    if (state.selectedTerminalId && !state.routes.some((route) => route.id === state.selectedTerminalId)) {
      state.selectedTerminalId = null;
    }

    renderRoutes();
    if (!state.routes.length) {
      clearDecision(destinationFiltered
        ? t("noDestinationFerry")
        : null);
      renderAlerts([]);
      return;
    }
    if (!state.selectedTerminalId) {
      promptForRouteSelection();
      renderAlerts([]);
      return;
    }
    await updateDecisionSafe();
    await updateAlertsSafe();
  } catch (error) {
    state.routes = [];
    state.selectedTerminalId = null;
    elements.routeListTitle.textContent = t("routeListNearest");
    elements.sourceLabel.textContent = `${t("enturUnavailable")} · ${APP_VERSION}`;
    renderRoutes(t("fetchError"));
    clearDecision();
    renderAlerts([]);
  }
}

async function updateDecisionSafe() {
  const selectedRoute = getSelectedRoute();
  try {
    await updateDecision();
  } catch (error) {
    elements.statusPill.textContent = t("routesFetched");
    elements.statusPill.className = "status-pill medium";
    elements.routeName.textContent = selectedRoute
      ? `${selectedRoute.sideName} ferjekai`
      : t("noDepartureQuay");
    elements.recommendation.textContent = t("decisionUnavailable");
    elements.departureTime.textContent = "--:--";
    elements.normalDriveTime.textContent = "--";
    elements.margin.textContent = "--";
    elements.crossingTime.textContent = "--";
    renderDestinationMetrics(null);
    hideMapButton();
  }
}

async function updateAlertsSafe() {
  try {
    await updateAlerts();
  } catch {
    renderAlerts([]);
  }
}

function clearDecision(message = null) {
  elements.statusPill.textContent = t("noCurrentFerry");
  elements.statusPill.className = "status-pill low";
  elements.departureTime.textContent = "--:--";
  elements.normalDriveTime.textContent = "--";
  elements.margin.textContent = "--";
  elements.routeName.textContent = t("noDepartureQuay");
  elements.recommendation.textContent = message || t("changeDestinationPosition");
  elements.crossingTime.textContent = "--";
  renderDestinationMetrics(null);
  hideMapButton();
}

function promptForRouteSelection() {
  elements.statusPill.textContent = t("chooseRoute");
  elements.statusPill.className = "status-pill";
  elements.departureTime.textContent = "--:--";
  elements.normalDriveTime.textContent = "--";
  elements.margin.textContent = "--";
  elements.routeName.textContent = t("chooseFerryRoute");
  elements.recommendation.textContent = t("selectRouteInstruction");
  elements.crossingTime.textContent = "--";
  renderDestinationMetrics(null);
  hideMapButton();
}

async function updateDecision() {
  if (!state.selectedTerminalId) return;
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon),
    terminalId: state.selectedTerminalId || "",
    travelMode: state.travelMode
  });
  appendDestinationParams(query);

  const payload = await fetchJson(`/api/decision?${query}`);
  const decision = payload.decision;
  if (!decision) return;

  elements.statusPill.textContent = formatDecisionStatus(decision);
  elements.statusPill.className = `status-pill ${decision.confidence}`;
  elements.updatedAt.textContent = new Date(decision.now).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit"
  });
  elements.departureTime.textContent = decision.departureLabel;
  elements.normalDriveTime.textContent = formatMinutes(decision.drive.normalMinutes);
  elements.margin.textContent = formatMinutes(decision.quayWaitMinutes);
  elements.routeName.textContent = `${decision.sideName} ferjekai`;
  elements.recommendation.textContent = formatDecisionRecommendation(decision);
  elements.crossingTime.textContent = formatMinutes(decision.crossingMinutes);
  renderDestinationMetrics(decision.destinationSummary);
  showMapButton();

  maybeNotify(decision);
}

async function fetchNearbyRoutes(useDestination) {
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon),
    travelMode: state.travelMode,
    limit: "5"
  });
  if (useDestination) appendDestinationParams(query);
  return fetchJson(`/api/ferries/nearby?${query}`);
}

async function updateAlerts() {
  if (!state.selectedTerminalId) {
    renderAlerts([]);
    return;
  }
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon),
    terminalId: state.selectedTerminalId || "",
    travelMode: state.travelMode
  });
  appendDestinationParams(query);
  const payload = await fetchJson(`/api/alerts?${query}`);
  renderAlerts(payload.alerts || []);
}

function renderDestinationMetrics(summary) {
  const hasSummary = Boolean(summary);
  elements.onwardMetric.hidden = !hasSummary;
  elements.totalMetric.hidden = !hasSummary;
  elements.onwardTime.textContent = hasSummary ? formatMinutes(summary.onwardDrive.normalMinutes) : "--";
  elements.totalTime.textContent = hasSummary ? formatMinutes(summary.totalNormalMinutes) : "--";
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) return "--";
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes} ${t("minute")}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ${t("hour")} ${rest} ${t("minute")}` : `${hours} ${t("hour")}`;
}

function formatDecisionRecommendation(decision) {
  if (!decision.destinationSummary) return decision.recommendation;
  return t(
    "routeSummary",
    formatMinutes(decision.drive.normalMinutes),
    formatMinutes(decision.crossingMinutes),
    formatMinutes(decision.destinationSummary.onwardDrive.normalMinutes),
    formatMinutes(decision.destinationSummary.totalNormalMinutes)
  );
}

function formatDecisionStatus(decision) {
  if (decision.confidence === "high") return t("statusHigh");
  if (decision.confidence === "medium") return t("statusMedium");
  return t("statusLow");
}

function showMapButton() {
  elements.mapButton.hidden = !getSelectedRoute();
}

function hideMapButton() {
  elements.mapButton.hidden = true;
  closeMap();
}

async function showMap() {
  const route = getSelectedRoute();
  if (!state.position || !route) return;

  elements.mapTitle.textContent = state.destination
    ? t("routeToDestination", route.sideName, state.destination.name || t("destination"))
    : t("routeToQuay", route.sideName);
  state.map.points = buildMapPoints(route);
  state.map.path = [];
  state.map.selectedRouteId = route.id;
  state.map.lastPathOrigin = { ...state.position };
  state.map.followVehicle = true;
  elements.mapSheet.hidden = false;
  elements.mapCanvas.innerHTML = '<div class="map-loading">Henter vei...</div>';
  elements.mapCanvas.querySelector(".map-loading").textContent = t("loadingRoad");

  try {
    const path = await fetchMapPath(route);
    state.map.path = path.length > 1 ? path : buildStraightMapPath();
  } catch {
    state.map.path = buildStraightMapPath();
  }

  state.map.zoom = Math.max(13, fitMapZoom(getMapBoundsPoints()));
  window.requestAnimationFrame(renderMap);
  startMapTracking();
}

function closeMap() {
  elements.mapSheet.hidden = true;
  elements.mapCanvas.innerHTML = "";
  state.map.path = [];
  state.map.selectedRouteId = null;
  state.map.lastPathOrigin = null;
  stopMapTracking();
}

function buildMapPoints(route) {
  const points = [
    {
      lat: state.position.lat,
      lon: state.position.lon,
      type: "vehicle",
      label: t("vehicle"),
      heading: null,
      accuracy: null
    },
    {
      lat: route.lat,
      lon: route.lon,
      type: "departure",
      label: `${route.sideName} ferjekai`
    }
  ];
  if (state.destination) {
    if (Number.isFinite(route.arrivalLat) && Number.isFinite(route.arrivalLon)) {
      points.push({
        lat: route.arrivalLat,
        lon: route.arrivalLon,
        type: "arrival",
      label: `${route.arrivalSideName || route.oppositeSideName || t("arrival")} ferjekai`
      });
    }
    points.push({
      lat: state.destination.lat,
      lon: state.destination.lon,
      type: "destination",
      label: state.destination.name || t("destination")
    });
  }
  return points;
}

function startMapTracking() {
  if (!navigator.geolocation || state.map.watchId !== null) return;
  state.map.watchId = navigator.geolocation.watchPosition(
    (position) => {
      const nextPosition = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      state.position = nextPosition;
      updateVehicleMarker({
        ...nextPosition,
        heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null
      });
      maybeRefreshMapPath();
      renderMap();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

function stopMapTracking() {
  if (state.map.watchId === null || !navigator.geolocation) return;
  navigator.geolocation.clearWatch(state.map.watchId);
  state.map.watchId = null;
}

function updateVehicleMarker(position) {
  const vehicle = state.map.points.find((point) => point.type === "vehicle");
  if (!vehicle) return;
  vehicle.lat = position.lat;
  vehicle.lon = position.lon;
  vehicle.heading = position.heading;
  vehicle.accuracy = position.accuracy;
}

async function maybeRefreshMapPath() {
  const route = getSelectedRoute();
  if (!route || state.map.routeUpdateInFlight || elements.mapSheet.hidden) return;
  const lastOrigin = state.map.lastPathOrigin;
  if (lastOrigin && distanceKm(lastOrigin, state.position) < 0.12) return;

  state.map.routeUpdateInFlight = true;
  state.map.lastPathOrigin = { ...state.position };
  try {
    const path = await fetchMapPath(route);
    state.map.path = path.length > 1 ? path : buildStraightMapPath();
  } catch {
    state.map.path = buildStraightMapPath();
  } finally {
    state.map.routeUpdateInFlight = false;
    renderMap();
  }
}

async function fetchMapPath(route) {
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon),
    terminalId: route.id,
    travelMode: state.travelMode
  });
  appendDestinationParams(query);
  const payload = await fetchJson(`/api/map-route?${query}`);
  return (payload.points || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

function buildStraightMapPath() {
  return state.map.points.map((point) => ({ lat: point.lat, lon: point.lon }));
}

function getMapBoundsPoints() {
  const path = state.map.path.length > 1 ? state.map.path : buildStraightMapPath();
  return [...path, ...state.map.points];
}

function zoomMap(delta) {
  if (!state.map.points.length) return;
  state.map.zoom = Math.max(5, Math.min(17, state.map.zoom + delta));
  renderMap();
}

function fitMapZoom(points) {
  if (points.length <= 1) return 14;
  const width = Math.max(320, elements.mapCanvas.clientWidth || 360);
  const height = Math.max(320, elements.mapCanvas.clientHeight || 420);
  for (let zoom = 15; zoom >= 5; zoom -= 1) {
    const projected = points.map((point) => projectPoint(point, zoom));
    const bounds = getPixelBounds(projected);
    if (bounds.width <= width - 86 && bounds.height <= height - 112) return zoom;
  }
  return 5;
}

function renderMap() {
  const markers = state.map.points;
  if (!markers.length) return;

  const zoom = state.map.zoom;
  const width = Math.max(320, elements.mapCanvas.clientWidth || 360);
  const height = Math.max(320, elements.mapCanvas.clientHeight || 420);
  const path = state.map.path.length > 1 ? state.map.path : buildStraightMapPath();
  const projectedPath = path.map((point) => ({ ...point, pixel: projectPoint(point, zoom) }));
  const projectedMarkers = markers.map((point) => ({ ...point, pixel: projectPoint(point, zoom) }));
  const bounds = getPixelBounds([...projectedPath, ...projectedMarkers].map((point) => point.pixel));
  const vehicleMarker = projectedMarkers.find((point) => point.type === "vehicle");
  const center = state.map.followVehicle && vehicleMarker
    ? vehicleMarker.pixel
    : {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2
      };
  const topLeft = {
    x: center.x - width / 2,
    y: center.y - height / 2
  };

  elements.mapCanvas.innerHTML = "";
  renderTiles(zoom, width, height, topLeft);
  renderRouteOverlay(projectedPath, projectedMarkers, width, height, topLeft);
}

function renderTiles(zoom, width, height, topLeft) {
  const tileSize = 256;
  const tileCount = 2 ** zoom;
  const minTileX = Math.floor(topLeft.x / tileSize);
  const maxTileX = Math.floor((topLeft.x + width) / tileSize);
  const minTileY = Math.max(0, Math.floor(topLeft.y / tileSize));
  const maxTileY = Math.min(tileCount - 1, Math.floor((topLeft.y + height) / tileSize));

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const tile = document.createElement("img");
      tile.className = "map-tile";
      tile.alt = "";
      tile.draggable = false;
      tile.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`;
      tile.style.left = `${Math.round(tileX * tileSize - topLeft.x)}px`;
      tile.style.top = `${Math.round(tileY * tileSize - topLeft.y)}px`;
      elements.mapCanvas.append(tile);
    }
  }
}

function renderRouteOverlay(path, markers, width, height, topLeft) {
  const screenPath = path.map((point) => ({
    ...point,
    x: Math.round(point.pixel.x - topLeft.x),
    y: Math.round(point.pixel.y - topLeft.y)
  }));
  const screenMarkers = markers.map((point) => ({
    ...point,
    x: Math.round(point.pixel.x - topLeft.x),
    y: Math.round(point.pixel.y - topLeft.y)
  }));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "map-route");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", screenPath.map((point) => `${point.x},${point.y}`).join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#0b4f8a");
  polyline.setAttribute("stroke-width", "5");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  svg.append(polyline);
  elements.mapCanvas.append(svg);

  screenMarkers.forEach((point, index) => {
    const marker = document.createElement("div");
    marker.className = `map-marker ${point.type}`;
    marker.style.left = `${point.x}px`;
    marker.style.top = `${point.y}px`;
    if (point.type === "vehicle" && Number.isFinite(point.heading)) {
      marker.style.setProperty("--vehicle-heading", `${point.heading}deg`);
    }
    marker.innerHTML = `
      <span>${point.type === "vehicle" ? "" : index}</span>
      <strong>${escapeHtml(point.label)}</strong>
    `;
    elements.mapCanvas.append(marker);
  });
}

function projectPoint(point, zoom) {
  const tileSize = 256;
  const scale = tileSize * 2 ** zoom;
  const sinLat = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

function getPixelBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function distanceKm(a, b) {
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function renderRoutes(errorMessage = "") {
  elements.routeList.innerHTML = "";
  if (!state.routes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-routes";
    empty.textContent = errorMessage || t("noRoutes");
    elements.routeList.append(empty);
    return;
  }

  state.routes.forEach((route, index) => {
    const button = document.createElement("button");
    button.className = route.id === state.selectedTerminalId ? "route-card active" : "route-card";
    button.type = "button";
    button.setAttribute("aria-pressed", route.id === state.selectedTerminalId ? "true" : "false");
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(formatRouteTitle(route, index))}</strong>
        <span>${escapeHtml(formatRouteMeta(route))}</span>
      </span>
      <em>${route.id === state.selectedTerminalId ? t("selected") : t("select")}</em>
    `;
    button.addEventListener("click", async () => {
      renderDestinationSuggestions([]);
      state.selectedTerminalId = route.id;
      renderRoutes();
      await updateDecisionSafe();
      await updateAlertsSafe();
    });
    elements.routeList.append(button);
  });
}

function renderRouteLoading() {
  elements.routeListTitle.textContent = t("routeListNearest");
  elements.routeList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "empty-routes";
  loading.textContent = t("loadingRoutes");
  elements.routeList.append(loading);
}

function getSelectedRoute() {
  return state.routes.find((route) => route.id === state.selectedTerminalId) || null;
}

function formatRouteDescriptor(route) {
  const type = route.transportSubmode === "localCarFerry" ? t("carFerry") : t("fastBoat");
  return route.routeCode ? `${type} ${route.routeCode}` : type;
}

function formatRouteTitle(route, index) {
  if (!state.destination) return `${route.sideName} ferjekai`;
  return `${t("ferryOrdinal", index)}: ${route.ferryLegLabel || `${route.sideName}-${route.oppositeSideName}`}`;
}

function formatRouteMeta(route) {
  const descriptor = formatRouteDescriptor(route);
  if (!state.destination) return `${descriptor} · ${route.distanceKm} ${t("toDepartureQuay")}`;
  const total = Number.isFinite(route.totalRouteKm) ? ` · ${route.totalRouteKm} ${t("totalRoute")}` : "";
  const arrival = route.arrivalSideName ? ` · ${t("onwardFrom")} ${route.arrivalSideName}` : "";
  return `${descriptor} · ${route.distanceKm} ${t("toQuay")}${arrival}${total}`;
}

function handleDestinationInput() {
  const text = elements.destinationInput.value.trim();
  window.clearTimeout(state.destinationSearchTimer);

  if (text.length < 2) {
    state.destination = null;
    state.selectedTerminalId = null;
    renderDestinationSuggestions([]);
    if (state.position) refresh();
    return;
  }

  state.destinationSearchTimer = window.setTimeout(async () => {
    const query = new URLSearchParams({ text });
    try {
      const payload = await fetchJson(`/api/places?${query}`);
      const places = payload.places || [];
      renderDestinationSuggestions(places);
    } catch {
      renderDestinationSuggestions([]);
    }
  }, 180);
}

async function handleDestinationKeydown(event) {
  if (event.key !== "Enter") return;
  const firstSuggestion = elements.destinationSuggestions.querySelector(".suggestion-button");
  if (firstSuggestion) {
    event.preventDefault();
    firstSuggestion.click();
  }
}

function renderDestinationSuggestions(places) {
  elements.destinationSuggestions.innerHTML = "";
  elements.destinationSuggestions.classList.toggle("visible", places.length > 0);

  for (const place of places) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-button";
    button.innerHTML = `
      <strong>${escapeHtml(place.name)}</strong>
      <span>${escapeHtml(place.label)}</span>
    `;
    button.addEventListener("click", () => {
      state.destination = place;
      state.selectedTerminalId = null;
      elements.destinationInput.value = place.label;
      renderDestinationSuggestions([]);
      if (state.position) refresh();
    });
    elements.destinationSuggestions.append(button);
  }
}

function appendDestinationParams(query) {
  if (!state.destination) return;
  query.set("destLat", String(state.destination.lat));
  query.set("destLon", String(state.destination.lon));
}

function closeSuggestionsOnOutsideClick(event) {
  if (event.target === elements.destinationInput || elements.destinationSuggestions.contains(event.target)) return;
  renderDestinationSuggestions([]);
}

function renderAlerts(alerts) {
  elements.noticeStack.innerHTML = "";
  elements.noticeStack.hidden = alerts.length === 0;
  for (const alert of alerts) {
    const item = document.createElement("article");
    item.className = `notice ${alert.level || "info"}`;
    item.innerHTML = `
      <strong>${escapeHtml(alert.title)}</strong>
      <span>${escapeHtml(alert.detail)}</span>
    `;
    elements.noticeStack.append(item);
  }
}

function setLoading(text) {
  elements.statusPill.textContent = text;
  elements.statusPill.className = "status-pill";
}

async function fetchJson(url) {
  const response = await fetch(`${API_BASE}${url}`);
  if (!response.ok) throw new Error(`API-feil ${response.status}`);
  return response.json();
}

function seedDemo() {
  elements.updatedAt.textContent = new Date().toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit"
  });
  renderAlerts([]);
}

async function disableServiceWorkerCache() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

function maybeNotify(decision) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = `${decision.terminalId}:${decision.departureTime}:${decision.confidence}`;
  if (sessionStorage.getItem("last-notification") === key) return;

  if (decision.confidence !== "high" || decision.marginMinutes <= 5) {
    sessionStorage.setItem("last-notification", key);
    new Notification(`${decision.status}: ${decision.departureLabel}`, {
      body: `${decision.routeName}: ${formatMinutes(decision.marginMinutes)} margin. ${decision.recommendation}`,
      icon: "/icon.svg"
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
