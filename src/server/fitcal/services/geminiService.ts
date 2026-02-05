import axios from 'axios';
import { logger } from '../../../utils/logger';
import { BIG_SYSTEM_PROMPT, MASTER_FOOD_ANALYSIS_PROMPT } from '../constants';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const getApiKey = () => process.env.GEMINI_API_KEY || '';

const cleanJsonResponse = (text: string) => {
  return text.replace(/```json|```/g, '').trim();
};

const createMockAnalysis = (language: string) => {
  const isTurkish = (language || '').toLowerCase().startsWith('tr');
  return {
    total_calories: 480,
    total_macros: { p: 32, c: 46, f: 18 },
    items: [
      {
        name: isTurkish ? 'Tavuk Izgara' : 'Grilled Chicken',
        amount: 150,
        unit: 'g',
        calories: 248,
        macros: { p: 31, c: 0, f: 5 }
      },
      {
        name: isTurkish ? 'Kinoa' : 'Quinoa',
        amount: 120,
        unit: 'g',
        calories: 170,
        macros: { p: 6, c: 30, f: 3 }
      },
      {
        name: isTurkish ? 'Salata' : 'Salad',
        amount: 80,
        unit: 'g',
        calories: 62,
        macros: { p: 2, c: 10, f: 2 }
      }
    ],
    confidence: 0.38,
    health_score: 78,
    coach_note: isTurkish
      ? 'Demo modunda örnek bir analiz gösteriliyor. Gerçek analiz için GEMINI_API_KEY ekleyin.'
      : 'Showing a demo analysis. Add GEMINI_API_KEY for real meal analysis.'
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export const analyzeMealImage = async (imageBase64: string, mimeType: string, language: string) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('GEMINI_API_KEY missing; returning mock analysis for non-production');
      return createMockAnalysis(language);
    }
    throw new Error('GEMINI_API_KEY is not configured');
  }

  logger.info({ mimeType, language }, 'Gemini meal analysis request started');
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${MASTER_FOOD_ANALYSIS_PROMPT}\n\nDil: ${language || 'tr'}.` },
          {
            inlineData: {
              data: imageBase64,
              mimeType
            }
          }
        ]
      }
    ]
  };

  const response = await axios.post<GeminiResponse>(
    `${GEMINI_BASE_URL}/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    requestBody
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    logger.warn({ response: response.data }, 'Gemini analysis returned empty response');
    throw new Error('Gemini returned empty response');
  }

  const cleaned = cleanJsonResponse(text);
  return JSON.parse(cleaned);
};

export const generateCoachResponse = async (context: string, history: Array<{ role: string; content: string }>) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  logger.info({ historyCount: history.length }, 'Gemini coach response request started');
  const contents = history.map(item => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.content }]
  }));

  const requestBody = {
    systemInstruction: {
      parts: [{ text: `${BIG_SYSTEM_PROMPT}\n\nCONTEXT:\n${context}` }]
    },
    contents
  };

  const response = await axios.post<GeminiResponse>(
    `${GEMINI_BASE_URL}/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
    requestBody
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    logger.warn({ response: response.data }, 'Gemini chat returned empty response');
    throw new Error('Gemini returned empty response');
  }

  return text.trim();
};

export const generateSummary = async (summaryInput: string) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Aşağıdaki konuşmayı 3-4 cümlelik kısa bir hafıza özeti olarak yaz.\n\n${summaryInput}`
          }
        ]
      }
    ]
  };

  try {
    const response = await axios.post<GeminiResponse>(
      `${GEMINI_BASE_URL}/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      requestBody
    );
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to generate summary');
    return null;
  }
};
