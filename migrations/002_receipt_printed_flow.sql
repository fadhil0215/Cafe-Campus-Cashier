-- ==============================================================================
-- CAFE CAMPUS DATABASE MIGRATION v7.1
-- Migration 002: Fitur Status Cetak Struk Pesanan (Receipt Printed Flow)
-- ==============================================================================

ALTER TABLE `orders`
ADD COLUMN IF NOT EXISTS `receipt_printed` TINYINT(1) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS `receipt_printed_at` TIMESTAMP NULL DEFAULT NULL;

