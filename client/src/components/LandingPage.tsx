import React, { useState } from 'react';
import PolicyModal from './PolicyModal';

interface LandingPageProps {
    onOpenAuth: () => void;
}

const features = [
    {
        label: '01',
        title: 'Мгновенные диалоги',
        text: 'Личные сообщения, группы, реакции и файлы открываются без лишних переходов.',
    },
    {
        label: '02',
        title: 'Каналы и сообщества',
        text: 'Собирайте аудиторию, зовите людей в группы и держите важные темы отдельно.',
    },
    {
        label: '03',
        title: 'Медиа без суеты',
        text: 'Фото, документы, музыка и вложения аккуратно живут рядом с перепиской.',
    },
    {
        label: '04',
        title: 'Звонки и присутствие',
        text: 'Статусы, профили и звонки помогают понять, кто сейчас на связи.',
    },
    {
        label: '05',
        title: 'Темы и персонализация',
        text: 'Настраивайте внешний вид, аватары и привычный режим работы приложения.',
    },
    {
        label: '06',
        title: 'Готово к установке',
        text: 'Aurora можно открыть в браузере и установить как PWA на рабочий стол.',
    },
];

const platforms = [
    {
        name: 'Android',
        detail: 'APK для телефона',
        href: '/downloads/Aurora-Android.apk',
        fileName: 'Aurora-Android.apk',
        icon: '📱',
        color: '#34a853',
    },
    {
        name: 'Desktop',
        detail: 'Linux · AppImage',
        href: '/downloads/Aurora-Linux.AppImage',
        fileName: 'Aurora-Linux.AppImage',
        icon: '🐧',
        color: '#fbbc04',
    },
    {
        name: 'Desktop',
        detail: 'Windows · exe',
        href: '/downloads/Aurora-Windows.exe',
        fileName: 'Aurora-Windows.exe',
        icon: '🪟',
        color: '#4285f4',
    },
    {
        name: 'Web',
        detail: 'PWA · установить в браузере',
        href: '#',
        fileName: '',
        icon: '🌐',
        color: '#6366f1',
        isPwa: true as const,
    },
];

const timeline = [
    'Письмо с кодом',
    'Настройка профиля',
    'Первые чаты',
    'Группы и каналы',
];

