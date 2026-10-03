import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = normalize(join(__dirname, ".."));
const publicDir = join(rootDir, "public");

loadEnvFile(join(rootDir, ".env"));

const PORT = Number(process.env.PORT || 3000);
const ENTUR_CLIENT_NAME = process.env.ENTUR_CLIENT_NAME || "ferge-na-dev/0.1";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const VEGVESEN_DATEX_AUTH = process.env.VEGVESEN_DATEX_AUTH || process.env.DATEX_AUTH || "";
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

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

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
    "highSpeedPassengerService",
    "highSpeedVehicleService"
  ].includes(submode);
}

function routeSupportsTravelMode(route, travelMode) {
  if (travelMode === "vehicle") return ["localCarFerry", "highSpeedVehicleService"].includes(route.transportSubmode);
  return ["localCarFerry", "localPassengerFerry", "highSpeedPassengerService", "highSpeedVehicleService"].includes(route.transportSubmode);
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

async function getDriveRoute(origin, destination, travelMode) {
  if (travelMode === "vehicle") {
    try {
      const googleRoute = await getGoogleRoute(origin, destination);
      if (googleRoute) return googleRoute;
    } catch {
      // Fall through to OSRM, then final estimate.
    }

    try {
      const osrmRoute = await getOsrmDriveRoute(origin, destination);
      if (osrmRoute) return osrmRoute;
    } catch {
      // Fall through to final estimate.
    }
  }

  return fallbackDrive(origin, destination);
}

async function getRoutePath(origin, destination, travelMode) {
  let googlePath = null;
  if (GOOGLE_MAPS_API_KEY) {
    try {
      googlePath = await getGoogleRoutePath(origin, destination, travelMode);
    } catch {
      googlePath = null;
    }
  }
  if (googlePath?.points?.length > 1) return googlePath;

  let osrmPath = null;
  try {
    osrmPath = await getOsrmRoutePath(origin, destination, travelMode);
  } catch {
    osrmPath = null;
  }
  if (osrmPath?.points?.length > 1) return osrmPath;

  return {
    source: "fallback-straight",
    points: normalizeRoutePath([origin, destination])
  };
}

async function getOsrmDriveRoute(origin, destination) {
  const data = await fetchOsrmRoute(origin, destination, {
    overview: "false",
    geometries: "geojson"
  });
  const route = data.routes?.[0];
  if (!route) return null;
  const durationMinutes = Math.max(1, Math.ceil(Number(route.duration || 0) / 60));
  return {
    provider: "osrm",
    durationMinutes,
    normalMinutes: durationMinutes,
    trafficDelayMinutes: 0,
    distanceKm: Math.round((Number(route.distance || 0) / 1000) * 10) / 10
  };
}

async function getGoogleRoutePath(origin, destination, travelMode) {
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
    travelMode: travelMode === "foot" ? "WALK" : "DRIVE",
    routingPreference: travelMode === "foot" ? undefined : "TRAFFIC_AWARE_OPTIMAL",
    computeAlternativeRoutes: false,
    languageCode: "nb-NO",
    units: "METRIC"
  };

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": GOOGLE_MAPS_API_KEY,
      "x-goog-fieldmask": "routes.polyline.encodedPolyline"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Google Routes geometry failed with ${response.status}`);
  }

  const data = await response.json();
  const encoded = data.routes?.[0]?.polyline?.encodedPolyline;
  const points = encoded ? decodeGooglePolyline(encoded) : [];
  return {
    source: "google-routes",
    points: normalizeRoutePath(points)
  };
}

async function getOsrmRoutePath(origin, destination, travelMode) {
  if (travelMode !== "vehicle") return null;
  const data = await fetchOsrmRoute(origin, destination, {
    overview: "full",
    geometries: "geojson"
  });
  const coordinates = data.routes?.[0]?.geometry?.coordinates || [];
  return {
    source: "osrm",
    points: normalizeRoutePath(coordinates.map(([lon, lat]) => ({ lat, lon })))
  };
}

async function fetchOsrmRoute(origin, destination, options = {}) {
  const osrmUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}`);
  osrmUrl.searchParams.set("overview", options.overview || "false");
  osrmUrl.searchParams.set("geometries", options.geometries || "geojson");
  osrmUrl.searchParams.set("alternatives", "false");
  osrmUrl.searchParams.set("steps", "false");

  const response = await fetch(osrmUrl);
  if (!response.ok) throw new Error(`OSRM ${response.status}`);
  return response.json();
}

function decodeGooglePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    const latResult = decodePolylineValue(encoded, index);
    index = latResult.index;
    lat += latResult.value;

    const lonResult = decodePolylineValue(encoded, index);
    index = lonResult.index;
    lon += lonResult.value;

    points.push({
      lat: lat / 1e5,
      lon: lon / 1e5
    });
  }

  return points;
}

function decodePolylineValue(encoded, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = null;

  do {
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < encoded.length);

  return {
    index,
    value: result & 1 ? ~(result >> 1) : result >> 1
  };
}

function normalizeRoutePath(points) {
  const normalized = [];
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const rounded = {
      lat: Math.round(point.lat * 1_000_000) / 1_000_000,
      lon: Math.round(point.lon * 1_000_000) / 1_000_000
    };
    const previous = normalized[normalized.length - 1];
    if (!previous || previous.lat !== rounded.lat || previous.lon !== rounded.lon) {
      normalized.push(rounded);
    }
  }
  return normalized;
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
  const quayWaitMinutes = Math.max(0, minutesUntilDeparture - drive.normalMinutes);
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
    quayWaitMinutes,
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
  const candidates = destination
    ? await buildDestinationCandidates(sourceRoutes, origin, destination, travelMode)
    : buildNearestCandidates(sourceRoutes, origin);

  const nearby = candidates
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

function buildNearestCandidates(sourceRoutes, origin) {
  const byRoute = new Map();
  for (const terminal of sourceRoutes) {
    const departureDistanceKm = distanceKm(origin, terminal);
    const candidate = {
      ...terminal,
      distanceKm: roundKm(departureDistanceKm),
      arrivalDistanceKm: null,
      destinationGainKm: null,
      totalRouteKm: null,
      ferryLegLabel: null,
      relevanceScore: departureDistanceKm
    };
    const current = byRoute.get(candidate.routeId);
    if (!current || candidate.relevanceScore < current.relevanceScore) {
      byRoute.set(candidate.routeId, candidate);
    }
  }
  return [...byRoute.values()];
}

async function buildDestinationCandidates(sourceRoutes, origin, destination, travelMode) {
  let directDrive = null;
  let routePath = null;
  try {
    directDrive = await getDriveRoute(origin, destination, travelMode);
  } catch {
    directDrive = fallbackDrive(origin, destination);
  }
  try {
    routePath = await getRoutePath(origin, destination, travelMode);
  } catch {
    routePath = null;
  }

  const pathCandidates = routePath?.points?.length && routePath.source !== "fallback-straight"
    ? buildRoutePathFerryCandidates(sourceRoutes, routePath.points, directDrive)
    : [];
  const pathSequence = await buildRoutePathSequence(pathCandidates, sourceRoutes, origin, destination, directDrive, travelMode);
  const bestSequence = await buildBestEvaluatedFerrySequence(sourceRoutes, origin, destination, directDrive, travelMode);
  return chooseShortestCandidateSequence(pathSequence, bestSequence);
}

function chooseShortestCandidateSequence(...sequences) {
  const valid = sequences.filter((sequence) => sequence.length);
  if (!valid.length) return [];
  return valid.sort((a, b) => {
    const aKm = a[0].totalRouteKm ?? Infinity;
    const bKm = b[0].totalRouteKm ?? Infinity;
    if (Math.abs(aKm - bKm) > 5) return aKm - bKm;
    const aMin = a[0].totalNormalMinutes ?? Infinity;
    const bMin = b[0].totalNormalMinutes ?? Infinity;
    return aMin - bMin;
  })[0];
}

