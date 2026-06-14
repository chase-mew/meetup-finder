import type { LatLng, ResultVenue } from "@meetup/core";
import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { venuePopupHtml } from "../venuePopup";
import { CollapseIcon, ExpandIcon } from "./icons";

export interface MapOrigin {
  id: string;
  label: string;
  location: LatLng;
}

interface MapViewProps {
  origins: MapOrigin[];
  venues: ResultVenue[];
  seed?: LatLng;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const LONDON: [number, number] = [51.5074, -0.1278];

export function MapView({ origins, venues, seed, selectedId, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const venueMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const boundsRef = useRef<Array<[number, number]>>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [expanded, setExpanded] = useState(false);

  const fitToBounds = useCallback(() => {
    const map = mapRef.current;
    const bounds = boundsRef.current;
    if (!map || bounds.length === 0) {
      return;
    }
    if (bounds.length === 1) {
      map.setView(bounds[0]!, 14);
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, []);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) {
      return;
    }
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(LONDON, 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      venueMarkersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
      return;
    }
    layer.clearLayers();
    venueMarkersRef.current.clear();
    const bounds: Array<[number, number]> = [];

    origins.forEach((origin, index) => {
      const letter = String.fromCharCode(65 + index);
      const marker = L.marker([origin.location.lat, origin.location.lng], {
        icon: L.divIcon({
          className: "leaflet-pin",
          html: `<span class="pin pin--origin">${letter}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      });
      marker.bindTooltip(origin.label || `Person ${index + 1}`);
      marker.addTo(layer);
      bounds.push([origin.location.lat, origin.location.lng]);
    });

    if (seed) {
      L.marker([seed.lat, seed.lng], {
        icon: L.divIcon({
          className: "leaflet-pin",
          html: `<span class="pin pin--seed"></span>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        interactive: false,
      }).addTo(layer);
    }

    venues.forEach((venue, index) => {
      const isSelected = venue.id === selectedId;
      const marker = L.marker([venue.location.lat, venue.location.lng], {
        icon: L.divIcon({
          className: "leaflet-pin",
          html: `<span class="pin pin--venue${isSelected ? " is-selected" : ""}">${index + 1}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: isSelected ? 1000 : 0,
      });
      marker.bindPopup(venuePopupHtml(venue, index + 1), {
        className: "map-popup-shell",
        minWidth: 264,
        maxWidth: 320,
        autoPanPadding: [24, 32],
      });
      marker.on("click", () => onSelectRef.current(venue.id));
      marker.addTo(layer);
      venueMarkersRef.current.set(venue.id, marker);
      bounds.push([venue.location.lat, venue.location.lng]);
    });

    boundsRef.current = bounds;
  }, [origins, venues, seed, selectedId]);

  // Frame the markers when the underlying points change, but not on a mere
  // selection change, which should highlight without zooming the whole map out.
  useEffect(() => {
    fitToBounds();
  }, [origins, venues, seed, fitToBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) {
      return;
    }
    const venue = venues.find((v) => v.id === selectedId);
    if (venue) {
      map.panTo([venue.location.lat, venue.location.lng]);
    }
    venueMarkersRef.current.get(selectedId)?.openPopup();
  }, [selectedId, venues]);

  // Resizing the container leaves Leaflet showing grey tiles until it remeasures,
  // so invalidate the size (and reframe) whenever the expanded state flips.
  useEffect(() => {
    const map = mapRef.current;
    if (expanded) {
      document.body.classList.add("is-map-expanded");
    }
    const raf = requestAnimationFrame(() => {
      map?.invalidateSize();
      fitToBounds();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.classList.remove("is-map-expanded");
    };
  }, [expanded, fitToBounds]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <div className={"map-shell" + (expanded ? " map-shell--expanded" : "")}>
      <div className="map" ref={containerRef} />
      <button
        type="button"
        className="map__toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-pressed={expanded}
        aria-label={expanded ? "Collapse map" : "Expand map"}
        title={expanded ? "Collapse map" : "Expand map"}
      >
        {expanded ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </div>
  );
}
