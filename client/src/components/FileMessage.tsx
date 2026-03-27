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
                    title="Нажмите для просмотра • ПКМ — скачать"
                >
                    <img
                        src={fileUrl}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 14 }}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                    {/* Подсказка */}
                    <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.4))',
                        padding: '18px 10px 8px', borderRadius: '0 0 14px 14px',
                        fontSize: 11, color: 'rgba(255,255,255,0.8)', textAlign: 'right',
                    }}>
                        🔍 ПКМ — скачать
                    </div>
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

    // Whether this player is the globally active track
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

    const toggle = () => {
        if (onPlay) {
            if (isActive) {
                onGlobalToggle?.();
            } else {
                onPlay(url, name);
            }
            return;
        }
        const a = audioRef.current;
        if (!a) return;
        if (playing) { a.pause(); } else { a.play().catch(() => {}); }
    };

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isActive && onGlobalSeek) {
            onGlobalSeek(e);
            return;
        }
        const a = audioRef.current;
        if (!a || !localDuration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        a.currentTime = ratio * localDuration;
    };

    const bg = isOwn ? 'rgba(255,255,255,0.15)' : dm ? 'rgba(255,255,255,0.06)' : '#f5f3ff';
    const border = isOwn ? 'rgba(255,255,255,0.2)' : dm ? '#3a3a55' : '#ede9fe';
    const textColor = isOwn ? 'white' : dm ? '#e2e8f0' : '#1e1b4b';
    const subColor = isOwn ? 'rgba(255,255,255,0.55)' : dm ? '#7c7caa' : '#9ca3af';
    const trackBg = isOwn ? 'rgba(255,255,255,0.25)' : dm ? '#3a3a55' : '#ddd9f7';
    const fillColor = isOwn ? 'rgba(255,255,255,0.85)' : '#6366f1';
    const btnBg = isOwn ? 'rgba(255,255,255,0.2)' : dm ? 'rgba(99,102,241,0.18)' : '#ede9fe';
    const btnColor = isOwn ? 'white' : '#6366f1';

    return (
        <div style={{ width: 260, background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Local audio element — used only when no global player */}
            {!onPlay && (
                <audio
                    ref={audioRef}
                    src={url}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => { setPlaying(false); setLocalCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
                    onLoadedMetadata={e => setLocalDuration((e.target as HTMLAudioElement).duration)}
                    onTimeUpdate={e => {
                        const a = e.target as HTMLAudioElement;
                        setLocalCurrentTime(a.currentTime);
                        setLocalDuration(a.duration || 0);
                    }}
                />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                    onClick={toggle}
                    style={{ width: 36, height: 36, borderRadius: '50%', background: btnBg, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: btnColor, flexShrink: 0 }}
                >
                    {dispPlaying ? '⏸' : '▶'}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                    <div style={{ fontSize: 11, color: subColor, marginTop: 1 }}>{formatTime(dispCurrentTime)} / {formatTime(dispDuration)}</div>
                </div>
                <button
                    onClick={onDownload}
                    style={{ background: btnBg, border: 'none', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: 13, color: btnColor, flexShrink: 0 }}
                    title="Скачать"
                >
                    💾
                </button>
            </div>
            {/* Progress bar */}
            <div
                style={{ height: 4, borderRadius: 4, background: trackBg, cursor: 'pointer', position: 'relative' }}
                onClick={seek}
            >
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

export default FileMessage;
