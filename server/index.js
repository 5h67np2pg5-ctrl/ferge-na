import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = normalize(join(__dirname, ".."));
const publicDir = join(rootDir, "public");

const PORT = Number(process.env.PORT || 3000);
const ENTUR_CLIENT_NAME = process.env.ENTUR_CLIENT_NAME || "ferge-na-dev/0.1";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const ENTUR_GRAPHQL_URL = "https://api.entur.io/journey-planner/v3/graphql";
const ENTUR_FERRY_CACHE_TTL_MS = 60 * 60 * 1000;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const terminals = [
  {
    id: "halhjem",
    name: "Halhjem ferjekai",
    routeId: "halhjem-sandvikvag",
    routeName: "Halhjem-Sandvikvåg",
    sideName: "Halhjem",
    oppositeSideName: "Sandvikvåg",
    lat: 60.14338,
    lon: 5.43355,
    priority: 1
  },
  {
    id: "sandvikvag",
    name: "Sandvikvåg ferjekai",
    routeId: "halhjem-sandvikvag",
    routeName: "Halhjem-Sandvikvåg",
    sideName: "Sandvikvåg",
    oppositeSideName: "Halhjem",
    lat: 59.93059,
    lon: 5.41956,
    priority: 1
  },
  {
    id: "hatvik",
    name: "Hatvik ferjekai",
    routeId: "hatvik-venjaneset",
    routeName: "Hatvik-Venjaneset",
    sideName: "Hatvik",
    oppositeSideName: "Venjaneset",
    lat: 60.209,
    lon: 5.537,
    priority: 1
  },
  {
    id: "venjaneset",
    name: "Venjaneset ferjekai",
    routeId: "hatvik-venjaneset",
    routeName: "Hatvik-Venjaneset",
    sideName: "Venjaneset",
    oppositeSideName: "Hatvik",
    lat: 60.20559,
    lon: 5.59345,
    priority: 1
  },
  {
    id: "lavik",
    name: "Lavik ferjekai",
    routeId: "lavik-oppedal",
    routeName: "Lavik-Oppedal",
    sideName: "Lavik",
    oppositeSideName: "Oppedal",
    lat: 61.1042,
    lon: 5.5146,
    priority: 2
  },
  {
    id: "oppedal",
    name: "Oppedal ferjekai",
    routeId: "lavik-oppedal",
    routeName: "Lavik-Oppedal",
    sideName: "Oppedal",
    oppositeSideName: "Lavik",
    lat: 61.08642,
    lon: 5.46064,
    priority: 2
  },
  {
    id: "mortavika",
    name: "Mortavika ferjekai",
    routeId: "mortavika-arsvagen",
    routeName: "Mortavika-Arsvågen",
    sideName: "Mortavika",
    oppositeSideName: "Arsvågen",
    lat: 59.06608,
    lon: 5.58846,
    priority: 1
  },
  {
    id: "arsvagen",
    name: "Arsvågen ferjekai",
    routeId: "mortavika-arsvagen",
    routeName: "Mortavika-Arsvågen",
    sideName: "Arsvågen",
    oppositeSideName: "Mortavika",
    lat: 59.23252,
    lon: 5.45922,
    priority: 1
  },
  {
    id: "bognes",
    name: "Bognes ferjekai",
    routeId: "bognes-skarberget",
    routeName: "Bognes-Skarberget",
    sideName: "Bognes",
    oppositeSideName: "Skarberget",
    lat: 68.22362,
    lon: 16.09838,
    priority: 3
  },
  {
    id: "skarberget",
    name: "Skarberget ferjekai",
    routeId: "bognes-skarberget",
    routeName: "Bognes-Skarberget",
    sideName: "Skarberget",
    oppositeSideName: "Bognes",
    lat: 68.19617,
    lon: 16.27765,
    priority: 3
  },
  {
    id: "moss",
    name: "Moss ferjekai",
    routeId: "moss-horten",
    routeName: "Moss-Horten",
    sideName: "Moss",
    oppositeSideName: "Horten",
    lat: 59.43364,
    lon: 10.65814,
    priority: 1
  },
  {
    id: "horten",
    name: "Horten ferjekai",
    routeId: "moss-horten",
    routeName: "Moss-Horten",
    sideName: "Horten",
    oppositeSideName: "Moss",
    lat: 59.4147,
    lon: 10.48501,
    priority: 1
  }
];

const routeMeta = {
  "halhjem-sandvikvag": { intervalMinutes: 30, crossingMinutes: 45 },
  "hatvik-venjaneset": { intervalMinutes: 20, crossingMinutes: 12 },
  "lavik-oppedal": { intervalMinutes: 20, crossingMinutes: 20 },
  "mortavika-arsvagen": { intervalMinutes: 30, crossingMinutes: 24 },
  "bognes-skarberget": { intervalMinutes: 45, crossingMinutes: 25 },
  "moss-horten": { intervalMinutes: 30, crossingMinutes: 30 }
};

