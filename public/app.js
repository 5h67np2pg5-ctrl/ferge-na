const state = {
  position: null,
  selectedTerminalId: null,
  travelMode: "vehicle",
  destination: null,
  destinationSearchTimer: null,
  routes: []
};

const APP_VERSION = "v16";

const CLIENT_FALLBACK_TERMINALS = [
  { id: "fallback-halhjem-1018", source: "client-fallback", sideName: "Halhjem", routeName: "Halhjem-Sandvikvåg", routeCode: "1018", transportSubmode: "localCarFerry", lat: 60.14338, lon: 5.43355, crossingMinutes: 45 },
  { id: "fallback-halhjem-1021", source: "client-fallback", sideName: "Halhjem", routeName: "Våge-Halhjem", routeCode: "1021", transportSubmode: "localCarFerry", lat: 60.14338, lon: 5.43355, crossingMinutes: 35 },
  { id: "fallback-hatvik-1020", source: "client-fallback", sideName: "Hatvik", routeName: "Hatvik-Venjaneset", routeCode: "1020", transportSubmode: "localCarFerry", lat: 60.208524, lon: 5.53715, crossingMinutes: 12 },
  { id: "fallback-krokeide-1022", source: "client-fallback", sideName: "Krokeide", routeName: "Hufthamar-Krokeide", routeCode: "1022", transportSubmode: "localCarFerry", lat: 60.217, lon: 5.247, crossingMinutes: 35 },
  { id: "fallback-klokkarvik-1035", source: "client-fallback", sideName: "Klokkarvik", routeName: "Klokkarvik-Lerøy-Bjelkarøy-Hjellestad", routeCode: "1035", transportSubmode: "localCarFerry", lat: 60.223, lon: 5.116, crossingMinutes: 40 },
  { id: "fallback-lavik-1045", source: "client-fallback", sideName: "Lavik", routeName: "Lavik-Oppedal", routeCode: "1045", transportSubmode: "localCarFerry", lat: 61.1042, lon: 5.5146, crossingMinutes: 20 }
];

