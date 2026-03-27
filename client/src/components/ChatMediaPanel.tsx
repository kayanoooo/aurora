import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { config } from '../config';

interface MediaFile {
    messageId: number;
    filePath: string;
    filename: string;
    fileSize?: number;
    timestamp?: string;
}

interface ChatMediaPanelProps {
    messages: any[];
    isDark: boolean;
    onClose: () => void;
    onGoToMessage: (messageId: number) => void;
}

const BASE_URL = config.BASE_URL;

const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name);
const isVideo = (name: string) => /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(name);
const isAudio = (name: string) => /\.(mp3|ogg|wav|flac|aac|m4a|opus|weba)$/i.test(name);
const isMedia = (name: string) => isImage(name) || isVideo(name);

const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (ts?: string) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const downloadFile = async (src: string, filename: string) => {
    try {
        const res = await fetch(src);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
        window.open(src, '_blank');
    }
};

const Lightbox: React.FC<{ src: string; filename: string; isVideo: boolean; onClose: () => void }> = ({ src, filename, isVideo: vid, onClose }) => {
    const download = () => downloadFile(src, filename);

    return ReactDOM.createPortal(
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
            {/* Toolbar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(rgba(0,0,0,0.6), transparent)' }}
                onClick={e => e.stopPropagation()}>
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 500, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {filename}
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={download}
                        style={{ padding: '8px 16px', background: 'rgba(99,102,241,0.85)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backdropFilter: 'blur(4px)' }}>
                        💾 Скачать
                    </button>
                    <button onClick={onClose}
                        style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.12)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        ✕
                    </button>
                </div>
            </div>
            {/* Media */}
            <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '84vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {vid
                    ? <video src={src} controls autoPlay style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} />
                    : <img src={src} alt={filename} style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12, objectFit: 'contain', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} />
                }
            </div>
            {/* Hint */}
            <div style={{ position: 'absolute', bottom: 20, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                Нажмите вне изображения или Esc чтобы закрыть
            </div>
        </div>,
        document.body
    );
};

