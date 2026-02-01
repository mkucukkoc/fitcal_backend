import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { ensureUserInfo } from '../server/fitcal/services/userInfoService';
import { formatDateInTimeZone } from '../server/fitcal/utils/timezone';
import { getOrCreateDailyStats } from '../server/fitcal/services/progressService';
import { handleChatMessage, listChatMessages, listChatSessions } from '../server/fitcal/services/chatService';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

export const createChatRouter = () => {
  const router = Router();
  attachRouteLogger(router, 'fitcal-chat');

  router.post('/', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }

      const { sessionId, message, context } = req.body || {};
      if (!message) {
        res.status(400).json({ error: 'invalid_request', message: 'message is required' });
        return;
      }

      const userInfo = await ensureUserInfo(authReq.user.id, {
        name: authReq.user.name,
        email: authReq.user.email
      });
      const today = formatDateInTimeZone(new Date(), userInfo.timezone || 'UTC');
      const dailyStats = await getOrCreateDailyStats(userInfo, today);

      const result = await handleChatMessage({
        user: userInfo,
        sessionId,
        message,
        dailyStats,
        contextTags: context || null
      });

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, 'Chat request failed');
      res.status(500).json({ error: 'internal_error', message: 'Chat request failed' });
    }
  });

  router.get('/sessions', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }

      const sessions = await listChatSessions(authReq.user.id);
      res.json({ sessions });
    } catch (error) {
      logger.error({ err: error }, 'Failed to list chat sessions');
      res.status(500).json({ error: 'internal_error', message: 'Failed to list chat sessions' });
    }
  });

  router.get('/sessions/:id/messages', authenticateToken, async (req, res) => {
    try {
      const messages = await listChatMessages(req.params.id);
      res.json({ messages });
    } catch (error) {
      logger.error({ err: error }, 'Failed to list chat messages');
      res.status(500).json({ error: 'internal_error', message: 'Failed to list chat messages' });
    }
  });

  return router;
};