async function buildBestEvaluatedFerrySequence(sourceRoutes, origin, destination, directDrive, travelMode) {
  const legs = buildDirectedFerryLegs(sourceRoutes, origin, destination)
    .sort((a, b) => a.heuristicScore - b.heuristicScore)
    .slice(0, 36);
  if (!legs.length) return [];

  const driveCache = new Map();
  const drive = cachedDrive(driveCache, travelMode);

  const evaluated = [];
  for (const first of legs) {
    const oneLeg = await evaluateFerrySequence([first], origin, destination, directDrive, drive);
    if (oneLeg) evaluated.push(oneLeg);
    for (const second of legs) {
      if (!canFollowFerryLeg(first, second)) continue;
      const twoLegs = await evaluateFerrySequence([first, second], origin, destination, directDrive, drive);
      if (twoLegs) evaluated.push(twoLegs);
    }
  }

  const candidates = evaluated.sort((a, b) => a.score - b.score).slice(0, 40);
  let best = null;
  for (const candidate of candidates) {
    if (await sequenceHasHiddenFerry(candidate, sourceRoutes, travelMode)) continue;
    best = candidate;
    break;
  }

  if (!best) return [];
  const directMinutes = directDrive?.normalMinutes || fallbackDrive(origin, destination).normalMinutes;
  const improvesRoute = best.totalMinutes <= directMinutes - 15;
  const followsMainPath = best.routePathMatched;
  if (!improvesRoute && !followsMainPath) return [];

  return sequenceToRouteCandidates(best, directDrive);
}

async function buildRoutePathSequence(pathCandidates, sourceRoutes, origin, destination, directDrive, travelMode) {
  const ordered = pathCandidates
    .sort((a, b) => a.relevanceScore - b.relevanceScore)
    .filter((candidate, index, candidates) => candidates.findIndex((item) => item.routeId === candidate.routeId) === index);
  if (!ordered.length) return [];

  const legs = ordered.map((candidate) => ({
    departure: candidate,
    arrival: {
      id: candidate.arrivalId || `${candidate.routeId}:arrival`,
      name: `${candidate.arrivalSideName || candidate.oppositeSideName || "Ankomst"} ferjekai`,
      lat: candidate.arrivalLat,
      lon: candidate.arrivalLon
    },
    ferryLegKm: candidate.ferryLegKm,
    crossingMinutes: estimateFerryCrossingMinutes(candidate.routeId, candidate.ferryLegKm),
    departureProgress: candidate.relevanceScore,
    arrivalProgress: candidate.arrivalPathKm ?? candidate.relevanceScore + candidate.ferryLegKm,
    heuristicScore: candidate.relevanceScore
  }));

  if (legs.some((leg) => !Number.isFinite(leg.arrival.lat) || !Number.isFinite(leg.arrival.lon))) return [];

  const driveCache = new Map();
  const sequence = await evaluateFerrySequence(legs, origin, destination, directDrive, cachedDrive(driveCache, travelMode));
  if (!sequence) return [];
  if (await sequenceHasHiddenFerry(sequence, sourceRoutes, travelMode)) return [];
  return sequenceToRouteCandidates(sequence, directDrive);
}

function sequenceToRouteCandidates(sequence, directDrive) {
  let elapsedBeforeLeg = 0;
  const remainingAfterLegs = sequence.legs.map((leg) => {
    elapsedBeforeLeg += leg.driveToDeparture.normalMinutes + leg.crossingMinutes;
    return Math.max(0, sequence.totalMinutes - elapsedBeforeLeg);
  });

  return sequence.legs.map((leg, index) => ({
    ...leg.departure,
    distanceKm: roundKm(leg.driveToDeparture.distanceKm),
    arrivalDistanceKm: roundKm(leg.onwardDrive.distanceKm),
    destinationGainKm: roundKm(leg.onwardDrive.distanceKm),
    remainingNormalMinutes: remainingAfterLegs[index],
    totalRouteKm: roundKm(sequence.totalKm),
    ferryLegKm: roundKm(leg.ferryLegKm),
    arrivalSideName: stripKaiSuffix(leg.arrival.name),
    arrivalLat: leg.arrival.lat,
    arrivalLon: leg.arrival.lon,
    ferryLegLabel: `${stripKaiSuffix(leg.departure.name)}-${stripKaiSuffix(leg.arrival.name)}`,
    directRouteKm: directDrive ? roundKm(directDrive.distanceKm) : null,
    directNormalMinutes: directDrive?.normalMinutes || null,
    totalNormalMinutes: sequence.totalMinutes,
    relevanceScore: index
  }));
}

