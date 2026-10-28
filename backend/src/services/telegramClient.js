function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function createTelegramClient(config, logger = console) {
  const enabled =
    hasValue(config.telegramBotToken) && hasValue(config.telegramChatId);
  if (!enabled) {
    logger.warn(
      "Telegram notifications disabled: configure both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    );
  }

  async function sendMessage(text) {
    if (!enabled) return false;

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: config.telegramChatId, text }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) {
        logger.warn(`Telegram notification failed with HTTP ${response.status}`);
        return false;
      }

      const result = await response.json();
      if (result?.ok !== true) {
        logger.warn("Telegram notification was rejected by the provider");
        return false;
      }
      return true;
    } catch {
      logger.warn("Telegram request or provider response failed");
      return false;
    }
  }

  return { enabled, sendMessage };
}
