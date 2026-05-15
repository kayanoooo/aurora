import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useLang } from '../i18n';

interface Place {
    display_name: string;
    lat: string;
    lon: string;
    type?: string;
    address?: { road?: string; house_number?: string; city?: string; town?: string; village?: string };
}

interface LocationPickerProps {
    isDark?: boolean;
    onSend: (geo: { lat: number; lon: number; name: string; address: string }) => void;
    onClose: () => void;
}

const LocationPicker: React.FC<LocationPickerProps> = ({ isDark = false, onSend, onClose }) => {
    const { lang } = useLang();
    const dm = isDark;
    const isOled = dm && document.body.classList.contains('oled-theme');
    const isMobile = window.innerWidth <= 768;

    const [closing, setClosing] = useState(false);
    const [loading, setLoading] = useState(false);
    const [places, setPlaces] = useState<Place[]>([]);
    const [myPos, setMyPos] = useState<{ lat: number; lon: number } | null>(null);
    const [posError, setPosError] = useState(false);
    const [search, setSearch] = useState('');
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const bg = isOled ? '#000' : dm ? '#13131f' : '#fff';
    const cardBg = isOled ? '#0a0a14' : dm ? '#1a1a2e' : '#f5f3ff';
    const textCol = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const border = isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.2)' : '#ede9fe';
    const accent = '#6366f1';

    const close = () => { setClosing(true); setTimeout(onClose, 200); };

    const fetchNearby = async (lat: number, lon: number) => {
        setLoading(true);
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=${lang}`;
            const res = await fetch(url, { headers: { 'Accept-Language': lang } });
            const data = await res.json();
            const nearUrl = `https://nominatim.openstreetmap.org/search?lat=${lat}&lon=${lon}&format=json&addressdetails=1&limit=8&accept-language=${lang}&bounded=1&viewbox=${lon - 0.02},${lat + 0.02},${lon + 0.02},${lat - 0.02}`;
            const nearRes = await fetch(nearUrl, { headers: { 'Accept-Language': lang } });
            const nearData = await nearRes.json();
            const current: Place = {
                display_name: data.display_name || (lang === 'en' ? 'My location' : 'Моя геопозиция'),
                lat: String(lat), lon: String(lon),
                address: data.address,
            };
            setPlaces([current, ...nearData.filter((p: Place) => p.lat !== String(lat))]);
        } catch {
            setPlaces([{ display_name: lang === 'en' ? 'My location' : 'Моя геопозиция', lat: String(lat), lon: String(lon) }]);
        } finally { setLoading(false); }
    };

    const searchPlaces = async (q: string) => {
        if (!q.trim()) { if (myPos) fetchNearby(myPos.lat, myPos.lon); return; }
        setLoading(true);
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=8&accept-language=${lang}`;
            const res = await fetch(url, { headers: { 'Accept-Language': lang } });
            setPlaces(await res.json());
        } catch {} finally { setLoading(false); }
    };

    useEffect(() => {
        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            pos => {
                const { latitude: lat, longitude: lon } = pos.coords;
                setMyPos({ lat, lon });
                fetchNearby(lat, lon);
            },
            () => { setPosError(true); setLoading(false); }
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSearch = (val: string) => {
        setSearch(val);
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => searchPlaces(val), 500);
    };

    const handleSelect = (place: Place) => {
        const addr = place.address
            ? [place.address.road, place.address.house_number, place.address.city || place.address.town || place.address.village].filter(Boolean).join(', ')
            : place.display_name.split(',').slice(0, 2).join(',').trim();
        const name = place.display_name.split(',')[0].trim();
        onSend({ lat: parseFloat(place.lat), lon: parseFloat(place.lon), name, address: addr || place.display_name });
        close();
    };

    const handleCurrentLocation = () => {
        if (!myPos) return;
        onSend({ lat: myPos.lat, lon: myPos.lon, name: lang === 'en' ? 'My location' : 'Моя геопозиция', address: `${myPos.lat.toFixed(5)}, ${myPos.lon.toFixed(5)}` });
        close();
    };

    const mapUrl = myPos
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${myPos.lon - 0.01},${myPos.lat - 0.01},${myPos.lon + 0.01},${myPos.lat + 0.01}&layer=mapnik&marker=${myPos.lat},${myPos.lon}`
        : null;

    return ReactDOM.createPortal(
        <div
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            style={{ position: 'fixed', inset: 0, zIndex: 4500, background: isOled ? 'rgba(0,0,0,0.9)' : dm ? 'rgba(15,10,40,0.8)' : 'rgba(15,10,40,0.45)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
            onClick={close}
        >
            <div
                className={closing ? 'modal-exit' : 'modal-enter'}
                style={{ background: bg, borderRadius: isMobile ? '20px 20px 0 0' : 20, width: isMobile ? '100%' : 420, maxWidth: '96vw', maxHeight: isMobile ? '88svh' : '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom,0px)' : 0 }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', gap: 10, flexShrink: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 16, color: textCol, flex: 1 }}>{lang === 'en' ? 'Send location' : 'Геопозиция'}</span>
                    <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, padding: 4, display: 'flex' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                {/* Map preview */}
                {mapUrl && (
                    <div style={{ height: 160, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                        <iframe src={mapUrl} title="map" style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: accent, border: '3px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }} />
                        </div>
                        {/* Send current location overlay button */}
                        <button onClick={handleCurrentLocation} style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: 20, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.5)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            {lang === 'en' ? 'Send my location' : 'Отправить мою геопозицию'}
                        </button>
                    </div>
                )}

                {!mapUrl && !loading && posError && (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                        <div style={{ fontSize: 36, marginBottom: 8 }}>🗺️</div>
                        <div style={{ fontSize: 13, color: subCol, marginBottom: 12 }}>{lang === 'en' ? 'Location access denied' : 'Нет доступа к геолокации'}</div>
                    </div>
                )}

                {/* Search */}
                <div style={{ padding: '10px 14px 6px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: cardBg, border: `1.5px solid ${border}`, borderRadius: 12, padding: '8px 12px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={subCol} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input value={search} onChange={e => handleSearch(e.target.value)} placeholder={lang === 'en' ? 'Search place...' : 'Поиск места...'} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, color: textCol, fontFamily: 'inherit' }} />
                        {search && <button onClick={() => { setSearch(''); if (myPos) fetchNearby(myPos.lat, myPos.lon); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, padding: 0, display: 'flex' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
                    </div>
                </div>

                {/* Places list */}
                <div style={{ flex: 1, overflowY: 'auto', paddingInline: 10, paddingBottom: 10 }}>
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                            <div style={{ width: 24, height: 24, border: `2px solid ${border}`, borderTopColor: accent, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        </div>
                    )}
                    {!loading && places.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 28, color: subCol, fontSize: 13 }}>{lang === 'en' ? 'No places found' : 'Места не найдены'}</div>
                    )}
                    {!loading && places.map((p, i) => {
                        const name = p.display_name.split(',')[0].trim();
                        const addr = p.display_name.split(',').slice(1, 3).join(',').trim();
                        const isFirst = i === 0 && !search && myPos;
                        return (
                            <button key={i} onClick={() => handleSelect(p)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 8px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 12, textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent' }}
                                onMouseEnter={e => { e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                                <div style={{ width: 38, height: 38, borderRadius: '50%', background: isFirst ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : cardBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${border}` }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isFirst ? 'white' : accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                    {addr && <div style={{ fontSize: 11, color: subCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{addr}</div>}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default LocationPicker;
