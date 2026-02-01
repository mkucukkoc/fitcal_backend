import axios from 'axios';
import { logger } from '../../../utils/logger';
import { BIG_SYSTEM_PROMPT, MASTER_FOOD_ANALYSIS_PROMPT } from '../constants';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const getApiKey = () => process.env.GEMINI_API_KEY || '';

const cleanJsonResponse = (text: string) => {
  return text.replace(/```json|```/g, '').trim();
};

export const analyzeMealImage = async (imageBase64: string, mimeType: string, language: string) => {
  const apiKey = getApiKey();
  if (!apiKey) {
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

  const response = await axios.post(
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

  const response = await axios.post(
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
    const response = await axios.post(
      `${GEMINI_BASE_URL}/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      requestBody
    );
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to generate summary');
    return null;
  }
};
