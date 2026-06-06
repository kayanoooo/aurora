import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useIsMobile } from '../hooks/useMediaQuery';

interface Props {
    initialTab?: 'license' | 'privacy';
    isDark?: boolean;
    onClose: () => void;
}

const PolicyModal: React.FC<Props> = ({ initialTab = 'license', isDark = false, onClose }) => {
    const [tab, setTab] = useState<'license' | 'privacy'>(initialTab);
    const isMobile = useIsMobile();
    const dm = isDark;
    const isOled = dm && typeof document !== 'undefined' && document.body.classList.contains('oled-theme');

    const bg      = isOled ? '#000000' : dm ? '#0e0e1a' : '#ffffff';
    const col     = dm ? '#eef2ff' : '#1e1b4b';
    const subCol  = dm ? '#a5b4fc' : '#9ca3af';
    const accent  = dm ? '#a78bfa' : '#6366f1';
    const shadow  = isOled
        ? '0 0 60px rgba(124,58,237,0.35), 0 32px 80px rgba(0,0,0,0.97)'
        : dm
        ? '0 0 40px rgba(99,102,241,0.25), 0 24px 70px rgba(0,0,0,0.7)'
        : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.14)';
    const metaBg  = dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.04)';
    const tabBarBg = dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)';
    const shellClass = `${isMobile ? 'mobile-fullscreen ' : ''}policy-modal-shell ${dm ? 'policy-modal-themed' : 'policy-modal-light'}`;

    const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
        <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 3, height: 13, borderRadius: 2, background: accent, flexShrink: 0 }} />
                {title}
            </div>
            <div style={{ fontSize: 13, color: col, lineHeight: 1.7, paddingLeft: 9 }}>{children}</div>
        </div>
    );

    return ReactDOM.createPortal(
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 10000, background: isOled ? 'rgba(0,0,0,0.92)' : dm ? 'rgba(10,8,30,0.78)' : 'rgba(15,10,40,0.45)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center' }}
            onClick={onClose}
        >
            <div className={shellClass}
                style={{ backgroundColor: bg, borderRadius: isMobile ? 0 : 22, width: isMobile ? '100%' : 500, maxWidth: isMobile ? 'none' : '95vw', height: isMobile ? '100dvh' : undefined, maxHeight: isMobile ? '100dvh' : '84vh', paddingTop: isMobile ? 'env(safe-area-inset-top)' : undefined, paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : undefined, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: shadow, position: 'relative' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Glow strip at top */}
                <div style={{ position: 'absolute', top: 0, left: '15%', right: '15%', height: 1, background: isOled ? 'linear-gradient(90deg, transparent, rgba(167,139,250,0.5), transparent)' : dm ? 'linear-gradient(90deg, transparent, rgba(99,102,241,0.4), transparent)' : 'linear-gradient(90deg, transparent, rgba(99,102,241,0.25), transparent)', pointerEvents: 'none', zIndex: 1 }} />

                {/* Header */}
                <div style={{ padding: '20px 22px 14px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, overflow: 'hidden', boxShadow: isOled ? '0 0 14px rgba(124,58,237,0.5)' : '0 0 10px rgba(99,102,241,0.3)' }}>
                                <img src="/logo192.png" alt="Aurora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                            <div style={{ fontSize: 17, fontWeight: 800, color: col }}>Документы Aurora</div>
                        </div>
                        <button onClick={onClose} style={{ background: isOled ? 'rgba(167,139,250,0.14)' : dm ? 'rgba(99,102,241,0.16)' : 'rgba(99,102,241,0.07)', border: dm ? '1px solid rgba(167,139,250,0.12)' : 'none', borderRadius: 10, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: col }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>

                    {/* Tabs */}
                    <div style={{ display: 'flex', background: tabBarBg, borderRadius: 12, padding: 4, gap: 4 }}>
                        {(['license', 'privacy'] as const).map(t => (
                            <button key={t} onClick={() => setTab(t)} style={{
                                flex: 1, padding: '9px 0', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                background: tab === t
                                    ? (isOled ? 'rgba(167,139,250,0.22)' : dm ? 'rgba(99,102,241,0.24)' : 'white')
                                    : 'transparent',
                                color: tab === t ? (dm ? '#f5f3ff' : accent) : subCol,
                                boxShadow: tab === t ? (isOled ? '0 0 12px rgba(167,139,250,0.2), 0 2px 8px rgba(0,0,0,0.4)' : dm ? '0 2px 8px rgba(0,0,0,0.3)' : '0 1px 6px rgba(99,102,241,0.12)') : 'none',
                                transition: 'all 0.18s',
                            }}>
                                {t === 'license' ? '📄 Лицензия' : '🔒 Конфиденциальность'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div style={{ overflowY: 'auto', flex: 1, padding: '4px 22px 24px' }}>
                    {/* Meta pill */}
                    <div style={{ fontSize: 11, color: subCol, marginBottom: 18, padding: '7px 12px', background: metaBg, borderRadius: 10, display: 'inline-block' }}>
                        {tab === 'license' ? 'Лицензионное соглашение' : 'Политика конфиденциальности'} · Aurora Messenger · beta · © 2026 kayano
                    </div>

                    {tab === 'license' ? (
                        <>
                            <Section title="1. Предмет соглашения">
                                Настоящее Лицензионное соглашение регулирует использование программного обеспечения Aurora Messenger («Приложение»). Используя Приложение, вы принимаете условия данного соглашения.
                            </Section>
                            <Section title="2. Лицензия">
                                Приложение распространяется по лицензии MIT. Исходный код доступен на{' '}
                                <a href="https://github.com/kayanoooo/aurora" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>GitHub</a>.
                                {' '}Разрешается свободно использовать, копировать, изменять и распространять Приложение при условии сохранения данного уведомления об авторских правах.
                            </Section>
                            <Section title="3. Ограничение ответственности">
                                Приложение предоставляется «как есть» без каких-либо гарантий. Авторы не несут ответственности за любой ущерб, возникший в результате использования Приложения.
                            </Section>
                            <Section title="4. Запрещённое использование">
                                Запрещается использовать Приложение для рассылки спама, распространения незаконного контента, нарушения прав третьих лиц, а также попыток несанкционированного доступа к серверам.
                            </Section>
                            <Section title="5. Изменения">
                                Авторы вправе изменять условия соглашения. Актуальная версия всегда доступна в Приложении.
                            </Section>
                            <div style={{ fontSize: 11, color: subCol, marginTop: 12, padding: '6px 10px', background: metaBg, borderRadius: 8, display: 'inline-block' }}>Последнее обновление: апрель 2026</div>
                        </>
                    ) : (
                        <>
                            <Section title="1. Какие данные мы собираем">
                                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <li>Email-адрес — для регистрации и входа</li>
                                    <li>Отображаемое имя и уникальный @тег</li>
                                    <li>Аватар и статус (если заданы)</li>
                                    <li>Сообщения и прикреплённые файлы</li>
                                    <li>Метаданные: время отправки, статус прочтения</li>
                                </ul>
                            </Section>
                            <Section title="2. Как мы используем данные">
                                Данные используются исключительно для функционирования мессенджера: обмена сообщениями, поиска пользователей и каналов, отображения уведомлений.
                            </Section>
                            <Section title="3. Хранение данных">
                                Сообщения и файлы хранятся на сервере. Пароли хранятся в хешированном виде и не могут быть восстановлены.
                            </Section>
                            <Section title="4. Шифрование">
                                Личные сообщения могут быть защищены сквозным шифрованием (E2E). В таком случае сервер хранит только зашифрованные данные, недоступные для прочтения без ключа.
                            </Section>
                            <Section title="5. Передача данных третьим лицам">
                                Мы не продаём и не передаём персональные данные третьим лицам. Исключение: требования законодательства.
                            </Section>
                            <Section title="6. Удаление данных">
                                Вы можете удалить свой аккаунт и все связанные данные в разделе Настройки → Конфиденциальность.
                            </Section>
                            <Section title="7. Контакт">
                                По вопросам конфиденциальности: <a href="mailto:bender.rodrigez2016@gmail.com" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>bender.rodrigez2016@gmail.com</a>
                            </Section>
                            <div style={{ fontSize: 11, color: subCol, marginTop: 12, padding: '6px 10px', background: metaBg, borderRadius: 8, display: 'inline-block' }}>Последнее обновление: апрель 2026</div>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default PolicyModal;
