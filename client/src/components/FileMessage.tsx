import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { config } from '../config';

interface FileMessageProps {
    filePath: string;
    filename: string;
    fileSize?: number;
    isOwn: boolean;
    messageId?: number;
    isGroup?: boolean;
    isDark?: boolean;
    onPlay?: (src: string, filename: string) => void;
    onPlayVideo?: (src: string, filename: string) => void;
    // Global player state (for audio progress sync)
    nowPlayingSrc?: string;
    globalPlaying?: boolean;
    globalCurrentTime?: number;
    globalDuration?: number;
    onGlobalSeek?: (e: React.MouseEvent<HTMLDivElement>) => void;
    onGlobalToggle?: () => void;
}

const FileMessage: React.FC<FileMessageProps> = ({ filePath, filename, fileSize, isOwn, messageId, isGroup, isDark = false, onPlay, onPlayVideo, nowPlayingSrc, globalPlaying, globalCurrentTime, globalDuration, onGlobalSeek, onGlobalToggle }) => {
    const dm = isDark;
    const displayName = filename || 'file';
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(displayName);
    const isVideo = /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(displayName);
    const isAudio = /\.(mp3|ogg|wav|flac|aac|m4a|opus|weba)$/i.test(displayName);

    const [lightboxOpen, setLightboxOpen] = useState(false);

    const formatFileSize = (bytes?: number): string => {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getFileUrl = () => {
        if (filePath.startsWith('http')) return filePath;
        return `${config.BASE_URL}${filePath}`;
    };

    const fileUrl = getFileUrl();

    const downloadFile = async () => {
        const downloadUrl = messageId
            ? (isGroup
                ? `${config.BASE_URL}/files/group/download/${messageId}`
                : `${config.BASE_URL}/files/download/${messageId}`)
            : fileUrl;
        try {
            const res = await fetch(downloadUrl);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = displayName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = displayName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };


    // Close lightbox on Escape
    useEffect(() => {
        if (!lightboxOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [lightboxOpen]);

    // ── IMAGE ──
    if (isImage) {
        return (
            <>
                <div
                    style={{ position: 'relative', display: 'inline-block', borderRadius: 14, overflow: 'hidden', maxWidth: 280, cursor: 'zoom-in' }}
                    onClick={() => setLightboxOpen(true)}
                >
                    <img
                        src={fileUrl}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 14 }}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                </div>

                {lightboxOpen && (
                    <Lightbox url={fileUrl} type="image" name={displayName} onClose={() => setLightboxOpen(false)} onDownload={downloadFile} />
                )}
            </>
        );
    }

    // ── VIDEO ──
    if (isVideo) {
        return (
            <>
                <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', maxWidth: 300 }}>
                    <div
                        style={{ cursor: 'zoom-in' }}
                        onClick={() => setLightboxOpen(true)}
                        title="Нажмите для просмотра"
                    >
                        <video
                            src={fileUrl}
                            style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 14, backgroundColor: '#000', pointerEvents: 'none' }}
                        />
                        {/* Play overlay */}
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.28)', borderRadius: 14,
                        }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: '50%',
                                background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                            }}>▶</div>
                        </div>
                    </div>
                    {onPlayVideo && (
                        <button
                            onClick={e => { e.stopPropagation(); onPlayVideo(fileUrl, displayName); }}
                            title="Смотреть в фоне"
                            style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, padding: '3px 7px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                        >⛶</button>
                    )}
                </div>

                {lightboxOpen && (
                    <Lightbox url={fileUrl} type="video" name={displayName} onClose={() => setLightboxOpen(false)} onDownload={downloadFile} />
                )}
            </>
        );
    }

    // ── AUDIO ──
    if (isAudio) {
        return <AudioPlayer url={fileUrl} name={displayName} fileSize={fileSize} isOwn={isOwn} isDark={dm} onDownload={downloadFile} onPlay={onPlay} nowPlayingSrc={nowPlayingSrc} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} globalDuration={globalDuration} onGlobalSeek={onGlobalSeek} onGlobalToggle={onGlobalToggle} />;
    }

    // ── FILE ──
    const fileBg = isOwn ? 'rgba(255,255,255,0.15)' : dm ? 'rgba(255,255,255,0.06)' : '#f5f3ff';
    const fileBorder = isOwn ? 'rgba(255,255,255,0.2)' : dm ? '#3a3a55' : '#ede9fe';
    const fileTextColor = isOwn ? 'white' : dm ? '#e2e8f0' : '#1e1b4b';
    const fileSizeColor = isOwn ? 'rgba(255,255,255,0.6)' : dm ? '#7c7caa' : '#9ca3af';
    const btnBg = isOwn ? 'rgba(255,255,255,0.15)' : dm ? 'rgba(99,102,241,0.15)' : '#ede9fe';
    const btnColor = isOwn ? 'rgba(255,255,255,0.9)' : '#6366f1';

    return (
        <div style={{ maxWidth: 260 }}>
            <div
                style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderRadius: 14, backgroundColor: fileBg, border: `1px solid ${fileBorder}`, gap: 10, cursor: 'pointer' }}
                onClick={downloadFile}
                title="Нажмите чтобы скачать"
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: fileTextColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {displayName}
                    </div>
                    {fileSize && <div style={{ fontSize: 11, color: fileSizeColor, marginTop: 2 }}>{formatFileSize(fileSize)}</div>}
                </div>
                <button style={{ background: btnBg, border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, color: btnColor, fontWeight: 600, flexShrink: 0 }}>
                    💾
                </button>
            </div>
        </div>
    );
};

