-- ========================================================
-- Cafe Campus Database Schema & Seed Data (v7 Complete)
-- Database: cafe_campus_db
-- ========================================================

-- CREATE DATABASE IF NOT EXISTS `cafe_campus_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE `cafe_campus_db`;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data untuk: `admins`
INSERT INTO `admins` (`id`, `name`, `email`, `password_hash`, `role`, `created_at`) VALUES
('admin-1', 'Admin Campus', 'admin@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'ADMIN', '2026-09-18 12:34:50'),
('admin-kasir-1', 'Kasir Utama', 'kasir@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'CASHIER', '2026-10-18 08:00:00'),
('admin-dapur-1', 'Staf Dapur & Barista', 'dapur@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'KITCHEN', '2026-10-18 08:00:00')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `role`=VALUES(`role`);

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data untuk: `cafe_tables` (Meja B1 s/d B6, 101-105, 201-210, 301-309, 401-404, AD 1 s/d AD 5)
INSERT INTO `cafe_tables` (`id`, `table_number`, `name`, `public_token`, `token_version`, `is_active`, `created_at`) VALUES
('tbl-b1', 'B1', 'Meja B1', 'demo-table-b1', 1, 1, '2026-09-18 12:47:44'),
('tbl-b2', 'B2', 'Meja B2', 'demo-table-b2', 1, 1, '2026-09-18 12:47:44'),
('tbl-b3', 'B3', 'Meja B3', 'demo-table-b3', 1, 1, '2026-09-18 12:47:44'),
('tbl-b4', 'B4', 'Meja B4', 'demo-table-b4', 1, 1, '2026-09-18 12:47:44'),
('tbl-b5', 'B5', 'Meja B5', 'demo-table-b5', 1, 1, '2026-09-18 12:47:44'),
('tbl-b6', 'B6', 'Meja B6', 'demo-table-b6', 1, 1, '2026-09-19 12:13:35'),
('tbl-101', '101', 'Meja 101', 'demo-table-101', 1, 1, '2026-10-01 10:00:00'),
('tbl-102', '102', 'Meja 102', 'demo-table-102', 1, 1, '2026-10-01 10:00:00'),
('tbl-103', '103', 'Meja 103', 'demo-table-103', 1, 1, '2026-10-01 10:00:00'),
('tbl-104', '104', 'Meja 104', 'demo-table-104', 1, 1, '2026-10-01 10:00:00'),
('tbl-105', '105', 'Meja 105', 'demo-table-105', 1, 1, '2026-10-01 10:00:00'),
('tbl-201', '201', 'Meja 201', 'demo-table-201', 1, 1, '2026-10-01 10:00:00'),
('tbl-202', '202', 'Meja 202', 'demo-table-202', 1, 1, '2026-10-01 10:00:00'),
('tbl-203', '203', 'Meja 203', 'demo-table-203', 1, 1, '2026-10-01 10:00:00'),
('tbl-204', '204', 'Meja 204', 'demo-table-204', 1, 1, '2026-10-01 10:00:00'),
('tbl-205', '205', 'Meja 205', 'demo-table-205', 1, 1, '2026-10-01 10:00:00'),
('tbl-206', '206', 'Meja 206', 'demo-table-206', 1, 1, '2026-10-01 10:00:00'),
('tbl-207', '207', 'Meja 207', 'demo-table-207', 1, 1, '2026-10-01 10:00:00'),
('tbl-208', '208', 'Meja 208', 'demo-table-208', 1, 1, '2026-10-01 10:00:00'),
('tbl-209', '209', 'Meja 209', 'demo-table-209', 1, 1, '2026-10-01 10:00:00'),
('tbl-210', '210', 'Meja 210', 'demo-table-210', 1, 1, '2026-10-01 10:00:00'),
('tbl-301', '301', 'Meja 301', 'demo-table-301', 1, 1, '2026-10-01 10:00:00'),
('tbl-302', '302', 'Meja 302', 'demo-table-302', 1, 1, '2026-10-01 10:00:00'),
('tbl-303', '303', 'Meja 303', 'demo-table-303', 1, 1, '2026-10-01 10:00:00'),
('tbl-304', '304', 'Meja 304', 'demo-table-304', 1, 1, '2026-10-01 10:00:00'),
('tbl-305', '305', 'Meja 305', 'demo-table-305', 1, 1, '2026-10-01 10:00:00'),
('tbl-306', '306', 'Meja 306', 'demo-table-306', 1, 1, '2026-10-01 10:00:00'),
('tbl-307', '307', 'Meja 307', 'demo-table-307', 1, 1, '2026-10-01 10:00:00'),
('tbl-308', '308', 'Meja 308', 'demo-table-308', 1, 1, '2026-10-01 10:00:00'),
('tbl-309', '309', 'Meja 309', 'demo-table-309', 1, 1, '2026-10-01 10:00:00'),
('tbl-401', '401', 'Meja 401', 'demo-table-401', 1, 1, '2026-10-01 10:00:00'),
('tbl-402', '402', 'Meja 402', 'demo-table-402', 1, 1, '2026-10-01 10:00:00'),
('tbl-403', '403', 'Meja 403', 'demo-table-403', 1, 1, '2026-10-01 10:00:00'),
('tbl-404', '404', 'Meja 404', 'demo-table-404', 1, 1, '2026-10-01 10:00:00'),
('tbl-ad-1', 'AD 1', 'Meja AD 1', 'demo-table-ad-1', 1, 1, '2026-10-01 10:00:00'),
('tbl-ad-2', 'AD 2', 'Meja AD 2', 'demo-table-ad-2', 1, 1, '2026-10-01 10:00:00'),
('tbl-ad-3', 'AD 3', 'Meja AD 3', 'demo-table-ad-3', 1, 1, '2026-10-01 10:00:00'),
('tbl-ad-4', 'AD 4', 'Meja AD 4', 'demo-table-ad-4', 1, 1, '2026-10-01 10:00:00'),
('tbl-ad-5', 'AD 5', 'Meja AD 5', 'demo-table-ad-5', 1, 1, '2026-10-01 10:00:00'),
('tbl-12', '12', 'Meja 12', 'demo-table-12', 1, 0, '2026-10-01 10:00:00')
ON DUPLICATE KEY UPDATE `table_number`=VALUES(`table_number`), `name`=VALUES(`name`), `public_token`=VALUES(`public_token`);

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
  `is_tobacco` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data untuk: `categories`
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`, `is_tobacco`) VALUES
('cat-1', 'Kopi Asik', 'kopi', 1, 1, 'DRINK', 0),
('cat-2', 'Non-Kopi', 'non-kopi', 2, 1, 'DRINK', 0),
('cat-3', 'Makanan Utama', 'makanan', 3, 1, 'FOOD', 0),
('cat-4', 'Snack & Pastry', 'snack', 4, 1, 'FOOD', 0),
('cat-5', 'Dessert', 'dessert', 5, 1, 'FOOD', 0),
('cat-rokok', 'Rokok & Tembakau (21+)', 'rokok', 6, 1, 'DRINK', 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `kitchen_type`=VALUES(`kitchen_type`), `is_tobacco`=VALUES(`is_tobacco`);

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
  `is_tobacco` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data untuk: `products`
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`, `is_tobacco`) VALUES
('prod-mocca-blue', 'cat-1', 'Mocca Blue', 'Bold espresso, rich chocolate, and a sweet blueberry twist. Sounds unexpected, tastes unforgettable!', 19000.00, 16000.00, '🫐', '/assets/mocca-blue.jpg', 1, 1, 1, 1, 0),
('prod-spanish-latte', 'cat-1', 'Spanish Latte', 'A perfect blend of espresso, caramel, and fresh milk. Creamy, smooth, with a sweet caramel touch in every sip.', 19000.00, 16000.00, '☕', '/assets/spanish-latte.jpg', 1, 1, 2, 1, 0),
('prod-oat-latte', 'cat-1', 'Oat Latte', 'Perpaduan espresso yang bold dan oat milk yang creamy, dengan rasa kopi yang smooth dan hint manis alami. Lebih aman buat lambung.', 19000.00, 16000.00, '🌾', '/assets/oat-latte.jpg', 1, 1, 3, 1, 0),
('prod-ubee-latte', 'cat-2', 'Ubee Latte', 'Sweet, creamy, and full of purple goodness! Perpaduan susu, creamer, dan sensasi ubi ungu manis yang lembut di mulut siap jadi moodbooster baru kamu.', 19000.00, 16000.00, '🍠', '/assets/ubee-latte.jpg', 1, 1, 4, 1, 0),
('prod-nasgor-bp', 'cat-3', 'Nasi Goreng Banyak Pikiran', 'Nasi goreng gurih yang dimasak dengan penuh rasa, dipadukan telur mata sapi yang lembut dan creamy, serta kerupuk renyah yang melengkapi setiap suapan. Hangat, sederhana, dan pas untuk nemenin kamu yang lagi banyak pikiran!', 22000.00, 19000.00, '🍳', '/assets/nasi-goreng-banyak-pikiran.jpg', 1, 0, 5, 1, 0),
('prod-bekal-nugas', 'cat-3', 'Bekal Nugas', 'Seporsi nasi putih hangat disajikan bersama fried chicken renyah keemasan, scrambled egg lembut & creamy, serta jukut bayam segar. Pas untuk bekal nugas kapan saja. (Tersedia opsi Sambal Matah / Sambal Bawang).', 26000.00, 23000.00, '🍱', '/assets/bekal-nugas.jpg', 1, 0, 6, 1, 0),
('prod-nasi-kulit', 'cat-3', 'Nasi Kulit Daun Jeruk', 'Nasi hangat dengan kulit ayam crispy gurih & renyah dipadukan aroma segar daun jeruk yang menggugah selera. Bikin susah berhenti makan!', 23000.00, 20000.00, '🍗', '/assets/nasi-kulit-daun-jeruk.jpg', 1, 0, 7, 1, 0),
('prod-bakmi-matah', 'cat-3', 'Bakmi Goreng Sambal Matah', 'Bakmi goreng hangat dengan bumbu gurih yang meresap sempurna, dipadukan sambal matah segar yang pedas, dan wangi. Bikin setiap suapan terasa spesial!', 26000.00, 23000.00, '🍜', '/assets/bakmi-goreng-sambal-matah.jpg', 1, 0, 8, 1, 0),
('prod-burger-classic', 'cat-3', 'Classic Campus Burger', 'Perpaduan roti lembut dengan homemade patty juicy, dilengkapi selada segar, timun, tomat, dan saus spesial. Sederhana, klasik, dan selalu jadi favorit.', 19000.00, 16000.00, '🍔', '/assets/classic-burger.jpg', 1, 0, 9, 1, 0),
('prod-burger-cheesy', 'cat-3', 'Cheesy Campus Burger', 'Lelehan keju creamy yang menyelimuti homemade patty juicy, berpadu dengan roti lembut dan sayuran segar. Setiap gigitan penuh rasa gurih yang bikin susah berhenti!', 21000.00, 18000.00, '🧀', '/assets/cheesy-burger.jpg', 1, 0, 10, 1, 0),
('prod-toast-butter', 'cat-4', 'Butter Boom Toast', 'Toast gurih dengan aroma mentega, butter crumble yang renyah, dan siraman susu kental manis yang lumer di setiap gigitan. Sweet, Buttery, Crispy.', 18000.00, 15000.00, '🍞', '/assets/butter-boom-toast.jpg', 1, 0, 11, 1, 0),
('prod-toast-moo', 'cat-4', 'Moo Toast', 'Toast tebal dengan mentega yang harum, berpadu saus susu creamy yang melimpah dan taburan cokelat manis yang bikin susah berhenti makan. Sweet, Soft, Addictive.', 18000.00, 15000.00, '🥛', '/assets/moo-toast.jpg', 1, 0, 12, 1, 0),
('prod-1', 'cat-1', 'Iced Latte Gula Aren', 'Kopi susu lokal spesial dengan gula aren premium.', 28000.00, 22000.00, '☕', '/assets/iced-latte.jpg', 1, 1, 13, 1, 0),
('prod-2', 'cat-4', 'Croissant Cokelat', 'Pastry hangat & renyah isi cokelat lembut.', 25000.00, 20000.00, '🥐', '/assets/croissant.jpg', 1, 0, 14, 1, 0),
('prod-3', 'cat-2', 'Uji Matcha Latte', 'Matcha Jepang autentik kualitas premium.', 32000.00, 25000.00, '🍵', '/assets/matcha.jpg', 1, 1, 15, 1, 0),
('prod-4', 'cat-5', 'Waffle Gelato', 'Waffle mentega hangat dipadu gelato vanilla.', 35000.00, 28000.00, '🧇', '/assets/waffle.jpg', 1, 0, 16, 1, 0),
('prod-5', 'cat-1', 'Double Espresso', 'Racikan kopi murni yang intens dan kaya aroma.', 20000.00, 15000.00, '☕', '/assets/espresso.jpg', 1, 0, 17, 1, 0),
('prod-6', 'cat-2', 'Premium Iced Chocolate', 'Cokelat hitam murni dipadu susu segar.', 30000.00, 24000.00, '🍫', '/assets/chocolate.jpg', 1, 1, 18, 1, 0),
('prod-7', 'cat-3', 'Nasi Goreng Kampus', 'Nasi goreng gurih dengan telur, ayam, dan acar.', 35000.00, 28000.00, '🍛', '/assets/nasi-goreng.jpg', 1, 0, 19, 1, 0),
('prod-8', 'cat-3', 'Chicken Rice Bowl', 'Ayam crispy saus lada hitam dengan nasi hangat.', 38000.00, 30000.00, '🥣', '/assets/rice-bowl.jpg', 1, 0, 20, 1, 0),
('prod-9', 'cat-4', 'French Fries', 'Kentang goreng renyah dengan saus pilihan.', 20000.00, 16000.00, '🍟', '/assets/french-fries.jpg', 1, 0, 21, 1, 0),
('prod-10', 'cat-5', 'Brownies Gelato', 'Brownies cokelat hangat dengan gelato vanilla.', 32000.00, 26000.00, '🍰', '/assets/brownies.jpg', 1, 0, 22, 1, 0),
('prod-cig-1', 'cat-rokok', 'Marlboro Filter Black', 'Rokok filter premium (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 42000.00, 42000.00, '🚬', '/assets/croissant.jpg', 1, 0, 23, 1, 1),
('prod-cig-2', 'cat-rokok', 'Esse Change Grape', 'Rokok mild kapsul rasa anggur (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 40000.00, 40000.00, '🚬', '/assets/croissant.jpg', 1, 0, 24, 1, 1)
ON DUPLICATE KEY UPDATE `price`=VALUES(`price`), `student_price`=VALUES(`student_price`), `is_tobacco`=VALUES(`is_tobacco`), `sort_order`=VALUES(`sort_order`);

-- --------------------------------------------------------
-- Struktur Tabel: `raw_materials` (Bahan Baku & Inventaris)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `raw_materials`;
CREATE TABLE `raw_materials` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `sku` varchar(50) NOT NULL,
  `unit` varchar(20) NOT NULL DEFAULT 'gram',
  `current_stock` decimal(12,2) NOT NULL DEFAULT '0.00',
  `minimum_stock` decimal(12,2) NOT NULL DEFAULT '5.00',
  `cost_per_unit` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sku` (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `raw_materials` (`id`, `name`, `sku`, `unit`, `current_stock`, `minimum_stock`, `cost_per_unit`) VALUES
('mat-coffee-bean', 'Biji Kopi Arabika House Blend', 'MAT-COFFEE', 'gram', 2500.00, 500.00, 250.00),
('mat-fresh-milk', 'Susu Segar Pasteurisasi', 'MAT-MILK', 'ml', 10000.00, 2000.00, 18.00),
('mat-aren-sugar', 'Sirup Gula Aren Asli', 'MAT-AREN', 'ml', 3000.00, 500.00, 40.00),
('mat-matcha-powder', 'Bubuk Uji Matcha Jepang', 'MAT-MATCHA', 'gram', 1500.00, 300.00, 350.00),
('mat-croissant-dough', 'Frozen Butter Croissant', 'MAT-CROISSANT', 'pcs', 40.00, 10.00, 12000.00),
('mat-rice', 'Beras Pulen Super', 'MAT-RICE', 'gram', 15000.00, 3000.00, 16.00),
('mat-chicken-cut', 'Daging Ayam Fillet Siap Masak', 'MAT-CHICKEN', 'gram', 5000.00, 1000.00, 50.00),
('mat-french-fries', 'Frozen French Fries Cut', 'MAT-FRIES', 'gram', 4000.00, 1000.00, 35.00),
('mat-cig-marlboro', 'Stok Marlboro Filter Black', 'MAT-CIG-MB', 'bks', 30.00, 5.00, 38000.00),
('mat-cig-esse', 'Stok Esse Change Grape', 'MAT-CIG-ES', 'bks', 25.00, 5.00, 36000.00)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- --------------------------------------------------------
-- Struktur Tabel: `product_recipes` (Komposisi Menu)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `product_recipes`;
CREATE TABLE `product_recipes` (
  `id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `raw_material_id` varchar(50) NOT NULL,
  `quantity_needed` decimal(10,2) NOT NULL DEFAULT '1.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_prod_mat` (`product_id`,`raw_material_id`),
  KEY `raw_material_id` (`raw_material_id`),
  CONSTRAINT `fk_recipe_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recipe_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `product_recipes` (`id`, `product_id`, `raw_material_id`, `quantity_needed`) VALUES
('rcp-1a', 'prod-1', 'mat-coffee-bean', 18.00),
('rcp-1b', 'prod-1', 'mat-fresh-milk', 150.00),
('rcp-1c', 'prod-1', 'mat-aren-sugar', 25.00),
('rcp-2a', 'prod-2', 'mat-croissant-dough', 1.00),
('rcp-3a', 'prod-3', 'mat-matcha-powder', 15.00),
('rcp-3b', 'prod-3', 'mat-fresh-milk', 180.00),
('rcp-5a', 'prod-5', 'mat-coffee-bean', 20.00),
('rcp-7a', 'prod-7', 'mat-rice', 180.00),
('rcp-7b', 'prod-7', 'mat-chicken-cut', 60.00),
('rcp-8a', 'prod-8', 'mat-rice', 180.00),
('rcp-8b', 'prod-8', 'mat-chicken-cut', 100.00),
('rcp-9a', 'prod-9', 'mat-french-fries', 150.00),
('rcp-c1', 'prod-cig-1', 'mat-cig-marlboro', 1.00),
('rcp-c2', 'prod-cig-2', 'mat-cig-esse', 1.00)
ON DUPLICATE KEY UPDATE `quantity_needed`=VALUES(`quantity_needed`);

-- --------------------------------------------------------
-- Struktur Tabel: `stock_mutations` (Log Mutasi Stok)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `stock_mutations`;
CREATE TABLE `stock_mutations` (
  `id` varchar(50) NOT NULL,
  `raw_material_id` varchar(50) NOT NULL,
  `type` enum('SALE','VOID_RESTORE','RESTOCK','ADJUSTMENT') NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `balance_after` decimal(12,2) NOT NULL,
  `reference_order_number` varchar(50) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `raw_material_id` (`raw_material_id`),
  KEY `reference_order_number` (`reference_order_number`),
  CONSTRAINT `fk_mutation_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `orders`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` varchar(50) NOT NULL,
  `idempotency_key` varchar(100) DEFAULT NULL,
  `order_number` varchar(50) NOT NULL,
  `queue_number` varchar(20) DEFAULT NULL,
  `table_id` varchar(50) DEFAULT NULL,
  `table_name` varchar(100) DEFAULT NULL,
  `customer_type` varchar(20) DEFAULT 'REGULAR',
  `student_name` varchar(100) DEFAULT NULL,
  `student_campus` varchar(150) DEFAULT NULL,
  `student_id_num` varchar(50) DEFAULT NULL,
  `student_faculty_id` varchar(50) DEFAULT NULL,
  `student_faculty_code` varchar(20) DEFAULT NULL,
  `student_faculty_name` varchar(150) DEFAULT NULL,
  `student_study_program` varchar(150) DEFAULT NULL,
  `student_birth_date` date DEFAULT NULL,
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
  `is_birthday_reward` tinyint(1) DEFAULT '0',
  `birthday_reward_name` varchar(150) DEFAULT NULL,
  `void_reason` text,
  `voided_by` varchar(50) DEFAULT NULL,
  `voided_at` timestamp NULL DEFAULT NULL,
  `receipt_printed` tinyint(1) NOT NULL DEFAULT '0',
  `receipt_printed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_number` (`order_number`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `idx_orders_parent` (`parent_order_number`),
  KEY `idx_orders_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `regular_base_price` decimal(10,2) DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `regular_price` decimal(10,2) DEFAULT NULL,
  `savings` decimal(10,2) DEFAULT '0.00',
  `line_total` decimal(10,2) NOT NULL,
  `note` text,
  `options_json` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `order_id` (`order_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `service_fee` decimal(5,2) DEFAULT '5.00',
  `tax_percent` decimal(5,2) DEFAULT '11.00',
  `qris_enabled` tinyint(1) DEFAULT '1',
  `cash_enabled` tinyint(1) DEFAULT '1',
  `sound_enabled` tinyint(1) DEFAULT '1',
  `daily_report_enabled` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data untuk: `settings`
INSERT INTO `settings` (`id`, `cafe_name`, `cafe_address`, `cafe_phone`, `operating_hours`, `service_fee`, `tax_percent`, `qris_enabled`, `cash_enabled`, `sound_enabled`, `daily_report_enabled`)
VALUES (1, 'Cafe Campus', 'Jl. Kampus Merdeka No. 42', '0812-3456-7890', '08:00 - 22:00 WIB', 5.00, 11.00, 1, 1, 1, 1)
ON DUPLICATE KEY UPDATE `cafe_name`=VALUES(`cafe_name`), `service_fee`=VALUES(`service_fee`), `tax_percent`=VALUES(`tax_percent`);

-- --------------------------------------------------------
-- Struktur Tabel: `faculties` (Master Fakultas)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `faculties`;
CREATE TABLE `faculties` (
  `id` varchar(50) NOT NULL,
  `code` varchar(20) NOT NULL,
  `name` varchar(150) NOT NULL,
  `color` varchar(20) NOT NULL DEFAULT '#1e3a8a',
  `secondary_color` varchar(20) NOT NULL DEFAULT '#f1f5f9',
  `icon` varchar(50) DEFAULT 'academic-cap',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `faculties` (`id`, `code`, `name`, `color`, `secondary_color`, `icon`, `is_active`) VALUES
('fac-ft', 'FT', 'Fakultas Teknik', '#1e3a8a', '#dbeafe', 'tool', 1),
('fac-fk', 'FK', 'Fakultas Kedokteran', '#065f46', '#d1fae5', 'heart', 1),
('fac-feb', 'FEB', 'Fakultas Ekonomi dan Bisnis', '#b45309', '#fef3c7', 'trending-up', 1),
('fac-fh', 'FH', 'Fakultas Hukum', '#991b1b', '#fee2e2', 'scale', 1),
('fac-cs', 'FASILKOM', 'Fakultas Ilmu Komputer', '#6b21a8', '#f3e8ff', 'cpu', 1),
('fac-mipa', 'FMIPA', 'Fakultas Matematika & IPA', '#0e7490', '#cffafe', 'atom', 1),
('fac-fisip', 'FISIP', 'Fakultas Ilmu Sosial & Politik', '#c2410c', '#ffedd5', 'users', 1),
('fac-fib', 'FIB', 'Fakultas Ilmu Pengetahuan Budaya', '#0f766e', '#ccfbf1', 'book-open', 1),
('fac-fpsi', 'FPSI', 'Fakultas Psikologi', '#be185d', '#fce7f3', 'smile', 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `color`=VALUES(`color`), `secondary_color`=VALUES(`secondary_color`);

-- --------------------------------------------------------
-- Struktur Tabel: `birthday_rewards` (Hadiah Ulang Tahun)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `birthday_rewards`;
CREATE TABLE `birthday_rewards` (
  `id` varchar(50) NOT NULL,
  `student_id_num` varchar(50) NOT NULL,
  `reward_year` int NOT NULL,
  `reward_name` varchar(150) NOT NULL,
  `order_number` varchar(50) NOT NULL,
  `granted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_student_year` (`student_id_num`,`reward_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `loyalty_accounts` & `loyalty_logs` (Poin Loyalitas)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `loyalty_accounts`;
CREATE TABLE `loyalty_accounts` (
  `id` varchar(50) NOT NULL,
  `student_id_num` varchar(50) NOT NULL,
  `student_name` varchar(100) NOT NULL,
  `points_balance` int NOT NULL DEFAULT '0',
  `total_spent` decimal(12,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_id_num` (`student_id_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `loyalty_logs`;
CREATE TABLE `loyalty_logs` (
  `id` varchar(50) NOT NULL,
  `student_id_num` varchar(50) NOT NULL,
  `points_change` int NOT NULL,
  `balance_after` int NOT NULL,
  `type` enum('EARNED','REDEEMED','BIRTHDAY_BONUS','ADJUSTMENT') NOT NULL,
  `reference_order_number` varchar(50) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `student_id_num` (`student_id_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `cashier_shifts` (Shift Kasir)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `cashier_shifts`;
CREATE TABLE `cashier_shifts` (
  `id` varchar(50) NOT NULL,
  `cashier_id` varchar(50) NOT NULL,
  `cashier_name` varchar(100) NOT NULL,
  `started_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` timestamp NULL DEFAULT NULL,
  `starting_cash` decimal(10,2) NOT NULL DEFAULT '0.00',
  `ending_cash_system` decimal(10,2) NOT NULL DEFAULT '0.00',
  `ending_cash_actual` decimal(10,2) NOT NULL DEFAULT '0.00',
  `cash_difference` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_sales_cash` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_sales_qris` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_orders_count` int NOT NULL DEFAULT '0',
  `status` enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  `notes` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `audit_logs` (Audit Log)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
  `id` varchar(50) NOT NULL,
  `user_id` varchar(50) DEFAULT NULL,
  `user_name` varchar(100) DEFAULT NULL,
  `role` varchar(30) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `target_type` varchar(50) NOT NULL,
  `target_id` varchar(100) DEFAULT NULL,
  `details` json DEFAULT NULL,
  `ip_address` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Struktur Tabel: `push_subscriptions`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `push_subscriptions`;
CREATE TABLE `push_subscriptions` (
  `endpoint` varchar(500) NOT NULL,
  `channel` varchar(50) NOT NULL DEFAULT 'customer',
  `order_number` varchar(50) DEFAULT NULL,
  `p256dh` varchar(255) DEFAULT NULL,
  `auth` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`endpoint`(255)),
  KEY `idx_push_order` (`order_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
