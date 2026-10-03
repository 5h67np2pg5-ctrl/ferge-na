const state = {
  position: null,
  selectedTerminalId: null,
  travelMode: "vehicle",
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

const APP_VERSION = "v42";
const API_BASE =
  window.location.hostname === "localhost" && window.location.port === "3000"
    ? "http://localhost:3002"
    : "";

const elements = {
  frontPage: document.querySelector("#frontPage"),
  appShell: document.querySelector("#appShell"),
  enterAppButton: document.querySelector("#enterAppButton"),
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
  seedDemo();
  renderRouteLoading();
}

async function enterApp() {
  elements.frontPage.hidden = true;
  elements.appShell.hidden = false;
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
    const nearby = await fetchNearbyRoutes(true);
    const destinationFiltered = Boolean(state.destination);

    state.routes = nearby.routes || [];
    elements.routeListTitle.textContent = destinationFiltered ? "Aktuelle samband" : "5 nærmeste samband";
    elements.sourceLabel.textContent = `${nearby.source === "entur-authoritative" ? "Entur" : "Ukjent"} · ${APP_VERSION}`;

    if (state.selectedTerminalId && !state.routes.some((route) => route.id === state.selectedTerminalId)) {
      state.selectedTerminalId = null;
    }

    renderRoutes();
    if (!state.routes.length) {
      clearDecision(destinationFiltered
        ? "Fant ingen ferge på beregnet korteste rute til destinasjonen."
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

function clearDecision(message = null) {
  elements.statusPill.textContent = "Ingen aktuell ferge";
  elements.statusPill.className = "status-pill low";
  elements.departureTime.textContent = "--:--";
  elements.normalDriveTime.textContent = "--";
  elements.margin.textContent = "--";
  elements.routeName.textContent = "Ingen aktuell avgangskai";
  elements.recommendation.textContent = message || "Endre destinasjon eller posisjon.";
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
  elements.normalDriveTime.textContent = formatMinutes(decision.drive.normalMinutes);
  elements.margin.textContent = formatMinutes(decision.quayWaitMinutes);
  elements.routeName.textContent = `${decision.sideName} ferjekai`;
  elements.recommendation.textContent = decision.recommendation;
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
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} t ${rest} min` : `${hours} t`;
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
    ? `${route.sideName} til ${state.destination.name || "destinasjon"}`
    : `Til ${route.sideName} ferjekai`;
  state.map.points = buildMapPoints(route);
  state.map.path = [];
  state.map.selectedRouteId = route.id;
  state.map.lastPathOrigin = { ...state.position };
  state.map.followVehicle = true;
  elements.mapSheet.hidden = false;
  elements.mapCanvas.innerHTML = '<div class="map-loading">Henter vei...</div>';

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
      label: "Kjøretøy",
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
        label: `${route.arrivalSideName || route.oppositeSideName || "Ankomst"} ferjekai`
      });
    }
    points.push({
      lat: state.destination.lat,
      lon: state.destination.lon,
      type: "destination",
      label: state.destination.name || "Destinasjon"
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
