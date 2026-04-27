import React, { useState } from 'react';
import PolicyModal from './PolicyModal';

interface HelpModalProps {
    isDark?: boolean;
    initialTab?: 'features' | 'patchnotes' | 'authors';
    onClose: () => void;
}

const FEATURES = [
    { icon: '💬', title: 'Личные чаты', desc: 'Переписка один на один с любым пользователем' },
    { icon: '👥', title: 'Групповые чаты', desc: 'Создавайте группы и общайтесь с несколькими людьми одновременно' },
    { icon: '🎵', title: 'Медиаплеер', desc: 'Слушайте аудио и смотрите видео прямо в чате' },
    { icon: '📁', title: 'Папки', desc: 'Организуйте чаты по папкам для удобства' },
    { icon: '🎤', title: 'Голосовые сообщения', desc: 'Отправляйте голосовые записи' },
    { icon: '📎', title: 'Файлы и медиа', desc: 'Прикрепляйте фото, видео и любые файлы' },
    { icon: '😊', title: 'Реакции', desc: 'Ставьте реакции на сообщения' },
    { icon: '↩️', title: 'Ответы', desc: 'Отвечайте на конкретные сообщения' },
    { icon: '↪️', title: 'Пересылка', desc: 'Пересылайте сообщения в другие чаты' },
    { icon: '✏️', title: 'Редактирование', desc: 'Редактируйте отправленные сообщения' },
    { icon: '🔍', title: 'Поиск', desc: 'Быстрый поиск по сообщениям' },
    { icon: '🌙', title: 'Тёмная тема', desc: 'Комфортный тёмный режим для глаз' },
    { icon: '✓✓', title: 'Статус прочтения', desc: 'Видите, когда собеседник прочитал ваше сообщение' },
    { icon: '🟢', title: 'Онлайн статус', desc: 'Смотрите, кто сейчас в сети' },
    { icon: '🔔', title: 'Уведомления', desc: 'Мгновенные уведомления о новых сообщениях' },
    { icon: '⭐', title: 'Избранные', desc: 'Сохраняйте важные сообщения в избранных' },
];