// ── AudioPlayer компонент ──
interface AudioPlayerProps {
    url: string;
    name: string;
    fileSize?: number;
    isOwn: boolean;
    isDark: boolean;
    onDownload: () => void;
    onPlay?: (src: string, filename: string) => void;
    nowPlayingSrc?: string;
    globalPlaying?: boolean;
    globalCurrentTime?: number;
    globalDuration?: number;
    onGlobalSeek?: (e: React.MouseEvent<HTMLDivElement>) => void;
    onGlobalToggle?: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ url, name, fileSize: _fileSize, isOwn, isDark: dm, onDownload, onPlay, nowPlayingSrc, globalPlaying, globalCurrentTime, globalDuration, onGlobalSeek, onGlobalToggle }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [localDuration, setLocalDuration] = useState(0);
    const [localCurrentTime, setLocalCurrentTime] = useState(0);

    const isVoice = /^voice_/i.test(name) || /\.weba$/i.test(name);
    const voiceDisplayName = 'Голосовое сообщение';
    const isActive = !!onPlay && url === nowPlayingSrc;

    const dispPlaying = isActive ? (globalPlaying ?? false) : playing;
    const dispCurrentTime = isActive ? (globalCurrentTime ?? 0) : localCurrentTime;
    const dispDuration = isActive ? (globalDuration ?? 0) : localDuration;
    const dispProgress = dispDuration > 0 ? dispCurrentTime / dispDuration : 0;

    const formatTime = (s: number) => {
        if (!isFinite(s) || s === 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const handleEnded = () => {
        setPlaying(false);
        setLocalCurrentTime(0);
        if (audioRef.current) audioRef.current.currentTime = 0;
    };

    const handleDurationChange = (e: React.SyntheticEvent<HTMLAudioElement>) => {
        const a = e.target as HTMLAudioElement;
        if (isFinite(a.duration) && a.duration > 0) setLocalDuration(a.duration);
    };

    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
        const a = e.target as HTMLAudioElement;
        setLocalCurrentTime(a.currentTime);
        if (isFinite(a.duration) && a.duration > 0) setLocalDuration(a.duration);
    };

    const toggle = () => {
        if (onPlay) {
            if (isActive) { onGlobalToggle?.(); }
            else { onPlay(url, name); }
            return;
        }
        const a = audioRef.current;
        if (!a) return;
        if (playing) { a.pause(); } else { a.play().catch(() => {}); }
    };

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isActive && onGlobalSeek) { onGlobalSeek(e); return; }
        const a = audioRef.current;
        if (!a) return;
        const dur = isFinite(a.duration) ? a.duration : 0;
        if (!dur) return;
        const rect = e.currentTarget.getBoundingClientRect();
        a.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
    };

    const localAudioEl = !onPlay ? (
        <audio
            ref={audioRef}
            src={url}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={handleEnded}

            onDurationChange={handleDurationChange}
            onTimeUpdate={handleTimeUpdate}
        />
    ) : null;

    // ── Voice message layout ──
    if (isVoice) {
        const waveHeights = [4, 8, 14, 20, 16, 10, 18, 24, 16, 12, 8, 14, 20, 15, 10, 7, 12, 18, 13, 9];
        const safeDispDuration = dispDuration > 0 && isFinite(dispDuration) ? dispDuration : 0;
        const filledColor = isOwn ? 'rgba(255,255,255,0.9)' : '#6366f1';
        const emptyColor = isOwn ? 'rgba(255,255,255,0.3)' : dm ? '#5a5a8a' : '#c4b5fd';
        const btnBg = isOwn ? 'rgba(255,255,255,0.18)' : dm ? 'rgba(99,102,241,0.18)' : '#ede9fe';
        const btnColor = isOwn ? 'white' : '#6366f1';
        const timeColor = isOwn ? 'rgba(255,255,255,0.6)' : dm ? '#7c7caa' : '#9ca3af';

        return (
            <>
                {localAudioEl}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                    <button onClick={toggle} style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: btnBg, border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: dispPlaying ? 13 : 18, color: btnColor, flexShrink: 0,
                    }}>
                        {dispPlaying ? '⏸' : '🎤'}
                    </button>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                        <div onClick={seek} style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28, cursor: 'pointer' }}>
                            {waveHeights.map((h, i) => (
                                <div key={i} style={{
                                    width: 3, height: h, borderRadius: 3, flexShrink: 0,
                                    background: i / waveHeights.length < dispProgress ? filledColor : emptyColor,
                                    transition: 'background 0.1s',
                                }} />
                            ))}
                        </div>
                        <div style={{ fontSize: 11, color: timeColor }}>
                            {formatTime(dispCurrentTime)}{safeDispDuration > 0 ? ` / ${formatTime(safeDispDuration)}` : ''}
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // ── Regular audio layout ──
    const bg = isOwn ? 'rgba(255,255,255,0.15)' : dm ? 'rgba(255,255,255,0.06)' : '#f5f3ff';
    const border = isOwn ? 'rgba(255,255,255,0.2)' : dm ? '#3a3a55' : '#ede9fe';
    const textColor = isOwn ? 'white' : dm ? '#e2e8f0' : '#1e1b4b';
    const subColor = isOwn ? 'rgba(255,255,255,0.55)' : dm ? '#7c7caa' : '#9ca3af';
    const trackBg = isOwn ? 'rgba(255,255,255,0.25)' : dm ? '#3a3a55' : '#ddd9f7';
    const fillColor = isOwn ? 'rgba(255,255,255,0.85)' : '#6366f1';
    const btnBg = isOwn ? 'rgba(255,255,255,0.2)' : dm ? 'rgba(99,102,241,0.18)' : '#ede9fe';
    const btnColor = isOwn ? 'white' : '#6366f1';

    return (
        <div style={{ width: '100%', maxWidth: 260, minWidth: 180, background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, boxSizing: 'border-box' }}>
            {localAudioEl}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={toggle} style={{ width: 36, height: 36, borderRadius: '50%', background: btnBg, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: btnColor, flexShrink: 0 }}>
                    {dispPlaying ? '⏸' : '▶'}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isVoice ? voiceDisplayName : name}</div>
                    <div style={{ fontSize: 11, color: subColor, marginTop: 1 }}>{formatTime(dispCurrentTime)} / {formatTime(dispDuration > 0 && isFinite(dispDuration) ? dispDuration : 0)}</div>
                </div>
                <button onClick={onDownload} style={{ background: btnBg, border: 'none', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 13, color: btnColor, flexShrink: 0 }} title="Скачать">
                    💾
                </button>
            </div>
            <div style={{ height: 4, borderRadius: 4, background: trackBg, cursor: 'pointer', position: 'relative' }} onClick={seek}>
                <div style={{ height: '100%', borderRadius: 4, background: fillColor, width: `${dispProgress * 100}%`, transition: 'width 0.1s linear' }} />
            </div>
        </div>
    );
};

