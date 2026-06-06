import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { clearAuroraMediaSession, updateAuroraMediaSession } from '../services/mediaSession';

export interface Track {
    id: number;
    playlist_id: number;
    title: string;
    artist?: string;
    file_path: string;
    cover_path?: string;
    duration?: number;
    position: number;
}

export interface Playlist {
    id: number;
    name: string;
    cover?: string;
    share_code?: string;
    tracks: Track[];
}

export interface MediaStateChange {
    track: Track | null;
    isPlaying: boolean;
    volume: number;
    progress: number;
    duration: number;
    toggle: () => void;
    prev: () => void;
    next: () => void;
    setVol: (v: number) => void;
}

interface Props {
    token: string;
    dm: boolean;
    isOled: boolean;
    isMobile?: boolean;
    visible: boolean;
    onClose: () => void;
    onNowPlaying: (track: Track | null) => void;
    onStateChange?: (s: MediaStateChange) => void;
    onSharePlaylist?: (pl: Playlist) => void;
    onPlayStart?: () => void;
}

type RepeatMode = 'none' | 'one' | 'all';

interface PlaylistUploadStatus {
    playlistId: number;
    total: number;
    processed: number;
    failed: number;
    current?: string;
    canceled?: boolean;
}

const splitTrackFilename = (filename: string) => {
    const clean = filename.replace(/\.[^/.]+$/, '').trim();
    const parts = clean.split(/\s+-\s+/, 2);
    return parts.length === 2
        ? { title: parts[0].trim(), artist: parts[1].trim() }
        : { title: clean, artist: undefined };
};

const isAudioFile = (file: File) => {
    if (file.type.startsWith('audio/')) return true;
    return /\.(aac|aiff?|alac|amr|ape|flac|m4a|mp3|oga|ogg|opus|wav|webm|wma)$/i.test(file.name);
};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const readAudioDuration = (filePath: string): Promise<number> => new Promise(resolve => {
    const audio = new Audio();
    const url = config.fileUrl(filePath) ?? filePath;
    let settled = false;
    let timeoutId: number | undefined;

    const finish = (value: number) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
        audio.src = '';
        resolve(Number.isFinite(value) ? Math.round(value) : 0);
    };
    const onLoaded = () => finish(audio.duration || 0);
    const onError = () => finish(0);

    timeoutId = window.setTimeout(() => finish(0), 8000);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('error', onError);
    audio.src = url;
    audio.load();
});