const PATCHNOTES = [
    {
        version: 'beta v0.6',
        notes: [
            '🎭 Новый пикер: эмодзи с категориями, стикеры с паками, GIF — открывается вместо контекстного меню',
            '📊 Создание опросов: вопрос, варианты, анонимный режим, множественный выбор',
            '🌍 Поддержка двух языков: русский и английский',
            '🔒 Конфиденциальность: блокировка/разблокировка, скрытие аватара/статуса, удаление аккаунта',
            '🗂️ Архив чатов',
            '🌑 Три пресета тем: светлая, тёмная и чёрная OLED',
            '🔐 E2E-шифрование сообщений: общий ключ из ECDH, сообщения заворачиваются в [AURORA_ENC]',
            '⏰ Запланированные сообщения на конкретную дату и время',
            '@ Упоминания участников в группах с автодополнением',
            '🖼️ Аватарки собеседников рядом с сообщениями в личных чатах',
            '🖼️ Галерея от 1 до 9+ фото в одном пузыре с уникальной CSS-сеткой',
            '😊 Одиночный эмодзи показывается крупно без пузыря',
            '✓✓ Двойная галочка в сайдбаре показывает прочтение',
            '💬 Встроенный чат поддержки для пользователей',
            '🛡️ Панель администратора: статистика, пользователи, саппорт',
            '✂️ Кроп аватарки перед загрузкой',
            '📱 Мобильный интерфейс',
            '👁️ Счётчик просмотров под постами в каналах',
        ]
    },
    {
        version: 'beta v0.5',
        notes: [
            '📧 Вход и регистрация только через email и пароль, ник и @тег задаются отдельно после регистрации',
            '🏷️ Уникальный @тег аккаунта, отдельный от ника — тег постоянный, ник можно менять',
            '📢 Создание каналов: название, описание, тип (публичный/частный), @тег',
            '🔍 Поиск каналов и пользователей по тегу в сайдбаре одновременно',
            '👁️ Предпросмотр канала без подписки; кнопка «Подписаться»',
            '👑 Администраторы могут выдавать/забирать права у участников',
            '☑️ Выделение нескольких сообщений, удаление и пересылка',
            '📌 Закрепление сообщения через контекстное меню; отображается в верхней части чата',
            '🔗 URL в сообщениях автоматически становятся кликабельными',
            '⌨️ Enter — отправить, Shift+Enter — перенос строки; инпут растягивается до 6 строк',
            '🔔 Нативные уведомления браузера при сворачивании вкладки',
            '🔕 Мьют конкретного чата через ПКМ в сайдбаре',
            '👥 Последнее сообщение и имя отправителя под именем чата в сайдбаре',
            '🔄 Статус онлайн обновляется автоматически при переключении вкладки',
            '🌐 Новый хост: aurora-messenger.vercel.app; файлы на Cloudinary',
        ]
    },
    {
        version: 'beta v0.4',
        notes: [
            '🔧 Исправлена некорректная работа прогресс-бара аудиофайла в чате',
            '🎵 Исправлена перемотка аудиофайла в плеере',
            '📸 Медиапанель в профиле теперь доступна и при входе через группу',
            '👥 В группах добавлена медиапанель с просмотром всех файлов',
            '✨ Анимация удаления сообщения',
            '🙈 Кнопка скрытия медиапанели',
            '🗂️ Модал настроек папок с блюром и глоссом',
            '🗑️ Подтверждения удаления перенесены в отдельный модал по центру экрана',
            '⚠️ При удалении папки теперь отображается предупреждение',
            '🔍 В поиске теперь показывается 3 недавних юзера (вместо 15), добавлена история поиска (до 5)',
            '📋 Все патчноуты теперь доступны во вкладке "Обновления" в справке',
        ]
    },
    {
        version: 'beta v0.3',
        notes: [
            '🎤 Голосовые сообщения: кнопка записи, таймер, кнопка стоп, отправка в формате webm',
            '🎙️ Проверка доступности микрофона и запрос на разрешение',
            '🟢 Показ онлайн-статуса и времени последнего визита везде (сайдбар, хедер, профиль, группа)',
            '🙈 Возможность скрыть статус — будет отображаться "был(а) недавно"',
            '🎵 Фоновый аудиоплеер: музыка не останавливается при смене чата, мини-плеер под хедером',
            '🔔 В уведомлениях: кнопки "Ответить" и "Пометить как прочитанное"',
            '🎨 Ребрендинг: новый логотип (оранжевый/фиолетовый/вишнёвый под тему), название "Aurora" с градиентом',
            '🔐 Обновлена страница входа',
            '👤 Текстовый статус только в профиле',
            '👁️ В профиле — "в сети" или время последнего визита',
            '👥 В инфо о группе — роль + онлайн/время у каждого участника',
            '🖼️ Иконка группы в хедере теперь кликабельна — открывает инфо о группе',
            '✓✓ Статус прочтения в сообщениях ("прочитано" если хоть один участник прочитал)',
            '🚪 Возможность выйти из группы',
            '📂 Медиапанель перенесена в профиль: аудио, видео, файлы, изображения',
            '📁 Папки с чатами: создание (больше 10!), удаление, 8 цветов, скроллбар',
            '📌 Сайдбар: чаты поднимаются при новом сообщении, индикатор набора, закрепление чатов, кнопка скрытия',
            '↩️ В ответе на сообщение — клик по цитате ведёт к оригиналу',
            '🎬 Видео можно играть в фоне с переходом в мини-режим',
            '🖼️ Нажатие на аватар открывает его на весь экран',
            '📋 Вставка скриншота через Ctrl+V',
            '😊 Реакции на сообщения',
            '↪️ Пересылка сообщений с превью и именем отправителя',
            '📝 Текст можно отправить отдельно от файла; файл автоматически отправляется после загрузки',
            '🔍 Ревок поиска: поле в сайдбаре, недавние пользователи, история, поиск по префиксу с дебаунсом 300мс',
            '🌐 При авторизации сервер возвращает нормальные ошибки: "пользователь не найден", "неверный пароль" и т.д.',
            '❓ Новый компонент "Справка" с возможностями мессенджера и патчноутами',
            '❌ Исправлены баги: "сообщение удалено" при ответе на файл, реакции, статус "в сети" при выходе, прокрут вниз, лимит 50 сообщений, перенос длинных сообщений, загрузка отменённого файла',
        ]
    },
    {
        version: 'beta v0.2',
        notes: [
            '🔔 Система уведомлений: десктоп-окошко с панели задач, уведомления во вкладке браузера',
            '↩️ Ответ на сообщение прямо из уведомления',
            '🔴 Значок и счётчик непрочитанных (до 99, далее 99+)',
            '🎨 Исправлено отображение сообщений с персонализацией собеседника',
            '🌐 URL-адреса стали относительными — проект работает на любом сервере (ngrok и т.п.)',
            '⬇️ Исправлен баг: файлы больше не открываются в новой вкладке при скачивании',
            '⏳ Индикатор загрузки файла при отправке',
        ]
    },
    {
        version: 'beta v0.1',
        notes: [
            '🎨 Обновлён бар с чатами: аватарка объединена с ником и статусом, новое выделение активного чата',
            '💬 Обновлена область чата: рекомпоновка сообщений с файлами, аватарка со статусом рядом с ником, элементы смещены влево',
            '👥 Обновлено окно инфо о группе: ник и роль перенесены к аватарке',
            '⚙️ Обновлены настройки аккаунта: рекомпоновка в кастомизации чата',
            '✨ Анимации открытия/закрытия всех модальных окон с глоссом и блюром',
            '✏️ Отдельная кнопка редактирования аватарки в группе',
            '📧 Почту теперь можно скрыть в профиле',
            '👁️ Предпросмотр фото и видео перед скачиванием',
            '🎵 Встроенный медиаплеер в чате',
            '📁 Drag-and-drop файлов в чат',
            '👥 Системные сообщения при добавлении/удалении участников группы',
            '🖼️ Авто-обновление аватарок в групповом чате',
            '🔒 Сессия не сбрасывается после перезагрузки страницы',
            '🖼️ PNG-аватарки отображаются без лишнего фонового цвета',
            '📎 Текст и файлы отправляются в одном сообщении; множественный выбор файлов; файлы накапливаются над полем ввода',
        ]
    },
    {
        version: 'alpha v0.2',
        notes: [
            '🔧 Исправлены баги отображения кнопок в тёмной теме',
            '👤 Нажатие на аватарку в лч/группах открывает профиль пользователя',
            '🌐 Проект адаптируется к любому IP-адресу и компьютеру автоматически',
        ]
    },
    {
        version: 'alpha v0.1',
        notes: [
            '🔧 Переписан вебсокет: устранены баги при регистрации нового юзера (чужие сообщения, удаляющийся чат)',
            '🌙 Тёмная тема: все элементы адаптированы под тёмный и светлый режим',
            '👤 Полный ревок аккаунтов: ник, аватарка, день рождения, телефон, статус',
            '⚙️ Полноценные настройки аккаунта: персонализация, кастомизация чатов, приватность, выход',
            '😊 Отдельная кнопка выбора эмодзи',
            '📜 История чатов расширена до 10 000 сообщений',
            '📦 Лимит файла увеличен до 1 ГБ',
            '⭐ Избранные сообщения (своя личка)',
            '👥 Группы: удаление, редактирование названия, удаление участников',
            '🔍 Новый чат теперь начинается через поиск по нику — существующие юзеры не показываются автоматически',
            '👤 Нажатие на ник в лч открывает профиль собеседника',
            '🗑️ Любое удаление требует подтверждения',
            '📅 Сообщения в чате разделяются по дате',
            '🎨 Можно установить свой цвет аватарки вместо фото',
            '⚡ Все действия авто-обновляются в реальном времени',
        ]
    },
    {
        version: 'indev v0.3',
        notes: [
            '🔧 Переписан вебсокет: нет лишних переподключений, сообщения не теряются',
            '👥 Добавлены групповые чаты',
            '✏️ Редактирование и удаление сообщений',
            '↩️ Выбор сообщения для ответа',
            '🔍 Поиск сообщений в текущем чате и во всех чатах',
            '🗑️ Убраны отложенные сообщения',
        ]
    },
    {
        version: 'indev v0.2',
        notes: [
            '📎 Отправка и скачивание файлов: txt, pdf, doc/docx, zip, jpg/png и другие форматы изображений',
            '📦 Максимальный размер файла — 10 МБ',
        ]
    },
    {
        version: 'indev v0.1',
        notes: [
            '🗄️ База данных: таблицы users и messages',
            '🔐 Авторизация и шифрование паролей через cryptography',
            '📬 Очередь для недоставленных сообщений (оффлайн-режим)',
            '🔌 Вебсокет для работы в реальном времени',
            '🏗️ Структура проекта: отдельные серверная и клиентская части',
            '🎨 Базовый дизайн авторизации и интерфейса',
        ]
    },
];

