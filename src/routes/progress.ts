import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { ensureUserInfo, getUserInfo, updateUserInfo } from '../server/fitcal/services/userInfoService';
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

  router.post('/profile', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }

      const {
        age,
        gender,
        height_cm,
        current_weight_kg,
        target_weight_kg,
        activity_level,
        goal,
        device_id,
        completed_at,
      } = req.body || {};

      const existing = await getUserInfo(authReq.user.id);
      if (existing?.onboarding_completed) {
        res.json({ ok: true, synced: false, reason: 'already_completed', user: existing });
        return;
      }

      const updates: Record<string, any> = {};
      if (!existing?.name && authReq.user.name) {
        updates.name = authReq.user.name;
      }
      if (!existing?.email && authReq.user.email) {
        updates.email = authReq.user.email;
      }

      const ageValue = Number(age);
      if (Number.isFinite(ageValue) && ageValue > 0) {
        const birthDate = new Date();
        birthDate.setFullYear(birthDate.getFullYear() - Math.round(ageValue));
        updates.birth_date = birthDate.toISOString();
      }

      if (gender === 'male' || gender === 'female' || gender === 'other') {
        updates.gender = gender;
      }
      const heightValue = Number(height_cm);
      if (Number.isFinite(heightValue) && heightValue > 0) {
        updates.height_cm = heightValue;
      }
      const currentWeightValue = Number(current_weight_kg);
      if (Number.isFinite(currentWeightValue) && currentWeightValue > 0) {
        updates.current_weight_kg = currentWeightValue;
      }
      const targetWeightValue = Number(target_weight_kg);
      if (Number.isFinite(targetWeightValue) && targetWeightValue > 0) {
        updates.target_weight_kg = targetWeightValue;
      }

      const normalizedActivity = (() => {
        if (activity_level === 'very') return 'very_active';
        if (activity_level === 'active') return 'active';
        if (activity_level === 'very_active') return 'very_active';
        if (activity_level === 'moderate') return 'moderate';
        if (activity_level === 'light') return 'light';
        if (activity_level === 'sedentary') return 'sedentary';
        return null;
      })();
      if (normalizedActivity) {
        updates.activity_level = normalizedActivity;
      }

      if (goal === 'lose' || goal === 'maintain' || goal === 'gain') {
        updates.goal = goal;
      }

      updates.onboarding_completed = true;
      if (typeof device_id === 'string' && device_id.trim() !== '') {
        updates.onboarding_device_id = device_id;
      }
      updates.onboarding_completed_at = typeof completed_at === 'string' ? completed_at : new Date().toISOString();

      const updated = await updateUserInfo(authReq.user.id, updates);
      res.json({ ok: true, synced: true, user: updated });
    } catch (error) {
      logger.error({ err: error }, 'Failed to sync onboarding profile');
      res.status(500).json({ error: 'internal_error', message: 'Failed to sync onboarding profile' });
    }
  });

  return router;
};
