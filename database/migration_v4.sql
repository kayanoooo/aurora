-- Migration v4: extended user profile, tags, privacy settings

ALTER TABLE users
    ADD COLUMN avatar_color VARCHAR(7) NOT NULL DEFAULT '#1a73e8',
    ADD COLUMN birthday DATE NULL,
    ADD COLUMN phone VARCHAR(30) NULL,
    ADD COLUMN privacy_settings VARCHAR(500) DEFAULT '{"show_birthday":true,"show_phone":true,"show_tags":true,"show_status":true}';

CREATE TABLE IF NOT EXISTS user_tags (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    tag VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE INDEX idx_user_tags_tag (tag),
    INDEX idx_user_tags_user (user_id)
);

-- Add sender_avatar_color to group_messages (for display)
ALTER TABLE group_messages
    ADD COLUMN sender_avatar_color VARCHAR(7) NULL;