let enturFerryCache = {
  fetchedAt: 0,
  routes: [],
  error: null
};

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function parseLatLon(searchParams) {
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function nextDepartures(intervalMinutes, count = 5, now = new Date()) {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const minutes = start.getMinutes();
  const nextSlot = Math.ceil(minutes / intervalMinutes) * intervalMinutes;
  start.setMinutes(nextSlot);
  const departures = [];
  for (let i = 0; i < count; i += 1) {
    departures.push(new Date(start.getTime() + i * intervalMinutes * 60_000));
  }
  return departures;
}

async function enturGraphql(query, variables = {}) {
  const response = await fetch(ENTUR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ET-Client-Name": ENTUR_CLIENT_NAME
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Entur ${response.status}`);
  }

  const data = await response.json();
  if (data.errors?.length) {
    throw new Error(data.errors.map((error) => error.message).join("; "));
  }
  return data.data;
}

async function getEnturCarFerryRoutes({ force = false } = {}) {
  const now = Date.now();
  if (!force && enturFerryCache.routes.length && now - enturFerryCache.fetchedAt < ENTUR_FERRY_CACHE_TTL_MS) {
    return enturFerryCache;
  }

  const query = `
    query FerryLines {
      lines(transportModes: [water]) {
        id
        name
        publicCode
        transportSubmode
        authority {
          id
          name
        }
        quays {
          id
          name
          latitude
          longitude
          stopPlace {
            id
            name
            latitude
            longitude
          }
        }
      }
    }
  `;

  try {
    const data = await enturGraphql(query);
    const routes = (data.lines || [])
      .filter((line) => line.transportSubmode === "localCarFerry")
      .flatMap((line) => normalizeEnturLine(line));

    enturFerryCache = { fetchedAt: now, routes, error: null };
    return enturFerryCache;
  } catch (error) {
    enturFerryCache = {
      ...enturFerryCache,
      error: error.message
    };
    return enturFerryCache;
  }
}

function normalizeEnturLine(line) {
  const quays = (line.quays || [])
    .map((quay) => ({
      id: quay.id,
      name: quay.name || quay.stopPlace?.name || "Ukjent ferjekai",
      lat: Number(quay.latitude ?? quay.stopPlace?.latitude),
      lon: Number(quay.longitude ?? quay.stopPlace?.longitude)
    }))
    .filter((quay) => quay.id && Number.isFinite(quay.lat) && Number.isFinite(quay.lon));

  if (quays.length < 2) return [];

  return quays.map((quay) => {
    const others = quays.filter((candidate) => candidate.id !== quay.id);
    const opposite = others.length === 1 ? stripKaiSuffix(others[0].name) : `${others.length} andre kaier`;
    return {
      id: quay.id,
      name: quay.name,
      routeId: line.id,
      lineId: line.id,
      routeName: formatRouteName(line),
      routeCode: line.publicCode || "",
      sideName: stripKaiSuffix(quay.name),
      oppositeSideName: opposite,
      lat: quay.lat,
      lon: quay.lon,
      priority: 1,
      source: "entur",
      authority: line.authority?.name || "Entur",
      transportSubmode: line.transportSubmode,
      quayCount: quays.length
    };
  });
}

function formatRouteName(line) {
  const name = normalizeName(line.name || "Ukjent fergesamband");
  return line.publicCode ? `${line.publicCode} ${name}` : name;
}

function normalizeName(value) {
  return String(value).replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
}

function stripKaiSuffix(value) {
  return normalizeName(value)
    .replace(/\s+ferje?kai$/i, "")
    .replace(/\s+kai$/i, "");
}

async function getGoogleRoute(origin, destination) {
  if (!GOOGLE_MAPS_API_KEY) return null;

  const body = {
    origin: {
      location: {
        latLng: { latitude: origin.lat, longitude: origin.lon }
      }
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lon }
      }
    },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    computeAlternativeRoutes: false,
    languageCode: "nb-NO",
    units: "METRIC"
  };

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": GOOGLE_MAPS_API_KEY,
      "x-goog-fieldmask": "routes.duration,routes.staticDuration,routes.distanceMeters"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Google Routes failed with ${response.status}`);
  }

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) return null;

  const durationSeconds = parseGoogleDuration(route.duration);
  const staticSeconds = parseGoogleDuration(route.staticDuration);
  const trafficDelaySeconds = Math.max(0, durationSeconds - staticSeconds);

  return {
    provider: "google-routes",
    durationMinutes: Math.ceil(durationSeconds / 60),
    normalMinutes: Math.ceil(staticSeconds / 60),
    trafficDelayMinutes: Math.ceil(trafficDelaySeconds / 60),
    distanceKm: Math.round((Number(route.distanceMeters || 0) / 1000) * 10) / 10
  };
}