// ── Lightbox компонент ──
interface LightboxProps {
    url: string;
    type: 'image' | 'video';
    name: string;
    onClose: () => void;
    onDownload: () => void;
}

const Lightbox: React.FC<LightboxProps> = ({ url, type, name, onClose, onDownload }) => {
    return ReactDOM.createPortal(
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={onClose}
        >
            {/* Toolbar */}
            <div
                style={{
                    position: 'absolute', top: 0, left: 0, right: 0,
                    padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(rgba(0,0,0,0.6), transparent)',
                }}
                onClick={e => e.stopPropagation()}
            >
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 500, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={onDownload}
                        style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.85)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backdropFilter: 'blur(4px)' }}
                    >
                        💾 Скачать
                    </button>
                    <button
                        onClick={onClose}
                        style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.12)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Media */}
            <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '84vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {type === 'image' ? (
                    <img
                        src={url}
                        alt=""
                        style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
                    />
                ) : (
                    <video
                        src={url}
                        controls
                        autoPlay
                        style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
                    />
                )}
            </div>

            {/* Hint */}
            <div style={{ position: 'absolute', bottom: 20, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                Нажмите вне изображения или Esc чтобы закрыть
            </div>
        </div>,
        document.body
    );
};

// ── LightboxGallery — лайтбокс с навигацией по галерее ──
interface GalleryImage { url: string; name: string; }

