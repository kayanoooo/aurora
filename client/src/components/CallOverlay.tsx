import React, { useEffect, useRef, useState } from 'react';
import { CallInfo } from '../hooks/useCall';

interface Props {
    callInfo: CallInfo;
    onAccept: () => void;
    onReject: () => void;
    onEnd: () => void;
    onToggleMute: () => void;
    onToggleCamera: () => void;
    dm: boolean;
    isOled: boolean;
    peerAvatar?: string | null;
    peerAvatarColor?: string;
}

function fmtDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function extractHex(color?: string): string {
    if (!color) return '#6366f1';
    const m = color.match(/#[0-9a-fA-F]{6}/);
    return m ? m[0] : '#6366f1';
}

const CallOverlay: React.FC<Props> = ({
    callInfo, onAccept, onReject, onEnd, onToggleMute, onToggleCamera,
    dm, isOled, peerAvatar, peerAvatarColor,
}) => {
    const { state, peerName, callType, localStream, remoteStream, isMuted, isCameraOff } = callInfo;
    const localVideoRef  = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (state !== 'connected') { setElapsed(0); return; }
        const id = setInterval(() => setElapsed(s => s + 1), 1000);
        return () => clearInterval(id);
    }, [state]);

    useEffect(() => {
        if (localVideoRef.current  && localStream)  localVideoRef.current.srcObject  = localStream;
    }, [localStream]);

    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
    }, [remoteStream]);

    const accent = extractHex(peerAvatarColor);

    // Dynamic background: dark base + colored spotlight behind avatar + corner accent
    const bg = [
        `radial-gradient(ellipse 110% 55% at 50% -5%, ${accent}66 0%, ${accent}22 35%, transparent 65%)`,
        `radial-gradient(ellipse 50% 30% at 15% 95%, ${accent}20 0%, transparent 55%)`,
        `radial-gradient(ellipse 40% 25% at 85% 90%, ${accent}15 0%, transparent 50%)`,
        'linear-gradient(180deg, #040010 0%, #080018 100%)',
    ].join(', ');

    const avatarLetter = peerName?.[0]?.toUpperCase() || '?';

    const statusLabel =
        state === 'error'     ? (callInfo.errorMsg ?? 'Ошибка') :
        state === 'calling'   ? 'Звоним...' :
        state === 'ringing'   ? `Входящий ${callType === 'video' ? 'видеозвонок' : 'аудиозвонок'}` :
        state === 'connected' ? fmtDuration(elapsed) : '';

    const iconBtn = (active: boolean, danger = false): React.CSSProperties => ({
        width: 60, height: 60, borderRadius: 30,
        background: danger
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : active
                ? `rgba(255,255,255,0.25)`
                : 'rgba(255,255,255,0.10)',
        border: active && !danger ? '1.5px solid rgba(255,255,255,0.3)' : '1.5px solid transparent',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', transition: 'all 0.2s',
        boxShadow: danger
            ? '0 6px 28px rgba(239,68,68,0.55)'
            : active
                ? '0 2px 16px rgba(255,255,255,0.2)'
                : `0 2px 12px rgba(0,0,0,0.4)`,
        backdropFilter: 'blur(8px)',
    });

    const bigBtn = (green: boolean): React.CSSProperties => ({
        width: 68, height: 68, borderRadius: 34,
        background: green
            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
            : 'linear-gradient(135deg, #ef4444, #dc2626)',
        border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', transition: 'all 0.18s',
        boxShadow: green
            ? '0 6px 32px rgba(34,197,94,0.6)'
            : '0 6px 32px rgba(239,68,68,0.6)',
    });

    const waves = [0, 0.45, 0.9, 1.35];

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: bg,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            userSelect: 'none',
        }}>
            <style>{`
                @keyframes callWave {
                    0%   { transform: scale(1);   opacity: 0.55; }
                    100% { transform: scale(2.4); opacity: 0; }
                }
                @keyframes callRingPulse {
                    0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.45; }
                    100% { transform: translate(-50%,-50%) scale(2.8); opacity: 0; }
                }
                @keyframes callAvatarGlow {
                    0%, 100% { box-shadow: 0 0 0 0 ${accent}55, 0 8px 40px ${accent}60; }
                    50%      { box-shadow: 0 0 0 12px ${accent}22, 0 8px 50px ${accent}80; }
                }
            `}</style>

            {/* Hidden audio — always plays remote audio */}
            <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

            {/* Remote video for video calls */}
            {callType === 'video' && remoteStream && (
                <video ref={remoteVideoRef} autoPlay playsInline
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.88 }}
                />
            )}
            {callType === 'video' && remoteStream && (
                <div style={{ position: 'absolute', inset: 0, backdropFilter: 'brightness(0.55)' }} />
            )}

            {/* Ringing: expanding rings */}
            {state === 'ringing' && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                    {[0, 0.6, 1.2].map((delay, i) => (
                        <div key={i} style={{
                            position: 'absolute', top: '38%', left: '50%',
                            width: 120, height: 120, borderRadius: '50%',
                            border: `2px solid ${accent}`,
                            opacity: 0,
                            animation: `callRingPulse 2.2s ease-out ${delay}s infinite`,
                        }} />
                    ))}
                </div>
            )}

            {/* Center content */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, marginBottom: 80 }}>

                {/* Avatar with sound waves */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Pulsing waves when connected */}
                    {state === 'connected' && waves.map((delay, i) => (
                        <div key={i} style={{
                            position: 'absolute',
                            width: 110, height: 110,
                            borderRadius: '50%',
                            border: `2px solid ${accent}`,
                            animation: `callWave 2s ease-out ${delay}s infinite`,
                            pointerEvents: 'none',
                        }} />
                    ))}

                    {/* Avatar circle */}
                    <div style={{
                        width: 110, height: 110, borderRadius: '50%',
                        background: peerAvatar ? 'transparent' : (peerAvatarColor || 'linear-gradient(135deg,#6366f1,#8b5cf6)'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 44, fontWeight: 700, color: 'white',
                        overflow: 'hidden', flexShrink: 0, position: 'relative', zIndex: 1,
                        animation: state === 'connected' ? 'callAvatarGlow 2.5s ease-in-out infinite' : undefined,
                        boxShadow: state !== 'connected'
                            ? `0 0 0 4px ${accent}44, 0 8px 40px ${accent}66`
                            : undefined,
                    }}>
                        {peerAvatar
                            ? <img src={peerAvatar} alt={peerName || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : avatarLetter}
                    </div>
                </div>

                {/* Name */}
                <div style={{ fontSize: 26, fontWeight: 700, color: 'white', textShadow: `0 2px 20px ${accent}88`, letterSpacing: -0.3 }}>
                    {peerName}
                </div>

                {/* Status */}
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, fontVariantNumeric: 'tabular-nums' }}>
                    {statusLabel}
                </div>

                {/* Call type indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: `${accent}cc`, fontSize: 12, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    {callType === 'video'
                        ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> Видео</>
                        : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l1.8-1.8a2 2 0 0 1 2.11-.45c.9.32 1.85.55 2.81.68a2 2 0 0 1 1.72 2.03z"/></svg> Аудио</>}
                </div>
            </div>

            {/* Local video PiP */}
            {callType === 'video' && localStream && (
                <video ref={localVideoRef} autoPlay playsInline muted
                    style={{
                        position: 'absolute', bottom: 144, right: 24,
                        width: 100, height: 140, borderRadius: 14,
                        objectFit: 'cover', border: '2px solid rgba(255,255,255,0.18)',
                        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                    }}
                />
            )}

            {/* Controls */}
            {state !== 'error' && (
                <div style={{ position: 'absolute', bottom: 52, display: 'flex', alignItems: 'center', gap: 24 }}>
                    {state === 'ringing' ? (
                        <>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                <button style={bigBtn(false)} onClick={onReject}>
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" transform="rotate(135 12 12)"/></svg>
                                </button>
                                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Отклонить</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                <button style={bigBtn(true)} onClick={onAccept}>
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                                </button>
                                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Принять</span>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Mute */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                <button style={iconBtn(isMuted)} onClick={onToggleMute}>
                                    {isMuted ? (
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                                    ) : (
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                                    )}
                                </button>
                                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{isMuted ? 'Включить' : 'Выключить'}</span>
                            </div>

                            {/* Camera (video only) */}
                            {callType === 'video' && (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                    <button style={iconBtn(isCameraOff)} onClick={onToggleCamera}>
                                        {isCameraOff ? (
                                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>
                                        ) : (
                                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                                        )}
                                    </button>
                                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{isCameraOff ? 'Включить' : 'Выключить'}</span>
                                </div>
                            )}

                            {/* End call */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                <button style={bigBtn(false)} onClick={onEnd}>
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" transform="rotate(135 12 12)"/></svg>
                                </button>
                                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Завершить</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default CallOverlay;