function parseGoogleDuration(value) {
  if (typeof value !== "string") return 0;
  return Number(value.replace("s", "")) || 0;
}

function fallbackDrive(origin, destination) {
  const km = distanceKm(origin, destination);
  const minutes = Math.max(3, Math.ceil((km / 58) * 60));
  const accessPenalty = km > 25 ? 4 : 2;
  return {
    provider: "estimated",
    durationMinutes: minutes + accessPenalty,
    normalMinutes: minutes,
    trafficDelayMinutes: accessPenalty,
    distanceKm: Math.round(km * 10) / 10
  };
}

function buildDecision(route, drive, departuresFromEntur = [], now = new Date()) {
  const meta = routeMeta[route.routeId] || { intervalMinutes: 30, crossingMinutes: 25 };
  const bufferMinutes = Math.max(2, Math.min(12, Math.ceil(drive.durationMinutes * 0.12)));
  const queueMinutes = estimateQueueMinutes(drive.trafficDelayMinutes, route.priority);
  const neededMinutes = drive.durationMinutes + queueMinutes + bufferMinutes;
  const departures = departuresFromEntur.length ? departuresFromEntur : nextDepartures(meta.intervalMinutes, 6, now);
  const reachable = departures.find((departure) => {
    const minutesUntil = Math.floor((departure.getTime() - now.getTime()) / 60_000);
    return minutesUntil >= neededMinutes;
  }) || departures[departures.length - 1];

  const minutesUntilDeparture = Math.floor((reachable.getTime() - now.getTime()) / 60_000);
  const marginMinutes = minutesUntilDeparture - neededMinutes;
  const confidence = marginMinutes >= 8 ? "high" : marginMinutes >= 3 ? "medium" : "low";

  return {
    now: now.toISOString(),
    routeId: route.routeId,
    routeName: route.routeName,
    terminalId: route.id,
    terminalName: route.name,
    sideName: route.sideName,
    departureTime: reachable.toISOString(),
    departureLabel: reachable.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" }),
    crossingMinutes: meta.crossingMinutes,
    timetableSource: departuresFromEntur.length ? "entur" : "estimated",
    drive,
    queueMinutes,
    bufferMinutes,
    marginMinutes,
    confidence,
    status: confidence === "high" ? "Rekker trolig" : confidence === "medium" ? "Mulig, liten margin" : "Usikkert",
    recommendation:
      confidence === "low"
        ? "Kjør nå, men planlegg for neste avgang."
        : "Kjør med normal fart og hold marginen."
  };
}

function estimateQueueMinutes(trafficDelayMinutes, priority) {
  const liveDelay = Math.max(0, trafficDelayMinutes || 0);
  const terminalLoad = priority === 1 ? 3 : priority === 2 ? 2 : 1;
  return Math.min(25, Math.ceil(liveDelay * 0.65 + terminalLoad));
}

