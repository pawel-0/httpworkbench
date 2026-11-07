ALTER TABLE `instances` ADD `subdomain` text;--> statement-breakpoint
UPDATE `instances` SET `subdomain` = `id`;--> statement-breakpoint
CREATE UNIQUE INDEX `instances_subdomain_unique` ON `instances` (`subdomain`);
