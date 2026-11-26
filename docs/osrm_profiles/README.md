# Otlobha Self-Hosted OpenStreetMap Routing (OSRM) & Nominatim Profiles
# Never rely on free public servers (router.project-osrm.org / nominatim.openstreetmap.org)
# for high-volume commercial production! Use separate OSRM instances per vehicle class:

## 1. Car Profile (`car_profile.lua`) — Port 5001 (`OSRM_CAR_URL=http://osrm-car:5000`)
- Standard OSRM `car.lua` profile.
- Allows `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `residential`.
- Blocks `footway`, `pedestrian`, `cycleway`, narrow alleys (`width < 2.2m`).
- Max highway speed: 100–120 km/h (Riyadh Ring Roads / regional highways).

## 2. Motorcycle Profile (`moto_profile.lua`) — Port 5002 (`OSRM_MOTO_URL=http://osrm-moto:5000`)
- Derived from `car.lua` with motorcycle-specific overrides:
  - `highway.living_street = 25`, `highway.service = 25`, `highway.residential = 38`.
  - Lower turn penalty (`turn_penalty = 4.5` vs `7.5` for cars) and narrower width tolerance (`width >= 1.1m`).
  - Allows urban arteries and primary/secondary streets; still excludes `footway`, `steps`, `pedestrian`.
  - Max speed capped at 80 km/h.

## 3. Tuk-Tuk Profile (`tuktuk_profile.lua`) — Port 5003 (`OSRM_TUKTUK_URL=http://osrm-tuktuk:5000`)
- Strictly neighborhood/local-road routing:
  - **Excludes** `motorway`, `motorway_link`, `trunk`, `trunk_link`, `expressway=yes`.
  - Allows `secondary`, `tertiary`, `unclassified`, `residential`, `living_street`, `service`.
  - Hard speed cap: `35 km/h` (`max_speed = 35`).
  - Avoids high-speed ring roads and intercity highways for passenger safety & local traffic law compliance.

## Docker Compose Quickstart (Saudi Arabia / Egypt OSM PBF from Geofabrik)
```bash
# Download regional PBF (e.g., gcc-states-latest.osm.pbf or egypt-latest.osm.pbf)
docker run -t -v $(pwd)/data:/data ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/region.osm.pbf
docker run -t -v $(pwd)/data:/data ghcr.io/project-osrm/osrm-backend osrm-partition /data/region.osrm
docker run -t -v $(pwd)/data:/data ghcr.io/project-osrm/osrm-backend osrm-customize /data/region.osrm
docker run -t -i -p 5001:5000 -v $(pwd)/data:/data ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/region.osrm
```

Then set in `.env`:
```env
OSRM_CAR_URL=https://osrm-car.otlobha.internal
OSRM_MOTO_URL=https://osrm-moto.otlobha.internal
OSRM_TUKTUK_URL=https://osrm-tuktuk.otlobha.internal
NOMINATIM_BASE_URL=https://nominatim.otlobha.internal
OSM_TILE_URL=https://tiles.otlobha.internal/{z}/{x}/{y}.png
```
Zero code changes are required in Web or Flutter apps when switching to private hosting!
