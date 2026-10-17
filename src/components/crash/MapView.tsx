import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Map as MLMap, Marker, GeoJSONSource, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import type { EdgeCollection, EdgeFeature, Experiment, RunMeta } from "@/lib/source";
import { C, colour, fmt, width } from "./model";
import { plaqueEl } from "./Plaque";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

type Props = {
  experiment: Experiment;
  hasResult: boolean;
  filterSite?: string | undefined;
  threshold: number;
  selectedStreet: string | null;
  onSelectStreet: (name: string) => void;
  meta?: RunMeta | undefined;
  children?: ReactNode;
};


// Free basemap with no API key. If it can't load, the map falls back to a plain white ground.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const BLANK: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } }],
};

// Which side of the dot each plaque sits on, so the four labels don't collide.
const PIN: Record<string, [number, number]> = {
  "Rue de Brosse": [-1, -1],
  "Rue François Miron": [1, -1],
  "Rue de Fourcy": [1, 1],
  "Rue des Nonnains d'Hyères": [-1, 1],
};

// Line width that grows a little as you zoom in. MapLibre needs "zoom" at the top level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zw = (w: any) => ["interpolate", ["linear"], ["zoom"], 14, ["*", 0.75, w], 16, w, 18, ["*", 1.7, w]] as never;

