import { useState, useEffect } from 'react';

export type Lang = 'ru' | 'en';

// Keys are English strings; values are Russian translations.
// t(key) returns key in English mode, Russian value in Russian mode.
const ru: Record<string, string> = {
    // Common
    'Save': 'Сохранить',
    'Cancel': 'Отмена',
    'Delete': 'Удалить',
    'Edit': 'Редактировать',
    'Create': 'Создать',
    'Close': 'Закрыть',
    'Back': 'Назад',
    'Search': 'Поиск',
    'Loading...': 'Загрузка...',
    'Creating...': 'Создание...',
    'Saving...': 'Сохранение...',
    'Sending...': 'Отправка...',
    'Inviting...': 'Приглашение...',
    'Error': 'Ошибка',
    'Success': 'Успешно',
    'Yes': 'Да',
    'No': 'Нет',
    'Online': 'в сети',
    'Offline': 'не в сети',
    'Add': 'Добавить',
    'Remove': 'Убрать',
    'Clear': 'Очистить',
    'Rename': 'Переименовать',
    'Name': 'Название',
    'Description': 'Описание',
    'Send': 'Отправить',
    'Copy': 'Копировать',
    'Download': 'Скачать',
    'Click outside or press Esc to close': 'Нажмите вне изображения или Esc чтобы закрыть',
    'Forward': 'Переслать',
    'Reply': 'Ответить',
    'Pin': 'Закрепить',
    'Unpin': 'Открепить',
    'Select': 'Выделить',
    'Confirm': 'Подтвердить',
    'Settings': 'Настройки',
    'Profile': 'Профиль',
    'Username': 'Имя пользователя',
    'Password': 'Пароль',
    'Tag': 'Тег',
    'Status': 'Статус / о себе',
    'Phone': 'Номер телефона',
    'Birthday': 'День рождения',
    'Email': 'Почта',
    'Language': 'Язык',
    'Favorites': 'Избранное',
    'Archive': 'Архив',
    'Log out': 'Выйти из аккаунта',
    'Apply': 'Применить',
    'Reset': 'Сброс',
    'Applied': 'Тема применена',
    'Light theme': 'Светлая тема',
    'Dark theme': 'Тёмная тема',
    'Compact mode': 'Компактный режим',
    'Hide panel': 'Скрыть панель',
    'Show panel': 'Показать панель',

    // Auth
    'Welcome back!': 'Добро пожаловать обратно!',
    'Create account': 'Создайте аккаунт',
    'Password recovery': 'Восстановление пароля',
    'Sign In': 'Вход',
    'Sign Up': 'Регистрация',
    'Tag (@your_tag)': 'Тег (@ваш_тег)',
    'Current password': 'Текущий пароль',
    'New password': 'Новый пароль',
    '→ Sign In': '→ Войти',
    '✓ Sign Up': '✓ Зарегистрироваться',
    '🔑 Reset password': '🔑 Сбросить пароль',
    'Forgot password?': 'Забыли пароль?',
    '← Back to sign in': '← Назад ко входу',
    'Invalid username or password': 'Неверный email или пароль',
    'Registration error': 'Ошибка регистрации',
    'Password changed! Sign in with new password.': 'Пароль успешно изменён! Войдите с новым паролем.',
    'User not found': 'Пользователь не найден',
    'Server unavailable. Check connection.': 'Сервер недоступен. Проверьте подключение.',
    'An error occurred': 'Произошла ошибка',

    // Sidebar
    'Search users...': 'Поиск пользователей...',
    'History': 'История',
    'New users': 'Новые пользователи',
    'Channels': 'Каналы',
    'Users': 'Пользователи',
    'Voice message': 'Голосовое сообщение',
    'GIF': 'GIF',
    'Sticker': 'Стикер',
    'Photo': 'Фото',
    'Video': 'Видео',
    'File': 'Файл',

    // Chat area
    'Select a chat': 'Выберите чат',
    'Type a message...': 'Введите сообщение...',
    'Write a post...': 'Написать пост...',
    'saved messages': 'сохранённые сообщения',
    'private chat': 'личный чат',
    'last seen recently': 'был(а) недавно',
    'last seen': 'был(а)',
    'edited': 'изм.',
    'is typing...': 'печатает...',
    'Search in chat...': 'Поиск в чате...',
    'No results': '0 результатов',
    'You': 'Вы',
    'Pinned message': 'Закреплённое',
    'Show message': 'Показать сообщение',
    'Forward to...': 'Переслать в...',
    'Forwarded from': 'Переслано от',

    // Context menu
    'Copy text': 'Копировать текст',
    'Select message': 'Выделить сообщение',
    'Save GIF': 'Сохранить GIF',
    'Remove saved GIF': 'Убрать из сохранённых',
    'Pin message': 'Закрепить сообщение',
    'Unpin message': 'Открепить сообщение',
    'Delete message': 'Удалить сообщение',
    'Edit message': 'Редактировать',

    // Bulk actions
    'selected': 'выделено',
    'Delete for everyone': 'Удалить для всех',
    'Delete for me': 'Удалить только у меня',
    'Delete messages?': 'Удалить сообщения?',
    'This cannot be undone.': 'Это действие необратимо.',

    // Toasts
    'File limit': 'Лимит файлов',
    'Max 10 files allowed': 'Можно выбрать не более 10 файлов',
    'File too large (max 1GB)': 'Файл больше 1 ГБ',

    // Settings main
    'Account': 'Аккаунт',
    'Name, tag, photo, about': 'Имя, тег, фото, о себе',
    'Privacy': 'Конфиденциальность',
    'What others see': 'Что видят другие пользователи в вашем профиле',
    'Appearance': 'Внешний вид',
    'Chat settings': 'Настройки чата',
    'Themes, wallpapers, animations': 'Темы, обои, анимации',
    'Emoji & stickers': 'Эмодзи и стикеры',
    'Quick reactions, packs': 'Быстрые реакции, наборы',
    'Night mode': 'Ночной режим',
    'About': 'О программе',
    'Chats': 'Чаты',
    'Chat folders': 'Папки чатов',
    'Manage folders': 'Управление папками',

    // Profile sub-modal
    'Avatar color': 'Цвет аватара',
    'About yourself': 'О себе',
    'Enter name': 'Введите имя',
    'your_tag': 'ваш_тег',
    'Change photo': 'Изменить фото',
    'Remove photo': 'Удалить',
    'Avatar removed': '✓ Аватарка удалена',
    'Upload error': 'Ошибка загрузки фото',
    'Changes saved': '✓ Сохранено',
    'Connection error': 'Ошибка соединения',
    'developer of Aurora': 'разработчик Aurora',

    // Privacy sub-modal
    'Last seen': 'Последний визит',

    // Chat appearance sub-modal
    'Theme': 'Тема оформления',
    'Animations': 'Анимации',
    'Interface animations': 'Анимации интерфейса',
    'Font size': 'Размер шрифта',
    'Own bubble color': 'Мои сообщения',
    'Other bubble color': 'Чужие сообщения',
    'Chat background': 'Обои чата',
    'Default': 'Стандарт',
    'Dark': 'Тёмный',
    'Midnight': 'Полночь',
    'Forest': 'Лес',
    'Sunset': 'Закат',
    'Clean': 'Чистый',
    'Ocean': 'Океан',

    // Emoji & stickers sub-modal
    'Quick reactions': 'Быстрые реакции',
    'First emoji is set by double-clicking a message': 'Первый эмодзи ставится по двойному клику на сообщение',
    'Click emoji to replace · first one set by double-click': 'Нажмите на эмодзи чтобы заменить · первый ставится по двойному клику',
    'Primary reaction': 'Главная реакция',
    'Set by double-clicking a message': 'Ставится по двойному клику на сообщение',
    'My sticker packs': 'Мои наборы стикеров',
    'Rename pack': 'Переименовать набор',
    'No packs yet': 'У вас пока нет наборов стикеров',
    'Add sticker': 'Добавить стикер',
    'New pack': 'Новый набор',
    'Pack name': 'Название набора',
    'Create pack': 'Создать набор стикеров',
    'Add first sticker →': 'Добавь первый стикер →',
    'stickers': 'стикер(ов)',

    // Language sub-modal
    'Choose interface language. Full translation coming in next update.': 'Выберите язык интерфейса. Полный перевод будет в следующем обновлении.',

    // Groups
    'Create group': 'Создать группу',
    'Group name': 'Название группы',
    'Description (optional)': 'Описание (необязательно)',
    'Create channel': 'Создать канал',
    '📢 Create channel': '📢 Создать канал',
    'Click to add photo': 'Нажмите чтобы добавить фото',
    'Channel name': 'Название канала',
    'Enter name...': 'Введите название',
    'What is this channel about?': 'О чём этот канал?',
    'Channel type': 'Тип канала',
    '🌐 Public': '🌐 Публичный',
    '🔒 Private': '🔒 Частный',
    'Anyone can find and join by tag': 'Любой может найти и вступить по тегу',
    'Join by invite only': 'Вступить можно только по приглашению',
    'Public tag': 'Публичный тег',
    'Letters, numbers and _ only': 'Только буквы, цифры и _',
    'File too large (max 5MB)': 'Файл больше 5MB',
    'Save error': 'Ошибка сохранения',
    'Join': 'Вступить',
    'Subscribe': 'Подписаться',
    'Unsubscribe': 'Отписаться',
    'Leave group': 'Покинуть группу',
    'Delete group': 'Удалить группу',
    'added to group': 'добавлен в группу',

    // Invite modal
    'Invite to group': 'Пригласить в группу',
    'Group:': 'Группа:',
    '@user_tag': '@тег пользователя',
    'User is already in group': 'Пользователь уже в группе',
    'Could not invite': 'Не удалось пригласить',
    'Network error': 'Ошибка сети',
    'Invite': 'Пригласить',

    // Search modal
    'Search messages': 'Поиск сообщений',
    'Enter text to search...': 'Введите текст для поиска...',
    'In current chat': 'В текущем чате',
    'In all chats': 'Во всех чатах',
    'Searching...': 'Поиск...',
    '🔍 Find': '🔍 Найти',
    'No results found': 'Ничего не найдено',

    // User profile modal
    'Audio': 'Аудио',
    'Start chat': 'Написать',
    'Official Aurora channel': 'Официальный канал Aurora',
    'Media': 'Медиа',
    'Files': 'Файлы',
    'Links': 'Ссылки',
    'No media': 'Нет медиа',
    'No files': 'Нет файлов',
    'No links': 'Нет ссылок',

    // GIF
    'Search GIF...': 'Поиск GIF...',
    '🔥 Trending': '🔥 Популярные',
    '🔖 Saved': '🔖 Сохранённые',
    'No saved GIFs': 'Нет сохранённых GIF',

    // MediaPicker
    'Emoji': 'Эмодзи',
    'Stickers': 'Стикеры',
    'Recent': 'Недавние',
    'No recent stickers': 'Нет недавних',
    'Send a sticker, it will appear here': 'Отправь стикер, и он появится здесь',
    'No packs': 'Нет наборов',
    'Press + to create a sticker pack': 'Нажми + чтобы создать набор стикеров',
    'Search emoji...': 'Поиск...',
    '+ photo': '+ фото',
    'Add pack (N)': 'Добавить набор',
    'Pack added ✓': '✓ Набор добавлен',

    // Drag & drop
    'Drop files to send': 'Отпустите файлы для отправки',

    // Folders
    'New folder': 'Новая папка',
    'Folder name': 'Название папки',
    'Add chats': 'Добавить чаты',
    'No folders': 'Нет папок',
};

export function getLang(): Lang {
    return (localStorage.getItem('aurora_lang') as Lang) || 'ru';
}

export function setLang(lang: Lang) {
    localStorage.setItem('aurora_lang', lang);
    window.dispatchEvent(new Event('aurora_lang_change'));
}

/** Translate a string. Pass English as key; returns Russian when lang=ru. */
export function t(key: string, lang?: Lang): string {
    const l = lang ?? getLang();
    if (l === 'en') return key;
    return ru[key] ?? key;
}

/** React hook — reactive to language changes. */
export function useLang() {
    const [lang, setLangState] = useState<Lang>(getLang);

    useEffect(() => {
        const handler = () => setLangState(getLang());
        window.addEventListener('aurora_lang_change', handler);
        return () => window.removeEventListener('aurora_lang_change', handler);
    }, []);

    return {
        lang,
        t: (key: string) => t(key, lang),
    };
}
