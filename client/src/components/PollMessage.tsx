import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';

interface PollVoter {
    id: number;
    username: string;
    tag?: string;
    avatar?: string;
}

interface PollData {
    id: number;
    question: string;
    options: string[];
    is_anonymous: boolean;
    is_multi_choice: boolean;
    vote_counts: number[];
    total_voters: number;
    my_votes: number[];
    voters: PollVoter[][];
}

interface PollMessageProps {
    pollId: number;
    token: string;
    isDark?: boolean;
    isOled?: boolean;
    isOwn?: boolean;
}

const PollMessage: React.FC<PollMessageProps> = ({ pollId, token, isDark = false, isOled = false, isOwn = false }) => {
    const dm = isDark;
    const { lang } = useLang();
    const [poll, setPoll] = useState<PollData | null>(null);
    const [loading, setLoading] = useState(true);
    const [voting, setVoting] = useState(false);
    const [showVoters, setShowVoters] = useState<number | null>(null);
    const [pendingVotes, setPendingVotes] = useState<number[]>([]);
    const [unvoting, setUnvoting] = useState(false);

    const load = useCallback((resetPending = false) => {
        return api.getPoll(token, pollId).then(data => {
            setPoll(data);
            setPendingVotes(prev => (resetPending || prev.length === 0) ? (data.my_votes || []) : prev);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [token, pollId]);

    useEffect(() => {
        load();
        const interval = setInterval(() => load(), 8000);
        return () => clearInterval(interval);
    }, [load]);

    if (loading) return <div style={{ padding: '8px 0', opacity: 0.5, fontSize: 13 }}>📊 {lang === 'en' ? 'Loading poll...' : 'Загрузка опроса...'}</div>;
    if (!poll) return <div style={{ padding: '8px 0', opacity: 0.5, fontSize: 13 }}>📊 {lang === 'en' ? 'Poll unavailable' : 'Опрос недоступен'}</div>;

    const hasVoted = poll.my_votes.length > 0;
    const total = poll.total_voters || 0;

    const togglePending = (idx: number) => {
        if (hasVoted) return;
        if (poll.is_multi_choice) {
            setPendingVotes(v => v.includes(idx) ? v.filter(x => x !== idx) : [...v, idx]);
        } else {
            setPendingVotes([idx]);
        }
    };

    const submitVote = async () => {
        if (pendingVotes.length === 0 || voting) return;
        setVoting(true);
        await api.votePoll(token, pollId, pendingVotes).catch(() => {});
        await load();
        setVoting(false);
    };

    const handleUnvote = async () => {
        if (unvoting) return;
        setUnvoting(true);
        await api.unvotePoll(token, pollId).catch(() => {});
        await load(true);
        setUnvoting(false);
    };

    const textClr = isOwn ? 'white' : (dm ? '#e2e8f0' : '#1e1b4b');
    const subClr = isOwn ? 'rgba(255,255,255,0.65)' : (dm ? '#7c7caa' : '#6b7280');
    const barBg = isOwn ? 'rgba(255,255,255,0.18)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.1)');
    const barFill = isOwn ? 'rgba(255,255,255,0.55)' : '#6366f1';
    const optionHover = isOwn ? 'rgba(255,255,255,0.1)' : (dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.09)');
    const checkClr = isOwn ? 'rgba(255,255,255,0.9)' : '#6366f1';

    return (
        <div style={{ minWidth: 220, maxWidth: 300 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: textClr, marginBottom: 12, lineHeight: 1.35 }}>{poll.question}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {poll.options.map((opt, i) => {
                    const count = poll.vote_counts[i] || 0;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    const isMyVote = poll.my_votes.includes(i);
                    const isPending = pendingVotes.includes(i);
                    const isSelected = hasVoted ? isMyVote : isPending;
                    return (
                        <div key={i} onClick={() => togglePending(i)} style={{ borderRadius: 10, overflow: 'hidden', cursor: hasVoted ? 'default' : 'pointer', position: 'relative', border: isSelected ? `1.5px solid ${checkClr}` : '1.5px solid transparent', transition: 'border 0.15s' }}>
                            {hasVoted && (
                                <div style={{ position: 'absolute', inset: 0, borderRadius: 9, background: barBg, zIndex: 0 }}>
                                    <div style={{ height: '100%', width: `${pct}%`, background: barFill, opacity: 0.35, borderRadius: 9, transition: 'width 0.4s' }} />
                                </div>
                            )}
                            <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: (!hasVoted && isPending) ? optionHover : 'transparent', borderRadius: 9, transition: 'background 0.12s' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <div style={{ width: 18, height: 18, borderRadius: poll.is_multi_choice ? 4 : '50%', border: `2px solid ${isSelected ? checkClr : subClr}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: isSelected ? checkClr : 'transparent', transition: 'all 0.15s' }}>
                                        {isSelected && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="2,5 4,8 8,2" stroke={isOwn ? '#6366f1' : 'white'} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                    </div>
                                    <span style={{ fontSize: 13, color: textClr, fontWeight: isSelected ? 600 : 400, lineHeight: 1.3 }}>{opt}</span>
                                </div>
                                {hasVoted && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                        {!poll.is_anonymous && count > 0 && (
                                            <button onClick={e => { e.stopPropagation(); setShowVoters(showVoters === i ? null : i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subClr, fontSize: 11, padding: '0 2px', lineHeight: 1 }} title={lang === 'en' ? 'Show voters' : 'Показать проголосовавших'}>
                                                👥
                                            </button>
                                        )}
                                        <span style={{ fontSize: 11, color: subClr, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                                    </div>
                                )}
                            </div>
                            {showVoters === i && !poll.is_anonymous && poll.voters[i]?.length > 0 && (
                                <div style={{ padding: '6px 10px 8px', borderTop: `1px solid ${isOwn ? 'rgba(255,255,255,0.15)' : (dm ? 'rgba(255,255,255,0.06)' : '#ede9fe')}`, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {poll.voters[i].map(v => (
                                        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: v.avatar ? 'transparent' : '#6366f1', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {v.avatar ? <img src={config.fileUrl(v.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: 'white', fontWeight: 700 }}>{v.username[0]?.toUpperCase()}</span>}
                                            </div>
                                            <span style={{ fontSize: 11, color: subClr }}>{v.username}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {!hasVoted && (
                <button onClick={submitVote} disabled={pendingVotes.length === 0 || voting} style={{ marginTop: 10, width: '100%', padding: '9px', borderRadius: 10, border: 'none', background: isOwn ? 'rgba(255,255,255,0.22)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: isOwn ? 'white' : 'white', cursor: pendingVotes.length === 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: pendingVotes.length === 0 ? 0.45 : 1, transition: 'opacity 0.15s' }}>
                    {voting ? (lang === 'en' ? 'Voting...' : 'Голосую...') : (lang === 'en' ? 'Vote' : 'Проголосовать')}
                </button>
            )}
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: subClr }}>
                    {total === 0 ? (lang === 'en' ? 'No votes yet' : 'Пока нет голосов') : lang === 'en' ? `${total} ${total === 1 ? 'vote' : 'votes'}` : `${total} ${total % 10 === 1 && total % 100 !== 11 ? 'голос' : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 10 || total % 100 >= 20) ? 'голоса' : 'голосов'}`}
                </span>
                {hasVoted && (
                    <button onClick={handleUnvote} disabled={unvoting} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: subClr, opacity: unvoting ? 0.5 : 0.8, padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
                        {unvoting ? '...' : (lang === 'en' ? 'Retract vote' : 'Отменить голос')}
                    </button>
                )}
            </div>
        </div>
    );
};

export default PollMessage;