const elements = {
  locateButton: document.querySelector("#locateButton"),
  refreshButton: document.querySelector("#refreshButton"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  modeSummary: document.querySelector("#modeSummary"),
  statusPill: document.querySelector("#statusPill"),
  updatedAt: document.querySelector("#updatedAt"),
  departureTime: document.querySelector("#departureTime"),
  margin: document.querySelector("#margin"),
  routeName: document.querySelector("#routeName"),
  recommendation: document.querySelector("#recommendation"),
  driveTime: document.querySelector("#driveTime"),
  queueTime: document.querySelector("#queueTime"),
  bufferTime: document.querySelector("#bufferTime"),
  crossingTime: document.querySelector("#crossingTime"),
  destinationInput: document.querySelector("#destinationInput"),
  destinationSuggestions: document.querySelector("#destinationSuggestions"),
  noticeStack: document.querySelector("#noticeStack"),
  routeList: document.querySelector("#routeList"),
  routeListTitle: document.querySelector("#routeListTitle"),
  sourceLabel: document.querySelector("#sourceLabel")
};

elements.locateButton.addEventListener("click", locate);
elements.refreshButton.addEventListener("click", refresh);
elements.modeButtons.forEach((button) => button.addEventListener("click", () => setTravelMode(button.dataset.mode)));
elements.destinationInput.addEventListener("input", handleDestinationInput);
elements.destinationInput.addEventListener("focus", handleDestinationInput);
elements.destinationInput.addEventListener("keydown", handleDestinationKeydown);
document.addEventListener("pointerdown", closeSuggestionsOnOutsideClick);

disableServiceWorkerCache();

initialize();

async function initialize() {
  seedDemo();
  renderTravelMode();
  await setDemoPosition("Demo er aktiv. Trykk Bruk min posisjon for nøyaktig liste.");
}

async function locate() {
  setLoading("Henter posisjon");
  elements.locateButton.disabled = true;
  elements.locateButton.textContent = "Henter posisjon";

  if (!navigator.geolocation) {
    await setDemoPosition("Nettleseren støtter ikke posisjon. Viser demo.");
    elements.locateButton.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      state.position = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      elements.locateButton.textContent = "Posisjon aktiv";
      elements.locateButton.disabled = false;
      await refresh();
    },
    async () => {
      await setDemoPosition("Fikk ikke posisjon. Viser demo ved Halhjem.");
      elements.locateButton.textContent = "Bruk min posisjon";
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
    await setDemoPosition("Demo er aktiv. Del posisjon for nøyaktig beregning.");
    return;
  }

  try {
    setLoading("Oppdaterer");
    renderRouteLoading();
    let nearby = await fetchNearbyRoutes(true);
    let destinationFiltered = Boolean(state.destination);
    if (destinationFiltered && !(nearby.routes || []).length) {
      nearby = await fetchNearbyRoutes(false);
      destinationFiltered = false;
    }

    state.routes = (nearby.routes || []).length ? nearby.routes : getClientFallbackRoutes();
    elements.routeListTitle.textContent = destinationFiltered ? "Aktuelle samband" : "5 nærmeste samband";
    elements.sourceLabel.textContent = `${(nearby.routes || []).length ? (nearby.source === "entur-authoritative" ? "Entur" : "Fallback") : "Lokal"} · ${APP_VERSION}`;

    if ((!state.selectedTerminalId || !state.routes.some((route) => route.id === state.selectedTerminalId)) && state.routes[0]) {
      state.selectedTerminalId = state.routes[0].id;
    }

    renderRoutes();
    if (!state.routes.length) {
      clearDecision();
      await updateAlertsSafe();
      return;
    }
    await updateDecisionSafe();
    await updateAlertsSafe();
  } catch (error) {
    state.routes = getClientFallbackRoutes();
    state.selectedTerminalId = state.routes[0]?.id || null;
    elements.routeListTitle.textContent = "5 nærmeste samband";
    elements.sourceLabel.textContent = `Lokal · ${APP_VERSION}`;
    renderRoutes();
    await updateDecisionSafe();
    renderAlerts([]);
  }
}

async function updateDecisionSafe() {
  const selectedRoute = getSelectedRoute();
  if (selectedRoute?.source === "client-fallback") {
    renderClientFallbackDecision(selectedRoute);
    return;
  }

  try {
    await updateDecision();
  } catch (error) {
    elements.statusPill.textContent = "Ruter hentet";
    elements.statusPill.className = "status-pill medium";
    elements.routeName.textContent = selectedRoute
      ? `${selectedRoute.sideName} ferjekai`
      : "Ingen aktuell avgangskai";
    elements.recommendation.textContent = "Kunne ikke hente neste avgang akkurat nå, men sambandslisten er oppdatert.";
    elements.departureTime.textContent = "--:--";
    elements.margin.textContent = "--";
    elements.driveTime.textContent = "--";
    elements.queueTime.textContent = "--";
    elements.bufferTime.textContent = "--";
    elements.crossingTime.textContent = "--";
  }
}

async function updateAlertsSafe() {
  try {
    await updateAlerts();
  } catch {
    renderAlerts([]);
  }
}

function clearDecision() {
  elements.statusPill.textContent = "Ingen aktuell ferge";
  elements.statusPill.className = "status-pill low";
  elements.departureTime.textContent = "--:--";
  elements.margin.textContent = "--";
  elements.routeName.textContent = "Ingen aktuell avgangskai";
  elements.recommendation.textContent = "Endre destinasjon, reisemåte eller posisjon.";
  elements.driveTime.textContent = "--";
  elements.queueTime.textContent = "--";
  elements.bufferTime.textContent = "--";
  elements.crossingTime.textContent = "--";
}

async function updateDecision() {
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon),
    terminalId: state.selectedTerminalId || "",
    travelMode: state.travelMode
  });

  const payload = await fetchJson(`/api/decision?${query}`);
  const decision = payload.decision;
  if (!decision) return;

  elements.statusPill.textContent = decision.status;
  elements.statusPill.className = `status-pill ${decision.confidence}`;
  elements.updatedAt.textContent = new Date(decision.now).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit"
  });
  elements.departureTime.textContent = decision.departureLabel;
  elements.margin.textContent = `${decision.marginMinutes} min`;
  elements.routeName.textContent = `${decision.sideName} ferjekai`;
  elements.recommendation.textContent = decision.recommendation;
  elements.driveTime.textContent = `${decision.drive.durationMinutes} min`;
  elements.queueTime.textContent = `${decision.queueMinutes} min`;
  elements.bufferTime.textContent = `${decision.bufferMinutes} min`;
  elements.crossingTime.textContent = `${decision.crossingMinutes} min`;

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
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon)
  });
  const payload = await fetchJson(`/api/alerts?${query}`);
  renderAlerts(payload.alerts || []);
}