const LightboxGallery: React.FC<{ images: GalleryImage[]; initialIndex: number; onClose: () => void }> = ({ images, initialIndex, onClose }) => {
    const [index, setIndex] = useState(initialIndex);
    const img = images[index];
    const hasPrev = index > 0;
    const hasNext = index < images.length - 1;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft' && index > 0) setIndex(i => i - 1);
            if (e.key === 'ArrowRight' && index < images.length - 1) setIndex(i => i + 1);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [index, images.length, onClose]);

    const downloadCurrent = async () => {
        try {
            const res = await fetch(img.url);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = img.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            const a = document.createElement('a'); a.href = img.url; a.download = img.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
    };

    const navBtnStyle: React.CSSProperties = {
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)', transition: 'background 0.15s',
        zIndex: 1,
    };

    return ReactDOM.createPortal(
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
            onClick={onClose}
        >
            {/* Toolbar */}
            <div
                style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(rgba(0,0,0,0.6), transparent)' }}
                onClick={e => e.stopPropagation()}
            >
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 500, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {img.name}
                </span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {images.length > 1 && (
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600 }}>
                            {index + 1} / {images.length}
                        </span>
                    )}
                    <button onClick={downloadCurrent} style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.85)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        💾 Скачать
                    </button>
                    <button onClick={onClose} style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.12)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        ✕
                    </button>
                </div>
            </div>

            {/* Prev */}
            {hasPrev && (
                <button style={{ ...navBtnStyle, left: 16 }} onClick={e => { e.stopPropagation(); setIndex(i => i - 1); }}>‹</button>
            )}

            {/* Image */}
            <div onClick={e => e.stopPropagation()} style={{ maxWidth: '84vw', maxHeight: '84vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img
                    key={img.url}
                    src={img.url}
                    alt=""
                    style={{ maxWidth: '84vw', maxHeight: '84vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
                />
            </div>

            {/* Next */}
            {hasNext && (
                <button style={{ ...navBtnStyle, right: 16 }} onClick={e => { e.stopPropagation(); setIndex(i => i + 1); }}>›</button>
            )}

            {/* Thumbnail strip */}
            {images.length > 1 && (
                <div
                    style={{ position: 'absolute', bottom: 16, display: 'flex', gap: 6, maxWidth: '80vw', overflowX: 'auto', padding: '4px 8px' }}
                    onClick={e => e.stopPropagation()}
                >
                    {images.map((im, i) => (
                        <div
                            key={i}
                            onClick={() => setIndex(i)}
                            style={{ width: 48, height: 36, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', flexShrink: 0, opacity: i === index ? 1 : 0.45, border: i === index ? '2px solid white' : '2px solid transparent', transition: 'opacity 0.15s, border-color 0.15s', boxSizing: 'border-box' }}
                        >
                            <img src={im.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                    ))}
                </div>
            )}

            {/* Hint */}
            <div style={{ position: 'absolute', bottom: images.length > 1 ? 68 : 20, color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
                Esc — закрыть{images.length > 1 ? ' • ← → — навигация' : ''}
            </div>
        </div>,
        document.body
    );
};

// ── ImageGrid — сетка изображений для нескольких фото ──
export interface GridImage { url: string; name: string; }

interface CellDef { index: number; col: string; row: string; h: number; }

const buildCells = (count: number, MAX: number): { cells: CellDef[]; cols: string; gridW: number } => {
    const n = Math.min(count, MAX);
    // 1 photo
    if (n === 1) return { cells: [{ index: 0, col: '1 / -1', row: '1 / -1', h: 240 }], cols: '1fr', gridW: 280 };
    // 2 photos
    if (n === 2) return { cells: [{ index: 0, col: '1', row: '1', h: 180 }, { index: 1, col: '2', row: '1', h: 180 }], cols: '1fr 1fr', gridW: 300 };
    // 3 photos: big left, 2 stacked right
    if (n === 3) return {
        cells: [
            { index: 0, col: '1', row: '1 / 3', h: 200 },
            { index: 1, col: '2', row: '1', h: 98 },
            { index: 2, col: '2', row: '2', h: 98 },
        ], cols: '1.3fr 1fr', gridW: 300,
    };
    // 4 photos: 2x2
    if (n === 4) return {
        cells: [
            { index: 0, col: '1', row: '1', h: 148 }, { index: 1, col: '2', row: '1', h: 148 },
            { index: 2, col: '1', row: '2', h: 148 }, { index: 3, col: '2', row: '2', h: 148 },
        ], cols: '1fr 1fr', gridW: 300,
    };
    // 5 photos: 2 top + 3 bottom
    if (n === 5) return {
        cells: [
            { index: 0, col: '1', row: '1', h: 140 }, { index: 1, col: '2', row: '1', h: 140 },
            { index: 2, col: '1', row: '2', h: 100 }, { index: 3, col: '2', row: '2', h: 100 }, { index: 4, col: '3', row: '2', h: 100 },
        ], cols: '1fr 1fr 1fr', gridW: 320,
    };
    // 6 photos: 3x2
    if (n === 6) return {
        cells: [
            { index: 0, col: '1', row: '1', h: 120 }, { index: 1, col: '2', row: '1', h: 120 }, { index: 2, col: '3', row: '1', h: 120 },
            { index: 3, col: '1', row: '2', h: 120 }, { index: 4, col: '2', row: '2', h: 120 }, { index: 5, col: '3', row: '2', h: 120 },
        ], cols: '1fr 1fr 1fr', gridW: 320,
    };
    // 7–9 photos: 3 per row
    const cells: CellDef[] = [];
    for (let i = 0; i < n; i++) {
        const col = (i % 3) + 1;
        const row = Math.floor(i / 3) + 1;
        cells.push({ index: i, col: String(col), row: String(row), h: 105 });
    }
    return { cells, cols: '1fr 1fr 1fr', gridW: 320 };
};

export const ImageGrid: React.FC<{ images: GridImage[] }> = ({ images }) => {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const count = images.length;
    const MAX = 9;
    const hiddenCount = Math.max(0, count - MAX);
    const { cells, cols, gridW } = buildCells(count, MAX);

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, width: gridW, borderRadius: 12, overflow: 'hidden' }}>
                {cells.map(({ index, col, row, h }) => {
                    const img = images[index];
                    const isLast = index === cells.length - 1 && hiddenCount > 0;
                    return (
                        <div
                            key={index}
                            onClick={() => setLightboxIndex(index)}
                            style={{ position: 'relative', height: h, overflow: 'hidden', cursor: 'zoom-in', gridColumn: col, gridRow: row }}
                        >
                            <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            {isLast && (
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: 'white', letterSpacing: '-0.5px' }}>
                                    +{hiddenCount}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {lightboxIndex !== null && (
                <LightboxGallery images={images} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
            )}
        </>
    );
};

export default FileMessage;