export function MapView({ experiment, hasResult, filterSite, threshold, selectedStreet, onSelectStreet, meta, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const geo = useRef<EdgeCollection | null>(null);
  const bounds = useRef<LngLatBoundsLike | null>(null);
  const markers = useRef<Marker[]>([]);
  const ml = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; name: string; line: string } | null>(null);

  const latest = useRef({ experiment, hasResult, onSelectStreet });
  latest.current = { experiment, hasResult, onSelectStreet };

  // Create the map once, client side only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [maplibre, data, style] = await Promise.all([
          import("maplibre-gl"),
          fetch("/geo/paris-hdv.geojson").then((r) => {
            if (!r.ok) throw new Error("Street geometry is missing");
            return r.json();
          }),
          fetch(BASEMAP)
            .then((r) => (r.ok ? r.json() : BLANK))
            .catch(() => BLANK),
        ]);
        if (cancelled || !holder.current) return;
        maplibre.setWorkerUrl(workerUrl);
        ml.current = maplibre;
        geo.current = data;
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        for (const f of data.features as EdgeFeature[])
          for (const [x, y] of f.geometry.coordinates) {
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
        bounds.current = [[x0, y0], [x1, y1]];
        const pad = 0.012;
        const m = new maplibre.Map({
          container: holder.current,
          style,
          bounds: bounds.current,
          fitBoundsOptions: { padding: 12 },
          maxBounds: [[x0 - pad, y0 - pad * 0.7], [x1 + pad, y1 + pad * 0.7]],
          minZoom: 13.5,
          maxZoom: 19,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: "Street data © OpenStreetMap contributors" }), "bottom-right");
        map.current = m;
        m.on("load", () => {
          m.addSource("edges", { type: "geojson", data });
          m.addLayer({
            id: "edges-sel", type: "line", source: "edges",
            filter: ["==", ["get", "street"], ""],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": C.ink, "line-opacity": 0.2, "line-width": zw(14) },
          });
          m.addLayer({
            id: "edges-base", type: "line", source: "edges",
            filter: ["all", ["!", ["get", "closed"]], ["!", ["get", "restricted"]]],
            layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["coalesce", ["get", "k"], 0] },
            paint: { "line-color": ["coalesce", ["get", "c"], C.mid], "line-width": zw(["coalesce", ["get", "w"], 2]) },
          });
          m.addLayer({
            id: "edges-restricted", type: "line", source: "edges",
            filter: ["get", "restricted"],
            layout: { "line-cap": "round" },
            paint: { "line-color": C.ink2, "line-width": 2, "line-dasharray": [0.5, 2.5] },
          });
          m.addLayer({
            id: "edges-closed", type: "line", source: "edges",
            filter: ["get", "closed"],
            layout: { "line-cap": "butt" },
            paint: { "line-color": C.ink, "line-width": zw(6), "line-dasharray": [1.6, 1] },
          });
          m.addLayer({
            id: "edges-hit", type: "line", source: "edges",
            paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 },
          });
          m.on("mousemove", "edges-hit", (e) => {
            const f = e.features?.[0];
            if (!f) return;
            m.getCanvas().style.cursor = "pointer";
            const p = f.properties as { id: string; street: string; closed: boolean | string; restricted: boolean | string };
            const isTrue = (v: boolean | string) => v === true || v === "true";
            const { experiment: E, hasResult: done } = latest.current;
            const d = E.edge_delta[p.id] || 0;
            const line = isTrue(p.closed)
              ? "Closed to eastbound cars"
              : isTrue(p.restricted)
                ? "No through cars"
                : !done
                  ? "Baseline"
                  : Math.abs(d) < 1
                    ? "No change"
                    : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))} cars/h vs baseline`;
            setTip({ x: e.point.x, y: e.point.y, name: p.street || "Unnamed street", line });
          });
          m.on("mouseleave", "edges-hit", () => {
            m.getCanvas().style.cursor = "";
            setTip(null);
          });
          m.on("click", "edges-hit", (e) => {
            const name = (e.features?.[0]?.properties as { street?: string })?.street;
            if (name) latest.current.onSelectStreet(name);
          });
          m.on("dragstart", () => setTip(null));
          setReady(true);
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "The map could not load");
      }
    })();
    return () => {
      cancelled = true;
      markers.current.forEach((mk) => mk.remove());
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Recolour streets when the scenario or threshold changes.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !geo.current) return;
    const E = experiment;
    const features = (geo.current.features as EdgeFeature[]).map((f) => {
      const d = E.edge_delta[f.properties.id] || 0;
      return { ...f, properties: { ...f.properties, c: colour(d, threshold), w: width(d, threshold), k: Math.abs(d) } };
    });
    (m.getSource("edges") as GeoJSONSource).setData({ type: "FeatureCollection", features } as never);
  }, [ready, experiment, threshold]);

  // Highlight the selected street.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setFilter("edges-sel", ["==", ["get", "street"], selectedStreet ?? ""]);
  }, [ready, selectedStreet]);

  // Plaques on streets over the limit, and a square where a street filter sits.
  useEffect(() => {
    const m = map.current;
    const maplibre = ml.current;
    if (!ready || !m || !maplibre) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const anchors = meta?.street_label_anchors ?? {};
    for (const v of experiment.violations) {
      const at = v.street ? anchors[v.street] : undefined;
      if (!v.robust || !v.street || !at) continue;
      const o = PIN[v.street] ?? [1, -1];
      const el = document.createElement("div");
      el.className = "pin";
      const dot = document.createElement("span");
      dot.className = "pin-dot";
      const p = plaqueEl(v.street);
      p.style.transform = `translate(${o[0] < 0 ? "calc(-100% - 10px)" : "10px"},${o[1] < 0 ? "calc(-100% - 8px)" : "8px"})`;
      el.append(dot, p);
      markers.current.push(new maplibre.Marker({ element: el, anchor: "center" }).setLngLat(at).addTo(m));
    }
    // F12 means both filters at once.
    const siteIds = filterSite === "F12" ? ["F1", "F2"] : filterSite ? [filterSite] : [];
    for (const sid of siteIds) {
    const site = meta?.filter_sites?.[sid];
    const siteAt = site ? anchors[site.street] : undefined;
    if (!siteAt) continue;
      const el = document.createElement("div");
      el.className = "filter-mark";
      el.title = "Street filter";
      markers.current.push(new maplibre.Marker({ element: el, anchor: "center" }).setLngLat(siteAt).addTo(m));
    }
  }, [ready, experiment, filterSite, meta]);

  const zoom = (dir: 1 | -1) => (dir > 0 ? map.current?.zoomIn() : map.current?.zoomOut());
  const fit = () => bounds.current && map.current?.fitBounds(bounds.current, { padding: 12 });

  return (
    <div className="mapbox" ref={box}>
      <div ref={holder} className="maphold" role="img" aria-label="Map of streets around Hôtel de Ville, coloured by change in cars per hour" />
      {!ready && !error && <div className="mapskel" aria-hidden="true" />}
      {error && <div className="maperr">{error}. Reload the page to try again.</div>}
      <div className="mapctl" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <button type="button" aria-label="Reset view" onClick={fit}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {tip && (
        <div className="tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.name}</b>
          {tip.line}
        </div>
      )}
      {children}
    </div>
  );
}
