import { Message } from './types';

export const pruneHistory = async (
  history: Message[],
  maxMessages: number = 15,
  keepFirst: number = 2
) => {
  let recentMsg = history[history.length - 1];
  if (!recentMsg.didActionsFail) {
    for (let i = history.length - 2; i >= 0; i--) {
      const msg = history[i];
      if (!msg.didActionsFail) {
        continue;
      }
      if (msg.didActionsFail) {
        // remove msg
        history.splice(i, 1);
      }
    }
  }
  // Keep at most maxMessages messages in history
  // Alway keep first 2 messages (system prompt and issue)
  if (history.length > maxMessages + keepFirst) {
    history = history.slice(0, keepFirst).concat(history.slice(-maxMessages));
  }
  return history;
};
