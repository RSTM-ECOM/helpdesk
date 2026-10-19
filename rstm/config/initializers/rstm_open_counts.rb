# frozen_string_literal: true

# RSTM patch (19.10.2026): sidebar badges count OPEN conversations, like the Gorgias views did.
#
# Chatwoot 4.18 counts "unread" conversations: open AND an incoming message after agent_last_seen_at.
# We drop the "unread" part everywhere the badge numbers are computed:
#   - Builder#unread_conversations        full rebuild of inbox / label / team / assignee sets
#   - Refresher#unread?                   live update after message / status / label / assignment changes
#   - FilteredCounter#unread_conversations mentions / participating / unattended counts (still limited to open)
#   - FilterQueryCounter#unread_conversations folder badges = all conversations matching the folder filter
# Folder badges refresh after at most 30 seconds instead of 5 minutes, and all folders are built on the first load
# (Chatwoot builds 3 per request). Fine at our size (~100k conversations, a dozen folders per agent).
# Requires the account features conversation_unread_counts and unread_count_for_filters.
# Remove this file to get Chatwoot's original unread counts back.
Rails.application.config.to_prepare do
  Conversations::UnreadCounts.module_eval do
    { FILTERED_COUNT_FRESH_TTL: 30, FILTERED_COUNT_MIN_REFRESH_INTERVAL: 30, MAX_INLINE_FILTER_BUILDS: 25 }.each do |name, value|
      remove_const(name) if const_defined?(name, false)
      const_set(name, value)
    end
    remove_const(:FILTERED_COUNT_REDIS_TTL) if const_defined?(:FILTERED_COUNT_REDIS_TTL, false)
    const_set(:FILTERED_COUNT_REDIS_TTL, self::FILTERED_COUNT_FRESH_TTL + self::FILTERED_COUNT_STALE_WINDOW)
  end

  Conversations::UnreadCounts::Builder.class_eval do
    private

    def unread_conversations
      account.conversations.open
    end
  end

  Conversations::UnreadCounts::Refresher.class_eval do
    private

    def unread?
      conversation.open?
    end
  end

  Conversations::UnreadCounts::FilteredCounter.class_eval do
    private

    def unread_conversations
      account.conversations
    end
  end

  Conversations::UnreadCounts::FilterQueryCounter.class_eval do
    private

    def unread_conversations
      @account.conversations
    end
  end
end
