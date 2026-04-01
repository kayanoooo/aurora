-- Aurora Messenger — полный скрипт миграции БД
-- Безопасен для повторного запуска (IF NOT EXISTS / IF EXISTS везде)
-- Протестировано на MySQL 8.0 (Railway)

SET NAMES utf8mb4;
SET foreign_key_checks = 0;

-- ============================================================
-- ТАБЛИЦЫ
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
    `id`               INT          NOT NULL AUTO_INCREMENT,
    `username`         VARCHAR(50)  NOT NULL,
    `email`            VARCHAR(100) NOT NULL,
    `password_hash`    VARCHAR(255) NOT NULL,
    `tag`              VARCHAR(30)  DEFAULT NULL,
    `setup_complete`   TINYINT(1)   NOT NULL DEFAULT 0,
    `avatar`           VARCHAR(500) DEFAULT NULL,
    `status`           VARCHAR(200) DEFAULT NULL,
    `avatar_color`     VARCHAR(20)  DEFAULT '#6366f1',
    `birthday`         DATE         DEFAULT NULL,
    `phone`            VARCHAR(20)  DEFAULT NULL,
    `privacy_settings` TEXT         DEFAULT NULL,
    `last_seen`        DATETIME     DEFAULT NULL,
    `is_online`        TINYINT(1)   NOT NULL DEFAULT 0,
    `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    UNIQUE KEY `uq_users_tag`   (`tag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `messages` (
    `id`                  INT          NOT NULL AUTO_INCREMENT,
    `sender_id`           INT          NOT NULL,
    `receiver_id`         INT          NOT NULL,
    `message_text`        TEXT         DEFAULT NULL,
    `file_path`           VARCHAR(500) DEFAULT NULL,
    `filename`            VARCHAR(255) DEFAULT NULL,
    `file_size`           BIGINT       DEFAULT NULL,
    `files`               JSON         DEFAULT NULL,
    `reply_to_id`         INT          DEFAULT NULL,
    `reply_to_text`       TEXT         DEFAULT NULL,
    `reply_to_sender`     VARCHAR(100) DEFAULT NULL,
    `reply_to_file_path`  VARCHAR(500) DEFAULT NULL,
    `is_read`             TINYINT(1)   NOT NULL DEFAULT 0,
    `is_deleted`          TINYINT(1)   NOT NULL DEFAULT 0,
    `delivered`           TINYINT(1)   NOT NULL DEFAULT 0,
    `deleted_by_sender`   TINYINT(1)   NOT NULL DEFAULT 0,
    `deleted_by_receiver` TINYINT(1)   NOT NULL DEFAULT 0,
    `edited_at`           DATETIME     DEFAULT NULL,
    `timestamp`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_messages_sender`   (`sender_id`),
    KEY `idx_messages_receiver` (`receiver_id`),
    CONSTRAINT `fk_msg_sender`   FOREIGN KEY (`sender_id`)   REFERENCES `users`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_msg_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `groups` (
    `id`           INT          NOT NULL AUTO_INCREMENT,
    `name`         VARCHAR(100) NOT NULL,
    `description`  TEXT         DEFAULT NULL,
    `creator_id`   INT          NOT NULL,
    `avatar`       VARCHAR(500) DEFAULT NULL,
    `is_channel`   TINYINT(1)   NOT NULL DEFAULT 0,
    `channel_type` VARCHAR(20)  NOT NULL DEFAULT 'public',
    `channel_tag`  VARCHAR(50)  DEFAULT NULL,
    `invite_link`  VARCHAR(100) DEFAULT NULL,
    `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_groups_channel_tag`  (`channel_tag`),
    UNIQUE KEY `uq_groups_invite_link`  (`invite_link`),
    KEY `idx_groups_creator` (`creator_id`),
    CONSTRAINT `fk_groups_creator` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `group_members` (
    `group_id`  INT         NOT NULL,
    `user_id`   INT         NOT NULL,
    `role`      VARCHAR(20) NOT NULL DEFAULT 'member',
    `joined_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`group_id`, `user_id`),
    CONSTRAINT `fk_gm_group` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gm_user`  FOREIGN KEY (`user_id`)  REFERENCES `users`(`id`)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `group_messages` (
    `id`                 INT          NOT NULL AUTO_INCREMENT,
    `group_id`           INT          NOT NULL,
    `sender_id`          INT          DEFAULT NULL,
    `message_text`       TEXT         DEFAULT NULL,
    `file_path`          VARCHAR(500) DEFAULT NULL,
    `filename`           VARCHAR(255) DEFAULT NULL,
    `file_size`          BIGINT       DEFAULT NULL,
    `files`              JSON         DEFAULT NULL,
    `reply_to_id`        INT          DEFAULT NULL,
    `reply_to_file_path` VARCHAR(500) DEFAULT NULL,
    `is_system`          TINYINT(1)   NOT NULL DEFAULT 0,
    `is_deleted`         TINYINT(1)   NOT NULL DEFAULT 0,
    `hidden_for`         JSON         DEFAULT NULL,
    `edited_at`          DATETIME     DEFAULT NULL,
    `timestamp`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_gmsgs_group`  (`group_id`),
    KEY `idx_gmsgs_sender` (`sender_id`),
    CONSTRAINT `fk_gmsgs_group`  FOREIGN KEY (`group_id`)  REFERENCES `groups`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gmsgs_sender` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `group_message_reads` (
    `message_id` INT       NOT NULL,
    `user_id`    INT       NOT NULL,
    `group_id`   INT       NOT NULL,
    `read_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`message_id`, `user_id`),
    KEY `idx_gmr_group` (`group_id`),
    CONSTRAINT `fk_gmr_message` FOREIGN KEY (`message_id`) REFERENCES `group_messages`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gmr_user`    FOREIGN KEY (`user_id`)    REFERENCES `users`(`id`)          ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `message_reactions` (
    `id`         INT         NOT NULL AUTO_INCREMENT,
    `message_id` INT         NOT NULL,
    `is_group`   TINYINT(1)  NOT NULL DEFAULT 0,
    `user_id`    INT         NOT NULL,
    `emoji`      VARCHAR(10) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_reaction` (`message_id`, `is_group`, `user_id`, `emoji`),
    KEY `idx_reactions_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `user_tags` (
    `id`         INT         NOT NULL AUTO_INCREMENT,
    `user_id`    INT         NOT NULL,
    `tag`        VARCHAR(30) NOT NULL,
    `created_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_user_tags_tag` (`tag`),
    KEY `idx_user_tags_user` (`user_id`),
    CONSTRAINT `fk_user_tags_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `chat_folders` (
    `id`       INT         NOT NULL AUTO_INCREMENT,
    `user_id`  INT         NOT NULL,
    `name`     VARCHAR(50) NOT NULL,
    `color`    VARCHAR(20) NOT NULL DEFAULT '#6366f1',
    `position` INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_folders_user` (`user_id`),
    CONSTRAINT `fk_folders_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS `folder_chats` (
    `id`        INT         NOT NULL AUTO_INCREMENT,
    `folder_id` INT         NOT NULL,
    `chat_type` VARCHAR(20) NOT NULL,
    `chat_id`   INT         NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_folder_chat` (`folder_id`, `chat_type`, `chat_id`),
    CONSTRAINT `fk_folder_chats_folder` FOREIGN KEY (`folder_id`) REFERENCES `chat_folders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ДОБАВЛЕНИЕ КОЛОНОК К СУЩЕСТВУЮЩИМ ТАБЛИЦАМ
-- Совместимо с MySQL 5.7+ через INFORMATION_SCHEMA
-- ============================================================

DROP PROCEDURE IF EXISTS _add_col;
DELIMITER //
CREATE PROCEDURE _add_col(tbl VARCHAR(64), col VARCHAR(64), def TEXT)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
    ) THEN
        SET @_sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', def);
        PREPARE _s FROM @_sql; EXECUTE _s; DEALLOCATE PREPARE _s;
    END IF;
END //
DELIMITER ;

-- users
CALL _add_col('users', 'tag',              'VARCHAR(30) DEFAULT NULL');
CALL _add_col('users', 'setup_complete',   'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('users', 'avatar',           'VARCHAR(500) DEFAULT NULL');
CALL _add_col('users', 'status',           'VARCHAR(200) DEFAULT NULL');
CALL _add_col('users', 'avatar_color',     'VARCHAR(20) DEFAULT \'#6366f1\'');
CALL _add_col('users', 'birthday',         'DATE DEFAULT NULL');
CALL _add_col('users', 'phone',            'VARCHAR(20) DEFAULT NULL');
CALL _add_col('users', 'privacy_settings', 'TEXT DEFAULT NULL');
CALL _add_col('users', 'last_seen',        'DATETIME DEFAULT NULL');
CALL _add_col('users', 'is_online',        'TINYINT(1) NOT NULL DEFAULT 0');

-- messages
CALL _add_col('messages', 'files',               'JSON DEFAULT NULL');
CALL _add_col('messages', 'reply_to_text',        'TEXT DEFAULT NULL');
CALL _add_col('messages', 'reply_to_sender',      'VARCHAR(100) DEFAULT NULL');
CALL _add_col('messages', 'reply_to_file_path',   'VARCHAR(500) DEFAULT NULL');
CALL _add_col('messages', 'delivered',            'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('messages', 'deleted_by_sender',    'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('messages', 'deleted_by_receiver',  'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('messages', 'edited_at',            'DATETIME DEFAULT NULL');

-- groups
CALL _add_col('groups', 'avatar',       'VARCHAR(500) DEFAULT NULL');
CALL _add_col('groups', 'is_channel',   'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('groups', 'channel_type', 'VARCHAR(20) NOT NULL DEFAULT \'public\'');
CALL _add_col('groups', 'channel_tag',  'VARCHAR(50) DEFAULT NULL');
CALL _add_col('groups', 'invite_link',  'VARCHAR(100) DEFAULT NULL');

-- group_messages
CALL _add_col('group_messages', 'files',              'JSON DEFAULT NULL');
CALL _add_col('group_messages', 'reply_to_file_path', 'VARCHAR(500) DEFAULT NULL');
CALL _add_col('group_messages', 'is_system',          'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('group_messages', 'hidden_for',         'JSON DEFAULT NULL');
CALL _add_col('group_messages', 'edited_at',          'DATETIME DEFAULT NULL');

-- уникальные индексы (через процедуру, т.к. IF NOT EXISTS для индексов тоже не везде есть)
DROP PROCEDURE IF EXISTS _add_idx;
DELIMITER //
CREATE PROCEDURE _add_idx(tbl VARCHAR(64), idx VARCHAR(64), cols TEXT)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
    ) THEN
        SET @_sql = CONCAT('ALTER TABLE `', tbl, '` ADD UNIQUE KEY `', idx, '` (', cols, ')');
        PREPARE _s FROM @_sql; EXECUTE _s; DEALLOCATE PREPARE _s;
    END IF;
END //
DELIMITER ;

CALL _add_idx('users',  'uq_users_tag',           '`tag`');
CALL _add_idx('groups', 'uq_groups_channel_tag',  '`channel_tag`');
CALL _add_idx('groups', 'uq_groups_invite_link',  '`invite_link`');

DROP PROCEDURE IF EXISTS _add_col;
DROP PROCEDURE IF EXISTS _add_idx;

SET foreign_key_checks = 1;
