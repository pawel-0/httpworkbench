CREATE TABLE `instancePathResponses` (
	`instanceId` text NOT NULL,
	`path` text NOT NULL,
	`raw` text NOT NULL,
	PRIMARY KEY(`instanceId`, `path`),
	FOREIGN KEY (`instanceId`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
