import { useSyncExternalStore } from 'react';

export const useMediaQuery = (query: string) => {
    const subscribe = (callback: () => void) => {
        if (typeof window.matchMedia !== 'function') return () => {};
        const media = window.matchMedia(query);
        media.addEventListener('change', callback);
        return () => media.removeEventListener('change', callback);
    };

    return useSyncExternalStore(
        subscribe,
        () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
        () => false,
    );
};

const getIsMobileSnapshot = (maxWidth: number) => {
    if (typeof window === 'undefined') return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return w <= maxWidth || (coarsePointer && Math.min(w, h) <= maxWidth && Math.max(w, h) <= 1180);
};

export const useIsMobile = (maxWidth = 768) => {
    const subscribe = (callback: () => void) => {
        const mobileMedia = typeof window.matchMedia === 'function'
            ? window.matchMedia(`(max-width: ${maxWidth}px)`)
            : null;
        const pointerMedia = typeof window.matchMedia === 'function'
            ? window.matchMedia('(pointer: coarse)')
            : null;
        window.addEventListener('resize', callback);
        window.visualViewport?.addEventListener('resize', callback);
        mobileMedia?.addEventListener('change', callback);
        pointerMedia?.addEventListener('change', callback);
        return () => {
            window.removeEventListener('resize', callback);
            window.visualViewport?.removeEventListener('resize', callback);
            mobileMedia?.removeEventListener('change', callback);
            pointerMedia?.removeEventListener('change', callback);
        };
    };

    return useSyncExternalStore(
        subscribe,
        () => getIsMobileSnapshot(maxWidth),
        () => false,
    );
};

export const useViewportSize = () => {
    const subscribe = (callback: () => void) => {
        window.addEventListener('resize', callback);
        window.visualViewport?.addEventListener('resize', callback);
        return () => {
            window.removeEventListener('resize', callback);
            window.visualViewport?.removeEventListener('resize', callback);
        };
    };
    const getSnapshot = () => `${window.innerWidth}x${window.innerHeight}`;
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => '1024x768');
    const [width, height] = snapshot.split('x').map(Number);
    return { width, height };
};
