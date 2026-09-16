CREATE TABLE `completed_item_histories` (
	`completion_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`start_id` text,
	`start_sequence` integer,
	`delta_id` text,
	`delta_sequence` integer,
	`delta_type` text,
	`second_delta_id` text,
	`second_delta_sequence` integer,
	`second_delta_type` text,
	`data` text NOT NULL,
	FOREIGN KEY (`completion_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "completed_item_histories_start_shape" CHECK(("completed_item_histories"."start_id" IS NULL) = ("completed_item_histories"."start_sequence" IS NULL)),
	CONSTRAINT "completed_item_histories_delta_shape" CHECK(("completed_item_histories"."delta_id" IS NULL) = ("completed_item_histories"."delta_sequence" IS NULL) AND ("completed_item_histories"."delta_id" IS NULL) = ("completed_item_histories"."delta_type" IS NULL)),
	CONSTRAINT "completed_item_histories_second_delta_shape" CHECK(("completed_item_histories"."second_delta_id" IS NULL) = ("completed_item_histories"."second_delta_sequence" IS NULL) AND ("completed_item_histories"."second_delta_id" IS NULL) = ("completed_item_histories"."second_delta_type" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completed_item_histories_start_id_idx` ON `completed_item_histories` (`start_id`) WHERE "completed_item_histories"."start_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `completed_item_histories_start_sequence_idx` ON `completed_item_histories` (`thread_id`,`start_sequence`) WHERE "completed_item_histories"."start_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `completed_item_histories_delta_id_idx` ON `completed_item_histories` (`delta_id`) WHERE "completed_item_histories"."delta_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `completed_item_histories_delta_sequence_idx` ON `completed_item_histories` (`thread_id`,`delta_sequence`) WHERE "completed_item_histories"."delta_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `completed_item_histories_delta_type_sequence_idx` ON `completed_item_histories` (`thread_id`,`delta_type`,`delta_sequence`) WHERE "completed_item_histories"."delta_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `completed_item_histories_second_delta_id_idx` ON `completed_item_histories` (`second_delta_id`) WHERE "completed_item_histories"."second_delta_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `completed_item_histories_second_delta_sequence_idx` ON `completed_item_histories` (`thread_id`,`second_delta_sequence`) WHERE "completed_item_histories"."second_delta_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `completed_item_histories_second_delta_type_sequence_idx` ON `completed_item_histories` (`thread_id`,`second_delta_type`,`second_delta_sequence`) WHERE "completed_item_histories"."second_delta_id" IS NOT NULL;