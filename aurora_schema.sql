-- ============================================================
--  Aurora Messenger — полная схема базы данных
--  Версия: release v1.0.0 build 1
--  Дата:   2026-05-16
--
--  Использование:
--    mysql -u root -p < aurora_schema.sql
--  или в MySQL Workbench / DBeaver — выполнить весь файл.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

-- ────────────────────────────────────────────────────────────
-- База данных
-- ────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS `aurora`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `aurora`;

-- ============================================================
-- 1. ПОЛЬЗОВАТЕЛИ
-- ============================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id`               INT            NOT NULL AUTO_INCREMENT,
  `username`         VARCHAR(100)   NOT NULL,
  `tag`              VARCHAR(64)    NULL     DEFAULT NULL COMMENT '@тег, глобально уникален',
  `email`            VARCHAR(255)   NOT NULL,
  `password_hash`    VARCHAR(255)   NOT NULL,
  `avatar`           VARCHAR(512)   NULL     DEFAULT NULL,
  `avatar_color`     VARCHAR(50)    NULL     DEFAULT '#1a73e8',
  `status`           VARCHAR(255)   NULL     DEFAULT NULL,
  `birthday`         DATE           NULL     DEFAULT NULL,
  `phone`            VARCHAR(50)    NULL     DEFAULT NULL,
  `privacy_settings` TEXT           NULL     DEFAULT NULL COMMENT 'JSON',
  `last_seen`        TIMESTAMP      NULL     DEFAULT NULL,
  `public_key`       TEXT           NULL     DEFAULT NULL COMMENT 'RSA публичный ключ для E2E',
  `now_playing`      TEXT           NULL     DEFAULT NULL COMMENT 'JSON текущего трека',
  `setup_complete`   TINYINT(1)     NOT NULL DEFAULT 0,
  `is_deleted`       TINYINT(1)     NOT NULL DEFAULT 0,
  `is_banned`        TINYINT(1)     NOT NULL DEFAULT 0,
  `ban_reason`       VARCHAR(255)   NULL     DEFAULT NULL,
  `ban_expires_at`   DATETIME       NULL     DEFAULT NULL,
  `created_at`       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`  (`email`),
  UNIQUE KEY `uq_tag`    (`tag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. ТЕГИ ПОЛЬЗОВАТЕЛЕЙ (история / дополнительные псевдонимы)
-- ============================================================
CREATE TABLE IF NOT EXISTS `user_tags` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `user_id`    INT          NOT NULL,
  `tag`        VARCHAR(64)  NOT NULL,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tag` (`tag`),
  INDEX `idx_ut_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. ИСТОРИЯ СМЕНЫ ИМЁН
-- ============================================================
CREATE TABLE IF NOT EXISTS `username_history` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `user_id`      INT          NOT NULL,
  `old_username` VARCHAR(100) NOT NULL,
  `changed_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_uh_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. СЕССИИ ПОЛЬЗОВАТЕЛЕЙ
-- ============================================================
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `user_id`     INT           NOT NULL,
  `token_hash`  VARCHAR(64)   NOT NULL,
  `device_name` VARCHAR(200)  NOT NULL DEFAULT 'Unknown device',
  `device_id`   VARCHAR(64)   NULL     DEFAULT NULL,
  `ip`          VARCHAR(64)   NULL     DEFAULT NULL,
  `last_active` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token_hash`  (`token_hash`),
  UNIQUE KEY `idx_user_device` (`user_id`, `device_id`),
  INDEX `idx_us_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4A. PUSH-ТОКЕНЫ УСТРОЙСТВ
-- ============================================================
CREATE TABLE IF NOT EXISTS `push_tokens` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `user_id`     INT           NOT NULL,
  `push_token`  VARCHAR(512)  NOT NULL,
  `platform`    VARCHAR(32)   NULL     DEFAULT NULL,
  `device_id`   VARCHAR(64)   NULL     DEFAULT NULL,
  `enabled`     TINYINT(1)    NOT NULL DEFAULT 1,
  `last_seen`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_push_token` (`push_token`),
  INDEX `idx_push_user` (`user_id`),
  INDEX `idx_push_device` (`user_id`, `device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. ЛИЧНЫЕ СООБЩЕНИЯ
-- ============================================================
CREATE TABLE IF NOT EXISTS `messages` (
  `id`                  INT        NOT NULL AUTO_INCREMENT,
  `sender_id`           INT        NOT NULL,
  `receiver_id`         INT        NOT NULL,
  `message_text`        TEXT       NULL     DEFAULT NULL,
  `file_path`           VARCHAR(512) NULL   DEFAULT NULL,
  `filename`            VARCHAR(255) NULL   DEFAULT NULL,
  `file_size`           BIGINT     NULL     DEFAULT NULL,
  `files`               TEXT       NULL     DEFAULT NULL COMMENT 'JSON массив вложений',
  `reply_to_id`         INT        NULL     DEFAULT NULL,
  `reply_to_text`       TEXT       NULL     DEFAULT NULL,
  `reply_to_sender`     VARCHAR(255) NULL   DEFAULT NULL,
  `reply_to_file_path`  VARCHAR(512) NULL   DEFAULT NULL,
  `is_read`             TINYINT(1) NOT NULL DEFAULT 0,
  `is_deleted`          TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_by_sender`   TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_by_receiver` TINYINT(1) NOT NULL DEFAULT 0,
  `delivered`           TINYINT(1) NOT NULL DEFAULT 0,
  `edited_at`           DATETIME   NULL     DEFAULT NULL,
  `disappear_after`     INT        NULL     DEFAULT NULL COMMENT 'Секунды до исчезновения',
  `timestamp`           TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_msg_sender`   (`sender_id`),
  INDEX `idx_msg_receiver` (`receiver_id`),
  INDEX `idx_msg_pair`     (`sender_id`, `receiver_id`),
  INDEX `idx_msg_ts`       (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 6. РЕАКЦИИ НА СООБЩЕНИЯ (личные и групповые)
-- ============================================================
CREATE TABLE IF NOT EXISTS `message_reactions` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `message_id` INT          NOT NULL,
  `is_group`   TINYINT(1)   NOT NULL DEFAULT 0,
  `user_id`    INT          NOT NULL,
  `emoji`      VARCHAR(16)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reaction` (`message_id`, `is_group`, `user_id`, `emoji`),
  INDEX `idx_mr_msg` (`message_id`, `is_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 7. ГРУППЫ И КАНАЛЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS `groups` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(255)  NOT NULL,
  `description`     TEXT          NULL     DEFAULT NULL,
  `creator_id`      INT           NOT NULL,
  `avatar`          VARCHAR(512)  NULL     DEFAULT NULL,
  `is_channel`      TINYINT(1)    NOT NULL DEFAULT 0,
  `channel_type`    VARCHAR(10)   NOT NULL DEFAULT 'public',
  `channel_tag`     VARCHAR(64)   NULL     DEFAULT NULL,
  `invite_link`     VARCHAR(64)   NULL     DEFAULT NULL,
  `slow_mode`       INT           NOT NULL DEFAULT 0  COMMENT 'Секунды между сообщениями',
  `welcome_message` TEXT          NULL     DEFAULT NULL,
  `created_at`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_channel_tag` (`channel_tag`),
  INDEX `idx_groups_creator` (`creator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 8. УЧАСТНИКИ ГРУПП
-- ============================================================
CREATE TABLE IF NOT EXISTS `group_members` (
  `id`           INT         NOT NULL AUTO_INCREMENT,
  `group_id`     INT         NOT NULL,
  `user_id`      INT         NOT NULL,
  `role`         ENUM('admin','member') NOT NULL DEFAULT 'member',
  `custom_title` VARCHAR(64) NULL DEFAULT NULL,
  `joined_at`    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gm` (`group_id`, `user_id`),
  INDEX `idx_gm_group` (`group_id`),
  INDEX `idx_gm_user`  (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 9. СООБЩЕНИЯ В ГРУППАХ
-- ============================================================
CREATE TABLE IF NOT EXISTS `group_messages` (
  `id`                 INT        NOT NULL AUTO_INCREMENT,
  `group_id`           INT        NOT NULL,
  `sender_id`          INT        NULL     DEFAULT NULL,
  `message_text`       TEXT       NULL     DEFAULT NULL,
  `file_path`          VARCHAR(512) NULL   DEFAULT NULL,
  `filename`           VARCHAR(255) NULL   DEFAULT NULL,
  `file_size`          BIGINT     NULL     DEFAULT NULL,
  `files`              TEXT       NULL     DEFAULT NULL COMMENT 'JSON массив вложений',
  `reply_to_id`        INT        NULL     DEFAULT NULL,
  `reply_to_file_path` VARCHAR(512) NULL   DEFAULT NULL,
  `hidden_for`         TEXT       NULL     DEFAULT NULL COMMENT 'JSON массив user_id',
  `is_system`          TINYINT(1) NOT NULL DEFAULT 0,
  `is_deleted`         TINYINT(1) NOT NULL DEFAULT 0,
  `edited_at`          DATETIME   NULL     DEFAULT NULL,
  `disappear_after`    INT        NULL     DEFAULT NULL,
  `mention_ping`       TINYINT(1) NOT NULL DEFAULT 0,
  `timestamp`          TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_gm_group` (`group_id`),
  INDEX `idx_gm_ts`    (`group_id`, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 10. ПРОЧТЕНИЯ ГРУППОВЫХ СООБЩЕНИЙ
-- ============================================================
CREATE TABLE IF NOT EXISTS `group_message_reads` (
  `id`         INT       NOT NULL AUTO_INCREMENT,
  `message_id` INT       NOT NULL,
  `user_id`    INT       NOT NULL,
  `group_id`   INT       NOT NULL,
  `read_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_read` (`message_id`, `user_id`),
  INDEX `idx_gmr_group` (`group_id`),
  INDEX `idx_gmr_user`  (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 11. SLOW MODE — МЕТКИ ВРЕМЕНИ
-- ============================================================
CREATE TABLE IF NOT EXISTS `group_slow_mode_timestamps` (
  `group_id`        INT      NOT NULL,
  `user_id`         INT      NOT NULL,
  `last_message_at` DATETIME NOT NULL,
  PRIMARY KEY (`group_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 12. ПРОСМОТРЫ ПОСТОВ КАНАЛА
-- ============================================================
CREATE TABLE IF NOT EXISTS `post_views` (
  `message_id` INT      NOT NULL,
  `user_id`    INT      NOT NULL,
  `viewed_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_id`, `user_id`),
  INDEX `idx_pv_msg` (`message_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 13. ПАПКИ ЧАТОВ
-- ============================================================
CREATE TABLE IF NOT EXISTS `chat_folders` (
  `id`       INT          NOT NULL AUTO_INCREMENT,
  `user_id`  INT          NOT NULL,
  `name`     VARCHAR(100) NOT NULL,
  `color`    VARCHAR(20)  NOT NULL DEFAULT '#6366f1',
  `position` INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_cf_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 14. ЧАТЫ В ПАПКАХ
-- ============================================================
CREATE TABLE IF NOT EXISTS `folder_chats` (
  `id`        INT                       NOT NULL AUTO_INCREMENT,
  `folder_id` INT                       NOT NULL,
  `chat_type` ENUM('private','group')   NOT NULL,
  `chat_id`   INT                       NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fc` (`folder_id`, `chat_type`, `chat_id`),
  INDEX `idx_fc_folder` (`folder_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 15. ПОДДЕРЖКА (тикеты)
-- ============================================================
CREATE TABLE IF NOT EXISTS `support_messages` (
  `id`             INT        NOT NULL AUTO_INCREMENT,
  `user_id`        INT        NOT NULL,
  `sender_id`      INT        NOT NULL,
  `message_text`   TEXT       NOT NULL,
  `file_path`      VARCHAR(512) NULL DEFAULT NULL,
  `filename`       VARCHAR(255) NULL DEFAULT NULL,
  `is_admin_reply` TINYINT(1) NOT NULL DEFAULT 0,
  `is_read`        TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`     TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sm_user`    (`user_id`),
  INDEX `idx_sm_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 16. ЗАБЛОКИРОВАННЫЕ ПОЛЬЗОВАТЕЛИ
-- ============================================================
CREATE TABLE IF NOT EXISTS `blocked_users` (
  `id`         INT       NOT NULL AUTO_INCREMENT,
  `blocker_id` INT       NOT NULL,
  `blocked_id` INT       NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_block`     (`blocker_id`, `blocked_id`),
  INDEX `idx_bu_blocker`    (`blocker_id`),
  INDEX `idx_bu_blocked`    (`blocked_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 17. ЗАПЛАНИРОВАННЫЕ СООБЩЕНИЯ
-- ============================================================
CREATE TABLE IF NOT EXISTS `scheduled_messages` (
  `id`               INT        NOT NULL AUTO_INCREMENT,
  `sender_id`        INT        NOT NULL,
  `receiver_id`      INT        NULL     DEFAULT NULL,
  `group_id`         INT        NULL     DEFAULT NULL,
  `message_text`     TEXT       NOT NULL,
  `scheduled_at`     DATETIME   NOT NULL,
  `sent`             TINYINT(1) NOT NULL DEFAULT 0,
  `send_when_online` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`       TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sched` (`scheduled_at`, `sent`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 18. ОПРОСЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS `polls` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `creator_id`      INT          NOT NULL,
  `question`        VARCHAR(512) NOT NULL,
  `options`         JSON         NOT NULL,
  `is_anonymous`    TINYINT(1)   NOT NULL DEFAULT 0,
  `is_multi_choice` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_polls_creator` (`creator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 19. ГОЛОСА В ОПРОСАХ
-- ============================================================
CREATE TABLE IF NOT EXISTS `poll_votes` (
  `id`             INT       NOT NULL AUTO_INCREMENT,
  `poll_id`        INT       NOT NULL,
  `user_id`        INT       NOT NULL,
  `option_indices` JSON      NOT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vote`      (`poll_id`, `user_id`),
  INDEX `idx_pv_poll` (`poll_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 20. НАСТРОЙКИ ИСЧЕЗАЮЩИХ СООБЩЕНИЙ
-- ============================================================
CREATE TABLE IF NOT EXISTS `chat_disappear_settings` (
  `user_id`    INT         NOT NULL,
  `other_id`   INT         NOT NULL,
  `chat_type`  VARCHAR(10) NOT NULL,
  `seconds`    INT         NULL     DEFAULT NULL,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `other_id`, `chat_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 21. ПЛЕЙЛИСТЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS `playlists` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `user_id`    INT          NOT NULL,
  `name`       VARCHAR(255) NOT NULL,
  `cover`      VARCHAR(512) NULL     DEFAULT NULL,
  `share_code` VARCHAR(32)  NULL     DEFAULT NULL,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pl_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 22. ТРЕКИ В ПЛЕЙЛИСТАХ
-- ============================================================
CREATE TABLE IF NOT EXISTS `playlist_tracks` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `playlist_id` INT          NOT NULL,
  `title`       VARCHAR(255) NOT NULL,
  `artist`      VARCHAR(255) NULL     DEFAULT NULL,
  `file_path`   VARCHAR(512) NOT NULL,
  `cover_path`  VARCHAR(512) NULL     DEFAULT NULL,
  `duration`    INT          NULL     DEFAULT NULL COMMENT 'Секунды',
  `position`    INT          NOT NULL DEFAULT 0,
  `added_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pt_playlist` (`playlist_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 23. ЖАЛОБЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS `reports` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `reporter_id` INT          NOT NULL,
  `target_type` ENUM('user','group','message') NOT NULL,
  `target_id`   INT          NOT NULL,
  `reason`      VARCHAR(64)  NOT NULL,
  `comment`     TEXT         NULL     DEFAULT NULL,
  `status`      ENUM('pending','reviewed','dismissed') NOT NULL DEFAULT 'pending',
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_rep_status`   (`status`),
  INDEX `idx_rep_reporter` (`reporter_id`),
  INDEX `idx_rep_target`   (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- КОНЕЦ СХЕМЫ
-- ============================================================
SET FOREIGN_KEY_CHECKS = 1;

-- Проверка (раскомментировать для вывода списка таблиц):
-- SHOW TABLES;
