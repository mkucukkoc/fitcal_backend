import { Router, Request } from 'express';
import multer from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { createMeal, listMealsForDate, getMeal, updateMeal, analyzeMeal, confirmMeal, uploadMealImage } from '../server/fitcal/services/mealService';
import { ensureUserInfo } from '../server/fitcal/services/userInfoService';
import { formatDateInTimeZone, getUtcRangeForDate } from '../server/fitcal/utils/timezone';
import { incrementDailyStats } from '../server/fitcal/services/progressService';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

const upload = multer({ storage: multer.memoryStorage() });

export const createMealsRouter = () => {
  const router = Router();
  attachRouteLogger(router, 'fitcal-meals');

  router.post('/', authenticateToken, upload.single('image'), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const fileRequest = req as Request & { file?: Express.Multer.File };
      if (!authReq.user) {
        res.status(401).json({ error: 'access_denied', message: 'Authentication required' });
        return;
      }

      const { source = 'camera', meal_time, image_url } = req.body;
      const userInfo = await ensureUserInfo(authReq.user.id, {
        name: authReq.user.name,
        email: authReq.user.email
      });

      const meal = await createMeal({
        userId: authReq.user.id,
        imageUrl: image_url || null,
        source,
        mealTime: meal_time
      });

      if (fileRequest.file) {
        const uploadedUrl = await uploadMealImage(
          authReq.user.id,
          meal.id,
          fileRequest.file.buffer,
          fileRequest.file.mimetype
        );
        await updateMeal(meal.id, { image_url: uploadedUrl });
        meal.image_url = uploadedUrl;
      }

      res.status(201).json({
        ...meal,
        timezone: userInfo.timezone
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to create meal');
      res.status(500).json({ error: 'internal_error', message: 'Meal creation failed' });
    }
  });

  router.get('/', authenticateToken, async (req, res) => {
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

      const { start, end } = getUtcRangeForDate(date, userInfo.timezone || 'UTC');
      const meals = await listMealsForDate(authReq.user.id, start, end);

      res.json({ date, meals });
    } catch (error) {
      logger.error({ err: error }, 'Failed to list meals');
      res.status(500).json({ error: 'internal_error', message: 'Failed to list meals' });
    }
  });

  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const meal = await getMeal(req.params.id);
      if (!meal) {
        res.status(404).json({ error: 'not_found', message: 'Meal not found' });
        return;
      }
      res.json(meal);
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch meal');
      res.status(500).json({ error: 'internal_error', message: 'Failed to fetch meal' });
    }
  });

  router.patch('/:id', authenticateToken, async (req, res) => {
    try {
      const updates = req.body || {};
      await updateMeal(req.params.id, updates);
      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update meal');
      res.status(500).json({ error: 'internal_error', message: 'Failed to update meal' });
    }
  });

  router.post('/:id/analyze', authenticateToken, async (req, res) => {
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

      const model = req.body?.model || 'gemini-1.5-flash';
      const options = req.body?.options || {};
      const result = await analyzeMeal(req.params.id, model, options.language || userInfo.language || 'tr');

      res.json({
        calories: result.raw.total_calories,
        macros: {
          protein_g: result.raw.total_macros?.p || 0,
          carbs_g: result.raw.total_macros?.c || 0,
          fat_g: result.raw.total_macros?.f || 0
        },
        protein: result.raw.total_macros?.p || 0,
        carbs: result.raw.total_macros?.c || 0,
        fat: result.raw.total_macros?.f || 0,
        items: result.raw.items || [],
        confidence: result.raw.confidence || 0,
        health_score: result.raw.health_score ?? null,
        coach_note: result.raw.coach_note ?? null,
        analysis_result_id: result.analysis.id
      });
    } catch (error) {
      logger.error({ err: error }, 'Meal analysis failed');
      res.status(500).json({ error: 'internal_error', message: 'Meal analysis failed' });
    }
  });

  router.post('/:id/confirm', authenticateToken, async (req, res) => {
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
      const totals = await confirmMeal(req.params.id, req.body?.analysisResultId);
      const meal = await getMeal(req.params.id);
      const mealTime = meal?.meal_time ? new Date(meal.meal_time) : new Date();
      const date = formatDateInTimeZone(mealTime, userInfo.timezone || 'UTC');

      const stats = await incrementDailyStats(userInfo, date, {
        calories_consumed: totals.calories || 0,
        protein_consumed_g: totals.protein_g || 0,
        carbs_consumed_g: totals.carbs_g || 0,
        fat_consumed_g: totals.fat_g || 0
      });

      res.json({
        ok: true,
        daily_stats: stats
      });
    } catch (error) {
      logger.error({ err: error }, 'Meal confirm failed');
      res.status(500).json({ error: 'internal_error', message: 'Meal confirmation failed' });
    }
  });

  return router;
};
