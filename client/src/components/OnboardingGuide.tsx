import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useLang } from '../i18n';

interface OnboardingGuideProps {
    isDark?: boolean;
    onClose: () => void;
}

const steps = [
    {
        icon: (
            <div style={{ fontSize: 56, lineHeight: 1, textAlign: 'center' as const }}>
                <img src="/logo192.png" alt="Aurora" style={{ width: 72, height: 72, borderRadius: 18, boxShadow: '0 8px 24px rgba(255,107,0,0.4)' }} />
            </div>
        ),
        titleRu: 'Добро пожаловать в Aurora!',
        titleEn: 'Welcome to Aurora!',
        descRu: 'Быстрый мессенджер нового поколения. Давайте за пару минут покажем, как всё работает.',
        descEn: 'A fast next-generation messenger. Let us show you how everything works in a couple of minutes.',
        tip: null,
    },
    {
        icon: (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="url(#g1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#6366f1"/><stop offset="1" stopColor="#8b5cf6"/></linearGradient></defs>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
        ),
        titleRu: 'Находите людей и пишите им',
        titleEn: 'Find people and message them',
        descRu: 'Введите имя пользователя в строке поиска слева — нажмите на профиль и начните переписку. Всё сообщения доставляются мгновенно.',
        descEn: 'Type a username in the search bar on the left — click the profile and start chatting. All messages are delivered instantly.',
        tip: { icon: '🔍', ru: 'Поиск по тегу @username тоже работает', en: 'Search by @username tag also works' },
    },
    {
        icon: (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="url(#g2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#06b6d4"/><stop offset="1" stopColor="#6366f1"/></linearGradient></defs>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
        ),
        titleRu: 'Группы и каналы',
        titleEn: 'Groups and channels',
        descRu: 'Нажмите «+» в шапке сайдбара — создайте группу для общения или канал для публикаций. Приглашайте участников по тегу.',
        descEn: 'Click «+» in the sidebar header — create a group for chatting or a channel for broadcasting. Invite members by tag.',
        tip: { icon: '📢', ru: 'Каналы бывают публичные (с @тегом) и приватные (по ссылке)', en: 'Channels can be public (@tag) or private (invite link)' },
    },
    {
        icon: (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="url(#g3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ec4899"/><stop offset="1" stopColor="#f59e0b"/></linearGradient></defs>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
        ),
        titleRu: 'Медиа, файлы и голосовые',
        titleEn: 'Media, files and voice',
        descRu: 'Нажмите скрепку в поле ввода — прикрепляйте фото, видео и файлы. Держите микрофон — запишите голосовое сообщение.',
        descEn: 'Click the paperclip in the input bar — attach photos, videos and files. Hold the microphone — record a voice message.',
        tip: { icon: '🎵', ru: 'Аудио из чата воспроизводится в мини-плеере внизу сайдбара', en: 'Audio from chats plays in the mini player at the bottom of the sidebar' },
    },
    {
        icon: (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="url(#g4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <defs><linearGradient id="g4" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#10b981"/><stop offset="1" stopColor="#6366f1"/></linearGradient></defs>
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3"/>
                <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3"/>
            </svg>
        ),
        titleRu: 'Реакции, ответы и стикеры',
        titleEn: 'Reactions, replies and stickers',
        descRu: 'Дважды нажмите на сообщение — поставьте быструю реакцию. Удерживайте — откроется меню с ответом, пересылкой и другими действиями.',
        descEn: 'Double-tap a message to set a quick reaction. Long-press to open a menu with reply, forward and more actions.',
        tip: { icon: '😊', ru: 'Стикеры и GIF — в кнопке эмодзи слева от поля ввода', en: 'Stickers and GIFs are in the emoji button next to the input' },
    },
    {
        icon: (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="url(#g5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <defs><linearGradient id="g5" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f59e0b"/><stop offset="1" stopColor="#ef4444"/></linearGradient></defs>
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
        ),
        titleRu: 'Настройки и темы',
        titleEn: 'Settings and themes',
        descRu: 'Нажмите на своё имя или аватар внизу сайдбара — откроются настройки. Здесь можно сменить тему (Светлая / Тёмная / OLED), аватар, имя и конфиденциальность.',
        descEn: 'Click your name or avatar at the bottom of the sidebar — settings will open. Change theme (Light / Dark / OLED), avatar, name and privacy.',
        tip: { icon: '⭐', ru: '«Избранное» — личное хранилище для сохранённых сообщений и файлов', en: '«Favorites» is your personal storage for saved messages and files' },
    },
];

const LS_KEY = 'aurora_onboarding_seen';

