import type { LatLng, ResultVenue } from "@meetup/core";
import L from "leaflet";
import { useEffect, useRef } from "react";

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
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
      return;
    }
    layer.clearLayers();
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
      marker.bindTooltip(venue.name);
      marker.on("click", () => onSelectRef.current(venue.id));
      marker.addTo(layer);
      bounds.push([venue.location.lat, venue.location.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0]!, 14);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [origins, venues, seed, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) {
      return;
    }
    const venue = venues.find((v) => v.id === selectedId);
    if (venue) {
      map.panTo([venue.location.lat, venue.location.lng]);
    }
  }, [selectedId, venues]);

  return <div className="map" ref={containerRef} />;
}
