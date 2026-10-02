# Ferge NÅ

Mobil først PWA for å svare på ett spørsmål: hvilken ferge rekker jeg fra posisjonen min nå?

## Kjør lokalt

```bash
npm run dev
```

Åpne `http://localhost:3000`.

Lokal `.env` leses automatisk hvis filen finnes.

## Miljøvariabler

Appen fungerer med demo/fallback-data uten nøkler. For produksjon:

```bash
GOOGLE_MAPS_API_KEY=...
ENTUR_CLIENT_NAME=ferge-na/0.1 kontakt@example.no
PORT=3000
```

På Railway skal samme `GOOGLE_MAPS_API_KEY` legges inn som miljøvariabel. Nøkkelen skal ikke ligge i Git.

## API-kilder

- Entur: rutetider, stoppesteder og sanntid der datakvalitet finnes.
- Google Routes: live kjøretid og køestimat inn mot fergeleie.
- Statens vegvesen DATEX: trafikkmeldinger, føre, vær og hendelser.
- NOBIL: ladestasjoner.
