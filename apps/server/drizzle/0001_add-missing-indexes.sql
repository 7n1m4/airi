CREATE INDEX "characters_ownerId_idx" ON "characters" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "chat_members_chatId_idx" ON "chat_members" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "messages_chatId_idx" ON "messages" USING btree ("chat_id");