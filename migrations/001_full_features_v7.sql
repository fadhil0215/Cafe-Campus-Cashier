-- ========================================================
-- Cafe Campus Database Migration & Seeder Script (v7)
-- Aman dijalankan berulang kali (Idempotent)
-- ========================================================

USE `cafe_campus_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Tabel: faculties (Master Data Fakultas)
CREATE TABLE IF NOT EXISTS `faculties` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

-- 2. Kategori Rokok & kitchen_type
INSERT INTO `categories` (`id`, `name`, `slug`, `sort_order`, `is_active`, `kitchen_type`, `is_tobacco`) VALUES
('cat-rokok', 'Rokok & Tembakau (21+)', 'rokok', 6, 1, 'DRINK', 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `is_tobacco`=1;

UPDATE `categories` SET `kitchen_type` = 'FOOD' WHERE `slug` IN ('makanan', 'snack', 'dessert');
UPDATE `categories` SET `kitchen_type` = 'DRINK' WHERE `slug` IN ('kopi', 'non-kopi');

-- 3. Produk Rokok
INSERT INTO `products` (`id`, `category_id`, `name`, `description`, `price`, `student_price`, `emoji`, `image_url`, `is_available`, `customizable`, `sort_order`, `is_active`, `is_tobacco`) VALUES
('prod-cig-1', 'cat-rokok', 'Marlboro Filter Black', 'Rokok filter premium (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 42000.00, 42000.00, '🚬', '/assets/croissant.jpg', 1, 0, 11, 1, 1),
('prod-cig-2', 'cat-rokok', 'Esse Change Grape', 'Rokok mild kapsul rasa anggur (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 40000.00, 40000.00, '🚬', '/assets/croissant.jpg', 1, 0, 12, 1, 1)
ON DUPLICATE KEY UPDATE `is_tobacco`=1, `student_price`=VALUES(`price`);

-- 4. Bahan Baku & Resep
CREATE TABLE IF NOT EXISTS `raw_materials` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

CREATE TABLE IF NOT EXISTS `product_recipes` (
  `id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `raw_material_id` varchar(50) NOT NULL,
  `quantity_needed` decimal(10,2) NOT NULL DEFAULT '1.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_prod_mat` (`product_id`,`raw_material_id`),
  KEY `raw_material_id` (`raw_material_id`),
  CONSTRAINT `fk_recipe_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recipe_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

CREATE TABLE IF NOT EXISTS `stock_mutations` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. Birthday Rewards
CREATE TABLE IF NOT EXISTS `birthday_rewards` (
  `id` varchar(50) NOT NULL,
  `student_id_num` varchar(50) NOT NULL,
  `reward_year` int NOT NULL,
  `reward_name` varchar(150) NOT NULL,
  `order_number` varchar(50) NOT NULL,
  `granted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_student_year` (`student_id_num`,`reward_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. Loyalty Tables
CREATE TABLE IF NOT EXISTS `loyalty_accounts` (
  `id` varchar(50) NOT NULL,
  `student_id_num` varchar(50) NOT NULL,
  `student_name` varchar(100) NOT NULL,
  `points_balance` int NOT NULL DEFAULT '0',
  `total_spent` decimal(12,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_id_num` (`student_id_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `loyalty_logs` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. Shifts
CREATE TABLE IF NOT EXISTS `cashier_shifts` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 8. Audit Logs
CREATE TABLE IF NOT EXISTS `audit_logs` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 9. Admins
INSERT INTO `admins` (`id`, `name`, `email`, `password_hash`, `role`) VALUES
('admin-kasir-1', 'Kasir Utama', 'kasir@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'CASHIER'),
('admin-dapur-1', 'Staf Dapur & Barista', 'dapur@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'KITCHEN')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `role`=VALUES(`role`);

SET FOREIGN_KEY_CHECKS = 1;
