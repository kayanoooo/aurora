import React, { useState, useEffect, useRef, useCallback } from 'react';

interface AvatarCropperProps {
    src: string;
    isDark?: boolean;
    onApply: (blob: Blob) => void;
    onCancel: () => void;
    outputSize?: number; // size of the output square in px
}

// display size of the crop area — shrinks on narrow screens
const CONTAINER = Math.min(300, typeof window !== 'undefined' ? window.innerWidth - 80 : 300);

const AvatarCropper: React.FC<AvatarCropperProps> = ({ src, isDark = false, onApply, onCancel, outputSize = 512 }) => {
    const dm = isDark;
    const imgRef = useRef<HTMLImageElement>(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [imgLoaded, setImgLoaded] = useState(false);
    const isDragging = useRef(false);
    const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });

    // Compute minimum scale so image always fills the circle
    const minScale = useCallback(() => {
        const img = imgRef.current;
        if (!img || !img.naturalWidth) return 1;
        return Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight);
    }, [imgLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    const clamp = useCallback((ox: number, oy: number, sc: number): { x: number; y: number } => {
        const img = imgRef.current;
        if (!img) return { x: ox, y: oy };
        const rendW = img.naturalWidth * sc;
        const rendH = img.naturalHeight * sc;
        const maxX = Math.max(0, (rendW - CONTAINER) / 2);
        const maxY = Math.max(0, (rendH - CONTAINER) / 2);
        return {
            x: Math.min(maxX, Math.max(-maxX, ox)),
            y: Math.min(maxY, Math.max(-maxY, oy)),
        };
    }, []);

    const onImgLoad = () => {
        const img = imgRef.current!;
        const sc = Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight);
        setScale(sc);
        setOffset({ x: 0, y: 0 });
        setImgLoaded(true);
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const min = minScale();
        const newSc = Math.min(8, Math.max(min, scale * (1 - e.deltaY * 0.0012)));
        setScale(newSc);
        setOffset(prev => clamp(prev.x, prev.y, newSc));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        dragStart.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
        e.preventDefault();
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging.current) return;
        const dx = e.clientX - dragStart.current.mx;
        const dy = e.clientY - dragStart.current.my;
        setOffset(clamp(dragStart.current.ox + dx, dragStart.current.oy + dy, scale));
    }, [scale, clamp]);

    const handleMouseUp = () => { isDragging.current = false; };

    // Touch support
    const lastTouch = useRef<{ x: number; y: number } | null>(null);
    const lastPinchDist = useRef<number | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            dragStart.current = { mx: e.touches[0].clientX, my: e.touches[0].clientY, ox: offset.x, oy: offset.y };
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1 && lastTouch.current) {
            const dx = e.touches[0].clientX - dragStart.current.mx;
            const dy = e.touches[0].clientY - dragStart.current.my;
            setOffset(clamp(dragStart.current.ox + dx, dragStart.current.oy + dy, scale));
        } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const min = minScale();
            const newSc = Math.min(8, Math.max(min, scale * (dist / lastPinchDist.current)));
            lastPinchDist.current = dist;
            setScale(newSc);
            setOffset(prev => clamp(prev.x, prev.y, newSc));
        }
    };

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove]);

    const handleApply = () => {
        const img = imgRef.current;
        if (!img) return;
        const canvas = document.createElement('canvas');
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext('2d')!;

        // Compute source rect in natural image coords
        // Image is centered in container, shifted by offset
        // offset.x > 0 means image moved right → we see more of the left side
        const srcW = CONTAINER / scale;
        const srcH = CONTAINER / scale;
        const srcX = img.naturalWidth / 2 - offset.x / scale - srcW / 2;
        const srcY = img.naturalHeight / 2 - offset.y / scale - srcH / 2;

        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outputSize, outputSize);
        canvas.toBlob(blob => { if (blob) onApply(blob); }, 'image/jpeg', 0.92);
    };

    const border = dm ? 'rgba(99,102,241,0.3)' : '#d0caff';
    const bg = dm ? '#13132a' : '#ffffff';
    const textColor = dm ? '#e0e0f0' : '#1e1b4b';
    const subColor = dm ? '#7c7caa' : '#9ca3af';

    const sliderMin = minScale();
    const sliderMax = Math.min(8, sliderMin * 4);

    return (
        <div
            className="modal-backdrop-enter"
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={onCancel}
        >
            <div
                className="modal-enter avatar-cropper-dialog"
                style={{ background: bg, borderRadius: 20, padding: '24px', width: 360, boxShadow: dm ? '0 0 60px rgba(99,102,241,0.3)' : '0 20px 60px rgba(0,0,0,0.18)', border: `1px solid ${border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ fontWeight: 800, fontSize: 16, color: textColor }}>
                    Обрезка фото
                </div>
                <div style={{ fontSize: 12, color: subColor, marginTop: -8 }}>
                    Перетащите и масштабируйте
                </div>

                {/* Crop viewport */}
                <div
                    style={{ width: CONTAINER, height: CONTAINER, borderRadius: '50%', overflow: 'hidden', position: 'relative', cursor: isDragging.current ? 'grabbing' : 'grab', border: `3px solid ${dm ? '#6366f1' : '#a5b4fc'}`, boxShadow: `0 0 0 4px ${dm ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.12)'}`, flexShrink: 0, background: dm ? '#0f0f1a' : '#f0eeff', userSelect: 'none' }}
                    onMouseDown={handleMouseDown}
                    onWheel={handleWheel}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                >
                    {/* Hidden img for natural size reference */}
                    <img
                        ref={imgRef}
                        src={src}
                        alt=""
                        onLoad={onImgLoad}
                        crossOrigin="anonymous"
                        style={{ display: 'none' }}
                    />
                    {/* Visible canvas-rendered image via CSS transform */}
                    {imgLoaded && imgRef.current && (
                        <img
                            src={src}
                            alt=""
                            crossOrigin="anonymous"
                            draggable={false}
                            style={{
                                position: 'absolute',
                                width: imgRef.current.naturalWidth * scale,
                                height: imgRef.current.naturalHeight * scale,
                                left: (CONTAINER - imgRef.current.naturalWidth * scale) / 2 + offset.x,
                                top: (CONTAINER - imgRef.current.naturalHeight * scale) / 2 + offset.y,
                                pointerEvents: 'none',
                            }}
                        />
                    )}
                </div>

                {/* Zoom slider */}
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 14, color: subColor }}>🔍</span>
                    <input
                        type="range"
                        min={sliderMin}
                        max={sliderMax}
                        step={(sliderMax - sliderMin) / 200}
                        value={scale}
                        onChange={e => {
                            const sc = parseFloat(e.target.value);
                            setScale(sc);
                            setOffset(prev => clamp(prev.x, prev.y, sc));
                        }}
                        style={{ flex: 1, accentColor: '#6366f1', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: subColor, minWidth: 36, textAlign: 'right' }}>{Math.round((scale / sliderMin) * 100)}%</span>
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                    <button
                        onClick={onCancel}
                        style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: `1px solid ${border}`, background: 'none', color: dm ? '#9090b8' : '#6b7280', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleApply}
                        style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', cursor: 'pointer', fontWeight: 700, fontSize: 14, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}
                    >
                        Применить
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AvatarCropper;
