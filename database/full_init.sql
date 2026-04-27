-- =====================================================
-- Полный скрипт создания базы данных с нуля
-- Включает все миграции
-- =====================================================

CREATE DATABASE IF NOT EXISTS messenger
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE messenger;

-- =====================================================
-- Таблица пользователей
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar        VARCHAR(255) NULL,
    status        VARCHAR(150) NULL DEFAULT '',
    avatar_color  VARCHAR(7)   NOT NULL DEFAULT '#1a73e8',
    birthday      DATE         NULL,
    phone         VARCHAR(30)  NULL,
    privacy_settings VARCHAR(500) DEFAULT '{"show_birthday":true,"show_phone":true,"show_tags":true,"show_status":true,"show_last_seen":true}',
    last_seen     TIMESTAMP    NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email    (email)
);

-- =====================================================
-- Таблица тегов пользователей
-- =====================================================
CREATE TABLE IF NOT EXISTS user_tags (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    tag        VARCHAR(50)  NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE INDEX idx_user_tags_tag  (tag),
    INDEX       idx_user_tags_user  (user_id)
);

-- =====================================================
-- Таблица личных сообщений
-- =====================================================
CREATE TABLE IF NOT EXISTS messages (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    sender_id        INT          NOT NULL,
    receiver_id      INT          NOT NULL,
    message_text     TEXT,
    file_path        VARCHAR(255) NULL,
    filename         VARCHAR(255) NULL,
    file_size        INT          NULL,
    timestamp        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    delivered        BOOLEAN      DEFAULT FALSE,
    is_read          TINYINT(1)   NOT NULL DEFAULT 0,
    chat_type        ENUM('private', 'group') DEFAULT 'private',
    reply_to_id      INT          NULL,
    reply_to_text    TEXT         NULL,
    reply_to_sender  VARCHAR(50)  NULL,
    edited_at        TIMESTAMP    NULL,
    is_deleted       BOOLEAN      DEFAULT FALSE,
    files            TEXT         NULL,
    FOREIGN KEY (sender_id)   REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL,
    INDEX idx_sender      (sender_id),
    INDEX idx_receiver    (receiver_id),
    INDEX idx_timestamp   (timestamp),
    INDEX idx_conversation (sender_id, receiver_id, timestamp)
);

-- =====================================================
-- Таблица групп
-- =====================================================
CREATE TABLE IF NOT EXISTS `groups` (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    creator_id  INT          NOT NULL,
    avatar      VARCHAR(255) NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_creator (creator_id)
);

-- =====================================================
-- Таблица участников групп
-- =====================================================
CREATE TABLE IF NOT EXISTS group_members (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT  NOT NULL,
    user_id  INT  NOT NULL,
    role     ENUM('admin', 'member') DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)    ON DELETE CASCADE,
    UNIQUE KEY unique_member (group_id, user_id),
    INDEX idx_group (group_id),
    INDEX idx_user  (user_id)
);

-- =====================================================
-- Таблица групповых сообщений
-- =====================================================
CREATE TABLE IF NOT EXISTS group_messages (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    group_id            INT          NOT NULL,
    sender_id           INT          NULL,
    message_text        TEXT,
    file_path           VARCHAR(255) NULL,
    filename            VARCHAR(255) NULL,
    file_size           INT          NULL,
    timestamp           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    reply_to_id         INT          NULL,
    reply_to_text       TEXT         NULL,
    reply_to_sender     VARCHAR(50)  NULL,
    edited_at           TIMESTAMP    NULL,
    is_deleted          BOOLEAN      DEFAULT FALSE,
    is_system           TINYINT(1)   NOT NULL DEFAULT 0,
    files               TEXT         NULL,
    sender_avatar_color VARCHAR(7)   NULL,
    FOREIGN KEY (group_id)    REFERENCES `groups`(id)       ON DELETE CASCADE,
    FOREIGN KEY (sender_id)   REFERENCES users(id)          ON DELETE CASCADE,
    FOREIGN KEY (reply_to_id) REFERENCES group_messages(id) ON DELETE SET NULL,
    INDEX idx_group     (group_id),
    INDEX idx_timestamp (timestamp)
);

-- =====================================================
-- Таблица реакций на сообщения
-- =====================================================
CREATE TABLE IF NOT EXISTS message_reactions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT         NOT NULL,
    is_group   TINYINT(1)  NOT NULL DEFAULT 0,
    user_id    INT         NOT NULL,
    emoji      VARCHAR(16) NOT NULL,
    UNIQUE KEY unique_reaction (message_id, is_group, user_id, emoji),
    INDEX idx_message (message_id, is_group)
);

-- =====================================================
-- Таблица папок чатов
-- =====================================================
CREATE TABLE IF NOT EXISTS chat_folders (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    name       VARCHAR(100) NOT NULL,
    color      VARCHAR(20)  DEFAULT '#6366f1',
    position   INT          DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id)
);

-- =====================================================
-- Таблица связи папок с чатами
-- =====================================================
CREATE TABLE IF NOT EXISTS folder_chats (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    folder_id INT                        NOT NULL,
    chat_type ENUM('private', 'group')   NOT NULL,
    chat_id   INT                        NOT NULL,
    UNIQUE KEY unique_folder_chat (folder_id, chat_type, chat_id),
    FOREIGN KEY (folder_id) REFERENCES chat_folders(id) ON DELETE CASCADE
);
