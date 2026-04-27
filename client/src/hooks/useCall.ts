import { useRef, useState, useCallback, useEffect } from 'react';
import { wsService } from '../services/websocket';

const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add Metered.ca TURN (free 1 GB/mo):
    // { urls: 'turn:relay.metered.ca:80', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' },
];

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'error';

export interface CallInfo {
    state: CallState;
    peerId: number | null;
    peerName: string | null;
    callType: 'audio' | 'video';
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    isMuted: boolean;
    isCameraOff: boolean;
    errorMsg: string | null;
}

const IDLE: CallInfo = {
    state: 'idle', peerId: null, peerName: null, callType: 'audio',
    localStream: null, remoteStream: null, isMuted: false, isCameraOff: false, errorMsg: null,
};

export function useCall() {
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
    const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null);
    // If user presses accept before offer arrives — auto-accept when offer comes
    const wantsToAccept = useRef(false);

    const peerIdRef = useRef<number | null>(null);
    const peerNameRef = useRef<string | null>(null);
    const callTypeRef = useRef<'audio' | 'video'>('audio');

    const [callInfo, setCallInfo] = useState<CallInfo>(IDLE);

    const cleanup = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        pcRef.current?.close();
        pcRef.current = null;
        pendingCandidates.current = [];
        pendingOffer.current = null;
        wantsToAccept.current = false;
        peerIdRef.current = null;
        peerNameRef.current = null;
        setCallInfo(IDLE);
    }, []);

    const showError = useCallback((msg: string) => {
        setCallInfo(prev => ({ ...prev, state: 'error', errorMsg: msg }));
        setTimeout(cleanup, 3500);
    }, [cleanup]);

    const buildPC = useCallback((targetId: number) => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                wsService.send({ type: 'ice_candidate', target_id: targetId, candidate: candidate.toJSON() });
            }
        };

        pc.ontrack = (e) => {
            setCallInfo(prev => ({ ...prev, remoteStream: e.streams[0] ?? null }));
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                setCallInfo(prev => ({ ...prev, state: 'connected' }));
            }
            if (pc.connectionState === 'failed') {
                showError('Не удалось установить соединение. Попробуйте ещё раз.');
            }
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
                if (pcRef.current === pc) cleanup();
            }
        };

        return pc;
    }, [showError, cleanup]);

    const flushCandidates = useCallback(async (pc: RTCPeerConnection) => {
        for (const c of pendingCandidates.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
        pendingCandidates.current = [];
    }, []);

    const getMedia = useCallback(async (callType: 'audio' | 'video') => {
        const constraints = { audio: true, video: callType === 'video' };
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err: any) {
            const name = err?.name || '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                throw new Error('Доступ к микрофону/камере запрещён. Разрешите доступ в настройках браузера.');
            }
            if (name === 'NotFoundError') {
                throw new Error('Микрофон или камера не найдены.');
            }
            throw new Error('Не удалось получить доступ к микрофону/камере.');
        }
    }, []);

    // Core accept logic — called when both offer and callerId are ready
    const doAccept = useCallback(async () => {
        const offer = pendingOffer.current;
        const callerId = peerIdRef.current;
        const callerName = peerNameRef.current;
        const callType = callTypeRef.current;
        if (!offer || !callerId) return;

        try {
            const stream = await getMedia(callType);
            localStreamRef.current = stream;
            setCallInfo(prev => ({ ...prev, localStream: stream }));

            const pc = buildPC(callerId);
            stream.getTracks().forEach(t => pc.addTrack(t, stream));

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            await flushCandidates(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            wsService.send({ type: 'call_answer', target_id: callerId, sdp: answer });
            // Let onconnectionstatechange handle 'connected' — just ensure peer info is set
            setCallInfo(prev => ({ ...prev, peerId: callerId, peerName: callerName, callType }));
        } catch (err: any) {
            showError(err.message || 'Ошибка при принятии звонка.');
        }
    }, [getMedia, buildPC, flushCandidates, showError]);

    const startCall = useCallback(async (targetId: number, targetName: string, callType: 'audio' | 'video') => {
        try {
            const stream = await getMedia(callType);
            localStreamRef.current = stream;
            peerIdRef.current = targetId;
            peerNameRef.current = targetName;
            callTypeRef.current = callType;

            const pc = buildPC(targetId);
            stream.getTracks().forEach(t => pc.addTrack(t, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            wsService.send({ type: 'call_initiate', target_id: targetId, call_type: callType });
            wsService.send({ type: 'call_offer', target_id: targetId, sdp: offer });

            setCallInfo({ state: 'calling', peerId: targetId, peerName: targetName, callType, localStream: stream, remoteStream: null, isMuted: false, isCameraOff: false, errorMsg: null });
        } catch (err: any) {
            showError(err.message || 'Ошибка при инициации звонка.');
        }
    }, [getMedia, buildPC, showError]);

    const acceptCall = useCallback(() => {
        if (pendingOffer.current && peerIdRef.current) {
            doAccept();
        } else {
            // Offer hasn't arrived yet — flag it so we auto-accept when it comes
            wantsToAccept.current = true;
        }
    }, [doAccept]);

    const rejectCall = useCallback(() => {
        const peerId = peerIdRef.current;
        if (peerId) wsService.send({ type: 'call_reject', target_id: peerId });
        cleanup();
    }, [cleanup]);

    const endCall = useCallback(() => {
        const peerId = peerIdRef.current;
        if (peerId) wsService.send({ type: 'call_end', target_id: peerId });
        cleanup();
    }, [cleanup]);

    const toggleMute = useCallback(() => {
        const stream = localStreamRef.current;
        if (!stream) return;
        stream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
        setCallInfo(prev => ({ ...prev, isMuted: !prev.isMuted }));
    }, []);

    const toggleCamera = useCallback(() => {
        const stream = localStreamRef.current;
        if (!stream) return;
        stream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
        setCallInfo(prev => ({ ...prev, isCameraOff: !prev.isCameraOff }));
    }, []);

    useEffect(() => {
        const unsub = wsService.onMessage(async (msg) => {
            const { type, data } = msg;

            if (type === 'call_initiate') {
                peerIdRef.current = data.caller_id;
                peerNameRef.current = data.caller_name;
                callTypeRef.current = data.call_type || 'audio';
                setCallInfo(prev => ({
                    ...prev,
                    state: 'ringing',
                    peerId: data.caller_id,
                    peerName: data.caller_name,
                    callType: data.call_type || 'audio',
                    errorMsg: null,
                }));
            }

            if (type === 'call_offer') {
                pendingOffer.current = data.sdp as RTCSessionDescriptionInit;
                // If user already pressed Accept (offer was slow) — proceed now
                if (wantsToAccept.current) {
                    wantsToAccept.current = false;
                    doAccept();
                }
            }

            if (type === 'call_answer' && pcRef.current) {
                try {
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
                    await flushCandidates(pcRef.current);
                    // onconnectionstatechange will set 'connected' when ICE finishes
                } catch (err) {
                    console.error('call_answer error:', err);
                }
            }

            if (type === 'ice_candidate' && data.candidate) {
                if (pcRef.current?.remoteDescription) {
                    try { await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
                } else {
                    pendingCandidates.current.push(data.candidate);
                }
            }

            if (type === 'call_end' || type === 'call_reject') {
                cleanup();
            }
        });
        return unsub;
    }, [doAccept, flushCandidates, cleanup]);

    return { callInfo, startCall, acceptCall, rejectCall, endCall, toggleMute, toggleCamera };
}
