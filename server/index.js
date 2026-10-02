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
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, ET-Client-Name"
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

const routeMeta = {};

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

function parseOptionalDestination(searchParams) {
  if (!searchParams.has("destLat") || !searchParams.has("destLon")) return null;
  const lat = Number(searchParams.get("destLat"));
  const lon = Number(searchParams.get("destLon"));
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

async function getEnturWaterRoutes({ force = false } = {}) {
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
      .filter((line) => isRelevantWaterLine(line.transportSubmode))
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

function isRelevantWaterLine(submode) {
  return [
    "localCarFerry",
    "localPassengerFerry",
    "highSpeedPassengerService"
  ].includes(submode);
}

function routeSupportsTravelMode(route, travelMode) {
  if (travelMode === "vehicle") return route.transportSubmode === "localCarFerry";
  return ["localCarFerry", "localPassengerFerry", "highSpeedPassengerService"].includes(route.transportSubmode);
}

function parseTravelMode(searchParams) {
  return searchParams.get("travelMode") === "foot" ? "foot" : "vehicle";
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
      quayCount: quays.length,
      lineQuays: quays
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

function buildDecision(route, drive, enturSchedule = {}, now = new Date(), destinationSummary = null) {
  const meta = routeMeta[route.routeId] || { intervalMinutes: 30, crossingMinutes: 25 };
  const bufferMinutes = Math.max(2, Math.min(12, Math.ceil(drive.durationMinutes * 0.12)));
  const neededMinutes = drive.durationMinutes + bufferMinutes;
  const departuresFromEntur = enturSchedule.departures || [];
  const departures = departuresFromEntur.length ? departuresFromEntur : nextDepartures(meta.intervalMinutes, 6, now);
  const reachable = departures.find((departure) => {
    const minutesUntil = Math.floor((departure.getTime() - now.getTime()) / 60_000);
    return minutesUntil - neededMinutes >= -3;
  }) || departures[departures.length - 1];

  const minutesUntilDeparture = Math.floor((reachable.getTime() - now.getTime()) / 60_000);
  const marginMinutes = minutesUntilDeparture - neededMinutes;
  const confidence = marginMinutes >= 8 ? "high" : marginMinutes >= 3 ? "medium" : "low";
  const crossingMinutes = enturSchedule.crossingMinutes || meta.crossingMinutes;
  const destinationText = destinationSummary
    ? `Til destinasjon: ${drive.normalMinutes} min til kai + ${crossingMinutes} min overfart + ${destinationSummary.onwardDrive.normalMinutes} min videre = ${destinationSummary.totalNormalMinutes} min.`
    : null;

  return {
    now: now.toISOString(),
    routeId: route.routeId,
    routeName: route.routeName,
    terminalId: route.id,
    terminalName: route.name,
    sideName: route.sideName,
    departureTime: reachable.toISOString(),
    departureLabel: reachable.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" }),
    minutesUntilDeparture,
    crossingMinutes,
    timetableSource: departuresFromEntur.length ? "entur" : "estimated",
    drive,
    bufferMinutes,
    marginMinutes,
    destinationSummary,
    confidence,
    status: confidence === "high" ? "Rekker trolig" : confidence === "medium" ? "Mulig, liten margin" : "Usikkert",
    recommendation:
      destinationText ||
      (confidence === "low"
        ? "Kjør nå, men planlegg for neste avgang."
        : "Kjør med normal fart og hold marginen.")
  };
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
          serviceJourneyEstimatedCalls {
            next {
              aimedArrivalTime
              expectedArrivalTime
            }
          }
        }
      }
    }
  `;

  const data = await enturGraphql(query, { id: quayId });
  const calls = (data.quay?.estimatedCalls || [])
    .filter((call) => !call.cancellation)
    .filter((call) => !lineId || call.serviceJourney?.line?.id === lineId);

  const departures = calls
    .map((call) => new Date(call.expectedDepartureTime || call.aimedDepartureTime))
    .filter((departure) => Number.isFinite(departure.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const crossingMinutes = firstCrossingMinutes(calls);
  return { departures, crossingMinutes };
}

function firstCrossingMinutes(calls) {
  for (const call of calls) {
    const departure = new Date(call.expectedDepartureTime || call.aimedDepartureTime);
    const next = call.serviceJourneyEstimatedCalls?.next?.[0];
    const arrival = new Date(next?.expectedArrivalTime || next?.aimedArrivalTime || "");
    if (Number.isFinite(departure.getTime()) && Number.isFinite(arrival.getTime())) {
      const minutes = Math.round((arrival.getTime() - departure.getTime()) / 60_000);
      if (minutes > 0 && minutes < 240) return minutes;
    }
  }
  return null;
}

async function getNearby(req, res, url) {
  const origin = parseLatLon(url.searchParams);
  if (!origin) return badRequest(res, "Mangler gyldig lat/lon.");
  const destination = parseOptionalDestination(url.searchParams);
  const travelMode = parseTravelMode(url.searchParams);

  const entur = await getEnturWaterRoutes();
  if (!entur.routes.length) {
    return sendJson(res, 503, {
      error: "Kunne ikke hente autoritative fergedata fra Entur.",
      source: "entur-unavailable",
      entur: {
        routeCount: 0,
        fetchedAt: entur.fetchedAt ? new Date(entur.fetchedAt).toISOString() : null,
        error: entur.error
      },
      travelMode,
      routes: []
    });
  }

  const sourceRoutes = entur.routes.filter((route) => routeSupportsTravelMode(route, travelMode));
  const byRoute = new Map();
  const originToDestinationKm = destination ? distanceKm(origin, destination) : null;

  for (const terminal of sourceRoutes) {
    const departureDistanceKm = distanceKm(origin, terminal);
    const arrivalMetrics = destination ? bestArrivalSideMetrics(origin, destination, terminal) : null;
    const arrivalDistanceKm = arrivalMetrics?.distanceKm ?? null;
    const departureToDestinationKm = destination ? distanceKm(terminal, destination) : null;
    const destinationGainKm =
      destination && Number.isFinite(arrivalDistanceKm) && Number.isFinite(departureToDestinationKm)
        ? departureToDestinationKm - arrivalDistanceKm
        : null;

    if (destination && Number.isFinite(destinationGainKm) && destinationGainKm <= 1) {
      continue;
    }

    if (destination && !passesRouteProgression(origin, destination, terminal, arrivalMetrics)) {
      continue;
    }

    const maxRelevantDepartureKm = destination
      ? Math.max(15, originToDestinationKm * 1.25)
      : Infinity;
    if (destination && departureDistanceKm > maxRelevantDepartureKm) {
      continue;
    }

    if (destination && Number.isFinite(originToDestinationKm) && Number.isFinite(arrivalDistanceKm)) {
      const viaFerryKm = departureDistanceKm + arrivalDistanceKm;
      const maxCorridorKm = Math.max(20, originToDestinationKm * 1.08);
      if (viaFerryKm > maxCorridorKm) {
        continue;
      }
    }

    const candidate = {
      ...terminal,
      distanceKm: Math.round(departureDistanceKm * 10) / 10,
      arrivalDistanceKm: Number.isFinite(arrivalDistanceKm) ? Math.round(arrivalDistanceKm * 10) / 10 : null,
      destinationGainKm: Number.isFinite(destinationGainKm) ? Math.round(destinationGainKm * 10) / 10 : null,
      relevanceScore: destination && Number.isFinite(arrivalDistanceKm)
        ? departureDistanceKm + arrivalDistanceKm * 0.55
        : departureDistanceKm
    };
    const current = byRoute.get(candidate.routeId);
    if (!current || candidate.relevanceScore < current.relevanceScore) {
      byRoute.set(candidate.routeId, candidate);
    }
  }

  const nearby = [...byRoute.values()]
    .sort((a, b) => a.relevanceScore - b.relevanceScore)
    .slice(0, Number(url.searchParams.get("limit") || 10));

  sendJson(res, 200, {
    source: "entur-authoritative",
    entur: {
      routeCount: entur.routes.length,
      fetchedAt: entur.fetchedAt ? new Date(entur.fetchedAt).toISOString() : null,
      error: entur.error
    },
    travelMode,
    routes: nearby
  });
}

function bestArrivalSideMetrics(origin, destination, terminal) {
  if (!Array.isArray(terminal.lineQuays)) return null;
  const otherQuays = terminal.lineQuays.filter((quay) => quay.id !== terminal.id);
  if (!otherQuays.length) return null;
  return otherQuays
    .map((quay) => ({
      quay,
      distanceKm: distanceKm(destination, quay),
      progress: routeProgress(origin, destination, quay)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
}

function passesRouteProgression(origin, destination, departure, arrivalMetrics) {
  if (!arrivalMetrics) return false;
  const originToDestinationKm = distanceKm(origin, destination);
  const departureProgress = routeProgress(origin, destination, departure);
  const arrivalProgress = arrivalMetrics.progress;
  const minProgressDelta = originToDestinationKm < 25 ? 0.05 : 0.035;

  if (departureProgress < -0.05 || departureProgress > 1.05) return false;
  return arrivalProgress - departureProgress >= minProgressDelta;
}

function routeProgress(origin, destination, point) {
  const lat0 = toRad((origin.lat + destination.lat) / 2);
  const ox = origin.lon * Math.cos(lat0);
  const oy = origin.lat;
  const dx = destination.lon * Math.cos(lat0);
  const dy = destination.lat;
  const px = point.lon * Math.cos(lat0);
  const py = point.lat;
  const vx = dx - ox;
  const vy = dy - oy;
  const wx = px - ox;
  const wy = py - oy;
  const lengthSquared = vx * vx + vy * vy;
  if (!lengthSquared) return 0;
  return (wx * vx + wy * vy) / lengthSquared;
}

async function getDecision(req, res, url) {
  const origin = parseLatLon(url.searchParams);
  if (!origin) return badRequest(res, "Mangler gyldig lat/lon.");

  const terminalId = url.searchParams.get("terminalId");
  const travelMode = parseTravelMode(url.searchParams);
  const destination = parseOptionalDestination(url.searchParams);
  const entur = await getEnturWaterRoutes();
  if (!entur.routes.length) {
    return sendJson(res, 503, { error: "Kunne ikke hente autoritative fergedata fra Entur." });
  }

  const sourceRoutes = entur.routes.filter((route) => routeSupportsTravelMode(route, travelMode));
  const selected =
    sourceRoutes.find((terminal) => terminal.id === terminalId) ||
    sourceRoutes
      .map((terminal) => ({ ...terminal, distanceKm: distanceKm(origin, terminal) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (!selected) {
    return sendJson(res, 404, { error: "Fant ingen fergestrekning for valgt reisemåte." });
  }

  let drive = null;
  let routeError = null;

  try {
    drive = await getGoogleRoute(origin, selected);
  } catch (error) {
    routeError = error.message;
  }

  if (!drive) drive = fallbackDrive(origin, selected);

  let enturSchedule = {};
  let departureError = null;
  if (selected.source === "entur") {
    try {
      enturSchedule = await fetchEnturDepartures(selected.id, selected.lineId);
    } catch (error) {
      departureError = error.message;
    }
  }

  const crossingMinutes = enturSchedule.crossingMinutes || (routeMeta[selected.routeId] || {}).crossingMinutes || 25;
  const destinationSummary = destination
    ? await buildDestinationSummary(origin, destination, selected, drive, crossingMinutes)
    : null;

  sendJson(res, 200, {
    decision: buildDecision(selected, drive, enturSchedule, new Date(), destinationSummary),
    routeError,
    departureError
  });
}

async function buildDestinationSummary(origin, destination, selected, driveToFerry, crossingMinutes) {
  const arrivalMetrics = bestArrivalSideMetrics(origin, destination, selected);
  const arrivalQuay = arrivalMetrics?.quay;
  if (!arrivalQuay) return null;

  let onwardDrive = null;
  try {
    onwardDrive = await getGoogleRoute(arrivalQuay, destination);
  } catch {
    onwardDrive = null;
  }
  if (!onwardDrive) onwardDrive = fallbackDrive(arrivalQuay, destination);

  return {
    arrivalSideName: stripKaiSuffix(arrivalQuay.name),
    onwardDrive,
    totalTravelMinutes: driveToFerry.durationMinutes + crossingMinutes + onwardDrive.durationMinutes,
    totalNormalMinutes: driveToFerry.normalMinutes + crossingMinutes + onwardDrive.normalMinutes
  };
}

async function getAlerts(_req, res, url) {
  const origin = parseLatLon(url.searchParams);
  if (!origin) return badRequest(res, "Mangler gyldig lat/lon.");

  const destination = parseOptionalDestination(url.searchParams);
  const terminalId = url.searchParams.get("terminalId");
  const travelMode = parseTravelMode(url.searchParams);
  const alerts = [];

  try {
    const entur = await getEnturWaterRoutes();
    const sourceRoutes = entur.routes.filter((route) => routeSupportsTravelMode(route, travelMode));
    const selected =
      sourceRoutes.find((terminal) => terminal.id === terminalId) ||
      sourceRoutes
        .map((terminal) => ({ ...terminal, distanceKm: distanceKm(origin, terminal) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    if (selected) {
      alerts.push(...await getRoadMessagesForLeg(origin, selected, "Til fergekaien"));
    }

    if (selected && destination) {
      const arrivalMetrics = bestArrivalSideMetrics(origin, destination, selected);
      if (arrivalMetrics?.quay) {
        alerts.push(...await getRoadMessagesForLeg(arrivalMetrics.quay, destination, "Fra ankomstkai"));
      }
    }
  } catch (error) {
    alerts.push({
      level: "muted",
      title: "Vegmeldinger utilgjengelig",
      detail: "Kunne ikke hente Statens vegvesen sine rutedata for vegarbeid eller kolonnekjøring akkurat nå."
    });
  }

  sendJson(res, 200, { alerts: dedupeAlerts(alerts).slice(0, 4) });
}

async function getRoadMessagesForLeg(origin, destination, legLabel) {
  const messages = await fetchVegvesenRouteMessages(origin, destination);
  return messages.map((message) => ({
    level: message.level,
    title: `${legLabel}: ${message.title}`,
    detail: message.detail
  }));
}

async function fetchVegvesenRouteMessages(origin, destination) {
  const from = wgs84ToUtm33(origin.lat, origin.lon);
  const to = wgs84ToUtm33(destination.lat, destination.lon);
  const routingUrl = new URL("https://www.vegvesen.no/ws/no/vegvesen/ruteplan/routingService_v1_0/routingService");
  routingUrl.searchParams.set("format", "json");
  routingUrl.searchParams.set("lang", "nb-NO");
  routingUrl.searchParams.set("returnDirections", "true");
  routingUrl.searchParams.set("returnGeometry", "false");
  routingUrl.searchParams.set("avoidRoadsTemporaryClosed", "false");
  routingUrl.searchParams.set("stops", `${from.easting},${from.northing};${to.easting},${to.northing}`);

  const response = await fetch(routingUrl);
  if (!response.ok) throw new Error(`Vegvesen rute ${response.status}`);
  const payload = await response.json();
  return extractRoadMessages(payload).filter(isRelevantRoadMessage).slice(0, 4);
}

function extractRoadMessages(value, messages = []) {
  if (!value || typeof value !== "object") return messages;
  if (Array.isArray(value)) {
    for (const item of value) extractRoadMessages(item, messages);
    return messages;
  }

  const type = String(value.AttributeType || value.attributeType || value.type || "");
  const text = JSON.stringify(value);
  if (/vegloggen|datex|trafikkmelding|kolonnekj/i.test(type + text)) {
    const values = collectAttributeValues(value);
    const heading = values.heading || values.HEADING || values.LOCATION_DESCRIPTION || values.DESCRIPTION || "Vegmelding";
    const ingress = values.ingress || values.DESCRIPTION || values.RESTRICTION_DESCRIPTION || values.MESSAGE_TYPE || type;
    messages.push({
      level: /kolonnekj|stengt|closed|vegarbeid|roadwork/i.test(`${type} ${ingress}`) ? "warning" : "info",
      title: normalizeName(String(heading)).slice(0, 90),
      detail: normalizeName(String(ingress)).slice(0, 180)
    });
  }

  for (const item of Object.values(value)) extractRoadMessages(item, messages);
  return messages;
}

function collectAttributeValues(value, result = {}) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectAttributeValues(item, result);
    return result;
  }
  if (value.key && value.value) result[value.key] = value.value;
  if (value.Key && value.Value) result[value.Key] = value.Value;
  for (const item of Object.values(value)) collectAttributeValues(item, result);
  return result;
}

function isRelevantRoadMessage(message) {
  const value = `${message.title} ${message.detail}`;
  return /vegarbeid|veg arbeid|roadwork|maintenance|kolonnekj|stengt|redusert framkommelighet|midlertidig/i.test(value);
}

function dedupeAlerts(alerts) {
  const seen = new Set();
  return alerts.filter((alert) => {
    const key = `${alert.title}:${alert.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wgs84ToUtm33(lat, lon) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e = Math.sqrt(f * (2 - f));
  const e2 = e * e;
  const ep2 = e2 / (1 - e2);
  const latRad = toRad(lat);
  const lonRad = toRad(lon);
  const lonOrigin = toRad(15);
  const n = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const t = Math.tan(latRad) ** 2;
  const c = ep2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonOrigin);
  const m = a * (
    (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
    ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
    ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
    ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad)
  );

  const easting = k0 * n * (
    A +
    ((1 - t + c) * A ** 3) / 6 +
    ((5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * A ** 5) / 120
  ) + 500000;

  const northing = k0 * (
    m +
    n * Math.tan(latRad) * (
      (A ** 2) / 2 +
      ((5 - t + 9 * c + 4 * c ** 2) * A ** 4) / 24 +
      ((61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * A ** 6) / 720
    )
  );

  return {
    easting: Math.round(easting * 10) / 10,
    northing: Math.round(northing * 10) / 10
  };
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
    "cache-control": [".html", ".js", ".css", ".webmanifest"].includes(ext) ? "no-store" : "public, max-age=3600"
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