const ChatMediaPanel: React.FC<ChatMediaPanelProps> = ({ messages, isDark: dm, onClose, onGoToMessage }) => {
    const [tab, setTab] = useState<'media' | 'audio' | 'files'>('media');
    const [lightbox, setLightbox] = useState<{ src: string; filename: string; isVideo: boolean } | null>(null);

    // Extract all files from messages
    const { mediaFiles, audioFiles, otherFiles } = useMemo(() => {
        const media: MediaFile[] = [];
        const audios: MediaFile[] = [];
        const others: MediaFile[] = [];

        for (const msg of messages) {
            const addFile = (fp: string, fn: string, fs?: number) => {
                const item: MediaFile = { messageId: msg.id, filePath: fp, filename: fn, fileSize: fs, timestamp: msg.timestamp };
                if (isMedia(fn)) media.push(item);
                else if (isAudio(fn)) audios.push(item);
                else others.push(item);
            };

            if (msg.file_path && msg.filename) {
                addFile(msg.file_path, msg.filename, msg.file_size);
            }
            if (msg.files) {
                const arr = typeof msg.files === 'string' ? (() => { try { return JSON.parse(msg.files); } catch { return []; } })() : msg.files;
                if (Array.isArray(arr)) {
                    for (const f of arr) {
                        if (f.file_path && f.filename) addFile(f.file_path, f.filename, f.file_size);
                    }
                }
            }
        }

        return { mediaFiles: media.reverse(), audioFiles: audios.reverse(), otherFiles: others.reverse() };
    }, [messages]);

    const bg = dm ? '#13131f' : 'white';
    const bg2 = dm ? '#1a1a2e' : '#f8f9ff';
    const border = dm ? 'rgba(99,102,241,0.18)' : '#ede9fe';
    const text = dm ? '#e2e8f0' : '#1e1b4b';
    const sub = dm ? '#6060a0' : '#9ca3af';
    const tabActive = { background: '#6366f1', color: 'white', border: 'none' };
    const tabInactive = { background: 'none', color: sub, border: `1px solid ${border}` };

    return (
        <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
            background: bg, borderLeft: `1px solid ${border}`,
            display: 'flex', flexDirection: 'column', zIndex: 50,
            boxShadow: '-4px 0 20px rgba(0,0,0,0.12)',
            animation: 'slideInRight 0.18s ease',
        }}>
            {/* Header */}
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: text }}>Медиа и файлы</span>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, fontSize: 18, lineHeight: 1 }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: `1px solid ${border}`, backgroundColor: bg2 }}>
                <button onClick={() => setTab('media')} style={{ flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, ...(tab === 'media' ? tabActive : tabInactive) }}>
                    🖼 Медиа {mediaFiles.length > 0 && `(${mediaFiles.length})`}
                </button>
                <button onClick={() => setTab('audio')} style={{ flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, ...(tab === 'audio' ? tabActive : tabInactive) }}>
                    🎵 Аудио {audioFiles.length > 0 && `(${audioFiles.length})`}
                </button>
                <button onClick={() => setTab('files')} style={{ flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, ...(tab === 'files' ? tabActive : tabInactive) }}>
                    📄 Файлы {otherFiles.length > 0 && `(${otherFiles.length})`}
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {tab === 'media' && (
                    mediaFiles.length === 0
                        ? <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>Нет медиафайлов</div>
                        : <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                            {mediaFiles.map((f, i) => {
                                const src = f.filePath.startsWith('http') ? f.filePath : `${BASE_URL}${f.filePath}`;
                                const vid = isVideo(f.filename);
                                return (
                                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: dm ? '#252540' : '#f0f0f8' }}
                                        title={f.filename}>
                                        {vid ? (
                                            <video src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                onClick={() => setLightbox({ src, filename: f.filename, isVideo: true })} />
                                        ) : (
                                            <img src={src} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                onClick={() => setLightbox({ src, filename: f.filename, isVideo: false })} />
                                        )}
                                        {vid && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ color: 'white', fontSize: 12, marginLeft: 2 }}>▶</span>
                                            </div>
                                        </div>}
                                        <button onClick={e => { e.stopPropagation(); onGoToMessage(f.messageId); onClose(); }}
                                            style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 5, color: 'white', fontSize: 10, padding: '2px 5px', cursor: 'pointer', lineHeight: 1.4 }}>
                                            →
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                )}

                {tab === 'audio' && (
                    audioFiles.length === 0
                        ? <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>Нет аудиофайлов</div>
                        : <div style={{ padding: '4px 0' }}>
                            {audioFiles.map((f, i) => {
                                const src = f.filePath.startsWith('http') ? f.filePath : `${BASE_URL}${f.filePath}`;
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
                                        <div style={{ width: 38, height: 38, borderRadius: 10, background: dm ? '#252540' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18, color: '#6366f1' }}>
                                            🎵
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.filename}</div>
                                            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                                                {formatSize(f.fileSize)}{f.fileSize && f.timestamp ? ' · ' : ''}{formatDate(f.timestamp)}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                            <button onClick={() => downloadFile(src, f.filename)} style={{ width: 28, height: 28, borderRadius: 8, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1', fontSize: 14 }} title="Скачать">⬇</button>
                                            <button onClick={() => { onGoToMessage(f.messageId); onClose(); }} style={{ width: 28, height: 28, borderRadius: 8, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Перейти к сообщению">→</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                )}

                {tab === 'files' && (
                    otherFiles.length === 0
                        ? <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>Нет файлов</div>
                        : <div style={{ padding: '4px 0' }}>
                            {otherFiles.map((f, i) => {
                                const src = f.filePath.startsWith('http') ? f.filePath : `${BASE_URL}${f.filePath}`;
                                const ext = f.filename.split('.').pop()?.toUpperCase() || 'FILE';
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
                                        <div style={{ width: 38, height: 38, borderRadius: 10, background: dm ? '#252540' : '#ede9fe', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <span style={{ fontSize: 9, fontWeight: 700, color: '#6366f1', letterSpacing: '0.5px' }}>{ext}</span>
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.filename}</div>
                                            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                                                {formatSize(f.fileSize)}{f.fileSize && f.timestamp ? ' · ' : ''}{formatDate(f.timestamp)}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                            <button onClick={() => downloadFile(src, f.filename)} style={{ width: 28, height: 28, borderRadius: 8, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1', fontSize: 14 }} title="Скачать">⬇</button>
                                            <button onClick={() => { onGoToMessage(f.messageId); onClose(); }}
                                                style={{ width: 28, height: 28, borderRadius: 8, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Перейти к сообщению">→</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                )}
            </div>

            {lightbox && <Lightbox src={lightbox.src} filename={lightbox.filename} isVideo={lightbox.isVideo} onClose={() => setLightbox(null)} />}
        </div>
    );
};

export default ChatMediaPanel;
