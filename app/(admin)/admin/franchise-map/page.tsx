'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  MapPin, CheckCircle2, Layers, BarChart3,
  ChevronRight, Globe, TrendingUp, PowerOff,
  Phone, User, Users, Trophy, Zap, ShoppingBag, KeyRound, MessageCircle, FileText, Rocket, Check, Settings2, ShieldOff, CalendarDays,
  Monitor, Package, BookOpen, DollarSign, Maximize2, X, Eye, EyeOff, Inbox, PhoneCall, MapPinned,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type BranchStats = {
  id: number;
  name: string;
  orders_today: number;
  revenue_today: number;
  orders_month: number;
  revenue_month: number;
  revenue_prev_month: number;
};

type BranchEmployee = {
  id: number;
  full_name: string;
  phone: string | null;
  branch_id: number;
  branch_name: string;
};

function fmt(n: number) {
  return n.toLocaleString('ru-RU');
}

/* ─── Данные точек ─── */
const ACTIVE_BRANCHES = [
  { id: 'belovodsk',  name: 'Беловодск',  city: 'Чуйская область, КР', lat: 42.8300, lng: 74.1070 },
  { id: 'sokuluk',    name: 'Сокулук',    city: 'Чуйская область, КР', lat: 42.8597, lng: 74.3110 },
  { id: 'kant',       name: 'Кант',       city: 'Чуйская область, КР', lat: 42.8907, lng: 74.8583 },
  { id: 'kara-balta', name: 'Кара-Балта', city: 'Чуйская область, КР', lat: 42.8077, lng: 73.8498 },
  { id: 'tokmok',     name: 'Токмок',     city: 'Чуйская область, КР', lat: 42.8370, lng: 75.2990 },
];

const PLANNED_BRANCHES = [
  { id: 'almaty',   name: 'Алматы',   country: 'Казахстан',  note: 'В поиске партнёра', lat: 43.2220, lng: 76.8512 },
  { id: 'astana',   name: 'Астана',   country: 'Казахстан',  note: 'В планах',           lat: 51.1801, lng: 71.4460 },
  { id: 'tashkent', name: 'Ташкент',  country: 'Узбекистан', note: 'Анализ рынка',       lat: 41.2995, lng: 69.2401 },
  { id: 'moscow',   name: 'Москва',   country: 'Россия',     note: 'В планах',           lat: 55.7558, lng: 37.6173 },
];

/* ─── Leaflet через CDN ─── */
function loadLeaflet(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).L) { resolve(); return; }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      // MarkerCluster CSS
      const mcCss = document.createElement('link');
      mcCss.rel = 'stylesheet';
      mcCss.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
      document.head.appendChild(mcCss);
      const mcCss2 = document.createElement('link');
      mcCss2.rel = 'stylesheet';
      mcCss2.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
      document.head.appendChild(mcCss2);
      // MarkerCluster JS
      const mcScript = document.createElement('script');
      mcScript.src = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';
      mcScript.onload = () => resolve();
      mcScript.onerror = reject;
      document.body.appendChild(mcScript);
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

