"use client";

// 사업체(현장) 주소 위치 확인용 지도 모달.
// 주소 검색으로 받은 좌표를 지도에 핀으로 표시하고, 사용자가 핀을 드래그/클릭으로
// 정확한 위치(정문·출입구 등)에 맞춘 뒤 확정한다. 출퇴근 GPS 판정 기준점 정확도 향상 목적.
// 필요 환경변수: NEXT_PUBLIC_KAKAO_JS_KEY (Kakao Developers JavaScript 키)

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { kakao: any }
}

let kakaoLoadPromise: Promise<void> | null = null;
function loadKakaoMaps(): Promise<void> {
  if (typeof window !== "undefined" && window.kakao?.maps) return Promise.resolve();
  if (kakaoLoadPromise) return kakaoLoadPromise;
  kakaoLoadPromise = new Promise<void>((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!key) { reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY가 설정되지 않았습니다.")); return; }
    const ready = () => window.kakao.maps.load(() => resolve());
    const existing = document.getElementById("kakao-maps-sdk") as HTMLScriptElement | null;
    if (existing) {
      if (window.kakao?.maps) ready();
      else existing.addEventListener("load", ready, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "kakao-maps-sdk";
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    script.onload = ready;
    script.onerror = () => { kakaoLoadPromise = null; reject(new Error("Kakao 지도 SDK 로드 실패 (도메인 등록/키 확인)")); };
    document.head.appendChild(script);
  });
  return kakaoLoadPromise;
}

export interface AddressMapPickerProps {
  open: boolean;
  initialLat: number;
  initialLon: number;
  initialAddress?: string;
  onConfirm: (lat: number, lon: number, address: string) => void;
  onClose: () => void;
}

export default function AddressMapPicker({
  open, initialLat, initialLon, initialAddress = "", onConfirm, onClose,
}: AddressMapPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const [pos, setPos] = useState({ lat: initialLat, lon: initialLon });
  const [addr, setAddr] = useState(initialAddress);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPos({ lat: initialLat, lon: initialLon });
    setAddr(initialAddress);
    setErr("");
    setLoading(true);

    loadKakaoMaps()
      .then(() => {
        if (cancelled || !mapRef.current) return;
        const kakao = window.kakao;
        const center = new kakao.maps.LatLng(initialLat, initialLon);
        const map = new kakao.maps.Map(mapRef.current, { center, level: 3 });
        const marker = new kakao.maps.Marker({ position: center, draggable: true });
        marker.setMap(map);
        const geocoder = new kakao.maps.services.Geocoder();
        markerRef.current = marker;
        geocoderRef.current = geocoder;

        const updateFrom = (latlng: any) => {
          const lat = latlng.getLat(), lon = latlng.getLng();
          setPos({ lat, lon });
          geocoder.coord2Address(lon, lat, (res: any[], status: string) => {
            if (status === kakao.maps.services.Status.OK && res[0]) {
              setAddr(res[0].road_address?.address_name || res[0].address?.address_name || "");
            }
          });
        };

        kakao.maps.event.addListener(marker, "dragend", () => updateFrom(marker.getPosition()));
        kakao.maps.event.addListener(map, "click", (e: any) => {
          marker.setPosition(e.latLng);
          updateFrom(e.latLng);
        });

        // 모달 안에서 컨테이너 크기 확정 후 재배치
        setTimeout(() => { map.relayout(); map.setCenter(center); }, 50);
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setErr(e.message); setLoading(false); } });

    return () => { cancelled = true; };
  }, [open, initialLat, initialLon, initialAddress]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl">
        <p className="mb-1 text-sm font-black text-slate-900">위치 확인</p>
        <p className="mb-3 text-xs font-semibold text-slate-500">
          핀을 드래그하거나 지도를 눌러 정확한 위치로 맞춘 뒤 확정하세요.
        </p>

        {err ? (
          <div className="flex h-72 w-full items-center justify-center rounded-xl bg-amber-50 p-4 text-center text-xs font-semibold leading-relaxed text-amber-700">
            지도를 불러오지 못했습니다.<br />{err}
          </div>
        ) : (
          <div className="relative">
            <div ref={mapRef} className="h-72 w-full overflow-hidden rounded-xl bg-slate-100" />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-100/70 text-xs font-semibold text-slate-500">
                지도를 불러오는 중…
              </div>
            )}
          </div>
        )}

        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">{addr || "(주소 정보 없음)"}</p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-400">
            좌표: {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}
          </p>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 transition active:scale-[0.97]"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!!err}
            onClick={() => onConfirm(pos.lat, pos.lon, addr)}
            className="min-h-11 flex-1 rounded-xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-50"
          >
            이 위치로 확정
          </button>
        </div>
      </div>
    </div>
  );
}
