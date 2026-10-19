# frozen_string_literal: true

# RSTM patch (19.10.2026): no Chatwoot branding towards customers.
# Chatwoot hides "Powered by Chatwoot" (chat widget, customer emails) only when the account feature disable_branding is
# on. That flag is "premium" and gets switched off again by the plan reconciliation on the community edition, so we
# answer it as enabled here. The public help center footer is removed by the empty _footer templates in this folder.
module RstmDisableBranding
  def feature_enabled?(name)
    return true if name.to_s == 'disable_branding'

    super
  end
end

Rails.application.config.to_prepare do
  Account.prepend(RstmDisableBranding) unless Account.ancestors.include?(RstmDisableBranding)
end
