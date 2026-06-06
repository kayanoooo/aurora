export interface AuroraMediaSessionHandlers {
    play?: () => void;
    pause?: () => void;
    stop?: () => void;
    nexttrack?: () => void;
    previoustrack?: () => void;
    seekto?: (time: number) => void;
}

export interface AuroraMediaSessionState {
    title: string;
    artist?: string;
    album?: string;
    artwork?: string | null;
    duration?: number;
    position?: number;
    playbackState?: MediaSessionPlaybackState;
    handlers?: AuroraMediaSessionHandlers;
}

let activeOwner: string | null = null;

const isSupported = () => typeof navigator !== 'undefined' && 'mediaSession' in navigator;

const defaultArtwork = [
    { src: '/logo192.png', sizes: '192x192', type: 'image/png' },
    { src: '/logo512.png', sizes: '512x512', type: 'image/png' },
];

const buildArtwork = (src?: string | null) => {
    if (!src) return defaultArtwork;
    return [
        { src, sizes: '512x512', type: 'image/png' },
        ...defaultArtwork,
    ];
};

const clearHandlers = () => {
    if (!isSupported()) return;
    const actions: MediaSessionAction[] = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekto'];
    actions.forEach(action => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
    });
};

export const updateAuroraMediaSession = (owner: string, state: AuroraMediaSessionState) => {
    if (!isSupported()) return;
    activeOwner = owner;

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: state.title || 'Aurora',
            artist: state.artist || 'Aurora',
            album: state.album || 'Aurora',
            artwork: buildArtwork(state.artwork),
        });
        navigator.mediaSession.playbackState = state.playbackState || 'none';
    } catch {}

    clearHandlers();
    const handlers = state.handlers || {};

    try { navigator.mediaSession.setActionHandler('play', handlers.play || null); } catch {}
    try { navigator.mediaSession.setActionHandler('pause', handlers.pause || null); } catch {}
    try { navigator.mediaSession.setActionHandler('stop', handlers.stop || null); } catch {}
    try { navigator.mediaSession.setActionHandler('nexttrack', handlers.nexttrack || null); } catch {}
    try { navigator.mediaSession.setActionHandler('previoustrack', handlers.previoustrack || null); } catch {}
    try {
        navigator.mediaSession.setActionHandler('seekto', handlers.seekto
            ? details => {
                if (typeof details.seekTime === 'number') handlers.seekto?.(details.seekTime);
            }
            : null);
    } catch {}

    const duration = state.duration || 0;
    const position = Math.max(0, Math.min(state.position || 0, duration || state.position || 0));
    if (duration > 0 && 'setPositionState' in navigator.mediaSession) {
        try {
            navigator.mediaSession.setPositionState({
                duration,
                position,
                playbackRate: 1,
            });
        } catch {}
    }
};

export const clearAuroraMediaSession = (owner: string) => {
    if (!isSupported()) return;
    if (activeOwner && activeOwner !== owner) return;
    activeOwner = null;
    clearHandlers();
    try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
    } catch {}
};