const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ isDark = false, onClose }) => {
    const { lang } = useLang();
    const dm = isDark;
    const isOled = dm && document.body.classList.contains('oled-theme');

    const [step, setStep] = useState(0);
    const [exiting, setExiting] = useState(false);

    const bg = isOled ? '#000' : dm ? '#13131f' : '#ffffff';
    const cardBg = isOled ? '#050508' : dm ? '#1a1a2e' : '#f5f3ff';
    const text = dm ? '#e2e8f0' : '#1e1b4b';
    const sub = dm ? '#7c7caa' : '#6b7280';
    const border = isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.2)' : '#ede9fe';
    const accent = '#6366f1';

    const total = steps.length;
    const current = steps[step];
    const isLast = step === total - 1;
    const isMobile = window.innerWidth <= 600;

    const handleClose = () => {
        localStorage.setItem(LS_KEY, '1');
        setExiting(true);
        setTimeout(onClose, 220);
    };

    const handleNext = () => {
        if (isLast) { handleClose(); return; }
        setStep(s => s + 1);
    };

    const handlePrev = () => setStep(s => Math.max(0, s - 1));

    return ReactDOM.createPortal(
        <div
            className={exiting ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            style={{ position: 'fixed', inset: 0, zIndex: 9800, backgroundColor: isOled ? 'rgba(0,0,0,0.9)' : dm ? 'rgba(15,10,40,0.8)' : 'rgba(15,10,40,0.45)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
            onClick={handleClose}
        >
            <div
                className={exiting ? 'modal-exit' : 'modal-enter'}
                style={{ backgroundColor: bg, borderRadius: isMobile ? '20px 20px 0 0' : 24, width: isMobile ? '100%' : 440, maxWidth: '95vw', maxHeight: isMobile ? '88svh' : '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.3), 0 30px 80px rgba(0,0,0,0.95)' : dm ? '0 0 50px rgba(99,102,241,0.25), 0 30px 80px rgba(0,0,0,0.7)' : '0 0 40px rgba(99,102,241,0.15), 0 20px 60px rgba(0,0,0,0.15)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}
                onClick={e => e.stopPropagation()}
            >
                {/* Progress bar */}
                <div style={{ height: 3, backgroundColor: border, flexShrink: 0 }}>
                    <div style={{ height: '100%', backgroundColor: accent, width: `${((step + 1) / total) * 100}%`, transition: 'width 0.3s ease', borderRadius: '0 2px 2px 0' }} />
                </div>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 0', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {steps.map((_, i) => (
                            <div key={i} onClick={() => setStep(i)} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, backgroundColor: i === step ? accent : (i < step ? `${accent}60` : (dm ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)')), transition: 'all 0.25s ease', cursor: 'pointer' }} />
                        ))}
                    </div>
                    <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, padding: 4, display: 'flex', alignItems: 'center', borderRadius: 8 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
                    {/* Icon */}
                    <div style={{ width: 96, height: 96, borderRadius: 24, backgroundColor: cardBg, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: dm ? '0 4px 20px rgba(0,0,0,0.3)' : '0 4px 16px rgba(99,102,241,0.1)' }}>
                        {current.icon}
                    </div>

                    {/* Text */}
                    <div>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: text, margin: '0 0 10px', letterSpacing: '-0.3px', lineHeight: 1.25 }}>
                            {lang === 'en' ? current.titleEn : current.titleRu}
                        </h2>
                        <p style={{ fontSize: 14, color: sub, lineHeight: 1.65, margin: 0 }}>
                            {lang === 'en' ? current.descEn : current.descRu}
                        </p>
                    </div>

                    {/* Tip */}
                    {current.tip && (
                        <div style={{ width: '100%', padding: '11px 14px', borderRadius: 12, backgroundColor: isOled ? 'rgba(99,102,241,0.08)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)', border: `1px solid ${border}`, display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left' as const }}>
                            <span style={{ fontSize: 18, flexShrink: 0, marginTop: -1 }}>{current.tip.icon}</span>
                            <span style={{ fontSize: 13, color: dm ? '#a5b4fc' : '#4f46e5', lineHeight: 1.5 }}>
                                {lang === 'en' ? current.tip.en : current.tip.ru}
                            </span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '0 20px 20px', flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
                    {step > 0 ? (
                        <button onClick={handlePrev} style={{ height: 46, paddingInline: 20, borderRadius: 14, border: `1.5px solid ${border}`, backgroundColor: 'transparent', color: sub, fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                            ←
                        </button>
                    ) : (
                        <button onClick={handleClose} style={{ height: 46, paddingInline: 20, borderRadius: 14, border: `1.5px solid ${border}`, backgroundColor: 'transparent', color: sub, fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                            {lang === 'en' ? 'Skip' : 'Пропустить'}
                        </button>
                    )}
                    <button onClick={handleNext} style={{ flex: 1, height: 46, borderRadius: 14, border: 'none', background: isLast ? 'linear-gradient(135deg, #10b981, #059669)' : `linear-gradient(135deg, ${accent}, #8b5cf6)`, color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: isLast ? '0 4px 16px rgba(16,185,129,0.4)' : '0 4px 16px rgba(99,102,241,0.4)', transition: 'all 0.2s', letterSpacing: '-0.1px' }}>
                        {isLast
                            ? (lang === 'en' ? "Let's go! 🚀" : 'Начать! 🚀')
                            : (lang === 'en' ? 'Next →' : 'Далее →')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export const shouldShowOnboarding = (): boolean => !localStorage.getItem(LS_KEY);
export const resetOnboarding = () => localStorage.removeItem(LS_KEY);

export default OnboardingGuide;