const MediaPlayer: React.FC<Props> = ({ token, dm, isOled, isMobile = false, visible, onClose, onNowPlaying, onStateChange, onSharePlaylist, onPlayStart }) => {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [shuffle, setShuffle] = useState(false);
    const [repeat, setRepeat] = useState<RepeatMode>('none');
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [creatingPlaylist, setCreatingPlaylist] = useState(false);
    const [renaming, setRenaming] = useState<number | null>(null);
    const [renameVal, setRenameVal] = useState('');
    const [view, setView] = useState<'playlists' | 'player'>('playlists');
    const [collapsedPlaylists, setCollapsedPlaylists] = useState<Set<number>>(new Set());
    const [uploadStatus, setUploadStatus] = useState<PlaylistUploadStatus | null>(null);
    const uploadCancelRef = useRef(false);
    const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
    const uploadStatusClearTimerRef = useRef<number | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const shuffleOrder = useRef<number[]>([]);
    const metadataRequestedRef = useRef<Set<number>>(new Set());

    const bg = isOled ? '#000000' : dm ? '#0f0f1a' : '#ffffff';
    const bg2 = isOled ? '#000000' : dm ? '#16162a' : '#f5f3ff';
    const bg3 = isOled ? '#000000' : dm ? '#1e1e3a' : '#ede9fe';
    const text = isOled ? '#e2e0ff' : dm ? '#e2e8f0' : '#1e1b4b';
    const sub = isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af';
    const accent = isOled ? '#a78bfa' : '#6366f1';
    const border = isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.18)' : '#ede9fe';

    useEffect(() => {
        api.getPlaylists(token).then(data => {
            if (Array.isArray(data)) setPlaylists(data);
        });
    }, [token]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const onTime = () => setProgress(audio.currentTime);
        const onDur = () => setDuration(audio.duration || 0);
        const onEnded = () => handleEnded();
        audio.addEventListener('timeupdate', onTime);
        audio.addEventListener('loadedmetadata', onDur);
        audio.addEventListener('ended', onEnded);
        return () => {
            audio.removeEventListener('timeupdate', onTime);
            audio.removeEventListener('loadedmetadata', onDur);
            audio.removeEventListener('ended', onEnded);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTrack, repeat, shuffle, activePlaylist]);

    useEffect(() => {
        if (!currentTrack || (currentTrack.cover_path && currentTrack.artist) || !activePlaylist) return;
        const trackId = currentTrack.id;
        if (metadataRequestedRef.current.has(trackId)) return;
        metadataRequestedRef.current.add(trackId);
        const playlistId = activePlaylist.id;
        api.extractTrackCover(token, trackId).then(result => {
            if (!result) return;
            const updateTrack = (track: Track): Track => ({
                ...track,
                cover_path: result.cover_path || track.cover_path,
                title: result.title || track.title,
                artist: result.artist || track.artist,
            });
            setCurrentTrack(current => current?.id === trackId ? updateTrack(current) : current);
            setPlaylists(prev => prev.map(p => p.id === playlistId
                ? { ...p, tracks: p.tracks.map(t => t.id === trackId ? updateTrack(t) : t) }
                : p));
            setActivePlaylist(prev => prev?.id === playlistId
                ? { ...prev, tracks: prev.tracks.map(t => t.id === trackId ? updateTrack(t) : t) }
                : prev);
        }).catch(() => {});
    }, [currentTrack, activePlaylist, token]);

    useEffect(() => () => {
        uploadCancelRef.current = true;
        uploadXhrRef.current?.abort();
        if (uploadStatusClearTimerRef.current) window.clearTimeout(uploadStatusClearTimerRef.current);
    }, []);

    const loadAndPlay = useCallback((track: Track) => {
        onPlayStart?.();
        const audio = audioRef.current!;
        audio.src = config.fileUrl(track.file_path) ?? track.file_path;
        audio.volume = volume;
        audio.play().catch(() => {});
        setCurrentTrack(track);
        setIsPlaying(true);
        setView('player');
        onNowPlaying(track);
        api.setNowPlaying(token, track.title, track.artist).catch(() => {});
    }, [volume, token, onNowPlaying, onPlayStart]);

    const handleEnded = useCallback(() => {
        if (!activePlaylist || !currentTrack) return;
        const tracks = activePlaylist.tracks;
        if (repeat === 'one') { audioRef.current!.currentTime = 0; audioRef.current!.play().catch(() => {}); return; }
        if (shuffle) {
            const idx = shuffleOrder.current.indexOf(currentTrack.id);
            const nextIdx = idx < shuffleOrder.current.length - 1 ? idx + 1 : 0;
            const nextTrack = tracks.find(t => t.id === shuffleOrder.current[nextIdx]);
            if (nextTrack && (repeat === 'all' || idx < shuffleOrder.current.length - 1)) loadAndPlay(nextTrack);
            else stopPlayback();
        } else {
            const idx = tracks.findIndex(t => t.id === currentTrack.id);
            if (idx < tracks.length - 1) loadAndPlay(tracks[idx + 1]);
            else if (repeat === 'all') loadAndPlay(tracks[0]);
            else stopPlayback();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePlaylist, currentTrack, repeat, shuffle, loadAndPlay]);

    const stopPlayback = () => {
        audioRef.current!.pause();
        setIsPlaying(false);
        setCurrentTrack(null);
        onNowPlaying(null);
        api.setNowPlaying(token, null).catch(() => {});
    };

    const togglePlay = () => {
        const audio = audioRef.current!;
        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
            api.setNowPlaying(token, null).catch(() => {});
        } else {
            audio.play().catch(() => {});
            setIsPlaying(true);
            if (currentTrack) api.setNowPlaying(token, currentTrack.title, currentTrack.artist).catch(() => {});
        }
    };

    const playTrack = (track: Track, playlist: Playlist) => {
        setActivePlaylist(playlist);
        if (shuffle) shuffleOrder.current = [...playlist.tracks].sort(() => Math.random() - 0.5).map(t => t.id);
        loadAndPlay(track);
    };

    const prevTrack = () => {
        if (!activePlaylist || !currentTrack) return;
        const tracks = activePlaylist.tracks;
        if (shuffle) {
            const idx = shuffleOrder.current.indexOf(currentTrack.id);
            const prevIdx = idx > 0 ? idx - 1 : repeat === 'all' ? shuffleOrder.current.length - 1 : -1;
            if (prevIdx >= 0) { const t = tracks.find(t => t.id === shuffleOrder.current[prevIdx]); if (t) loadAndPlay(t); }
        } else {
            const idx = tracks.findIndex(t => t.id === currentTrack.id);
            if (idx > 0) loadAndPlay(tracks[idx - 1]);
            else if (repeat === 'all') loadAndPlay(tracks[tracks.length - 1]);
        }
    };

    const nextTrack = () => {
        if (!activePlaylist || !currentTrack) return;
        const tracks = activePlaylist.tracks;
        if (shuffle) {
            const idx = shuffleOrder.current.indexOf(currentTrack.id);
            const nextIdx = idx < shuffleOrder.current.length - 1 ? idx + 1 : repeat === 'all' ? 0 : -1;
            if (nextIdx >= 0) { const t = tracks.find(t => t.id === shuffleOrder.current[nextIdx]); if (t) loadAndPlay(t); }
        } else {
            const idx = tracks.findIndex(t => t.id === currentTrack.id);
            if (idx < tracks.length - 1) loadAndPlay(tracks[idx + 1]);
            else if (repeat === 'all') loadAndPlay(tracks[0]);
        }
    };

    const handleVolumeChange = (v: number) => {
        setVolume(v);
        if (audioRef.current) audioRef.current.volume = v;
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const t = parseFloat(e.target.value);
        if (audioRef.current) audioRef.current.currentTime = t;
        setProgress(t);
    };

    const createPlaylist = async () => {
        if (!newPlaylistName.trim()) return;
        const pl = await api.createPlaylist(token, newPlaylistName.trim());
        if (pl.id) setPlaylists(prev => [{ id: pl.id, name: pl.name, tracks: [] }, ...prev]);
        setNewPlaylistName(''); setCreatingPlaylist(false);
    };

    const deletePlaylist = async (id: number) => {
        await api.deletePlaylist(token, id);
        setPlaylists(prev => prev.filter(p => p.id !== id));
        if (activePlaylist?.id === id) setActivePlaylist(null);
    };

    const renamePlaylist = async (id: number) => {
        if (!renameVal.trim()) return;
        await api.renamePlaylist(token, id, renameVal.trim());
        setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: renameVal.trim() } : p));
        setRenaming(null);
    };

    const cancelTrackUpload = () => {
        uploadCancelRef.current = true;
        uploadXhrRef.current?.abort();
        setUploadStatus(current => current
            ? { ...current, canceled: true, current: undefined }
            : current);
    };

    const handleFileAdd = async (playlist: Playlist, files: FileList | File[]) => {
        const audioFiles = Array.from(files).filter(isAudioFile);
        if (audioFiles.length === 0) return;

        const playlistId = playlist.id;
        let processed = 0;
        let failed = 0;
        let canceled = false;
        uploadCancelRef.current = false;
        if (uploadStatusClearTimerRef.current) {
            window.clearTimeout(uploadStatusClearTimerRef.current);
            uploadStatusClearTimerRef.current = null;
        }
        const uploadFileWithRetry = async (file: File) => {
            let lastError: unknown = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                if (uploadCancelRef.current) throw new Error('Upload cancelled');
                let currentXhr: XMLHttpRequest | null = null;
                try {
                    return await api.uploadFileWithProgress(token, file, () => {}, (xhr: XMLHttpRequest) => {
                        currentXhr = xhr;
                        uploadXhrRef.current = xhr;
                        if (uploadCancelRef.current) xhr.abort();
                    });
                } catch (error) {
                    if (uploadCancelRef.current) throw error;
                    lastError = error;
                    if (attempt === 0) await wait(600);
                } finally {
                    if (currentXhr && uploadXhrRef.current === currentXhr) uploadXhrRef.current = null;
                }
            }
            throw lastError;
        };

        setUploadStatus({ playlistId, total: audioFiles.length, processed: 0, failed: 0, current: audioFiles[0]?.name });

        for (const file of audioFiles) {
            if (uploadCancelRef.current) { canceled = true; break; }
            setUploadStatus(current => current?.playlistId === playlistId
                ? { ...current, current: file.name }
                : current);

            let fileFailed = false;
            let fileCompleted = false;
            try {
                const data = await uploadFileWithRetry(file);
                if (uploadCancelRef.current) { canceled = true; break; }
                if (!data?.file_path) throw new Error('Upload finished without file_path');

                const fallback = splitTrackFilename(file.name);
                const title = data.audio_title || fallback.title;
                const artist = data.audio_artist || fallback.artist;
                const dur = await readAudioDuration(data.file_path);
                if (uploadCancelRef.current) { canceled = true; break; }
                const track = await api.addTrack(token, {
                    playlist_id: playlistId,
                    title,
                    artist,
                    file_path: data.file_path,
                    cover_path: data.cover_path,
                    duration: dur,
                });
                if (!track?.id) throw new Error(track?.detail || 'Track was not added');

                const newTrack: Track = {
                    id: track.id,
                    playlist_id: playlistId,
                    title,
                    artist,
                    file_path: data.file_path,
                    cover_path: data.cover_path,
                    duration: dur,
                    position: track.position || 0,
                };
                setPlaylists(prev => prev.map(p => p.id === playlistId
                    ? { ...p, tracks: [...p.tracks, { ...newTrack, position: newTrack.position || p.tracks.length + 1 }] }
                    : p));
                setActivePlaylist(prev => prev?.id === playlistId
                    ? { ...prev, tracks: [...prev.tracks, { ...newTrack, position: newTrack.position || prev.tracks.length + 1 }] }
                    : prev);
                fileCompleted = true;
            } catch (error) {
                if (uploadCancelRef.current) {
                    canceled = true;
                } else {
                    fileFailed = true;
                    console.warn('Playlist track upload failed:', file.name, error);
                }
            } finally {
                if (fileFailed) {
                    failed += 1;
                    processed += 1;
                } else if (fileCompleted) {
                    processed += 1;
                }
                const nextProcessed = processed;
                const nextFailed = failed;
                const nextCanceled = canceled || uploadCancelRef.current;
                const nextCurrent = !nextCanceled && nextProcessed < audioFiles.length ? audioFiles[nextProcessed]?.name : undefined;
                setUploadStatus(current => current?.playlistId === playlistId
                    ? { ...current, processed: nextProcessed, failed: nextFailed, current: nextCurrent, canceled: nextCanceled || current.canceled }
                    : current);
            }
            if (canceled || uploadCancelRef.current) break;
        }

        try {
            const freshPlaylists = await api.getPlaylists(token);
            if (Array.isArray(freshPlaylists)) {
                setPlaylists(freshPlaylists);
                setActivePlaylist(prev => {
                    if (!prev || prev.id !== playlistId) return prev;
                    return freshPlaylists.find((p: Playlist) => p.id === playlistId) || prev;
                });
            }
        } catch (error) {
            console.warn('Playlist refresh after upload failed:', error);
        }

        uploadXhrRef.current = null;
        uploadStatusClearTimerRef.current = window.setTimeout(() => {
            setUploadStatus(current => current?.playlistId === playlistId && current.processed >= current.total
                ? null
                : current?.playlistId === playlistId && current.canceled
                    ? null
                    : current);
            uploadStatusClearTimerRef.current = null;
        }, canceled || failed ? 4500 : 1800);
    };

    const handleCoverUpload = async (playlist: Playlist, file: File) => {
        const res = await api.updatePlaylistCover(token, playlist.id, file);
        if (res.cover) {
            setPlaylists(prev => prev.map(p => p.id === playlist.id ? { ...p, cover: res.cover } : p));
            if (activePlaylist?.id === playlist.id) setActivePlaylist(prev => prev ? { ...prev, cover: res.cover } : prev);
        }
    };

    const toggleCollapse = (id: number) => setCollapsedPlaylists(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    // Stable refs so MiniPlayer controls always call the latest version
    const toggleRef = useRef(togglePlay);
    const prevRef = useRef(prevTrack);
    const nextRef = useRef(nextTrack);
    const volRef = useRef(handleVolumeChange);
    toggleRef.current = togglePlay;
    prevRef.current = prevTrack;
    nextRef.current = nextTrack;
    volRef.current = handleVolumeChange;
    const stableToggle = useCallback(() => toggleRef.current(), []);
    const stablePrev = useCallback(() => prevRef.current(), []);
    const stableNext = useCallback(() => nextRef.current(), []);
    const stableSetVol = useCallback((v: number) => volRef.current(v), []);

    useEffect(() => {
        onStateChange?.({ track: currentTrack, isPlaying, volume, progress, duration, toggle: stableToggle, prev: stablePrev, next: stableNext, setVol: stableSetVol });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTrack, isPlaying, volume, progress, duration]);

    useEffect(() => () => clearAuroraMediaSession('music'), []);

    useEffect(() => {
        if (!currentTrack) {
            clearAuroraMediaSession('music');
            return;
        }
        const artwork = currentTrack.cover_path
            ? (config.fileUrl(currentTrack.cover_path) ?? currentTrack.cover_path)
            : activePlaylist?.cover
                ? (config.fileUrl(activePlaylist.cover) ?? activePlaylist.cover)
                : null;
        updateAuroraMediaSession('music', {
            title: currentTrack.title,
            artist: currentTrack.artist || 'Aurora',
            album: activePlaylist?.name || 'Aurora',
            artwork,
            duration,
            position: progress,
            playbackState: isPlaying ? 'playing' : 'paused',
            handlers: {
                play: () => { if (!isPlaying) stableToggle(); },
                pause: () => { if (isPlaying) stableToggle(); },
                stop: stopPlayback,
                previoustrack: stablePrev,
                nexttrack: stableNext,
                seekto: time => {
                    if (!audioRef.current) return;
                    audioRef.current.currentTime = time;
                    setProgress(time);
                },
            },
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTrack, activePlaylist?.name, activePlaylist?.cover, isPlaying, progress, duration, stableToggle, stablePrev, stableNext]);

    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    const btnStyle = (active?: boolean): React.CSSProperties => ({
        background: active ? (isOled ? 'rgba(167,139,250,0.18)' : 'rgba(99,102,241,0.14)') : 'none',
        border: 'none', cursor: 'pointer', color: active ? accent : sub,
        borderRadius: 8, padding: '6px 8px', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
    });

    const coverUrl = (path?: string) => path ? (config.fileUrl(path) ?? path) : null;

    return (
        <>
        <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={e => {
            const plId = parseInt(fileInputRef.current?.getAttribute('data-pl') || '0');
            const pl = playlists.find(p => p.id === plId);
            if (pl && e.target.files) handleFileAdd(pl, Array.from(e.target.files));
            e.target.value = '';
        }} />
        <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
            const plId = parseInt(coverInputRef.current?.getAttribute('data-pl') || '0');
            const pl = playlists.find(p => p.id === plId);
            if (pl && e.target.files?.[0]) handleCoverUpload(pl, e.target.files[0]);
            e.target.value = '';
        }} />

        {visible && <div style={{ position: 'fixed', inset: 0, zIndex: 4000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', backgroundColor: isMobile ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)' }} onClick={onClose}>
            <div className={`${isMobile ? 'mobile-fullscreen ' : ''}aurora-media-panel`} style={{ background: bg, borderRadius: isMobile ? 0 : 26, width: isMobile ? '100%' : 500, height: isMobile ? '100dvh' : undefined, maxHeight: isMobile ? '100dvh' : '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 80px rgba(124,58,237,0.4), 0 40px 100px rgba(0,0,0,0.98)' : dm ? '0 0 60px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.7)' : '0 0 50px rgba(99,102,241,0.18), 0 20px 60px rgba(0,0,0,0.18)', position: 'relative', paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0, paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }} onClick={e => e.stopPropagation()}>

                {/* Mobile drag handle */}
                {/* Header */}
                <div className="aurora-media-header" style={{ padding: isMobile ? '10px 16px 10px' : '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setView('playlists')} style={{ ...btnStyle(view === 'playlists'), fontSize: 13, padding: '5px 12px', fontWeight: 600 }}>Плейлисты</button>
                        {currentTrack && <button onClick={() => setView('player')} style={{ ...btnStyle(view === 'player'), fontSize: 13, padding: '5px 12px', fontWeight: 600 }}>Плеер</button>}
                    </div>
                    <button onClick={onClose} style={{ ...btnStyle(), fontSize: 18, padding: '4px 8px', color: sub }}>✕</button>
                </div>

                <div className="aurora-media-body" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 14px' : '16px 20px' }}>

                    {/* ─── PLAYLISTS VIEW ─── */}
                    {view === 'playlists' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <span style={{ color: text, fontWeight: 700, fontSize: 15 }}>Мои плейлисты</span>
                                <button onClick={() => setCreatingPlaylist(true)} style={{ background: accent, border: 'none', color: 'white', borderRadius: 10, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Создать</button>
                            </div>

                            {creatingPlaylist && (
                                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                                    <input autoFocus value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createPlaylist()} placeholder="Название плейлиста" style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: 'none', background: bg2, color: text, fontSize: 13, outline: 'none', boxShadow: `0 0 0 1px ${border}` }} />
                                    <button onClick={createPlaylist} style={{ background: accent, border: 'none', color: 'white', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>OK</button>
                                    <button onClick={() => setCreatingPlaylist(false)} style={{ background: bg3, border: 'none', color: sub, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>✕</button>
                                </div>
                            )}

                            {uploadStatus && (
                                <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 14, padding: '10px 12px', marginBottom: 14, boxShadow: isOled ? '0 0 24px rgba(167,139,250,0.1)' : '0 8px 24px rgba(15,23,42,0.08)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                        <span style={{ color: text, fontWeight: 700, fontSize: 13 }}>
                                            {uploadStatus.canceled
                                                ? `Загрузка отменена: ${uploadStatus.processed} из ${uploadStatus.total}`
                                                : uploadStatus.processed >= uploadStatus.total
                                                ? `Загружено ${uploadStatus.total - uploadStatus.failed} из ${uploadStatus.total}`
                                                : `Загрузка ${uploadStatus.processed + 1}/${uploadStatus.total}`}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                            {uploadStatus.failed > 0 && <span style={{ color: '#f87171', fontSize: 12, fontWeight: 700 }}>Ошибок: {uploadStatus.failed}</span>}
                                            {!uploadStatus.canceled && uploadStatus.processed < uploadStatus.total && (
                                                <button onClick={cancelTrackUpload} style={{ border: `1px solid ${isOled ? 'rgba(248,113,113,0.35)' : 'rgba(248,113,113,0.28)'}`, background: isOled ? 'rgba(127,29,29,0.18)' : dm ? 'rgba(127,29,29,0.22)' : '#fff1f2', color: '#f87171', borderRadius: 9, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                                    Отменить
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ height: 5, borderRadius: 999, background: isOled ? 'rgba(167,139,250,0.12)' : 'rgba(99,102,241,0.14)', overflow: 'hidden', marginBottom: uploadStatus.current ? 7 : 0 }}>
                                        <div style={{ width: `${Math.min(100, (uploadStatus.processed / uploadStatus.total) * 100)}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${accent}, ${isOled ? '#7c3aed' : '#ec4899'})`, transition: 'width 0.2s ease' }} />
                                    </div>
                                    {uploadStatus.current && <div style={{ color: sub, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadStatus.current}</div>}
                                </div>
                            )}

                            {playlists.length === 0 && <div style={{ textAlign: 'center', color: sub, padding: '40px 0', fontSize: 14 }}>Нет плейлистов. Создайте первый!</div>}

                            {playlists.map(pl => {
                                const plCover = coverUrl(pl.cover);
                                return (
                                <div className="aurora-playlist-card" key={pl.id} style={{ background: bg2, borderRadius: 16, marginBottom: 12, overflow: 'hidden', boxShadow: `0 2px 16px rgba(0,0,0,0.1)` }}>
                                    {/* Playlist header row */}
                                    <div style={{ padding: isMobile ? '12px 12px 8px' : '14px 14px 10px', display: 'flex', alignItems: 'center', gap: 14 }}>
                                        {/* Cover — clickable to change */}
                                        <div
                                            onClick={() => { coverInputRef.current!.setAttribute('data-pl', String(pl.id)); coverInputRef.current!.click(); }}
                                            title="Изменить обложку"
                                            style={{ width: 72, height: 72, borderRadius: 14, flexShrink: 0, cursor: 'pointer', position: 'relative', overflow: 'hidden',
                                                background: plCover ? `url(${plCover}) center/cover` : `linear-gradient(135deg, ${accent}, ${isOled ? '#7c3aed' : '#8b5cf6'})`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                                                boxShadow: isOled ? '0 4px 20px rgba(139,92,246,0.35)' : '0 4px 16px rgba(99,102,241,0.2)' }}>
                                            {!plCover && '🎵'}
                                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s', fontSize: 18 }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.4)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}>
                                            </div>
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            {renaming === pl.id ? (
                                                <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renamePlaylist(pl.id); if (e.key === 'Escape') setRenaming(null); }} style={{ width: '100%', background: bg3, border: 'none', borderRadius: 8, padding: '5px 10px', color: text, fontSize: 15, outline: 'none', fontWeight: 600 }} />
                                            ) : (
                                                <div style={{ color: text, fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{pl.name}</div>
                                            )}
                                            <div onClick={() => toggleCollapse(pl.id)} style={{ color: sub, fontSize: 12, cursor: 'pointer', userSelect: 'none' as const, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {pl.tracks.length} {pl.tracks.length === 1 ? 'трек' : pl.tracks.length < 5 ? 'трека' : 'треков'}
                                                <span style={{ fontSize: 10, opacity: 0.7 }}>{collapsedPlaylists.has(pl.id) ? '▶' : '▼'}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                                                <button disabled={uploadStatus?.playlistId === pl.id && !uploadStatus.canceled && uploadStatus.processed < uploadStatus.total} onClick={() => { fileInputRef.current!.setAttribute('data-pl', String(pl.id)); fileInputRef.current!.click(); }} style={{ ...btnStyle(), opacity: uploadStatus?.playlistId === pl.id && !uploadStatus.canceled && uploadStatus.processed < uploadStatus.total ? 0.45 : 1 }} title="Добавить музыку">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                                </button>
                                                <button onClick={() => { setRenaming(pl.id); setRenameVal(pl.name); }} style={btnStyle()} title="Переименовать">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                                </button>
                                                <button onClick={() => onSharePlaylist?.(pl)} style={btnStyle()} title="Поделиться в чат">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                                </button>
                                                <button onClick={() => deletePlaylist(pl.id)} style={{ ...btnStyle(), color: '#f87171' }} title="Удалить">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Track list */}
                                    {pl.tracks.length > 0 && !collapsedPlaylists.has(pl.id) && (
                                        <div style={{ borderTop: `1px solid ${border}` }}>
                                            {pl.tracks.map((track, i) => (
                                                <div className="aurora-track-row" key={track.id}
                                                    onClick={() => playTrack(track, pl)}
                                                    onMouseEnter={e => { if (currentTrack?.id !== track.id) e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.05)' : 'rgba(99,102,241,0.04)'; }}
                                                    onMouseLeave={e => { if (currentTrack?.id !== track.id) e.currentTarget.style.background = 'transparent'; }}
                                                    onTouchStart={e => { if (currentTrack?.id !== track.id) e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.08)' : 'rgba(99,102,241,0.07)'; }}
                                                    onTouchEnd={e => { if (currentTrack?.id !== track.id) e.currentTarget.style.background = 'transparent'; }}
                                                    style={{ padding: isMobile ? '9px 12px' : '7px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: currentTrack?.id === track.id ? (isOled ? 'rgba(167,139,250,0.1)' : 'rgba(99,102,241,0.08)') : 'transparent', transition: 'background 0.15s' }}>
                                                    {/* Track cover or number */}
                                                    <div style={{ width: 32, height: 32, borderRadius: 6, flexShrink: 0, overflow: 'hidden', background: track.cover_path ? `url(${coverUrl(track.cover_path)}) center/cover` : (currentTrack?.id === track.id ? accent : bg3), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: currentTrack?.id === track.id ? 'white' : sub }}>
                                                        {!track.cover_path && (currentTrack?.id === track.id && isPlaying ? '▶' : String(i + 1))}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ color: currentTrack?.id === track.id ? accent : text, fontSize: 13, fontWeight: currentTrack?.id === track.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
                                                        {track.artist && <div style={{ color: sub, fontSize: 11 }}>{track.artist}</div>}
                                                    </div>
                                                    {track.duration && <span style={{ color: sub, fontSize: 11, flexShrink: 0 }}>{fmt(track.duration)}</span>}
                                                    <button onClick={e => { e.stopPropagation(); api.deleteTrack(token, track.id); setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, tracks: p.tracks.filter(t => t.id !== track.id) } : p)); }} style={{ ...btnStyle(), fontSize: 11, padding: '3px 5px', opacity: 0.45 }}>✕</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );})}
                        </div>
                    )}

                    {/* ─── PLAYER VIEW ─── */}
                    {view === 'player' && currentTrack && (() => {
                        const trackCover = coverUrl(currentTrack.cover_path);
                        const coverSz = isMobile ? Math.min(window.innerWidth - 48, 300) : 260;
                        return (
                        <div className="aurora-player-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            {/* Back */}
                            <button onClick={() => setView('playlists')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: sub, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, padding: '0 0 16px', fontFamily: 'inherit' }}>
                                ← {activePlaylist?.name}
                            </button>

                            {/* Large Cover */}
                            <div className="aurora-player-cover" style={{ width: coverSz, height: coverSz, borderRadius: isMobile ? 24 : 22, flexShrink: 0, overflow: 'hidden',
                                background: trackCover ? `url(${trackCover}) center/cover` : `linear-gradient(135deg, ${accent}, ${isOled ? '#5b21b6' : '#8b5cf6'})`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80,
                                boxShadow: isOled ? `0 20px 70px rgba(139,92,246,0.55)` : '0 16px 48px rgba(99,102,241,0.3)',
                                marginBottom: isMobile ? 24 : 28 }}>
                                {!trackCover && '🎵'}
                            </div>

                            {/* Track info */}
                            <div style={{ textAlign: 'center', marginBottom: isMobile ? 20 : 24, width: '100%' }}>
                                <div style={{ color: text, fontWeight: 800, fontSize: isMobile ? 22 : 20, marginBottom: 6,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {currentTrack.title}
                                </div>
                                <div style={{ color: accent, fontSize: isMobile ? 15 : 14, fontWeight: 600 }}>
                                    {currentTrack.artist || 'Неизвестный исполнитель'}
                                </div>
                            </div>

                            {/* Progress */}
                            <div style={{ width: '100%', marginBottom: isMobile ? 4 : 8 }}>
                                <input className="aurora-volume-range aurora-progress-range" type="range" min={0} max={duration || 1} step={0.1} value={progress} onChange={handleSeek}
                                    style={{ '--range-progress': `${duration ? Math.min(100, (progress / duration) * 100) : 0}%`, '--range-accent': accent, width: '100%' } as React.CSSProperties} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: sub, fontSize: 12, marginTop: 6 }}>
                                    <span>{fmt(progress)}</span><span>{fmt(duration)}</span>
                                </div>
                            </div>

                            {/* Controls */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                                gap: isMobile ? 24 : 16, marginBottom: isMobile ? 20 : 20,
                                marginTop: isMobile ? 12 : 8, width: '100%' }}>
                                <button onClick={() => {
                                    setShuffle(s => {
                                        const next = !s;
                                        if (next && activePlaylist) shuffleOrder.current = [...activePlaylist.tracks].sort(() => Math.random() - 0.5).map(t => t.id);
                                        return next;
                                    });
                                }}
                                    style={{ ...btnStyle(shuffle), padding: isMobile ? '8px' : '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    title="Перемешать">
                                    <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
                                </button>
                                <button onClick={prevTrack}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: text,
                                        padding: isMobile ? '6px' : '4px 8px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width={isMobile ? 30 : 24} height={isMobile ? 30 : 24} viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                                </button>
                                <button onClick={togglePlay}
                                    style={{ width: isMobile ? 80 : 64, height: isMobile ? 80 : 64,
                                        borderRadius: '50%',
                                        background: `linear-gradient(135deg, ${accent}, ${isOled ? '#7c3aed' : '#8b5cf6'})`,
                                        border: 'none', cursor: 'pointer',
                                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: `0 8px 28px ${isOled ? 'rgba(139,92,246,0.6)' : 'rgba(99,102,241,0.5)'}`,
                                        flexShrink: 0 }}>
                                    {isPlaying
                                        ? <svg width={isMobile ? 28 : 22} height={isMobile ? 28 : 22} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
                                        : <svg width={isMobile ? 28 : 22} height={isMobile ? 28 : 22} viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                    }
                                </button>
                                <button onClick={nextTrack}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: text,
                                        padding: isMobile ? '6px' : '4px 8px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width={isMobile ? 30 : 24} height={isMobile ? 30 : 24} viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                                </button>
                                <button onClick={() => setRepeat(r => r === 'none' ? 'all' : r === 'all' ? 'one' : 'none')}
                                    style={{ ...btnStyle(repeat !== 'none'), padding: isMobile ? '8px' : '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {repeat === 'one'
                                        ? <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="10" y="14" fontSize="7" fontWeight="bold" fill="currentColor" stroke="none">1</text></svg>
                                        : <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                                    }
                                </button>
                            </div>

                            {/* Volume — shown on mobile too as horizontal slider */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                marginBottom: isMobile ? 8 : 0 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>
                                <input className="aurora-volume-range" type="range" min={0} max={1} step={0.01} value={volume}
                                    onChange={e => handleVolumeChange(parseFloat(e.target.value))}
                                    style={{ '--range-progress': `${volume * 100}%`, '--range-accent': accent, flex: 1 } as React.CSSProperties} />
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                            </div>
                        </div>
                        );
                    })()}

                </div>
            </div>
        </div>}
        </>
    );
};

export default MediaPlayer;

// ─── MiniPlayer dock ──────────────────────────────────────────────────────────
export const MiniPlayer: React.FC<{
    track: Track | null;
    isPlaying: boolean;
    volume: number;
    trackProgress?: number;
    trackDuration?: number;
    dm: boolean;
    isOled: boolean;
    isMobile?: boolean;
    onToggle: () => void;
    onPrev: () => void;
    onNext: () => void;
    onVolume: (v: number) => void;
    onOpen: () => void;
    chatAudio?: { filename: string; currentTime: number; duration: number } | null;
    chatAudioPlaying?: boolean;
    onChatAudioToggle?: () => void;
    onChatAudioStop?: () => void;
    onChatAudioPrev?: () => void;
    onChatAudioNext?: () => void;
}> = ({ track, isPlaying, volume, trackProgress = 0, trackDuration = 0, dm, isOled, isMobile = false, onToggle, onPrev, onNext, onVolume, onOpen, chatAudio, chatAudioPlaying, onChatAudioToggle, onChatAudioStop, onChatAudioPrev, onChatAudioNext }) => {
    const [showVol, setShowVol] = useState(false);
    const [volPos, setVolPos] = useState<{ top: number; right: number } | null>(null);
    const volBtnRef = useRef<HTMLButtonElement>(null);
    const hasMusic = !!track;
    const hasAudio = !!chatAudio;
    if (!hasMusic && !hasAudio) return null;

    const bg = isOled ? '#000000' : dm ? '#13131f' : '#ffffff';
    const text = isOled ? '#e2e0ff' : dm ? '#e2e8f0' : '#1e1b4b';
    const sub = isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af';
    const accent = isOled ? '#a78bfa' : '#6366f1';
    const trackCover = track?.cover_path ? (config.fileUrl(track.cover_path) ?? track.cover_path) : null;
    const volIcon = volume === 0
        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
        : volume < 0.5
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
    const fmtTime = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
    const handleVolToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!showVol && volBtnRef.current) {
            const r = volBtnRef.current.getBoundingClientRect();
            setVolPos({ top: r.top - 48, right: window.innerWidth - r.right });
        }
        setShowVol(v => !v);
    };

    const showAudio = hasAudio;
    const showMusic = hasMusic && !hasAudio;
    const isVoice = showAudio && /^voice_/i.test(chatAudio!.filename);

    const borderTopCol = isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)';

    const coverEl = showAudio
        ? <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `linear-gradient(135deg,#6366f1,#8b5cf6)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
            {isVoice ? '🎤' : '🎵'}
          </div>
        : <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, overflow: 'hidden', backgroundImage: trackCover ? `url(${trackCover})` : `linear-gradient(135deg,${accent},${isOled ? '#5b21b6' : '#8b5cf6'})`, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
            {!trackCover && '🎵'}
          </div>;

    return (
        <div className={isMobile ? 'mobile-mini-player' : undefined} style={{ margin: '0 8px 6px', background: bg, borderRadius: 14, border: `1px solid ${borderTopCol}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: showMusic ? 'pointer' : 'default', borderRadius: 14 }} onClick={showMusic ? onOpen : undefined}>
                {coverEl}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {showAudio ? <>
                        <div style={{ color: text, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {isVoice ? 'Голосовое сообщение' : chatAudio!.filename}
                        </div>
                        <div style={{ fontSize: 9, color: sub, marginTop: 2 }}>{fmtTime(chatAudio!.currentTime)}{chatAudio!.duration > 0 ? ` / ${fmtTime(chatAudio!.duration)}` : ''}</div>
                    </> : <>
                        <div style={{ color: text, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track!.title}</div>
                        {track!.artist && <div style={{ color: sub, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track!.artist}</div>}
                        <div style={{ fontSize: 9, color: sub, marginTop: 1 }}>{fmtTime(trackProgress)}{trackDuration > 0 ? ` / ${fmtTime(trackDuration)}` : ''}</div>
                    </>}
                </div>
                {showAudio ? <>
                    {!isVoice && onChatAudioPrev && <button onClick={e => { e.stopPropagation(); onChatAudioPrev!(); }} style={{ background: 'none', border: 'none', color: sub, cursor: 'pointer', padding: '2px 3px', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>}
                    <button onClick={e => { e.stopPropagation(); onChatAudioToggle?.(); }} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}>{chatAudioPlaying ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>}</button>
                    {!isVoice && onChatAudioNext && <button onClick={e => { e.stopPropagation(); onChatAudioNext!(); }} style={{ background: 'none', border: 'none', color: sub, cursor: 'pointer', padding: '2px 3px', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>}
                    <button onClick={e => { e.stopPropagation(); onChatAudioStop?.(); }} style={{ background: 'none', border: 'none', color: sub, cursor: 'pointer', padding: '2px 3px', display: 'flex', alignItems: 'center' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </> : <>
                    <button onClick={e => { e.stopPropagation(); onPrev(); }} style={{ background: 'none', border: 'none', color: sub, cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
                    <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}>{isPlaying ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>}</button>
                    <button onClick={e => { e.stopPropagation(); onNext(); }} style={{ background: 'none', border: 'none', color: sub, cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
                    <div style={{ position: 'relative' }}>
                        <button ref={volBtnRef} onClick={handleVolToggle} style={{ background: 'none', border: 'none', color: sub, cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}>{volIcon}</button>
                        {showVol && volPos && <div className="mini-volume-popover" style={{ position: 'fixed', top: volPos.top, right: volPos.right, background: bg, borderRadius: 10, padding: '8px 10px', boxShadow: '0 4px 20px rgba(0,0,0,0.35)', border: `1px solid ${isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}`, zIndex: 9999 }} onClick={e => e.stopPropagation()}>
                            <input className="aurora-volume-range" type="range" min={0} max={1} step={0.01} value={volume} onChange={e => onVolume(parseFloat(e.target.value))} style={{ '--range-progress': `${volume * 100}%`, '--range-accent': accent } as React.CSSProperties} />
                        </div>}
                    </div>
                </>}
            </div>
        </div>
    );
};

// ─── PlaylistBubble — rendered inside chat for playlist share messages ─────────
export interface PlaylistShareData {
    id: number;
    name: string;
    cover?: string;
    tracks: { title: string; artist?: string; duration?: number; file_path?: string; cover_path?: string }[];
    total: number;
}

export const PLAYLIST_MSG_PREFIX = '__PLAYLIST__';

export const parsePlaylistMsg = (text: string): PlaylistShareData | null => {
    if (!text.startsWith(PLAYLIST_MSG_PREFIX)) return null;
    try { return JSON.parse(text.slice(PLAYLIST_MSG_PREFIX.length)); } catch { return null; }
};

export const PlaylistBubble: React.FC<{
    data: PlaylistShareData;
    isOwn: boolean;
    dm: boolean;
    isOled: boolean;
    onClick: () => void;
}> = ({ data, isOwn, dm, isOled, onClick }) => {
    const accent = isOled ? '#a78bfa' : '#6366f1';
    const sub = isOwn ? 'rgba(255,255,255,0.5)' : (isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af');
    const textColor = isOwn ? '#fff' : (isOled ? '#e2e0ff' : dm ? '#e2e8f0' : '#1e1b4b');
    const coverUrl = data.cover ? (config.fileUrl(data.cover) ?? data.cover) : null;
    const shown = data.tracks.slice(0, 3);
    const more = data.total - shown.length;
    const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
    const accentAlpha = isOwn ? 'rgba(255,255,255,0.12)' : (isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)');

    return (
        <div onClick={onClick} style={{ cursor: 'pointer', width: 240 }}>
            {/* Cover banner */}
            <div style={{ width: '100%', height: 80, borderRadius: 12, overflow: 'hidden', position: 'relative', marginBottom: 10,
                background: coverUrl ? `url(${coverUrl}) center/cover` : `linear-gradient(135deg, ${accent}cc, ${isOled ? '#5b21b6' : '#8b5cf6'}aa)` }}>
                {!coverUrl && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                )}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 60%)', display: 'flex', alignItems: 'flex-end', padding: '8px 10px', gap: 6 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{data.name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>{data.total} {data.total === 1 ? 'трек' : data.total < 5 ? 'трека' : 'треков'}</div>
                    </div>
                </div>
            </div>
            {/* Track list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {shown.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                        <span style={{ fontSize: 10, color: sub, minWidth: 12, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                        <div style={{ fontSize: 12, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, lineHeight: 1.3 }}>
                            {t.title}{t.artist && <span style={{ color: sub, fontWeight: 400 }}> — {t.artist}</span>}
                        </div>
                        {t.duration && <span style={{ fontSize: 10, color: sub, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.duration)}</span>}
                    </div>
                ))}
                {more > 0 && (
                    <div style={{ fontSize: 11, color: accent, paddingTop: 4, paddingLeft: 20, fontWeight: 500 }}>
                        + {more} {more === 1 ? 'трек' : more < 5 ? 'трека' : 'треков'}
                    </div>
                )}
            </div>
            {/* Open label */}
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderRadius: 8, background: accentAlpha }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isOwn ? 'rgba(255,255,255,0.7)' : accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <span style={{ fontSize: 11, color: isOwn ? 'rgba(255,255,255,0.7)' : accent, fontWeight: 600 }}>{isOwn ? 'Open playlist' : 'Открыть плейлист'}</span>
            </div>
        </div>
    );
};