function cachedDrive(cache, travelMode) {
  return async (a, b) => {
    const key = `${a.lat.toFixed(5)},${a.lon.toFixed(5)}:${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
    if (!cache.has(key)) cache.set(key, getDriveRoute(a, b, travelMode));
    return cache.get(key);
  };
}

function buildDirectedFerryLegs(sourceRoutes, origin, destination) {
  const directKm = distanceKm(origin, destination);
  const maxCorridorKm = Math.max(18, Math.min(70, directKm * 0.28));
  const byRoute = new Map();
  for (const terminal of sourceRoutes) {
    if (!byRoute.has(terminal.routeId)) byRoute.set(terminal.routeId, []);
    byRoute.get(terminal.routeId).push(terminal);
  }

  const legs = [];
  for (const terminals of byRoute.values()) {
    for (const departure of terminals) {
      for (const arrival of terminals) {
        if (departure.id === arrival.id) continue;
        const departureProgress = routeProgress(origin, destination, departure);
        const arrivalProgress = routeProgress(origin, destination, arrival);
        if (arrivalProgress <= departureProgress + 0.01) continue;
        if (departureProgress < -0.12 || arrivalProgress > 1.12) continue;

        const departureCorridor = routeCorridorMetrics(origin, destination, departure).corridorKm;
        const arrivalCorridor = routeCorridorMetrics(origin, destination, arrival).corridorKm;
        if (Math.min(departureCorridor, arrivalCorridor) > maxCorridorKm) continue;

        const ferryLegKm = distanceKm(departure, arrival);
        if (ferryLegKm < 0.5 || ferryLegKm > 42) continue;

        legs.push({
          departure,
          arrival,
          ferryLegKm,
          crossingMinutes: estimateFerryCrossingMinutes(departure.routeId, ferryLegKm),
          departureProgress,
          arrivalProgress,
          heuristicScore: departureProgress * 100 + departureCorridor + arrivalCorridor + ferryLegKm * 0.25
        });
      }
    }
  }
  return legs;
}

function canFollowFerryLeg(first, second) {
  if (first.departure.routeId === second.departure.routeId) return false;
  return second.departureProgress > first.arrivalProgress + 0.03;
}

function estimateFerryCrossingMinutes(routeId, ferryLegKm) {
  return (routeMeta[routeId] || {}).crossingMinutes || Math.max(10, Math.round(10 + ferryLegKm * 1.6));
}

async function evaluateFerrySequence(legs, origin, destination, directDrive, drive) {
  try {
    let current = origin;
    let totalMinutes = 0;
    let totalKm = 0;
    const evaluatedLegs = [];
    const roadSegments = [];

    for (const leg of legs) {
      const driveToDeparture = await drive(current, leg.departure);
      totalMinutes += driveToDeparture.normalMinutes + leg.crossingMinutes;
      totalKm += driveToDeparture.distanceKm + leg.ferryLegKm;
      roadSegments.push({ from: current, to: leg.departure });
      evaluatedLegs.push({ ...leg, driveToDeparture });
      current = leg.arrival;
    }

    const finalDrive = await drive(current, destination);
    totalMinutes += finalDrive.normalMinutes;
    totalKm += finalDrive.distanceKm;
    roadSegments.push({ from: current, to: destination });

    for (let i = 0; i < evaluatedLegs.length; i += 1) {
      const onwardFromArrival = i === evaluatedLegs.length - 1
        ? finalDrive
        : await drive(evaluatedLegs[i].arrival, evaluatedLegs[i + 1].departure);
      evaluatedLegs[i].onwardDrive = onwardFromArrival;
    }

    const directMinutes = directDrive?.normalMinutes || Infinity;
    return {
      legs: evaluatedLegs,
      roadSegments,
      totalMinutes,
      totalKm,
      routePathMatched: totalMinutes <= directMinutes + 8,
      score: totalMinutes + totalKm * 0.03 + legs.length * 2
    };
  } catch {
    return null;
  }
}

async function sequenceHasHiddenFerry(sequence, sourceRoutes, travelMode) {
  const explicitRouteIds = new Set(sequence.legs.map((leg) => leg.departure.routeId));
  for (const segment of sequence.roadSegments) {
    if (distanceKm(segment.from, segment.to) < 1) continue;
    let path = null;
    try {
      path = await getRoutePath(segment.from, segment.to, travelMode);
    } catch {
      path = null;
    }
    if (!path?.points?.length || path.source === "fallback-straight") continue;
    const hidden = buildRoutePathFerryCandidates(sourceRoutes, path.points, null)
      .filter((candidate) => !explicitRouteIds.has(candidate.routeId));
    if (hidden.length) return true;
  }
  return false;
}

function buildRoutePathFerryCandidates(sourceRoutes, routePoints, directDrive) {
  const path = buildPathIndex(routePoints);
  const routesById = new Map();
  for (const terminal of sourceRoutes) {
    if (!routesById.has(terminal.routeId)) routesById.set(terminal.routeId, []);
    routesById.get(terminal.routeId).push(terminal);
  }

  const candidates = [];
  for (const terminals of routesById.values()) {
    const routeTerminals = terminals
      .map((terminal) => {
        const match = nearestPointOnPath(terminal, path);
        return { terminal, match };
      })
      .filter(({ match }) => match && match.distanceKm <= 2.2)
      .sort((a, b) => a.match.alongKm - b.match.alongKm);

    if (routeTerminals.length < 2) continue;

    for (let i = 0; i < routeTerminals.length - 1; i += 1) {
      const departure = routeTerminals[i];
      const arrival = routeTerminals[i + 1];
      const ferryLegKm = distanceKm(departure.terminal, arrival.terminal);
      const pathGapKm = arrival.match.alongKm - departure.match.alongKm;
      if (pathGapKm < 0.4 || ferryLegKm < 0.4) continue;
      if (pathGapKm > Math.max(24, ferryLegKm * 3.4)) continue;

      candidates.push({
        ...departure.terminal,
        distanceKm: roundKm(departure.match.alongKm),
        arrivalDistanceKm: roundKm(Math.max(0, path.totalKm - arrival.match.alongKm)),
        destinationGainKm: roundKm(path.totalKm - arrival.match.alongKm),
        totalRouteKm: roundKm(directDrive?.distanceKm || path.totalKm),
        ferryLegKm: roundKm(ferryLegKm),
        arrivalId: arrival.terminal.id,
        arrivalSideName: stripKaiSuffix(arrival.terminal.name),
        arrivalLat: arrival.terminal.lat,
        arrivalLon: arrival.terminal.lon,
        arrivalPathKm: arrival.match.alongKm,
        ferryLegLabel: `${stripKaiSuffix(departure.terminal.name)}-${stripKaiSuffix(arrival.terminal.name)}`,
        directRouteKm: directDrive ? roundKm(directDrive.distanceKm) : roundKm(path.totalKm),
        directNormalMinutes: directDrive?.normalMinutes || null,
        relevanceScore: departure.match.alongKm
      });
      break;
    }
  }

  return candidates;
}

function buildPathIndex(points) {
  const normalized = normalizeRoutePath(points);
  const cumulative = [0];
  for (let i = 1; i < normalized.length; i += 1) {
    cumulative[i] = cumulative[i - 1] + distanceKm(normalized[i - 1], normalized[i]);
  }
  return {
    points: normalized,
    cumulative,
    totalKm: cumulative[cumulative.length - 1] || 0
  };
}

function nearestPointOnPath(point, path) {
  if (path.points.length < 2) return null;
  let best = null;
  for (let i = 0; i < path.points.length - 1; i += 1) {
    const projected = projectPointToSegment(point, path.points[i], path.points[i + 1]);
    const segmentKm = distanceKm(path.points[i], path.points[i + 1]);
    const alongKm = path.cumulative[i] + segmentKm * projected.t;
    const distanceToSegmentKm = distanceKm(point, projected.point);
    if (!best || distanceToSegmentKm < best.distanceKm) {
      best = {
        distanceKm: distanceToSegmentKm,
        alongKm,
        segmentIndex: i
      };
    }
  }
  return best;
}

function projectPointToSegment(point, a, b) {
  const lat0 = toRad((point.lat + a.lat + b.lat) / 3);
  const p = { x: point.lon * Math.cos(lat0), y: point.lat };
  const start = { x: a.lon * Math.cos(lat0), y: a.lat };
  const end = { x: b.lon * Math.cos(lat0), y: b.lat };
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = p.x - start.x;
  const wy = p.y - start.y;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared)) : 0;
  return {
    t,
    point: {
      lat: start.y + vy * t,
      lon: (start.x + vx * t) / Math.cos(lat0)
    }
  };
}

async function refineDestinationCandidates(candidates, origin, destination, directDrive, travelMode) {
  const preselected = candidates
    .sort((a, b) => a.relevanceScore - b.relevanceScore)
    .slice(0, 18);
  const refined = [];

  for (const candidate of preselected) {
    const arrival = candidate.arrivalLat && candidate.arrivalLon
      ? { lat: candidate.arrivalLat, lon: candidate.arrivalLon }
      : null;
    if (!arrival) continue;

    let driveToFerry = null;
    let onwardDrive = null;
    try {
      driveToFerry = await getDriveRoute(origin, candidate, travelMode);
      onwardDrive = await getDriveRoute(arrival, destination, travelMode);
    } catch {
      continue;
    }

    const crossingMinutes = estimateFerryCrossingMinutes(candidate.routeId, candidate.ferryLegKm);
    const totalRouteKm = driveToFerry.distanceKm + candidate.ferryLegKm + onwardDrive.distanceKm;
    const totalMinutes = driveToFerry.normalMinutes + crossingMinutes + onwardDrive.normalMinutes;
    const directMinutes = directDrive?.normalMinutes || fallbackDrive(origin, destination).normalMinutes;
    const directKm = directDrive?.distanceKm || distanceKm(origin, destination);

    if (totalRouteKm > Math.max(directKm + 70, directKm * 1.28)) continue;
    if (totalMinutes > Math.max(directMinutes + 75, directMinutes * 1.28)) continue;

    refined.push({
      ...candidate,
      distanceKm: roundKm(driveToFerry.distanceKm),
      arrivalDistanceKm: roundKm(onwardDrive.distanceKm),
      totalRouteKm: roundKm(totalRouteKm),
      totalNormalMinutes: totalMinutes,
      directRouteKm: roundKm(directKm),
      directNormalMinutes: directMinutes,
      relevanceScore: totalMinutes + candidate.ferryLegKm * 1.5
    });
  }

  return refined;
}

function routeCorridorMetrics(origin, destination, point) {
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
  if (!lengthSquared) return { progress: 0, corridorKm: distanceKm(origin, point) };
  const progress = (wx * vx + wy * vy) / lengthSquared;
  const closest = {
    lat: oy + vy * Math.max(0, Math.min(1, progress)),
    lon: (ox + vx * Math.max(0, Math.min(1, progress))) / Math.cos(lat0)
  };
  return {
    progress,
    corridorKm: distanceKm(point, closest)
  };
}

function roundKm(value) {
  return Math.round(value * 10) / 10;
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
    drive = await getDriveRoute(origin, selected, travelMode);
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
    ? await buildDestinationSummary(origin, destination, selected, drive, crossingMinutes, sourceRoutes, travelMode)
    : null;

  sendJson(res, 200, {
    decision: buildDecision(selected, drive, enturSchedule, new Date(), destinationSummary),
    routeError,
    departureError
  });
}

async function buildDestinationSummary(origin, destination, selected, driveToFerry, crossingMinutes, sourceRoutes, travelMode) {
  const routeSequence = await buildDestinationCandidates(sourceRoutes, origin, destination, travelMode);
  const sequenceLeg = routeSequence.find((candidate) => candidate.id === selected.id);
  if (sequenceLeg?.totalNormalMinutes && Number.isFinite(sequenceLeg.remainingNormalMinutes)) {
    return {
      arrivalSideName: sequenceLeg.arrivalSideName,
      onwardDrive: {
        provider: "route-sequence",
        durationMinutes: sequenceLeg.remainingNormalMinutes,
        normalMinutes: sequenceLeg.remainingNormalMinutes,
        trafficDelayMinutes: 0,
        distanceKm: sequenceLeg.arrivalDistanceKm
      },
      totalTravelMinutes: sequenceLeg.totalNormalMinutes,
      totalNormalMinutes: sequenceLeg.totalNormalMinutes
    };
  }

  const arrivalMetrics = bestArrivalSideMetrics(origin, destination, selected);
  const arrivalQuay = arrivalMetrics?.quay;
  if (!arrivalQuay) return null;

  let onwardDrive = null;
  try {
    onwardDrive = await getDriveRoute(arrivalQuay, destination, "vehicle");
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
      alerts.push(...await getGoogleTrafficAlertsForLeg(origin, selected, "Til fergekaien"));
      alerts.push(...await getRoadMessagesForLeg(origin, selected, "Til fergekaien"));
    }

    if (selected && destination) {
      const arrivalMetrics = bestArrivalSideMetrics(origin, destination, selected);
      if (arrivalMetrics?.quay) {
        alerts.push(...await getGoogleTrafficAlertsForLeg(arrivalMetrics.quay, destination, "Fra ankomstkai"));
        alerts.push(...await getRoadMessagesForLeg(arrivalMetrics.quay, destination, "Fra ankomstkai"));
      }
    }
  } catch {
    // Missing external keys or unavailable traffic sources should not be shown to end users.
  }

  sendJson(res, 200, { alerts: dedupeAlerts(alerts).slice(0, 4) });
}

async function getMapRoute(_req, res, url) {
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

  if (destination) {
    const destinationPath = await getRoutePath(origin, destination, travelMode);
    if (destinationPath?.points?.length > 1 && destinationPath.source !== "fallback-straight") {
      return sendJson(res, 200, {
        source: destinationPath.source,
        points: limitRoutePath(destinationPath.points, 1200)
      });
    }
  }

  const sources = [];
  const path = [];
  const firstLeg = await getRoutePath(origin, selected, travelMode);
  sources.push(firstLeg.source);
  appendPath(path, firstLeg.points);

  if (destination) {
    const arrivalMetrics = bestArrivalSideMetrics(origin, destination, selected);
    const arrivalQuay = arrivalMetrics?.quay;
    if (arrivalQuay) {
      appendPath(path, [selected, arrivalQuay]);
      const onwardLeg = await getRoutePath(arrivalQuay, destination, travelMode);
      sources.push(onwardLeg.source);
      appendPath(path, onwardLeg.points);
    } else {
      const destinationLeg = await getRoutePath(selected, destination, travelMode);
      sources.push(destinationLeg.source);
      appendPath(path, destinationLeg.points);
    }
  }

  sendJson(res, 200, {
    source: [...new Set(sources)].join("+"),
    points: limitRoutePath(normalizeRoutePath(path), 1200)
  });
}

function appendPath(target, points) {
  for (const point of points || []) {
    const previous = target[target.length - 1];
    if (!previous || previous.lat !== point.lat || previous.lon !== point.lon) {
      target.push({ lat: point.lat, lon: point.lon });
    }
  }
}

function limitRoutePath(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const limited = [];
  const lastIndex = points.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const sourceIndex = Math.round((i / (maxPoints - 1)) * lastIndex);
    limited.push(points[sourceIndex]);
  }
  return normalizeRoutePath(limited);
}

async function getGoogleTrafficAlertsForLeg(origin, destination, legLabel) {
  if (!GOOGLE_MAPS_API_KEY) return [];
  try {
    const drive = await getGoogleRoute(origin, destination);
    if (!drive || drive.provider !== "google-routes" || drive.trafficDelayMinutes < 3) return [];
    return [{
      level: drive.trafficDelayMinutes >= 8 ? "warning" : "info",
      title: `${legLabel}: saktegående trafikk`,
      detail: `Google trafikkdata viser omtrent ${drive.trafficDelayMinutes} min forsinkelse på denne etappen.`
    }];
  } catch {
    return [];
  }
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
  if (!VEGVESEN_DATEX_AUTH) return [];
  const response = await fetch("https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata", {
    headers: {
      authorization: VEGVESEN_DATEX_AUTH,
      accept: "application/json"
    }
  });
  if (!response.ok) return [];
  const payload = await response.json();
  const corridor = makeRouteCorridor(origin, destination);
  return extractRoadMessages(payload)
    .filter(isRelevantRoadMessage)
    .filter((message) => !message.position || isNearRouteCorridor(message.position, corridor))
    .slice(0, 4);
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
      detail: normalizeName(String(ingress)).slice(0, 180),
      position: extractMessagePosition(value)
    });
  }

  for (const item of Object.values(value)) extractRoadMessages(item, messages);
  return messages;
}

function extractMessagePosition(value) {
  const text = JSON.stringify(value);
  const latMatch = text.match(/"latitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
  const lonMatch = text.match(/"longitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
  const lat = latMatch ? Number(latMatch[1]) : null;
  const lon = lonMatch ? Number(lonMatch[1]) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function makeRouteCorridor(origin, destination) {
  return {
    origin,
    destination,
    directKm: distanceKm(origin, destination),
    maxDistanceKm: Math.max(12, Math.min(45, distanceKm(origin, destination) * 0.12))
  };
}

function isNearRouteCorridor(point, corridor) {
  const progress = routeProgress(corridor.origin, corridor.destination, point);
  if (progress < -0.05 || progress > 1.05) return false;
  return routeCorridorMetrics(corridor.origin, corridor.destination, point).corridorKm <= corridor.maxDistanceKm;
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
    if (url.pathname === "/api/map-route") return getMapRoute(req, res, url);
    if (url.pathname === "/api/places") return getPlaces(req, res, url);

    return serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Ferge NÅ running on http://localhost:${PORT}`);
});