const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
    const [policyTab, setPolicyTab] = useState<'license' | 'privacy' | null>(null);

    return (
        <main className="landing-page">
            <header className="landing-nav">
                <a className="landing-brand" href="#top" aria-label="Aurora">
                    <img src="/logo192.png" alt="" />
                    <span>Aurora</span>
                </a>
                <nav className="landing-links" aria-label="Навигация">
                    <a href="#features">Возможности</a>
                    <a href="#downloads">Скачать</a>
                    <a href="#security">Безопасность</a>
                </nav>
                <button className="landing-nav-button" onClick={onOpenAuth}>Войти</button>
            </header>

            <section className="landing-hero" id="top">
                <div className="landing-hero-copy">
                    <div className="landing-kicker">
                        <span />
                        Мессенджер нового поколения
                    </div>
                    <h1>Теплое место для быстрых разговоров</h1>
                    <p>
                        Aurora объединяет личные сообщения, группы, каналы, звонки, медиа и PWA-установку
                        в одном живом интерфейсе для браузера и мобильных устройств.
                    </p>
                    <div className="landing-actions">
                        <button className="landing-primary" onClick={onOpenAuth}>Начать общение</button>
                        <a className="landing-secondary" href="#downloads">Смотреть версии</a>
                    </div>
                    <div className="landing-stats" aria-label="Преимущества">
                        <span><strong>Real-time</strong> сообщения</span>
                        <span><strong>PWA</strong> установка</span>
                        <span><strong>Media</strong> галереи</span>
                    </div>
                </div>

                <div className="landing-phone-stage" aria-label="Интерфейс Aurora">
                    <div className="landing-orbit-card top">
                        <strong>24</strong>
                        <span>новых файла</span>
                    </div>
                    <div className="landing-phone">
                        <div className="phone-speaker" />
                        <div className="phone-topbar">
                            <div>
                                <span className="phone-title">Aurora</span>
                                <span className="phone-subtitle">12 участников онлайн</span>
                            </div>
                            <img className="phone-status" src="/logo192.png" alt="" />
                        </div>
                        <div className="phone-chat">
                            <div className="phone-day">Сегодня</div>
                            <div className="phone-message incoming">
                                <span>Готовим релиз? Я собрал макеты и файлы.</span>
                            </div>
                            <div className="phone-message outgoing">
                                <span>Да. В Aurora это выглядит как настоящий продукт.</span>
                            </div>
                            <div className="phone-media">
                                <div />
                                <div />
                                <div />
                            </div>
                            <div className="phone-message incoming short">
                                <span>Тогда запускаем.</span>
                            </div>
                        </div>
                        <div className="phone-input">
                            <span>Сообщение</span>
                            <button aria-label="Отправить">↗</button>
                        </div>
                    </div>
                    <div className="landing-orbit-card bottom">
                        <strong>online</strong>
                        <span>8 друзей рядом</span>
                    </div>
                </div>
            </section>

            <section className="landing-showcase" aria-label="Ключевые возможности">
                <div className="showcase-item">
                    <span>01</span>
                    <strong>Чаты</strong>
                    <p>Личные и групповые переписки с привычной логикой мессенджера.</p>
                </div>
                <div className="showcase-item">
                    <span>02</span>
                    <strong>Звонки</strong>
                    <p>Быстрая связь, когда текста уже мало.</p>
                </div>
                <div className="showcase-item">
                    <span>03</span>
                    <strong>Профили</strong>
                    <p>Аватары, статусы, теги и собственный стиль.</p>
                </div>
            </section>

            <section className="landing-section" id="features">
                <div className="landing-section-head">
                    <span>Возможности</span>
                    <h2>Больше, чем просто окно переписки</h2>
                    <p>Страница показывает Aurora как полноценный продукт: быстрый, понятный, визуально цельный и готовый к реальному использованию.</p>
                </div>
                <div className="landing-feature-grid">
                    {features.map(feature => (
                        <article className="landing-feature" key={feature.title}>
                            <span>{feature.label}</span>
                            <h3>{feature.title}</h3>
                            <p>{feature.text}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className="landing-flow">
                <div className="landing-flow-copy">
                    <span>Путь пользователя</span>
                    <h2>От регистрации до первого сообщества за пару минут</h2>
                    <p>Сценарий входа уже встроен: пользователь видит сайт, нажимает CTA и попадает в существующую авторизацию Aurora.</p>
                </div>
                <div className="landing-timeline">
                    {timeline.map((item, index) => (
                        <div className="timeline-row" key={item}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{item}</strong>
                        </div>
                    ))}
                </div>
            </section>

            <section className="landing-download-band" id="downloads">
                <div>
                    <span>Платформы</span>
                    <h2>Запускайте Aurora там, где удобно</h2>
                    <p>Откройте в браузере, установите как PWA или скачайте нативное приложение.</p>
                </div>
                <div className="landing-platforms">
                    {platforms.map((platform, idx) => {
                        if ('isPwa' in platform && platform.isPwa) {
                            return (
                                <button
                                    key={idx}
                                    onClick={onOpenAuth}
                                    className="landing-platform-card"
                                    style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
                                >
                                    <span className="platform-icon">{platform.icon}</span>
                                    <strong>{platform.name}</strong>
                                    <span>{platform.detail}</span>
                                </button>
                            );
                        }
                        return (
                            <a
                                key={idx}
                                href={platform.href}
                                download={platform.fileName}
                                className="landing-platform-card"
                            >
                                <span className="platform-icon">{platform.icon}</span>
                                <strong>{platform.name}</strong>
                                <span>{platform.detail}</span>
                            </a>
                        );
                    })}
                </div>
            </section>

            <section className="landing-security" id="security">
                <div className="landing-security-copy">
                    <span>Основа продукта</span>
                    <h2>Сайт не просто красивый, он ведет прямо в приложение</h2>
                    <p>
                        Авторизация, профили, группы, медиа, уведомления и серверные настройки уже рядом.
                        Страница ведет пользователя прямо в существующее приложение Aurora.
                    </p>
                </div>
                <div className="landing-security-panel">
                    <div><strong>API</strong><span>готово</span></div>
                    <div><strong>WebSocket</strong><span>live</span></div>
                    <div><strong>PWA</strong><span>install</span></div>
                    <button className="landing-primary" onClick={onOpenAuth}>Перейти к Aurora</button>
                </div>
            </section>

            <footer className="landing-footer">
                <div className="landing-footer-main">
                    <span>© Aurora, 2026</span>
                    <span>Обратная связь: <a href="mailto:bender.rodrigez2016@gmail.com">Техподдержка</a></span>
                    <button type="button" onClick={() => setPolicyTab('privacy')}>Политика конфиденциальности</button>
                    <button type="button" onClick={() => setPolicyTab('license')}>Лицензия</button>
                </div>
                <div className="landing-footer-meta">
                    <span>Мессенджер для Web, Android, Linux и Windows.</span>
                    <span>Файлы хранятся в Cloudinary, приложение подключается к Railway-хосту.</span>
                </div>
            </footer>

            {policyTab && (
                <PolicyModal
                    initialTab={policyTab}
                    isDark={false}
                    onClose={() => setPolicyTab(null)}
                />
            )}
        </main>
    );
};

export default LandingPage;
