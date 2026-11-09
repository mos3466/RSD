ALTER TABLE `trips` ADD COLUMN `lastScanAt` bigint NULL;
ALTER TABLE `trips` ADD COLUMN `lastScanDecision` varchar(24) NULL;
UPDATE `trips` SET `lastScanAt` = `startedAt` WHERE `lastScanAt` IS NULL;
