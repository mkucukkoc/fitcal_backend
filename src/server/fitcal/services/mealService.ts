import { db, storage } from '../../../firebase';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger';
import { analyzeMealImage } from './geminiService';
import axios from 'axios';

export interface MealItem {
  id: string;
  meal_id: string;
  name: string;
  amount: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MealRecord {
  id: string;
  user_id: string;
  image_url?: string | null;
  image_base64?: string | null;
  image_mime_type?: string | null;
  label?: string | null;
  source: 'camera' | 'manual';
  meal_time: string;
  status: 'draft' | 'confirmed';
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  created_at: string;
  updated_at: string;
}

export interface AnalysisResult {
  id: string;
  meal_id: string;
  model: string;
  confidence: number;
  is_selected: boolean;
  raw_response: any;
  created_at: string;
}

export interface StoredMealImage {
  url: string;
  base64?: string;
  mimeType?: string;
  isMock?: boolean;
}

const extractImageFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], base64: match[2] };
};

export const uploadMealImage = async (
  userId: string,
  mealId: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<StoredMealImage> => {
  const bucket = storage.bucket();
  const extension = mimeType.split('/')[1] || 'jpg';
  const path = `meals/${userId}/${mealId}.${extension}`;

  const file = bucket.file(path) as any;
  if (typeof file.save === 'function') {
    try {
      await file.save(fileBuffer, { metadata: { contentType: mimeType } });
      if (typeof file.makePublic === 'function') {
        await file.makePublic();
      }
      const bucketName = 'name' in bucket && typeof (bucket as any).name === 'string'
        ? (bucket as any).name
        : process.env.FIREBASE_STORAGE_BUCKET || 'mock';
      return { url: `https://storage.googleapis.com/${bucketName}/${path}`, isMock: false };
    } catch (error) {
      logger.warn({ err: error }, 'Storage upload failed, falling back to inline base64 storage');
    }
  }

  logger.warn('Storage not configured, using inline base64 for meal image');
  return {
    url: `mock://storage/${path}`,
    base64: fileBuffer.toString('base64'),
    mimeType,
    isMock: true
  };
};

export const createMeal = async (data: {
  userId: string;
  imageUrl?: string | null;
  label?: string | null;
  source: 'camera' | 'manual';
  mealTime?: string;
}) => {
  const now = new Date().toISOString();
  const mealId = uuidv4();
  const meal: MealRecord = {
    id: mealId,
    user_id: data.userId,
    image_url: data.imageUrl || null,
    label: data.label || null,
    source: data.source,
    meal_time: data.mealTime || now,
    status: 'draft',
    created_at: now,
    updated_at: now
  };

  await db.collection('meals').doc(mealId).set(meal);
  logger.info({ mealId, userId: data.userId, source: data.source }, 'Meal created');
  return meal;
};

export const listMealsForDate = async (userId: string, start: Date, end: Date) => {
  const snapshot = await db
    .collection('meals')
    .where('user_id', '==', userId)
    .where('meal_time', '>=', start.toISOString())
    .where('meal_time', '<', end.toISOString())
    .orderBy('meal_time', 'desc')
    .get();

  return snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({ id: doc.id, ...doc.data() }));
};

export const getMeal = async (mealId: string) => {
  const mealDoc = await db.collection('meals').doc(mealId).get();
  if (!mealDoc.exists) {
    return null;
  }
  const mealData = mealDoc.data();
  const itemsSnapshot = await db.collection('meal_items').where('meal_id', '==', mealId).get();
  const items = itemsSnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({ id: doc.id, ...doc.data() }));
  const analysisSnapshot = await db
    .collection('analysis_results')
    .where('meal_id', '==', mealId)
    .orderBy('created_at', 'desc')
    .get();
  const analysis = analysisSnapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({ id: doc.id, ...doc.data() }));

  return {
    id: mealDoc.id,
    ...mealData,
    items,
    analysis_results: analysis
  };
};

export const updateMeal = async (mealId: string, updates: Partial<MealRecord>) => {
  const now = new Date().toISOString();
  await db.collection('meals').doc(mealId).set({ ...updates, updated_at: now }, { merge: true });
};

