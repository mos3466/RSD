CREATE TABLE `detectionEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`detectionType` varchar(80) NOT NULL,
	`cameraId` varchar(32) NOT NULL,
	`trackingId` varchar(32),
	`tripId` varchar(32),
	`confidence` int NOT NULL,
	`source` enum('camera','simulation') NOT NULL DEFAULT 'camera',
	`occurredAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `detectionEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`detectionEventId` int NOT NULL,
	`status` enum('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
	`reviewerId` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