/* ─── SVG для кастомных маркеров ─── */
function createActiveIcon(L: any, isHighlighted = false) {
  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#14b8a6,#06b6d4,#0ea5e9);
          border:3px solid white;box-shadow:0 0 0 3px rgba(20,184,166,0.4),0 4px 16px rgba(20,184,166,0.5);
          display:flex;align-items:center;justify-content:center;transition:transform 0.2s;
          ${isHighlighted ? 'transform:scale(1.25)' : ''}">
          <div style="width:8px;height:8px;border-radius:50%;background:white;"></div>
        </div>
        <div style="position:absolute;width:44px;height:44px;border-radius:50%;
          border:2px solid rgba(20,184,166,0.4);animation:ping 2s ease-out infinite;top:-8px;left:-8px;"></div>
      </div>
    `,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -18],
  });
}

function createPlannedIcon(L: any) {
  return L.divIcon({
    html: `
      <div style="width:20px;height:20px;border-radius:50%;background:white;
        border:2px solid #94a3b8;box-shadow:0 2px 8px rgba(0,0,0,0.15);
        display:flex;align-items:center;justify-content:center;">
        <div style="width:6px;height:6px;border-radius:50%;background:#94a3b8;"></div>
      </div>
    `,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  });
}

export default function FranchiseMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const densityLayerRef = useRef<any>(null);
  const competitorsLayerRef = useRef<any>(null);
  const incomeLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const [showSatellite, setShowSatellite] = useState(false);
  const satelliteLayerRef = useRef<any>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [competitorCount, setCompetitorCount] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [stats, setStats] = useState<BranchStats[]>([]);
  const [employees, setEmployees] = useState<BranchEmployee[]>([]);

  type FranchiseApp = { id: string; name: string; phone: string; city: string | null; budget: string | null; comment: string | null; status: string; admin_note: string | null; created_at: string };
  const [apps, setApps] = useState<FranchiseApp[]>([]);
  const [appNote, setAppNote] = useState<Record<string, string>>({});
  const sbRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);
  function sb() {
    if (!sbRef.current) sbRef.current = getBrowserSupabase();
    return sbRef.current;
  }

  useEffect(() => {
    // Выручка по филиалам — прямой запрос
    (async () => {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

      const { data: orders } = await sb()
        .from('orders')
        .select('branch_id, total_amount, created_at')
        .gte('created_at', prevMonthStart);

      const { data: branches } = await sb()
        .from('branches')
        .select('id, name')
        .order('id');

      if (!orders || !branches) return;

      const map: Record<number, BranchStats> = {};
      for (const b of branches) {
        map[b.id] = { id: b.id, name: b.name, orders_today: 0, revenue_today: 0, orders_month: 0, revenue_month: 0, revenue_prev_month: 0 };
      }
      for (const o of orders) {
        const bid = o.branch_id as number;
        if (!map[bid]) continue;
        const amt = Number(o.total_amount) || 0;
        const dateStr = (o.created_at as string).slice(0, 10);
        if (dateStr === todayStr) { map[bid].orders_today++; map[bid].revenue_today += amt; }
        if (o.created_at >= monthStart) { map[bid].orders_month++; map[bid].revenue_month += amt; }
        else { map[bid].revenue_prev_month += amt; }
      }
      setStats(Object.values(map).sort((a, b) => b.revenue_month - a.revenue_month));
    })();

    // Сотрудники
    sb().from('employees')
      .select('id, full_name, phone, branch_id, branches(name)')
      .eq('is_active', true)
      .neq('full_name', 'TEST SERVICE QA WEEKLY')
      .order('branch_id')
      .then(({ data }) => {
        if (!data) return;
        setEmployees((data as any[]).map(e => ({
          id: e.id,
          full_name: e.full_name,
          phone: e.phone,
          branch_id: e.branch_id,
          branch_name: e.branches?.name ?? '',
        })));
      });

    // Заявки на франшизу
    sb().from('franchise_applications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setApps(data as FranchiseApp[]);
      });
  }, []);

  async function updateAppStatus(id: string, status: string) {
    await sb().from('franchise_applications').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a));
  }

  async function saveAppNote(id: string) {
    const note = appNote[id];
    if (note === undefined) return;
    await sb().from('franchise_applications').update({ admin_note: note, updated_at: new Date().toISOString() }).eq('id', id);
    setApps(prev => prev.map(a => a.id === id ? { ...a, admin_note: note } : a));
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    loadLeaflet()
      .then(() => {
        const L = (window as any).L;

        // CSS анимации
        const style = document.createElement('style');
        style.textContent = `
          @keyframes ping {
            0% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(2.5); opacity: 0; }
          }
          .leaflet-container { background: #1e293b !important; }
          .density-tooltip { background: rgba(15,23,42,0.92); color: #f1f5f9; border: 1px solid rgba(6,182,212,0.3); border-radius: 8px; padding: 6px 10px; font-size: 12px; font-family: Inter, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
          .density-tooltip .leaflet-tooltip-tip { border-top-color: rgba(15,23,42,0.92); }
          .competitor-tooltip { background: rgba(127,29,29,0.92); color: #fecaca; border: 1px solid rgba(239,68,68,0.4); border-radius: 8px; padding: 5px 9px; font-size: 11px; font-family: Inter, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
          .competitor-tooltip .leaflet-tooltip-tip { border-top-color: rgba(127,29,29,0.92); }
        `;
        document.head.appendChild(style);

        // Создаём карту
        const map = L.map(mapRef.current, {
          center: [50, 80],
          zoom: 4,
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: true,
          minZoom: 3,
          maxZoom: 16,
          maxBounds: [[22, 28], [82, 160]],
          maxBoundsViscosity: 0.9,
        });

        // Жестко фиксируем фокус на нашем регионе (КР, КЗ, РФ, УЗБ)
        // [Юго-запад], [Северо-восток]
        map.fitBounds([[35, 30], [77, 140]], { padding: [10, 10] });

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // === Тайловый слой ===
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap © CARTO',
          subdomains: 'abcd',
          maxZoom: 19,
        }).addTo(map);

        // === Pane для подписей городов ===
        map.createPane('labels');
        (map.getPane('labels') as HTMLElement).style.zIndex = '400';
        (map.getPane('labels') as HTMLElement).style.pointerEvents = 'none';

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
          pane: 'labels',
          subdomains: 'abcd',
          maxZoom: 19,
        }).addTo(map);

        // === Pane для страновых оверлеев и маски ===
        map.createPane('countriesMask');
        (map.getPane('countriesMask') as HTMLElement).style.zIndex = '350';
        map.createPane('countriesBorder');
        (map.getPane('countriesBorder') as HTMLElement).style.zIndex = '360';
        (map.getPane('countriesBorder') as HTMLElement).style.pointerEvents = 'none';

        // === ГРАНИЦЫ ИЗ OSM (максимальная точность ~1м) ===
        const COUNTRY_GEO: { id: string; file: string; name: string; labelLat: number; labelLng: number }[] = [
          { id: 'kg', file: '/geo/kg.json', name: 'Кыргызстан', labelLat: 41.5, labelLng: 74.5 },
          { id: 'kz', file: '/geo/kz.json', name: 'Казахстан', labelLat: 48.0, labelLng: 67.0 },
          { id: 'uz', file: '/geo/uz.json', name: 'Узбекистан', labelLat: 41.3, labelLng: 64.5 },
          { id: 'ru', file: '/geo/ru.json', name: 'Россия', labelLat: 62, labelLng: 95 },
        ];

        Promise.all(COUNTRY_GEO.map(c => fetch(c.file).then(r => r.json()).then(geometry => ({ ...c, geometry }))))
          .then(countries => {
            // Anti-meridian fix для России (Чукотка)
            const ru = countries.find(c => c.id === 'ru');
            if (ru) {
              const fixRing = (ring: any[]) => { ring.forEach(pt => { if (pt[0] < 0) pt[0] += 360; }); };
              if (ru.geometry.type === 'Polygon') ru.geometry.coordinates.forEach(fixRing);
              else if (ru.geometry.type === 'MultiPolygon') ru.geometry.coordinates.forEach((poly: any) => poly.forEach(fixRing));
            }

            // Маска затенения (весь мир с дырками для наших стран)
            const holes: number[][][] = [];
            countries.forEach(c => {
              if (c.geometry.type === 'Polygon') holes.push(c.geometry.coordinates[0]);
              else if (c.geometry.type === 'MultiPolygon') c.geometry.coordinates.forEach((poly: any) => holes.push(poly[0]));
            });

            const worldBox = [[-360, -90], [360, -90], [360, 90], [-360, 90], [-360, -90]];
            L.geoJSON({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [worldBox, ...holes] } } as any, {
              pane: 'countriesMask',
              smoothFactor: 0,
              style: { fillColor: '#0f172a', fillOpacity: 0.65, weight: 0, color: 'transparent', interactive: false },
            }).addTo(map);

            // Границы + подписи
            countries.forEach(c => {
              const feat = { type: 'Feature', geometry: c.geometry, properties: { name: c.name } };
              L.geoJSON(feat as any, {
                pane: 'countriesBorder',
                smoothFactor: 0,
                style: { fillColor: 'transparent', fillOpacity: 0, weight: 2, color: '#06b6d4', opacity: 0.9, dashArray: '3, 6' },
              }).addTo(map);

              L.marker([c.labelLat, c.labelLng], {
                pane: 'countriesBorder',
                interactive: false,
                icon: L.divIcon({
                  html: `<div style="display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.85);border-radius:8px;backdrop-filter:blur(4px);padding:5px 12px;border:1px solid rgba(6,182,212,0.4);color:#0891b2;font-size:12px;font-weight:700;font-family:Inter,sans-serif;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.1)">${c.name}</div>`,
                  className: '', iconSize: undefined as any, iconAnchor: [30, 15],
                }),
              } as any).addTo(map);
            });
          })
          .catch(err => console.error('Error loading OSM borders:', err));

        // === МАРКЕРЫ ===
        ACTIVE_BRANCHES.forEach(b => {
          L.marker([b.lat, b.lng], { icon: createActiveIcon(L) })
            .addTo(map);
        });

        PLANNED_BRANCHES.forEach(b => {
          L.marker([b.lat, b.lng], { icon: createPlannedIcon(L) })
            .addTo(map);
        });

        // === ГОРОДА-МИЛЛИОННИКИ ===
        const MILLION_CITIES: [number, number, number, string, string][] = [
          // [lat, lng, население(млн), название, страна]
          // Кыргызстан
          [42.875, 74.590, 1.1, 'Бишкек', 'kg'],
          // Казахстан
          [43.238, 76.946, 2.1, 'Алматы', 'kz'],
          [51.128, 71.430, 1.4, 'Астана', 'kz'],
          [42.315, 69.597, 1.1, 'Шымкент', 'kz'],
          // Узбекистан
          [41.299, 69.240, 3.0, 'Ташкент', 'uz'],
          // Россия
          [55.756, 37.617, 13.1, 'Москва', 'ru'],
          [59.939, 30.316, 5.6, 'Санкт-Петербург', 'ru'],
          [54.983, 82.897, 1.6, 'Новосибирск', 'ru'],
          [56.839, 60.607, 1.5, 'Екатеринбург', 'ru'],
          [55.796, 49.106, 1.3, 'Казань', 'ru'],
          [54.990, 73.368, 1.2, 'Омск', 'ru'],
          [53.195, 50.100, 1.2, 'Самара', 'ru'],
          [56.297, 43.936, 1.3, 'Нижний Новгород', 'ru'],
          [47.236, 39.713, 1.1, 'Ростов-на-Дону', 'ru'],
          [55.160, 61.403, 1.1, 'Челябинск', 'ru'],
          [45.035, 38.976, 1.1, 'Краснодар', 'ru'],
          [54.735, 55.959, 1.1, 'Уфа', 'ru'],
          [56.010, 92.872, 1.1, 'Красноярск', 'ru'],
          [58.010, 56.250, 1.1, 'Пермь', 'ru'],
          [51.672, 39.184, 1.1, 'Воронеж', 'ru'],
          [48.708, 44.513, 1.0, 'Волгоград', 'ru'],
        ];

        const COUNTRY_COLORS: Record<string, string> = {
          kg: '#ef4444', kz: '#22d3ee', uz: '#10b981', ru: '#a78bfa',
        };

        const millionPane = map.createPane('millionCities');
        (millionPane as HTMLElement).style.zIndex = '450';
        // Скрыть по умолчанию — показывать только при приближении
        (millionPane as HTMLElement).style.display = 'none';

        MILLION_CITIES.forEach(([lat, lng, pop, name, country]) => {
          const size = pop >= 5 ? 18 : pop >= 2 ? 14 : 11;
          const accent = COUNTRY_COLORS[country] || '#fff';
          const popLabel = `${pop.toFixed(1)} млн`;

          L.marker([lat, lng], {
            pane: 'millionCities',
            icon: L.divIcon({
              html: `
                <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;pointer-events:auto;">
                  <div style="
                    width:${size}px;height:${size}px;border-radius:50%;
                    background:${accent};border:2px solid rgba(255,255,255,0.9);
                    box-shadow:0 0 0 3px ${accent}44,0 2px 8px rgba(0,0,0,0.3);
                  "></div>
                  <div style="
                    background:rgba(15,23,42,0.88);backdrop-filter:blur(4px);
                    border-radius:6px;padding:2px 7px;border:1px solid ${accent}55;
                    box-shadow:0 2px 8px rgba(0,0,0,0.25);
                  ">
                    <span style="color:#f1f5f9;font-size:11px;font-weight:700;font-family:Inter,sans-serif;">${name}</span>
                    <span style="color:${accent};font-size:10px;font-weight:600;font-family:Inter,sans-serif;margin-left:4px;">${popLabel}</span>
                  </div>
                </div>
              `,
              className: '',
              iconSize: [0, 0],
              iconAnchor: [size / 2, size / 2],
            }),
            interactive: false,
          } as any).addTo(map);
        });

        // === Zoom-зависимая видимость слоёв ===
        // Подписи стран — только с zoom >= 5, города — с zoom >= 6
        function updateLayerVisibility() {
          const z = map.getZoom();
          const countryBorderPane = map.getPane('countriesBorder') as HTMLElement | undefined;
          const millionCitiesPane = map.getPane('millionCities') as HTMLElement | undefined;
          if (countryBorderPane) countryBorderPane.style.display = z >= 5 ? '' : 'none';
          if (millionCitiesPane) millionCitiesPane.style.display = z >= 6 ? '' : 'none';
        }
        map.on('zoomend', updateLayerVisibility);
        // Начальное состояние
        updateLayerVisibility();

        mapInstanceRef.current = map;
        setMapReady(true);
      })
      .catch(() => setMapError(true));

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  function flyTo(lat: number, lng: number, zoom = 11) {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], zoom, { animate: true, duration: 1.2 });
    }
  }

  function toggleDensity() {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;

    // Выключение
    if (densityLayerRef.current) {
      map.removeLayer(densityLayerRef.current);
      densityLayerRef.current = null;
      setShowDensity(false);
      return;
    }

    // Landsat Settlement — застроенные территории (30 м, зум до 12)
    // На любом зуме показывает где живут люди — единый слой без переключений
    const layer = L.tileLayer(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_Human_Built-up_And_Settlement_Extent/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png',
      { maxNativeZoom: 12, maxZoom: 16, minZoom: 0, opacity: 0.65 }
    );
    layer.addTo(map);
    densityLayerRef.current = layer;
    setShowDensity(true);
  }

  async function toggleCompetitors() {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;

    if (competitorsLayerRef.current) {
      map.removeLayer(competitorsLayerRef.current);
      competitorsLayerRef.current = null;
      setShowCompetitors(false);
      return;
    }

    // Убедимся что markercluster загружен
    if (!L.markerClusterGroup) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';
        s.onload = () => resolve();
        s.onerror = reject;
        document.body.appendChild(s);
      });
    }

    try {
      const res = await fetch('/geo/opticians.json');
      const data: [number, number, string, string][] = await res.json();
      setCompetitorCount(data.length);

      const cluster = L.markerClusterGroup({
        maxClusterRadius: 40,
        disableClusteringAtZoom: 14,
        spiderfyOnMaxZoom: false,
        chunkedLoading: true,
        chunkInterval: 100,
        iconCreateFunction: (c: any) => {
          const count = c.getChildCount();
          const size = count > 100 ? 44 : count > 30 ? 36 : 28;
          return L.divIcon({
            html: `<div style="
              width:${size}px;height:${size}px;border-radius:50%;
              background:rgba(220,38,38,0.85);border:2px solid rgba(255,255,255,0.8);
              color:white;font-size:${size > 36 ? 12 : 11}px;font-weight:700;
              display:flex;align-items:center;justify-content:center;
              font-family:Inter,sans-serif;
              box-shadow:0 2px 8px rgba(220,38,38,0.4);
            ">${count > 999 ? Math.round(count / 1000) + 'к' : count}</div>`,
            className: '',
            iconSize: [size, size],
          });
        },
      });

      const markers = data.map(([lat, lng, name]) =>
        L.marker([lat, lng], {
          icon: L.divIcon({
            html: `<div style="width:10px;height:10px;border-radius:50%;background:#ef4444;border:1.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
            className: '',
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
        }).bindTooltip(`<b>${name}</b>`, {
          direction: 'top', offset: [0, -6], className: 'competitor-tooltip',
        })
      );

      cluster.addLayers(markers);
      map.addLayer(cluster);
      competitorsLayerRef.current = cluster;
      setShowCompetitors(true);
    } catch (err) {
      console.error('Competitors load error:', err);
    }
  }

  function toggleFocusMode() {
    const map = mapInstanceRef.current;
    if (!map) return;
    const next = !focusMode;
    // Всегда скрываемые в focus mode
    ['labels', 'countriesMask', 'markerPane'].forEach(name => {
      const pane = map.getPane(name);
      if (pane) pane.style.display = next ? 'none' : '';
    });
    // Zoom-зависимые слои: при выходе из focus mode восстанавливаем по текущему zoom
    const z = map.getZoom();
    const cbPane = map.getPane('countriesBorder') as HTMLElement | undefined;
    const mcPane = map.getPane('millionCities') as HTMLElement | undefined;
    if (cbPane) cbPane.style.display = next ? 'none' : (z >= 5 ? '' : 'none');
    if (mcPane) mcPane.style.display = next ? 'none' : (z >= 6 ? '' : 'none');
    setFocusMode(next);
  }

  function toggleSatellite() {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;

    if (satelliteLayerRef.current) {
      map.removeLayer(satelliteLayerRef.current);
      satelliteLayerRef.current = null;
      setShowSatellite(false);
      return;
    }

    const sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri', maxZoom: 19, opacity: 0.9 }
    );
    sat.addTo(map);
    // Поместить под маркеры но над базовым слоем
    sat.setZIndex(1);
    satelliteLayerRef.current = sat;
    setShowSatellite(true);
  }

  function toggleIncome() {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;

    if (incomeLayerRef.current) {
      map.removeLayer(incomeLayerRef.current);
      incomeLayerRef.current = null;
      setShowIncome(false);
      return;
    }

    // VIIRS Black Marble — ночные огни (NASA, чистый композит)
    // maxZoom = maxNativeZoom = 8, не растягиваем тайлы — чёткая картинка
    const nightlights = L.tileLayer(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
      { maxNativeZoom: 8, maxZoom: 8, minZoom: 0, opacity: 0.85 }
    );

    nightlights.addTo(map);
    incomeLayerRef.current = nightlights;
    setShowIncome(true);
  }

  function toggleFullscreen() {
    const mapContainer = mapRef.current?.closest('.map-fs-wrapper') as HTMLElement | null;
    if (!mapContainer) return;

    if (!document.fullscreenElement) {
      mapContainer.requestFullscreen().then(() => {
        setFullscreen(true);
        setTimeout(() => mapInstanceRef.current?.invalidateSize(), 100);
      }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => {
        setFullscreen(false);
        setTimeout(() => mapInstanceRef.current?.invalidateSize(), 100);
      }).catch(() => {});
    }
  }

  // Синхронизация если пользователь выходит через Escape (браузерный fullscreen)
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && fullscreen) {
        setFullscreen(false);
        setTimeout(() => mapInstanceRef.current?.invalidateSize(), 100);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [fullscreen]);

  // Блокируем скролл страницы когда курсор над картой — Leaflet сам зумит
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  return (
    <div className="text-slate-50">

      {/* ═══ ХЕДЕР ═══ */}
      <div className="space-y-4 mb-6">

        {/* Header (бренд-стандарт) */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">Сеть франшизы</div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Интерактивная карта · КР, Казахстан, Узбекистан, Россия
              </div>
            </div>
          </div>
          {/* Счётчики */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/20 px-3.5 py-2">
              <CheckCircle2 className="h-4 w-4 text-cyan-400" />
              <span className="text-[18px] font-bold text-white tabular-nums">5</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">точек</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/20 px-3.5 py-2">
              <Globe className="h-4 w-4 text-cyan-400" />
              <span className="text-[18px] font-bold text-white tabular-nums">1</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">страна</span>
            </div>
          </div>
        </div>

        {/* ── Навигационные плитки ── */}
        <div className="space-y-3">
          {/* Управление сетью */}
          <div>
            <div className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300/60">Управление сетью</div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { href: '/admin/franchise', icon: BarChart3, label: 'Центр управления', sub: 'Филиалы, выручка, команда' },
                { href: '/admin/devices', icon: Monitor, label: 'Центр устройств', sub: 'Терминалы и обновления' },
                { href: '/admin/franchise-finance', icon: DollarSign, label: 'Финансы', sub: 'Роялти и паушальный' },
              ].map(item => (
                <Link key={item.href} href={item.href}
                  className="group flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
                    <item.icon className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{item.sub}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Настройка и снабжение */}
          <div>
            <div className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300/60">Настройка и снабжение</div>
            <div className="grid grid-cols-4 gap-2.5">
              {[
                { href: '/admin/franchise-ramp-up/setup', icon: Settings2, label: 'Настройка', sub: 'Организации, филиалы' },
                { href: '/admin/franchise-portal', icon: KeyRound, label: 'Доступы', sub: 'Логины портала' },
                { href: '/admin/franchise-supply', icon: Package, label: 'Снабжение', sub: 'Заказы и планы' },
                { href: '/admin/franchise-chat', icon: MessageCircle, label: 'Чат', sub: 'Переписка' },
              ].map(item => (
                <Link key={item.href} href={item.href}
                  className="group flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-50 ring-1 ring-cyan-200">
                    <item.icon className="h-4 w-4 text-cyan-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{item.sub}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Документация + Запуск/Отключение */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Документация */}
            <div>
              <div className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300/60">Документация</div>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { href: '/admin/franchise-hq', icon: BookOpen, label: 'Материалы HQ' },
                  { href: '/admin/franchise-docs', icon: FileText, label: 'Документы' },
                  { href: '/admin/franchise-calendar', icon: CalendarDays, label: 'Календарь' },
                ].map(item => (
                  <Link key={item.href} href={item.href}
                    className="group flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-50 ring-1 ring-cyan-200">
                      <item.icon className="h-4 w-4 text-cyan-600" />
                    </div>
                    <span className="text-[12px] font-semibold text-slate-900">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
            {/* Запуск / Отключение */}
            <div>
              <div className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300/60">Запуск / Закрытие</div>
              <div className="grid grid-cols-2 gap-2.5">
                <Link href="/admin/franchise-ramp-up/onboarding"
                  className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                    <Rocket className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-slate-900">Запуск</div>
                    <div className="text-[10px] text-slate-500">Путь до открытия</div>
                  </div>
                </Link>
                <Link href="/admin/franchise-ramp-up/offboarding"
                  className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-slate-300">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100">
                    <ShieldOff className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-slate-500">Отключение</div>
                    <div className="text-[10px] text-slate-500">Деактивация точки</div>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ═══ ОТКРЫТИЕ ФРАНШИЗ ═══ */}
      <LaunchProgressBlock />

      {/* ═══ КАРТА И СПИСКИ ═══ */}
      <div className="flex flex-col gap-6">

        {/* ── Контейнер карты ── */}
        <div className="map-fs-wrapper w-full rounded-2xl overflow-hidden ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] relative bg-[#1e293b]"
          style={{ minHeight: '830px' }}>
          {!mapReady && !mapError && (
            <div className="absolute inset-0 bg-slate-50 flex flex-col items-center justify-center z-10 gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-cyan-200 border-t-cyan-500 animate-spin" />
              <span className="text-sm text-slate-500 font-medium">Загрузка карты...</span>
            </div>
          )}
          {mapError && (
            <div className="absolute inset-0 bg-slate-50 flex flex-col items-center justify-center z-10 gap-2">
              <MapPin size={32} className="text-slate-300" />
              <span className="text-slate-500">Карта недоступна</span>
            </div>
          )}
          <div ref={mapRef} className="w-full h-full absolute inset-0" />

          {/* Кнопки управления картой */}
          {mapReady && (
            <div className="absolute top-4 left-4 z-[500] flex items-center gap-2">
              <button
                onClick={toggleDensity}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg backdrop-blur-sm transition-all ${
                  showDensity
                    ? 'bg-cyan-500/90 text-white ring-2 ring-cyan-300'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-cyan-300'
                }`}
              >
                <Users size={16} />
                Плотность населения
              </button>
              <button
                onClick={toggleCompetitors}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg backdrop-blur-sm transition-all ${
                  showCompetitors
                    ? 'bg-red-500/90 text-white ring-2 ring-red-300'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-red-300'
                }`}
              >
                <Eye size={16} />
                Конкуренты{showCompetitors && competitorCount > 0 ? ` (${competitorCount.toLocaleString('ru-RU')})` : ''}
              </button>
              <button
                onClick={toggleIncome}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg backdrop-blur-sm transition-all ${
                  showIncome
                    ? 'bg-amber-500/90 text-white ring-2 ring-amber-300'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-amber-300'
                }`}
              >
                <DollarSign size={16} />
                Доход населения
              </button>
              <button
                onClick={toggleSatellite}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg backdrop-blur-sm transition-all ${
                  showSatellite
                    ? 'bg-emerald-600/90 text-white ring-2 ring-emerald-300'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-emerald-300'
                }`}
              >
                <Layers size={16} />
                Спутник
              </button>
              <button
                onClick={toggleFocusMode}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold shadow-lg backdrop-blur-sm transition-all ${
                  focusMode
                    ? 'bg-slate-800/90 text-white ring-2 ring-slate-500'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-slate-400'
                }`}
                title={focusMode ? 'Показать всё' : 'Скрыть всё лишнее'}
              >
                {focusMode ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              {!fullscreen && (
                <button
                  onClick={toggleFullscreen}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold shadow-lg backdrop-blur-sm bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-cyan-300 transition-all"
                  title="На весь экран"
                >
                  <Maximize2 size={16} />
                </button>
              )}
            </div>
          )}

          {/* Крестик выхода из fullscreen */}
          {fullscreen && (
            <button
              onClick={toggleFullscreen}
              className="absolute top-4 right-4 z-[500] w-10 h-10 flex items-center justify-center rounded-xl bg-white backdrop-blur-sm text-slate-700 ring-1 ring-slate-200 shadow-lg hover:bg-red-50 hover:text-red-600 hover:ring-red-300 transition-all"
            >
              <X size={20} />
            </button>
          )}

          {/* Легенда */}
          {showDensity && (
            <div className="absolute bottom-4 left-4 z-[500] rounded-xl bg-white backdrop-blur-sm ring-1 ring-slate-200 shadow-lg px-4 py-3 max-w-[260px]">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Застроенные территории</div>
              <div className="flex items-center gap-2 text-[10px] text-slate-600">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#e8873a' }} />
                <span>Landsat · спутник 30м · NASA GIBS</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-2">Приближай для детализации до уровня кварталов</div>
            </div>
          )}

          {/* Легенда дохода */}
          {showIncome && (
            <div className="absolute bottom-4 left-4 z-[500] rounded-xl bg-slate-900/90 backdrop-blur-sm ring-1 ring-amber-500/30 shadow-lg px-4 py-3 max-w-[280px]">
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2">Экономическая активность</div>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="h-3 flex-1 rounded-sm" style={{ background: 'linear-gradient(90deg, #0a0a0a, #1a1a2e, #4a3f00, #c59b00, #ffe066, #ffffff)' }} />
              </div>
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>Низкий доход</span>
                <span>Высокий доход</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-2 leading-relaxed">
                Ночные огни со спутника NASA VIIRS — проверенный индикатор экономической активности (World Bank, МВФ). Ярче = богаче.
              </div>
            </div>
          )}
        </div>

        {/* ── Списки (под картой) ── */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Активные */}
          <div className="rounded-2xl bg-white ring-1 ring-emerald-200 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500">
                <CheckCircle2 className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-800">Кыргызстан — Чуйская обл.</span>
              <span className="ml-auto text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2 py-0.5">5 точек</span>
            </div>
            <div className="space-y-1">
              {ACTIVE_BRANCHES.map(b => (
                <button
                  key={b.id}
                  onClick={() => { flyTo(b.lat, b.lng); setSelectedBranch(b.id); }}
                  className={`w-full flex items-center justify-between group rounded-xl px-3 py-2.5 transition-all text-left
                    ${selectedBranch === b.id ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full bg-teal-500 transition-all
                      ${selectedBranch === b.id ? 'shadow-[0_0_8px_rgba(20,184,166,0.8)] scale-125' : ''}`}
                    />
                    <span className="text-[13px] font-medium text-slate-800 group-hover:text-slate-900">{b.name}</span>
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2 py-0.5">Работает</span>
                </button>
              ))}
            </div>
          </div>

          {/* Заявки на франшизу — компактный блок-ссылка */}
          <Link href="/admin/franchise-applications"
            className="group flex items-center gap-4 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 transition hover:ring-cyan-300/40">
            <div className="relative">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
                <Inbox className="h-5 w-5 text-white" />
              </div>
              {apps.filter(a => a.status === 'new').length > 0 && (
                <div className="absolute -top-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full bg-rose-500 animate-pulse">
                  <span className="text-[11px] font-bold text-white">{apps.filter(a => a.status === 'new').length}</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-slate-900">Заявки на франшизу</div>
              <div className="mt-0.5 text-[12px] text-slate-500">
                {apps.length === 0
                  ? 'Пока нет заявок'
                  : `${apps.length} заявок · ${apps.filter(a => a.status === 'new').length} новых`}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500 transition-colors" />
          </Link>

        </div>

        {/* ═══ ПУЛЬС СЕТИ ═══ */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-slate-800 text-[14px]">Пульс сети</span>
              <span className="text-[11px] text-slate-400 ml-2">текущий месяц vs прошлый</span>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {stats.length === 0 && (
              <div className="px-5 py-6 text-center text-[13px] text-slate-400">Загрузка...</div>
            )}
            {stats.map(branch => {
              const hasCurrent = branch.revenue_month > 0;
              const hasPrev = branch.revenue_prev_month > 0;
              const diff = hasPrev
                ? Math.round((branch.revenue_month - branch.revenue_prev_month) / branch.revenue_prev_month * 100)
                : null;
              const isUp = diff !== null && diff >= 0;

              return (
                <div key={branch.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${hasCurrent ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                    <span className="text-[13px] font-semibold text-slate-800">{branch.name}</span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {/* Выручка этого месяца */}
                    <span className={`text-[15px] font-bold ${hasCurrent ? 'text-slate-800' : 'text-slate-300'}`}>
                      {hasCurrent ? `${fmt(branch.revenue_month)} с` : '—'}
                    </span>

                    {/* Сравнение с прошлым месяцем */}
                    {diff !== null ? (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        isUp
                          ? 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200'
                          : 'text-rose-600 bg-rose-50 ring-1 ring-rose-200'
                      }`}>
                        {isUp ? '↑' : '↓'} {Math.abs(diff)}%
                      </span>
                    ) : hasCurrent ? (
                      <span className="text-[11px] text-slate-300">нет данных за пред. мес.</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ РЕЙТИНГ ═══ */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500 shadow-[0_4px_12px_rgba(245,158,11,0.28)]">
              <Trophy className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-slate-800 text-[14px]">Рейтинг филиалов</span>
              <span className="text-[11px] text-slate-400 ml-2">по выручке за месяц</span>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {[...stats].sort((a, b) => b.revenue_month - a.revenue_month).map((branch, i) => {
              const medals = ['🥇', '🥈', '🥉'];
              const isTop = i < 3;
              return (
                <div key={branch.id} className="px-5 py-3 flex items-center gap-4">
                  <div className="w-8 text-center shrink-0">
                    {isTop
                      ? <span className="text-[18px]">{medals[i]}</span>
                      : <span className="text-[13px] font-bold text-slate-300">#{i + 1}</span>}
                  </div>
                  <span className="flex-1 text-[13px] font-semibold text-slate-800">{branch.name}</span>
                  <div className="text-right">
                    <div className={`text-[14px] font-bold ${i === 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                      {branch.revenue_month > 0 ? `${fmt(branch.revenue_month)} с` : <span className="text-slate-300">—</span>}
                    </div>
                    {branch.orders_month > 0 && (
                      <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                        <ShoppingBag size={9} />{branch.orders_month} заказов
                      </div>
                    )}
                  </div>
                  {/* Прогресс-бар */}
                  {stats[0]?.revenue_month > 0 && (
                    <div className="w-20 hidden sm:block">
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${Math.round(branch.revenue_month / stats[0].revenue_month * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ КОНТАКТЫ ═══ */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
              <User className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-[14px]">Сотрудники по филиалам</span>
          </div>
          <div className="divide-y divide-slate-50">
            {Object.entries(
              employees.reduce((acc, e) => {
                if (!acc[e.branch_id]) acc[e.branch_id] = { name: e.branch_name, list: [] };
                acc[e.branch_id].list.push(e);
                return acc;
              }, {} as Record<number, { name: string; list: BranchEmployee[] }>)
            ).map(([branchId, { name, list }]) => (
              <div key={branchId} className="px-5 py-3.5">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{name}</div>
                <div className="space-y-2">
                  {list.map(emp => (
                    <div key={emp.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-50 ring-1 ring-cyan-200">
                          <User className="h-3.5 w-3.5 text-cyan-600" />
                        </div>
                        <span className="text-[13px] font-medium text-slate-700">{emp.full_name}</span>
                      </div>
                      {emp.phone ? (
                        <a
                          href={`tel:${emp.phone}`}
                          className="flex items-center gap-1.5 text-[12px] font-semibold text-cyan-700 hover:text-cyan-800 transition-colors"
                        >
                          <Phone size={12} />
                          {emp.phone}
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-300">нет номера</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════ */
function LaunchProgressBlock() {
  const [data, setData] = useState<{ branch_id: number; branch_name: string; total: number; done: number; currentStage: string; currentDays: string; pct: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = getBrowserSupabase();

      // Get franchise users to know which branches have franchisees
      const { data: fuData } = await s.from('franchise_users').select('branch_id').eq('is_active', true);
      const branchIds = [...new Set((fuData || []).map((f: any) => f.branch_id))];
      if (branchIds.length === 0) { setLoading(false); return; }

      const { data: branches } = await s.from('branches').select('id, name').in('id', branchIds);
      const bMap = new Map((branches || []).map((b: any) => [b.id, b.name]));

      const { data: stages } = await s.from('franchise_launch_stages').select('id, title, days_label, sort_order').order('sort_order');
      const { data: items } = await s.from('franchise_launch_items').select('id, stage_id');
      const { data: progress } = await s.from('franchise_launch_progress').select('branch_id, item_id, completed').in('branch_id', branchIds);

      const result: typeof data = [];
      for (const bid of branchIds) {
        const branchProgress = (progress || []).filter((p: any) => p.branch_id === bid && p.completed);
        const doneIds = new Set(branchProgress.map((p: any) => p.item_id));
        const total = (items || []).length;
        const done = doneIds.size;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        // Find current stage
        let currentStage = 'Не начато';
        let currentDays = '';
        for (const st of (stages || []) as any[]) {
          const stItems = (items || []).filter((i: any) => i.stage_id === st.id);
          const stDone = stItems.filter((i: any) => doneIds.has(i.id)).length;
          if (stDone < stItems.length) {
            currentStage = st.title;
            currentDays = st.days_label;
            break;
          }
        }
        if (done === total && total > 0) { currentStage = 'Открыта!'; currentDays = ''; }

        result.push({ branch_id: bid, branch_name: bMap.get(bid) || `#${bid}`, total, done, currentStage, currentDays, pct });
      }

      setData(result);
      setLoading(false);
    })();
  }, []);

  if (loading || data.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
              <Rocket className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Открытие франшиз</div>
              <div className="text-[11px] text-slate-500">Прогресс по 60-дневному плану</div>
            </div>
          </div>
        </div>

        {data.map((d) => (
          <div key={d.branch_id} className="px-5 py-4 border-b border-slate-100 last:border-b-0 flex items-center gap-4">
            {/* Branch name + stage */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">{d.branch_name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[12px] text-slate-500">{d.currentStage}</span>
                {d.currentDays && <span className="text-[11px] text-cyan-600 font-semibold">{d.currentDays}</span>}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-[140px] shrink-0">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${d.pct === 100 ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                  style={{ width: `${d.pct}%` }} />
              </div>
            </div>

            {/* Percent */}
            <div className={`text-lg font-bold tabular-nums w-[50px] text-right ${d.pct === 100 ? 'text-emerald-600' : d.pct > 0 ? 'text-cyan-600' : 'text-slate-400'}`}>
              {d.pct}%
            </div>

            {/* Done count */}
            <div className="text-[12px] text-slate-400 w-[45px] text-right tabular-nums shrink-0">{d.done}/{d.total}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