export const analyzeMeal = async (mealId: string, model: string, language: string) => {
  const mealDoc = await db.collection('meals').doc(mealId).get();
  if (!mealDoc.exists) {
    throw new Error('Meal not found');
  }

  const mealData = mealDoc.data() as MealRecord;
  let imageBase64 = mealData?.image_base64 || null;
  let mimeType = mealData?.image_mime_type || 'image/jpeg';

  if (!imageBase64 && mealData?.image_url) {
    const inline = extractImageFromDataUrl(mealData.image_url);
    if (inline) {
      imageBase64 = inline.base64;
      mimeType = inline.mimeType || mimeType;
    }
  }

  if (!imageBase64 && mealData?.image_url) {
    if (mealData.image_url.startsWith('mock://')) {
      throw new Error('Meal image is stored locally and cannot be analyzed. Please re-upload the meal image.');
    }
    logger.info({ mealId, model }, 'Starting meal image analysis');
    const imageResponse = await axios.get<ArrayBuffer>(mealData.image_url, { responseType: 'arraybuffer' });
    if (imageResponse.status >= 400) {
      throw new Error('Failed to download meal image');
    }
    const buffer = Buffer.from(imageResponse.data);
    mimeType = imageResponse.headers['content-type'] || mimeType;
    imageBase64 = buffer.toString('base64');
  }

  if (!imageBase64) {
    throw new Error('Meal image is missing');
  }

  const analysis = await analyzeMealImage(imageBase64, mimeType, language, model);

  const resultId = uuidv4();
  const result: AnalysisResult = {
    id: resultId,
    meal_id: mealId,
    model,
    confidence: analysis.confidence ?? 0,
    is_selected: true,
    raw_response: analysis,
    created_at: new Date().toISOString()
  };

  await db.collection('analysis_results').doc(resultId).set(result);
  logger.info({ mealId, analysisResultId: resultId, confidence: result.confidence }, 'Meal analysis stored');

  return {
    analysis: result,
    raw: analysis
  };
};

export const confirmMeal = async (mealId: string, analysisResultId?: string) => {
  const mealDoc = await db.collection('meals').doc(mealId).get();
  if (!mealDoc.exists) {
    throw new Error('Meal not found');
  }

  const mealData = mealDoc.data() as MealRecord;
  let selectedAnalysis: any = null;

  if (analysisResultId) {
    const analysisDoc = await db.collection('analysis_results').doc(analysisResultId).get();
    if (analysisDoc.exists) {
      selectedAnalysis = analysisDoc.data();
      await db.collection('analysis_results').doc(analysisResultId).update({ is_selected: true });
    }
  }

  if (!selectedAnalysis) {
    const analysisSnapshot = await db
      .collection('analysis_results')
      .where('meal_id', '==', mealId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();
    selectedAnalysis = analysisSnapshot.docs[0]?.data();
  }

  const now = new Date().toISOString();
  const totals = selectedAnalysis?.raw_response?.total_macros
    ? {
        calories: selectedAnalysis.raw_response.total_calories,
        protein_g: selectedAnalysis.raw_response.total_macros.p,
        carbs_g: selectedAnalysis.raw_response.total_macros.c,
        fat_g: selectedAnalysis.raw_response.total_macros.f
      }
    : {
        calories: mealData.calories || 0,
        protein_g: mealData.protein_g || 0,
        carbs_g: mealData.carbs_g || 0,
        fat_g: mealData.fat_g || 0
      };

  await db.collection('meals').doc(mealId).set(
    {
      status: 'confirmed',
      ...totals,
      updated_at: now
    },
    { merge: true }
  );
  logger.info({ mealId, totals }, 'Meal confirmed');

  if (selectedAnalysis?.raw_response?.items) {
    const batch = db.batch();
    selectedAnalysis.raw_response.items.forEach((item: any) => {
      const itemId = uuidv4();
      const itemRef = db.collection('meal_items').doc(itemId);
      batch.set(itemRef, {
        id: itemId,
        meal_id: mealId,
        name: item.name,
        amount: item.amount || 0,
        unit: item.unit || 'g',
        calories: item.calories || 0,
        protein_g: item.macros?.p || 0,
        carbs_g: item.macros?.c || 0,
        fat_g: item.macros?.f || 0
      });
    });
    await batch.commit();
  }

  return totals;
};
