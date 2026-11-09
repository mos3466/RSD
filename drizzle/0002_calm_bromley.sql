CREATE TABLE `trips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tripId` varchar(32) NOT NULL,
	`cardUidHash` varchar(64) NOT NULL,
	`idempotencyKey` varchar(128) NOT NULL,
	`startedAt` bigint NOT NULL,
	`status` enum('active','completed','hold') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trips_id` PRIMARY KEY(`id`),
	CONSTRAINT `trips_tripId_unique` UNIQUE(`tripId`),
	CONSTRAINT `trips_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