const AUTHORS = {
    developers: [
        { tag: 'kayano', role: 'Lead developer' },
        { tag: 'durov', role: 'Developer' },
    ],
    testers: [
        { tag: 'even', role: 'Tester' },
        { tag: 'revesore', role: 'Tester' },
        { tag: 'kokoko', role: 'Tester' },
    ],
};

const HelpModal: React.FC<HelpModalProps> = ({ isDark = false, initialTab = 'features', onClose }) => {
    const dm = isDark;
    const [tab, setTab] = useState<'features' | 'patchnotes' | 'authors'>(initialTab);
    const [closing, setClosing] = useState(false);
    const [policyTab, setPolicyTab] = useState<'license' | 'privacy' | null>(null);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = isOled ? '#000000' : (dm ? '#1a1a2e' : '#ffffff');
    const cardBg = isOled ? '#050508' : (dm ? '#12122a' : '#f8f7ff');
    const border = isOled ? 'rgba(167,139,250,0.2)' : (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe');
    const cardBorder = isOled ? 'rgba(167,139,250,0.12)' : (dm ? 'rgba(99,102,241,0.15)' : '#ede9fe');
    const tabBarBg = isOled ? '#050508' : (dm ? '#12122a' : '#f3f4f6');
    const tabActiveBg = isOled ? '#0a0a14' : (dm ? '#1e1e3a' : 'white');
    const shadow = dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)';

    return (
        <>
        <div
            style={{ position: 'fixed', inset: 0, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ backgroundColor: bg, borderRadius: 20, width: 440, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: shadow, position: 'relative' }}
                className={closing ? 'modal-exit' : 'modal-enter'}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
                    <button onClick={close} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af' }}>✕</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <span style={{ fontSize: 28 }}>🌅</span>
                        <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: dm ? '#e0c4ff' : '#4f46e5' }}>Aurora</div>
                            <div style={{ fontSize: 12, color: dm ? '#6060aa' : '#9ca3af' }}>Мессенджер нового поколения</div>
                        </div>
                    </div>
                    {/* Tabs */}
                    <div style={{ display: 'flex', backgroundColor: tabBarBg, borderRadius: 10, padding: 3, gap: 3 }}>
                        <button onClick={() => setTab('features')} style={{ flex: 1, padding: '7px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === 'features' ? tabActiveBg : 'none', color: tab === 'features' ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), boxShadow: tab === 'features' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.2s' }}>
                            ✨ Возможности
                        </button>
                        <button onClick={() => setTab('patchnotes')} style={{ flex: 1, padding: '7px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === 'patchnotes' ? tabActiveBg : 'none', color: tab === 'patchnotes' ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), boxShadow: tab === 'patchnotes' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.2s' }}>
                            📋 Обновления
                        </button>
                        <button onClick={() => setTab('authors')} style={{ flex: 1, padding: '7px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === 'authors' ? tabActiveBg : 'none', color: tab === 'authors' ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), boxShadow: tab === 'authors' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.2s' }}>
                            👥 Авторы
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div style={{ overflowY: 'auto', flex: 1, padding: '16px 24px 20px' }}>
                    {tab === 'authors' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Policy buttons */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => setPolicyTab('license')} style={{ flex: 1, padding: '10px 14px', backgroundColor: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                                    Лицензия
                                </button>
                                <button onClick={() => setPolicyTab('privacy')} style={{ flex: 1, padding: '10px 14px', backgroundColor: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                    Конфиденциальность
                                </button>
                            </div>
                            <div style={{ backgroundColor: cardBg, borderRadius: 14, padding: '16px 18px', border: `1px solid ${cardBorder}` }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: dm ? '#7c7caa' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>🔧 Разработчики</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {AUTHORS.developers.map(a => (
                                        <div key={a.tag} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 16, flexShrink: 0 }}>
                                                {a.tag[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: 14, color: dm ? '#e0e0f0' : '#1e1b4b' }}>@{a.tag} <span style={{ fontSize: 12 }}>🔧</span></div>
                                                <div style={{ fontSize: 12, color: dm ? '#7c7caa' : '#9ca3af' }}>{a.role}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ backgroundColor: cardBg, borderRadius: 14, padding: '16px 18px', border: `1px solid ${cardBorder}` }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: dm ? '#7c7caa' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>🧪 Тестеры</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {AUTHORS.testers.map(a => (
                                        <div key={a.tag} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 16, flexShrink: 0 }}>
                                                {a.tag[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: 14, color: dm ? '#e0e0f0' : '#1e1b4b' }}>@{a.tag}</div>
                                                <div style={{ fontSize: 12, color: dm ? '#7c7caa' : '#9ca3af' }}>{a.role}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : tab === 'features' ? (
                        <div className="help-features-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {FEATURES.map(f => (
                                <div key={f.title} style={{ backgroundColor: cardBg, borderRadius: 12, padding: '10px 12px', border: `1px solid ${cardBorder}` }}>
                                    <div style={{ fontSize: 18, marginBottom: 4 }}>{f.icon}</div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: dm ? '#c0b4e8' : '#4f46e5', marginBottom: 2 }}>{f.title}</div>
                                    <div style={{ fontSize: 11, color: dm ? '#6868a0' : '#9ca3af', lineHeight: 1.4 }}>{f.desc}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {PATCHNOTES.map(p => (
                                <div key={p.version} style={{ backgroundColor: cardBg, borderRadius: 14, padding: '14px 16px', border: `1px solid ${cardBorder}` }}>
                                    <div style={{ marginBottom: 10 }}>
                                        <span style={{ fontSize: 15, fontWeight: 800, color: dm ? '#a5b4fc' : '#6366f1' }}>Версия {p.version}</span>
                                    </div>
                                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {p.notes.map((note, i) => (
                                            <li key={i} style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151', lineHeight: 1.4 }}>{note}</li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
        {policyTab && <PolicyModal initialTab={policyTab} isDark={dm} onClose={() => setPolicyTab(null)} />}
        </>
    );
};

export default HelpModal;
