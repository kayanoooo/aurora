USE messenger;

-- Таблица групп
CREATE TABLE IF NOT EXISTS groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    creator_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    avatar VARCHAR(255),
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_creator (creator_id)
);

-- Таблица участников групп
CREATE TABLE IF NOT EXISTS group_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('admin', 'member') DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_member (group_id, user_id),
    INDEX idx_group (group_id),
    INDEX idx_user (user_id)
);

-- Таблица групповых сообщений
CREATE TABLE IF NOT EXISTS group_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    sender_id INT NOT NULL,
    message_text TEXT,
    file_path VARCHAR(255),
    filename VARCHAR(255),
    file_size INT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_group (group_id),
    INDEX idx_timestamp (timestamp)
);

-- Добавляем поле для типа чата в личные сообщения (опционально)
ALTER TABLE messages ADD COLUMN chat_type ENUM('private', 'group') DEFAULT 'private';

ALTER TABLE messages ADD COLUMN reply_to_id INT NULL;
ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP NULL;
ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;

-- Для групповых сообщений
ALTER TABLE group_messages ADD COLUMN reply_to_id INT NULL;
ALTER TABLE group_messages ADD COLUMN edited_at TIMESTAMP NULL;
ALTER TABLE group_messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE group_messages ADD FOREIGN KEY (reply_to_id) REFERENCES group_messages(id) ON DELETE SET NULL;