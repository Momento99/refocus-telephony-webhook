'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { Sparkles, MapPin, CheckCircle2, Clock } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';

export default function FranchiseMapPage() {
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    // загрузка GeoJSON карты мира
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(r => r.json())
      .then(worldJson => {
        // Оставляем только нужные страны: Кыргызстан, Казахстан, Россия (по ISO A3)
        const targetCountries = ['KGZ', 'KAZ', 'RUS'];
        const cisJson = {
          ...worldJson,
          features: worldJson.features.filter((f: any) => targetCountries.includes(f.properties.ISO_A3))
        };
        echarts.registerMap('CIS', cisJson);
        setMapLoaded(true);
      })
      .catch(e => {
        console.error('Map load error', e);
        toast.error('Не удалось загрузить карту');
      });
  }, []);

  if (!mapLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-sky-400">
        <Sparkles className="animate-spin mb-4" size={32} />
        <span className="font-medium tracking-widest uppercase text-sm">Инициализация карты СНГ...</span>
      </div>
    );
  }

  // Данные для точек
  const activePoints = [
    { name: 'Бишкек', value: [74.59, 42.87, 100] },
    { name: 'Токмок', value: [75.30, 42.84, 100] },
    { name: 'Кант', value: [74.85, 42.89, 100] },
    { name: 'Кара-Балта', value: [73.85, 42.81, 100] },
    { name: 'Сокулук', value: [74.32, 42.85, 100] },
  ];

  const plannedPoints = [
    { name: 'Алматы (Скоро)', value: [76.95, 43.25, 50] },
    { name: 'Астана (В планах)', value: [71.43, 51.13, 50] },
    { name: 'Москва (В планах)', value: [37.61, 55.75, 50] },
    { name: 'Новосибирск (В планах)', value: [82.93, 55.04, 50] },
  ];

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: function (params: any) {
        return `<div style="padding: 4px; font-weight: 600; font-family: Inter, sans-serif;">
                  <span style="color: #0ea5e9;">${params.name}</span>
                </div>`;
      },
      backgroundColor: 'rgba(15, 23, 42, 0.9)',
      borderColor: '#0284c7',
      textStyle: { color: '#fff' }
    },
    geo: {
      map: 'CIS',
      roam: true,
      zoom: 1.8,
      center: [75.0, 50.0], // Центр на границе КЗ/КР/РФ
      itemStyle: {
        areaColor: '#0f172a',
        borderColor: '#38bdf8',
        borderWidth: 1,
      },
      emphasis: {
        itemStyle: {
          areaColor: '#1e293b',
        },
        label: {
          show: false
        }
      }
    },
    series: [
      {
        name: 'Действующие филиалы',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: activePoints,
        symbolSize: 12,
        showEffectOn: 'render',
        rippleEffect: {
          brushType: 'stroke',
          scale: 4
        },
        label: {
          formatter: '{b}',
          position: 'right',
          show: true,
          color: '#bae6fd',
          fontSize: 11,
          fontFamily: 'Inter, sans-serif',
        },
        itemStyle: {
          color: '#38bdf8',
          shadowBlur: 10,
          shadowColor: '#38bdf8'
        },
        zlevel: 1
      },
      {
        name: 'В планах',
        type: 'scatter',
        coordinateSystem: 'geo',
        data: plannedPoints,
        symbolSize: 8,
        label: {
          formatter: '{b}',
          position: 'right',
          show: true,
          color: '#64748b',
          fontSize: 10,
          fontFamily: 'Inter, sans-serif',
        },
        itemStyle: {
          color: '#94a3b8',
        }
      }
    ]
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-hidden relative font-sans">
      <Toaster position="top-right" />
      
      {/* Фоновые декорации */}
      <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-sky-900/20 blur-[120px] rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-sky-600/10 blur-[100px] rounded-full translate-x-1/3 translate-y-1/3 pointer-events-none" />

      {/* Верхний бар */}
      <div className="relative z-10 px-8 py-6 flex items-center justify-between border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <MapPin size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Интероперабельная Карта <span className="font-kiona">Refocus</span></h1>
            <p className="text-sky-400/80 text-sm font-medium tracking-wide uppercase mt-0.5">Покрытие сети филиалов СНГ</p>
          </div>
        </div>
        
        <div className="flex gap-6">
          <div className="flex flex-col items-end">
            <span className="text-3xl font-bold text-white">5</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Действующих точек</span>
          </div>
          <div className="w-px h-12 bg-slate-800"></div>
          <div className="flex flex-col items-end">
            <span className="text-3xl font-bold text-sky-400">3</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Страны охвата</span>
          </div>
        </div>
      </div>

      <div className="relative w-full h-[calc(100vh-100px)] flex">
        {/* Контейнер Карты Echarts */}
        <div className="flex-1 w-full h-full">
          <ReactECharts 
            option={option} 
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>

        {/* Легенда (Информационная панель сбоку) */}
        <div className="absolute bottom-10 left-10 w-80 bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl flex flex-col gap-6">
          
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-sm uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">
              <CheckCircle2 size={16} className="text-sky-400" /> Кыргызстан
            </div>
            <div className="space-y-3">
              {['Бишкек', 'Токмок', 'Кант', 'Кара-Балта', 'Сокулук'].map((city, i) => (
                <div key={i} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] group-hover:scale-150 transition-transform"></span>
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{city}</span>
                  </div>
                  <span className="text-xs text-sky-500 font-medium">Действует</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-white font-bold text-sm uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">
              <Clock size={16} className="text-slate-400" /> РФ &amp; Казахстан
            </div>
            <div className="space-y-3 opacity-70 hover:opacity-100 transition-opacity">
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                  <span className="text-sm text-slate-400 group-hover:text-white transition-colors">Алматы</span>
                </div>
                <span className="text-xs text-slate-500">В поиске парнера</span>
              </div>
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                  <span className="text-sm text-slate-400 group-hover:text-white transition-colors">Астана</span>
                </div>
                <span className="text-xs text-slate-500">В планах</span>
              </div>
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                  <span className="text-sm text-slate-400 group-hover:text-white transition-colors">Москва</span>
                </div>
                <span className="text-xs text-slate-500">Анализ рынка</span>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