async function fetchEnturDepartures(quayId, lineId) {
  const query = `
    query Departures($id: String!) {
      quay(id: $id) {
        estimatedCalls(
          timeRange: 43200
          numberOfDepartures: 24
          arrivalDeparture: departures
          includeCancelledTrips: false
        ) {
          aimedDepartureTime
          expectedDepartureTime
          cancellation
          serviceJourney {
            line {
              id
            }
          }
        }
      }
    }
  `;

  const data = await enturGraphql(query, { id: quayId });
  return (data.quay?.estimatedCalls || [])
    .filter((call) => !call.cancellation)
    .filter((call) => !lineId || call.serviceJourney?.line?.id === lineId)
    .map((call) => new Date(call.expectedDepartureTime || call.aimedDepartureTime))
    .filter((departure) => Number.isFinite(departure.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}

async function getNearby(req, res, url) {
  const origin = parseLatLon(url.searchParams);
  if (!origin) return badRequest(res, "Mangler gyldig lat/lon.");

  const entur = await getEnturCarFerryRoutes();
  const sourceRoutes = entur.routes.length ? entur.routes : getCuratedFallbackRoutes();
  const byRoute = new Map();

  for (const terminal of sourceRoutes) {
    const candidate = {
      ...terminal,
      distanceKm: Math.round(distanceKm(origin, terminal) * 10) / 10
    };
    const current = byRoute.get(candidate.routeId);
    if (!current || candidate.distanceKm < current.distanceKm) {
      byRoute.set(candidate.routeId, candidate);
    }
  }

  const nearby = [...byRoute.values()]
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Number(url.searchParams.get("limit") || 10));

  sendJson(res, 200, {
    source: entur.routes.length ? "entur-authoritative" : "curated-fallback",
    entur: {
      routeCount: entur.routes.length,
      fetchedAt: entur.fetchedAt ? new Date(entur.fetchedAt).toISOString() : null,
      error: entur.error
    },
    routes: nearby
  });
}

async function getDecision(req, res, url) {
  const origin = parseLatLon(url.searchParams);
  if (!origin) return badRequest(res, "Mangler gyldig lat/lon.");

  const terminalId = url.searchParams.get("terminalId");
  const entur = await getEnturCarFerryRoutes();
  const sourceRoutes = entur.routes.length ? entur.routes : getCuratedFallbackRoutes();
  const selected =
    sourceRoutes.find((terminal) => terminal.id === terminalId) ||
    sourceRoutes
      .map((terminal) => ({ ...terminal, distanceKm: distanceKm(origin, terminal) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  let drive = null;
  let routeError = null;

  try {
    drive = await getGoogleRoute(origin, selected);
  } catch (error) {
    routeError = error.message;
  }

  if (!drive) drive = fallbackDrive(origin, selected);

  let departures = [];
  let departureError = null;
  if (selected.source === "entur") {
    try {
      departures = await fetchEnturDepartures(selected.id, selected.lineId);
    } catch (error) {
      departureError = error.message;
    }
  }

  sendJson(res, 200, {
    decision: buildDecision(selected, drive, departures),
    routeError,
    departureError
  });
}

function getCuratedFallbackRoutes() {
  return terminals.map((terminal) => ({ ...terminal, source: "curated-fallback" }));
}

async function getAlerts(_req, res, url) {
  const origin = parseLatLon(url.searchParams);
  if (!origin) return badRequest(res, "Mangler gyldig lat/lon.");

  const nearbyChargerCount = origin.lat > 66 ? 1 : 3;
  const conditions = [
    {
      id: "road-surface",
      level: origin.lat > 62 ? "warning" : "info",
      title: origin.lat > 62 ? "Mulig glatt føre" : "Ingen kritiske føremeldinger",
      detail: origin.lat > 62 ? "Sjekk fart og margin. Beregningen legger inn ekstra buffer." : "Live DATEX-kobling kan aktiveres i produksjon."
    },
    {
      id: "charging",
      level: "info",
      title: `${nearbyChargerCount} ladestasjoner langs aktuell rute`,
      detail: "NOBIL API kobles inn for effekt, kontakt og tilgjengelighet."
    },
    {
      id: "control-policy",
      level: "muted",
      title: "Kontrollvarsling er ikke inkludert",
      detail: "Appen varsler om sikkerhet, føre, kø og avvik, ikke geolokasjon for trafikkontroller."
    }
  ];

  sendJson(res, 200, { alerts: conditions });
}

async function getPlaces(_req, res, url) {
  const text = (url.searchParams.get("text") || "").trim();
  if (text.length < 2) {
    return sendJson(res, 200, { places: [] });
  }

  const geocoderUrl = new URL("https://api.entur.io/geocoder/v2/autocomplete");
  geocoderUrl.searchParams.set("text", text);
  geocoderUrl.searchParams.set("lang", "no");
  geocoderUrl.searchParams.set("size", "8");

  const response = await fetch(geocoderUrl, {
    headers: {
      "ET-Client-Name": ENTUR_CLIENT_NAME
    }
  });

  if (!response.ok) {
    throw new Error(`Entur geocoder ${response.status}`);
  }

  const data = await response.json();
  const places = (data.features || []).map((feature) => ({
    id: feature.properties?.id || feature.properties?.gid || feature.properties?.label,
    name: feature.properties?.name || feature.properties?.label,
    label: feature.properties?.label || feature.properties?.name,
    locality: feature.properties?.locality || feature.properties?.county || "",
    lat: feature.geometry?.coordinates?.[1],
    lon: feature.geometry?.coordinates?.[0]
  })).filter((place) => place.id && place.label && Number.isFinite(place.lat) && Number.isFinite(place.lon));

  sendJson(res, 200, { places });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, safePath));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const body = await readFile(filePath);
  const ext = extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600"
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        googleRoutes: Boolean(GOOGLE_MAPS_API_KEY),
        enturClientName: ENTUR_CLIENT_NAME
      });
    }

    if (url.pathname === "/api/ferries/nearby") return getNearby(req, res, url);
    if (url.pathname === "/api/decision") return getDecision(req, res, url);
    if (url.pathname === "/api/alerts") return getAlerts(req, res, url);
    if (url.pathname === "/api/places") return getPlaces(req, res, url);

    return serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Ferge NÅ running on http://localhost:${PORT}`);
});
