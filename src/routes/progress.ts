import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { ensureUserInfo, updateUserInfo } from '../server/fitcal/services/userInfoService';
import { formatDateInTimeZone } from '../server/fitcal/utils/timezone';
import { getOrCreateDailyStats, getWeeklyStats, incrementDailyStats, logWater } from '../server/fitcal/services/progressService';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

export const createProgressRouter = () => {
  const router = Router();
  attachRouteLogger(router, 'fitcal-progress');

  router.get('/daily', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }

      const userInfo = await ensureUserInfo(authReq.user.id, {
        name: authReq.user.name,
        email: authReq.user.email
      });
      const date = typeof req.query.date === 'string'
        ? req.query.date
        : formatDateInTimeZone(new Date(), userInfo.timezone || 'UTC');

      const daily = await getOrCreateDailyStats(userInfo, date);
      res.json(daily);
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch daily stats');
      res.status(500).json({ error: 'internal_error', message: 'Failed to fetch daily stats' });
    }
  });

  router.get('/weekly', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }

      const userInfo = await ensureUserInfo(authReq.user.id, {
        name: authReq.user.name,
        email: authReq.user.email
      });
      const weekStart = typeof req.query.weekStart === 'string'
        ? req.query.weekStart
        : formatDateInTimeZone(new Date(), userInfo.timezone || 'UTC');

      const weekly = await getWeeklyStats(userInfo, weekStart);
      res.json(weekly);
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch weekly stats');
      res.status(500).json({ error: 'internal_error', message: 'Failed to fetch weekly stats' });
    }
  });

  router.post('/weight', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }
      const { weight_kg } = req.body || {};
      if (!weight_kg) {
        res.status(400).json({ error: 'invalid_request', message: 'weight_kg is required' });
        return;
      }

      const updated = await updateUserInfo(authReq.user.id, { current_weight_kg: weight_kg });
      res.json({ ok: true, user: updated });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update weight');
      res.status(500).json({ error: 'internal_error', message: 'Failed to update weight' });
    }
  });

  router.post('/water', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }
      const { amount_ml, timestamp } = req.body || {};
      if (!amount_ml) {
        res.status(400).json({ error: 'invalid_request', message: 'amount_ml is required' });
        return;
      }

      const userInfo = await ensureUserInfo(authReq.user.id, {
        name: authReq.user.name,
        email: authReq.user.email
      });
      const logTime = timestamp || new Date().toISOString();
      const log = await logWater(authReq.user.id, amount_ml, logTime);

      const date = formatDateInTimeZone(new Date(logTime), userInfo.timezone || 'UTC');
      const daily = await incrementDailyStats(userInfo, date, { water_ml: amount_ml });

      res.json({ log, daily_stats: daily });
    } catch (error) {
      logger.error({ err: error }, 'Failed to log water');
      res.status(500).json({ error: 'internal_error', message: 'Failed to log water' });
    }
  });

  return router;
};
