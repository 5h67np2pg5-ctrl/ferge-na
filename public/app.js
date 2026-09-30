const state = {
  position: null,
  selectedTerminalId: null,
  destination: null,
  destinationSearchTimer: null,
  routes: []
};

const elements = {
  locateButton: document.querySelector("#locateButton"),
  notifyButton: document.querySelector("#notifyButton"),
  refreshButton: document.querySelector("#refreshButton"),
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
  sourceLabel: document.querySelector("#sourceLabel")
};

elements.locateButton.addEventListener("click", locate);
elements.notifyButton.addEventListener("click", enableNotifications);
elements.refreshButton.addEventListener("click", refresh);
elements.destinationInput.addEventListener("input", handleDestinationInput);
elements.destinationInput.addEventListener("focus", handleDestinationInput);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

seedDemo();

async function locate() {
  setLoading("Henter posisjon");

  if (!navigator.geolocation) {
    setDemoPosition("Nettleseren støtter ikke posisjon. Viser demo.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      state.position = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      await refresh();
    },
    () => setDemoPosition("Fikk ikke posisjon. Viser demo ved Halhjem."),
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

  setLoading("Oppdaterer");
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon)
  });

  const nearby = await fetchJson(`/api/ferries/nearby?${query}`);
  state.routes = nearby.routes || [];
  elements.sourceLabel.textContent = nearby.source === "entur-authoritative" ? "Entur" : "Fallback";

  if (!state.selectedTerminalId && state.routes[0]) {
    state.selectedTerminalId = state.routes[0].id;
  }

  renderRoutes();
  await updateDecision();
  await updateAlerts();
}

async function updateDecision() {
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon),
    terminalId: state.selectedTerminalId || ""
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

async function updateAlerts() {
  const query = new URLSearchParams({
    lat: String(state.position.lat),
    lon: String(state.position.lon)
  });
  const payload = await fetchJson(`/api/alerts?${query}`);
  renderAlerts(payload.alerts || []);
}

function renderRoutes() {
  elements.routeList.innerHTML = "";
  for (const route of state.routes) {
    const button = document.createElement("button");
    button.className = "route-card";
    button.type = "button";
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(route.sideName)} ferjekai</strong>
        <span>${escapeHtml(formatRouteDescriptor(route))} · ${escapeHtml(route.distanceKm)} km til avgangskai</span>
      </span>
      <em>Velg</em>
    `;
    button.addEventListener("click", async () => {
      state.selectedTerminalId = route.id;
      await updateDecision();
    });
    elements.routeList.append(button);
  }
}

function formatRouteDescriptor(route) {
  return route.routeCode ? `Samband ${route.routeCode}` : "Fergesamband";
}

function handleDestinationInput() {
  const text = elements.destinationInput.value.trim();
  window.clearTimeout(state.destinationSearchTimer);

  if (text.length < 2) {
    renderDestinationSuggestions([]);
    return;
  }

  state.destinationSearchTimer = window.setTimeout(async () => {
    const query = new URLSearchParams({ text });
    try {
      const payload = await fetchJson(`/api/places?${query}`);
      renderDestinationSuggestions(payload.places || []);
    } catch {
      renderDestinationSuggestions([]);
    }
  }, 180);
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
      elements.destinationInput.value = place.label;
      renderDestinationSuggestions([]);
    });
    elements.destinationSuggestions.append(button);
  }
}

function renderAlerts(alerts) {
  elements.noticeStack.innerHTML = "";
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
  renderAlerts([
    {
      level: "info",
      title: "Én hovedflate",
      detail: "Posisjon, samband, kjøretid, købuffer og varsler samles her."
    }
  ]);
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    renderAlerts([
      {
        level: "warning",
        title: "Varsler støttes ikke",
        detail: "Denne nettleseren kan ikke vise PWA-varsler."
      }
    ]);
    return;
  }

  const permission = await Notification.requestPermission();
  elements.notifyButton.textContent = permission === "granted" ? "Varsler på" : "Varsler av";

  if (permission === "granted") {
    new Notification("Ferge NÅ", {
      body: "Du får varsel når margin, kø eller avgang endrer seg.",
      icon: "/icon.svg"
    });
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
