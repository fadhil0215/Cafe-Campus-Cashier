-- ========================================================
-- Cafe Campus Database Schema & Seed Data
-- Database: cafe_campus_db
-- ========================================================

CREATE DATABASE IF NOT EXISTS `cafe_campus_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `cafe_campus_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------
-- Struktur Tabel: `admins`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `admins`;
CREATE TABLE `admins` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(20) DEFAULT 'ADMIN',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Data untuk: `admins`
INSERT INTO `admins` (`id`, `name`, `email`, `password_hash`, `role`, `created_at`) VALUES ('admin-1', 'Admin Campus', 'admin@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'ADMIN', '2026-09-18 12:34:50');

-- --------------------------------------------------------
-- Struktur Tabel: `blacklist`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `blacklist`;
CREATE TABLE `blacklist` (
  `id` varchar(50) NOT NULL,
  `student_id_num` varchar(50) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `student_name` varchar(100) DEFAULT NULL,
  `reason` text,
  `added_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `cafe_tables`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `cafe_tables`;
CREATE TABLE `cafe_tables` (
  `id` varchar(50) NOT NULL,
  `table_number` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `public_token` varchar(100) NOT NULL,
  `token_version` int DEFAULT '1',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `table_number` (`table_number`),
  UNIQUE KEY `public_token` (`public_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Data untuk: `cafe_tables`
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES ('tbl-1', '01', 'Meja 01', 'demo-table-01', 1, 1, '2026-09-18 12:47:44');
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES ('tbl-2', '02', 'Meja 02', 'demo-table-02', 1, 1, '2026-09-18 12:47:44');
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES ('tbl-3', '03', 'Meja 03', 'table-v2-945bfff3', 2, 1, '2026-09-18 12:47:44');
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES ('tbl-4', '04', 'Meja 04', 'demo-table-04', 1, 1, '2026-09-18 12:47:44');
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES ('tbl-5', '05', 'Meja 05', 'demo-table-05', 1, 1, '2026-09-18 12:47:44');
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES ('tbl-6', '06', 'Meja 06', 'demo-table-06', 1, 1, '2026-09-19 12:13:35');

-- --------------------------------------------------------
-- Struktur Tabel: `categories`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `kitchen_type` enum('DRINK','FOOD') NOT NULL DEFAULT 'DRINK',
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Data untuk: `categories`
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`) VALUES ('cat-1', 'Kopi Asik', 'kopi', 1, 1, 'DRINK');
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`) VALUES ('cat-2', 'Non-Kopi', 'non-kopi', 2, 1, 'DRINK');
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`) VALUES ('cat-3', 'Makanan Utama', 'makanan', 3, 1, 'FOOD');
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`) VALUES ('cat-4', 'Snack & Pastry', 'snack', 4, 1, 'FOOD');
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`) VALUES ('cat-5', 'Dessert', 'dessert', 5, 1, 'FOOD');

-- --------------------------------------------------------
-- Struktur Tabel: `order_items`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `id` varchar(50) NOT NULL,
  `order_id` varchar(50) NOT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `product_name` varchar(100) DEFAULT NULL,
  `quantity` int NOT NULL,
  `base_price` decimal(10,2) NOT NULL,
  `regular_base_price` decimal(10,2) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `regular_price` decimal(10,2) NOT NULL,
  `savings` decimal(10,2) DEFAULT '0.00',
  `line_total` decimal(10,2) NOT NULL,
  `note` text,
  `options_json` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `order_id` (`order_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `orders`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` varchar(50) NOT NULL,
  `idempotency_key` varchar(100) DEFAULT NULL,
  `order_number` varchar(50) NOT NULL,
  `table_id` varchar(50) DEFAULT NULL,
  `table_name` varchar(100) DEFAULT NULL,
  `customer_type` varchar(20) DEFAULT 'REGULAR',
  `student_name` varchar(100) DEFAULT NULL,
  `student_campus` varchar(150) DEFAULT NULL,
  `student_id_num` varchar(50) DEFAULT NULL,
  `student_email` varchar(100) DEFAULT NULL,
  `student_photo_url` varchar(255) DEFAULT NULL,
  `fraud_score` int DEFAULT '0',
  `fraud_risk` varchar(20) DEFAULT NULL,
  `verification_status` varchar(50) DEFAULT NULL,
  `rejection_reason` text,
  `subtotal` decimal(10,2) NOT NULL,
  `total_savings` decimal(10,2) DEFAULT '0.00',
  `service_fee` decimal(10,2) DEFAULT '0.00',
  `tax` decimal(10,2) DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL,
  `note` text,
  `status` varchar(30) DEFAULT 'NEW',
  `estimated_minutes` int DEFAULT '10',
  `payment_method` varchar(30) DEFAULT 'CASH',
  `payment_status` varchar(30) DEFAULT 'PENDING',
  `payment_ref` varchar(100) DEFAULT NULL,
  `payment_url` text,
  `paid_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `qris_url` text,
  `parent_order_number` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_number` (`order_number`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `idx_orders_parent` (`parent_order_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `products`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` varchar(50) NOT NULL,
  `category_id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `price` decimal(10,2) NOT NULL,
  `student_price` decimal(10,2) NOT NULL,
  `emoji` varchar(20) DEFAULT '☕',
  `image_url` varchar(255) DEFAULT NULL,
  `is_available` tinyint(1) DEFAULT '1',
  `customizable` tinyint(1) DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Data untuk: `products`
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-1', 'cat-1', 'Iced Latte Gula Aren', 'Kopi susu lokal spesial dengan gula aren premium.', '28000.00', '21000.00', '☕', '/assets/iced-latte.jpg', 1, 1, 1, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-10', 'cat-5', 'Brownies Gelato', 'Brownies cokelat hangat dengan gelato vanilla.', '32000.00', '26000.00', '🍰', '/assets/brownies.jpg', 1, 0, 10, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-2', 'cat-4', 'Croissant Cokelat', 'Pastry hangat & renyah isi cokelat lembut.', '25000.00', '20000.00', '🥐', '/assets/croissant.jpg', 1, 0, 2, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-3', 'cat-2', 'Uji Matcha Latte', 'Matcha Jepang autentik kualitas premium.', '32000.00', '25000.00', '🍵', '/assets/matcha.jpg', 1, 1, 3, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-4', 'cat-5', 'Waffle Gelato', 'Waffle mentega hangat dipadu gelato vanilla.', '35000.00', '28000.00', '🧇', '/assets/waffle.jpg', 1, 0, 4, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-5', 'cat-1', 'Double Espresso', 'Racikan kopi murni yang intens dan kaya aroma.', '20000.00', '15000.00', '☕', '/assets/espresso.jpg', 1, 0, 5, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-6', 'cat-2', 'Premium Iced Chocolate', 'Cokelat hitam murni dipadu susu segar.', '30000.00', '24000.00', '🍫', '/assets/chocolate.jpg', 1, 1, 6, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-7', 'cat-3', 'Nasi Goreng Kampus', 'Nasi goreng gurih dengan telur, ayam, dan acar.', '35000.00', '28000.00', '🍛', '/assets/nasi-goreng.jpg', 1, 0, 7, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-8', 'cat-3', 'Chicken Rice Bowl', 'Ayam crispy saus lada hitam dengan nasi hangat.', '38000.00', '30000.00', '🥣', '/assets/rice-bowl.jpg', 1, 0, 8, 1);
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`) VALUES ('prod-9', 'cat-4', 'French Fries', 'Kentang goreng renyah dengan saus pilihan.', '20000.00', '16000.00', '🍟', '/assets/french-fries.jpg', 1, 0, 9, 1);

-- --------------------------------------------------------
-- Struktur Tabel: `settings`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `id` int NOT NULL DEFAULT '1',
  `cafe_name` varchar(100) DEFAULT 'Cafe Campus',
  `cafe_address` varchar(255) DEFAULT NULL,
  `cafe_phone` varchar(50) DEFAULT NULL,
  `operating_hours` varchar(100) DEFAULT NULL,
  `service_fee` decimal(5,2) DEFAULT '0.00',
  `tax_percent` decimal(5,2) DEFAULT '11.00',
  `qris_enabled` tinyint(1) DEFAULT '1',
  `cash_enabled` tinyint(1) DEFAULT '1',
  `sound_enabled` tinyint(1) DEFAULT '1',
  `daily_report_enabled` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Data untuk: `settings`
INSERT INTO `settings` (`id`, `cafe_name`, `cafe_address`, `cafe_phone`, `operating_hours`, `service_fee`, `tax_percent`, `qris_enabled`, `cash_enabled`, `sound_enabled`, `daily_report_enabled`) VALUES (1, 'Cafe Campus', '', '', '', '0.00', '11.00', 1, 1, 1, 1);

SET FOREIGN_KEY_CHECKS = 1;