function renderRoutes(errorMessage = "") {
  elements.routeList.innerHTML = "";
  if (!state.routes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-routes";
    empty.textContent = errorMessage || "Ingen fergestrekninger funnet for posisjon og reisemåte.";
    elements.routeList.append(empty);
    return;
  }

  for (const route of state.routes) {
    const button = document.createElement("button");
    button.className = route.id === state.selectedTerminalId ? "route-card active" : "route-card";
    button.type = "button";
    button.setAttribute("aria-pressed", route.id === state.selectedTerminalId ? "true" : "false");
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(route.sideName)} ferjekai</strong>
        <span>${escapeHtml(formatRouteDescriptor(route))} · ${escapeHtml(route.distanceKm)} km til avgangskai</span>
      </span>
      <em>${route.id === state.selectedTerminalId ? "Valgt" : "Velg"}</em>
    `;
    button.addEventListener("click", async () => {
      renderDestinationSuggestions([]);
      state.selectedTerminalId = route.id;
      renderRoutes();
      await updateDecisionSafe();
    });
    elements.routeList.append(button);
  }
}

function renderRouteLoading() {
  elements.routeListTitle.textContent = "5 nærmeste samband";
  elements.routeList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "empty-routes";
  loading.textContent = "Henter fergestrekninger...";
  elements.routeList.append(loading);
}

function getClientFallbackRoutes() {
  const origin = state.position || { lat: 60.1838, lon: 5.4659 };
  return CLIENT_FALLBACK_TERMINALS
    .filter((route) => state.travelMode === "foot" || route.transportSubmode === "localCarFerry")
    .map((route) => ({
      ...route,
      distanceKm: Math.round(distanceKm(origin, route) * 10) / 10
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 5);
}

function getSelectedRoute() {
  return state.routes.find((route) => route.id === state.selectedTerminalId) || state.routes[0] || null;
}

function renderClientFallbackDecision(route) {
  const driveMinutes = Math.max(3, Math.ceil((route.distanceKm / 58) * 60));
  const queueMinutes = 3;
  const bufferMinutes = Math.max(2, Math.ceil(driveMinutes * 0.12));
  const departure = nextSlot(30);
  const marginMinutes = Math.floor((departure.getTime() - Date.now()) / 60000) - driveMinutes - queueMinutes - bufferMinutes;
  const confidence = marginMinutes >= 8 ? "high" : marginMinutes >= 3 ? "medium" : "low";

  elements.statusPill.textContent = confidence === "high" ? "Rekker trolig" : confidence === "medium" ? "Mulig, liten margin" : "Usikkert";
  elements.statusPill.className = `status-pill ${confidence}`;
  elements.updatedAt.textContent = new Date().toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  elements.departureTime.textContent = departure.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
  elements.margin.textContent = `${marginMinutes} min`;
  elements.routeName.textContent = `${route.sideName} ferjekai`;
  elements.recommendation.textContent = "Lokal beregning vises mens sanntidsdata hentes.";
  elements.driveTime.textContent = `${driveMinutes} min`;
  elements.queueTime.textContent = `${queueMinutes} min`;
  elements.bufferTime.textContent = `${bufferMinutes} min`;
  elements.crossingTime.textContent = `${route.crossingMinutes || 25} min`;
}

function nextSlot(intervalMinutes) {
  const date = new Date();
  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  date.setMinutes(Math.ceil(minutes / intervalMinutes) * intervalMinutes);
  return date;
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

function formatRouteDescriptor(route) {
  const type = route.transportSubmode === "localCarFerry" ? "bilferge" : "hurtigbåt";
  return route.routeCode ? `${type} ${route.routeCode}` : type;
}

async function setTravelMode(mode) {
  if (!["vehicle", "foot"].includes(mode) || state.travelMode === mode) return;
  state.travelMode = mode;
  state.selectedTerminalId = null;
  renderTravelMode();
  setLoading("Oppdaterer valg");
  if (state.position) await refresh();
}

function renderTravelMode() {
  for (const button of elements.modeButtons) {
    const active = button.dataset.mode === state.travelMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.textContent = active
      ? `✓ ${button.dataset.mode === "vehicle" ? "Kjøretøy" : "Uten kjøretøy"}`
      : button.dataset.mode === "vehicle"
        ? "Kjøretøy"
        : "Uten kjøretøy";
  }
  elements.modeSummary.textContent = state.travelMode === "vehicle"
    ? "Valgt: kjøretøy"
    : "Valgt: uten kjøretøy";
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
  const response = await fetch(url);
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
      body: `${decision.routeName}: ${decision.marginMinutes} min margin. ${decision.recommendation}`,
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
