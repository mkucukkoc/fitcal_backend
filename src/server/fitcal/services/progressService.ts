import { db } from '../../../firebase';
import { formatDateInTimeZone, getUtcRangeForDate } from '../utils/timezone';
import { calculateDailyTargets, DailyTargets, UserInfo } from './userInfoService';
import { logger } from '../../../utils/logger';

export interface DailyStats {
  id: string;
  user_id: string;
  date: string;
  calories_goal: number;
  calories_consumed: number;
  protein_goal_g: number;
  protein_consumed_g: number;
  carbs_goal_g: number;
  carbs_consumed_g: number;
  fat_goal_g: number;
  fat_consumed_g: number;
  water_ml: number;
  steps: number;
}

export const getOrCreateDailyStats = async (user: UserInfo, date: string) => {
  const snapshot = await db
    .collection('daily_stats')
    .where('user_id', '==', user.id)
    .where('date', '==', date)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    return { id: doc.id, ...(doc.data() as DailyStats) };
  }

  const targets: DailyTargets = calculateDailyTargets(user);
  const stats: DailyStats = {
    id: '',
    user_id: user.id,
    date,
    calories_goal: targets.calories_goal,
    calories_consumed: 0,
    protein_goal_g: targets.protein_goal_g,
    protein_consumed_g: 0,
    carbs_goal_g: targets.carbs_goal_g,
    carbs_consumed_g: 0,
    fat_goal_g: targets.fat_goal_g,
    fat_consumed_g: 0,
    water_ml: 0,
    steps: 0
  };

  const ref = await db.collection('daily_stats').add(stats);
  return { ...stats, id: ref.id };
};

export const incrementDailyStats = async (user: UserInfo, date: string, deltas: Partial<DailyStats>) => {
  const daily = await getOrCreateDailyStats(user, date);
  const updated = {
    calories_consumed: daily.calories_consumed + (deltas.calories_consumed || 0),
    protein_consumed_g: daily.protein_consumed_g + (deltas.protein_consumed_g || 0),
    carbs_consumed_g: daily.carbs_consumed_g + (deltas.carbs_consumed_g || 0),
    fat_consumed_g: daily.fat_consumed_g + (deltas.fat_consumed_g || 0),
    water_ml: daily.water_ml + (deltas.water_ml || 0),
    steps: daily.steps + (deltas.steps || 0)
  };

  await db.collection('daily_stats').doc(daily.id).update(updated);
  logger.info({ userId: user.id, date, deltas }, 'Daily stats incremented');
  return { ...daily, ...updated };
};

export const logWater = async (userId: string, amount: number, timestamp: string) => {
  const log = {
    user_id: userId,
    amount_ml: amount,
    timestamp
  };
  const ref = await db.collection('water_logs').add(log);
  logger.info({ userId, amount, timestamp }, 'Water log created');
  return { id: ref.id, ...log };
};

export const getWeeklyStats = async (user: UserInfo, weekStart: string) => {
  const { start, end } = getUtcRangeForDate(weekStart, user.timezone || 'UTC');
  const snapshot = await db
    .collection('daily_stats')
    .where('user_id', '==', user.id)
    .where('date', '>=', formatDateInTimeZone(start, user.timezone || 'UTC'))
    .where('date', '<=', formatDateInTimeZone(new Date(end.getTime() - 1000), user.timezone || 'UTC'))
    .get();

  const stats = snapshot.docs.map(doc => doc.data() as DailyStats);
  const totalMealsSnapshot = await db
    .collection('meals')
    .where('user_id', '==', user.id)
    .where('meal_time', '>=', start.toISOString())
    .where('meal_time', '<', end.toISOString())
    .get();

  const totals = stats.reduce(
    (acc, day) => {
      acc.calories += day.calories_consumed || 0;
      acc.protein += day.protein_consumed_g || 0;
      acc.carbs += day.carbs_consumed_g || 0;
      acc.fat += day.fat_consumed_g || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const daysCount = stats.length || 1;
  return {
    week_start: weekStart,
    avg_calories: Math.round(totals.calories / daysCount),
    avg_protein_g: Math.round(totals.protein / daysCount),
    avg_carbs_g: Math.round(totals.carbs / daysCount),
    avg_fat_g: Math.round(totals.fat / daysCount),
    total_meals: totalMealsSnapshot.size,
    streak_days: stats.filter(day => day.calories_consumed > 0).length
  };
};
