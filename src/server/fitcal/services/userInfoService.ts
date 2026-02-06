import { db } from '../../../firebase';
import { DEFAULT_TIMEZONE } from '../utils/timezone';
import { logger } from '../../../utils/logger';

export interface UserInfo {
  id: string;
  email?: string;
  name?: string;
  gender?: 'male' | 'female' | 'other';
  birth_date?: string;
  height_cm?: number;
  current_weight_kg?: number;
  target_weight_kg?: number;
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal?: 'lose' | 'maintain' | 'gain';
  language?: 'tr' | 'en';
  timezone?: string;
  onboarding_completed?: boolean;
  onboarding_device_id?: string;
  onboarding_completed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DailyTargets {
  calories_goal: number;
  protein_goal_g: number;
  carbs_goal_g: number;
  fat_goal_g: number;
}

const activityMultipliers: Record<NonNullable<UserInfo['activity_level']>, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

export const getUserInfo = async (userId: string): Promise<UserInfo | null> => {
  const snapshot = await db.collection('users_info').doc(userId).get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data
  } as UserInfo;
};

export const ensureUserInfo = async (userId: string, fallback: Partial<UserInfo> = {}): Promise<UserInfo> => {
  const existing = await getUserInfo(userId);
  if (existing) {
    return {
      ...existing,
      timezone: existing.timezone || DEFAULT_TIMEZONE,
      language: existing.language || 'tr'
    };
  }

  const now = new Date().toISOString();
  const userInfo: UserInfo = {
    id: userId,
    name: fallback.name,
    email: fallback.email,
    timezone: fallback.timezone || DEFAULT_TIMEZONE,
    language: fallback.language || 'tr',
    goal: fallback.goal || 'maintain',
    activity_level: fallback.activity_level || 'sedentary',
    created_at: now,
    updated_at: now
  };

  await db.collection('users_info').doc(userId).set(userInfo, { merge: true });
  logger.info({ userId }, 'users_info created with defaults');
  return userInfo;
};

export const updateUserInfo = async (userId: string, updates: Partial<UserInfo>): Promise<UserInfo> => {
  const now = new Date().toISOString();
  await db.collection('users_info').doc(userId).set({ ...updates, updated_at: now }, { merge: true });
  const updated = await getUserInfo(userId);
  return updated || {
    id: userId,
    ...updates,
    updated_at: now,
    timezone: updates.timezone || DEFAULT_TIMEZONE,
    language: updates.language || 'tr'
  };
};

const getAge = (birthDate?: string): number | null => {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

export const calculateDailyTargets = (user: UserInfo): DailyTargets => {
  const weight = user.current_weight_kg || 70;
  const height = user.height_cm || 170;
  const age = getAge(user.birth_date) || 30;
  const gender = user.gender || 'other';

  const bmrBase = 10 * weight + 6.25 * height - 5 * age;
  const bmr = gender === 'male' ? bmrBase + 5 : gender === 'female' ? bmrBase - 161 : bmrBase - 78;

  const activityMultiplier = activityMultipliers[user.activity_level || 'sedentary'] || 1.2;
  let calories = bmr * activityMultiplier;

  if (user.goal === 'lose') {
    calories *= 0.85;
  } else if (user.goal === 'gain') {
    calories *= 1.15;
  }

  const roundedCalories = Math.max(1200, Math.round(calories));
  const proteinCalories = roundedCalories * 0.3;
  const carbsCalories = roundedCalories * 0.4;
  const fatCalories = roundedCalories * 0.3;

  return {
    calories_goal: roundedCalories,
    protein_goal_g: Math.round(proteinCalories / 4),
    carbs_goal_g: Math.round(carbsCalories / 4),
    fat_goal_g: Math.round(fatCalories / 9)
  };
};
