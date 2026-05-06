-- ═══════════════════════════════════════════════════════════
--  Aurora Messenger — Railway MySQL migration script
--  Запустить в Railway: MySQL → Query tab → вставить и выполнить
-- ═══════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`               INT(11)      NOT NULL AUTO_INCREMENT,
  `username`         VARCHAR(50)  NOT NULL,
  `email`            VARCHAR(100) NOT NULL,
  `password_hash`    VARCHAR(255) NOT NULL,
  `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `avatar`           VARCHAR(255)          DEFAULT NULL,
  `status`           VARCHAR(150)          DEFAULT '',
  `avatar_color`     VARCHAR(7)   NOT NULL DEFAULT '#1a73e8',
  `birthday`         DATE                  DEFAULT NULL,
  `phone`            VARCHAR(30)           DEFAULT NULL,
  `privacy_settings` VARCHAR(500)          DEFAULT '{"show_birthday":true,"show_phone":true,"show_tags":true,"show_status":true}',
  `last_seen`        TIMESTAMP    NULL     DEFAULT NULL,
  `setup_complete`   TINYINT(1)   NOT NULL DEFAULT 0,
  `tag`              VARCHAR(30)           DEFAULT NULL,
  `public_key`       TEXT                  DEFAULT NULL,
  `is_deleted`       TINYINT(1)   NOT NULL DEFAULT 0,
  `now_playing`      TEXT                  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `tag`   (`tag`),
  KEY `idx_username` (`username`),
  KEY `idx_email`    (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── user_tags ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `user_tags` (
  `id`         INT(11)     NOT NULL AUTO_INCREMENT,
  `user_id`    INT(11)     NOT NULL,
  `tag`        VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_tags_tag`  (`tag`),
  KEY        `idx_user_tags_user` (`user_id`),
  CONSTRAINT `user_tags_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `messages` (
  `id`                  INT(11)      NOT NULL AUTO_INCREMENT,
  `sender_id`           INT(11)      NOT NULL,
  `receiver_id`         INT(11)      NOT NULL,
  `message_text`        MEDIUMTEXT            DEFAULT NULL,
  `file_path`           VARCHAR(255)          DEFAULT NULL,
  `filename`            VARCHAR(255)          DEFAULT NULL,
  `file_size`           INT(11)               DEFAULT NULL,
  `timestamp`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered`           TINYINT(1)            DEFAULT 0,
  `chat_type`           ENUM('private','group') DEFAULT 'private',
  `reply_to_id`         INT(11)               DEFAULT NULL,
  `reply_to_text`       TEXT                  DEFAULT NULL,
  `reply_to_sender`     VARCHAR(100)          DEFAULT NULL,
  `edited_at`           TIMESTAMP    NULL     DEFAULT NULL,
  `is_deleted`          TINYINT(1)            DEFAULT 0,
  `files`               TEXT                  DEFAULT NULL,
  `is_read`             TINYINT(1)   NOT NULL DEFAULT 0,
  `reply_to_file_path`  VARCHAR(255)          DEFAULT NULL,
  `deleted_by_sender`   TINYINT(1)            DEFAULT 0,
  `deleted_by_receiver` TINYINT(1)            DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_sender`       (`sender_id`),
  KEY `idx_receiver`     (`receiver_id`),
  KEY `idx_timestamp`    (`timestamp`),
  KEY `idx_conversation` (`sender_id`,`receiver_id`,`timestamp`),
  KEY `reply_to_id`      (`reply_to_id`),
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`sender_id`)   REFERENCES `users`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `messages_ibfk_2` FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `messages_ibfk_3` FOREIGN KEY (`reply_to_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── groups ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `groups` (
  `id`           INT(11)     NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(100) NOT NULL,
  `description`  TEXT                  DEFAULT NULL,
  `creator_id`   INT(11)     NOT NULL,
  `created_at`   TIMESTAMP   NOT NULL  DEFAULT CURRENT_TIMESTAMP,
  `avatar`       VARCHAR(255)          DEFAULT NULL,
  `is_channel`   TINYINT(1)  NOT NULL  DEFAULT 0,
  `channel_type` VARCHAR(10) NOT NULL  DEFAULT 'public',
  `channel_tag`  VARCHAR(64)           DEFAULT NULL,
  `invite_link`  VARCHAR(64)           DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_creator` (`creator_id`),
  CONSTRAINT `groups_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── group_members ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `group_members` (
  `id`           INT(11)                   NOT NULL AUTO_INCREMENT,
  `group_id`     INT(11)                   NOT NULL,
  `user_id`      INT(11)                   NOT NULL,
  `role`         ENUM('admin','member')    DEFAULT 'member',
  `joined_at`    TIMESTAMP                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `custom_title` VARCHAR(64)               DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_member` (`group_id`,`user_id`),
  KEY `idx_group` (`group_id`),
  KEY `idx_user`  (`user_id`),
  CONSTRAINT `group_members_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE,
  CONSTRAINT `group_members_ibfk_2` FOREIGN KEY (`user_id`)  REFERENCES `users`(`id`)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── group_messages ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `group_messages` (
  `id`                 INT(11)      NOT NULL AUTO_INCREMENT,
  `group_id`           INT(11)      NOT NULL,
  `sender_id`          INT(11)               DEFAULT NULL,
  `message_text`       TEXT                  DEFAULT NULL,
  `file_path`          VARCHAR(255)          DEFAULT NULL,
  `filename`           VARCHAR(255)          DEFAULT NULL,
  `file_size`          INT(11)               DEFAULT NULL,
  `timestamp`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reply_to_id`        INT(11)               DEFAULT NULL,
  `edited_at`          TIMESTAMP    NULL     DEFAULT NULL,
  `is_deleted`         TINYINT(1)            DEFAULT 0,
  `sender_avatar_color` VARCHAR(7)           DEFAULT NULL,
  `is_system`          TINYINT(1)   NOT NULL DEFAULT 0,
  `files`              TEXT                  DEFAULT NULL,
  `reply_to_file_path` VARCHAR(255)          DEFAULT NULL,
  `hidden_for`         TEXT                  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sender_id`    (`sender_id`),
  KEY `idx_group`    (`group_id`),
  KEY `idx_timestamp`(`timestamp`),
  KEY `reply_to_id`  (`reply_to_id`),
  CONSTRAINT `group_messages_ibfk_1` FOREIGN KEY (`group_id`)    REFERENCES `groups`(`id`)         ON DELETE CASCADE,
  CONSTRAINT `group_messages_ibfk_2` FOREIGN KEY (`sender_id`)   REFERENCES `users`(`id`)          ON DELETE CASCADE,
  CONSTRAINT `group_messages_ibfk_3` FOREIGN KEY (`reply_to_id`) REFERENCES `group_messages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── group_message_reads ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `group_message_reads` (
  `id`         INT(11)   NOT NULL AUTO_INCREMENT,
  `message_id` INT(11)   NOT NULL,
  `user_id`    INT(11)   NOT NULL,
  `group_id`   INT(11)   NOT NULL,
  `read_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_read` (`message_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── message_reactions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `message_reactions` (
  `id`         INT(11)     NOT NULL AUTO_INCREMENT,
  `message_id` INT(11)     NOT NULL,
  `is_group`   TINYINT(1)  NOT NULL DEFAULT 0,
  `user_id`    INT(11)     NOT NULL,
  `emoji`      VARCHAR(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_reaction` (`message_id`,`is_group`,`user_id`,`emoji`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── blocked_users ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `blocked_users` (
  `id`         INT(11)   NOT NULL AUTO_INCREMENT,
  `blocker_id` INT(11)   NOT NULL,
  `blocked_id` INT(11)   NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_block` (`blocker_id`,`blocked_id`),
  KEY `idx_blocker` (`blocker_id`),
  KEY `idx_blocked` (`blocked_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── chat_folders ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `chat_folders` (
  `id`       INT(11)      NOT NULL AUTO_INCREMENT,
  `user_id`  INT(11)      NOT NULL,
  `name`     VARCHAR(100) NOT NULL,
  `color`    VARCHAR(20)           DEFAULT '#6366f1',
  `position` INT(11)               DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── folder_chats ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `folder_chats` (
  `id`        INT(11)                   NOT NULL AUTO_INCREMENT,
  `folder_id` INT(11)                   NOT NULL,
  `chat_type` ENUM('private','group')   NOT NULL,
  `chat_id`   INT(11)                   NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_folder_chat` (`folder_id`,`chat_type`,`chat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── post_views ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `post_views` (
  `message_id` INT(11)  NOT NULL,
  `user_id`    INT(11)  NOT NULL,
  `viewed_at`  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── support_messages ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `support_messages` (
  `id`             INT(11)      NOT NULL AUTO_INCREMENT,
  `user_id`        INT(11)      NOT NULL,
  `sender_id`      INT(11)      NOT NULL,
  `message_text`   TEXT         NOT NULL,
  `is_admin_reply` TINYINT(1)   NOT NULL DEFAULT 0,
  `is_read`        TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `file_path`      VARCHAR(512)          DEFAULT NULL,
  `filename`       VARCHAR(255)          DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_support_user`    (`user_id`),
  KEY `idx_support_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── scheduled_messages ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS `scheduled_messages` (
  `id`           INT(11)   NOT NULL AUTO_INCREMENT,
  `sender_id`    INT(11)   NOT NULL,
  `receiver_id`  INT(11)            DEFAULT NULL,
  `group_id`     INT(11)            DEFAULT NULL,
  `message_text` TEXT      NOT NULL,
  `scheduled_at` DATETIME  NOT NULL,
  `sent`         TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`   TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scheduled` (`scheduled_at`,`sent`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── polls ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `polls` (
  `id`              INT(11)      NOT NULL AUTO_INCREMENT,
  `creator_id`      INT(11)      NOT NULL,
  `question`        VARCHAR(512) NOT NULL,
  `options`         JSON         NOT NULL,
  `is_anonymous`    TINYINT(1)   NOT NULL DEFAULT 0,
  `is_multi_choice` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_polls_creator` (`creator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── poll_votes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `poll_votes` (
  `id`             INT(11)   NOT NULL AUTO_INCREMENT,
  `poll_id`        INT(11)   NOT NULL,
  `user_id`        INT(11)   NOT NULL,
  `option_indices` JSON      NOT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_vote`       (`poll_id`,`user_id`),
  KEY        `idx_poll_votes_poll` (`poll_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── playlists ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `playlists` (
  `id`         INT(11)      NOT NULL AUTO_INCREMENT,
  `user_id`    INT(11)      NOT NULL,
  `name`       VARCHAR(255) NOT NULL,
  `share_code` VARCHAR(32)           DEFAULT NULL,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cover`      VARCHAR(512)          DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_playlists_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── playlist_tracks ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `playlist_tracks` (
  `id`          INT(11)      NOT NULL AUTO_INCREMENT,
  `playlist_id` INT(11)      NOT NULL,
  `title`       VARCHAR(255) NOT NULL,
  `artist`      VARCHAR(255)          DEFAULT NULL,
  `file_path`   VARCHAR(512) NOT NULL,
  `cover_path`  VARCHAR(512)          DEFAULT NULL,
  `duration`    INT(11)               DEFAULT NULL,
  `position`    INT(11)      NOT NULL DEFAULT 0,
  `added_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tracks_playlist` (`playlist_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
