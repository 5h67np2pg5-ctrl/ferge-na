const state = {
  position: null,
  selectedTerminalId: null,
  travelMode: "vehicle",
  destination: null,
  destinationSearchTimer: null,
  routes: []
};

const APP_VERSION = "v29";
const API_BASE =
  window.location.hostname === "localhost" && window.location.port === "3000"
    ? "http://localhost:3002"
    : "";

const elements = {
  locateButton: document.querySelector("#locateButton"),
  refreshButton: document.querySelector("#refreshButton"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  modeSummary: document.querySelector("#modeSummary"),
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
  mapFrame: document.querySelector("#mapFrame"),
  mapTitle: document.querySelector("#mapTitle"),
  closeMapButton: document.querySelector("#closeMapButton")
};

elements.locateButton.addEventListener("click", locate);
elements.refreshButton.addEventListener("click", refresh);
elements.modeButtons.forEach((button) => button.addEventListener("click", () => setTravelMode(button.dataset.mode)));
elements.destinationInput.addEventListener("input", handleDestinationInput);
elements.destinationInput.addEventListener("focus", handleDestinationInput);
elements.destinationInput.addEventListener("keydown", handleDestinationKeydown);
elements.mapButton.addEventListener("click", showMap);
elements.closeMapButton.addEventListener("click", closeMap);
document.addEventListener("pointerdown", closeSuggestionsOnOutsideClick);

disableServiceWorkerCache();

initialize();

async function initialize() {
  seedDemo();
  renderTravelMode();
  await locate();
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

    state.routes = nearby.routes || [];
    elements.routeListTitle.textContent = destinationFiltered ? "Aktuelle samband" : "5 nærmeste samband";
    elements.sourceLabel.textContent = `${nearby.source === "entur-authoritative" ? "Entur" : "Ukjent"} · ${APP_VERSION}`;

    if (state.selectedTerminalId && !state.routes.some((route) => route.id === state.selectedTerminalId)) {
      state.selectedTerminalId = null;
    }

    renderRoutes();
    if (!state.routes.length) {
      clearDecision();
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
    elements.routeListTitle.textContent = "5 nærmeste samband";
    elements.sourceLabel.textContent = `Entur utilgjengelig · ${APP_VERSION}`;
    renderRoutes("Kunne ikke hente autoritative fergestrekninger akkurat nå.");
    clearDecision();
    renderAlerts([]);
  }
}

async function updateDecisionSafe() {
  const selectedRoute = getSelectedRoute();
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

function clearDecision() {
  elements.statusPill.textContent = "Ingen aktuell ferge";
  elements.statusPill.className = "status-pill low";
  elements.departureTime.textContent = "--:--";
  elements.normalDriveTime.textContent = "--";
  elements.margin.textContent = "--";
  elements.routeName.textContent = "Ingen aktuell avgangskai";
  elements.recommendation.textContent = "Endre destinasjon, reisemåte eller posisjon.";
  elements.crossingTime.textContent = "--";
  renderDestinationMetrics(null);
  hideMapButton();
}

function promptForRouteSelection() {
  elements.statusPill.textContent = "Velg samband";
  elements.statusPill.className = "status-pill";
  elements.departureTime.textContent = "--:--";
  elements.normalDriveTime.textContent = "--";
  elements.margin.textContent = "--";
  elements.routeName.textContent = "Velg fergestrekning";
  elements.recommendation.textContent = "Trykk på ønsket samband i listen for å hente neste avgang, kjøretid og overfart.";
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

  elements.statusPill.textContent = decision.status;
  elements.statusPill.className = `status-pill ${decision.confidence}`;
  elements.updatedAt.textContent = new Date(decision.now).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit"
  });
  elements.departureTime.textContent = decision.departureLabel;
  elements.normalDriveTime.textContent = `${decision.drive.normalMinutes} min`;
  elements.margin.textContent = formatMinutes(decision.quayWaitMinutes);
  elements.routeName.textContent = `${decision.sideName} ferjekai`;
  elements.recommendation.textContent = decision.recommendation;
  elements.crossingTime.textContent = `${decision.crossingMinutes} min`;
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
  return `${Math.max(0, Math.round(value))} min`;
}

function showMapButton() {
  elements.mapButton.hidden = !getSelectedRoute();
}

function hideMapButton() {
  elements.mapButton.hidden = true;
  closeMap();
}

function showMap() {
  const route = getSelectedRoute();
  if (!state.position || !route) return;

  elements.mapTitle.textContent = state.destination
    ? `${route.sideName} til ${state.destination.name || "destinasjon"}`
    : `Til ${route.sideName} ferjekai`;
  elements.mapFrame.src = buildMapUrl(route);
  elements.mapSheet.hidden = false;
}

function closeMap() {
  elements.mapSheet.hidden = true;
  elements.mapFrame.removeAttribute("src");
}

function buildMapUrl(route) {
  const origin = `${state.position.lat},${state.position.lon}`;
  const stops = [`${route.lat},${route.lon}`];
  if (state.destination) {
    if (Number.isFinite(route.arrivalLat) && Number.isFinite(route.arrivalLon)) {
      stops.push(`${route.arrivalLat},${route.arrivalLon}`);
    }
    stops.push(`${state.destination.lat},${state.destination.lon}`);
  }
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(stops.join(" to:"))}&dirflg=d&output=embed`;
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
      <em>${route.id === state.selectedTerminalId ? "Valgt" : "Velg"}</em>
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
  elements.routeListTitle.textContent = "5 nærmeste samband";
  elements.routeList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "empty-routes";
  loading.textContent = "Henter fergestrekninger...";
  elements.routeList.append(loading);
}

function getSelectedRoute() {
  return state.routes.find((route) => route.id === state.selectedTerminalId) || null;
}

function formatRouteDescriptor(route) {
  const type = route.transportSubmode === "localCarFerry" ? "bilferge" : "hurtigbåt";
  return route.routeCode ? `${type} ${route.routeCode}` : type;
}

function formatRouteTitle(route, index) {
  if (!state.destination) return `${route.sideName} ferjekai`;
  return `${index + 1} ferge: ${route.ferryLegLabel || `${route.sideName}-${route.oppositeSideName}`}`;
}

function formatRouteMeta(route) {
  const descriptor = formatRouteDescriptor(route);
  if (!state.destination) return `${descriptor} · ${route.distanceKm} km til avgangskai`;
  const total = Number.isFinite(route.totalRouteKm) ? ` · ${route.totalRouteKm} km total rute` : "";
  const arrival = route.arrivalSideName ? ` · videre fra ${route.arrivalSideName}` : "";
  return `${descriptor} · ${route.distanceKm} km til kai${arrival}${total}`;
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
