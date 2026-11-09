ALTER TABLE `trips` ADD `lastScanEventId` varchar(128);--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_lastScanEventId_unique` UNIQUE(`lastScanEventId`);